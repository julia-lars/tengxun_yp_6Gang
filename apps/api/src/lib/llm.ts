// llm.ts - LLM SDK (Anthropic-compatible via TokenHub / 腾讯 MaaS)
import "dotenv/config";

export type ModelName = "deepseek" | "glm" | "minimax";

export interface ChatOptions {
  model?: ModelName;
  temperature?: number;
  maxTokens?: number;
}

const MODEL_CONFIG: Record<ModelName, { baseUrl: string; apiKey: string; defaultModel: string; supportsThinking: boolean }> = {
  deepseek: {
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
    apiKey: process.env.DEEPSEEK_API_KEY ?? "",
    defaultModel: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    supportsThinking: true,
  },
  glm: {
    baseUrl: process.env.GLM_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4",
    apiKey: process.env.GLM_API_KEY ?? "",
    defaultModel: process.env.GLM_MODEL ?? "glm-4-flash",
    supportsThinking: false,
  },
  minimax: {
    baseUrl: process.env.MINIMAX_BASE_URL ?? "https://api.minimaxi.com/v1",
    apiKey: process.env.MINIMAX_API_KEY ?? "",
    defaultModel: process.env.MINIMAX_MODEL ?? "abab6.5s-chat",
    supportsThinking: false,
  },
};

const DEFAULT_MODEL: ModelName = (process.env.LLM_MODEL as ModelName) ?? "deepseek";

function getConfig(model?: ModelName) {
  const m = model ?? DEFAULT_MODEL;
  return MODEL_CONFIG[m];
}

// ---- Anthropic-compatible API fetch ----

async function anthropicFetch(
  path: string,
  body: Record<string, unknown>,
  model?: ModelName,
): Promise<Response> {
  const cfg = getConfig(model);
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
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
    // Extract system prompt (Anthropic API puts it as top-level field)
    const systemMsg = messages.find((m) => m.role === "system");
    const chatMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    const body: Record<string, unknown> = {
      model: cfg.defaultModel,
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

    const res = await anthropicFetch("/v1/messages", body, options.model);
    const data = (await res.json()) as {
      content: Array<{ type: string; text: string }>;
    };
    // Extract text from content blocks
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

  // Extract system prompt (Anthropic API puts it as top-level field)
  const systemMsg = messages.find((m) => m.role === "system");
  const chatMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const body: Record<string, unknown> = {
    model: cfg.defaultModel,
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

  const res = await withRetry(async () =>
    anthropicFetch("/v1/messages", body, options.model),
  );

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

        // Anthropic streaming format:
        // content_block_delta: { type: "content_block_delta", delta: { type: "text_delta", text: "..." } }
        if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
          if (parsed.delta.text) yield parsed.delta.text;
        }
        // content_block_stop - end of a content block, ignore
        // message_delta with stop_reason - end of message
        if (parsed.type === "message_stop") return;
      } catch {
        // skip malformed chunks
      }
    }
  }
}