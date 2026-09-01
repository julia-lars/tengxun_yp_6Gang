// --------------------------------------------------------------
// Cross-Encoder 重排序客户端
// 调用 Python rerank_server.py 微服务（端口 8766）
// 对混合检索结果进行精排，取 Top-N
// --------------------------------------------------------------

export const RERANK_SERVER_URL = "http://127.0.0.1:8766/rerank";

export interface RerankResult {
  /** 文档在原始列表中的索引 */
  index: number;
  /** 重排序分数 */
  score: number;
  /** 文档文本 */
  document: string;
}

/**
 * 对混合检索结果进行重排序。
 * 返回按分数降序排列的结果，附带原始索引。
 */
export async function rerank(query: string, documents: string[]): Promise<RerankResult[]> {
  if (documents.length === 0) return [];

  try {
    const res = await fetch(RERANK_SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, documents }),
    });

    if (!res.ok) {
      console.error(`Rerank server ${res.status}, 降级使用原始顺序`);
      return documents.map((doc, i) => ({ index: i, score: 0, document: doc }));
    }

    const data = (await res.json()) as { scores: number[] };
    return data.scores
      .map((score, i) => ({ index: i, score, document: documents[i]! }))
      .sort((a, b) => b.score - a.score);
  } catch (e) {
    console.error("重排序服务不可用，降级使用原始顺序:", e);
    return documents.map((doc, i) => ({ index: i, score: 0, document: doc }));
  }
}

/**
 * 对证据行进行重排序，返回重排后的证据列表（Top N）。
 * 如果重排序服务不可用，返回原始顺序。
 * 精排分数会覆盖 similarity 字段，使前端展示的"匹配度"反映 Cross-Encoder 的语义相关性而非向量相似度。
 */
export async function rerankEvidence<T extends { id: number; originalText: string; similarity?: number; matchLevel?: string }>(
  query: string,
  rows: T[],
  topN: number = 10,
): Promise<T[]> {
  if (rows.length === 0) return rows;

  const documents = rows.map((r) => r.originalText);
  const results = await rerank(query, documents);

  // 按重排序分数排序，取 Top N，并用精排分数覆盖 similarity 和 matchLevel
  return results
    .slice(0, topN)
    .map((r) => {
      const row = { ...rows[r.index]! };
      // Cross-Encoder 原始输出是 logit（可能负值或大于1），sigmoid 归一化到 0-1
      const score = 1 / (1 + Math.exp(-r.score));
      row.similarity = Math.round(score * 100) / 100;
      // 根据精排分数重新判定证据等级
      if (score >= 0.75) row.matchLevel = "direct";
      else if (score >= 0.5) row.matchLevel = "partial";
      else row.matchLevel = "inferred";
      return row;
    });
}