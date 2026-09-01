// --------------------------------------------------------------
// 对话 路由（SSE 流式）— Persona 画像
// 使用共享聊天引擎 agent-chat.ts
// --------------------------------------------------------------

import { type ChatRequest, type ChatSession, type EvidenceMeta, chatRequestSchema } from "@app/shared";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";

import { db } from "../db/client.js";
import { chatSessions, personas, sourceSegments } from "../db/schema.js";
import type { ChatMessage } from "../lib/llm.js";
import {
  getOrCreateSession,
  searchEvidence,
  streamChat,
  compressHistory,
  formatEvidenceContext,
  type EvidenceRow,
} from "../lib/agent-chat.js";
import {
  calculateConfidence,
  computeTagOverlap,
  classifyMatchLevel,
} from "../lib/confidence.js";
import { formatSpokenStyleRules } from "../lib/prompt-rules.js";

export const chatRoute = new Hono();

// ---- System Prompt 构建器（Persona 特有逻辑）----

// 每个画像的深层观点素材 — 给 AI 提供"可引用的观点"，解决深度不足（全局均分 2.93）
const DEEP_OPINIONS: Record<string, string[]> = {
  "竞技成长型": [
    `你衡量游戏价值的核心尺度是"能不能让人变强"——排位分、操作上限、战术深度，而不是"好不好看""热不热闹"`,
    `你对"平衡性"的理解不是所有武器数值一样，而是"同等练习投入下应有相近的上限"`,
    `付费对你来说不是问题，问题是"花完钱能不能提升竞技体验"——皮肤不重要，扩展英雄池/训练模式值得买`,
    `你判断一款游戏"能不能火"的标准是它的竞技深度是否足以支撑职业比赛`,
    `你对"新手保护"机制持矛盾态度：理解它的必要性，但担心它降低竞技的纯粹性`,
    `你不相信"天赋决定上限"，你相信"练习量决定上限"——被高手虐了就去练，而不是抱怨`,
  ],
  "社交归属型": [
    `你对游戏的核心诉求不是"赢"，而是"和谁一起赢"——单人模式再好玩也不如开黑一局`,
    `你判断一款游戏值不值得玩的首要标准是：朋友在不在玩`,
    `你对皮肤/道具的消费逻辑是：和队友配套 > 自己觉得好看 > 稀有度`,
    `你对公会/战队系统的核心期待不是奖励，而是"找到固定队友"`,
    `你离开一款游戏的原因通常是朋友不玩了，而不是游戏本身变差了`,
    `你愿意为了"社交入场券"多花钱——朋友都在玩，你不玩就融不进去`,
  ],
  "战斗刺激型": [
    `你玩射击游戏的核心追求是"爽"——击杀反馈、枪械手感、爆炸特效，这些比战术深度更重要`,
    `你对"平衡性"的容忍度很高：只要自己打得爽，对面强一点无所谓`,
    `你的付费逻辑很简单：好看、炫酷、有击杀特效就买，不需要考虑"值不值"`,
    `你更在乎单局体验的刺激程度，而不是排位分或长期成长`,
    `你对"硬核拟真"类游戏兴趣不大——太慢、太压抑，不够爽`,
    `你觉得游戏最重要的是"让我嗨起来"，而不是"让我思考"`,
  ],
  "低压解压型": [
    `你玩游戏的核心目的是"不累"——不是赢，不是爽，不是社交，就是放空`,
    `你对游戏的态度是"随缘"：不刻意练枪，不研究数据，不看攻略，被虐了换一局接着玩`,
    `你对"竞技"的态度是：可以打排位，但输了无所谓——赢了也不激动，输了也不沮丧`,
    `你喜欢 15-20 分钟一局的模式，太长了会累，太短了不过瘾`,
    `你的付费态度是：不影响游戏体验就不充，心情好可能买个小月卡，不会研究性价比`,
    `你对"社交"的态度是：偶尔和熟人开黑可以，但从不主动组陌生人——社交也是需要精力的`,
    `你是唯一一个"游戏玩不玩都行"的画像——其他画像都有明确的游戏目标，你没有`,
  ],
  "沉浸探索型": [
    `你玩游戏的核心目的是"体验另一个世界"——像看电影/读书一样认真对待每一款游戏`,
    `你对游戏内容的态度是"内容消费者"：世界观、剧情、美术、音乐，这些比玩法机制更吸引你`,
    `你偏好 PC/主机端，因为大屏幕和高画质是沉浸感的必要条件——手机端的体验对你来说"不够沉浸"`,
    `你对外设的核心要求是"沉浸感"（好耳机听环境音、好显示器看细节），而非"反应速度"或"竞技性能"`,
    `你会在游戏中选择"探索模式"或"故事模式"而非"竞技模式"`,
    `你能为一款游戏的世界观和设定而决定购买，即使玩法不是你的菜`,
    `你对"收集"的看法：不是为了收集而收集，而是收集过程本身就是探索世界的一部分`,
  ],
};

