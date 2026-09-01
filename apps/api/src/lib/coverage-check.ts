// --------------------------------------------------------------
// Knowledge Coverage Check — Matrix 查表
// V0.2 Boundary Engine Layer 6
// 基于 Knowledge Coverage Matrix 做类型级确定性过滤
// 产出 MATRIX_IN / MATRIX_OUT / MATRIX_TBD
// --------------------------------------------------------------

import type { CanonicalQuery, TopicType, QuestionType } from "./normalization.js";

// ---- 矩阵类型 ----

export type EvidenceType = "statistical" | "qualitative" | "comparative" | "temporal" | null;
export type EvidenceLevel = "aggregated" | "segmented" | "individual" | null;
export type MatrixResult = "MATRIX_IN" | "MATRIX_OUT" | "MATRIX_TBD";

export interface MatrixCell {
  answerability: "IN" | "OUT" | "TBD";
  evidence_description: string;
  sample_queries: string[];
  hard_negative_examples: string[];
}

export interface CoverageCheckResult {
  matrix_result: MatrixResult;
  matched_region: string;
  matched_intent: string;
  matched_question_type: QuestionType;
  evidence_type: EvidenceType;
  evidence_level: EvidenceLevel;
  evidence_description: string | null;
  sample_queries: string[];
  hard_negative_examples: string[];
}

// ============================================================================
// Knowledge Coverage Matrix（V0.2 完整版）
// Region × Intent × Question Type × Evidence Type × Evidence Level → Answerability
// ============================================================================

// 矩阵结构：Map<region, Map<intent, Map<question_type, MatrixCell[]>>>
// MatrixCell[] 中的每个元素对应不同的 (EvidenceType, EvidenceLevel) 组合

type MatrixKey = string; // "region:intent:question_type"
type MatrixStore = Map<MatrixKey, MatrixCell[]>;

const matrix: MatrixStore = new Map();

// ---- 辅助函数：定义矩阵条目 ----

function define(
  region: string,
  intent: string,
  question_type: QuestionType,
  answerability: "IN" | "OUT" | "TBD",
  evidence_description: string,
  sample_queries: string[] = [],
  hard_negative_examples: string[] = [],
): void {
  const key = `${region}:${intent}:${question_type}`;
  if (!matrix.has(key)) {
    matrix.set(key, []);
  }
  matrix.get(key)!.push({
    answerability,
    evidence_description,
    sample_queries,
    hard_negative_examples,
  });
}

// ---- 简化版：定义 Matrix 条目（不区分 Evidence Type/Level 时使用） ----

function defineSimple(
  region: string,
  intent: string,
  question_type: QuestionType,
  answerability: "IN" | "OUT" | "TBD",
  evidence_description: string,
): void {
  define(region, intent, question_type, answerability, evidence_description);
}

// ============================================================================
// 完整 Matrix 定义
// ============================================================================

// --- weapon 区域 ---
defineSimple("weapon", "usage_rate", "what", "IN", "有武器使用率统计数据");
defineSimple("weapon", "usage_rate", "compare", "IN", "可比较不同武器使用率");
defineSimple("weapon", "usage_rate", "why", "OUT", "无偏好原因数据");
defineSimple("weapon", "usage_rate", "predict", "OUT", "无预测能力");

defineSimple("weapon", "recoil_control", "what", "IN", "有后坐力机制数据");
defineSimple("weapon", "recoil_control", "how_to", "IN", "有压枪技巧数据");
defineSimple("weapon", "recoil_control", "why", "OUT", "无设计原因数据");
defineSimple("weapon", "recoil_control", "compare", "IN", "可比较不同武器后坐力");

defineSimple("weapon", "headshot", "what", "IN", "有爆头率统计数据");
defineSimple("weapon", "headshot", "how_to", "IN", "有提高爆头率技巧数据");
defineSimple("weapon", "headshot", "compare", "IN", "可比较不同武器爆头率");
defineSimple("weapon", "headshot_rate", "what", "IN", "有爆头率统计数据");
defineSimple("weapon", "headshot_rate", "compare", "IN", "可比较不同武器爆头率");

