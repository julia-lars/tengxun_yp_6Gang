// --------------------------------------------------------------
// 对话 路由（SSE 流式）
// --------------------------------------------------------------

import { type ChatRequest, type ChatSession, chatRequestSchema } from "@app/shared";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { db } from "../db/client.js";
import { chatSessions, personas, sourceSegments } from "../db/schema.js";
import type { ChatMessage } from "../lib/llm.js";
import { chatStream } from "../lib/llm.js";

export const chatRoute = new Hono();

// BGE embedding 服务（Python 微服务，本地端口 8765）
async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch("http://127.0.0.1:8765/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Embed server ${res.status}`);
  const data = (await res.json()) as { embedding: number[] };
  return data.embedding;
}

// ---- System Prompt 构建器（从 persona 字段动态生成）----

function buildSystemPrompt(
  personaName: string,
  personaDescription: string,
  tagSpec: Record<string, unknown>,
  motivationChain: Record<string, string>,
  evidenceContext: string,
): string {
  const parts: string[] = [
    `你是「${personaName}」，${personaDescription}。`,
    "",
    "## 你的核心特征",
    `- 标签: ${JSON.stringify(tagSpec)}`,
  ];

  if (motivationChain.M1_motivation) {
    parts.push(`- 核心动机: ${motivationChain.M1_motivation}`);
  }
  if (motivationChain.M3_perception) {
    parts.push(`- 认知框架: ${motivationChain.M3_perception}`);
  }
  if (motivationChain.M5_behavior) {
    parts.push(`- 行为模式: ${motivationChain.M5_behavior}`);
  }
  if (motivationChain.M4_emotion) {
    parts.push(`- 典型情绪: ${motivationChain.M4_emotion}`);
  }

  // 动机因果路径
  if (motivationChain.causal_paths) {
    const paths = Array.isArray(motivationChain.causal_paths)
      ? motivationChain.causal_paths
      : [motivationChain.causal_paths];
    parts.push(`- 动机因果链: ${paths.join("; ")}`);
  }

  parts.push(
    "",
    "## 规则",
    "1. 始终以第一人称回答，语气口语化，像真人在聊天。",
    "2. 回答必须符合你的角色设定，不能前后矛盾。",
    "3. 被问到不了解的事（超出你的游戏经验），就说不知道。",
    "4. 不要使用'作为一个人工智能'、'根据我的训练数据'等表述。",
    "",
    "## 你可能知道的背景信息",
    evidenceContext || "(暂无相关背景信息)",
  );

  return parts.join("\n");
}

// ---- 对话摘要压缩（防止历史消息过长）----

const MAX_HISTORY_MESSAGES = 12;
const COMPRESS_THRESHOLD = 16;

function compressHistory(
  history: Array<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
  if (history.length <= COMPRESS_THRESHOLD) {
    return history.slice(-MAX_HISTORY_MESSAGES);
  }

  const recentCount = 6;
  const olderMessages = history.slice(0, -recentCount);
  const recentMessages = history.slice(-recentCount);

  const summary = olderMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const prefix = m.role === "user" ? "Q" : "A";
      const text = (m.content ?? "").slice(0, 100);
      return `${prefix}: ${text}`;
    })
    .join("; ");

  return [
    { role: "system", content: `[对话历史摘要] ${summary}` },
    ...recentMessages,
  ];
}

// ---- 对话路由 ----

