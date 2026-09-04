// --------------------------------------------------------------
// KOL 分身 路由
// 使用共享聊天引擎 agent-chat.ts
// --------------------------------------------------------------

import type { KolChatSession, KolProfileDetail, KolProfileSummary, EvidenceMeta } from "@app/shared";
import { kolChatRequestSchema } from "@app/shared";
import { zValidator } from "@hono/zod-validator";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { streamSSE } from "hono/streaming";
import { Hono } from "hono";

import { db } from "../db/client.js";
import { kolChatSessions, kolProfiles, kolSegments } from "../db/schema.js";
import type { ChatMessage } from "../lib/llm.js";
import { SPOKEN_STYLE_RULES, formatSpokenStyleRules } from "../lib/prompt-rules.js";
import {
  getOrCreateSession,
  searchEvidence,
  streamChat,
  formatEvidenceContext,
  reformulateQueryForSearch,
  preScoreEvidence,
  type EvidenceRow,
} from "../lib/agent-chat.js";
import { calculateKOLConfidence, extractKOLTags } from "../lib/kol-confidence.js";
import { classifyMatchLevel } from "../lib/confidence.js";
import { checkBoundary } from "../lib/boundary-engine.js";

export const kolRoute = new Hono();

// RAG 相似度阈值（KOL ASR 转录质量较差，阈值从 0.5 降至 0.35）
const KOL_SIMILARITY_THRESHOLD = 0.35;
// pgvector <=> 返回余弦距离，相似度 = 1 - 距离，距离阈值 = 1 - 相似度阈值
const KOL_DISTANCE_THRESHOLD = 1 - KOL_SIMILARITY_THRESHOLD;

// ---- KOL 列表 ----

