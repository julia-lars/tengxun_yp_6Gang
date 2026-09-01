// --------------------------------------------------------------
// 统一聊天引擎 — Persona / KOL 共用的对话核心逻辑
// 消除 chat.ts 和 kol.ts 中 ~80% 的重复代码
// --------------------------------------------------------------

import { sql } from "drizzle-orm";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

import { db } from "../db/client.js";
import type { ChatMessage } from "../lib/llm.js";
import { chat, chatStream } from "../lib/llm.js";
import { embedQuery } from "../lib/embed.js";
import type { ConfidenceResult, EvidenceMeta, SentenceEvidenceResult } from "@app/shared";
import { classifyMatchLevel } from "../lib/confidence.js";

// ---- 1. 会话获取或创建 ----

/**
 * 获取或创建会话。如果 sessionId 存在且属于当前 agent，则复用；否则新建。
 * 调用方需自行处理 session 归属校验（session.agentId !== agentId → 新建）。
 */
export async function getOrCreateSession<T extends { id: number; messages: unknown }>(opts: {
  findSession: () => Promise<T | undefined>;
  createSession: () => Promise<T>;
  message: string;
}): Promise<T> {
  let session = await opts.findSession();
  if (!session) {
    session = await opts.createSession();
  }
  return session;
}

// ---- 2. 检索噪音过滤 ----

/**
 * 游戏相关关键词白名单。用于保护短但有效的片段不被误杀。
 * 包含游戏名、游戏术语、体验/偏好关键词。
 */
const GAME_KEYWORD_PATTERN = /(Apex|Valorant|CS2?|CSGO|Overwatch|COD|CFM?|CFHD|Fortnite|Destiny|R6|Rainbow|Battlefield|PUBG|Warzone|Elden|Ring|Witcher|Cyberpunk|GTA|Red\s*Dead|League|DOTA|WOW|Final\s*Fantasy|Diablo|Marvel|Rivals|Deadlock|Helldivers|The\s*Finals|无畏契约|守望先锋|绝地求生|暗区突围|三角洲|萤火|穿越火线|使命召唤|英雄联盟|王者荣耀|原神|黑神话|漫威|死锁|吃鸡|塔科夫|永劫|方舟|星际|战锤|坦克世界|战争雷霆)/i;

const EN_GAME_TERMS_PATTERN = /(game|play|shooter|FPS|MOBA|RPG|MMO|shoot|gun|match|rank|competitive|casual|controller|PC|console|Xbox|PlayStation|Steam|fun|enjoy|love|hate|favorite|best|worst|character|hero|ability|skill|map|mode|team|squad|party|friend|multiplayer|online|loot|battle|royale|extract|survival|raid|quest|open\s*world|coop|co-op|single\s*player|sandbox|indie|AAA|graphics|story|narrative|gameplay|mechanic|balance|patch|update|nerf|buff|meta|loadout|weapon|class|tank|healer|dps|support|DLC|season|battle\s*pass|skin|cosmetic|microtransaction|pay\s*to\s*win|free\s*to\s*play|grind|progression|level|unlock|achievement|trophy|platform|engine|frame\s*rate|FPS|ping|lag|server|matchmaking|solo|duo|squad|ranked|unranked|quick\s*play|custom|private|tournament|esport|pro|streamer|content\s*creator|mod|modding|workshop|community|clan|guild|discord|voice\s*chat|text\s*chat|controller|keyboard|mouse|monitor|headset|gaming\s*PC| gaming\s*laptop|immersion|atmosphere|vibe|chill|relax|stress|toxic|rage|quit|addict|addicted|addiction|grind|grinding|burnout|bored|boring|funny|hilarious|epic|awesome|amazing|terrible|awful|worst|broken|bug|glitch|crash|disconnect|cheater|hacker|smurf|boost|carry|noob|newbie|veteran|casual|hardcore|tryhard|sweat|sweaty)/i;

