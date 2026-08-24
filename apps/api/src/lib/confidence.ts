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

/**
 * 计算证据标签与画像标签的重叠比例。
 * 将 persona tagSpec 的值与 evidence annotation 中的标签做匹配。
 */
export function computeTagOverlap(
  personaTagSpec: Record<string, unknown>,
  evidenceAnnotations: Array<Record<string, unknown> | null>,
): number {
  if (evidenceAnnotations.length === 0) return 0;

  // 提取画像标签的所有值（扁平化）
  const personaTagValues = new Set<string>();
  for (const val of Object.values(personaTagSpec)) {
    if (Array.isArray(val)) {
      for (const v of val) {
        if (typeof v === "string") personaTagValues.add(v.toLowerCase());
      }
    } else if (typeof val === "string") {
      personaTagValues.add(val.toLowerCase());
    }
  }

  if (personaTagValues.size === 0) return 0.5; // 无法比较时给中性值

  // 对每条证据计算标签重叠度
  const overlaps = evidenceAnnotations.map((annotation) => {
    if (!annotation) return 0;

    // 提取证据中所有标签值
    const evidenceTagValues = new Set<string>();
    const iceberg = annotation.iceberg as Record<string, string[]> | undefined;
    const framework = annotation.framework as Record<string, unknown> | undefined;

    if (iceberg) {
      for (const vals of Object.values(iceberg)) {
        if (Array.isArray(vals)) {
          for (const v of vals) {
            if (typeof v === "string") evidenceTagValues.add(v.toLowerCase());
          }
        }
      }
    }
    if (framework) {
      for (const val of Object.values(framework)) {
        if (typeof val === "string") evidenceTagValues.add(val.toLowerCase());
        if (Array.isArray(val)) {
          for (const v of val) {
            if (typeof v === "string") evidenceTagValues.add(v.toLowerCase());
          }
        }
      }
    }

    if (evidenceTagValues.size === 0) return 0;

    // 计算交集比例
    let matchCount = 0;
    for (const tag of personaTagValues) {
      if (evidenceTagValues.has(tag)) matchCount++;
    }

    return matchCount / personaTagValues.size;
  });

  // 取所有证据的平均重叠度
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