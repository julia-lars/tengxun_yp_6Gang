// --------------------------------------------------------------
// Hard OUT Rules — 硬边界规则引擎
// V0.2 Boundary Engine Layer 4
// 纯规则引擎，不依赖 LLM，所有规则在 5ms 内完成
// --------------------------------------------------------------

import type { CanonicalQuery } from "./normalization.js";

// ---- 规则接口 ----

export interface HardRule {
  id: string;
  type: "deny" | "allow";
  description: string;
  condition: (canonical: CanonicalQuery, rawQuery: string) => boolean;
  priority: number; // 越小越优先
}

export interface HardRuleResult {
  decision: "OUT" | "IN" | "PASS";
  rule_id: string | null;
  reason: string | null;
}

// ---- 规则定义 ----

/**
 * 拒绝规则（Hard OUT）— 可以激进。
 * 优先级 1-10：领域外规则。
 */
const DENY_RULES: HardRule[] = [
  // R1: 领域外 — 明确不属于射击游戏领域
  {
    id: "R1_DOMAIN_OUT",
    type: "deny",
    description: "领域不属于射击游戏",
    condition: (canonical) => canonical.domain === "other",
    priority: 1,
  },

  // R2: 非射击游戏关键词
  {
    id: "R2_NON_SHOOTING_KEYWORD",
    type: "deny",
    description: "包含明确非射击游戏关键词",
    condition: (_canonical, rawQuery) => {
      const nonShootingKeywords = [
        "王者荣耀", "原神", "英雄联盟", "lol", "dota", "dota2",
        "股票", "天气", "写代码", "翻译", "总结", "聊天",
        "崩坏", "星穹铁道", "明日方舟", "阴阳师", "碧蓝航线",
        "魔兽世界", "wow", "ff14", "最终幻想14", "剑网三", "逆水寒",
        "我的世界", "minecraft", "roblox", "among us", "鹅鸭杀",
        "poker", "德州", "麻将", "围棋", "象棋",
        "做饭", "菜谱", "烹饪", "旅游", "景点", "酒店",
        "音乐", "歌手", "歌曲", "电影", "电视剧", "综艺",
        "新闻", "政治", "选举", "经济", "房价",
      ];
      const q = rawQuery.toLowerCase();
      return nonShootingKeywords.some((kw) => q.includes(kw.toLowerCase()));
    },
    priority: 2,
  },

  // R3: 非游戏领域意图
  {
    id: "R3_NON_GAME_INTENT",
    type: "deny",
    description: "包含非游戏领域意图",
    condition: (_canonical, rawQuery) => {
      const nonGameIntents = [
        "写代码", "编程", "debug", "翻译成", "翻译为",
        "总结一下", "帮我写", "帮我做", "推荐股票", "推荐基金",
        "天气预报", "今天天气", "明天天气",
        "帮我查", "帮我搜", "搜索一下",
        "你是谁", "你能做什么", "你的功能",
      ];
      const q = rawQuery.toLowerCase();
      return nonGameIntents.some((kw) => q.includes(kw.toLowerCase()));
    },
    priority: 3,
  },

  // R4: 攻击性/不当内容
  {
    id: "R4_INAPPROPRIATE",
    type: "deny",
    description: "包含攻击性或不当内容",
    condition: (_canonical, rawQuery) => {
      const inappropriatePatterns = [
        /骂|脏话|侮辱|歧视|政治敏感|色情|暴力恐怖/,
      ];
      return inappropriatePatterns.some((p) => p.test(rawQuery));
    },
    priority: 4,
  },
];

/**
 * 允许规则（Hard IN）— 必须极其保守。
 * 优先级 90-100：仅允许可证明的确定性命中。
 */
const ALLOW_RULES: HardRule[] = [
  // P1: Canonical Cache 命中已在 Cache 层处理，此处不重复
  // P2: 预定义 FAQ 精确匹配（V0.2 暂不启用，保留接口）
];

// ---- 规则引擎 ----

/**
 * 执行 Hard Rules 判定。
 * 拒绝规则优先级 > 允许规则。
 * 任一拒绝规则触发 → OUT。
 * 所有规则通过 → PASS。
 */
export function applyHardRules(
  canonical: CanonicalQuery,
  rawQuery: string,
): HardRuleResult {
  // 先检查拒绝规则（按优先级排序）
  const sortedDenyRules = [...DENY_RULES].sort((a, b) => a.priority - b.priority);

  for (const rule of sortedDenyRules) {
    if (rule.condition(canonical, rawQuery)) {
      return {
        decision: "OUT",
        rule_id: rule.id,
        reason: rule.description,
      };
    }
  }

  // 再检查允许规则
  for (const rule of ALLOW_RULES) {
    if (rule.condition(canonical, rawQuery)) {
      return {
        decision: "IN",
        rule_id: rule.id,
        reason: rule.description,
      };
    }
  }

  return { decision: "PASS", rule_id: null, reason: null };
}

/**
 * 获取所有已注册的拒绝规则（用于调试和监控）。
 */
export function getDenyRules(): HardRule[] {
  return [...DENY_RULES];
}

/**
 * 获取所有已注册的允许规则（用于调试和监控）。
 */
export function getAllowRules(): HardRule[] {
  return [...ALLOW_RULES];
}

/**
 * 注册新的拒绝规则（热更新）。
 */
export function registerDenyRule(rule: HardRule): void {
  // 避免重复注册
  const existing = DENY_RULES.findIndex((r) => r.id === rule.id);
  if (existing >= 0) {
    DENY_RULES[existing] = rule;
  } else {
    DENY_RULES.push(rule);
  }
}

/**
 * 注册新的允许规则（热更新）。
 */
export function registerAllowRule(rule: HardRule): void {
  const existing = ALLOW_RULES.findIndex((r) => r.id === rule.id);
  if (existing >= 0) {
    ALLOW_RULES[existing] = rule;
  } else {
    ALLOW_RULES.push(rule);
  }
}

/**
 * 移除拒绝规则。
 */
export function removeDenyRule(ruleId: string): boolean {
  const idx = DENY_RULES.findIndex((r) => r.id === ruleId);
  if (idx >= 0) {
    DENY_RULES.splice(idx, 1);
    return true;
  }
  return false;
}