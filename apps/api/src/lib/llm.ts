// llm.ts - LLM SDK（统一走腾讯云 TokenHub Anthropic 兼容网关）
import "dotenv/config";
import type { ModelVariant } from "@app/shared";

export type { ModelVariant } from "@app/shared";

export type ModelName = "deepseek" | "glm" | "minimax" | "kimi";

export interface ChatOptions {
  model?: ModelVariant;
  temperature?: number;
  maxTokens?: number;
}

// TokenHub 网关统一入口（所有模型共用）
const GATEWAY_BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1";
const GATEWAY_API_KEY = process.env.DEEPSEEK_API_KEY ?? "";

// 各提供商特有配置（只需覆盖 baseUrl / apiKey 时设置）
const PROVIDER_CONFIG: Record<ModelName, { supportsThinking: boolean }> = {
  deepseek: { supportsThinking: true },
  glm: { supportsThinking: false },
  minimax: { supportsThinking: false },
  kimi: { supportsThinking: false },
};

// 模型变体 → 提供商 + 具体模型 ID（发给 TokenHub 的 model 字段）
const VARIANT_CONFIG: Record<ModelVariant, { provider: ModelName; modelId: string }> = {
  "deepseek-v4-pro": { provider: "deepseek", modelId: "deepseek-v4-pro" },
  "deepseek-v4-flash": { provider: "deepseek", modelId: "deepseek-v4-flash" },
  "glm-5.2": { provider: "glm", modelId: "glm-5.2" },
  "glm-5-turbo": { provider: "glm", modelId: "glm-5-turbo" },
  "minimax-m3": { provider: "minimax", modelId: "minimax-m3" },
  "kimi-k2.7-code": { provider: "kimi", modelId: "kimi-k2.7-code" },
  "kimi-k2.7-code-highspeed": { provider: "kimi", modelId: "kimi-k2.7-code-highspeed" },
};

const DEFAULT_VARIANT: ModelVariant = (process.env.LLM_MODEL as ModelVariant) ?? "deepseek-v4-pro";

function getConfig(variant?: ModelVariant) {
  const v = variant ?? DEFAULT_VARIANT;
  const vc = VARIANT_CONFIG[v];
  if (!vc) {
    const fallback = VARIANT_CONFIG[DEFAULT_VARIANT];
    return { modelId: fallback.modelId, supportsThinking: PROVIDER_CONFIG[fallback.provider].supportsThinking };
  }
  return { modelId: vc.modelId, supportsThinking: PROVIDER_CONFIG[vc.provider].supportsThinking };
}

// ---- Anthropic-compatible API fetch（统一走 TokenHub 网关）----

async function apiFetch(
  path: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const res = await fetch(`${GATEWAY_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": GATEWAY_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM API ${res.status}: ${text.slice(0, 500)}`);
  }
  return res;
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw new Error("unreachable");
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ---- Non-streaming chat ----

export async function chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
  const cfg = getConfig(options.model);

  return withRetry(async () => {
    const systemMsg = messages.find((m) => m.role === "system");
    const chatMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    const body: Record<string, unknown> = {
      model: cfg.modelId,
      messages: chatMessages,
      max_tokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.7,
    };
    if (cfg.supportsThinking) {
      body.thinking = { type: "disabled" };
    }
    if (systemMsg) {
      body.system = systemMsg.content;
    }

    const res = await apiFetch("/v1/messages", body);
    const data = (await res.json()) as {
      content: Array<{ type: string; text: string }>;
    };
    const textBlocks = data.content.filter((c) => c.type === "text");
    return textBlocks.map((c) => c.text).join("");
  });
}

// ---- Streaming chat (SSE) ----

export async function* chatStream(
  messages: ChatMessage[],
  options: ChatOptions = {},
): AsyncGenerator<string> {
  const cfg = getConfig(options.model);

  const systemMsg = messages.find((m) => m.role === "system");
  const chatMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const body: Record<string, unknown> = {
    model: cfg.modelId,
    messages: chatMessages,
    max_tokens: options.maxTokens ?? 2048,
    temperature: options.temperature ?? 0.7,
    stream: true,
  };
  if (cfg.supportsThinking) {
    body.thinking = { type: "disabled" };
  }
  if (systemMsg) {
    body.system = systemMsg.content;
  }

  const res = await withRetry(async () => apiFetch("/v1/messages", body));

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const content = line.slice(6).trim();
      if (!content) continue;

      try {
        const parsed = JSON.parse(content) as {
          type: string;
          delta?: { type: string; text: string };
          content_block?: { type: string; text: string };
        };
        if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
          if (parsed.delta.text) yield parsed.delta.text;
        }
        if (parsed.type === "message_stop") return;
      } catch {
        // skip malformed chunks
      }
    }
  }
}