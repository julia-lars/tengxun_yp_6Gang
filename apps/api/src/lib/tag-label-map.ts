// --------------------------------------------------------------
// 中文标签值 ↔ 英文 annotation key 映射表
// 用于 confidence.ts 的 computeTagOverlap 计算标签一致性
// 映射关系基于 pipeline-tagger.ts 系统提示词中的值域定义
// --------------------------------------------------------------

/**
 * 中文标签值 → 英文 annotation key 的完整映射。
 * 当一个中文标签对应多个可能的英文 key 时，使用数组。
 */
export const CN_TO_EN_LABEL_MAP: Record<string, string | string[]> = {
  // === 诉求维度 (M1) ===
  "竞技证明": "competitive_proof",
  "能力成长": "ability_growth",
  "支配优越": "dominance",
  "团队协作": "team_cooperation",
  "社交归属": "social_belonging",
  "射击爽感": "stimulation",
  "放松逃避": "relaxation_escape",
  "策略掌控": "strategy_mastery",
  "探索收集": "exploration_collection",
  "叙事沉浸": "narrative_immersion",
  "视听审美": "sensory_aesthetics",
  "表达创造": "expression_creation",

  // === 能力维度 ===
  "新手": "novice",
  "入门": "beginner",
  "进阶": "intermediate",
  "高手": "advanced",
  "专家/竞技级": "expert",
  "未知": "unknown",

  // === 风格维度 (5 轴) ===
  // 战斗倾向
  "主动求战/刚枪": "aggressive",
  "灵活平衡": "balanced",
  "灵活": "balanced",           // 别名 — persona 聚类可能只产出短名
  "苟活避战": "passive",
  // 决策方式
  "仔细思考/策略": "strategic",
  "情境切换": "contextual",
  "情境": "contextual",         // 别名
  "本能快速反应": "instinctive",
  // 取胜方式
  "个人能力取胜": "individual",
  "团队个人平衡": "balanced",
  "团队协作取胜": "team",
  "团队取胜": "team",           // 别名
  // 成长方式
  "数值养成": "progression",
  "混合": "mixed",
  "操作技巧对抗": "skill",
  // 社交方式
  "熟人开黑": "friends",
  "熟人": "friends",            // 别名
  "均可": "flexible",
  "陌生人/单人": "solo",

  // === 平台维度 ===
  "PC": "pc",
  "PC端": "pc",                 // 别名 — persona 聚类可能产出
  "主机": "console",
  "手机": "mobile",
  "手机端": "mobile",           // 别名
  "多平台均衡": "multi_platform",
  "云游戏/其他": "cloud_other",

  // === 模式维度 ===
  "纯PVE": "pure_pve",
  "PVE为主": "pve_main",
  "PVP/PVE均衡": "balanced",
  "PVP为主": "pvp_main",
  "纯PVP": "pure_pvp",
  "随场景变化": "contextual",
};

/**
 * 将中文标签值转换为对应的英文 annotation key。
 * 如果找不到映射，返回原始值（不变）。
 * 如果一个中文标签对应多个英文 key，返回所有可能的 key。
 */
export function cnLabelToEnKey(cnLabel: string): string[] {
  const mapped = CN_TO_EN_LABEL_MAP[cnLabel];
  if (mapped === undefined) {
    // 无映射时返回原始值的小写形式（兼容已是英文的情况）
    return [cnLabel.toLowerCase()];
  }
  if (Array.isArray(mapped)) return mapped;
  return [mapped];
}

/**
 * 将 persona tagSpec 中的所有中文标签值批量转换为英文 key 集合。
 * 支持 v1 扁平格式 {诉求, 能力, 风格, 平台, 模式} 和 v2 嵌套格式 {needs, ability, style, platform, mode}。
 */
export function personaTagSpecToEnKeys(tagSpec: Record<string, unknown>): Set<string> {
  const keys = new Set<string>();

  /**
   * 递归提取对象中所有字符串值，转换为英文 key 并加入集合。
   */
  function extractStrings(obj: unknown): void {
    if (typeof obj === "string") {
      for (const en of cnLabelToEnKey(obj)) {
        keys.add(en);
      }
      return;
    }
    if (Array.isArray(obj)) {
      for (const item of obj) {
        extractStrings(item);
      }
      return;
    }
    if (obj !== null && typeof obj === "object") {
      // 跳过 version 字段等元数据
      for (const val of Object.values(obj as Record<string, unknown>)) {
        extractStrings(val);
      }
    }
  }

  extractStrings(tagSpec);
  return keys;
}