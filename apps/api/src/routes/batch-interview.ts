// --------------------------------------------------------------
// 批量访谈路由 — 大规模自动访谈 + 报告生成
// 持久化到 PostgreSQL，支持页面刷新/重启后恢复
// --------------------------------------------------------------

import type {
  BatchInterviewConfig,
  BatchInterviewReport,
  BatchInterviewStatus,
  InterviewResult,
} from "@app/shared";
import { batchInterviewConfigSchema, normalizeTagSpec, tagSpecToPrompt } from "@app/shared";
import { zValidator } from "@hono/zod-validator";
import { desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";

import { db } from "../db/client.js";
import { batchInterviewJobs, batchInterviewReports, personas } from "../db/schema.js";
import type { ChatMessage } from "../lib/llm.js";
import { chat } from "../lib/llm.js";
import { SPOKEN_STYLE_RULES, formatSpokenStyleRules } from "../lib/prompt-rules.js";

export const batchInterviewRoute = new Hono();

// 固定时间校准：记录每个 job 上次校准的 elapsed 时间
const batchCalibrationStore = new Map<string, number>();
const BATCH_CALIBRATION_INTERVAL = 30_000; // 每 30 秒校准一次

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

    const now = new Date();
    const estimatedCompletionAt = new Date(now.getTime() + estimatedTotalMs);

    // 持久化作业到 DB
    await db.insert(batchInterviewJobs).values({
      jobId,
      status: "pending",
      progress: 0,
      estimatedTotalMs,
      completedPersonas: [],
      totalPersonas: config.personaIds.length,
      totalRounds: 0,
      progressByPersona: {},
      startedAt: now,
      estimatedCompletionAt,
      config: config as any,
    });

    const status: BatchInterviewStatus = {
      jobId,
      status: "pending",
      progress: 0,
      estimatedTotalMs,
      completedPersonas: [],
      totalPersonas: config.personaIds.length,
      totalRounds: 0,
      progressByPersona: {},
      startedAt: now.toISOString(),
      estimatedCompletionAt: estimatedCompletionAt.toISOString(),
    };

    // 异步执行
    executeBatchInterview(jobId, config).catch((e) => {
      console.error("批量访谈失败:", e);
      db.update(batchInterviewJobs)
        .set({ status: "failed", error: String(e).slice(0, 500) })
        .where(eq(batchInterviewJobs.jobId, jobId))
        .execute()
        .catch(() => {});
    });

    return c.json({ jobId, status });
  },
);

// ---- 查询批量访谈状态 ----

