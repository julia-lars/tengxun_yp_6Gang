// --------------------------------------------------------------
// Semantic Candidate Coverage Detection — Embedding 层
// V0.2 Boundary Engine Layer 5
// 判断问题"像不像数据库知识"，产出 CLEAR OUT / CANDIDATE
// --------------------------------------------------------------

import { embedQuery } from "./embed.js";

// ---- 类型定义 ----

export interface RegionVectors {
  region_id: string;
  region_name: string;
  centroid_vector: number[];
  representative_vectors: number[][];
  hard_negative_vectors: number[][];
}

export interface CandidateCoverageResult {
  candidate_zone: "CLEAR_OUT" | "CANDIDATE";
  region_score: number;
  top_region: string;
  all_region_scores: Record<string, number>;
  nearest_hard_negative_similarity: number | null;
  hn_proximity_warning: boolean;
  embedding_model: string;
  embedding_model_version: string;
}

// ---- 配置 ----

/** 默认 T_low 阈值（V0.2 初始值，后续通过 Benchmark 校准） */
const DEFAULT_T_LOW = 0.45;

/** Embedding 模型信息 */
const EMBEDDING_MODEL = "BAAI/bge-m3";
const EMBEDDING_MODEL_VERSION = "v1";

// ---- 向量运算 ----

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`向量维度不匹配: ${a.length} vs ${b.length}`);
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}

// ---- 区域向量存储（内存） ----

let regionStore: RegionVectors[] = [];

/**
 * 加载知识区域向量。在系统启动时或向量更新时调用。
 */
export function loadRegionVectors(regions: RegionVectors[]): void {
  regionStore = regions;
}

/**
 * 获取当前已加载的知识区域数量。
 */
export function getRegionCount(): number {
  return regionStore.length;
}

/**
 * 获取当前已加载的知识区域列表。
 */
export function getRegionNames(): string[] {
  return regionStore.map((r) => r.region_name);
}

// ---- 核心判定函数 ----

/**
 * 对用户问题执行 Semantic Candidate Coverage Detection。
 *
 * 返回 CLEAR_OUT（语义明确远离数据库知识）或 CANDIDATE（需要下游验证）。
 * V0.2 不再产出 CLEAR IN — Embedding 不能单独证明"可回答"。
 */
export async function detectCandidateCoverage(
  query: string,
  options?: {
    t_low?: number;
    regions?: RegionVectors[];
  },
): Promise<CandidateCoverageResult> {
  const t_low = options?.t_low ?? DEFAULT_T_LOW;
  const regions = options?.regions ?? regionStore;

  // 1. 向量化用户问题
  const queryVec = await embedQuery(query);

  // 2. 如果没有区域向量，返回 CANDIDATE（保守策略）
  if (regions.length === 0) {
    return {
      candidate_zone: "CANDIDATE",
      region_score: 0.5, // 中性值
      top_region: "unknown",
      all_region_scores: {},
      nearest_hard_negative_similarity: null,
      hn_proximity_warning: false,
      embedding_model: EMBEDDING_MODEL,
      embedding_model_version: EMBEDDING_MODEL_VERSION,
    };
  }

  // 3. 计算每个区域的 region_score
  const allScores: Record<string, number> = {};
  const allHNScores: Array<{ region: string; similarity: number }> = [];

  for (const region of regions) {
    const simToCentroid = cosineSimilarity(queryVec, region.centroid_vector);
    const simToReps = region.representative_vectors.map((v) => cosineSimilarity(queryVec, v));
    const regionScore = Math.max(simToCentroid, ...simToReps, 0);
    allScores[region.region_name] = regionScore;

    // 检查 Hard Negative 接近度
    for (const hnVec of region.hard_negative_vectors) {
      const hnSim = cosineSimilarity(queryVec, hnVec);
      allHNScores.push({ region: region.region_name, similarity: hnSim });
    }
  }

  // 4. 找到最高 region_score
  let topRegion = "unknown";
  let maxScore = 0;
  for (const [name, score] of Object.entries(allScores)) {
    if (score > maxScore) {
      maxScore = score;
      topRegion = name;
    }
  }

  // 5. Hard Negative 接近度检查
  const nearestHN = allHNScores.length > 0
    ? allHNScores.reduce((a, b) => a.similarity > b.similarity ? a : b)
    : null;
  const nearestHNSim = nearestHN?.similarity ?? null;

  // 6. hn_proximity_warning: 如果问题与某个 Hard Negative 的相似度超过了
  //    与对应区域 representatives 的最高相似度，发出警告
  let hnProximityWarning = false;
  if (nearestHN && nearestHNSim !== null && nearestHNSim > 0) {
    const regionReps = regions.find((r) => r.region_name === nearestHN.region);
    if (regionReps) {
      const maxRepSim = Math.max(
        cosineSimilarity(queryVec, regionReps.centroid_vector),
        ...regionReps.representative_vectors.map((v) => cosineSimilarity(queryVec, v)),
      );
      if (nearestHNSim !== null && nearestHNSim > maxRepSim) {
        hnProximityWarning = true;
      }
    }
  }

  // 7. 判定 zone
  const candidateZone = maxScore < t_low ? "CLEAR_OUT" : "CANDIDATE";

  return {
    candidate_zone: candidateZone,
    region_score: Math.round(maxScore * 10000) / 10000,
    top_region: topRegion,
    all_region_scores: allScores,
    nearest_hard_negative_similarity: nearestHNSim !== null
      ? Math.round(nearestHNSim * 10000) / 10000
      : null,
    hn_proximity_warning: hnProximityWarning,
    embedding_model: EMBEDDING_MODEL,
    embedding_model_version: EMBEDDING_MODEL_VERSION,
  };
}

