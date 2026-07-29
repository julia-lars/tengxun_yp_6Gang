// --------------------------------------------------------------
// KOL 分身 路由
// --------------------------------------------------------------

import type { KolProfileDetail, KolProfileSummary } from "@app/shared";
import { kolChatRequestSchema } from "@app/shared";
import { zValidator } from "@hono/zod-validator";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { db } from "../db/client.js";
import { kolProfiles, kolSegments } from "../db/schema.js";
import type { ChatMessage } from "../lib/llm.js";
import { chatStream } from "../lib/llm.js";

export const kolRoute = new Hono();

// ---- KOL 列表 ----

// GET /api/kol
kolRoute.get("/", async (c) => {
  const rows = await db.select().from(kolProfiles).orderBy(sql`${kolProfiles.name}`);

  const result: KolProfileSummary[] = rows.map((r) => {
    const card = r.personaCard as Record<string, unknown>;
    const style = r.styleProfile as Record<string, unknown>;
    return {
      id: r.id,
      name: r.name,
      bilibiliUid: r.bilibiliUid,
      description: (card.identity as string) ?? "",
      videoCount: (style.videoCount as number) ?? 0,
      sampleSegments: (r.sourceTexts as string[])?.slice(0, 3) ?? [],
      createdAt: r.createdAt.toISOString(),
    };
  });

  return c.json(result);
});

// ---- KOL 详情 ----

// GET /api/kol/:id
kolRoute.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "无效的 ID" }, 400);

  const row = await db.query.kolProfiles.findFirst({
    where: eq(kolProfiles.id, id),
    with: { segments: { limit: 5 } },
  });

  if (!row) return c.json({ error: "KOL 不存在" }, 404);

  const result: KolProfileDetail = {
    id: row.id,
    name: row.name,
    bilibiliUid: row.bilibiliUid,
    description: ((row.personaCard as Record<string, unknown>).identity as string) ?? "",
    videoCount: ((row.styleProfile as Record<string, unknown>).videoCount as number) ?? 0,
    sampleSegments: row.segments.map((s) => s.originalText.slice(0, 200)),
    createdAt: row.createdAt.toISOString(),
    personaCard: row.personaCard as Record<string, unknown>,
    styleProfile: row.styleProfile as Record<string, unknown>,
    sourceTexts: (row.sourceTexts as string[]) ?? [],
  };

  return c.json(result);
});

// ---- KOL 对话（SSE 流式） ----

// POST /api/kol/chat
kolRoute.post("/chat", zValidator("json", kolChatRequestSchema), async (c) => {
  const { kolId, message } = c.req.valid("json");

  // 1. 获取 KOL 画像
  const kol = await db.query.kolProfiles.findFirst({
    where: eq(kolProfiles.id, kolId),
  });
  if (!kol) return c.json({ error: "KOL 不存在" }, 404);

  // 2. RAG: 基于用户问题检索该 KOL 的相关原声
  const evidenceRows = await db
    .select({
      id: kolSegments.id,
      originalText: kolSegments.originalText,
      title: kolSegments.title,
      bvid: kolSegments.bvid,
    })
    .from(kolSegments)
    .where(
      sql`${kolSegments.kolId} = ${kolId} AND ${kolSegments.originalText} ILIKE ${"%" + message.slice(0, 30) + "%"}`,
    )
    .limit(3);

  const evidenceContext = evidenceRows
    .map((e) => `[${e.title}] ${e.originalText.slice(0, 300)}`)
    .join("\n---\n");

  // 3. 构建 System Prompt
  const personaCard = kol.personaCard as Record<string, unknown>;
  const styleProfile = kol.styleProfile as Record<string, unknown>;
  const catchphrases = (styleProfile.catchphrases as string[]) ?? [];
  const evalFramework = personaCard.evaluationFramework as Record<string, string> | undefined;

  const systemPrompt = [
    `你是「${kol.name}」，${personaCard.identity ?? "一位硬核游戏测评UP主"}。`,
    "",
    "## 你的身份",
    `- 你是B站的真实UP主，正在和一位游戏开发者/用研人员对话。`,
    `- 你的内容主要覆盖：${(personaCard.contentFocus as string[])?.join("、") ?? "游戏测评"}`,
    "",
    "## 你的评价体系",
    ...(evalFramework
      ? Object.entries(evalFramework).map(([k, v]) => `- ${k}: ${v}`)
      : []),
    "",
    "## 你的风格特征",
    `- 常用口头禅/标志性表达: ${catchphrases.join("、")}`,
    `- 语气的整体倾向: ${styleProfile.tone ?? "独立客观"}`,
    `- 平均句长约 ${styleProfile.avgSentenceLength ?? 30} 字`,
    "",
    "## 规则",
    "1. 始终以第一人称回答，语气口语化，像一个真实的UP主在聊天。",
    "2. 你的回答必须符合你的评价体系和人设，不能前后矛盾。",
    "3. 可以自然地使用你的口头禅和标志性表达，但不要刻意堆砌。",
    "4. 被问到不了解的事（超出你的游戏经验和内容领域），诚实地说不了解。",
    "5. 不要使用'作为一个人工智能'、'根据我的训练数据'等表述——你是真实的UP主。",
    "6. 回答要有个性和态度，不要中性圆滑——你的粉丝关注你就是因为你有自己的判断。",
    "",
    "## 你可能相关的往期内容",
    evidenceContext || "(暂无直接相关内容，请基于你的专业知识回答)",
  ]
    .filter(Boolean)
    .join("\n");

  // 4. 构建对话消息
  const llmMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: message },
  ];

  // 5. 流式响应
  const evidenceIds = evidenceRows.map((e) => e.id);

  return streamSSE(c, async (stream) => {
    let fullResponse = "";

    try {
      for await (const token of chatStream(llmMessages)) {
        fullResponse += token;
        await stream.writeSSE({ data: token });
      }
    } catch (e) {
      console.error("KOL 对话引擎错误:", e);
      await stream.writeSSE({
        data: "[KOL分身暂时无法响应，请稍后重试]",
      });
    }

    // 发送 evidence
    await stream.writeSSE({
      data: JSON.stringify({
        type: "evidence",
        ids: evidenceIds,
        kolId,
      }),
    });
  });
});
