// --------------------------------------------------------------
// Game Relevance Rules — 游戏相关性规则引擎
// V0.3 Boundary Engine Layer 4
// 纯规则引擎，判断问题是否属于射击游戏领域
// 职责：GAME RELEVANCE ONLY — 不判断证据充分性
// --------------------------------------------------------------

import type { CanonicalQuery, DomainType } from "./normalization.js";
import { hasShootingGameReference } from "./normalization.js";

// ---- 规则接口 ----

export interface GameRelevanceRule {
  id: string;
  type: "allow" | "deny" | "context_allow";
  description: string;
  condition: (canonical: CanonicalQuery, rawQuery: string, context?: string) => boolean;
  priority: number;
}

export interface GameRelevanceResult {
  decision: "IN" | "OUT" | "AMBIGUOUS";
  rule_id: string | null;
  reason: string | null;
}

// ============================================================================
// 规则定义
// ============================================================================

/**
 * 明确 IN 规则（射击游戏相关）
 */
const ALLOW_RULES: GameRelevanceRule[] = [
  {
    id: "GR1_SHOOTING_DOMAIN",
    type: "allow",
    description: "标准化识别为射击游戏领域",
    condition: (canonical) => canonical.domain === "shooting_game",
    priority: 1,
  },
  {
    id: "GR2_SHOOTING_REF_WITH_OTHER_GAME",
    type: "allow",
    description: "包含射击游戏引用（即使也提到其他游戏）",
    condition: (_canonical, rawQuery) => hasShootingGameReference(rawQuery),
    priority: 2,
  },
  {
    id: "GR7_GREETING",
    type: "allow",
    description: "纯社交问候语（你好/早/晚安等），作为对话入口放行",
    condition: (_canonical, rawQuery) => {
      const greetingPattern = /^[\s'"‘"]*(?:你好|早\s*安|早$|早上好|晚上好|晚安|嗨|哈喽|hello|hi)[\s,，!.！'"‘"]*$/i;
      return greetingPattern.test(rawQuery.trim());
    },
    priority: 3,
  },
];

/**
 * 明确 OUT 规则（非游戏领域）
 */
const DENY_RULES: GameRelevanceRule[] = [
  {
    id: "GR3_NON_GAME_DOMAIN",
    type: "deny",
    description: "明确非游戏领域（天气/股票/编程/烹饪等）",
    condition: (canonical) => canonical.domain === "non_game",
    priority: 10,
  },
  {
    id: "GR4_OTHER_GAME",
    type: "deny",
    description: "其他游戏领域（非射击游戏）且无射击游戏引用",
    condition: (canonical, rawQuery) =>
      canonical.domain === "other_game" && !hasShootingGameReference(rawQuery),
    priority: 11,
  },
  {
    id: "GR5_INAPPROPRIATE",
    type: "deny",
    description: "包含攻击性或不当内容",
    condition: (_canonical, rawQuery) => {
      const inappropriatePatterns = [
        /骂|脏话|侮辱|歧视|政治敏感|色情|暴力恐怖/,
      ];
      return inappropriatePatterns.some((p) => p.test(rawQuery));
    },
    priority: 20,
  },
];

/**
 * 上下文相关的 IN 规则
 * 当问题本身模糊（ambiguous），但上下文是射击游戏时，判定为 IN
 */
const CONTEXT_ALLOW_RULES: GameRelevanceRule[] = [
  {
    id: "GR6_GAME_CONTEXT",
    type: "context_allow",
    description: "问题模糊但上下文为射击游戏语境",
    condition: (canonical, _rawQuery, context) => {
      if (canonical.domain !== "ambiguous") return false;
      if (!context) return false;
      return hasShootingGameReference(context);
    },
    priority: 5,
  },
];

// ---- 规则引擎 ----

/**
 * 执行游戏相关性判定。
 *
 * 判定逻辑：
 * 1. 任一 IN 规则触发 → IN
 * 2. 任一 OUT 规则触发 → OUT
 * 3. 上下文 IN 规则触发 → IN
 * 4. 默认 → AMBIGUOUS
 *
 * @param canonical 标准化结果
 * @param rawQuery 原始用户问题
 * @param context 可选的上下文（如当前对话主题）
 */
export function applyGameRelevanceRules(
  canonical: CanonicalQuery,
  rawQuery: string,
  context?: string,
): GameRelevanceResult {
  // 1. 先检查 IN 规则（最优先）
  const sortedAllow = [...ALLOW_RULES].sort((a, b) => a.priority - b.priority);
  for (const rule of sortedAllow) {
    if (rule.condition(canonical, rawQuery, context)) {
      return {
        decision: "IN",
        rule_id: rule.id,
        reason: rule.description,
      };
    }
  }

  // 2. 检查 OUT 规则
  const sortedDeny = [...DENY_RULES].sort((a, b) => a.priority - b.priority);
  for (const rule of sortedDeny) {
    if (rule.condition(canonical, rawQuery, context)) {
      return {
        decision: "OUT",
        rule_id: rule.id,
        reason: rule.description,
      };
    }
  }

  // 3. 检查上下文 IN 规则
  const sortedContext = [...CONTEXT_ALLOW_RULES].sort((a, b) => a.priority - b.priority);
  for (const rule of sortedContext) {
    if (rule.condition(canonical, rawQuery, context)) {
      return {
        decision: "IN",
        rule_id: rule.id,
        reason: rule.description,
      };
    }
  }

  // 4. 默认 AMBIGUOUS
  return {
    decision: "AMBIGUOUS",
    rule_id: null,
    reason: "无法确定是否与射击游戏相关，需要更多上下文",
  };
}

// ---- 向后兼容 ----

/**
 * @deprecated 使用 applyGameRelevanceRules 替代。
 * 保留此函数以保持向后兼容。
 */
export function applyHardRules(
  canonical: CanonicalQuery,
  rawQuery: string,
): { decision: "OUT" | "IN" | "PASS"; rule_id: string | null; reason: string | null } {
  const result = applyGameRelevanceRules(canonical, rawQuery);

  if (result.decision === "OUT") {
    return { decision: "OUT", rule_id: result.rule_id, reason: result.reason };
  }
  if (result.decision === "IN") {
    return { decision: "IN", rule_id: result.rule_id, reason: result.reason };
  }
  // AMBIGUOUS → PASS（让下游处理）
  return { decision: "PASS", rule_id: null, reason: null };
}

// ---- 调试工具 ----

export function getGameRelevanceRules(): GameRelevanceRule[] {
  return [...ALLOW_RULES, ...DENY_RULES, ...CONTEXT_ALLOW_RULES];
}

export function registerAllowRule(rule: GameRelevanceRule): void {
  const existing = ALLOW_RULES.findIndex((r) => r.id === rule.id);
  if (existing >= 0) {
    ALLOW_RULES[existing] = rule;
  } else {
    ALLOW_RULES.push(rule);
  }
}

export function registerDenyRule(rule: GameRelevanceRule): void {
  const existing = DENY_RULES.findIndex((r) => r.id === rule.id);
  if (existing >= 0) {
    DENY_RULES[existing] = rule;
  } else {
    DENY_RULES.push(rule);
  }
}

export function removeDenyRule(ruleId: string): boolean {
  const idx = DENY_RULES.findIndex((r) => r.id === ruleId);
  if (idx >= 0) {
    DENY_RULES.splice(idx, 1);
    return true;
  }
  return false;
}

// 保留旧的导出名称以保持向后兼容
export { getGameRelevanceRules as getDenyRules };
export { getGameRelevanceRules as getAllowRules };