const ZH_GAME_TERMS_PATTERN = /(游戏|玩|枪|英雄|技能|段位|队友|匹配|排位|赛季|皮肤|装备|竞技|休闲|单排|组队|开黑|射击|操作|手感|画面|体验|喜欢|讨厌|爽|拉|崩|心态|上分|掉分|好玩|刺激|上头|肝|氪|外挂|炸鱼|带飞|新手|高手|老手|菜鸟|大神|枪法|枪感|爆头|压枪|走位|意识|配合|阵容|战术|打法|套路|机制|版本|更新|补丁|削弱|增强|角色|英雄|大招|技能|CD|冷却|伤害|血量|护甲|护盾|治疗|输出|坦克|辅助|刺客|射手|法师|战士|打野|中单|上单|下路|ADC|辅助|团战|对线|推塔|打龙|大龙|小龙|野区|Gank|抓人|反野|偷塔|偷龙|一波|翻盘|逆风|顺风|碾压|焦灼|绝杀|翻车|暴毙|白给|送人头|挂机|演员|喷子|祖安|对喷|互动|开麦|闭麦|语音|打字|信号|标记|Ping|指挥|听指挥|不听话|单机|联机|在线|离线|好友|列表|邀请|组队|房间|大厅|匹配中|等待|排队|秒退|重连|掉线|卡顿|延迟|丢包|闪退|崩溃|黑屏|蓝屏|死机|重启|更新中|维护|停服|开服|测试|公测|内测|封测|抢先|体验|预购|首发|打折|史低|免费|入库|喜加一|入库|卸载|重装|下载|安装|解压|容量|空间|硬盘|内存|显卡|CPU|帧数|画质|分辨率|刷新率|光追|DLSS|FSR|手柄|键鼠|屏幕|耳机|音响|外设|电竞|网吧|网咖|开黑|连坐|面基|线下面基|聚会|比赛|观赛|直播|主播|弹幕|切片|集锦|高光|名场面|搞笑|下饭|教学|攻略|测评|评测|开箱|抽卡|抽奖|氪金|充值|首充|月卡|战令|通行证|限定|绝版|返场|联动|IP|同人|COS|周边|手办|模型|卡片|桌游|跑团|剧本杀|密室|鬼屋|恐怖|悬疑|解谜|冒险|动作|角色扮演|策略|模拟|经营|养成|恋爱|galgame|视觉小说|音游|节奏|跑酷|休闲|消除|三消|塔防|自走棋|肉鸽|Roguelike|Roguelite|魂系|Soulslike|类魂|银河城|Metroidvania|开放世界|沙盒|生存|建造|种田|钓鱼|采矿|合成|锻造|附魔|炼金|制药|烹饪|好感|羁绊|剧情|支线|主线|结局|多周目|二周目|白金|全成就|速通|跑酷|竞速|无伤|一命|铁人|硬核|挑战|难度|简单|普通|困难|地狱|噩梦|无双|割草|爽游|治愈|致郁|催泪|感动|热血|燃|中二|二次元|动漫|番剧|轻小说|漫画|JK|Lolita|汉服|古风|国风|仙侠|武侠|玄幻|奇幻|科幻|赛博朋克|蒸汽朋克|废土|末日|丧尸|僵尸|吸血鬼|狼人|魔法|异能|超能力|穿越|重生|系统|面板|数据|面板|属性|加点|天赋|技能树|被动|主动|大招|终极|觉醒|突破|进化|升星|升阶|强化|精炼|附魔|镶嵌|宝石|符文|铭文|圣遗物|御魂|装备|武器|防具|饰品|戒指|项链|手镯|腰带|鞋子|头盔|铠甲|盾牌|法杖|弓箭|匕首|长剑|大剑|太刀|双刀|长枪|斧头|锤子|拳套|爪子|镰刀|锁链|鞭子|棍棒|法球|魔杖|法典|十字架|圣杯|塔罗|骰子|硬币|扑克|麻将|围棋|象棋|国际象棋|将棋|五子棋|跳棋|飞行棋|大富翁|狼人杀|阿瓦隆|抵抗组织|间谍|卧底|内鬼|谁是卧底|你画我猜|猜词|海龟汤|谜题|谜语|脑筋急转弯|冷知识|热知识|梗|meme|表情包|斗图|灌水|潜水|冒泡|签到|打卡|水群|群聊|私聊|频道|服务器|房间号|IP|端口|延迟|加速器|代理|VPN|科学上网|翻墙|梯子|机场|节点|线路|专线|中转|直连|P2P|P2P|局域网|广域网|内网|外网|公网|私网|IPv4|IPv6|TCP|UDP|HTTP|HTTPS|WebSocket|API|SDK|开源|闭源|免费|付费|买断|订阅|会员|VIP|SVIP|SSVIP|至尊|荣耀|传奇|王者|大师|宗师|王者|巅峰|传说|神话|史诗|稀有|普通|白色|绿色|蓝色|紫色|橙色|金色|红色|彩色|暗金|远古|太古|洪荒|混沌|创世|灭世|神器|圣器|魔器|妖器|鬼器|仙器|佛器|道器|灵器|宝器|法器|凡器|白装|绿装|蓝装|紫装|橙装|金装|红装|粉装|黑装|白板|蓝天|白云|紫气东来|橙光|金光|红光|黑光|白光|绿光|蓝光|紫光|橙光|金光|红光|彩光)/;

