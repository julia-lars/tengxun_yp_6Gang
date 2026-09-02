// --------------------------------------------------------------
// Boundary Engine — 游戏相关性边界检测（V0.3）
//
// 职责：判断用户问题是否与射击游戏领域相关
// 不负责：证据充分性、回答置信度、数据库覆盖度
//
// 判定流程:
//   1. Exact Query Cache → HIT → 返回缓存
//   2. Deterministic Normalization
//   3. Canonical Cache → HIT → 返回缓存
//   4. Game Relevance Rules → IN / OUT / AMBIGUOUS
//
// 原则: "相关性决定是否进入，证据决定能否可靠回答"
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
import { applyGameRelevanceRules } from "./hard-rules.js";
import { runAmbiguityJudge } from "./ambiguity-judge.js";

// ---- 导出类型 ----

export type { BoundaryResult } from "./cache.js";
export type { CanonicalQuery, TopicType, QuestionType, DomainType } from "./normalization.js";
export type { GameRelevanceResult } from "./hard-rules.js";

// ---- 配置 ----

export interface BoundaryEngineOptions {
  /** 是否跳过缓存（用于 Benchmark 评估） */
  skipCache?: boolean;
  /** 可选的上下文（如当前对话主题），用于消歧义模糊问题 */
  context?: string;
  /** 是否启用 LLM Ambiguity Judge（仅对 AMBIGUOUS 问题触发） */
  useLLMJudge?: boolean;
}

// ---- 主入口 ----

/**
 * 对用户问题执行游戏相关性边界检测。
 * 这是所有问答入口（群体画像 / KOL 分身）的统一调用点。
 *
 * 返回：
 * - IN: 属于射击游戏领域，进入后续问答链
 * - OUT: 不属于射击游戏领域，拒答
 * - AMBIGUOUS: 无法确定，需要更多上下文（建议进入问答链，由证据链判断）
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
      storeExactCache(query, canonicalHit);
      return { ...canonicalHit, latency_ms: Date.now() - startTime };
    }
  }

  // ---- Layer 4: Game Relevance Rules ----
  const relevanceResult = applyGameRelevanceRules(
    canonical,
    query,
    options.context,
  );

  // ---- Layer 5: LLM Ambiguity Judge（仅 AMBIGUOUS 且启用时触发）----
  let finalDecision = relevanceResult.decision;
  let method: BoundaryResult["method"] = "game_relevance_rule";
  let ruleReason = relevanceResult.reason;

  if (relevanceResult.decision === "AMBIGUOUS" && options.useLLMJudge) {
    const judgeResult = await runAmbiguityJudge(query, options.context);
    finalDecision = judgeResult.decision;
    method = "llm_ambiguity_judge";
    ruleReason = judgeResult.reason;
  }

  const result: BoundaryResult = {
    final: finalDecision,
    method,
    B1_domain: finalDecision,
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
 * 同步版本的游戏相关性检测（仅规则检查，不涉及缓存）。
 * 用于需要即时反馈的场景。
 */
export function checkBoundarySync(
  query: string,
  options: BoundaryEngineOptions = {},
): { final: "IN" | "OUT" | "AMBIGUOUS"; reason: string | null } {
  const canonical = normalizeQuery(query);
  const result = applyGameRelevanceRules(canonical, query, options.context);
  return {
    final: result.decision,
    reason: result.reason,
  };
}