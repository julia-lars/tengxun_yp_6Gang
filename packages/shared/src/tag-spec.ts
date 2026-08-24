// --------------------------------------------------------------
// 标签特征（TagSpec）— 画像标签的规范结构 + 转换层
//
// 单一数据源：同一份 TagSpec 驱动三个场景
//   1. 新建画像 / 群体画像筛选  —— 标签选择器
//   2. AI 对话                   —— tagSpecToPrompt() 生成自然语言人格
//   3. 聚类                      —— tagSpecToFeatures() 生成特征向量
//
// v1（旧扁平格式 {诉求,能力,风格,平台,模式}）通过 normalizeTagSpec 兼容迁移
// --------------------------------------------------------------

import { z } from "zod";
import { getDimension } from "./tags.js";

// ---- 风格 5 轴（旧扁平格式按值域归属到轴）----
type StyleKey = "combat" | "decision" | "victory" | "growth" | "social";

const STYLE_AXES: { key: StyleKey; label: string; values: readonly string[] }[] = [
  { key: "combat", label: "战斗倾向", values: ["主动求战/刚枪", "灵活平衡", "苟活避战"] },
  { key: "decision", label: "决策方式", values: ["仔细思考/策略", "情境切换", "本能快速反应"] },
  { key: "victory", label: "取胜方式", values: ["团队协作取胜", "团队个人平衡", "个人能力取胜"] },
  { key: "growth", label: "成长方式", values: ["数值养成", "混合", "操作技巧对抗"] },
  { key: "social", label: "社交方式", values: ["熟人开黑", "均可", "陌生人/单人"] },
];

// ---- 规范化 TagSpec（v2）----
export const tagSpecSchema = z.object({
  version: z.literal(2).default(2),
  needs: z.array(z.string()).default([]),
  ability: z
    .object({
      level: z.string().nullable().default(null),
      strengths: z.array(z.string()).default([]),
      weaknesses: z.array(z.string()).default([]),
    })
    .default({ level: null, strengths: [], weaknesses: [] }),
  style: z
    .object({
      combat: z.string().nullable().default(null),
      decision: z.string().nullable().default(null),
      victory: z.string().nullable().default(null),
      growth: z.string().nullable().default(null),
      social: z.string().nullable().default(null),
    })
    .default({ combat: null, decision: null, victory: null, growth: null, social: null }),
  platform: z
    .object({
      primary: z.string().nullable().default(null),
      secondary: z.string().nullable().default(null),
    })
    .default({ primary: null, secondary: null }),
  mode: z
    .object({
      structure: z.string().nullable().default(null),
      submodes: z.record(z.enum(["like", "avoid"])).default({}),
    })
    .default({ structure: null, submodes: {} }),
});
export type TagSpec = z.infer<typeof tagSpecSchema>;

// ---- 工具函数 ----

function firstDefined(...values: unknown[]): unknown {
  for (const v of values) {
    if (v != null && v !== "") return v;
  }
  return undefined;
}

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length > 0) return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
  return null;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v))
    return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  if (typeof v === "string" && v.trim().length > 0) return [v];
  return [];
}

function mapStyle(values: string[]): TagSpec["style"] {
  const result: TagSpec["style"] = {
    combat: null,
    decision: null,
    victory: null,
    growth: null,
    social: null,
  };
  for (const v of values) {
    const axis = STYLE_AXES.find((a) => a.values.includes(v));
    if (axis) {
      result[axis.key] = v;
    }
  }
  return result;
}

// ---- normalizeTagSpec：兼容 v1 扁平格式 + v2 嵌套格式 ----

/**
 * 将任意输入规范化为 TagSpec v2。
 * 兼容旧扁平格式 {诉求, 能力, 风格, 平台, 模式} 和新嵌套格式。
 * 空 / null 输入返回全默认值。
 */
