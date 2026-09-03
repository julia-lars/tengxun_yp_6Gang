// --------------------------------------------------------------
// KOL 分身专用可信度计算引擎
// KOL 有自己的内容特征，基于证据匹配质量 + 来源质量 + 内容相关性 + 证据量
// 不依赖集体画像的标签维度。
// --------------------------------------------------------------

import type { ConfidenceResult } from "@app/shared";

export interface KOLConfidenceInput {
  /** 检索到的证据条数 */
  evidenceCount: number;
  /** 最高向量相似度 (0-1) */
  topSimilarity: number;
  /** 平均向量相似度 (0-1) */
  avgSimilarity: number;
  /** 直引级别证据的数量（matchLevel === "direct"） */
  directQuoteCount: number;
  /** 高质量匹配证据的数量（similarity >= 0.75） */
  highMatchCount: number;
  /** 是否包含直引级别的证据 */
  hasDirectQuote: boolean;
  /** 是否超出画像知识边界 */
  isBoundaryQuestion: boolean;
  /** KOL 专属标签（从 contentFocus + representativeTopics 提取的关键词） */
  kolTags: string[];
  /** 证据文本列表（用于游戏关键词匹配） */
  evidenceTexts: string[];
}

// KOL 专属权重 — 证据匹配质量为主，内容相关性为辅，来源质量和证据量兜底
const KOL_WEIGHTS = {
  evidenceMatch: 0.40,
  sourceQuality: 0.25,
  contentRelevance: 0.20,
  evidenceQuantity: 0.15,
};

// ─── 游戏领域通用关键词 ───
// 涵盖游戏类型、机制、玩法、体验、评价等维度
// 这些词在任何游戏 KOL 的内容中都会高频出现，用于衡量证据是否属于游戏内容
const GAME_KEYWORDS = new Set([
  // 游戏类型
  "射击", "动作", "冒险", "角色扮演", "RPG", "ARPG", "MOBA", "FPS", "TPS",
  "策略", "模拟", "经营", "养成", "解谜", "恐怖", "生存", "沙盒", "开放世界",
  "肉鸽", "Roguelike", "魂系", "类魂", "银河城", "独立游戏", "3A", "大作",
  // 游戏机制
  "战斗", "关卡", "BOSS", "技能", "大招", "装备", "武器", "道具", "数值",
  "平衡", "机制", "系统", "玩法", "模式", "匹配", "排位", "竞技", "合作",
  "PVP", "PVE", "联机", "单机", "难度", "新手", "硬核", "休闲",
  // 操作体验
  "手感", "打击感", "操作", "枪法", "走位", "意识", "配合", "阵容", "战术",
  "手柄", "键鼠", "帧数", "画质", "优化", "延迟", "卡顿",
  // 内容评价
  "剧情", "故事", "叙事", "角色", "人设", "演出", "配音", "音乐", "美术",
  "风格", "画面", "设计", "创意", "创新", "缝合",
  // 商业/运营
  "付费", "氪金", "皮肤", "赛季", "DLC", "更新", "联动", "IP", "国产",
  "重制", "复刻", "移植", "平台", "PC", "主机", "手机",
  // 体验评价
  "好玩", "无聊", "惊艳", "失望", "推荐", "爽快", "刺激", "上头", "解压",
  "真实", "拟真", "沉浸", "自由", "探索",
  // 武器/战斗
  "枪", "刀", "剑", "弓", "盾", "弹反", "格挡", "闪避", "伤害", "血量",
]);

/**
 * 检查证据文本是否包含游戏相关内容。
 * 使用游戏领域通用关键词做快速匹配，而非依赖 KOL 的抽象分类标签。
 */
function matchGameContent(text: string): boolean {
  const lower = text.toLowerCase();
  for (const kw of GAME_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) return true;
  }
  return false;
}

/**
 * KOL 专属可信度计算。
 *
 * 与集体画像 calculateConfidence 的核心区别：
 * - 内容一致性使用游戏领域通用关键词匹配，而非 persona 的结构化标签重叠
 * - 证据量满分线降至 5 条（KOL 语料总量远小于集体画像库）
 * - 四维权重：evidenceMatch 0.40 / sourceQuality 0.25 / contentRelevance 0.20 / quantity 0.15
 *
 * 输出格式与集体画像 ConfidenceResult 完全兼容。
 */