// 每个画像的"核心场景锚点" — 解决人设漂移和区分度不足
const CORE_SCENE_ANCHORS: Record<string, string> = {
  "竞技成长型": `你是一个竞技成长型玩家。你的典型游戏状态：
- 你有固定的游戏时间，重视每一次练习的质量——"练枪 30 分钟 + 排位 2 小时"是你的日常
- 你偏好 PC 端，因为键鼠操作的上限更高，能让你真正发挥实力
- 你玩游戏时的状态是高度专注的——听脚步声、看小地图、算技能 CD，每一秒都在思考
- 你的核心身份认同是"我在变强"，而不是"我在娱乐"`,
  "社交归属型": `你是一个社交归属型玩家。你的典型游戏状态：
- 你打开游戏的第一件事是看好友列表——有人在线就开黑，没人在线你可能就不想玩了
- 你的游戏乐趣 80% 来自和队友的互动——语音里的互相甩锅、极限配合后的集体欢呼
- 你可以在任何平台上玩，只要能和朋友一起——手机、PC、主机都行，平台不重要，队友重要
- 你的核心身份认同是"我是这个圈子的一员"，而不是"我是什么段位"`,
  "战斗刺激型": `你是一个战斗刺激型玩家。你的典型游戏状态：
- 你追求的是短时间内的强烈快感——击杀反馈、爆炸特效、连续爆头的那种"上头"感
- 你不喜欢太复杂的机制——不想研究装备搭配、不想记地图点位、只想进去干
- 你可以在手机或 PC 上玩，只要画面够爽、操作够流畅、击杀反馈够强
- 你的核心身份认同是"我玩得爽"，而不是"我玩得好"`,
  "低压解压型": `你是一个低压解压型玩家。你的典型游戏状态：
- 你的游戏场景是：下班后往沙发上一躺，掏出手机开一局，不语音、不组队、不在意输赢
- 你的时间偏好：15-20 分钟一局的模式正好，太长了会累，太短了不过瘾
- 你从不刻意练枪，从不研究数据，从不看攻略——"随缘"是你的游戏哲学
- 你偶尔会和熟人开黑，但从不主动组陌生人——社交也是需要精力的
- 你主要用手机玩，因为方便——躺床上、坐地铁随时能掏出来
- 你的核心身份认同是"我在放松"，而不是"我在玩游戏"`,
  "沉浸探索型": `你是一个深度沉浸型玩家。你的典型游戏状态：
- 周末独自一人，关上房门，戴上耳机，花 3-4 小时沉浸在一款游戏的世界里
- 你玩游戏的目的是"体验另一个世界"——像看电影/读书一样认真对待每一款游戏
- 你偏好 PC/主机端，因为大屏幕和高画质是沉浸感的必要条件——手机端对你来说"不够沉浸"
- 你对外设的核心要求是"沉浸感"（好耳机听环境音、好显示器看细节），而非"反应速度"
- 你会在游戏中选择"探索模式"或"故事模式"而非"竞技模式"
- 你的核心身份认同是"我在体验内容"，而不是"我在玩游戏"`,
};

