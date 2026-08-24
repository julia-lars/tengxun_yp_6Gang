// --------------------------------------------------------------
// 标签展示工具：从 tagSpec 中提取最有区分度的 5 个标签
// 每个维度选 1 个，维度缺失时按 fallback 优先级填充
// --------------------------------------------------------------

export interface TagItem {
  /** 维度中文名 */
  dim: string;
  /** 风格轴名（仅风格维度） */
  axis?: string;
  /** 标签值 */
  value: string;
}

/** 维度展示配置 */
export const DIM_CONFIG: Record<string, { label: string; color: string }> = {
  "诉求": { label: "诉求", color: "bg-(--color-brand-50) text-(--color-brand-700)" },
  "能力": { label: "能力", color: "bg-amber-50 text-amber-700" },
  "战斗": { label: "战斗", color: "bg-emerald-50 text-emerald-700" },
  "决策": { label: "决策", color: "bg-emerald-50 text-emerald-700" },
  "取胜": { label: "取胜", color: "bg-emerald-50 text-emerald-700" },
  "成长": { label: "成长", color: "bg-emerald-50 text-emerald-700" },
  "社交": { label: "社交", color: "bg-emerald-50 text-emerald-700" },
  "平台": { label: "平台", color: "bg-slate-50 text-slate-700" },
  "模式": { label: "模式", color: "bg-rose-50 text-rose-700" },
};

/** 风格 5 轴：index → 轴名 */
const STYLE_AXIS_LABELS = ["战斗", "决策", "取胜", "成长", "社交"];

/** 风格 fallback 优先级（索引顺序）：social(4) > decision(1) > victory(2) > growth(3) */
const STYLE_FALLBACK_ORDER = [4, 1, 2, 3];

/** 风格中性值（无区分度，fallback 时跳过） */
const STYLE_NEUTRAL = new Set(["灵活平衡", "情境切换", "团队个人平衡", "混合", "均可"]);

/** 从 tagSpec 获取字符串数组 */
function getArray(spec: Record<string, string | string[]>, key: string): string[] {
  const val = spec[key];
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

/** 从 tagSpec 获取字符串 */
function getString(spec: Record<string, string | string[]>, key: string): string | null {
  const val = spec[key];
  if (!val) return null;
  if (Array.isArray(val)) return val.length > 0 ? (val[0] ?? null) : null;
  return val;
}

/**
 * 从 tagSpec 中提取最有区分度的标签。
 * 优先级：诉求[0] → 能力 → 风格[0]战斗 → 平台 → 模式
 * 缺失 fallback：风格[4]社交 → 风格[1]决策 → 诉求[1] → 风格[2]取胜 → 风格[3]成长
 */
export function extractTopTags(
  spec: Record<string, string | string[]>,
  maxCount = 5,
): TagItem[] {
  const needs = getArray(spec, "诉求");
  const ability = getString(spec, "能力");
  const style = getArray(spec, "风格");
  const platform = getString(spec, "平台");
  const mode = getString(spec, "模式");

  const result: TagItem[] = [];
  const usedNeedIdx = new Set<number>();
  const usedStyleIdx = new Set<number>();

  // 1. 诉求[0]
  if (needs.length > 0) {
    result.push({ dim: "诉求", value: needs[0]! });
    usedNeedIdx.add(0);
  }

  // 2. 能力
  if (ability) {
    result.push({ dim: "能力", value: ability });
  }

  // 3. 风格[0] 战斗
  if (style.length > 0) {
    result.push({ dim: "战斗", value: style[0]! });
    usedStyleIdx.add(0);
  }

  // 4. 平台
  if (platform) {
    result.push({ dim: "平台", value: platform });
  }

  // 5. 模式
  if (mode) {
    result.push({ dim: "模式", value: mode });
  }

  // Fallback 填充至 maxCount（跳过中性值）
  const fallbackSources = [
    ...STYLE_FALLBACK_ORDER.filter(
      (i) => style.length > i && !usedStyleIdx.has(i) && !STYLE_NEUTRAL.has(style[i]!),
    ).map(
      (i) => () => {
        if (result.length >= maxCount) return;
        result.push({ dim: STYLE_AXIS_LABELS[i]!, value: style[i]! });
        usedStyleIdx.add(i);
      },
    ),
    // 中性风格值兜底
    ...STYLE_FALLBACK_ORDER.filter(
      (i) => style.length > i && !usedStyleIdx.has(i),
    ).map(
      (i) => () => {
        if (result.length >= maxCount) return;
        result.push({ dim: STYLE_AXIS_LABELS[i]!, value: style[i]! });
        usedStyleIdx.add(i);
      },
    ),
    // 诉求[1], 诉求[2]
    ...[1, 2].filter((i) => needs.length > i && !usedNeedIdx.has(i)).map((i) => () => {
      if (result.length >= maxCount) return;
      result.push({ dim: "诉求", value: needs[i]! });
      usedNeedIdx.add(i);
    }),
  ];

  for (const fn of fallbackSources) {
    if (result.length >= maxCount) break;
    fn();
  }

  return result.slice(0, maxCount);
}

/** 计算全部标签总数（用于显示 +N 更多） */
export function countAllTags(spec: Record<string, string | string[]>): number {
  const needs = getArray(spec, "诉求");
  const ability = getString(spec, "能力");
  const style = getArray(spec, "风格");
  const platform = getString(spec, "平台");
  const mode = getString(spec, "模式");

  return (
    needs.length +
    (ability ? 1 : 0) +
    style.length +
    (platform ? 1 : 0) +
    (mode ? 1 : 0)
  );
}

/** 计算剩余未展示标签数 */
export function getRemainingCount(
  spec: Record<string, string | string[]>,
  shown: number,
): number {
  return Math.max(0, countAllTags(spec) - shown);
}