// GET /api/interview/batch/status/:jobId
batchInterviewRoute.get("/status/:jobId", async (c) => {
  const { jobId } = c.req.param();
  const rows = await db
    .select()
    .from(batchInterviewJobs)
    .where(eq(batchInterviewJobs.jobId, jobId))
    .limit(1);

  const job = rows[0];
  if (!job) return c.json({ error: "作业不存在" }, 404);

  const status: BatchInterviewStatus = {
    jobId: job.jobId,
    status: job.status as BatchInterviewStatus["status"],
    progress: job.progress ?? 0,
    estimatedTotalMs: job.estimatedTotalMs ?? 30000,
    estimatedRemainingMs: job.estimatedRemainingMs ?? undefined,
    completedPersonas: job.completedPersonas ?? [],
    totalPersonas: job.totalPersonas ?? 0,
    totalRounds: job.totalRounds ?? 0,
    progressByPersona: (job.progressByPersona ?? undefined) as BatchInterviewStatus["progressByPersona"],
    startedAt: job.startedAt?.toISOString() ?? new Date().toISOString(),
    estimatedCompletionAt: job.estimatedCompletionAt?.toISOString() ?? null,
    error: job.error ?? undefined,
  };

  if (job.status !== "completed" && job.status !== "failed") {
    const elapsed = Date.now() - (job.startedAt?.getTime() ?? Date.now());

    // 固定时间校准：每隔 30 秒重新计算预估
    const lastCalibration = batchCalibrationStore.get(jobId) ?? 0;
    if (elapsed - lastCalibration >= BATCH_CALIBRATION_INTERVAL) {
      batchCalibrationStore.set(jobId, elapsed);

      if ((job.completedPersonas ?? []).length > 0) {
        const avgMsPerPersona = elapsed / (job.completedPersonas ?? []).length;
        const remainingPersonas = (job.totalPersonas ?? 0) - (job.completedPersonas ?? []).length;
        status.estimatedTotalMs = Math.round(
          elapsed + avgMsPerPersona * remainingPersonas + 30_000,
        );
      } else if (elapsed > (job.estimatedTotalMs ?? 30000) * 0.5) {
        status.estimatedTotalMs = Math.round(elapsed * (job.totalPersonas ?? 1) * 1.2);
      }

      // 异步更新 DB
      db.update(batchInterviewJobs)
        .set({ estimatedTotalMs: status.estimatedTotalMs })
        .where(eq(batchInterviewJobs.jobId, jobId))
        .execute()
        .catch(() => {});
    }

    // 基于实际完成画像数计算进度（单调，不回退），时间驱动作为兜底
    const actualProgress = (job.totalPersonas ?? 1) > 0
      ? Math.round(((job.completedPersonas ?? []).length / (job.totalPersonas ?? 1)) * 100)
      : 0;
    const timeProgress = Math.round((elapsed / status.estimatedTotalMs) * 100);
    status.progress = Math.max(job.progress ?? 0, Math.min(99, Math.max(actualProgress, timeProgress)));
    status.estimatedRemainingMs = Math.max(0, status.estimatedTotalMs - elapsed);

    // 异步更新 DB 进度
    db.update(batchInterviewJobs)
      .set({
        progress: status.progress,
        estimatedRemainingMs: status.estimatedRemainingMs,
      })
      .where(eq(batchInterviewJobs.jobId, jobId))
      .execute()
      .catch(() => {});
  }

  return c.json(status);
});

// ---- 列出所有作业（用于页面刷新后恢复） ----

// GET /api/interview/batch/jobs
batchInterviewRoute.get("/jobs", async (c) => {
  const rows = await db
    .select()
    .from(batchInterviewJobs)
    .orderBy(desc(batchInterviewJobs.startedAt));

  return c.json(
    rows.map((job) => ({
      jobId: job.jobId,
      status: job.status as BatchInterviewStatus["status"],
      progress: job.progress ?? 0,
      estimatedTotalMs: job.estimatedTotalMs ?? 30000,
      completedPersonas: job.completedPersonas ?? [],
      totalPersonas: job.totalPersonas ?? 0,
      totalRounds: job.totalRounds ?? 0,
      progressByPersona: job.progressByPersona ?? undefined,
      startedAt: job.startedAt?.toISOString() ?? new Date().toISOString(),
      estimatedCompletionAt: job.estimatedCompletionAt?.toISOString() ?? null,
      error: job.error ?? undefined,
    } satisfies BatchInterviewStatus)),
  );
});

// ---- 获取批量访谈报告 ----

// GET /api/interview/batch/report/:jobId
batchInterviewRoute.get("/report/:jobId", async (c) => {
  const { jobId } = c.req.param();
  const rows = await db
    .select()
    .from(batchInterviewReports)
    .where(eq(batchInterviewReports.jobId, jobId))
    .limit(1);

  const row = rows[0];
  if (!row) return c.json({ error: "报告不存在或尚未生成" }, 404);

  return c.json(row.report as BatchInterviewReport);
});

// ---- 取消批量访谈作业 ----

// POST /api/interview/batch/cancel/:jobId
batchInterviewRoute.post("/cancel/:jobId", async (c) => {
  const { jobId } = c.req.param();

  // 标记作业为已取消，后续清理由 executeBatchInterview 中的检查完成
  await db
    .update(batchInterviewJobs)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(eq(batchInterviewJobs.jobId, jobId))
    .execute();

  return c.json({ success: true, message: "批量访谈已取消" });
});

// ---- 执行批量访谈 ----