export function calculateKOLConfidence(input: KOLConfidenceInput): ConfidenceResult {
  const {
    evidenceCount,
    topSimilarity,
    avgSimilarity,
    directQuoteCount,
    highMatchCount,
    hasDirectQuote,
    isBoundaryQuestion,
    evidenceTexts,
  } = input;

  // 1. 证据匹配质量分：综合最高相似度 + 平均相似度
  const evidenceMatchScore = evidenceCount === 0
    ? 0
    : Math.min(1, topSimilarity * 0.6 + avgSimilarity * 0.4);

  // 2. 来源质量分：直引比例 + 高匹配比例
  const directQuoteRatio = evidenceCount > 0 ? directQuoteCount / evidenceCount : 0;
  const highMatchRatio = evidenceCount > 0 ? highMatchCount / evidenceCount : 0;
  const sourceQualityScore = evidenceCount === 0
    ? 0
    : directQuoteRatio * 0.5 + highMatchRatio * 0.5;

  // 3. 内容相关性分：证据文本中包含游戏关键词的比例
  const contentRelevanceScore = evidenceCount === 0
    ? 0
    : evidenceTexts.filter((t) => matchGameContent(t)).length / evidenceCount;

  // 4. 证据量分：KOL 语料总量小，5 条满分
  const evidenceQuantityScore = Math.min(1, evidenceCount / 5);

  // 5. 加权综合
  let score =
    evidenceMatchScore * KOL_WEIGHTS.evidenceMatch +
    sourceQualityScore * KOL_WEIGHTS.sourceQuality +
    contentRelevanceScore * KOL_WEIGHTS.contentRelevance +
    evidenceQuantityScore * KOL_WEIGHTS.evidenceQuantity;

  // 6. 调节项
  if (isBoundaryQuestion) {
    score *= 0.6;
  }
  if (hasDirectQuote && evidenceCount > 0) {
    score = Math.min(1, score * 1.1);
  }

  // 四舍五入到两位小数
  score = Math.round(score * 100) / 100;

  // 7. 等级划分
  const level: "high" | "medium" | "low" =
    score >= 0.8 ? "high" : score >= 0.6 ? "medium" : "low";

  // 8. 风险标记
  const flags: string[] = [];
  if (evidenceCount < 2) flags.push("low_evidence");
  if (evidenceCount === 0) flags.push("inferred");
  if (isBoundaryQuestion) flags.push("boundary");
  if (score < 0.5) flags.push("low_confidence");

  return {
    score,
    level,
    breakdown: {
      evidenceScore: Math.round(evidenceMatchScore * 100) / 100,
      consistencyScore: Math.round(contentRelevanceScore * 100) / 100,
      evidenceCountScore: Math.round(evidenceQuantityScore * 100) / 100,
    },
    flags,
    evidenceCount,
  };
}

/**
 * 从 KOL personaCard 中提取 KOL 专属标签关键词。
 * 将复合分类标签（如"射击游戏""游戏剧情解析"）拆分为单个关键词，
 * 同时保留原始标签用于前端展示。
 */
export function extractKOLTags(personaCard: Record<string, unknown>): string[] {
  const tags = new Set<string>();

  const contentFocus = personaCard.contentFocus as string[] | undefined;
  const repTopics = personaCard.representativeTopics as string[] | undefined;

  const allTags = [...(Array.isArray(contentFocus) ? contentFocus : []), ...(Array.isArray(repTopics) ? repTopics : [])];

  for (const tag of allTags) {
    if (typeof tag !== "string" || tag.length === 0) continue;
    tags.add(tag);

    // 拆分复合标签为单个关键词
    // "射击游戏" → "射击", "游戏"  |  "游戏剧情解析" → "游戏", "剧情", "解析"
    const parts = tag
      .replace(/[与和及、，,\s]+/g, " ")
      .replace(/题材|现象|关联|评价|分析|解析/g, " ")
      .split(/\s+/)
      .filter((p) => p.length >= 2 && p !== "游戏"); // "游戏"太泛，不加入
    for (const p of parts) {
      tags.add(p);
    }
  }

  return [...tags];
}