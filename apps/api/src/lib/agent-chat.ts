// --------------------------------------------------------------
// 统一聊天引擎 — Persona / KOL 共用的对话核心逻辑
// 消除 chat.ts 和 kol.ts 中 ~80% 的重复代码
// --------------------------------------------------------------

import { sql } from "drizzle-orm";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

import { db } from "../db/client.js";
import type { ChatMessage } from "../lib/llm.js";
import { chatStream } from "../lib/llm.js";
import { embedQuery } from "../lib/embed.js";

// ---- 1. 会话获取或创建 ----

/**
 * 获取或创建会话。如果 sessionId 存在且属于当前 agent，则复用；否则新建。
 * 调用方需自行处理 session 归属校验（session.agentId !== agentId → 新建）。
 */
export async function getOrCreateSession<T extends { id: number; messages: unknown }>(opts: {
  findSession: () => Promise<T | undefined>;
  createSession: () => Promise<T>;
  message: string;
}): Promise<T> {
  let session = await opts.findSession();
  if (!session) {
    session = await opts.createSession();
  }
  return session;
}

// ---- 2. RAG 检索 ----

export interface EvidenceRow {
  id: number;
  originalText: string;
  sourceLabel: string; // persona: sourceFile, kol: title
}

/**
 * 向量检索 + ILIKE 兜底。自动处理 pgvector 查询失败时的降级。
 */
export async function searchEvidence(opts: {
  message: string;
  vectorQuery: (vecStr: string) => Promise<EvidenceRow[]>;
  ilikeQuery: () => Promise<EvidenceRow[]>;
}): Promise<EvidenceRow[]> {
  try {
    const queryVec = await embedQuery(opts.message);
    const vecStr = JSON.stringify(queryVec);
    const rows = await opts.vectorQuery(vecStr);
    if (rows.length > 0) return rows;
  } catch (e) {
    console.error("向量检索失败，回退到 ILIKE:", e);
  }
  // ILIKE 兜底
  try {
    return await opts.ilikeQuery();
  } catch (e) {
    console.error("ILIKE 检索也失败:", e);
    return [];
  }
}

// ---- 3. 通用 SSE 流式对话 ----

/**
 * 执行 SSE 流式对话：打字机输出 → 保存消息 → 发送 evidence 事件。
 * 调用方负责构建 systemPrompt 和 llmMessages。
 */
export async function streamChat(opts: {
  c: Context;
  llmMessages: ChatMessage[];
  sessionId: number;
  evidenceIds: number[];
  history: Array<{ role: string; content: string }>;
  userMessage: string;
  saveMessages: (updatedMessages: Array<Record<string, unknown>>) => Promise<void>;
  errorMessage?: string;
}): Promise<Response> {
  const { c, llmMessages, sessionId, evidenceIds, history, userMessage, saveMessages } = opts;

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
        data: opts.errorMessage ?? "[暂时无法响应，请稍后重试]",
      });
    }

    // 保存对话记录
    const updatedMessages = [
      ...history,
      { role: "user", content: userMessage, timestamp: new Date().toISOString() },
      {
        role: "assistant",
        content: fullResponse,
        evidenceIds,
        timestamp: new Date().toISOString(),
      },
    ];

    await saveMessages(updatedMessages);

    // 发送 evidence + sessionId
    try {
      await stream.writeSSE({
        data: JSON.stringify({
          type: "evidence",
          ids: evidenceIds,
          sessionId,
        }),
      });
    } catch {
      // 客户端已断开连接，正常情况
    }
  });
}

// ---- 4. 历史消息压缩 ----

/**
 * 简单截断：保留最近 N 条，更早的合并为摘要
 */
export function compressHistory(
  history: Array<{ role: string; content: string }>,
  maxRecent: number = 6,
  threshold: number = 16,
): Array<{ role: string; content: string }> {
  if (history.length <= threshold) {
    return history.slice(-maxRecent * 2);
  }

  const recentMessages = history.slice(-maxRecent);
  const olderMessages = history.slice(0, -maxRecent);

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

// ---- 5. 格式化 evidence 上下文 ----

export function formatEvidenceContext(
  rows: EvidenceRow[],
  prefix: (row: EvidenceRow) => string,
): string {
  return rows
    .map((e) => `${prefix(e)} ${e.originalText.slice(0, 300)}`)
    .join("\n---\n");
}