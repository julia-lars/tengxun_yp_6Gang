// --------------------------------------------------------------
// 统一聊天引擎 — Persona / KOL 共用的对话核心逻辑
// 消除 chat.ts 和 kol.ts 中 ~80% 的重复代码
// --------------------------------------------------------------

import { sql } from "drizzle-orm";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

import { db } from "../db/client.js";
import type { ChatMessage } from "../lib/llm.js";
import { chat, chatStream } from "../lib/llm.js";
import { embedQuery } from "../lib/embed.js";
import type { ConfidenceResult, EvidenceMeta } from "@app/shared";
import { classifyMatchLevel } from "../lib/confidence.js";

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
  /** 向量余弦相似度 (0-1)，仅向量检索时有值 */
  similarity?: number;
  /** 证据等级：直引 / 部分关联 / 推断 */
  matchLevel?: "direct" | "partial" | "inferred";
  /** 证据标签与画像标签的重叠度 (0-1) */
  tagOverlap?: number;
  /** 受访者匿名 ID */
  speakerId?: string;
  /** 冰山+框架标注 */
  annotation?: Record<string, unknown> | null;
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
 * 执行 SSE 流式对话：打字机输出 → 保存消息 → 发送 meta 事件。
 * 调用方负责构建 systemPrompt 和 llmMessages。
 */
export async function streamChat(opts: {
  c: Context;
  llmMessages: ChatMessage[];
  sessionId: number;
  evidenceIds: number[];
  /** RAG 检索到的完整证据数据（含原文），通过 SSE 传给前端渲染 */
  evidenceData?: EvidenceRow[];
  history: Array<{ role: string; content: string }>;
  userMessage: string;
  saveMessages: (updatedMessages: Array<Record<string, unknown>>) => Promise<void>;
  errorMessage?: string;
  /** 置信度计算结果（调用方在 RAG 检索后计算） */
  confidence?: ConfidenceResult;
  /** 证据元数据列表 */
  evidenceMeta?: EvidenceMeta[];
  /** 首轮对话完成后自动生成标题的回调 */
  updateTitle?: (title: string) => Promise<void>;
}): Promise<Response> {
  const {
    c,
    llmMessages,
    sessionId,
    evidenceIds,
    evidenceData,
    history,
    userMessage,
    saveMessages,
    confidence,
    evidenceMeta,
    updateTitle,
  } = opts;

  return streamSSE(c, async (stream) => {
    let fullResponse = "";

    try {
      for await (const token of chatStream(llmMessages)) {
        fullResponse += token;
        await stream.writeSSE({ data: token });
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error("对话引擎错误:", errMsg);
      // 发送错误事件，让前端弹出提示
      try {
        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            message: errMsg.includes("401") ? "API Key 认证失败，请检查 Key 是否有效" : "LLM 服务异常，请稍后重试",
          }),
        });
      } catch {
        // 客户端已断开连接
      }
      await stream.writeSSE({
        data: opts.errorMessage ?? "[暂时无法响应，请稍后重试]",
      });
    }

    // 构建 SSE 传输的完整证据数据
    const evidencePayload = (evidenceData ?? []).map((e) => ({
      id: e.id,
      sourceFile: e.sourceLabel,
      originalText: e.originalText,
      annotation: e.annotation ?? null,
      similarity: e.similarity ?? 0,
      matchLevel: e.matchLevel ?? classifyMatchLevel(e.similarity ?? 0),
      tagOverlap: e.tagOverlap ?? 0,
      speakerId: e.speakerId ?? null,
    }));

    // 保存对话记录（含置信度和证据元数据 + 完整证据内容）
    const updatedMessages = [
      ...history,
      { role: "user", content: userMessage, timestamp: new Date().toISOString() },
      {
        role: "assistant",
        content: fullResponse,
        evidenceIds,
        evidenceMeta: evidenceMeta ?? [],
        evidence: evidencePayload,
        confidence: confidence ?? null,
        timestamp: new Date().toISOString(),
      },
    ];

    await saveMessages(updatedMessages);

    // 首轮对话完成后自动生成标题
    let generatedTitle: string | undefined;
    if (updateTitle && history.length === 0 && fullResponse) {
      try {
        generatedTitle = await generateTitle(userMessage, fullResponse);
        await updateTitle(generatedTitle);
      } catch (e) {
        console.error("标题生成失败，使用默认标题:", e);
      }
    }

    // 发送 meta 事件：evidence + sessionId + confidence + evidenceMeta + title + 完整证据数据
    try {
      await stream.writeSSE({
        data: JSON.stringify({
          type: "meta",
          ids: evidenceIds,
          sessionId,
          confidence,
          evidenceMeta: evidenceMeta ?? [],
          evidence: evidencePayload,
          ...(generatedTitle ? { title: generatedTitle } : {}),
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

// ---- 6. 对话标题生成 ----

/**
 * 根据首轮对话内容自动生成简短标题（≤20字）。
 */
export async function generateTitle(userMessage: string, aiResponse: string): Promise<string> {
  const prompt = [
    "根据以下对话内容，生成一个简短的对话标题。",
    "要求：不超过20个字，直接返回标题文本，不要加引号、不要加句号、不要加任何前缀说明。",
    "",
    `用户：${userMessage.slice(0, 200)}`,
    `AI：${aiResponse.slice(0, 500)}`,
  ].join("\n");

  const result = await chat(
    [{ role: "user", content: prompt }],
    { temperature: 0.3, maxTokens: 64 },
  );

  return result.trim().slice(0, 30);
}