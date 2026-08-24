// --------------------------------------------------------------
// 批量访谈路由 — 大规模自动访谈 + 报告生成
// --------------------------------------------------------------

import type {
  BatchInterviewConfig,
  BatchInterviewReport,
  BatchInterviewStatus,
  InterviewResult,
} from "@app/shared";
import { batchInterviewConfigSchema, normalizeTagSpec, tagSpecToPrompt } from "@app/shared";
import { zValidator } from "@hono/zod-validator";
import { eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";

import { db } from "../db/client.js";
import { personas, sourceSegments } from "../db/schema.js";
import type { ChatMessage } from "../lib/llm.js";
import { chat } from "../lib/llm.js";
import { SPOKEN_STYLE_RULES, formatSpokenStyleRules } from "../lib/prompt-rules.js";

export const batchInterviewRoute = new Hono();

// 内存中的作业存储
const jobStore = new Map<string, BatchInterviewStatus>();
const reportStore = new Map<string, BatchInterviewReport>();

// ---- 启动批量访谈 ----

// POST /api/interview/batch/start
batchInterviewRoute.post(
  "/start",
  zValidator("json", batchInterviewConfigSchema),
  async (c) => {
    const config = c.req.valid("json") as BatchInterviewConfig;
    const jobId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // 预估耗时：每画像 × 每轮问题数 × 5s + 报告生成 30s
    const questionCount = Math.min(
      config.outline?.sections?.flatMap((s) => s.questions).length ?? 10,
      config.maxRoundsPerPersona ?? 10,
    );
    const estimatedTotalMs = Math.max(
      30_000,
      config.personaIds.length * questionCount * 5_000 + 30_000,
    );

    const status: BatchInterviewStatus = {
      jobId,
      status: "pending",
      progress: 0,
      estimatedTotalMs,
      completedPersonas: [],
      totalPersonas: config.personaIds.length,
      totalRounds: 0,
      progressByPersona: {},
      startedAt: new Date().toISOString(),
      estimatedCompletionAt: null,
    };

    jobStore.set(jobId, status);

    // 异步执行
    executeBatchInterview(jobId, config).catch((e) => {
      const current = jobStore.get(jobId);
      if (current) current.status = "failed";
      console.error("批量访谈失败:", e);
    });

    return c.json({ jobId, status });
  },
);

// ---- 查询批量访谈状态 ----

// GET /api/interview/batch/status/:jobId
batchInterviewRoute.get("/status/:jobId", async (c) => {
  const { jobId } = c.req.param();
  const status = jobStore.get(jobId);
  if (!status) return c.json({ error: "作业不存在" }, 404);

  if (status.status !== "completed" && status.status !== "failed") {
    const elapsed = Date.now() - new Date(status.startedAt).getTime();

    // 自适应校准：当有至少一个画像完成时，基于实际速度重新预估
    if (status.completedPersonas.length > 0) {
      const avgMsPerPersona = elapsed / status.completedPersonas.length;
      const remainingPersonas = status.totalPersonas - status.completedPersonas.length;
      // 重新预估：已耗时 + 剩余画像耗时 + 报告生成 30s
      status.estimatedTotalMs = Math.round(
        elapsed + avgMsPerPersona * remainingPersonas + 30_000,
      );
    } else if (elapsed > status.estimatedTotalMs * 0.5) {
      // 第一个画像还没完成但已超过预估的 50%，延长预估
      status.estimatedTotalMs = Math.round(elapsed * status.totalPersonas * 1.2);
    }

    // 时间驱动进度（单调，不回退）
    const rawProgress = Math.round((elapsed / status.estimatedTotalMs) * 100);
    status.progress = Math.max(status.progress, Math.min(99, rawProgress));

    // 剩余时间
    status.estimatedRemainingMs = Math.max(0, status.estimatedTotalMs - elapsed);
  }

  return c.json(status);
});

// ---- 列出所有作业（用于页面刷新后恢复） ----

// GET /api/interview/batch/jobs
batchInterviewRoute.get("/jobs", async (c) => {
  const jobs = Array.from(jobStore.values()).sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
  return c.json(jobs);
});

// ---- 获取批量访谈报告 ----

// GET /api/interview/batch/report/:jobId
batchInterviewRoute.get("/report/:jobId", async (c) => {
  const { jobId } = c.req.param();
  const report = reportStore.get(jobId);
  if (!report) return c.json({ error: "报告不存在或尚未生成" }, 404);
  return c.json(report);
});

// ---- 执行批量访谈 ----

async function executeBatchInterview(
  jobId: string,
  config: BatchInterviewConfig,
) {
  const updateStatus = (patch: Partial<BatchInterviewStatus>) => {
    const current = jobStore.get(jobId);
    if (current) Object.assign(current, patch);
  };

  updateStatus({ status: "running" });

  try {
    // 获取画像信息
    const personaRows = await db
      .select({
        id: personas.id,
        name: personas.name,
        description: personas.description,
        tagSpec: personas.tagSpec,
        motivationChain: personas.motivationChain,
      })
      .from(personas)
      .where(inArray(personas.id, config.personaIds));

    const personaMap = new Map(personaRows.map((p) => [p.id, p]));

    // 获取或使用传入的大纲（空数组也回退到默认问题集）
    const outlineQuestions =
      config.outline?.sections?.flatMap((s) =>
        s.questions.map((q) => q.question),
      ) ?? [];
    const questions =
      outlineQuestions.length > 0
        ? outlineQuestions
        : generateDefaultQuestions(config);

    const results: InterviewResult[] = [];
    const maxRounds = config.maxRoundsPerPersona ?? Math.min(questions.length, 10);
    const activeQuestions = questions.slice(0, maxRounds);

    // 逐个画像进行访谈（并发控制）
    const concurrency = config.concurrency ?? 3;
    for (let i = 0; i < config.personaIds.length; i += concurrency) {
      const batch = config.personaIds.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map((personaId) =>
          interviewPersona(personaId, personaMap, activeQuestions, jobId),
        ),
      );

      for (const result of batchResults) {
        if (result) {
          results.push(result);
          updateStatus({
            completedPersonas: [
              ...(jobStore.get(jobId)?.completedPersonas ?? []),
              result.personaId,
            ],
            totalRounds:
              (jobStore.get(jobId)?.totalRounds ?? 0) + result.rounds.length,
          });
        }
      }
    }

    // 生成综合分析报告
    const report = await generateReport(jobId, config, results);
    reportStore.set(jobId, report);

    updateStatus({
      status: "completed",
      progress: 100,
      completedPersonas: results.map((r) => r.personaId),
    });
  } catch (e) {
    console.error("批量访谈执行失败:", e);
    updateStatus({
      status: "failed",
      error: String(e).slice(0, 500),
    });
  }
}