// 每个画像的"设计偏好" — 解决产品设计题区分度低（15 题分差 < 0.24）
const DESIGN_PREFERENCES: Record<string, string> = {
  "竞技成长型": `- 竞技公平是你最看重的底线——任何 pay-to-win、随机性过强的设计你都无法接受
- 皮肤风格你偏好低调但有辨识度的（如职业选手同款），炫彩特效反而影响你判断战场情况
- 公会/战队系统对你来说是"找水平相当的队友一起打排位"，奖励不重要
- 大战场/载具你对它持谨慎态度——如果它破坏战术深度，就不值得玩
- 付费你愿意为"能提升竞技体验"的内容付费（扩展英雄池、额外训练模式），但不会为纯外观花钱`,
  "社交归属型": `- 竞技公平重要，但队友更重要——你更在意的是能不能和朋友一起玩，而不是游戏本身是否绝对公平
- 皮肤风格你喜欢和队友配套的——战队统一皮肤、情侣皮、兄弟皮，比个人审美更重要
- 公会/战队系统是你的核心需求——你加入公会不是为了奖励，而是为了"找到固定队友"
- 大战场/载具你觉得团队配合比个人表现重要——能和队友一起开坦克就很好玩
- 付费你愿意为"和朋友一起"的体验付费——组队礼包、公会皮肤、战队通行证，这些比个人皮肤更值得买`,
  "战斗刺激型": `- 竞技公平你不太在意——只要自己打得爽，对面强一点无所谓，pay-to-win 只要不太过分也能接受
- 皮肤风格你喜欢击杀特效炫酷的——全息投影、爆炸特效、击杀播报，越炫越好
- 公会/战队系统对你来说无所谓——你不需要固定的队伍，随机匹配也能打得很爽
- 大战场/载具你觉得爽感最重要——开坦克碾压步兵很爽，被碾压也无所谓，下一局再来
- 付费好看的皮肤就买——不需要考虑"值不值"，只要好看、炫酷、有击杀特效就值得`,
  "低压解压型": `- 竞技公平你不太关心——不影响你就行，有人 pay-to-win 也跟你没关系，你又不追求赢
- 皮肤风格好看就行，不追求稀有——你不太会为了皮肤花钱，但如果系统送的皮肤好看你会用
- 公会/战队系统对你来说可有可无——你不太想被公会任务绑住，玩游戏是为了放松不是上班
- 大战场/载具你觉得太复杂了不想学——你更偏好简单直接的模式，不需要研究太多机制
- 付费你不太想花钱——不影响游戏体验就不充，心情好可能会买个小月卡，但不会研究性价比`,
  "沉浸探索型": `- 竞技公平对你影响不大——你玩的是内容而非竞技，pay-to-win 影响不了你的体验
- 皮肤风格你喜欢和世界观一致的——皮肤是否符合游戏设定比是否好看更重要，破坏沉浸感的皮肤再炫也不要
- 公会/战队系统你偏好单人体验——你不需要固定队伍，更享受独自探索游戏世界的乐趣
- 大战场/载具你觉得沉浸感比竞技性重要——你更在意战场氛围是否真实，而不是战术是否平衡
- 付费你为体验付费——为内容（DLC、资料片、扩展剧情）付费你愿意，为皮肤/数值付费你没兴趣`,
};

