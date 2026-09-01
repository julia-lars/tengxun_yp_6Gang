// --------------------------------------------------------------
// Boundary Engine — 编排器（Orchestrator）
// V0.2 统一边界检测入口
//
// 判定流程:
//   1. Exact Query Cache → HIT → 返回缓存
//   2. Deterministic Normalization
//   3. Canonical Cache → HIT (签名校验) → 返回缓存
//   4. Hard OUT Rules → OUT → 拒答
//   5. Semantic Candidate Coverage → CLEAR OUT → 拒答
//   6. Knowledge Coverage Check → MATRIX OUT → 拒答
//   7. LLM Evidence Judge → 最终 IN/OUT
// --------------------------------------------------------------

import { normalizeQuery, type CanonicalQuery } from "./normalization.js";
import {
  exactCacheKey,
  lookupExactCache,
  storeExactCache,
  lookupCanonicalCache,
  storeCanonicalCache,
  makeVersionInfo,
  type BoundaryResult,
} from "./cache.js";
import { applyHardRules } from "./hard-rules.js";
import {
  detectCandidateCoverage,
  type CandidateCoverageResult,
} from "./embedding-check.js";
import { lookupMatrix, type CoverageCheckResult } from "./coverage-check.js";
import { runEvidenceJudge } from "./llm-judge.js";

// ---- 导出类型 ----

export type { BoundaryResult } from "./cache.js";
export type { CanonicalQuery, TopicType, QuestionType } from "./normalization.js";
export type { CandidateCoverageResult } from "./embedding-check.js";
export type { CoverageCheckResult } from "./coverage-check.js";

// ---- 配置 ----

export interface BoundaryEngineOptions {
  /** 是否启用 LLM Evidence Judge（默认 true） */
  enableLLMJudge?: boolean;
  /** 是否跳过缓存（用于 Benchmark 评估） */
  skipCache?: boolean;
  /** Embedding T_low 阈值覆盖 */
  t_low?: number;
}

// ---- 主入口 ----

/**
 * 对用户问题执行完整的边界检测。
 * 这是所有问答入口（群体画像 / KOL 分身）的统一调用点。
 */
