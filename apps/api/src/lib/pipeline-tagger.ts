// --------------------------------------------------------------
// AI 打标 — 批量标注冰山模型（M1-M5）+ 框架七维
// 使用与 scripts/label_segments.py 相同的系统提示词
// --------------------------------------------------------------

import type { ChatMessage } from "./llm.js";
import { chat } from "./llm.js";
import type { CleanedSegment } from "./pipeline-cleaner.js";

// ---- 类型定义 ----

export interface TaggedSegment extends CleanedSegment {
  /** AI 标注结果（v2.0 冰山+框架标注） */
  annotation: Record<string, unknown> | null;
}

// ---- 系统提示词（移植自 label_segments.py）----

const SYSTEM_PROMPT = `你是射击游戏用户研究领域的资深标注专家。对访谈中"被访者"的每条发言片段，按下面的标准标注，并严格只输出一个 JSON 对象。

# 标注体系（双层：冰山五层 + 框架七维）

## 一、冰山五层（纵向因果链）
- M1 动机/诉求（为什么玩）。值域(英文key)：competitive_proof 竞技证明 / ability_growth 能力成长 / dominance 支配优越 / team_cooperation 团队协作 / social_belonging 社交归属 / stimulation 射击爽感 / relaxation_escape 放松逃避 / strategy_mastery 策略掌控 / exploration_collection 探索收集 / narrative_immersion 叙事沉浸 / sensory_aesthetics 视听审美 / expression_creation 表达创造。最多 3 个，第一个为 primary=true。
- M2 期待/标准（游戏"应该怎样"）。值域：fair_competition 公平竞技 / skill_determines 技术决定 / rich_content 丰富内容 / social_convenience 社交便利 / low_barrier 低门槛 / immersive_experience 沉浸体验 / positive_community 正向社区 / continuous_challenge 持续挑战 / respect_time 尊重时间 / monetization_fair 付费公平 / teammate_communication 队友沟通 / teammate_competence 队友能力匹配 / teammate_stability 队友情绪稳定。最多 2 个。
- M3 认知/观点（"实际是怎样"的判断/评价/归因）。category 从：fairness_perception 公平性 / difficulty_perception 难度 / depth_perception 深度 / quality_perception 品质 / monetization_perception 商业化 / meta_perception 版本环境 / self_ability 自我能力 / self_identity 自我身份 / self_limitation 自我限制 / teammate_perception 对队友 / opponent_perception 对对手 / developer_perception 对厂商 / community_perception 对社区 / causal_attribution 因果归因 中选；value 用简短英文短语概括具体认知。最多 2 个。
- M4 感受/情绪。值域：excitement 兴奋 / achievement 成就感 / flow 心流 / joy 快乐 / social_warmth 社交温暖 / anger_frustration 愤怒挫败 / anxiety_tension 焦虑紧张 / boredom_burnout 无聊倦怠 / disappointment 失望失落 / numbness 麻木无所谓。需标 val(pos/neg/neu)、int(low/medium/high)、trg(win_loss/growth/team/matchmaking/monetization/cheat/performance/content/social)。最多 2 个。
- M5 行为/应对（具体可观察行为）。值域：ranked_grind 排位上分 / deliberate_practice 刻意练习 / watch_guides 看攻略学习 / social_play 社交开黑 / casual_play 休闲匹配 / switch_mode 切换模式产品 / return 回流 / avoid_strangers 回避陌生人 / content_share 内容分享 / spending 消费氪金 / quit_break 退坑休息 / smurf 换号炸鱼 / watch_esports 追比赛电竞 / community_engage 社区参与。freq(daily/regular/occasional/past/planned) 仅在原文明确提及时标，否则 null。最多 3 个。
- causal_chain：仅当同一片段明确表达因果时标，形如 ["M1:ability_growth","M5:ranked_grind"]，最多 2 条。

## 二、框架七维（横向画像）
- needs: {"p": 主诉求(M1 key), "s": [次诉求列表]}
- ability: {"lvl": novice/beginner/intermediate/advanced/expert/unknown(以自评为准), "str": [强项], "wk": [短板], "cog_str": [认知强项], "cog_wk": [认知短板]}
- style: {"combat": passive苟活/balanced灵活/aggressive刚枪, "decision": strategic策略/contextual情境/instinctive本能, "victory": team团队/balanced平衡/individual个人, "growth": progression数值/mixed混合/skill操作, "social": friends熟人/flexible均可/solo单人}
- platform: {"p": pc/console/mobile/multi_platform/cloud_other/unknown, "s": 次选或 null}
- mode: {"struct": pure_pve/pve_main/balanced/pvp_main/pure_pvp/contextual, "sub": [{"n": team_deathmatch|bomb_defusal|battle_royale|extraction|large_scale|coop_pve|story_pve|boss_loot|party_mode|open_world, "a": liked/accepted/neutral/disliked/rejected/not_experienced}]}
- assets: {"time","ability_asset","energy","emotion","money"} 各选 充足/有约束/严重稀缺/未知
- sweet_spot: {"stage": novice_understanding/rapid_improvement/stable_mastery/plateau/churn/unknown, "skill_count": 整数或 null, "duration": short/medium/long/unknown, "quality": low/medium/high/unknown, "flow": [多选], "peak": null, "plateau": null}

## 三、产品评测扩展标签(不确定就省略或 null)
city_tier 一线/新一线/二线/三线及以下/海外/unknown · life_stage 学生/初入职场/稳定职场/育儿家庭/其他 · device 固定桌面/客厅主机/移动碎片/网吧公共设备 · spending_level 不付费/低付费/中付费/高付费/unknown

## 证据等级
E3 直接证据(0.85-1.0) / E2 强推断(0.70-0.85) / E1 弱推断(0.50-0.70) / E0 无证据。
每个标签给 c(置信度 0-1) 和 e(证据等级)。M1/M2 无 E3 证据时 c<=0.70。c<0.6 时该条 meta.rs=review。

## 标注规则(必须遵守)
1. 原文为准，只标片段中明确表达的内容，不做推断跳级；宁缺毋滥，无法确定就留空。
2. 参考 preceding_question 理解语境，但只对被访者发言标注。
3. 填充词/无意义片段("嗯""对""好的"等，或原文<10字符) → 各层全空，meta.rs="skip"。
4. 纯事实陈述且无态度/评价 → 不标冰山/框架。
5. 禁止推断：玩得久≠高手、PC玩家≠能力强、不得从语言风格猜人口属性、不得把 unknown 强行推断成确定值。
6. 每条必给 meta.c(整体置信度) 和 meta.rs(auto_pass/review/skip)。

## 输出 JSON Schema（只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释文字）
{"results": [
  {
    "iceberg": {
      "M1": [{"v": "ability_growth", "primary": true, "inferred": false, "c": 0.9, "e": "E3"}],
      "M2": [{"v": "fair_competition", "c": 0.8, "e": "E2"}],
      "M3": [{"cat": "meta_perception", "v": "aim_decides", "c": 0.9, "e": "E3"}],
      "M4": [{"v": "achievement", "val": "pos", "int": "high", "trg": "win_loss", "c": 0.95, "e": "E3"}],
      "M5": [{"v": "ranked_grind", "freq": "daily", "c": 0.95, "e": "E3"}],
      "causal_chain": [["M1:ability_growth", "M5:ranked_grind"]]
    },
    "framework": {
      "needs": {"p": "ability_growth", "s": ["competitive_proof"]},
      "ability": {"lvl": "advanced", "str": ["aim-tracking"], "wk": [], "cog_str": ["reaction_speed"], "cog_wk": []},
      "style": {"combat": "aggressive", "decision": "instinctive", "victory": "individual", "growth": "skill", "social": "friends"},
      "platform": {"p": "pc", "s": null},
      "mode": {"struct": "pvp_main", "sub": [{"n": "bomb_defusal", "a": "liked"}]},
      "assets": {"time": "充足", "ability_asset": "有约束", "energy": "充足", "emotion": "有约束", "money": "未知"},
      "sweet_spot": {"stage": "rapid_improvement", "skill_count": 3, "duration": "medium", "quality": "high", "flow": ["clear_goals"], "peak": null, "plateau": null}
    },
    "product_tags": {"city_tier": null, "life_stage": null, "spending_level": null},
    "evidence": [{"q": "我每天练枪", "s": ["M5:deliberate_practice"], "e": "E3"}],
    "note": "中文推断说明(可省略)",
    "meta": {"c": 0.88, "rs": "auto_pass"}
  }
]}

空片段(无任何标签)示例：{"iceberg": {"M1": [], "M2": [], "M3": [], "M4": [], "M5": [], "causal_chain": []}, "framework": {}, "evidence": [], "meta": {"c": 1.0, "rs": "skip"}}

现在，用户会给你一批片段(每段有 source_file/segment_index/speaker_id/preceding_question/original_text)，你要对每段输出上述结构的标注，放在 JSON 数组 results 里返回。保持顺序与输入一致。`;