defineSimple("weapon", "damage", "what", "IN", "有武器伤害数据");
defineSimple("weapon", "damage", "compare", "IN", "可比较不同武器伤害");
defineSimple("weapon", "damage", "why", "OUT", "无伤害设计原因数据");

defineSimple("weapon", "fire_rate", "what", "IN", "有射速数据");
defineSimple("weapon", "fire_rate", "compare", "IN", "可比较不同武器射速");

defineSimple("weapon", "reload", "what", "IN", "有换弹速度数据");
defineSimple("weapon", "preference", "what", "TBD", "取决于具体数据");
defineSimple("weapon", "preference", "why", "OUT", "无偏好原因数据");
defineSimple("weapon", "preference", "predict", "OUT", "无预测能力");

defineSimple("weapon", "popularity", "what", "IN", "有武器受欢迎程度数据");
defineSimple("weapon", "popularity", "why", "OUT", "无受欢迎原因数据");

defineSimple("weapon", "balance", "what", "TBD", "取决于具体平衡性数据");
defineSimple("weapon", "balance", "evaluate", "TBD", "取决于具体数据");
defineSimple("weapon", "balance", "predict", "OUT", "无预测能力");

defineSimple("weapon", "gun_feel", "what", "TBD", "取决于具体手感数据");
defineSimple("weapon", "gun_feel", "evaluate", "TBD", "取决于具体数据");

// --- map 区域 ---
defineSimple("map", "callouts", "what", "IN", "有地图点位数据");
defineSimple("map", "callouts", "how_to", "IN", "有战术指导数据");

defineSimple("map", "strategy", "what", "IN", "有战术数据");
defineSimple("map", "strategy", "how_to", "IN", "有战术指导数据");
defineSimple("map", "strategy", "why", "OUT", "无战术选择原因数据");
defineSimple("map", "strategy", "predict", "OUT", "无预测能力");

defineSimple("map", "preference", "what", "TBD", "取决于具体地图偏好数据");
defineSimple("map", "preference", "why", "OUT", "无偏好原因数据");

// --- game_mechanic 区域 ---
defineSimple("game_mechanic", "mechanic", "what", "IN", "有游戏机制数据");
defineSimple("game_mechanic", "mechanic", "how_to", "IN", "有机制操作指导数据");
defineSimple("game_mechanic", "mechanic", "compare", "TBD", "取决于具体机制对比数据");
defineSimple("game_mechanic", "mechanic", "why", "OUT", "无机制设计原因数据");
defineSimple("game_mechanic", "mechanic", "evaluate", "TBD", "取决于具体评价数据");

defineSimple("game_mechanic", "game_feel", "what", "TBD", "取决于具体手感数据");
defineSimple("game_mechanic", "game_feel", "evaluate", "TBD", "取决于具体评价数据");

// --- player_behavior 区域 ---
defineSimple("player_behavior", "play_pattern", "what", "IN", "有行为模式数据");
defineSimple("player_behavior", "play_pattern", "compare", "IN", "可比较不同群体");

defineSimple("player_behavior", "positioning", "what", "TBD", "取决于具体走位数据");
defineSimple("player_behavior", "positioning", "how_to", "TBD", "取决于具体数据");

defineSimple("player_behavior", "movement", "what", "TBD", "取决于具体身法数据");
defineSimple("player_behavior", "movement", "how_to", "TBD", "取决于具体数据");

defineSimple("player_behavior", "sound_awareness", "what", "TBD", "取决于具体数据");
defineSimple("player_behavior", "sound_awareness", "how_to", "TBD", "取决于具体数据");

defineSimple("player_behavior", "team_play", "what", "IN", "有组队行为数据");
defineSimple("player_behavior", "team_play", "why", "OUT", "无组队动机数据");

