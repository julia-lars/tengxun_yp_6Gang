// --------------------------------------------------------------
// LLM Evidence Judge — 结构化四维度判定
// V0.2 Boundary Engine Layer 7
// 仅当 CANDIDATE + (MATRIX_IN 或 MATRIX_TBD) 时触发
// temperature=0，固定 Prompt，输出 JSON
// --------------------------------------------------------------

import { chat } from "./llm.js";
import type { CanonicalQuery } from "./normalization.js";
import type { CoverageCheckResult } from "./coverage-check.js";

// ---- 判定结果类型 ----

export interface EvidenceJudgeResult {
  B1_domain: "IN" | "OUT";
  B2_topic_coverage: "IN" | "OUT";
  B3_question_type_capability: "IN" | "OUT";
  B4_evidence_sufficiency: "IN" | "OUT";
  final: "IN" | "OUT";
  reasoning: string;
}

// ---- LLM 判定 Prompt ----

function buildJudgePrompt(
  query: string,
  canonical: CanonicalQuery,
  coverageResult: CoverageCheckResult,
  embeddingInfo: {
    top_region: string;
    region_score: number;
    hn_proximity_warning: boolean;
  },
): string {
  return `你是问题边界检测器。你的任务是判断用户问题是否在系统的知识边界内。
你必须严格依据以下规范进行判断，不得依靠你自己的世界知识。

## 用户问题
${query}

## 标准化结果
- 领域: ${canonical.domain}
- 游戏: ${canonical.game ?? "未识别"}
- 实体: ${canonical.entity ?? "未识别"}
- 主题: ${canonical.topic ?? "未识别"}
- 意图: ${canonical.intent ?? "未识别"}
- 问题类型: ${canonical.question_type}

## 语义覆盖信号
- 最接近的知识区域: ${embeddingInfo.top_region}
- 区域相似度: ${embeddingInfo.region_score}
- Hard Negative 接近警告: ${embeddingInfo.hn_proximity_warning ? "是（该问题异常接近已知的不可回答样本）" : "否"}

## Knowledge Coverage Matrix 查表结果
- Matrix 判定: ${coverageResult.matrix_result}
- 匹配区域: ${coverageResult.matched_region}
- 匹配意图: ${coverageResult.matched_intent}
- 证据说明: ${coverageResult.evidence_description ?? "无"}

## 判定框架

请按以下四个维度逐一判定，每个维度只能输出 IN 或 OUT：

**B1. Domain（领域）— 必要条件**
- IN: 该问题属于射击游戏领域（CS2 / Valorant / PUBG / Apex / COD / Overwatch / CF / R6 / 三角洲 / 暗区突围 等）
- OUT: 不属于射击游戏领域 → 直接 OUT
- 判定依据: 标准化结果中的 domain 字段 + 用户问题内容

**B2. Topic Coverage（主题覆盖）— 必要条件**
- IN: 数据库覆盖该问题涉及的主题（武器 / 地图 / 游戏机制 / 玩家行为 / 玩家偏好 / 竞技 / KOL内容 / 游戏模式 / 经济 / Meta）
- OUT: 数据库未覆盖该主题 → 直接 OUT
- 判定依据: 标准化结果中的 topic 字段是否在数据库覆盖范围内

**B3. Question Type Capability（问题类型能力）— 类型级必要条件**
- IN: 系统具备回答该问题类型的能力（即该类型的问题在原则上有数据支持）
- OUT: 系统不具备该能力 → 直接 OUT
- 判定依据: Knowledge Coverage Matrix 查表结果。MATRIX_IN 表示类型级支持，MATRIX_OUT 表示不支持
- 关键区分: B3 判断的是"类型级能力"，而非"实例级证据"。例如"数据库是否有能力回答关于武器使用率的 what 问题"是 B3，"数据库是否有 AK-47 的特定使用率数据"是 B4

**B4. Evidence Sufficiency（证据充分性）— 实例级决定性条件**
- IN: 对于该具体问题实例，数据库存在足够证据支撑回答
- OUT: 证据不足 → 即使 B1-B3 全部 IN，仍为 OUT
- 判定依据: 该问题的具体实体、条件、粒度是否在数据库中有对应证据
- 关键区分: B4 判断的是"实例级证据"，而非"类型级能力"

**Final 判定:**
- IN = B1 ∧ B2 ∧ B3 ∧ B4（四个维度全部 IN）
- OUT = ¬(B1 ∧ B2 ∧ B3 ∧ B4)（任一维度 OUT）

**特别提醒:**
- 如果问题包含特定时间条件（如"2024年3月"、"上赛季"）且数据库没有该粒度数据 → B4 = OUT
- 如果问题包含量化条件（如"排名前10"、"比例最高的"）且数据库没有该粒度数据 → B4 = OUT
- 如果问题包含修饰词（如"高级"、"深度"、"最新"）且数据库没有对应深度的数据 → B4 = OUT
- 如果 hn_proximity_warning = 是，应更严格地审视 B4 判定

只输出一个 JSON 对象，不要输出任何其它文字：
{
  "B1_domain": "IN",
  "B2_topic_coverage": "IN",
  "B3_question_type_capability": "IN",
  "B4_evidence_sufficiency": "IN",
  "final": "IN",
  "reasoning": "简要说明判定依据，特别说明 B3（类型级）vs B4（实例级）的区分"
}`;
}