/**
 * 英文噪音：纯单字确认/感叹/社交用语，不含任何游戏信息。
 */
const EN_NOISE_PATTERN = /^(Cool|Yeah|Yep|Nope|Yes|No|Okay|Ok|Sure|Right|Gotcha|Perfect|Fantastic|Great|Nice|Thanks|Sorry|Fine|Alright|Absolutely|Exactly|Definitely|Totally|Indeed|Correct|Fair|True|Maybe|Perhaps|Probably|Hello|Hi|Hey|Wow|What|Why|When|Where|How|Who|Recap|Visuals|Media|Gameplay|Instagram|Discord|Threads|Snapchat|So\.\.\.|Let's\s*see|No\s*way|Of\s*course|My\s*god|Oh\s*my|Holy|Damn|Shit|Fuck|Jesus|Christ|Whatever|Anyways|Anyway|Never\s*mind|Forget\s*it|I\s*see|Got\s*it|Noted|Sounds\s*good|Will\s*do|Same\s*here|Me\s*too|Not\s*really|I\s*guess|I\s*suppose|Kind\s*of|Sort\s*of|I\s*think|I\s*mean|Please|Music|The\s*music|For\s*gaming|I\s*love\s*that|That's\s*great|That's\s*cool|Oh,\s*cool|Oh,\s*yeah|Yeah,\s*yeah|No,\s*no|No\.\s*Yeah|Hmm|Mmm|Mhmm|Mm-hmm|Uh-huh|Uh|Um|Er|Ah)[.!?]*$/i;

/**
 * 中文噪音：纯确认/附和/否定/语气词，不含任何游戏信息。
 */
const ZH_NOISE_PATTERN = /^[对是嗯好行可可以]+[，,。.]?$|^[没不][有会是知道清楚懂行能]+[，,。.]?$|^[啊哦嗯呃唉哎哟嘿]$|^(玩了|能玩|在玩|玩法|还行|可以|是的|对的|好的|没有|不知道|不清楚|还行吧|差不多|对对对|还可以|就这样|就这样吧|就那样|就那样吧|一般般|马马虎虎|凑合|凑合吧|随便|无所谓|都行|都可以|都还好|看情况|不一定|再说吧|没想过|没考虑|不了解|不关注|没注意|没印象|不记得|忘记了|忘了|想不起来|想不起了|没感觉|没想法|没看法|没意见|不知道啊|不清楚啊|没想过啊|没考虑过|没玩过|没玩|没打过|没试过|没体验过|没接触过|没了解过|不玩|不玩这个|不玩那个|不玩游戏|不玩这些|不玩那些|不玩这种|不玩那种|不感兴趣|没兴趣|不想玩|不想打|不想试|不想碰|不想了解|不想关注|不想考虑|这些|那些|这种|那种|这个|那个|如此|这样|那样|就这样|就那样|就这样吧|就那样吧|然后呢|然后呢？|然后呢。|还有呢|还有吗|还有呢？|还有吗？|继续|接着说|继续讲|继续吧|你继续|你接着说|你继续讲|你说|你说吧|你讲|你讲吧)[。.]?$/;

/**
 * 过滤检索结果中的噪音行。
 *
 * 在 RAG 检索后、LLM 调用前过滤掉不含游戏信息的噪音片段，
 * 减少跨语言误匹配和语义模糊片段对生成质量的影响。
 *
 * 预计过滤掉 20-30% 的检索结果（主要是英文短片段 + 中文单字/双字确认）。
 */
export function filterNoiseRows<T extends { originalText: string }>(rows: T[]): T[] {
  return rows.filter(row => {
    const text = row.originalText.trim();
    if (text.length === 0) return false;

    // 1. 英文单字/短语噪音
    if (/^[a-zA-Z]/.test(text) && EN_NOISE_PATTERN.test(text)) {
      return false;
    }

    // 2. 中文单字/双字噪音
    if (/^[一-鿿]/.test(text) && ZH_NOISE_PATTERN.test(text)) {
      return false;
    }

    // 3. 英文短片段（< 5 词）且不含游戏名/游戏术语
    if (/^[a-zA-Z]/.test(text)) {
      const words = text.split(/\s+/).filter(w => w.length > 0);
      if (words.length < 5 &&
          !GAME_KEYWORD_PATTERN.test(text) &&
          !EN_GAME_TERMS_PATTERN.test(text)) {
        return false;
      }
    }

    // 4. 中文短片段（< 10 字符）且不含游戏名/游戏术语
    if (/^[一-鿿]/.test(text)) {
      if (text.length < 10 &&
          !GAME_KEYWORD_PATTERN.test(text) &&
          !ZH_GAME_TERMS_PATTERN.test(text)) {
        return false;
      }
    }

    return true;
  });
}

// ---- 3. RAG 检索 ----

export interface EvidenceRow {
  id: number;
  originalText: string;
  sourceLabel: string; // persona: sourceFile, kol: title
  /** 向量余弦相似度 (0-1)，仅向量检索时有值 */
  similarity?: number;
  /** 证据等级：直引 / 部分关联 / 推断 */
  matchLevel?: "direct" | "partial" | "inferred";
  /** 证据标签与画像标签的重叠度 (0-1) */
  tagOverlap?: number;
  /** 受访者匿名 ID */
  speakerId?: string;
  /** 该条发言对应的上一条主持人的提问（语境还原） */
  precedingQuestion?: string | null;
  /** LLM 判断的匹配理由（证据-回答相关性） */
  relevanceReason?: string | null;
  /** LLM 判断的相关性分数（证据-回答），独立于向量相似度 */
  relevanceScore?: number;
  /** 冰山+框架标注 */
  annotation?: Record<string, unknown> | null;
}

/**
 * 向量检索 + ILIKE 兜底。自动处理 pgvector 查询失败时的降级。
 */
export async function searchEvidence(opts: {
  message: string;
  vectorQuery: (vecStr: string) => Promise<EvidenceRow[]>;
  ilikeQuery: () => Promise<EvidenceRow[]>;
}): Promise<EvidenceRow[]> {
  let rows: EvidenceRow[];
  try {
    const queryVec = await embedQuery(opts.message);
    const vecStr = JSON.stringify(queryVec);
    rows = await opts.vectorQuery(vecStr);
    if (rows.length > 0) return filterNoiseRows(rows);
  } catch (e) {
    console.error("向量检索失败，回退到 ILIKE:", e);
  }
  // ILIKE 兜底
  try {
    rows = await opts.ilikeQuery();
    return filterNoiseRows(rows);
  } catch (e) {
    console.error("ILIKE 检索也失败:", e);
    return [];
  }
}

// ---- 4. 通用 SSE 流式对话 ----

/**
 * 执行 SSE 流式对话：打字机输出 → 保存消息 → 发送 meta 事件。
 * 调用方负责构建 systemPrompt 和 llmMessages。
 */
export async function streamChat(opts: {
  c: Context;
  llmMessages: ChatMessage[];
  sessionId: number;
  evidenceIds: number[];
  /** RAG 检索到的完整证据数据（含原文），通过 SSE 传给前端渲染 */
  evidenceData?: EvidenceRow[];
  history: Array<{ role: string; content: string }>;
  userMessage: string;
  saveMessages: (updatedMessages: Array<Record<string, unknown>>) => Promise<void>;
  errorMessage?: string;
  /** 置信度计算结果（调用方在 RAG 检索后计算） */
  confidence?: ConfidenceResult;
  /** 证据元数据列表 */
  evidenceMeta?: EvidenceMeta[];
  /** 首轮对话完成后自动生成标题的回调 */
  updateTitle?: (title: string) => Promise<void>;
}): Promise<Response> {
  const {
    c,
    llmMessages,
    sessionId,
    evidenceIds,
    evidenceData,
    history,
    userMessage,
    saveMessages,
    confidence,
    evidenceMeta,
    updateTitle,
  } = opts;

  return streamSSE(c, async (stream) => {
    let fullResponse = "";

    try {
      for await (const token of chatStream(llmMessages)) {
        fullResponse += token;
        await stream.writeSSE({ data: token });
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error("对话引擎错误:", errMsg);
      // 发送错误事件，让前端弹出提示
      try {
        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            message: errMsg.includes("401") ? "API Key 认证失败，请检查 Key 是否有效" : "LLM 服务异常，请稍后重试",
          }),
        });
      } catch {
        // 客户端已断开连接
      }
      await stream.writeSSE({
        data: opts.errorMessage ?? "[暂时无法响应，请稍后重试]",
      });
    }

    // 构建 SSE 传输的完整证据数据
    const evidencePayload = (evidenceData ?? []).map((e) => ({
      id: e.id,
      sourceFile: e.sourceLabel,
      originalText: e.originalText,
      annotation: e.annotation ?? null,
      similarity: e.similarity ?? 0,
      matchLevel: e.matchLevel ?? classifyMatchLevel(e.similarity ?? 0),
      tagOverlap: e.tagOverlap ?? 0,
      speakerId: e.speakerId ?? null,
      precedingQuestion: e.precedingQuestion ?? null,
    }));

    // 先发送 meta 事件（证据 + 置信度），前端立即显示
    try {
      await stream.writeSSE({
        data: JSON.stringify({
          type: "meta",
          ids: evidenceIds,
          sessionId,
          confidence,
          evidenceMeta: evidenceMeta ?? [],
          evidence: evidencePayload,
        }),
      });
    } catch {
      // 客户端已断开连接
    }

    // 逐句证据映射（异步执行，不阻塞 meta 事件，完成后单独发送）
    if (userMessage && fullResponse && (evidenceData ?? []).length > 0) {
      try {
        const sentenceEvidence = await mapSentencesToEvidence(fullResponse, evidenceData!, userMessage);
        if (sentenceEvidence.sentences.length > 0) {
          await stream.writeSSE({
            data: JSON.stringify({
              type: "sentenceEvidence",
              sentenceEvidence,
            }),
          });
        }
      } catch (e) {
        console.error("逐句证据映射失败:", e);
      }
    }

    // 首轮对话完成后自动生成标题
    if (updateTitle && history.length === 0 && fullResponse) {
      try {
        const generatedTitle = await generateTitle(userMessage, fullResponse);
        await updateTitle(generatedTitle);
      } catch (e) {
        console.error("标题生成失败，使用默认标题:", e);
      }
    }

    // 保存对话记录（含置信度和证据元数据 + 完整证据内容）
    const updatedMessages = [
      ...history,
      { role: "user", content: userMessage, timestamp: new Date().toISOString() },
      {
        role: "assistant",
        content: fullResponse,
        evidenceIds,
        evidenceMeta: evidenceMeta ?? [],
        evidence: evidencePayload,
        confidence: confidence ?? null,
        timestamp: new Date().toISOString(),
      },
    ];

    await saveMessages(updatedMessages);
  });
}

