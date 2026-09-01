// --------------------------------------------------------------
// 置信度计算引擎
// 综合证据匹配度、标签一致性、样本量三个维度计算 AI 回答的可信度
// --------------------------------------------------------------

export interface ConfidenceInput {
  /** 检索到的证据条数 */
  evidenceCount: number;
  /** 最高向量相似度 (0-1) */
  topSimilarity: number;
  /** 平均向量相似度 (0-1) */
  avgSimilarity: number;
  /** 证据标签与画像标签的重叠比例 (0-1) */
  tagOverlapRatio: number;
  /** 画像总样本量 */
  sampleCount: number;
  /** 是否包含直引级别的证据 */
  hasDirectQuote: boolean;
  /** 是否超出画像知识边界（由 LLM 或规则判断） */
  isBoundaryQuestion: boolean;
}

export interface ConfidenceResult {
  /** 综合置信度 0-1 */
  score: number;
  /** 置信等级 */
  level: "high" | "medium" | "low";
  /** 三维分解 */
  breakdown: {
    evidenceScore: number;
    consistencyScore: number;
    sampleScore: number;
  };
  /** 风险标记 */
  flags: string[];
}

// 权重配置 — 证据匹配度占主导，标签一致性为辅，样本量做兜底
const WEIGHTS = {
  evidence: 0.5,
  consistency: 0.3,
  sample: 0.2,
};

export function calculateConfidence(input: ConfidenceInput): ConfidenceResult {
  // 1. 证据匹配得分：综合最高相似度 + 平均相似度 + 证据数量
  const evidenceScore = input.evidenceCount === 0
    ? 0
    : Math.min(
        1,
        (input.topSimilarity * 0.6 + input.avgSimilarity * 0.4) *
          Math.min(1, input.evidenceCount / 3),
      );

  // 2. 标签一致性得分：直接使用标签重叠比例
  const consistencyScore = input.tagOverlapRatio;

  // 3. 样本量得分：阈值参考产品文档 7.2 节
  const sampleScore =
    input.sampleCount >= 30 ? 1 : input.sampleCount >= 10 ? 0.6 : 0.3;

  // 4. 加权综合
  let score =
    evidenceScore * WEIGHTS.evidence +
    consistencyScore * WEIGHTS.consistency +
    sampleScore * WEIGHTS.sample;

  // 5. 调节项
  // 边界问题降权：没有直接证据的推测性回答
  if (input.isBoundaryQuestion) {
    score *= 0.6;
  }
  // 有直引证据加权：原文直接支持的回答可信度更高
  if (input.hasDirectQuote && input.evidenceCount > 0) {
    score = Math.min(1, score * 1.15);
  }

  // 四舍五入到两位小数
  score = Math.round(score * 100) / 100;

  // 6. 等级划分
  const level: "high" | "medium" | "low" =
    score >= 0.8 ? "high" : score >= 0.6 ? "medium" : "low";

  // 7. 风险标记
  const flags: string[] = [];
  if (input.sampleCount < 10) flags.push("low_sample");
  if (input.evidenceCount === 0) flags.push("inferred");
  if (input.isBoundaryQuestion) flags.push("boundary");
  if (score < 0.5) flags.push("low_confidence");

  return {
    score,
    level,
    breakdown: {
      evidenceScore: Math.round(evidenceScore * 100) / 100,
      consistencyScore: Math.round(consistencyScore * 100) / 100,
      sampleScore: Math.round(sampleScore * 100) / 100,
    },
    flags,
  };
}

// ---- 辅助函数 ----

import { cnLabelToEnKey } from "./tag-label-map.js";

// ---- v2 标签一致性：5 维度独立评估 × 覆盖率惩罚 ----

const DIMENSIONS = ["needs", "ability", "style", "platform", "mode"] as const;
type Dimension = (typeof DIMENSIONS)[number];

/**
 * 从 persona v1 tagSpec 提取 5 个维度的英文标签集合。
 * tagSpec 格式：{诉求: string | string[], 能力: string, 风格: string[], 平台: string, 模式: string}
 */
function extractPersonaDimensions(tagSpec: Record<string, unknown>): Record<Dimension, Set<string>> {
  const dims: Record<Dimension, Set<string>> = {
    needs: new Set(),
    ability: new Set(),
    style: new Set(),
    platform: new Set(),
    mode: new Set(),
  };

  // 诉求 → needs
  const needsRaw = tagSpec["诉求"];
  if (Array.isArray(needsRaw)) {
    for (const v of needsRaw) {
      if (typeof v === "string") {
        for (const en of cnLabelToEnKey(v)) {
          if (en !== "unknown") dims.needs.add(en);
        }
      }
    }
  } else if (typeof needsRaw === "string") {
    for (const en of cnLabelToEnKey(needsRaw)) {
      if (en !== "unknown") dims.needs.add(en);
    }
  }

  // 能力 → ability
  const abilityRaw = tagSpec["能力"];
  if (typeof abilityRaw === "string") {
    for (const en of cnLabelToEnKey(abilityRaw)) {
      if (en !== "unknown") dims.ability.add(en);
    }
  }

  // 风格 → style（5 轴：combat, decision, victory, growth, social）
  const styleRaw = tagSpec["风格"];
  if (Array.isArray(styleRaw)) {
    for (const v of styleRaw) {
      if (typeof v === "string") {
        for (const en of cnLabelToEnKey(v)) {
          if (en !== "unknown") dims.style.add(en);
        }
      }
    }
  }

  // 平台 → platform
  const platformRaw = tagSpec["平台"];
  if (typeof platformRaw === "string") {
    for (const en of cnLabelToEnKey(platformRaw)) {
      if (en !== "unknown") dims.platform.add(en);
    }
  }

  // 模式 → mode
  const modeRaw = tagSpec["模式"];
  if (typeof modeRaw === "string") {
    for (const en of cnLabelToEnKey(modeRaw)) {
      if (en !== "unknown") dims.mode.add(en);
    }
  }

  return dims;
}

