// --------------------------------------------------------------
// 访谈大纲路由 — 根据访谈主题自动生成大纲和问题
// 持久化到 PostgreSQL，支持页面刷新/重启后恢复
// --------------------------------------------------------------

import type { InterviewOutline, OutlineJobStatus } from "@app/shared";
import { outlineGenerateRequestSchema } from "@app/shared";
import { zValidator } from "@hono/zod-validator";
import { desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";

import { db } from "../db/client.js";
import { interviewOutlines, outlineJobs, personas } from "../db/schema.js";
import type { ChatMessage } from "../lib/llm.js";
import { chat } from "../lib/llm.js";

export const interviewOutlineRoute = new Hono();

// 固定时间校准：记录每个 job 上次校准的 elapsed 时间
const outlineCalibrationStore = new Map<string, number>();
const OUTLINE_CALIBRATION_INTERVAL = 15_000; // 每 15 秒校准一次

// ---- 生成访谈大纲（异步） ----

// POST /api/interview/outline/generate
interviewOutlineRoute.post(
  "/generate",
  zValidator("json", outlineGenerateRequestSchema),
  async (c) => {
    const req = c.req.valid("json");
    const jobId = `outline-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // 预估耗时：基础 30s + 每个问题 0.5s
    const estimatedTotalMs = Math.min(
      60_000,
      Math.max(20_000, 30_000 + (req.questionCount ?? 15) * 500),
    );

    const now = new Date();

    // 持久化作业到 DB
    await db.insert(outlineJobs).values({
      jobId,
      status: "pending",
      progress: 0,
      estimatedTotalMs,
      startedAt: now,
    });

    // 异步执行生成（不阻塞响应）
    executeOutlineGeneration(jobId, req).catch((e) => {
      console.error("大纲生成失败:", e);
      db.update(outlineJobs)
        .set({
          status: "failed",
          error: String(e).slice(0, 500),
          completedAt: new Date(),
        })
        .where(eq(outlineJobs.jobId, jobId))
        .execute()
        .catch(() => {});
    });

    return c.json({ jobId, estimatedTotalMs });
  },
);

// ---- 查询生成状态 ----

// GET /api/interview/outline/generate/status/:jobId
interviewOutlineRoute.get("/generate/status/:jobId", async (c) => {
  const { jobId } = c.req.param();
  const rows = await db
    .select()
    .from(outlineJobs)
    .where(eq(outlineJobs.jobId, jobId))
    .limit(1);

  const job = rows[0];
  if (!job) return c.json({ error: "作业不存在" }, 404);

  const status: OutlineJobStatus = {
    jobId: job.jobId,
    status: job.status as OutlineJobStatus["status"],
    progress: job.progress ?? 0,
    estimatedTotalMs: job.estimatedTotalMs ?? 30000,
    estimatedRemainingMs: job.estimatedRemainingMs ?? undefined,
    startedAt: job.startedAt?.toISOString() ?? new Date().toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
    result: null,
    error: job.error ?? null,
  };

  // 如果作业已完成，尝试加载结果大纲
  if (job.status === "completed" && job.resultOutlineId) {
    const outlineRows = await db
      .select()
      .from(interviewOutlines)
      .where(eq(interviewOutlines.id, job.resultOutlineId))
      .limit(1);
    if (outlineRows[0]) {
      status.result = {
        id: outlineRows[0].id,
        theme: outlineRows[0].theme,
        targetPersona: outlineRows[0].targetPersona ?? undefined,
        description: outlineRows[0].description ?? "",
        sections: outlineRows[0].sections as InterviewOutline["sections"],
        totalDurationMinutes: outlineRows[0].totalDurationMinutes ?? 0,
        createdAt: outlineRows[0].createdAt.toISOString(),
      };
    }
  }

  // 进行中的作业：计算进度
  if (!job.completedAt && job.status !== "failed") {
    const elapsed = Date.now() - (job.startedAt?.getTime() ?? Date.now());

    // 固定时间校准：每隔 15 秒延长一次预估，防止进度卡死
    const lastCalibration = outlineCalibrationStore.get(jobId) ?? 0;
    if (elapsed - lastCalibration >= OUTLINE_CALIBRATION_INTERVAL) {
      outlineCalibrationStore.set(jobId, elapsed);
      const currentEstimate = job.estimatedTotalMs ?? 30000;
      if (elapsed > currentEstimate * 0.7) {
        const newEstimate = Math.round(elapsed * 1.2);
        status.estimatedTotalMs = newEstimate;
        // 异步更新 DB
        db.update(outlineJobs)
          .set({ estimatedTotalMs: newEstimate })
          .where(eq(outlineJobs.jobId, jobId))
          .execute()
          .catch(() => {});
      }
    }

    // 时间驱动进度（单调，不回退）
    const rawProgress = Math.round((elapsed / status.estimatedTotalMs) * 100);
    status.progress = Math.max(job.progress ?? 0, Math.min(99, rawProgress));
    status.estimatedRemainingMs = Math.max(0, status.estimatedTotalMs - elapsed);

    // 异步更新 DB 进度
    db.update(outlineJobs)
      .set({
        progress: status.progress,
        estimatedRemainingMs: status.estimatedRemainingMs,
      })
      .where(eq(outlineJobs.jobId, jobId))
      .execute()
      .catch(() => {});
  }

  return c.json(status);
});

// ---- 取消大纲生成作业 ----

// POST /api/interview/outline/cancel/:jobId
interviewOutlineRoute.post("/cancel/:jobId", async (c) => {
  const { jobId } = c.req.param();

  // 标记作业为已取消，后续清理由 executeOutlineGeneration 中的检查完成
  await db
    .update(outlineJobs)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(eq(outlineJobs.jobId, jobId))
    .execute();

  return c.json({ success: true, message: "大纲生成已取消" });
});

// ---- 大纲生成执行逻辑 ----

async function executeOutlineGeneration(
  jobId: string,
  req: { theme: string; targetPersonaIds?: number[]; targetPersonaNames?: string[]; focusAreas?: string[]; additionalContext?: string; questionCount?: number },
) {
  const updateJob = async (patch: Record<string, unknown>) => {
    await db.update(outlineJobs)
      .set(patch as any)
      .where(eq(outlineJobs.jobId, jobId))
      .execute();
  };

  // 检查是否已被取消
  const checkCancelled = async (): Promise<boolean> => {
    try {
      const rows = await db
        .select({ status: outlineJobs.status })
        .from(outlineJobs)
        .where(eq(outlineJobs.jobId, jobId))
        .limit(1);
      return rows[0]?.status === "cancelled";
    } catch {
      return false;
    }
  };

  await updateJob({ status: "running" as any });

  // 获取目标画像信息
  let personaContext = "";
  if (req.targetPersonaIds && req.targetPersonaIds.length > 0) {
    const personaRows = await db
      .select({ id: personas.id, name: personas.name, description: personas.description })
      .from(personas)
      .where(inArray(personas.id, req.targetPersonaIds));

    if (personaRows.length > 0) {
      personaContext = personaRows
        .map((p) => `- ${p.name}: ${p.description ?? "暂无描述"}`)
        .join("\n");
    }
  }

  if (req.targetPersonaNames && req.targetPersonaNames.length > 0) {
    personaContext +=
      "\n" + req.targetPersonaNames.map((n) => `- ${n}`).join("\n");
  }

    // 构建生成 Prompt
  const systemPrompt = [
    "你是一位资深用户研究专家，擅长设计深度访谈提纲。",
    "请根据给定的访谈主题和目标用户画像，生成一份结构化的访谈大纲。",
    "",
    "## 要求",
    "1. 大纲应包含 3-5 个章节，每个章节有明确的目的",
    "2. 每个章节包含 3-6 个具体问题",
    "3. 问题应遵循「漏斗原则」：从宽泛到具体、从行为到动机",
    "4. 每个问题标注其目的和预期洞察",
    "5. 包含追问提示（follow-up questions）",
    "6. 总时长控制在 30-60 分钟",
    "",
    "## 输出格式",
    "以 JSON 格式输出，结构如下：",
    '{',
    '  "sections": [',
    '    {',
    '      "title": "章节标题",',
    '      "purpose": "本章节目的",',
    '      "durationMinutes": 10,',
    '      "questions": [',
    '        {',
    '          "id": "q1",',
    '          "question": "问题内容",',
    '          "category": "问题类别（行为/态度/动机/场景/评价）",',
    '          "purpose": "此问题的目的",',
    '          "expectedInsight": "预期获得的洞察",',
    '          "followUps": ["追问1", "追问2"]',
    '        }',
    '      ]',
    '    }',
    '  ]',
    '}',
    "",
    "只输出 JSON，不要其他内容。",
  ].join("\n");

  const userPrompt = [
    `## 访谈主题：${req.theme}`,
    req.focusAreas?.length
      ? `## 重点关注领域：${req.focusAreas.join("、")}`
      : "",
    personaContext ? `## 目标用户画像：\n${personaContext}` : "",
    req.additionalContext ? `## 补充信息：${req.additionalContext}` : "",
    `## 问题数量：约 ${req.questionCount ?? 15} 个问题`,
  ]
    .filter(Boolean)
    .join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  let outlineData: { sections: InterviewOutline["sections"] };
  try {
    // 调用 LLM 前检查是否已取消
    if (await checkCancelled()) {
      console.log(`大纲生成作业 ${jobId} 已被取消，停止执行`);
      return;
    }

    const response = await chat(messages, {
      temperature: 0.7,
      maxTokens: 4096,
    });
    // 提取 JSON
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("无法解析大纲 JSON");
    outlineData = JSON.parse(jsonMatch[0]) as {
      sections: InterviewOutline["sections"];
    };
  } catch (e) {
    await updateJob({
      status: "failed",
      error: `大纲生成失败: ${String(e)}`,
      completedAt: new Date(),
    });
    return;
  }

  // ---- 数据清洗：确保 LLM 返回的 JSON 符合 Zod schema ----
  let qIdx = 0;
  for (const section of outlineData.sections) {
    const parsedDuration = Number(section.durationMinutes);
    section.durationMinutes = Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 10;
    section.title = String(section.title ?? "");
    section.purpose = String(section.purpose ?? "");

    for (const q of section.questions) {
      if (!q.id) {
        q.id = `q${++qIdx}`;
      } else {
        qIdx++;
      }
      q.question = String(q.question ?? "");
      q.category = String(q.category ?? "行为");
      q.purpose = String(q.purpose ?? "");
      q.expectedInsight = String(q.expectedInsight ?? "");
      if (q.followUps != null) {
        q.followUps = q.followUps.filter(
          (f: unknown) => f != null && String(f).trim() !== "",
        );
        if (q.followUps.length === 0) {
          delete q.followUps;
        }
      } else if (q.followUps === null) {
        delete q.followUps;
      }
    }
  }

  const totalDuration = outlineData.sections.reduce(
    (sum, s) => sum + s.durationMinutes,
    0,
  );

  const outlineId = `outline-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date();

  const outline: InterviewOutline = {
    id: outlineId,
    theme: req.theme,
    targetPersona: req.targetPersonaNames?.join("、") ?? "通用",
    description: `针对「${req.theme}」的访谈大纲，共 ${outlineData.sections.length} 个章节`,
    sections: outlineData.sections,
    totalDurationMinutes: totalDuration,
    createdAt: now.toISOString(),
  };

  // 持久化大纲到 DB
  await db.insert(interviewOutlines).values({
    id: outline.id,
    theme: outline.theme,
    targetPersona: outline.targetPersona,
    description: outline.description,
    sections: outline.sections,
    totalDurationMinutes: outline.totalDurationMinutes,
    createdAt: now,
  });

  // 更新作业状态
  await updateJob({
    status: "completed",
    progress: 100,
    completedAt: now,
    resultOutlineId: outline.id,
  });
}

// ---- 获取大纲 ----

// GET /api/interview/outline/:id
interviewOutlineRoute.get("/:id", async (c) => {
  const { id } = c.req.param();
  const rows = await db
    .select()
    .from(interviewOutlines)
    .where(eq(interviewOutlines.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) return c.json({ error: "大纲不存在" }, 404);

  return c.json({
    id: row.id,
    theme: row.theme,
    targetPersona: row.targetPersona ?? undefined,
    description: row.description ?? "",
    sections: row.sections as InterviewOutline["sections"],
    totalDurationMinutes: row.totalDurationMinutes ?? 0,
    createdAt: row.createdAt.toISOString(),
  } satisfies InterviewOutline);
});

// ---- 列出所有大纲 ----

// GET /api/interview/outline
interviewOutlineRoute.get("/", async (c) => {
  const rows = await db
    .select()
    .from(interviewOutlines)
    .orderBy(desc(interviewOutlines.createdAt));

  return c.json(
    rows.map((row) => ({
      id: row.id,
      theme: row.theme,
      targetPersona: row.targetPersona ?? undefined,
      description: row.description ?? "",
      sections: row.sections as InterviewOutline["sections"],
      totalDurationMinutes: row.totalDurationMinutes ?? 0,
      createdAt: row.createdAt.toISOString(),
    } satisfies InterviewOutline)),
  );
});

// ---- 优化单个问题 ----

// POST /api/interview/outline/refine-question
interviewOutlineRoute.post("/refine-question", async (c) => {
  const body = await c.req.json<{
    question: string;
    theme: string;
    personaContext?: string;
  }>();

  const systemPrompt = [
    "你是一位资深用户研究专家。请优化以下访谈问题，使其更加精准、有效。",
    "",
    "## 优化原则",
    "1. 避免引导性问题（leading questions）",
    "2. 避免二元问题（是/否），鼓励开放描述",
    "3. 使用被访者的语言，避免专业术语",
    "4. 一次只问一件事",
    "5. 从具体行为切入，逐步过渡到态度和动机",
    "",
    "以 JSON 格式输出：",
    '{',
    '  "original": "原始问题",',
    '  "refined": "优化后的问题",',
    '  "rationale": "优化理由",',
    '  "suggestedFollowUps": ["建议追问1", "建议追问2"]',
    '}',
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `主题：${body.theme}\n${body.personaContext ? `目标画像：${body.personaContext}\n` : ""}原始问题：${body.question}`,
    },
  ];

  try {
    const response = await chat(messages, { temperature: 0.5 });
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("无法解析响应");
    return c.json(JSON.parse(jsonMatch[0]));
  } catch (e) {
    return c.json({ error: "问题优化失败", detail: String(e) }, 500);
  }
});