// ---- 单个画像访谈 ----

async function interviewPersona(
  personaId: number,
  personaMap: Map<
    number,
    {
      id: number;
      name: string;
      description: string | null;
      tagSpec: unknown;
      motivationChain: unknown;
    }
  >,
  questions: string[],
  jobId: string,
): Promise<InterviewResult | null> {
  const persona = personaMap.get(personaId);
  if (!persona) return null;

  const personaName = persona.name;
  const tagSpec = persona.tagSpec as Record<string, unknown>;
  const motivationChain = persona.motivationChain as Record<string, unknown>;

  // 构建 System Prompt（匹配 chat.ts 结构：玩家画像 + 深层特征）
  const parts: string[] = [
    `你是「${personaName}」，${persona.description ?? "一位射击游戏玩家。"}`,
  ];

  // 玩家画像：显性标签 → 自然语言
  const personaPrompt = tagSpecToPrompt(normalizeTagSpec(tagSpec));
  if (personaPrompt) {
    parts.push("", "## 你的玩家画像", personaPrompt);
  }

  // 深层特征：动机链（冰山下层）
  const deepParts: string[] = [];
  const mc = motivationChain as Record<string, string>;
  if (mc.M1_motivation) {
    deepParts.push(`- 核心动机: ${mc.M1_motivation}`);
  }
  if (mc.M3_perception) {
    deepParts.push(`- 认知框架: ${mc.M3_perception}`);
  }
  if (mc.M5_behavior) {
    deepParts.push(`- 行为模式: ${mc.M5_behavior}`);
  }
  if (mc.M4_emotion) {
    deepParts.push(`- 典型情绪: ${mc.M4_emotion}`);
  }
  if (mc.causal_paths) {
    const paths = Array.isArray(mc.causal_paths) ? mc.causal_paths : [mc.causal_paths];
    deepParts.push(`- 动机因果链: ${paths.join("; ")}`);
  }
  if (deepParts.length) {
    parts.push("", "## 你的深层特征", ...deepParts);
  }

  parts.push(
    "",
    "## 规则",
    "1. 始终以第一人称回答，语气自然、口语化，像一个真实的玩家在聊天。",
    "2. 你的回答必须符合你的画像特征，不能前后矛盾。",
    "3. 被问到不了解的事，诚实地说不了解或没想过。",
    "4. 不要使用「作为一个人工智能」等表述——你是真实的玩家。",
    "5. 回答要有个性，不要中性圆滑。",
    "6. 尽量提供具体的行为、场景和感受，而不是抽象概括。",
    ...formatSpokenStyleRules(7),
  );

  const systemPrompt = parts.join("\n");

  const rounds: InterviewResult["rounds"] = [];

  for (let qi = 0; qi < questions.length; qi++) {
    const question = questions[qi]!;
    // 更新当前进度：正在访谈哪个画像、哪个问题（按画像 ID 记录，避免并发互相覆盖）
    const store = jobStore.get(jobId);
    if (store) {
      store.progressByPersona = {
        ...(store.progressByPersona ?? {}),
        [String(personaId)]: {
          name: personaName,
          question: `问题 ${qi + 1}/${questions.length}: ${question.slice(0, 50)}...`,
        },
      };
    }

    try {
      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
      ];

      // 添加历史对话上下文
      for (const round of rounds.slice(-4)) {
        messages.push({ role: "user", content: round.question });
        messages.push({ role: "assistant", content: round.answer });
      }

      messages.push({ role: "user", content: question });

      const answer = await chat(messages, {
        temperature: 0.8,
        maxTokens: 1024,
      });

      rounds.push({
        question,
        answer,
        evidenceIds: [],
      });

      // 避免请求过快
      await new Promise((r) => setTimeout(r, 200));
    } catch (e) {
      console.error(`画像 ${personaName} 问题 ${qi + 1} 访谈失败:`, e);
      rounds.push({
        question,
        answer: `[回答失败: ${String(e).slice(0, 100)}]`,
        evidenceIds: [],
      });
    }
  }

  // 清除当前画像的进度
  const store = jobStore.get(jobId);
  if (store) {
    const next = { ...(store.progressByPersona ?? {}) };
    delete next[String(personaId)];
    store.progressByPersona = next;
  }

  // 提取关键洞察
  const keyInsights = await extractInsights(
    personaName,
    rounds.map((r) => ({ question: r.question, answer: r.answer })),
  );

  return {
    personaId,
    personaName,
    rounds,
    keyInsights,
    completedAt: new Date().toISOString(),
  };
}