// ---- 配置 ----

const BATCH_SIZE = 5; // 每批标注的片段数（与 Python 脚本一致）

// ---- 批量标注 ----

/**
 * 对清洗后的片段进行批量 AI 标注
 */
export async function tagSegments(
  segments: CleanedSegment[],
  onProgress?: (tagged: number, total: number) => void,
): Promise<TaggedSegment[]> {
  const results: TaggedSegment[] = [];

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);
    const labels = await labelBatch(batch);

    for (let j = 0; j < batch.length; j++) {
      results.push({
        ...batch[j]!,
        annotation: labels[j] ?? null,
      });
    }

    if (onProgress) {
      onProgress(results.length, segments.length);
    }
  }

  return results;
}

/**
 * 批量标注一组片段
 */
async function labelBatch(batch: CleanedSegment[]): Promise<(Record<string, unknown> | null)[]> {
  // 构建批量标注提示
  const batchPrompt = buildBatchPrompt(batch);

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: batchPrompt },
  ];

  try {
    const response = await chat(messages, {
      temperature: 0.0,
      maxTokens: 16000,
    });
    return parseBatchResponse(response, batch.length);
  } catch (e) {
    console.error("批量标注 API 调用失败:", e);
    // 返回 null 标注，不中断整个流程
    return batch.map(() => null);
  }
}