export async function checkBoundary(
  query: string,
  options: BoundaryEngineOptions = {},
): Promise<BoundaryResult> {
  const startTime = Date.now();
  const versionInfo = makeVersionInfo();

  // ---- Layer 1: Exact Query Cache ----
  if (!options.skipCache) {
    const exactHit = lookupExactCache(query);
    if (exactHit) {
      return { ...exactHit, latency_ms: Date.now() - startTime };
    }
  }

  // ---- Layer 2: Deterministic Normalization ----
  const canonical = normalizeQuery(query);

  // ---- Layer 3: Canonical Cache ----
  if (!options.skipCache) {
    const canonicalHit = lookupCanonicalCache(canonical, query);
    if (canonicalHit) {
      // 也存入 Exact Cache（加速后续完全相同的查询）
      storeExactCache(query, canonicalHit);
      return { ...canonicalHit, latency_ms: Date.now() - startTime };
    }
  }

  // ---- Layer 4: Hard OUT Rules ----
  const hardRuleResult = applyHardRules(canonical, query);
  if (hardRuleResult.decision === "OUT") {
    const result: BoundaryResult = {
      final: "OUT",
      method: "hard_rule",
      B1_domain: "OUT",
      B2_topic_coverage: "OUT",
      B3_question_type_capability: "OUT",
      B4_evidence_sufficiency: "OUT",
      ...versionInfo,
      timestamp: new Date().toISOString(),
      latency_ms: Date.now() - startTime,
    };
    storeExactCache(query, result);
    storeCanonicalCache(canonical, query, result);
    return result;
  }

  // ---- Layer 5: Semantic Candidate Coverage Detection ----
  const embeddingResult = await detectCandidateCoverage(query, {
    t_low: options.t_low,
  });

  if (embeddingResult.candidate_zone === "CLEAR_OUT") {
    const result: BoundaryResult = {
      final: "OUT",
      method: "embedding_clear_out",
      B1_domain: "IN",
      B2_topic_coverage: "OUT",
      B3_question_type_capability: "OUT",
      B4_evidence_sufficiency: "OUT",
      embedding: {
        top_region: embeddingResult.top_region,
        region_score: embeddingResult.region_score,
        candidate_zone: "CLEAR_OUT",
        hn_proximity_warning: embeddingResult.hn_proximity_warning,
      },
      ...versionInfo,
      timestamp: new Date().toISOString(),
      latency_ms: Date.now() - startTime,
    };
    storeExactCache(query, result);
    storeCanonicalCache(canonical, query, result);
    return result;
  }

  // ---- Layer 6: Knowledge Coverage Check ----
  const coverageResult = lookupMatrix(canonical);

  if (coverageResult.matrix_result === "MATRIX_OUT") {
    const result: BoundaryResult = {
      final: "OUT",
      method: "matrix_out",
      B1_domain: "IN",
      B2_topic_coverage: "IN",
      B3_question_type_capability: "OUT",
      B4_evidence_sufficiency: "OUT",
      embedding: {
        top_region: embeddingResult.top_region,
        region_score: embeddingResult.region_score,
        candidate_zone: "CANDIDATE",
        hn_proximity_warning: embeddingResult.hn_proximity_warning,
      },
      coverage_check: {
        matched_region: coverageResult.matched_region,
        matched_intent: coverageResult.matched_intent,
        matrix_result: "MATRIX_OUT",
      },
      ...versionInfo,
      timestamp: new Date().toISOString(),
      latency_ms: Date.now() - startTime,
    };
    storeExactCache(query, result);
    storeCanonicalCache(canonical, query, result);
    return result;
  }

  // ---- Layer 7: LLM Evidence Judge ----
  if (options.enableLLMJudge === false) {
    // LLM Judge 禁用时，保守返回 OUT
    const result: BoundaryResult = {
      final: "OUT",
      method: "matrix_out",
      B1_domain: "IN",
      B2_topic_coverage: "IN",
      B3_question_type_capability: "IN",
      B4_evidence_sufficiency: "OUT",
      embedding: {
        top_region: embeddingResult.top_region,
        region_score: embeddingResult.region_score,
        candidate_zone: "CANDIDATE",
        hn_proximity_warning: embeddingResult.hn_proximity_warning,
      },
      coverage_check: {
        matched_region: coverageResult.matched_region,
        matched_intent: coverageResult.matched_intent,
        matrix_result: coverageResult.matrix_result,
      },
      ...versionInfo,
      timestamp: new Date().toISOString(),
      latency_ms: Date.now() - startTime,
    };
    storeExactCache(query, result);
    storeCanonicalCache(canonical, query, result);
    return result;
  }

  const judgeResult = await runEvidenceJudge(
    query,
    canonical,
    coverageResult,
    {
      top_region: embeddingResult.top_region,
      region_score: embeddingResult.region_score,
      hn_proximity_warning: embeddingResult.hn_proximity_warning,
    },
  );

  const result: BoundaryResult = {
    final: judgeResult.final,
    method: "llm_judge",
    B1_domain: judgeResult.B1_domain,
    B2_topic_coverage: judgeResult.B2_topic_coverage,
    B3_question_type_capability: judgeResult.B3_question_type_capability,
    B4_evidence_sufficiency: judgeResult.B4_evidence_sufficiency,
    embedding: {
      top_region: embeddingResult.top_region,
      region_score: embeddingResult.region_score,
      candidate_zone: "CANDIDATE",
      hn_proximity_warning: embeddingResult.hn_proximity_warning,
    },
    coverage_check: {
      matched_region: coverageResult.matched_region,
      matched_intent: coverageResult.matched_intent,
      matrix_result: coverageResult.matrix_result,
    },
    ...versionInfo,
    timestamp: new Date().toISOString(),
    latency_ms: Date.now() - startTime,
  };

  // 缓存结果
  storeExactCache(query, result);
  storeCanonicalCache(canonical, query, result);

  return result;
}

/**
 * 仅执行快速路径（不调用 LLM）。
 * 用于需要快速预判的场景（如前端即时反馈）。
 */
export async function checkBoundaryFast(
  query: string,
  options: BoundaryEngineOptions = {},
): Promise<{
  quick_decision: "CLEAR_OUT" | "NEEDS_FULL_CHECK";
  canonical: CanonicalQuery;
  embedding?: CandidateCoverageResult;
  coverage?: CoverageCheckResult;
}> {
  const canonical = normalizeQuery(query);

  // Hard Rules
  const hardRuleResult = applyHardRules(canonical, query);
  if (hardRuleResult.decision === "OUT") {
    return { quick_decision: "CLEAR_OUT", canonical };
  }

  // Embedding
  const embeddingResult = await detectCandidateCoverage(query, {
    t_low: options.t_low,
  });
  if (embeddingResult.candidate_zone === "CLEAR_OUT") {
    return { quick_decision: "CLEAR_OUT", canonical, embedding: embeddingResult };
  }

  // Matrix
  const coverageResult = lookupMatrix(canonical);
  if (coverageResult.matrix_result === "MATRIX_OUT") {
    return {
      quick_decision: "CLEAR_OUT",
      canonical,
      embedding: embeddingResult,
      coverage: coverageResult,
    };
  }

  return {
    quick_decision: "NEEDS_FULL_CHECK",
    canonical,
    embedding: embeddingResult,
    coverage: coverageResult,
  };
}