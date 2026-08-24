// --------------------------------------------------------------
// BGE 向量化服务（Python 微服务，本地端口 8765）
// 统一封装查询向量化，避免 chat / kol / pipeline 各自硬编码地址
// --------------------------------------------------------------

export const EMBED_SERVER_URL = "http://127.0.0.1:8765/embed";

export async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch(EMBED_SERVER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Embed server ${res.status}`);
  const data = (await res.json()) as { embedding: number[] };
  return data.embedding;
}