defineSimple("player_behavior", "voice_chat", "what", "TBD", "取决于具体语音数据");
defineSimple("player_behavior", "motivation", "what", "OUT", "无动机数据");
defineSimple("player_behavior", "motivation", "why", "OUT", "无动机数据");

defineSimple("player_behavior", "psychology", "what", "OUT", "无心理数据");
defineSimple("player_behavior", "psychology", "why", "OUT", "无心理数据");

// --- player_preference 区域 ---
defineSimple("player_preference", "preference", "what", "TBD", "取决于具体偏好数据");
defineSimple("player_preference", "preference", "why", "OUT", "无偏好原因数据");
defineSimple("player_preference", "preference", "compare", "TBD", "取决于具体对比数据");
defineSimple("player_preference", "preference", "predict", "OUT", "无预测能力");

defineSimple("player_preference", "popularity", "what", "IN", "有受欢迎程度数据");
defineSimple("player_preference", "popularity", "why", "OUT", "无受欢迎原因数据");

// --- competitive 区域 ---
defineSimple("competitive", "rank", "what", "IN", "有段位数据");
defineSimple("competitive", "rank", "compare", "IN", "可比较不同段位");
defineSimple("competitive", "rank_distribution", "what", "IN", "有段位分布数据");
defineSimple("competitive", "rank_distribution", "compare", "IN", "可比较");

defineSimple("competitive", "meta", "what", "IN", "有版本 Meta 数据");
defineSimple("competitive", "meta", "evaluate", "TBD", "取决于具体数据");
defineSimple("competitive", "meta", "predict", "OUT", "无预测能力");

defineSimple("competitive", "win_rate", "what", "IN", "有胜率数据");
defineSimple("competitive", "win_rate", "compare", "IN", "可比较");

defineSimple("competitive", "kda", "what", "IN", "有 KDA 数据");
defineSimple("competitive", "kd_ratio", "what", "IN", "有 KD 比数据");
defineSimple("competitive", "adr", "what", "TBD", "取决于具体数据");
defineSimple("competitive", "rating", "what", "TBD", "取决于具体数据");

// 战术角色
defineSimple("competitive", "entry_fragger", "what", "TBD", "取决于具体数据");
defineSimple("competitive", "awper", "what", "TBD", "取决于具体数据");
defineSimple("competitive", "igl", "what", "TBD", "取决于具体数据");
defineSimple("competitive", "support", "what", "TBD", "取决于具体数据");

// --- KOL_content 区域 ---
defineSimple("KOL_content", "content", "what", "IN", "有 KOL 内容数据");
defineSimple("KOL_content", "content", "evaluate", "TBD", "取决于具体数据");
defineSimple("KOL_content", "content", "predict", "OUT", "无预测能力");

// --- game_mode 区域 ---
defineSimple("game_mode", "ranked", "what", "IN", "有排位模式数据");
defineSimple("game_mode", "ranked", "compare", "TBD", "取决于具体对比数据");
defineSimple("game_mode", "casual", "what", "TBD", "取决于具体数据");
defineSimple("game_mode", "deathmatch", "what", "TBD", "取决于具体数据");

// --- economy 区域 ---
defineSimple("economy", "skin", "what", "TBD", "取决于具体皮肤数据");
defineSimple("economy", "skin", "what", "TBD", "取决于具体数据");
defineSimple("economy", "cosmetic", "what", "TBD", "取决于具体饰品数据");
defineSimple("economy", "battle_pass", "what", "TBD", "取决于具体数据");
defineSimple("economy", "pay_to_win", "evaluate", "TBD", "取决于具体数据");
defineSimple("economy", "monetization", "evaluate", "TBD", "取决于具体数据");