// POST /api/chat —— SSE 流式对话
chatRoute.post("/", zValidator("json", chatRequestSchema), async (c) => {
  const { personaId, sessionId, message } = c.req.valid("json");

  // 1. 获取画像（如已删除则用通用画像兜底，旧会话仍可对话）
  const persona = await db.query.personas.findFirst({
    where: eq(personas.id, personaId),
  });

  const personaName = persona?.name ?? `画像 #${personaId}`;
  const tagSpec = (persona?.tagSpec ?? {
    诉求: ["竞技证明"],
    能力: "进阶",
    风格: ["主动求战刚枪"],
    平台: "PC端",
    模式: "PVP为主",
  }) as Record<string, unknown>;
  const motivationChain = (persona?.motivationChain ?? {}) as Record<string, string>;
  const personaDescription =
    persona?.description ?? "该画像已被更新或移除，以下回答基于通用玩家设定。";

  // 2. 获取或创建会话
  let session = sessionId
    ? await db.query.chatSessions.findFirst({ where: eq(chatSessions.id, sessionId) })
    : undefined;

  if (!session) {
    const title = message.slice(0, 30);
    const [newSession] = await db
      .insert(chatSessions)
      .values({ personaId, title, messages: [] })
      .returning();
    session = newSession;
  }
  const currentSession = session!;

  // 3. RAG: pgvector 向量相似搜索（fallback 到 ILIKE）
  let evidenceRows: Array<{
    id: number;
    originalText: string;
    sourceFile: string;
  }> = [];

  try {
    const queryVec = await embedQuery(message);

    const rawRows = (await db.execute(
      sql`SELECT id, original_text, source_file
          FROM source_segments
          WHERE embedding IS NOT NULL
            AND (annotation->'meta'->>'rs' IS NULL OR annotation->'meta'->>'rs' != 'skip')
          ORDER BY embedding <=> ${JSON.stringify(queryVec)}::vector
          LIMIT 3`,
    )) as unknown as Array<{
      id: number;
      original_text: string;
      source_file: string;
    }>;

    evidenceRows = rawRows.map((r) => ({
      id: r.id,
      originalText: r.original_text,
      sourceFile: r.source_file,
    }));
  } catch (e) {
    console.error("向量检索失败，回退到 ILIKE:", e);
    evidenceRows = await db
      .select({
        id: sourceSegments.id,
        originalText: sourceSegments.originalText,
        sourceFile: sourceSegments.sourceFile,
      })
      .from(sourceSegments)
      .where(
        sql`${sourceSegments.originalText} ILIKE ${"%" + message.slice(0, 30) + "%"}`,
      )
      .limit(3);
  }

  const evidenceContext = evidenceRows
    .map((e) => `[来源: ${e.sourceFile}] ${e.originalText.slice(0, 300)}`)
    .join("\n---\n");

  // 4. 构建 System Prompt（动态生成）
  const systemPrompt = buildSystemPrompt(
    personaName,
    personaDescription,
    tagSpec,
    motivationChain,
    evidenceContext,
  );

  // 5. 构建对话历史（含摘要压缩）
  const history =
    (currentSession.messages as Array<{ role: string; content: string }>) ?? [];
  const compressedHistory = compressHistory(history);

  const llmMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...compressedHistory.map((m) => ({
      role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: message },
  ];

  // 6. 流式响应
  const evidenceIds = evidenceRows.map((e) => e.id);

  return streamSSE(c, async (stream) => {
    let fullResponse = "";

    try {
      for await (const token of chatStream(llmMessages)) {
        fullResponse += token;
        await stream.writeSSE({ data: token });
      }
    } catch (e) {
      console.error("对话引擎错误:", e);
      await stream.writeSSE({
        data: "[模拟用户暂时无法响应，请稍后重试]",
      });
    }

    // 7. 保存对话记录
    const updatedMessages = [
      ...history,
      { role: "user", content: message, timestamp: new Date().toISOString() },
      {
        role: "assistant",
        content: fullResponse,
        evidenceIds,
        timestamp: new Date().toISOString(),
      },
    ];

    await db
      .update(chatSessions)
      .set({
        messages: updatedMessages,
        updatedAt: new Date(),
      })
      .where(eq(chatSessions.id, currentSession.id));

    // 发送 evidence_ids
    await stream.writeSSE({
      data: JSON.stringify({
        type: "evidence",
        ids: evidenceIds,
        sessionId: currentSession.id,
      }),
    });
  });
});

// GET /api/chat/sessions —— 列出所有会话
chatRoute.get("/sessions", async (c) => {
  const personaId = c.req.query("personaId");
  const conditions = personaId
    ? and(eq(chatSessions.personaId, Number(personaId)))
    : undefined;

  const rows = await db
    .select()
    .from(chatSessions)
    .where(conditions)
    .orderBy(desc(chatSessions.updatedAt))
    .limit(50);

  const result: ChatSession[] = rows.map((r) => ({
    id: r.id,
    personaId: r.personaId,
    title: r.title,
    messages: (r.messages as ChatSession["messages"]) ?? [],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return c.json(result);
});

// GET /api/chat/sessions/:id —— 对话历史
chatRoute.get("/sessions/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "无效的会话 ID" }, 400);

  const session = await db.query.chatSessions.findFirst({
    where: eq(chatSessions.id, id),
  });

  if (!session) return c.json({ error: "会话不存在" }, 404);

  const result: ChatSession = {
    id: session.id,
    personaId: session.personaId,
    messages: (session.messages as ChatSession["messages"]) ?? [],
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };

  return c.json(result);
});