// GET /api/kol
kolRoute.get("/", async (c) => {
  const rows = await db.select().from(kolProfiles).orderBy(sql`${kolProfiles.name}`);

  const result: KolProfileSummary[] = rows.map((r) => {
    const card = r.personaCard as Record<string, unknown>;
    const style = r.styleProfile as Record<string, unknown>;
    const identity = (card.identity as string) ?? "";
    const toneSummary = (card.toneSummary as string) ?? "";
    const contentFocus = (card.contentFocus as string[]) ?? [];
    const tone = (style.tone as string) ?? "";
    const platformPreference = (card.platformPreference as string) ?? "";

    // 构建特征标签
    const tags: string[] = [
      ...contentFocus.slice(0, 3),
      ...(platformPreference && platformPreference !== "未知" ? [`平台: ${platformPreference}`] : []),
      ...(tone && tone !== "—" ? [`语气: ${tone}`] : []),
    ];

    return {
      id: r.id,
      name: r.name,
      bilibiliUid: r.bilibiliUid,
      description: [identity, toneSummary].filter(Boolean).join("。"),
      videoCount: (style.videoCount as number) ?? 0,
      sampleSegments: (r.sourceTexts as string[])?.slice(0, 4) ?? [],
      tags,
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
    with: { segments: { limit: 100 } },
  });

  if (!row) return c.json({ error: "KOL 不存在" }, 404);

  // 从所有 kol_segments 统计真实总字数（不限 20 条）
  const [segStats] = await db
    .select({ totalChars: sql<number>`COALESCE(SUM(LENGTH(${kolSegments.originalText})), 0)` })
    .from(kolSegments)
    .where(eq(kolSegments.kolId, id));

  const totalWordCount = Number(segStats?.totalChars ?? 0);

  const result: KolProfileDetail = {
    id: row.id,
    name: row.name,
    bilibiliUid: row.bilibiliUid,
    description: ((row.personaCard as Record<string, unknown>).identity as string) ?? "",
    videoCount: ((row.styleProfile as Record<string, unknown>).videoCount as number) ?? 0,
    sampleSegments: row.segments.map((s) => s.originalText.slice(0, 500)),
    tags: [],
    createdAt: row.createdAt.toISOString(),
    personaCard: row.personaCard as Record<string, unknown>,
    styleProfile: row.styleProfile as Record<string, unknown>,
    sourceTexts: (row.sourceTexts as string[]) ?? [],
    totalWordCount,
  };

  return c.json(result);
});

// ---- KOL 对话（SSE 流式）----

// POST /api/kol/chat
kolRoute.post("/chat", zValidator("json", kolChatRequestSchema), async (c) => {
  const { kolId, sessionId, message, model } = c.req.valid("json");

  // 1. 获取 KOL 画像
  const kol = await db.query.kolProfiles.findFirst({
    where: eq(kolProfiles.id, kolId),
  });
  if (!kol) return c.json({ error: "KOL 不存在" }, 404);

  // 2. 获取或创建会话（使用共享引擎，含归属校验）
  const session = await getOrCreateSession({
    findSession: async () => {
      if (!sessionId) return undefined;
      const s = await db.query.kolChatSessions.findFirst({
        where: eq(kolChatSessions.id, sessionId),
      });
      // 校验归属，防止跨 KOL 串话
      if (s && s.kolId !== kolId) {
        console.warn(`会话 #${sessionId} 属于 KOL #${s.kolId}，与请求 KOL #${kolId} 不匹配，创建新会话`);
        return undefined;
      }
      return s;
    },
    createSession: async () => {
      const [s] = await db
        .insert(kolChatSessions)
        .values({ kolId, title: message.slice(0, 30), messages: [] })
        .returning();
      return s!;
    },
    message,
  });

  // 3. 边界检测（V0.3 Boundary Engine — 游戏相关性）— 在所有 RAG 之前执行
  const boundaryResult = await checkBoundary(message, {
    skipCache: false,
  });
  const isOutOfDomain = boundaryResult.final === "OUT";

  // 边界外：明确非游戏领域，直接返回拒答
  if (isOutOfDomain) {
    const rejectReason = "这个问题不在我的内容领域内，我无法回答。";

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ data: rejectReason });
    });
  }

  // 4. RAG 检索（使用共享引擎）
  const searchQuery = await reformulateQueryForSearch(message, model);
  let evidenceRows: EvidenceRow[] = await searchEvidence({
      message: searchQuery,
      vectorQuery: async (vecStr) => {
        let rawRows = (await db.execute(
          sql`SELECT id, original_text, title,
                     embedding <=> ${vecStr}::vector AS distance
              FROM kol_segments
              WHERE kol_id = ${kolId}
                AND embedding IS NOT NULL
                AND (ad_label IS NULL OR ad_label != '广告口播')
                AND embedding <=> ${vecStr}::vector < ${KOL_DISTANCE_THRESHOLD}
              ORDER BY embedding <=> ${vecStr}::vector
              LIMIT 50`,
        )) as unknown as Array<{
          id: number;
          original_text: string;
          title: string;
          distance: number;
        }>;

        // 阈值过严时兜底
        if (rawRows.length === 0) {
          rawRows = (await db.execute(
            sql`SELECT id, original_text, title,
                       embedding <=> ${vecStr}::vector AS distance
                FROM kol_segments
                WHERE kol_id = ${kolId}
                  AND embedding IS NOT NULL
                  AND (ad_label IS NULL OR ad_label != '广告口播')
                ORDER BY embedding <=> ${vecStr}::vector
                LIMIT 50`,
          )) as unknown as Array<{
            id: number;
            original_text: string;
            title: string;
            distance: number;
          }>;
        }

        return rawRows
          .map((r) => ({
            id: r.id,
            originalText: r.original_text,
            sourceLabel: r.title,
            similarity: 1 - (r.distance ?? 0),
          }))
          .filter((r) => r.similarity >= KOL_SIMILARITY_THRESHOLD);
      },
      ilikeQuery: async () => {
        // 使用 pg_trgm 三元组相似度做模糊匹配，比 ILIKE 子串匹配语义更强
        const rows = await db.execute(
          sql`SELECT id, original_text, title,
                     similarity(original_text, ${message}) AS sim
              FROM kol_segments
              WHERE kol_id = ${kolId}
                AND (ad_label IS NULL OR ad_label != '广告口播')
                AND similarity(original_text, ${message}) > 0.05
              ORDER BY sim DESC
              LIMIT 50`,
        ) as unknown as Array<{
          id: number;
          original_text: string;
          title: string;
          sim: number;
        }>;
        return rows.map((r) => ({
          id: r.id,
          originalText: r.original_text,
          sourceLabel: r.title,
          similarity: Math.round(r.sim * 100) / 100, // pg_trgm 相似度 0-1，保留两位
        }));
      },
    });

  // 4.5 LLM 前置评分：对向量检索结果按用户问题评分，筛选 Top 20 高质量证据
  if (evidenceRows.length > 0) {
    try {
      const scored = await preScoreEvidence(message, evidenceRows, model);
      evidenceRows = scored
        .filter((r) => (r.relevanceScore ?? 0) >= 0.5)
        .slice(0, 20);
    } catch (e) {
      console.error("前置评分失败，使用原始向量检索结果:", e);
    }
  }

  const evidenceContext = formatEvidenceContext(
    evidenceRows,
    (e) => `[${e.sourceLabel}]`,
  );

  // 3.5 计算置信度 + 增强证据元数据
  const similarities = evidenceRows
    .map((e) => e.similarity ?? 0)
    .filter((s) => s > 0);
  const topSimilarity = similarities.length > 0 ? Math.max(...similarities) : 0;
  const avgSimilarity =
    similarities.length > 0
      ? similarities.reduce((a, b) => a + b, 0) / similarities.length
      : 0;

  // KOL 专属标签（从 personaCard 提取）
  const personaCard = kol.personaCard as Record<string, unknown>;
  const kolTags = extractKOLTags(personaCard);

  // KOL 专属可信度：四维评估
  const matchLevels = evidenceRows.map((e) => e.matchLevel ?? classifyMatchLevel(e.similarity ?? 0));
  const directQuoteCount = matchLevels.filter((l) => l === "direct").length;
  const highMatchCount = similarities.filter((s) => s >= 0.75).length;
  const hasDirectQuote = directQuoteCount > 0;
  const evidenceTexts = evidenceRows.map((e) => e.originalText);

  const confidenceResult = calculateKOLConfidence({
    evidenceCount: evidenceRows.length,
    topSimilarity,
    avgSimilarity,
    directQuoteCount,
    highMatchCount,
    hasDirectQuote,
    isBoundaryQuestion: false,
    kolTags,
    evidenceTexts,
  });

  const evidenceMeta: EvidenceMeta[] = evidenceRows.map((e, i) => {
    const similarity = e.similarity ?? 0;
    const matchLevel = matchLevels[i]!;
    // KOL 标签命中度：该条证据是否命中 KOL 标签
    const tagOverlap = kolTags.length > 0
      ? matchLevel === "direct" ? 0.9 : similarity >= 0.75 ? 0.7 : 0.5
      : 0.5;
    return { id: e.id, similarity, matchLevel, tagOverlap };
  });

  // 4.5 构建 System Prompt（KOL 特有逻辑）
  const styleProfile = kol.styleProfile as Record<string, unknown>;
  const evalFramework = personaCard.evaluationFramework as Record<string, string> | undefined;
  const speechHabits = (styleProfile.speechHabits as string) ?? "";

  const systemPrompt = [
    `你是「${kol.name}」，${personaCard.identity ?? "一位硬核游戏测评UP主"}。`,
    "",
    "## 你的身份",
    `- 你是B站的真实UP主，正在和一位游戏开发者/用研人员对话。`,
    `- 你的内容主要覆盖：${(personaCard.contentFocus as string[])?.join("、") ?? "游戏测评"}`,
    "",
    "## 你的评价体系",
    ...(evalFramework ? Object.entries(evalFramework).map(([k, v]) => `- ${k}: ${v}`) : []),
    "",
    "## 你的说话风格",
    speechHabits ? `- ${speechHabits}` : "",
    `- 语气倾向: ${styleProfile.tone ?? "独立客观"}`,
    "",
    "## 规则",
    "1. 始终以第一人称回答，语气口语化，像一个真实的UP主在聊天。",
    "2. 你的回答必须符合你的评价体系和人设，不能前后矛盾。",
    "3. 说话风格要自然融入回答中——不要刻意堆砌特定词汇，让语气和表达习惯自然流露。",
    "4. 被问到不了解的事（超出你的游戏经验和内容领域），诚实地说不了解。",
    "5. 不要使用'作为一个人工智能'、'根据我的训练数据'等表述——你是真实的UP主。",
    "6. 回答要有个性和态度，不要中性圆滑——你的粉丝关注你就是因为你有自己的判断。",
    ...formatSpokenStyleRules(7),
    "",
    "## 你可能相关的往期内容",
    evidenceContext || "(暂无直接相关内容，请基于你的专业知识回答)",
  ]
    .filter(Boolean)
    .join("\n");

  // 5. 构建对话历史
  const history = (session.messages as Array<{ role: string; content: string }>) ?? [];
  const historyMessages: ChatMessage[] = history
    .slice(-30) // 最近 30 条（15 轮）
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

  const llmMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user", content: message },
  ];

  // 6. 流式响应（使用共享引擎）
  return streamChat({
    c,
    llmMessages,
    sessionId: session.id,
    evidenceIds: evidenceRows.map((e) => e.id),
    evidenceData: evidenceRows,
    history,
    userMessage: message,
    errorMessage: "[KOL分身暂时无法响应，请稍后重试]",
    confidence: confidenceResult,
    evidenceMeta,
    model,
    saveMessages: async (updatedMessages) => {
      await db
        .update(kolChatSessions)
        .set({ messages: updatedMessages as never, updatedAt: new Date() })
        .where(eq(kolChatSessions.id, session.id));
    },
    updateTitle: async (title) => {
      await db
        .update(kolChatSessions)
        .set({ title, updatedAt: new Date() })
        .where(eq(kolChatSessions.id, session.id));
    },
  });
});