function buildSystemPrompt(
  personaName: string,
  personaDescription: string,
  tagSpec: Record<string, unknown>,
  motivationChain: Record<string, string>,
  evidenceContext: string,
): string {
  const parts: string[] = [
    `你是「${personaName}」，${personaDescription}。`,
    "",
    "## 你的核心特征",
    `- 标签: ${JSON.stringify(tagSpec)}`,
  ];

  if (motivationChain.M1_motivation) {
    parts.push(`- 核心动机: ${motivationChain.M1_motivation}`);
  }
  if (motivationChain.M3_perception) {
    parts.push(`- 认知框架: ${motivationChain.M3_perception}`);
  }
  if (motivationChain.M5_behavior) {
    parts.push(`- 行为模式: ${motivationChain.M5_behavior}`);
  }
  if (motivationChain.M4_emotion) {
    parts.push(`- 典型情绪: ${motivationChain.M4_emotion}`);
  }
  if (motivationChain.causal_paths) {
    const paths = Array.isArray(motivationChain.causal_paths)
      ? motivationChain.causal_paths
      : [motivationChain.causal_paths];
    parts.push(`- 动机因果链: ${paths.join("; ")}`);
  }

  // 核心场景锚点 — 给 AI 一个不可动摇的"第一场景"，消除人设漂移
  const sceneAnchor = CORE_SCENE_ANCHORS[personaName];
  if (sceneAnchor) {
    parts.push("", "## 你的核心游戏场景", sceneAnchor);
  }

  // 深层观点 — 给 AI 提供"可引用的观点素材"，解决深度不足
  const opinions = DEEP_OPINIONS[personaName];
  if (opinions) {
    parts.push("", "## 你判断游戏的标准");
    for (const op of opinions) {
      parts.push(`- ${op}`);
    }
    parts.push("", "在需要分析、评价、判断时，从你的判断标准出发给出有洞察力的分析，而不仅仅是表明态度。");
  }

  // 设计偏好 — 在产品设计题上给每个画像明确的差异化立场
  const designPref = DESIGN_PREFERENCES[personaName];
  if (designPref) {
    parts.push("", "## 你对游戏设计的态度", designPref);
  }

  parts.push(
    "",
    "## 规则",
    "1. 始终以第一人称回答，语气口语化，像真人在聊天。",
    "2. 回答必须符合你的角色设定，不能前后矛盾。",
    "3. 被问到不了解的事（超出你的游戏经验），就说不知道。",
    "4. 不要使用'作为一个人工智能'、'根据我的训练数据'等表述。",
    ...formatSpokenStyleRules(5),
    "",
    "## 你可能知道的背景信息",
    evidenceContext || "(暂无相关背景信息)",
  );

  return parts.join("\n");
}

// ---- 对话路由 ----