async function executeBatchInterview(
  jobId: string,
  config: BatchInterviewConfig,
) {
  const updateJob = async (patch: Record<string, unknown>) => {
    await db.update(batchInterviewJobs)
      .set(patch as any)
      .where(eq(batchInterviewJobs.jobId, jobId))
      .execute();
  };

  // 检查是否已被取消
  const checkCancelled = async (): Promise<boolean> => {
    try {
      const rows = await db
        .select({ status: batchInterviewJobs.status })
        .from(batchInterviewJobs)
        .where(eq(batchInterviewJobs.jobId, jobId))
        .limit(1);
      return rows[0]?.status === "cancelled";
    } catch {
      return false;
    }
  };

  await updateJob({ status: "running" as any });

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
      // 每批开始前检查是否已被取消
      if (await checkCancelled()) {
        console.log(`批量访谈作业 ${jobId} 已被取消，停止执行`);
        return;
      }

      const batch = config.personaIds.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map((personaId) =>
          interviewPersona(personaId, personaMap, activeQuestions, jobId),
        ),
      );

      for (const result of batchResults) {
        if (result) {
          results.push(result);

          // 更新 DB 中的完成状态
          const currentJob = await db
            .select()
            .from(batchInterviewJobs)
            .where(eq(batchInterviewJobs.jobId, jobId))
            .limit(1);

          const current = currentJob[0];
          if (current) {
            const completedPersonas = [...(current.completedPersonas ?? []), result.personaId];
            const totalRounds = (current.totalRounds ?? 0) + result.rounds.length;
            await updateJob({
              completedPersonas,
              totalRounds,
            });
          }
        }
      }
    }

    // 生成综合分析报告
    const report = await generateReport(jobId, config, results);

    // 持久化报告到 DB
    await db.insert(batchInterviewReports).values({
      jobId,
      report: report as any,
    });

    await updateJob({
      status: "completed",
      progress: 100,
      completedAt: new Date(),
      completedPersonas: results.map((r) => r.personaId),
    });
  } catch (e) {
    console.error("批量访谈执行失败:", e);
    await updateJob({
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
    // 每 5 个问题检查一次取消状态
    if (qi % 5 === 0) {
      const currentJob = await db
        .select()
        .from(batchInterviewJobs)
        .where(eq(batchInterviewJobs.jobId, jobId))
        .limit(1);
      if (currentJob[0]?.status === "cancelled") {
        console.log(`批量访谈作业 ${jobId} 在画像 ${personaName} 问题 ${qi + 1} 前被取消`);
        // 返回现有结果（如果有的话）
        break;
      }
    }

    const question = questions[qi]!;
    // 更新当前进度：正在访谈哪个画像、哪个问题
    const currentJob = await db
      .select()
      .from(batchInterviewJobs)
      .where(eq(batchInterviewJobs.jobId, jobId))
      .limit(1);

    const store = currentJob[0];
    if (store) {
      const existingProgress = (store.progressByPersona ?? {}) as Record<string, { name: string; question: string }>;
      const nextProgress = {
        ...existingProgress,
        [String(personaId)]: {
          name: personaName,
          question: `问题 ${qi + 1}/${questions.length}: ${question.slice(0, 50)}...`,
        },
      };
      await db.update(batchInterviewJobs)
        .set({ progressByPersona: nextProgress as any })
        .where(eq(batchInterviewJobs.jobId, jobId))
        .execute();
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

      const QUESTION_TIMEOUT_MS = 60_000;
      const answer = await Promise.race([
        chat(messages, {
          temperature: 0.8,
          maxTokens: 1024,
        }),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("LLM 调用超时")), QUESTION_TIMEOUT_MS),
        ),
      ]);

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
  const currentJob = await db
    .select()
    .from(batchInterviewJobs)
    .where(eq(batchInterviewJobs.jobId, jobId))
    .limit(1);

  if (currentJob[0]) {
    const existingProgress = (currentJob[0].progressByPersona ?? {}) as Record<string, { name: string; question: string }>;
    const next = { ...existingProgress };
    delete next[String(personaId)];
    await db.update(batchInterviewJobs)
      .set({ progressByPersona: next as any })
      .where(eq(batchInterviewJobs.jobId, jobId))
      .execute();
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
    const INSIGHT_TIMEOUT_MS = 60_000;
    const response = await Promise.race([
      chat(
        [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `被访者：${personaName}\n\n访谈记录：\n${conversationText.slice(0, 3000)}`,
          },
        ],
        { temperature: 0.5, maxTokens: 1024 },
      ),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("洞察提取超时")), INSIGHT_TIMEOUT_MS),
      ),
    ]);

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
  // 按问题聚合所有画像的回答，供 LLM 进行问题聚焦分析
  const questionMap = new Map<string, { personaName: string; answer: string; personaId: number }[]>();
  for (const result of results) {
    for (const round of result.rounds) {
      const q = round.question;
      if (!questionMap.has(q)) questionMap.set(q, []);
      questionMap.get(q)!.push({
        personaName: result.personaName,
        answer: round.answer,
        personaId: result.personaId,
      });
    }
  }

  // 构建问题聚合文本
  const questionSummaries = Array.from(questionMap.entries()).map(([question, responses]) => {
    const responseText = responses
      .map((r) => `[${r.personaName}] ${r.answer.slice(0, 400)}`)
      .join("\n---\n");
    return `## 问题：${question}\n回答人数：${responses.length}\n\n${responseText}`;
  });

  const systemPrompt = [
    "你是一位资深用户研究分析师。请根据多个用户画像对同一组访谈问题的回答，按问题维度进行综合分析。",
    "",
    "## 分析要求",
    "对每个问题，分析：",
    "1. 总结该问题的整体回答情况（summary）",
    "2. 提炼跨画像的共性发现（commonThemes）",
    "3. 各画像的核心观点和代表性引用（personaResponses）",
    "4. 不同画像之间的分歧和差异点（divergences）",
    "",
    "## 输出格式",
    "以 JSON 格式输出：",
    '{',
    '  "questionAnalysis": [',
    '    {',
    '      "question": "问题原文",',
    '      "summary": "对该问题的整体分析总结",',
    '      "commonThemes": ["共性发现1", "共性发现2"],',
    '      "personaResponses": [',
    '        {"personaId": 1, "personaName": "画像名", "keyPoint": "核心观点", "quote": "代表性原话引用"},',
    '      ],',
    '      "divergences": ["分歧点1", "分歧点2"]',
    '    }',
    '  ]',
    '}',
    "只输出 JSON，不要其他内容。",
  ].join("\n");

  let questionAnalysis: BatchInterviewReport["summary"]["questionAnalysis"] = [];

  try {
    const REPORT_TIMEOUT_MS = 120_000;
    const response = await Promise.race([
      chat(
        [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `以下是对 ${results.length} 个用户画像的批量访谈结果，按问题聚合：\n\n${questionSummaries.join("\n\n").slice(0, 8000)}\n\n请按问题维度生成综合分析报告。`,
          },
        ],
        { temperature: 0.5, maxTokens: 4096 },
      ),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("报告生成超时")), REPORT_TIMEOUT_MS),
      ),
    ]);

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]) as {
        questionAnalysis: BatchInterviewReport["summary"]["questionAnalysis"];
      };
      questionAnalysis = analysis.questionAnalysis ?? [];
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
      questionAnalysis,
    },
    generatedAt: new Date().toISOString(),
  };
}

// ---- 默认问题生成 ----

function generateDefaultQuestions(config: BatchInterviewConfig): string[] {
  return [
    "你平时最喜欢使用哪些产品/服务？为什么喜欢它们？",
    "你每天大概花多少时间使用这类产品？什么场景下使用？",
    "你觉得一款好用的产品最重要的是什么？",
    "你会因为什么原因放弃使用一款产品？",
    "你如何看待产品中的付费内容？你愿意为什么付费？",
    "你通常通过什么渠道了解新产品？",
    "和朋友一起使用比自己使用更有趣吗？为什么？",
    "你觉得现在的同类产品有什么让你不满意的地方？",
    "有没有一款产品让你特别投入？是什么让你沉浸其中？",
    "对于新产品，你最看重什么（体验、功能、社交、其他）？",
  ];
}