// ---- 判定函数 ----

const SYSTEM_PROMPT = "你只输出合法 JSON 对象，不输出任何解释或 markdown 代码块。回复必须以 { 开头，以 } 结尾。";

/**
 * 调用 LLM Evidence Judge 对灰区问题进行最终判定。
 * temperature=0，固定 Prompt。
 */
export async function runEvidenceJudge(
  query: string,
  canonical: CanonicalQuery,
  coverageResult: CoverageCheckResult,
  embeddingInfo: {
    top_region: string;
    region_score: number;
    hn_proximity_warning: boolean;
  },
): Promise<EvidenceJudgeResult> {
  const prompt = buildJudgePrompt(query, canonical, coverageResult, embeddingInfo);

  try {
    const result = await chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      { temperature: 0, maxTokens: 1024 },
    );

    return parseJudgeResult(result);
  } catch (e) {
    console.error("Evidence Judge 调用失败:", e);
    // 保守策略：LLM 调用失败时返回 OUT
    return {
      B1_domain: "IN",
      B2_topic_coverage: "IN",
      B3_question_type_capability: "IN",
      B4_evidence_sufficiency: "OUT",
      final: "OUT",
      reasoning: `LLM 调用失败，保守判定为 OUT。错误: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * 解析 LLM 返回的 JSON 判定结果。
 */
function parseJudgeResult(raw: string): EvidenceJudgeResult {
  const trimmed = raw.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");

  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    console.error("Evidence Judge 返回格式异常:", trimmed.slice(0, 200));
    return {
      B1_domain: "IN",
      B2_topic_coverage: "IN",
      B3_question_type_capability: "IN",
      B4_evidence_sufficiency: "OUT",
      final: "OUT",
      reasoning: "LLM 返回格式异常，保守判定为 OUT",
    };
  }

  try {
    const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;

    // 验证并规范化字段
    const B1 = validateDimension(parsed.B1_domain);
    const B2 = validateDimension(parsed.B2_topic_coverage);
    const B3 = validateDimension(parsed.B3_question_type_capability);
    const B4 = validateDimension(parsed.B4_evidence_sufficiency);

    const final = (B1 === "IN" && B2 === "IN" && B3 === "IN" && B4 === "IN") ? "IN" : "OUT";

    return {
      B1_domain: B1,
      B2_topic_coverage: B2,
      B3_question_type_capability: B3,
      B4_evidence_sufficiency: B4,
      final,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 500) : "无推理说明",
    };
  } catch (e) {
    console.error("Evidence Judge JSON 解析失败:", e);
    return {
      B1_domain: "IN",
      B2_topic_coverage: "IN",
      B3_question_type_capability: "IN",
      B4_evidence_sufficiency: "OUT",
      final: "OUT",
      reasoning: "JSON 解析失败，保守判定为 OUT",
    };
  }
}

function validateDimension(value: unknown): "IN" | "OUT" {
  if (value === "IN" || value === "OUT") return value;
  // 容错：小写转换
  if (typeof value === "string") {
    const upper = value.toUpperCase();
    if (upper === "IN" || upper === "OUT") return upper as "IN" | "OUT";
  }
  return "OUT"; // 默认保守
}