// ---- 5. 历史消息压缩 ----

/**
 * 简单截断：保留最近 N 条，更早的合并为摘要
 */
export function compressHistory(
  history: Array<{ role: string; content: string }>,
  maxRecent: number = 6,
  threshold: number = 16,
): Array<{ role: string; content: string }> {
  if (history.length <= threshold) {
    return history.slice(-maxRecent * 2);
  }

  const recentMessages = history.slice(-maxRecent);
  const olderMessages = history.slice(0, -maxRecent);

  const summary = olderMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const prefix = m.role === "user" ? "Q" : "A";
      const text = (m.content ?? "").slice(0, 100);
      return `${prefix}: ${text}`;
    })
    .join("; ");

  return [
    { role: "system", content: `[对话历史摘要] ${summary}` },
    ...recentMessages,
  ];
}

// ---- 6. 格式化 evidence 上下文 ----

export function formatEvidenceContext(
  rows: EvidenceRow[],
  prefix: (row: EvidenceRow) => string,
): string {
  return rows
    .map((e) => `${prefix(e)} ${e.originalText.slice(0, 300)}`)
    .join("\n---\n");
}

// ---- 7. 对话标题生成 ----

/**
 * 根据首轮对话内容自动生成简短标题（≤20字）。
 */
export async function generateTitle(userMessage: string, aiResponse: string): Promise<string> {
  const prompt = [
    "根据以下对话内容，生成一个简短的对话标题。",
    "要求：不超过20个字，直接返回标题文本，不要加引号、不要加句号、不要加任何前缀说明。",
    "",
    `用户：${userMessage.slice(0, 200)}`,
    `AI：${aiResponse.slice(0, 500)}`,
  ].join("\n");

  const result = await chat(
    [{ role: "user", content: prompt }],
    { temperature: 0, maxTokens: 64 },
  );

  return result.trim().slice(0, 30);
}

