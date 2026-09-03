// --------------------------------------------------------------
// cn = classnames merge —— shadcn 生态标配的类名合并工具
// - clsx 处理"条件类名"：cn("base", condition && "extra")
// - twMerge 处理"冲突类名"：cn("p-2", "p-4") 结果只保留 p-4
// 组合起来 = 写 UI 组件时最舒服的类名 API
// --------------------------------------------------------------

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 把课程/章节序号补零到 2 位 —— 元培古典风的编号样式
 * formatIndex(0) → "00"，formatIndex(7) → "07"，formatIndex(12) → "12"
 */
export function formatIndex(n: number) {
  return String(n).padStart(2, "0");
}

/**
 * 格式化剩余时间（毫秒）为可读字符串
 * formatRemainingTime(65000)  → "预计剩余 1 分 5 秒"
 * formatRemainingTime(30000)  → "预计剩余 30 秒"
 * formatRemainingTime(0)      → "处理中..."
 * formatRemainingTime(undefined) → "处理中..."
 */
export function formatRemainingTime(ms?: number): string {
  if (ms === undefined || ms === null || ms <= 0) return "处理中...";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `预计剩余 ${minutes} 分 ${seconds} 秒`;
  }
  return `预计剩余 ${seconds} 秒`;
}

// ---- 画像可信度计算 ----

/** 画像的 5 个标签维度 */
const PERSONA_DIMENSIONS = ["诉求", "能力", "风格", "平台", "模式"] as const;

export interface PersonaConfidenceInput {
  sampleCount: number;
  evidenceCount: number;
  tagSpec: Record<string, unknown>;
  motivationChain: Record<string, unknown> | null;
}

/**
 * 综合计算群体画像可信度（0-1）。
 *
 * 四个维度加权：
 * - 样本量（50%）：对数映射，0 样本 → 0，100+ 样本 → 1.0
 * - 证据丰富度（20%）：证据条数 / 样本数映射，证据越多越可靠
 * - 标签完整度（20%）：5 个维度中已填充的比例
 * - 动机链（10%）：是否已构建冰山模型
 *
 * 返回值范围 [0.10, 0.95]，避免极端 0% 或 100%。
 */
export function computePersonaConfidence(input: PersonaConfidenceInput): number {
  const { sampleCount, evidenceCount, tagSpec, motivationChain } = input;

  // 1. 样本量得分：对数映射，100 样本 → 满分
  const sampleScore = Math.min(1, Math.log(sampleCount + 1) / Math.log(101));

  // 2. 证据丰富度：绝对证据量，15 条 → 满分
  const evidenceScore = Math.min(1, evidenceCount / 15);

  // 3. 标签完整度：5 个维度中有值的比例
  let filledDims = 0;
  for (const dim of PERSONA_DIMENSIONS) {
    const val = tagSpec[dim];
    if (val) {
      if (Array.isArray(val) && val.length > 0) filledDims++;
      else if (typeof val === "string" && val.length > 0) filledDims++;
    }
  }
  const tagCompleteness = filledDims / PERSONA_DIMENSIONS.length;

  // 4. 动机链：是否已构建
  const hasMotivation = motivationChain && Object.keys(motivationChain).length > 0;

  // 加权综合
  const score =
    sampleScore * 0.5 +
    evidenceScore * 0.2 +
    tagCompleteness * 0.2 +
    (hasMotivation ? 0.1 : 0);

  // 四舍五入到两位小数，限制在 [0.10, 0.95]
  return Math.round(Math.min(0.95, Math.max(0.1, score)) * 100) / 100;
}