// --- meta 区域 ---
defineSimple("meta", "meta", "what", "IN", "有版本 Meta 数据");
defineSimple("meta", "meta", "evaluate", "TBD", "取决于具体数据");
defineSimple("meta", "meta", "predict", "OUT", "无预测能力");
defineSimple("meta", "predict", "what", "OUT", "无预测能力");
defineSimple("meta", "predict", "predict", "OUT", "无预测能力");
defineSimple("meta", "trend", "what", "OUT", "无趋势预测能力");
defineSimple("meta", "trend", "predict", "OUT", "无趋势预测能力");
defineSimple("meta", "next_season", "predict", "OUT", "无预测能力");
defineSimple("meta", "nerf_prediction", "predict", "OUT", "无预测能力");
defineSimple("meta", "buff_prediction", "predict", "OUT", "无预测能力");
defineSimple("meta", "update", "what", "TBD", "取决于具体更新数据");
defineSimple("meta", "update", "predict", "OUT", "无预测能力");

// ============================================================================
// 查表函数
// ============================================================================

/**
 * 在 Knowledge Coverage Matrix 中查找 (region, intent, question_type) 组合。
 * 如果 intent 为 null，返回 MATRIX_TBD。
 */
export function lookupMatrix(
  canonical: CanonicalQuery,
): CoverageCheckResult {
  const region = canonical.topic ?? "unknown";
  const intent = canonical.intent ?? "unknown";
  const questionType = canonical.question_type;

  const key = `${region}:${intent}:${questionType}`;
  const cells = matrix.get(key);

  if (!cells || cells.length === 0) {
    // 矩阵中没有该组合 → TBD
    return {
      matrix_result: "MATRIX_TBD",
      matched_region: region,
      matched_intent: intent,
      matched_question_type: questionType,
      evidence_type: null,
      evidence_level: null,
      evidence_description: null,
      sample_queries: [],
      hard_negative_examples: [],
    };
  }

  // 找到第一个非 TBD 的结果；如果全是 TBD，返回 TBD
  const definitiveCell = cells.find((c) => c.answerability !== "TBD");
  const bestCell = definitiveCell ?? cells[0]!;

  const matrixResult: MatrixResult = bestCell.answerability === "IN"
    ? "MATRIX_IN"
    : bestCell.answerability === "OUT"
    ? "MATRIX_OUT"
    : "MATRIX_TBD";

  return {
    matrix_result: matrixResult,
    matched_region: region,
    matched_intent: intent,
    matched_question_type: questionType,
    evidence_type: null,
    evidence_level: null,
    evidence_description: bestCell.evidence_description,
    sample_queries: bestCell.sample_queries,
    hard_negative_examples: bestCell.hard_negative_examples,
  };
}

/**
 * 获取 Matrix 中所有已定义的条目数（用于监控）。
 */
export function getMatrixSize(): number {
  return matrix.size;
}

/**
 * 获取 Matrix 中所有条目的摘要（用于调试）。
 */
export function getMatrixSummary(): Array<{
  region: string;
  intent: string;
  question_type: string;
  answerability: string;
}> {
  const summary: Array<{
    region: string;
    intent: string;
    question_type: string;
    answerability: string;
  }> = [];
  for (const [key, cells] of matrix.entries()) {
    const [region, intent, question_type] = key.split(":");
    for (const cell of cells) {
      summary.push({
        region: region!,
        intent: intent!,
        question_type: question_type!,
        answerability: cell.answerability,
      });
    }
  }
  return summary;
}

/**
 * 获取 Matrix 中所有 MATRIX_OUT 的条目（用于 Hard Negative 分析）。
 */
export function getMatrixOutEntries(): Array<{
  region: string;
  intent: string;
  question_type: string;
  evidence_description: string;
}> {
  const entries: Array<{
    region: string;
    intent: string;
    question_type: string;
    evidence_description: string;
  }> = [];
  for (const [key, cells] of matrix.entries()) {
    const [region, intent, question_type] = key.split(":");
    for (const cell of cells) {
      if (cell.answerability === "OUT") {
        entries.push({
          region: region!,
          intent: intent!,
          question_type: question_type!,
          evidence_description: cell.evidence_description,
        });
      }
    }
  }
  return entries;
}