// ---- 8. 证据-回答匹配度评分 ----

/**
 * 用 LLM 对每条证据与 AI 回答做匹配度评分。
 * 衡量"这条证据是否真正支撑了回答中的某个具体观点"，
 * 而非向量相似度（衡量"用户问题是否与证据语义接近"）。
 *
 * 返回 Map<evidenceId, { score, reason }>
 */
export async function evaluateEvidenceRelevance(
  answer: string,
  evidenceRows: EvidenceRow[],
): Promise<Map<number, { score: number; reason: string }>> {
  if (evidenceRows.length === 0) return new Map();

  // 截断过长的回答，避免 prompt 过大
  const truncatedAnswer = answer.slice(0, 1200);

  // 构建证据列表（带编号）
  const evidenceList = evidenceRows
    .map((e, i) => `[${i + 1}] ${e.originalText.slice(0, 200)}`)
    .join("\n");

  const prompt = `请判断以下每条证据是否支撑了 AI 回答中的某个具体观点。给每条证据打一个精确到两位小数的相关性分数（0.00-1.00）。

AI 回答：
---
${truncatedAnswer}
---

证据列表：
${evidenceList}

评分要求：
- 分数必须精确到两位小数（如 0.87、0.43、0.15），不要只给整十数（如 0.8、0.5、0.2）
- 仔细对比证据文本和回答中的具体句子，找到直接的引用或支撑关系
- 每条证据必须给出不同的分数，体现精细差异

评分参考：
- 0.90-1.00：证据中的具体表述直接出现在回答中，或明确支撑了回答的核心观点
- 0.70-0.89：证据与回答语义高度相关，内容有实质重叠，但措辞不同
- 0.50-0.69：证据与回答话题相同，但具体观点不完全一致
- 0.30-0.49：证据与回答领域相近，但讨论的具体内容不同
- 0.00-0.29：证据与回答基本无关

只输出一个 JSON 数组，不要输出任何其它文字：
[{"index": 1, "score": 0.87, "reason": "证据提到了朋友组队和语音配合，直接支撑了回答中'跟朋友开黑、语音喊话'的核心观点"}, {"index": 2, "score": 0.23, "reason": "证据讨论的是CS手感，与回答中团队合作的乐趣无关"}]`;

  try {
    const result = await chat(
      [
        { role: "system", content: "你只输出合法 JSON 数组，不输出任何解释或 markdown 代码块。回复必须以 [ 开头，以 ] 结尾。" },
        { role: "user", content: prompt },
      ],
      { temperature: 0.3, maxTokens: 2048 },
    );

    // 提取 JSON
    const trimmed = result.trim();
    const jsonStart = trimmed.indexOf("[");
    const jsonEnd = trimmed.lastIndexOf("]");
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
      console.error("证据匹配度评分返回格式异常:", trimmed.slice(0, 200));
      return new Map();
    }

    const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as Array<{
      index: number;
      score: number;
      reason: string;
    }>;

    const resultMap = new Map<number, { score: number; reason: string }>();
    for (const item of parsed) {
      const idx = item.index - 1; // 转回 0-based
      if (idx >= 0 && idx < evidenceRows.length) {
        const evidenceId = evidenceRows[idx]!.id;
        resultMap.set(evidenceId, {
          score: Math.max(0, Math.min(1, item.score)),
          reason: item.reason?.slice(0, 100) ?? "",
        });
      }
    }
    return resultMap;
  } catch (e) {
    console.error("证据匹配度评分解析失败:", e);
    return new Map();
  }
}

