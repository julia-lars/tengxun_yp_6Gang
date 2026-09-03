// --------------------------------------------------------------
// 混合检索 — 向量检索 + BM25 关键词检索 RRF 融合
// 将 searchEvidence 从纯向量检索升级为混合检索
// --------------------------------------------------------------

import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { embedQuery } from "../lib/embed.js";
import type { EvidenceRow } from "../lib/agent-chat.js";
import { rerankEvidence } from "../lib/reranker.js";
import { filterNoiseRows } from "../lib/agent-chat.js";

/**
 * RRF (Reciprocal Rank Fusion) 融合参数
 * k=60 是标准推荐值，适合混合检索场景
 */
const RRF_K = 60;

/**
 * 向量检索的 Top N（粗排）
 * 提高候选数，给 reranker 更多筛选空间
 */
const VECTOR_TOP_N = 50;

/**
 * BM25 关键词检索的 Top N（粗排）
 */
const BM25_TOP_N = 30;

/**
 * 向量相似度阈值（cosine distance）
 * 收紧到 0.45（即 cosine similarity > 0.55），减少与查询无关的噪音片段
 */
const SIMILARITY_THRESHOLD = 0.45;

/**
 * 混合检索结果
 */
export interface HybridSearchResult extends EvidenceRow {
  /** RRF 融合分数 */
  rrfScore?: number;
}

/**
 * 向量检索：使用 pgvector 余弦距离
 */
async function vectorSearch(
  vecStr: string,
  tableName: "source_segments" | "kol_segments",
  kolId?: number,
): Promise<EvidenceRow[]> {
  const tableRef = tableName === "source_segments"
    ? sql`source_segments`
    : sql`kol_segments`;

  const kolFilter = kolId !== undefined
    ? sql`AND kol_id = ${kolId}`
    : sql``;

  const adFilter = tableName === "kol_segments"
    ? sql`AND (ad_label IS NULL OR ad_label != '广告口播')`
    : sql``;

  const skipFilter = tableName === "source_segments"
    ? sql`AND (annotation->'meta'->>'rs' IS NULL OR annotation->'meta'->>'rs' != 'skip')
          AND (cleaning_status IS NULL OR cleaning_status NOT IN ('removed_noise', 'removed_flow', 'removed_duplicate', 'removed_irrelevant'))`
    : sql``;

  const rows = (await db.execute(
    sql`SELECT id, original_text,
               ${tableName === "source_segments" ? sql`source_file AS source_label` : sql`title AS source_label`},
               embedding <=> ${vecStr}::vector AS distance,
               ${tableName === "source_segments" ? sql`annotation, speaker_id, preceding_question` : sql`NULL AS annotation, NULL AS speaker_id, NULL AS preceding_question`}
        FROM ${tableRef}
        WHERE embedding IS NOT NULL
          ${skipFilter}
          ${kolFilter}
          ${adFilter}
          AND embedding <=> ${vecStr}::vector < ${SIMILARITY_THRESHOLD}
        ORDER BY embedding <=> ${vecStr}::vector
        LIMIT ${VECTOR_TOP_N}`,
  )) as unknown as Array<{
    id: number;
    original_text: string;
    source_label: string;
    distance: number;
    annotation: Record<string, unknown> | null;
    speaker_id: string | null;
    preceding_question: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    originalText: r.original_text,
    sourceLabel: r.source_label,
    similarity: 1 - (r.distance ?? 0),
    annotation: r.annotation,
    speakerId: r.speaker_id ?? undefined,
    precedingQuestion: r.preceding_question ?? undefined,
  }));
}

/**
 * BM25 关键词检索：使用 PostgreSQL 全文检索
 * 中文使用 simple 分词（按空格/标点切分），后续可升级为 zhparser
 */