/**
 * 同步版本的 Candidate Coverage Detection（需要预先计算好的 query vector）。
 * 用于批量评估场景。
 */
export function detectCandidateCoverageSync(
  queryVec: number[],
  regions: RegionVectors[],
  t_low: number = DEFAULT_T_LOW,
): CandidateCoverageResult {
  if (regions.length === 0) {
    return {
      candidate_zone: "CANDIDATE",
      region_score: 0.5,
      top_region: "unknown",
      all_region_scores: {},
      nearest_hard_negative_similarity: null,
      hn_proximity_warning: false,
      embedding_model: EMBEDDING_MODEL,
      embedding_model_version: EMBEDDING_MODEL_VERSION,
    };
  }

  const allScores: Record<string, number> = {};
  const allHNScores: Array<{ region: string; similarity: number }> = [];

  for (const region of regions) {
    const simToCentroid = cosineSimilarity(queryVec, region.centroid_vector);
    const simToReps = region.representative_vectors.map((v) => cosineSimilarity(queryVec, v));
    const regionScore = Math.max(simToCentroid, ...simToReps, 0);
    allScores[region.region_name] = regionScore;

    for (const hnVec of region.hard_negative_vectors) {
      allHNScores.push({
        region: region.region_name,
        similarity: cosineSimilarity(queryVec, hnVec),
      });
    }
  }

  let topRegion = "unknown";
  let maxScore = 0;
  for (const [name, score] of Object.entries(allScores)) {
    if (score > maxScore) {
      maxScore = score;
      topRegion = name;
    }
  }

  const nearestHN = allHNScores.length > 0
    ? allHNScores.reduce((a, b) => a.similarity > b.similarity ? a : b)
    : null;
  const nearestHNSim = nearestHN?.similarity ?? null;

  let hnProximityWarning = false;
  if (nearestHN && nearestHNSim !== null && nearestHNSim > 0) {
    const regionReps = regions.find((r) => r.region_name === nearestHN.region);
    if (regionReps) {
      const maxRepSim = Math.max(
        cosineSimilarity(queryVec, regionReps.centroid_vector),
        ...regionReps.representative_vectors.map((v) => cosineSimilarity(queryVec, v)),
      );
      if (nearestHNSim !== null && nearestHNSim > maxRepSim) {
        hnProximityWarning = true;
      }
    }
  }

  return {
    candidate_zone: maxScore < t_low ? "CLEAR_OUT" : "CANDIDATE",
    region_score: Math.round(maxScore * 10000) / 10000,
    top_region: topRegion,
    all_region_scores: allScores,
    nearest_hard_negative_similarity: nearestHNSim !== null
      ? Math.round(nearestHNSim * 10000) / 10000
      : null,
    hn_proximity_warning: hnProximityWarning,
    embedding_model: EMBEDDING_MODEL,
    embedding_model_version: EMBEDDING_MODEL_VERSION,
  };
}