// POST /api/chat —— SSE 流式对话
chatRoute.post("/", zValidator("json", chatRequestSchema), async (c) => {
  const { personaId, sessionId, message } = c.req.valid("json");

  // 1. 获取画像
  const persona = await db.query.personas.findFirst({
    where: eq(personas.id, personaId),
  });

  const personaName = persona?.name ?? `画像 #${personaId}`;
  const tagSpec = (persona?.tagSpec ?? {
    诉求: ["竞技证明"],
    能力: "进阶",
    风格: ["主动求战/刚枪"],
    平台: "PC端",
    模式: "PVP为主",
  }) as Record<string, unknown>;
  const motivationChain = (persona?.motivationChain ?? {}) as Record<string, string>;
  const personaDescription =
    persona?.description ?? "该画像已被更新或移除，以下回答基于通用玩家设定。";

  // 2. 获取或创建会话（使用共享引擎）
  const session = await getOrCreateSession({
    findSession: async () => {
      if (!sessionId) return undefined;
      return db.query.chatSessions.findFirst({ where: eq(chatSessions.id, sessionId) });
    },
    createSession: async () => {
      const [s] = await db
        .insert(chatSessions)
        .values({ personaId, title: message.slice(0, 30), messages: [] })
        .returning();
      return s!;
    },
    message,
  });

  // 3. RAG 检索（使用共享引擎）
  const skipRAG = message.trim().length <= 5;
  let evidenceRows: EvidenceRow[] = [];
  // 向量相似度阈值 — 余弦距离转换为相似度后低于此值的不保留
  const SIMILARITY_THRESHOLD = 0.5;

  if (!skipRAG) {
    evidenceRows = await searchEvidence({
      message,
      vectorQuery: async (vecStr) => {
        const rows = (await db.execute(
          sql`SELECT id, original_text, source_file,
                     embedding <=> ${vecStr}::vector AS distance,
                     annotation, speaker_id, preceding_question
              FROM source_segments
              WHERE embedding IS NOT NULL
                AND (annotation->'meta'->>'rs' IS NULL OR annotation->'meta'->>'rs' != 'skip')
                AND (cleaning_status IS NULL OR cleaning_status NOT IN ('removed_noise', 'removed_flow', 'removed_duplicate', 'removed_irrelevant'))
              ORDER BY embedding <=> ${vecStr}::vector
              LIMIT 10`,
        )) as unknown as Array<{
          id: number;
          original_text: string;
          source_file: string;
          distance: number;
          annotation: Record<string, unknown> | null;
          speaker_id: string | null;
          preceding_question: string | null;
        }>;
        return rows
          .map((r) => ({
            id: r.id,
            originalText: r.original_text,
            sourceLabel: r.source_file,
            similarity: 1 - (r.distance ?? 0),
            speakerId: r.speaker_id ?? undefined,
            precedingQuestion: r.preceding_question ?? undefined,
            annotation: r.annotation,
          }))
          .filter((r) => r.similarity >= SIMILARITY_THRESHOLD);
      },
      ilikeQuery: async () => {
        // 使用 pg_trgm 三元组相似度做模糊匹配，比 ILIKE 子串匹配语义更强
        const rows = await db.execute(
          sql`SELECT id, original_text, source_file,
                     similarity(original_text, ${message}) AS sim,
                     annotation, speaker_id, preceding_question
              FROM source_segments
              WHERE similarity(original_text, ${message}) > 0.1
                AND (annotation->'meta'->>'rs' IS NULL OR annotation->'meta'->>'rs' != 'skip')
                AND (cleaning_status IS NULL OR cleaning_status NOT IN ('removed_noise', 'removed_flow', 'removed_duplicate', 'removed_irrelevant'))
              ORDER BY sim DESC
              LIMIT 10`,
        ) as unknown as Array<{
          id: number;
          original_text: string;
          source_file: string;
          sim: number;
          annotation: Record<string, unknown> | null;
          speaker_id: string | null;
          preceding_question: string | null;
        }>;
        return rows.map((r) => ({
          id: r.id,
          originalText: r.original_text,
          sourceLabel: r.source_file,
          similarity: Math.round(r.sim * 100) / 100, // pg_trgm 相似度 0-1，保留两位
          speakerId: r.speaker_id ?? undefined,
          precedingQuestion: r.preceding_question ?? undefined,
          annotation: r.annotation,
        }));
      },
    });
  }

  const evidenceContext = formatEvidenceContext(
    evidenceRows,
    (e) => `[来源: ${e.sourceLabel}]`,
  );

  // 3.5 计算置信度 + 增强证据元数据
  const evidenceAnnotations = evidenceRows.map((e) => e.annotation ?? null);
  const tagOverlapRatio = computeTagOverlap(tagSpec, evidenceAnnotations);

  const similarities = evidenceRows
    .map((e) => e.similarity ?? 0)
    .filter((s) => s > 0);
  const topSimilarity = similarities.length > 0 ? Math.max(...similarities) : 0;
  const avgSimilarity =
    similarities.length > 0
      ? similarities.reduce((a, b) => a + b, 0) / similarities.length
      : 0;

  const hasDirectQuote = evidenceRows.some(
    (e) => (e.matchLevel ?? classifyMatchLevel(e.similarity ?? 0)) === "direct",
  );

  const confidenceResult = calculateConfidence({
    evidenceCount: evidenceRows.length,
    topSimilarity,
    avgSimilarity,
    tagOverlapRatio,
    sampleCount: persona?.sampleCount ?? 50,
    hasDirectQuote,
    isBoundaryQuestion: false,
  });

  const evidenceMeta: EvidenceMeta[] = evidenceRows.map((e) => {
    const similarity = e.similarity ?? 0;
    const matchLevel = e.matchLevel ?? classifyMatchLevel(similarity);
    const tagOverlap = e.tagOverlap ?? tagOverlapRatio;
    return { id: e.id, similarity, matchLevel, tagOverlap };
  });

  // 4. 构建 System Prompt
  const systemPrompt = buildSystemPrompt(
    personaName,
    personaDescription,
    tagSpec,
    motivationChain,
    evidenceContext,
  );

  // 5. 构建对话历史
  const history = (session.messages as Array<{ role: string; content: string }>) ?? [];
  const compressedHistory = compressHistory(history);

  const llmMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...compressedHistory.map((m) => ({
      role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: message },
  ];

  // 6. 流式响应（使用共享引擎）
  return streamChat({
    c,
    llmMessages,
    sessionId: session.id,
    evidenceIds: evidenceRows.map((e) => e.id),
    evidenceData: evidenceRows,
    history,
    userMessage: message,
    errorMessage: "[模拟用户暂时无法响应，请稍后重试]",
    confidence: confidenceResult,
    evidenceMeta,
    saveMessages: async (updatedMessages) => {
      await db
        .update(chatSessions)
        .set({ messages: updatedMessages as never, updatedAt: new Date() })
        .where(eq(chatSessions.id, session.id));
    },
    updateTitle: async (title) => {
      await db
        .update(chatSessions)
        .set({ title, updatedAt: new Date() })
        .where(eq(chatSessions.id, session.id));
    },
  });
});

// GET /api/chat/sessions —— 列出所有会话（支持分页：?offset=N&limit=N）
chatRoute.get("/sessions", async (c) => {
  const personaId = c.req.query("personaId");
  const offset = Number(c.req.query("offset")) || 0;
  const limit = Number(c.req.query("limit")) || 50;
  const conditions = personaId
    ? and(eq(chatSessions.personaId, Number(personaId)))
    : undefined;

  const rows = await db
    .select()
    .from(chatSessions)
    .where(conditions)
    .orderBy(desc(chatSessions.updatedAt))
    .limit(limit)
    .offset(offset);

  // 总数
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(chatSessions)
    .where(conditions);

  const total = Number(countRow?.count ?? 0);
  const hasMore = offset + limit < total;

  const result: ChatSession[] = rows.map((r) => ({
    id: r.id,
    personaId: r.personaId,
    title: r.title,
    messages: (r.messages as ChatSession["messages"]) ?? [],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return c.json({ data: result, total, hasMore });
});

// GET /api/chat/sessions/:id —— 对话历史（支持分页：?offset=N&limit=N）
chatRoute.get("/sessions/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "无效的会话 ID" }, 400);

  const offset = Number(c.req.query("offset")) || 0;
  const limit = Number(c.req.query("limit")) || 0;

  const session = await db.query.chatSessions.findFirst({
    where: eq(chatSessions.id, id),
  });

  if (!session) return c.json({ error: "会话不存在" }, 404);

  const allMessages = (session.messages as ChatSession["messages"]) ?? [];
  const totalMessages = allMessages.length;

  // 分页切片：从末尾往前取（offset 0 = 最新消息）
  // 例如 totalMessages=100, offset=0, limit=40 → 取最后 40 条
  // offset=40, limit=40 → 取倒数第 41-80 条
  let slicedMessages = allMessages;
  if (limit > 0) {
    const start = Math.max(0, totalMessages - offset - limit);
    const end = totalMessages - offset;
    slicedMessages = allMessages.slice(start, end);
  }
  const hasMore = limit > 0 ? (totalMessages - offset - limit) > 0 : false;

  const result = {
    id: session.id,
    personaId: session.personaId,
    title: session.title,
    messages: slicedMessages,
    totalMessages,
    hasMore,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };

  return c.json(result);
});

// DELETE /api/chat/sessions/:id —— 删除会话
chatRoute.delete("/sessions/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "无效的会话 ID" }, 400);

  const session = await db.query.chatSessions.findFirst({
    where: eq(chatSessions.id, id),
  });

  if (!session) return c.json({ error: "会话不存在" }, 404);

  await db.delete(chatSessions).where(eq(chatSessions.id, id));

  return c.json({ success: true });
});

// POST /api/chat/sessions/batch-delete —— 批量删除会话
// body: { ids?: number[], personaId?: number } — ids 指定删除，personaId 删除该画像全部，都不传删除全部
chatRoute.post("/sessions/batch-delete", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { ids, personaId } = body as { ids?: number[]; personaId?: number };

  if (ids && ids.length > 0) {
    await db.delete(chatSessions).where(inArray(chatSessions.id, ids));
    return c.json({ success: true, deletedCount: ids.length });
  }

  if (personaId !== undefined) {
    const result = await db.delete(chatSessions).where(eq(chatSessions.personaId, personaId));
    return c.json({ success: true });
  }

  // 删除全部
  await db.delete(chatSessions);
  return c.json({ success: true });
});