async function bm25Search(
  message: string,
  tableName: "source_segments" | "kol_segments",
  kolId?: number,
): Promise<EvidenceRow[]> {
  const tableRef = tableName === "source_segments"
    ? sql`source_segments`
    : sql`kol_segments`;

  const kolFilter = kolId !== undefined
    ? sql`AND kol_id = ${kolId}`
    : sql``;

  const adFilter = tableName === "kol_segments"
    ? sql`AND (ad_label IS NULL OR ad_label != '广告口播')`
    : sql``;

  const skipFilter = tableName === "source_segments"
    ? sql`AND (annotation->'meta'->>'rs' IS NULL OR annotation->'meta'->>'rs' != 'skip')
          AND (cleaning_status IS NULL OR cleaning_status NOT IN ('removed_noise', 'removed_flow', 'removed_duplicate', 'removed_irrelevant'))`
    : sql``;

  // 使用 simple 分词：将查询文本按非字母数字字符切分，每个词变成 OR 连接的 tsquery
  const tokens = message
    .replace(/[^\w一-鿿]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 20); // 最多 20 个关键词

  if (tokens.length === 0) return [];

  const tsquery = tokens.map((t) => `${t}:*`).join(" | ");

  const rows = (await db.execute(
    sql`SELECT id, original_text,
               ${tableName === "source_segments" ? sql`source_file AS source_label` : sql`title AS source_label`},
               ts_rank(to_tsvector('simple', original_text), to_tsquery('simple', ${tsquery})) AS rank,
               ${tableName === "source_segments" ? sql`annotation, speaker_id, preceding_question` : sql`NULL AS annotation, NULL AS speaker_id, NULL AS preceding_question`}
        FROM ${tableRef}
        WHERE to_tsvector('simple', original_text) @@ to_tsquery('simple', ${tsquery})
          ${skipFilter}
          ${kolFilter}
          ${adFilter}
        ORDER BY rank DESC
        LIMIT ${BM25_TOP_N}`,
  )) as unknown as Array<{
    id: number;
    original_text: string;
    source_label: string;
    rank: number;
    annotation: Record<string, unknown> | null;
    speaker_id: string | null;
    preceding_question: string | null;
  }>;

  // 将 ts_rank 归一化到 0-1 区间（ts_rank 通常 0-1，但可能超 1）
  const maxRank = rows.length > 0 ? Math.max(...rows.map((r) => r.rank)) : 1;
  return rows.map((r) => ({
    id: r.id,
    originalText: r.original_text,
    sourceLabel: r.source_label,
    similarity: maxRank > 0 ? r.rank / maxRank : 0,
    annotation: r.annotation,
    speakerId: r.speaker_id ?? undefined,
    precedingQuestion: r.preceding_question ?? undefined,
  }));
}

/**
 * RRF 融合：将向量检索和 BM25 检索结果按排名融合
 * score = SUM(1 / (k + rank_i))
 */