export function normalizeTagSpec(input: unknown): TagSpec {
  if (input == null || typeof input !== "object") return tagSpecSchema.parse({});
  const raw = input as Record<string, unknown>;

  // v2：已经是嵌套结构
  if (raw.version === 2) {
    const parsed = tagSpecSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
  }

  // v1：扁平结构 {诉求, 能力, 风格, 平台, 模式}
  const needs = asStringArray(firstDefined(raw["诉求"], raw.needs));
  const abilityLevel = asString(firstDefined(raw["能力"], raw.ability));
  const styleValues = asStringArray(firstDefined(raw["风格"], raw.style));
  const platformPrimary = asString(firstDefined(raw["平台"], raw.platform));
  const modeStructure = asString(firstDefined(raw["模式"], raw.mode));

  return {
    version: 2,
    needs,
    ability: { level: abilityLevel, strengths: [], weaknesses: [] },
    style: mapStyle(styleValues),
    platform: { primary: platformPrimary, secondary: null },
    mode: { structure: modeStructure, submodes: {} },
  };
}

// ---- tagSpecToPrompt：自然语言人格描述（分维度陈述）----

/** 诉求值 → 一句话释义（来自共享标签维度定义） */
const NEED_DESC = new Map<string, string | undefined>(
  (getDimension("诉求")?.values ?? []).map((v) => [v.value, v.description]),
);

function needDescription(value: string): string | undefined {
  return NEED_DESC.get(value);
}

/**
 * 将 TagSpec 渲染为结构化自然语言，直接作为 AI system prompt 的「玩家画像」段落。
 * 空标签集返回空字符串。
 */
export function tagSpecToPrompt(tagSpec: TagSpec): string {
  const lines: string[] = [];

  // 表层身份：能力等级 + 平台 + 模式
  const identity: string[] = [];
  const level = tagSpec.ability.level;
  if (level && level !== "未知") identity.push(`${level}水平`);
  const platform = tagSpec.platform.primary;
  if (platform && platform !== "未知") identity.push(`主要在 ${platform} 端玩`);
  const mode = tagSpec.mode.structure;
  if (mode) identity.push(`偏好 ${mode} 模式`);
  if (identity.length) lines.push(`你是一名${identity.join("、")}的玩家。`);

  // 深层：核心诉求（按优先级，带释义）
  if (tagSpec.needs.length) {
    lines.push("");
    lines.push("你的核心诉求（按重要程度排序）：");
    tagSpec.needs.forEach((n, i) => {
      const desc = needDescription(n);
      lines.push(`${i + 1}. ${n}${desc ? `——${desc}` : ""}；`);
    });
  }

  // 能力强项 / 短板
  const { strengths, weaknesses } = tagSpec.ability;
  if (strengths.length || weaknesses.length) {
    const parts: string[] = [];
    if (strengths.length) parts.push(`强项是${strengths.join("、")}`);
    if (weaknesses.length) parts.push(`短板是${weaknesses.join("、")}`);
    lines.push(`你在能力上${parts.join("，")}。`);
  }

  // 风格 5 轴（分维度陈述）
  const styleLines = STYLE_AXES.filter((a) => tagSpec.style[a.key] != null).map(
    (a) => `- ${a.label}：${tagSpec.style[a.key]}；`,
  );
  if (styleLines.length) {
    lines.push("");
    lines.push("你的游戏风格：");
    lines.push(...styleLines);
  }

  return lines.join("\n");
}

// ---- tagSpecToFeatures：聚类特征向量 ----

/**
 * 将 TagSpec 映射为聚类特征向量（键值对）。
 * 名义变量（诉求/强项/短板）做 one-hot，序数变量（等级/风格轴/平台/模式）保留原值。
 * 实际聚类（HDBSCAN + Gower 距离）在 Python 流水线中完成，此函数提供特征编码。
 */
export function tagSpecToFeatures(tagSpec: TagSpec): Record<string, string | number> {
  const f: Record<string, string | number> = {};
  for (const n of tagSpec.needs) f[`need:${n}`] = 1;
  if (tagSpec.ability.level) f["ability.level"] = tagSpec.ability.level;
  for (const s of tagSpec.ability.strengths) f[`ability.strength:${s}`] = 1;
  for (const w of tagSpec.ability.weaknesses) f[`ability.weakness:${w}`] = 1;
  for (const a of STYLE_AXES) {
    const v = tagSpec.style[a.key];
    if (v) f[`style.${a.key}`] = v;
  }
  if (tagSpec.platform.primary) f["platform.primary"] = tagSpec.platform.primary;
  if (tagSpec.mode.structure) f["mode.structure"] = tagSpec.mode.structure;
  for (const [name, state] of Object.entries(tagSpec.mode.submodes)) {
    f[`mode.submode:${name}`] = state;
  }
  return f;
}