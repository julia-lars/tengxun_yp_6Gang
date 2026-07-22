// --------------------------------------------------------------
// LLM SDK 统一封装
// 所有 AI 功能模块调这个，不直接调模型 API。
// 支持 DeepSeek / GLM / MiniMax 切换，内置重试和流式。
// --------------------------------------------------------------

export type ModelName = "deepseek" | "glm" | "minimax";

export interface ChatOptions {
  model?: ModelName;
  temperature?: number;
  maxTokens?: number;
}

export interface EmbedOptions {
  model?: string;
}

const MODEL_CONFIG: Record<ModelName, { baseUrl: string; apiKey: string; defaultModel: string }> = {
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: process.env.DEEPSEEK_API_KEY ?? "",
    defaultModel: "deepseek-chat",
  },
  glm: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKey: process.env.GLM_API_KEY ?? "",
    defaultModel: "glm-4-flash",
  },
  minimax: {
    baseUrl: "https://api.minimaxi.com/v1",
    apiKey: process.env.MINIMAX_API_KEY ?? "",
    defaultModel: "abab6.5s-chat",
  },
};

const DEFAULT_MODEL: ModelName = (process.env.LLM_MODEL as ModelName) ?? "deepseek";

function getConfig(model?: ModelName) {
  const m = model ?? DEFAULT_MODEL;
  return MODEL_CONFIG[m];
}

async function apiFetch(
  path: string,
  body: Record<string, unknown>,
  model?: ModelName,
): Promise<Response> {
  const cfg = getConfig(model);
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
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

// ---- 普通对话 ----

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  const cfg = getConfig(options.model);
  return withRetry(async () => {
    const res = await apiFetch("/chat/completions", {
      model: cfg.defaultModel,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
      stream: false,
    }, options.model);
    const data = await res.json() as { choices: [{ message: { content: string } }] };
    return data.choices[0].message.content;
  });
}

// ---- 流式对话 ----

export async function* chatStream(
  messages: ChatMessage[],
  options: ChatOptions = {},
): AsyncGenerator<string> {
  const cfg = getConfig(options.model);
  const res = await withRetry(async () =>
    apiFetch("/chat/completions", {
      model: cfg.defaultModel,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
      stream: true,
    }, options.model),
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
      const content = line.slice(6);
      if (content === "[DONE]") return;

      try {
        const parsed = JSON.parse(content) as {
          choices: [{ delta: { content?: string } }];
        };
        const token = parsed.choices?.[0]?.delta?.content;
        if (token) yield token;
      } catch {
        // skip malformed chunks
      }
    }
  }
}

// ---- 文本向量化 ----

export async function embed(text: string, model?: string): Promise<number[]> {
  const cfg = getConfig(DEFAULT_MODEL);
  const embedModel = model ?? "text-embedding-3-small";

  return withRetry(async () => {
    const res = await apiFetch("/embeddings", {
      model: embedModel,
      input: text,
    }, DEFAULT_MODEL);
    const data = await res.json() as { data: [{ embedding: number[] }] };
    return data.data[0].embedding;
  });
}