// ---- 提取关键洞察 ----

async function extractInsights(
  personaName: string,
  qaPairs: { question: string; answer: string }[],
): Promise<string[]> {
  const conversationText = qaPairs
    .map((qa) => `Q: ${qa.question}\nA: ${qa.answer}`)
    .join("\n\n");

  const systemPrompt = [
    "你是一位用户研究分析师。请从以下访谈记录中提取 3-5 个关键洞察。",
    "每个洞察应简洁、有见地，能反映被访者的核心态度、动机或行为模式。",
    "",
    "以 JSON 数组格式输出：",
    '["洞察1", "洞察2", "洞察3"]',
    "只输出 JSON 数组，不要其他内容。",
  ].join("\n");

  try {
    const response = await chat(
      [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `被访者：${personaName}\n\n访谈记录：\n${conversationText.slice(0, 3000)}`,
        },
      ],
      { temperature: 0.5, maxTokens: 1024 },
    );

    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]) as string[];
    return [];
  } catch {
    return [];
  }
}

// ---- 生成综合报告 ----

async function generateReport(
  jobId: string,
  config: BatchInterviewConfig,
  results: InterviewResult[],
): Promise<BatchInterviewReport> {
  // 将结果汇总，用 LLM 生成综合分析
  const allInsights = results.flatMap((r) =>
    r.keyInsights.map((i) => `[${r.personaName}] ${i}`),
  );

  const systemPrompt = [
    "你是一位资深用户研究分析师。请根据多个用户画像的访谈结果，生成一份综合分析报告。",
    "",
    "## 输出格式",
    "以 JSON 格式输出：",
    '{',
    '  "crossCuttingThemes": ["跨画像的共性主题1", "主题2", ...],',
    '  "personaComparison": [',
    '    {',
    '      "theme": "对比维度",',
    '      "observations": [',
    '        {"personaId": 1, "personaName": "画像名", "stance": "该画像在此维度的立场/态度", "quote": "代表性引用"}',
    '      ]',
    '    }',
    '  ]',
    '}',
    "只输出 JSON，不要其他内容。",
  ].join("\n");

  const summaryText = results
    .map(
      (r) =>
        `## ${r.personaName}\n关键洞察：\n${r.keyInsights.map((i) => `- ${i}`).join("\n")}`,
    )
    .join("\n\n");

  let crossCuttingThemes: string[] = [];
  let personaComparison: BatchInterviewReport["summary"]["personaComparison"] =
    [];

  try {
    const response = await chat(
      [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `以下是对 ${results.length} 个用户画像的批量访谈结果摘要：\n\n${summaryText.slice(0, 6000)}\n\n请生成综合分析报告。`,
        },
      ],
      { temperature: 0.5, maxTokens: 3072 },
    );

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]) as {
        crossCuttingThemes: string[];
        personaComparison: BatchInterviewReport["summary"]["personaComparison"];
      };
      crossCuttingThemes = analysis.crossCuttingThemes ?? [];
      personaComparison = analysis.personaComparison ?? [];
    }
  } catch (e) {
    console.error("报告生成失败:", e);
  }

  return {
    jobId,
    config,
    results,
    summary: {
      totalInterviews: config.personaIds.length,
      completedInterviews: results.length,
      totalRounds: results.reduce((sum, r) => sum + r.rounds.length, 0),
      crossCuttingThemes,
      personaComparison,
    },
    generatedAt: new Date().toISOString(),
  };
}

// ---- 默认问题生成 ----

function generateDefaultQuestions(config: BatchInterviewConfig): string[] {
  return [
    "你平时最喜欢玩哪些射击游戏？为什么喜欢它们？",
    "你每天大概花多少时间玩游戏？什么时间段玩？",
    "你觉得一款好玩的射击游戏最重要的是什么？",
    "你会因为什么原因放弃一款射击游戏？",
    "你如何看待游戏中的付费内容？你愿意为什么付费？",
    "你通常通过什么渠道了解新游戏？",
    "和朋友一起玩比自己玩更有趣吗？为什么？",
    "你觉得现在的射击游戏有什么让你不满意的地方？",
    "有没有一款游戏让你特别投入？是什么让你沉浸其中？",
    "对于新游戏，你最看重什么（画面、玩法、社交、其他）？",
  ];
}