/**
 * 构建批量标注的用户提示
 */
function buildBatchPrompt(batch: CleanedSegment[]): string {
  const parts: string[] = ["请标注以下片段：\n"];

  for (let i = 0; i < batch.length; i++) {
    const seg = batch[i]!;
    parts.push(`[${i}] source_file=${seg.sourceFile}`);
    parts.push(`segment_index=${seg.segmentIndex}`);
    parts.push(`speaker_id=${seg.speakerId}`);
    if (seg.precedingQuestion) {
      parts.push(`preceding_question=${seg.precedingQuestion}`);
    }
    parts.push(`original_text=${seg.cleanedText}`);
    parts.push("");
  }

  return parts.join("\n");
}

/**
 * 解析批量标注的 API 响应
 */
function parseBatchResponse(
  response: string,
  expectedCount: number,
): (Record<string, unknown> | null)[] {
  try {
    // 尝试提取 JSON
    let jsonStr = response.trim();

    // 移除 markdown 代码块
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1]!.trim();
    }

    const parsed = JSON.parse(jsonStr) as { results?: Array<Record<string, unknown>> };

    if (parsed.results && Array.isArray(parsed.results)) {
      // 补齐到期望长度
      const labels: (Record<string, unknown> | null)[] = parsed.results.slice(0, expectedCount);
      while (labels.length < expectedCount) {
        labels.push(null);
      }
      return labels;
    }

    // 如果直接是数组
    if (Array.isArray(parsed)) {
      const labels = parsed.slice(0, expectedCount);
      while (labels.length < expectedCount) {
        labels.push(null);
      }
      return labels;
    }

    // 解析失败
    console.error("无法解析标注响应:", jsonStr.slice(0, 500));
    return Array.from({ length: expectedCount }, () => null);
  } catch (e) {
    console.error("标注响应 JSON 解析失败:", e);
    return Array.from({ length: expectedCount }, () => null);
  }
}

// ---- 单条标注（兼容旧 API，供其他模块复用）----

/**
 * 对单条文本进行标注
 * 使用简化的系统提示，返回结构化标注
 */
export async function labelSegment(
  originalText: string,
  precedingQuestion?: string,
): Promise<Record<string, unknown>> {
  const segments: CleanedSegment[] = [
    {
      sourceFile: "inline",
      segmentIndex: 1,
      speakerId: "speaker_1",
      speakerRole: "interviewee",
      precedingQuestion: precedingQuestion ?? null,
      originalText,
      cleanedText: originalText.trim(),
      charCount: originalText.trim().length,
    },
  ];

  const results = await tagSegments(segments);
  return results[0]?.annotation ?? { error: "标注失败" };
}