function rrfFusion(
  vectorResults: EvidenceRow[],
  bm25Results: EvidenceRow[],
): HybridSearchResult[] {
  const scoreMap = new Map<number, { row: EvidenceRow; rrfScore: number }>();

  // 向量检索分数
  vectorResults.forEach((row, rank) => {
    scoreMap.set(row.id, {
      row,
      rrfScore: 1 / (RRF_K + rank + 1),
    });
  });

  // BM25 检索分数（累加）
  bm25Results.forEach((row, rank) => {
    const existing = scoreMap.get(row.id);
    const rrfContribution = 1 / (RRF_K + rank + 1);
    if (existing) {
      existing.rrfScore += rrfContribution;
    } else {
      scoreMap.set(row.id, {
        row,
        rrfScore: rrfContribution,
      });
    }
  });

  // 按 RRF 分数降序排列
  return Array.from(scoreMap.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .map((item) => ({
      ...item.row,
      rrfScore: item.rrfScore,
    }));
}

/**
 * 混合检索入口：向量 + BM25 RRF 融合
 * 返回融合后的排序结果，最多 15 条
 */
export async function hybridSearch(opts: {
  message: string;
  tableName: "source_segments" | "kol_segments";
  kolId?: number;
}): Promise<HybridSearchResult[]> {
  const { message, tableName, kolId } = opts;

  // 向量化查询
  let vecStr: string;
  try {
    const queryVec = await embedQuery(message, "query");
    vecStr = JSON.stringify(queryVec);
  } catch (e) {
    console.error("混合检索：向量化失败，降级为纯 BM25:", e);
    const bm25Results = await bm25Search(message, tableName, kolId);
    return bm25Results.map((r) => ({ ...r, rrfScore: undefined }));
  }

  // 并行执行向量检索和 BM25 检索
  const [vectorResults, bm25Results] = await Promise.all([
    vectorSearch(vecStr, tableName, kolId).catch((e) => {
      console.error("向量检索失败:", e);
      return [] as EvidenceRow[];
    }),
    bm25Search(message, tableName, kolId).catch((e) => {
      console.error("BM25 检索失败:", e);
      return [] as EvidenceRow[];
    }),
  ]);

  // 向量检索无结果时兜底
  let finalVectorResults = vectorResults;
  if (finalVectorResults.length === 0 && tableName === "source_segments") {
    // 重新查询不加阈值
    try {
      const rows = (await db.execute(
        sql`SELECT id, original_text, source_file AS source_label,
                   embedding <=> ${vecStr}::vector AS distance,
                   annotation, speaker_id, preceding_question
            FROM source_segments
            WHERE embedding IS NOT NULL
              AND (annotation->'meta'->>'rs' IS NULL OR annotation->'meta'->>'rs' != 'skip')
              AND (cleaning_status IS NULL OR cleaning_status NOT IN ('removed_noise', 'removed_flow', 'removed_duplicate', 'removed_irrelevant'))
            ORDER BY embedding <=> ${vecStr}::vector
            LIMIT ${VECTOR_TOP_N}`,
      )) as unknown as Array<{
        id: number;
        original_text: string;
        source_label: string;
        distance: number;
        annotation: Record<string, unknown> | null;
        speaker_id: string | null;
        preceding_question: string | null;
      }>;
      finalVectorResults = rows.map((r) => ({
        id: r.id,
        originalText: r.original_text,
        sourceLabel: r.source_label,
        similarity: 1 - (r.distance ?? 0),
        annotation: r.annotation,
        speakerId: r.speaker_id ?? undefined,
        precedingQuestion: r.preceding_question ?? undefined,
      }));
    } catch (e) {
      console.error("向量检索兜底也失败:", e);
    }
  }

  // RRF 融合
  const fused = rrfFusion(finalVectorResults, bm25Results);

  // Cross-Encoder 重排序（精排 Top 20，给 reranker 更多候选）
  const reranked = await rerankEvidence(message, fused, 20);

  // 噪音过滤：排除不含游戏信息的短片段和单字噪音
  return filterNoiseRows(reranked).slice(0, 15);
}

/**
 * 简化版混合检索（兼容现有 searchEvidence 接口）
 * 向后兼容：如果混合检索失败，降级为 ILIKE 兜底
 */
export async function hybridSearchWithFallback(opts: {
  message: string;
  tableName: "source_segments" | "kol_segments";
  kolId?: number;
  ilikeQuery: () => Promise<EvidenceRow[]>;
}): Promise<EvidenceRow[]> {
  try {
    const results = await hybridSearch({
      message: opts.message,
      tableName: opts.tableName,
      kolId: opts.kolId,
    });

    if (results.length > 0) return results;

    // 混合检索无结果，降级为 ILIKE
    return await opts.ilikeQuery();
  } catch (e) {
    console.error("混合检索失败，降级到 ILIKE:", e);
    try {
      return await opts.ilikeQuery();
    } catch (e2) {
      console.error("ILIKE 检索也失败:", e2);
      return [];
    }
  }
}