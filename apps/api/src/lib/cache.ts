// --------------------------------------------------------------
// 双层 Cache — Exact Query Cache + Canonical Cache
// V0.2 Boundary Engine Layer 1 & 3
// --------------------------------------------------------------

import type { CanonicalQuery, AnswerabilitySignature } from "./normalization.js";
import { computeAnswerabilitySignature, signatureToString } from "./normalization.js";

// ---- 缓存条目类型 ----

export interface BoundaryResult {
  final: "IN" | "OUT";
  method: "exact_cache" | "canonical_cache" | "hard_rule" | "embedding_clear_out" | "matrix_out" | "llm_judge";
  // 四维度判定
  B1_domain: "IN" | "OUT";
  B2_topic_coverage: "IN" | "OUT";
  B3_question_type_capability: "IN" | "OUT";
  B4_evidence_sufficiency: "IN" | "OUT";
  // Embedding 信息
  embedding?: {
    top_region: string;
    region_score: number;
    candidate_zone: "CLEAR_OUT" | "CANDIDATE";
    hn_proximity_warning: boolean;
  };
  // Matrix 信息
  coverage_check?: {
    matched_region: string;
    matched_intent: string;
    matrix_result: "MATRIX_IN" | "MATRIX_OUT" | "MATRIX_TBD";
  };
  // 版本信息
  boundary_version: string;
  threshold_version: string;
  knowledge_space_version: string;
  timestamp: string;
  latency_ms: number;
}

interface ExactCacheEntry {
  cache_key: string;
  original_query: string;
  boundary_result: BoundaryResult;
  hit_count: number;
  created_at: string;
  last_hit_at: string;
}

interface CanonicalCacheEntry {
  cache_key: string;
  canonical_query: CanonicalQuery;
  answerability_signature: string;
  original_queries: string[];
  boundary_result: BoundaryResult;
  hit_count: number;
  created_at: string;
  last_hit_at: string;
}

// ---- 简易 Hash 函数 ----

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

// ---- 内存缓存存储 ----

// V0.2 使用内存缓存（后续可替换为持久化缓存）
const exactCache = new Map<string, ExactCacheEntry>();
const canonicalCache = new Map<string, CanonicalCacheEntry>();

// 缓存统计
const cacheStats = {
  exact_hits: 0,
  exact_misses: 0,
  canonical_hits: 0,
  canonical_misses: 0,
  signature_mismatches: 0,
};

// ---- 缓存版本配置 ----

const BOUNDARY_VERSION = "v0.2";
const THRESHOLD_VERSION = "v0.2-initial";
const KNOWLEDGE_SPACE_VERSION = "v0.2";

// ---- Layer 1: Exact Query Cache ----

export function exactCacheKey(rawQuery: string): string {
  return simpleHash(rawQuery.trim().toLowerCase());
}

export function lookupExactCache(rawQuery: string): BoundaryResult | null {
  const key = exactCacheKey(rawQuery);
  const entry = exactCache.get(key);
  if (entry) {
    entry.hit_count++;
    entry.last_hit_at = new Date().toISOString();
    cacheStats.exact_hits++;
    return entry.boundary_result;
  }
  cacheStats.exact_misses++;
  return null;
}

export function storeExactCache(rawQuery: string, result: BoundaryResult): void {
  const key = exactCacheKey(rawQuery);
  exactCache.set(key, {
    cache_key: key,
    original_query: rawQuery.trim(),
    boundary_result: result,
    hit_count: 1,
    created_at: new Date().toISOString(),
    last_hit_at: new Date().toISOString(),
  });
}

// ---- Layer 2: Canonical Cache ----

export function canonicalCacheKey(canonical: CanonicalQuery): string {
  return simpleHash(JSON.stringify(canonical));
}

/**
 * 查找 Canonical Cache。
 * 命中后执行 answerability_signature 校验（V0.2 C3）。
 */
export function lookupCanonicalCache(
  canonical: CanonicalQuery,
  rawQuery: string,
): BoundaryResult | null {
  const key = canonicalCacheKey(canonical);
  const entry = canonicalCache.get(key);

  if (!entry) {
    cacheStats.canonical_misses++;
    return null;
  }

  // V0.2 C3: answerability_signature 校验
  const currentSig = computeAnswerabilitySignature(canonical, rawQuery);
  const currentSigStr = signatureToString(currentSig);

  if (entry.answerability_signature !== simpleHash(currentSigStr)) {
    // 签名不匹配 → 虽然 Canonical Query 相同，但可回答性可能不同
    cacheStats.signature_mismatches++;
    cacheStats.canonical_misses++;
    return null;
  }

  entry.hit_count++;
  entry.last_hit_at = new Date().toISOString();
  cacheStats.canonical_hits++;
  return entry.boundary_result;
}

export function storeCanonicalCache(
  canonical: CanonicalQuery,
  rawQuery: string,
  result: BoundaryResult,
): void {
  const key = canonicalCacheKey(canonical);
  const sig = computeAnswerabilitySignature(canonical, rawQuery);
  const sigStr = signatureToString(sig);

  const existing = canonicalCache.get(key);
  if (existing) {
    existing.original_queries.push(rawQuery.trim());
    existing.hit_count++;
    existing.last_hit_at = new Date().toISOString();
    return;
  }

  canonicalCache.set(key, {
    cache_key: key,
    canonical_query: canonical,
    answerability_signature: simpleHash(sigStr),
    original_queries: [rawQuery.trim()],
    boundary_result: result,
    hit_count: 1,
    created_at: new Date().toISOString(),
    last_hit_at: new Date().toISOString(),
  });
}

// ---- 缓存失效 ----

/**
 * 失效所有缓存。在 Boundary Version 升级、Embedding Model 变更时调用。
 */
export function invalidateAllCaches(): void {
  exactCache.clear();
  canonicalCache.clear();
}

/**
 * 部分失效：仅失效 Canonical Cache（如 Threshold Version 变更时）。
 */
export function invalidateCanonicalCache(): void {
  canonicalCache.clear();
}

// ---- 缓存统计 ----

export function getCacheStats() {
  return {
    ...cacheStats,
    exact_cache_size: exactCache.size,
    canonical_cache_size: canonicalCache.size,
  };
}

// ---- 版本信息 ----

export function getVersionInfo() {
  return {
    boundary_version: BOUNDARY_VERSION,
    threshold_version: THRESHOLD_VERSION,
    knowledge_space_version: KNOWLEDGE_SPACE_VERSION,
  };
}

/**
 * 创建 BoundaryResult 的版本信息字段。
 */
export function makeVersionInfo() {
  return {
    boundary_version: BOUNDARY_VERSION,
    threshold_version: THRESHOLD_VERSION,
    knowledge_space_version: KNOWLEDGE_SPACE_VERSION,
  };
}