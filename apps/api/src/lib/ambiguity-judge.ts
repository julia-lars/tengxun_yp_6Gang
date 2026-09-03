// --------------------------------------------------------------
// Ambiguity Judge — LLM 模糊边界判定
// V0.3 Boundary Engine Layer 5
// 仅当 Layer 4 (Game Relevance Rules) 返回 AMBIGUOUS 时触发
// temperature=0，固定 Prompt，输出 JSON
// --------------------------------------------------------------

import { chat } from "./llm.js";

export interface AmbiguityJudgeResult {
  decision: "IN" | "OUT";
  reason: string;
}

const SYSTEM_PROMPT = "你只输出合法 JSON 对象，不输出任何解释或 markdown 代码块。回复必须以 { 开头，以 } 结尾。";

function buildPrompt(query: string, context?: string): string {
  return `你是射击游戏领域边界检测器。判断以下用户问题是否与射击游戏领域有关。

## 用户问题
${query}

${context ? `## 对话上下文\n${context}` : "## 对话上下文\n无"}

## 射击游戏领域定义
包括：CS2、Valorant、PUBG、Apex、COD、Overwatch、穿越火线、彩虹六号、三角洲行动、暗区突围、永劫无间等 FPS/TPS 游戏，以及相关的武器、地图、战术、玩家行为、竞技、游戏模式、Meta、更新等内容。

## 判定标准（按优先级从高到低）
1. OUT：问题明确属于非射击游戏类型（桌游、MOBA、RPG、卡牌、休闲派对、体育竞速、音游、养成等），即使问题中有"游戏""玩"等词汇。例如"阿瓦隆"是桌游不属于射击游戏、"王者荣耀"是MOBA不属于射击游戏
2. OUT：问题属于生活闲聊、个人状态询问、纯社交问候等非游戏领域
3. OUT：问题属于其他明确非游戏领域（天气、股票、编程、烹饪、电影等）
4. IN：问题明确与射击游戏有关（询问游戏机制、武器、战术、玩家偏好、游戏体验、版本更新等）
5. IN：问题包含射击游戏实体名称（CS2、Valorant、AK、AWP、Dust2 等）
6. IN：问题模糊但对话上下文明确为射击游戏语境
7. IN：问题无法确定是否与射击游戏相关，且上下文信息不足时，默认判定为 IN

## 输出格式
只输出一个 JSON 对象：
{"decision":"IN或OUT","reason":"简要说明判定依据"}`;
}

/**
 * 调用 LLM 对模糊问题进行领域判定。
 * 仅当规则引擎返回 AMBIGUOUS 时触发。
 * temperature=0，固定 Prompt。
 */
export async function runAmbiguityJudge(
  query: string,
  context?: string,
): Promise<AmbiguityJudgeResult> {
  try {
    const result = await chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildPrompt(query, context) },
      ],
      { temperature: 0, maxTokens: 256 },
    );

    const trimmed = result.trim();
    const jsonStart = trimmed.indexOf("{");
    const jsonEnd = trimmed.lastIndexOf("}");

    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
      const decision = parsed.decision === "IN" ? "IN" : "OUT";
      return {
        decision,
        reason: typeof parsed.reason === "string" ? parsed.reason : "无说明",
      };
    }
  } catch (e) {
    console.error("Ambiguity Judge 调用失败:", e);
  }

  // 保守策略：解析失败时返回 OUT
  return { decision: "OUT", reason: "LLM 解析失败，保守判定为 OUT" };
}