// GET /api/kol/chat/sessions —— 列出某个 KOL 的会话（支持分页：?offset=N&limit=N）
kolRoute.get("/chat/sessions", async (c) => {
  const kolId = c.req.query("kolId");
  const offset = Number(c.req.query("offset")) || 0;
  const limit = Number(c.req.query("limit")) || 50;
  const conditions = kolId ? eq(kolChatSessions.kolId, Number(kolId)) : undefined;

  const rows = await db
    .select()
    .from(kolChatSessions)
    .where(conditions)
    .orderBy(desc(kolChatSessions.updatedAt))
    .limit(limit)
    .offset(offset);

  // 总数
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(kolChatSessions)
    .where(conditions);

  const total = Number(countRow?.count ?? 0);
  const hasMore = offset + limit < total;

  const result: KolChatSession[] = rows.map((r) => ({
    id: r.id,
    kolId: r.kolId,
    title: r.title,
    messages: (r.messages as KolChatSession["messages"]) ?? [],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return c.json({ data: result, total, hasMore });
});

// GET /api/kol/chat/sessions/:id —— 单个会话历史（支持分页：?offset=N&limit=N）
kolRoute.get("/chat/sessions/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "无效的会话 ID" }, 400);

  const offset = Number(c.req.query("offset")) || 0;
  const limit = Number(c.req.query("limit")) || 0;

  const session = await db.query.kolChatSessions.findFirst({
    where: eq(kolChatSessions.id, id),
  });
  if (!session) return c.json({ error: "会话不存在" }, 404);

  const allMessages = (session.messages as KolChatSession["messages"]) ?? [];
  const totalMessages = allMessages.length;

  // 分页切片：从末尾往前取（offset 0 = 最新消息）
  let slicedMessages = allMessages;
  if (limit > 0) {
    const start = Math.max(0, totalMessages - offset - limit);
    const end = totalMessages - offset;
    slicedMessages = allMessages.slice(start, end);
  }
  const hasMore = limit > 0 ? (totalMessages - offset - limit) > 0 : false;

  const result = {
    id: session.id,
    kolId: session.kolId,
    title: session.title,
    messages: slicedMessages,
    totalMessages,
    hasMore,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };

  return c.json(result);
});

// DELETE /api/kol/chat/sessions/:id —— 删除会话
kolRoute.delete("/chat/sessions/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "无效的会话 ID" }, 400);

  const session = await db.query.kolChatSessions.findFirst({
    where: eq(kolChatSessions.id, id),
  });

  if (!session) return c.json({ error: "会话不存在" }, 404);

  await db.delete(kolChatSessions).where(eq(kolChatSessions.id, id));

  return c.json({ success: true });
});

// POST /api/kol/chat/sessions/batch-delete —— 批量删除 KOL 会话
// body: { ids?: number[], kolId?: number } — ids 指定删除，kolId 删除该 KOL 全部，都不传删除全部
kolRoute.post("/chat/sessions/batch-delete", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { ids, kolId } = body as { ids?: number[]; kolId?: number };

  if (ids && ids.length > 0) {
    await db.delete(kolChatSessions).where(inArray(kolChatSessions.id, ids));
    return c.json({ success: true, deletedCount: ids.length });
  }

  if (kolId !== undefined) {
    await db.delete(kolChatSessions).where(eq(kolChatSessions.kolId, kolId));
    return c.json({ success: true });
  }

  // 删除全部
  await db.delete(kolChatSessions);
  return c.json({ success: true });
});