/**
 * 从 evidence framework 提取 5 个维度的标签集合。
 * 仅使用 framework 受控词汇，不包含 iceberg 自由文本。
 * unknown 值被过滤，不参与比较。
 */
function extractEvidenceDimensions(annotation: Record<string, unknown>): Record<Dimension, Set<string>> {
  const dims: Record<Dimension, Set<string>> = {
    needs: new Set(),
    ability: new Set(),
    style: new Set(),
    platform: new Set(),
    mode: new Set(),
  };

  const framework = annotation.framework as Record<string, unknown> | undefined;
  if (!framework) return dims;

  // needs: primary + secondary
  const needs = framework.needs as Record<string, unknown> | undefined;
  if (needs) {
    if (typeof needs.primary === "string" && needs.primary !== "unknown") dims.needs.add(needs.primary);
    if (Array.isArray(needs.secondary)) {
      for (const s of needs.secondary) {
        if (typeof s === "string" && s !== "unknown") dims.needs.add(s);
      }
    }
  }

  // ability: level
  const ability = framework.ability as Record<string, unknown> | undefined;
  if (ability) {
    if (typeof ability.level === "string" && ability.level !== "unknown") dims.ability.add(ability.level);
  }

  // style: 5 轴
  const style = framework.style as Record<string, unknown> | undefined;
  if (style) {
    for (const axis of ["combat", "decision", "victory", "growth", "social"] as const) {
      const v = style[axis];
      if (typeof v === "string" && v !== "unknown") dims.style.add(v);
    }
  }

  // platform: primary
  const platform = framework.platform as Record<string, unknown> | undefined;
  if (platform) {
    if (typeof platform.primary === "string" && platform.primary !== "unknown") dims.platform.add(platform.primary);
  }

  // mode: structure
  const mode = framework.mode as Record<string, unknown> | undefined;
  if (mode) {
    if (typeof mode.structure === "string" && mode.structure !== "unknown") dims.mode.add(mode.structure);
  }

  return dims;
}

/**
 * 计算证据标签与画像标签的维度级一致性（v2）。
 *
 * 5 个维度独立评估：needs / ability / style / platform / mode。
 * - 证据在某维度有信息且与 persona 一致 → 该维度得分高
 * - 证据在某维度有信息但与 persona 矛盾 → 该维度得分低
 * - 证据在某维度无信息（unknown）→ 该维度沉默，不影响总分
 *
 * 单条 evidence 得分 = agreement × coverage
 *   agreement = 有信息维度的平均一致性
 *   coverage  = 有信息维度数 / 5
 *
 * 最终得分 = 所有 evidence 得分的平均值。
 */
export function computeTagOverlap(
  personaTagSpec: Record<string, unknown>,
  evidenceAnnotations: Array<Record<string, unknown> | null>,
): number {
  if (evidenceAnnotations.length === 0) return 0;

  const personaDims = extractPersonaDimensions(personaTagSpec);

  // 检查 persona 是否有任何维度标签
  const hasAnyPersonaLabel = Object.values(personaDims).some((s) => s.size > 0);
  if (!hasAnyPersonaLabel) return 0.5;

  const overlaps = evidenceAnnotations.map((annotation) => {
    if (!annotation) return 0.5; // 无 annotation → 中性

    const evidenceDims = extractEvidenceDimensions(annotation);

    let dimScoresSum = 0;
    let informedCount = 0;

    for (const dim of DIMENSIONS) {
      const pSet = personaDims[dim];
      const eSet = evidenceDims[dim];

      if (eSet.size === 0) continue; // 沉默维度：evidence 无信息
      if (pSet.size === 0) continue; // persona 未定义此维度

      // evidence 标签落入 persona 标签集的比例
      let matchCount = 0;
      for (const label of eSet) {
        if (pSet.has(label)) matchCount++;
      }
      dimScoresSum += matchCount / eSet.size;
      informedCount++;
    }

    if (informedCount === 0) return 0.5; // 全部沉默 → 中性

    const agreement = dimScoresSum / informedCount;
    const coverage = informedCount / 5;
    return agreement * coverage;
  });

  return overlaps.reduce((sum, o) => sum + o, 0) / overlaps.length;
}

/**
 * 根据向量相似度判断证据等级。
 * pgvector <=> 返回余弦距离，相似度 = 1 - 距离
 */
export function classifyMatchLevel(similarity: number): "direct" | "partial" | "inferred" {
  if (similarity >= 0.75) return "direct";
  if (similarity >= 0.5) return "partial";
  return "inferred";
}