// ---- 9. 逐句证据映射 ----

/**
 * 用 LLM 将 AI 回答拆分为句子，标注每句话被哪些证据支撑。
 * 返回 SentenceEvidenceResult，包含逐句映射、用户问题原文和回答原文。
 *
 * 与 evaluateEvidenceRelevance 不同：
 * - evaluateEvidenceRelevance 是 N-to-1（N 条证据 → 1 个回答，输出每条证据的匹配分）
 * - mapSentencesToEvidence 是 M-to-N（M 个句子 → N 条证据，输出每句话的支撑证据 ID）
 *
 * 两者独立，调用方应使用 Promise.all 并行执行。
 */
export async function mapSentencesToEvidence(
  answer: string,
  evidenceRows: EvidenceRow[],
  userQuestion: string,
): Promise<SentenceEvidenceResult> {
  if (evidenceRows.length === 0) {
    return { sentences: [], userQuestion, answerText: answer };
  }

  // 1. 用正则拆分中文句子
  const rawSentences = answer
    .split(/[。！？!?；;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (rawSentences.length === 0) {
    return { sentences: [], userQuestion, answerText: answer };
  }

  // 2. 截断过长的文本，避免 prompt 过大
  const truncatedAnswer = answer.slice(0, 1500);
  const truncatedSentences = rawSentences.map((s) => s.slice(0, 300));

  // 构建句子列表（0-based 编号）
  const sentenceList = truncatedSentences
    .map((s, i) => `[${i}] ${s}`)
    .join("\n");

  // 构建证据列表（1-based 编号，与 evaluateEvidenceRelevance 一致）
  const evidenceList = evidenceRows
    .map((e, i) => `[${i + 1}] ${e.originalText.slice(0, 150)}`)
    .join("\n");

  const prompt = `用户问题：${userQuestion.slice(0, 300)}

AI 回答已拆分为以下句子：
${sentenceList}

证据列表：
${evidenceList}

请判断每个句子分别被哪些证据支撑。注意：
- 一条证据可能支撑多个句子
- 一个句子可能被多条证据同时支撑
- 只输出有证据支撑的句子，没有证据支撑的句子省略

评分标准：
- 证据中的具体表述直接出现在句子中，或明确支撑了句子的观点 → 计入支撑
- 证据与句子话题相近但未直接支撑任何具体观点 → 不计入

只输出一个 JSON 数组，不要输出任何其它文字：
[{"sentenceIndex": 0, "supportingEvidenceIds": [1, 3]}, {"sentenceIndex": 2, "supportingEvidenceIds": [2]}]`;

  try {
    const result = await chat(
      [
        { role: "system", content: "你只输出合法 JSON 数组，不输出任何解释或 markdown 代码块。回复必须以 [ 开头，以 ] 结尾。" },
        { role: "user", content: prompt },
      ],
      { temperature: 0, maxTokens: 2048 },
    );

    // 提取 JSON
    const trimmed = result.trim();
    const jsonStart = trimmed.indexOf("[");
    const jsonEnd = trimmed.lastIndexOf("]");
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
      console.error("逐句证据映射返回格式异常:", trimmed.slice(0, 200));
      return { sentences: [], userQuestion, answerText: answer };
    }

    const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as Array<{
      sentenceIndex: number;
      supportingEvidenceIds: number[];
    }>;

    // 验证并过滤：sentenceIndex 必须在有效范围内
    // 注意：LLM 返回的 supportingEvidenceIds 是 1-based 的 evidence 编号（与 prompt 一致），
    // 需要转换为真实的数据库 evidence ID
    const sentences = parsed
      .filter((item) => {
        if (item.sentenceIndex < 0 || item.sentenceIndex >= rawSentences.length) return false;
        if (!Array.isArray(item.supportingEvidenceIds)) return false;
        return true;
      })
      .map((item) => ({
        sentenceIndex: item.sentenceIndex,
        sentenceText: rawSentences[item.sentenceIndex]!,
        // 将 1-based 索引转换为真实的 evidence 数据库 ID
        supportingEvidenceIds: item.supportingEvidenceIds
          .map((idx) => {
            const row = evidenceRows[idx - 1]; // 1-based → 0-based
            return row?.id;
          })
          .filter((id): id is number => id !== undefined),
      }))
      .filter((item) => item.supportingEvidenceIds.length > 0);

    return { sentences, userQuestion, answerText: answer };
  } catch (e) {
    console.error("逐句证据映射解析失败:", e);
    return { sentences: [], userQuestion, answerText: answer };
  }
}