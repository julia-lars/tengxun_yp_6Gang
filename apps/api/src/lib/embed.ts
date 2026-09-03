// --------------------------------------------------------------
// BGE 向量化服务（Python 微服务，本地端口 8765）
// 统一封装查询向量化，避免 chat / kol / pipeline 各自硬编码地址
// --------------------------------------------------------------

export const EMBED_SERVER_URL = "http://127.0.0.1:8765/embed";

/**
 * 向量化文本。
 * @param text 输入文本
 * @param mode "query" 用于用户查询（会加 BGE-M3 检索指令前缀），"document" 用于文档索引
 */
export async function embedQuery(text: string, mode: "query" | "document" = "document"): Promise<number[]> {
  const res = await fetch(EMBED_SERVER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, mode }),
  });
  if (!res.ok) throw new Error(`Embed server ${res.status}`);
  const data = (await res.json()) as { embedding: number[] };
  return data.embedding;
}
