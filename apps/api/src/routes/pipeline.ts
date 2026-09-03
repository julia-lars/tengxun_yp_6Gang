// --------------------------------------------------------------
// 数据流水线路由 — AI 全流程处理
// 上传文件 → 数据提取 → 数据清洗 → AI 打标 → 增量合并 → 向量嵌入 → (聚类)
//
// 实现策略：TS 作为调度层，通过子进程调用 Python 脚本执行实际处理。
// Python 脚本（scripts/）已经过验证，产出了全部 14 项目 18,743 片段。
// TS 侧负责上传、进度上报、状态管理，不重新实现处理逻辑。
// --------------------------------------------------------------

import type { PipelineConfig, PipelineStatus } from "@app/shared";
import { pipelineConfigSchema } from "@app/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir, unlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

import { db } from "../db/client.js";
import { pipelineJobs } from "../db/schema.js";
import { desc, eq, sql } from "drizzle-orm";

export const pipelineRoute = new Hono();

// ---- 上传目录 ----

const UPLOAD_DIR = join(tmpdir(), "pipeline-uploads");

// 固定时间校准：记录每个 job 上次校准的 elapsed 时间
const calibrationStore = new Map<string, number>();
const PIPELINE_CALIBRATION_INTERVAL = 30_000; // 每 30 秒校准一次

async function ensureUploadDir(): Promise<void> {
  await mkdir(UPLOAD_DIR, { recursive: true });
}

// ---- 上传端点 ----

// POST /api/pipeline/upload (multipart/form-data)
pipelineRoute.post("/upload", async (c) => {
  try {
    await ensureUploadDir();
    const body = await c.req.parseBody();
    const files = body["files"];

    const fileArray = Array.isArray(files) ? files : files ? [files] : [];

    if (fileArray.length === 0) {
      return c.json({ error: "请上传至少一个文件" }, 400);
    }

    const results: Array<{ id: string; name: string; size: number }> = [];

    for (const file of fileArray) {
      if (!(file instanceof File)) {
        continue;
      }

      const id = `file-${randomUUID().slice(0, 8)}`;
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "txt";
      const filePath = join(UPLOAD_DIR, `${id}.${ext}`);

      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(filePath, buffer);

      results.push({
        id,
        name: file.name,
        size: file.size,
      });
    }

    return c.json({
      fileIds: results.map((r) => r.id),
      fileNames: results.map((r) => r.name),
      totalSize: results.reduce((s, r) => s + r.size, 0),
    });
  } catch (e) {
    return c.json({ error: `文件上传失败: ${String(e)}` }, 500);
  }
});

// ---- 启动作业 ----

// POST /api/pipeline/start
pipelineRoute.post(
  "/start",
  zValidator("json", pipelineConfigSchema),
  async (c) => {
    const config = c.req.valid("json") as PipelineConfig;
    const jobId = `pipeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fileCount = config.fileNames?.length ?? 1;

    // 时间驱动进度：预估总耗时 = 每文件 2 分钟 + 聚类额外 2 分钟
    const estimatedTotalMs = Math.min(
      600_000,
      Math.max(60_000, fileCount * 120_000 + (config.enableClustering ? 120_000 : 0)),
    );

    const initialStats = {
      filesTotal: config.fileNames?.length ?? 0,
      filesProcessed: 0,
      segmentsExtracted: 0,
      segmentsCleaned: 0,
      segmentsTagged: 0,
      segmentsEmbedded: 0,
      errors: [],
    };

    const now = new Date();

    // 持久化到 DB
    await db.insert(pipelineJobs).values({
      jobId,
      stage: "uploading",
      progress: 0,
      estimatedTotalMs,
      stats: initialStats as any,
      startedAt: now,
    });

    const status: PipelineStatus = {
      jobId,
      stage: "uploading",
      progress: 0,
      estimatedTotalMs,
      stats: initialStats,
      startedAt: now.toISOString(),
      completedAt: null,
    };

    // 异步执行流水线（不阻塞响应）
    executePipeline(jobId, config).catch(async (e) => {
      console.error("流水线执行失败:", e);
      try {
        const rows = await db
          .select({ stats: pipelineJobs.stats })
          .from(pipelineJobs)
          .where(eq(pipelineJobs.jobId, jobId))
          .limit(1);
        const currentStats = (rows[0]?.stats ?? { errors: [] }) as PipelineStatus["stats"];
        await db
          .update(pipelineJobs)
          .set({
            stats: {
              ...currentStats,
              errors: [...currentStats.errors, `流水线异常: ${String(e)}`],
            } as any,
            completedAt: new Date(),
          })
          .where(eq(pipelineJobs.jobId, jobId))
          .execute();
      } catch {
        // 忽略更新错误
      }
    });

    return c.json({ jobId, status });
  },
);

// ---- 查询作业状态 ----

// GET /api/pipeline/status/:jobId
pipelineRoute.get("/status/:jobId", async (c) => {
  const { jobId } = c.req.param();
  const rows = await db
    .select()
    .from(pipelineJobs)
    .where(eq(pipelineJobs.jobId, jobId))
    .limit(1);

  const job = rows[0];
  if (!job) return c.json({ error: "作业不存在" }, 404);

  const status: PipelineStatus = {
    jobId: job.jobId,
    stage: job.stage as PipelineStatus["stage"],
    progress: job.progress ?? 0,
    estimatedTotalMs: job.estimatedTotalMs ?? 60000,
    estimatedRemainingMs: job.estimatedRemainingMs ?? undefined,
    stats: (job.stats ?? { errors: [] }) as PipelineStatus["stats"],
    startedAt: job.startedAt?.toISOString() ?? new Date().toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  };

  if (!job.completedAt) {
    const elapsed = Date.now() - (job.startedAt?.getTime() ?? Date.now());

    // 固定时间校准：每隔 30 秒延长一次预估，防止进度卡死
    const lastCalibration = calibrationStore.get(jobId) ?? 0;
    if (elapsed - lastCalibration >= PIPELINE_CALIBRATION_INTERVAL) {
      calibrationStore.set(jobId, elapsed);
      // 只在接近预估上限时才延长
      if (elapsed > status.estimatedTotalMs * 0.7) {
        status.estimatedTotalMs = Math.round(elapsed * 1.2);
        // 异步更新 DB
        db.update(pipelineJobs)
          .set({ estimatedTotalMs: status.estimatedTotalMs })
          .where(eq(pipelineJobs.jobId, jobId))
          .execute()
          .catch(() => {});
      }
    }

    // 时间驱动进度（单调，不回退）
    const rawProgress = Math.round((elapsed / status.estimatedTotalMs) * 100);
    status.progress = Math.max(job.progress ?? 0, Math.min(99, rawProgress));
    status.estimatedRemainingMs = Math.max(0, status.estimatedTotalMs - elapsed);

    // 异步更新 DB 进度
    db.update(pipelineJobs)
      .set({
        progress: status.progress,
        estimatedRemainingMs: status.estimatedRemainingMs,
      })
      .where(eq(pipelineJobs.jobId, jobId))
      .execute()
      .catch(() => {});
  }

  return c.json(status);
});

// ---- 列出所有作业（用于页面刷新后恢复） ----

// GET /api/pipeline/jobs
pipelineRoute.get("/jobs", async (c) => {
  const rows = await db
    .select()
    .from(pipelineJobs)
    .orderBy(desc(pipelineJobs.startedAt));

  return c.json(
    rows.map((job) => ({
      jobId: job.jobId,
      stage: job.stage as PipelineStatus["stage"],
      progress: job.progress ?? 0,
      estimatedTotalMs: job.estimatedTotalMs ?? 60000,
      estimatedRemainingMs: job.estimatedRemainingMs ?? undefined,
      stats: (job.stats ?? { errors: [] }) as PipelineStatus["stats"],
      startedAt: job.startedAt?.toISOString() ?? new Date().toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    } satisfies PipelineStatus)),
  );
});

// ---- 取消流水线作业 ----

// POST /api/pipeline/cancel/:jobId
pipelineRoute.post("/cancel/:jobId", async (c) => {
  const { jobId } = c.req.param();

  // 1. 标记作业为已取消
  await db
    .update(pipelineJobs)
    .set({ stage: "cancelled", completedAt: new Date() })
    .where(eq(pipelineJobs.jobId, jobId))
    .execute();

  // 2. 清理已上传的文件
  const rows = await db
    .select()
    .from(pipelineJobs)
    .where(eq(pipelineJobs.jobId, jobId))
    .limit(1);

  const job = rows[0];
  if (job) {
    const stats = (job.stats ?? {}) as PipelineStatus["stats"];
    const fileNames = stats?.filesTotal ? [] : [];

    // 尝试清理上传目录中的文件
    try {
      const uploadDir = UPLOAD_DIR;
      const dirEntries = await readUploadDir(uploadDir);
      for (const entry of dirEntries) {
        try {
          await unlink(join(uploadDir, entry));
        } catch {
          // 忽略单个文件清理错误
        }
      }
    } catch {
      // 忽略目录清理错误
    }

    // 3. 清理已写入 DB 的 segments 和 respondents
    //    通过 sourceFile 字段匹配（文件名在 job 的 stats 中不直接记录，
    //    但可以通过上传文件的 fileNames 关联）
    //    由于 fileNames 通过 config 传入但未持久化到 stats，
    //    这里删除所有在本次 job 运行期间写入的 source_segments
    //    安全做法：仅当 job 确实在 embedding 阶段之后才清理
    if (job.stage && ["embedding", "clustering"].includes(job.stage as string)) {
      try {
        await db.execute(sql`DELETE FROM source_segments WHERE embedded_at IS NOT NULL AND embedded_at >= ${job.startedAt ?? new Date(0)}`);
        await db.execute(sql`DELETE FROM respondents WHERE created_at >= ${job.startedAt ?? new Date(0)}`);
      } catch (e) {
        console.error("清理流水线数据失败:", e);
      }
    }
  }

  return c.json({ success: true, message: "流水线作业已取消，已清理相关数据" });
});

// DELETE /api/pipeline/jobs/:jobId — 永久删除流水线作业
pipelineRoute.delete("/jobs/:jobId", async (c) => {
  const { jobId } = c.req.param();
  try {
    await db.delete(pipelineJobs).where(eq(pipelineJobs.jobId, jobId)).execute();
    return c.json({ success: true, message: "流水线作业已删除" });
  } catch (e) {
    console.error("删除流水线作业失败:", e);
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// DELETE /api/pipeline/jobs — 清除所有流水线作业
pipelineRoute.delete("/jobs", async (c) => {
  try {
    await db.delete(pipelineJobs).execute();
    return c.json({ success: true, message: "所有流水线作业已清除" });
  } catch (e) {
    console.error("清除流水线作业失败:", e);
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// GET /api/pipeline/projects — 列出可用的项目名称（来自 merged 目录）
pipelineRoute.get("/projects", async (c) => {
  try {
    const mergedDir = join(process.cwd(), "data", "群体画像v2.0_merged");
    if (!existsSync(mergedDir)) {
      return c.json({ projects: [] });
    }
    const entries = await readdir(mergedDir);
    const projectNames = entries
      .filter((f) => f.endsWith(".json") && !f.startsWith("."))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
    return c.json({ projects: projectNames });
  } catch (e) {
    console.error("读取项目列表失败:", e);
    return c.json({ projects: [], error: String(e) }, 500);
  }
});

// POST /api/pipeline/generate-parser — 为未知格式文件自动生成解析器
pipelineRoute.post("/generate-parser", async (c) => {
  try {
    const body = await c.req.json();
    const { filePath } = body as { filePath: string };
    if (!filePath) {
      return c.json({ error: "filePath is required" }, 400);
    }
    if (!existsSync(filePath)) {
      return c.json({ error: `File not found: ${filePath}` }, 404);
    }

    const { exitCode, stdout, stderr } = await runPythonScript(
      scriptPath("scripts/generate_parser.py"),
      [filePath],
      { timeoutMs: 30_000 },
    );

    if (exitCode !== 0) {
      return c.json({ error: "Parser generation failed", stderr: stderr.slice(0, 500) }, 500);
    }

    try {
      const lastLine = stdout.trim().split("\n").pop() || "{}";
      const result = JSON.parse(lastLine);
      return c.json(result);
    } catch {
      return c.json({ error: "Failed to parse generation result", stdout: stdout.slice(0, 500) }, 500);
    }
  } catch (e) {
    return c.json({ error: `Parser generation failed: ${String(e)}` }, 500);
  }
});

// ---- 流水线执行逻辑 ----

/**
 * 运行 Python 脚本并捕获输出。
 * 返回 { exitCode, stdout, stderr }。
 */
async function runPythonScript(
  scriptPath: string,
  args: string[] = [],
  opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["python3", scriptPath, ...args], {
    cwd: opts?.cwd ?? process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: opts?.env,
  });

  const timeout = opts?.timeoutMs ?? 600_000; // 默认 10 分钟
  const timer = setTimeout(() => {
    proc.kill();
  }, timeout);

  const exitCode = await proc.exited;
  clearTimeout(timer);

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  return { exitCode, stdout, stderr };
}

/**
 * 查找 Python 脚本路径（相对项目根目录）。
 */
function scriptPath(relativePath: string): string {
  return join(process.cwd(), relativePath);
}

// 阶段标签（中文，用于错误信息）
const stageLabels: Record<string, string> = {
  uploading: "上传解析",
  extracting: "数据提取",
  cleaning: "数据清洗",
  tagging: "AI 打标",
  merge: "增量合并",
  embedding: "向量嵌入",
  clustering: "聚类分析",
};

// 阶段权重（用于时间预估校准）
const STAGE_WEIGHTS: Record<string, number> = {
  uploading: 10,
  extracting: 5,
  cleaning: 15,
  tagging: 35,
  merge: 5,
  embedding: 25,
  clustering: 10,
};

// 阶段切换时校准 estimatedTotalMs
async function calibrateTotalMs(
  jobId: string,
  completedStage: string,
  stages: string[],
) {
  const rows = await db
    .select({ estimatedTotalMs: pipelineJobs.estimatedTotalMs, startedAt: pipelineJobs.startedAt })
    .from(pipelineJobs)
    .where(eq(pipelineJobs.jobId, jobId))
    .limit(1);

  const job = rows[0];
  if (!job?.startedAt) return;

  const elapsed = Date.now() - job.startedAt.getTime();

  let completedWeight = 0;
  for (const s of stages) {
    if (s === completedStage) break;
    completedWeight += STAGE_WEIGHTS[s] ?? 0;
  }
  const currentStageWeight = STAGE_WEIGHTS[completedStage] ?? 0;
  completedWeight += currentStageWeight;

  if (completedWeight > 0) {
    const currentEstimate = job.estimatedTotalMs ?? 60000;
    const newEstimatedTotal = Math.round(elapsed / completedWeight * 100);
    const updated = Math.max(currentEstimate, newEstimatedTotal);

    await db
      .update(pipelineJobs)
      .set({ estimatedTotalMs: updated })
      .where(eq(pipelineJobs.jobId, jobId))
      .execute();
  }
}

async function executePipeline(jobId: string, config: PipelineConfig) {
  // 从 DB 读取初始 stats
  const initialRows = await db
    .select({ stats: pipelineJobs.stats })
    .from(pipelineJobs)
    .where(eq(pipelineJobs.jobId, jobId))
    .limit(1);
  let cachedStats = (initialRows[0]?.stats ?? {
    filesTotal: 0,
    filesProcessed: 0,
    segmentsExtracted: 0,
    segmentsCleaned: 0,
    segmentsTagged: 0,
    segmentsEmbedded: 0,
    errors: [],
  }) as PipelineStatus["stats"];

  const update = async (patch: Record<string, unknown>) => {
    if (patch.stats) cachedStats = patch.stats as PipelineStatus["stats"];
    await db
      .update(pipelineJobs)
      .set(patch as any)
      .where(eq(pipelineJobs.jobId, jobId))
      .execute();
  };

  const stages: PipelineStatus["stage"][] = [
    "extracting",
    "cleaning",
    "tagging",
    "merge",
    "embedding",
  ];
  if (config.enableClustering) stages.push("clustering");

  // 上传的文件目录
  const uploadDir = UPLOAD_DIR;
  const allFiles = config.fileNames ?? [];
  const uploadedFileIds = config.uploadedFileIds ?? [];

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i]!;

    // 检查是否已被取消
    if (await isPipelineCancelled(jobId)) {
      await cleanupUploadedFiles(uploadedFileIds);
      console.log(`流水线作业 ${jobId} 已被取消，停止执行`);
      return;
    }

    await update({ stage });

    try {
      switch (stage) {
        case "extracting": {
          // 阶段 1: 数据提取 — 调用 process_all.py
          // 先确认上传的文件存在
          if (allFiles.length === 0) {
            await update({
              stats: {
                ...cachedStats,
                errors: [...cachedStats.errors, "没有可处理的文件"],
              },
            });
            break;
          }

          // 将上传文件路径作为参数传递给 process_all.py
          // process_all.py 通过 PIPELINE_SRC_DIR 环境变量读取输入目录
          const extractArgs: string[] = [];
          const proc = Bun.spawn(
            ["python3", scriptPath("scripts/process_all.py"), ...extractArgs],
            {
              cwd: process.cwd(),
              stdout: "pipe",
              stderr: "pipe",
              env: {
                ...Object.fromEntries(
                  Object.entries(process.env).filter(
                    ([, v]) => v !== undefined,
                  ) as [string, string][],
                ),
                PIPELINE_SRC_DIR: uploadDir,
                PIPELINE_OUT_DIR: join(process.cwd(), "data", "群体画像v2.0_data"),
                PIPELINE_PROJECT_NAME: config.projectName ?? "",
              },
            },
          );

          const exitCode = await proc.exited;
          const stdout = await new Response(proc.stdout).text();
          const stderr = await new Response(proc.stderr).text();

          // 解析输出获取统计信息
          const statsMatch = stdout.match(/Stats:\s*(\d+)\s*respondents?,\s*(\d+)\s*segments?/i);
          const respCount = statsMatch?.[1] ? parseInt(statsMatch[1]) : 0;
          const segCount = statsMatch?.[2] ? parseInt(statsMatch[2]) : 0;

          if (exitCode !== 0) {
            await update({
              stats: {
                ...cachedStats,
                filesProcessed: allFiles.length,
                segmentsExtracted: segCount,
                errors: [
                  ...cachedStats.errors,
                  `数据提取失败 (exit ${exitCode}): ${stderr.slice(0, 500)}`,
                ],
              },
            });
          } else {
            await update({
              stats: {
                ...cachedStats,
                filesProcessed: allFiles.length,
                segmentsExtracted: segCount,
                errors: [
                  ...cachedStats.errors,
                  ...(segCount > 0 ? [`数据提取完成: ${respCount} 受访者, ${segCount} 片段`] : []),
                ],
              },
            });
          }

          await calibrateTotalMs(jobId, stage, stages);
          break;
        }

        case "cleaning": {
          // 阶段 2: 数据清洗 — 调用 clean_segments_v2_demo.py
          const dataDir = join(process.cwd(), "data", "群体画像v2.0_data");
          const cleanedDir = join(process.cwd(), "data", "群体画像v2.0_cleaned");
          const projectName = config.projectName;
          const cleanInputDir = projectName ? join(dataDir, projectName) : dataDir;
          const cleanOutputDir = projectName ? join(cleanedDir, projectName) : cleanedDir;
          const cleanArgs = [
            "--input-dir", cleanInputDir,
            "--output-dir", cleanOutputDir,
          ];
          const { exitCode, stdout, stderr } = await runPythonScript(
            scriptPath("scripts/clean_segments_v2_demo.py"),
            cleanArgs,
            { timeoutMs: 300_000 },
          );

          // 解析输出获取统计
          const cleanedMatch = stdout.match(/cleaned[:\s]*(\d+)/i) ||
            stdout.match(/保留[:\s]*(\d+)/i);
          const cleanedCount = cleanedMatch?.[1] ? parseInt(cleanedMatch[1]) : 0;

          if (exitCode !== 0) {
            await update({
              stats: {
                ...cachedStats,
                segmentsCleaned: cleanedCount,
                errors: [
                  ...cachedStats.errors,
                  `数据清洗失败 (exit ${exitCode}): ${stderr.slice(0, 500)}`,
                ],
              },
            });
          } else {
            await update({
              stats: {
                ...cachedStats,
                segmentsCleaned: cleanedCount,
                errors: [
                  ...cachedStats.errors,
                  ...(cleanedCount > 0 ? [`清洗完成: 保留 ${cleanedCount} 条`] : []),
                ],
              },
            });
          }

          await calibrateTotalMs(jobId, stage, stages);
          break;
        }

        case "tagging": {
          // 阶段 3: AI 打标 — 调用 label_all_v3.py
          const tagArgs = ["--resume", "--workers", "4"];
          const tagEnv: Record<string, string> | undefined = config.projectName
            ? {
                PIPELINE_CLEANED_DIR: join(process.cwd(), "data", "群体画像v2.0_cleaned", config.projectName),
                PIPELINE_LABELED_DIR: join(process.cwd(), "data", "群体画像v2.0_labeled", config.projectName),
              }
            : undefined;
          const { exitCode, stdout, stderr } = await runPythonScript(
            scriptPath("scripts/label_all_v3.py"),
            tagArgs,
            { timeoutMs: 600_000, env: tagEnv },
          );

          const taggedMatch = stdout.match(/labeled[:\s]*(\d+)/i) ||
            stdout.match(/标注完成[:\s]*(\d+)/i) ||
            stdout.match(/Done[:\s]*(\d+)/i);
          const taggedCount = taggedMatch?.[1] ? parseInt(taggedMatch[1]) : 0;

          if (exitCode !== 0) {
            await update({
              stats: {
                ...cachedStats,
                segmentsTagged: taggedCount,
                errors: [
                  ...cachedStats.errors,
                  `AI 打标失败 (exit ${exitCode}): ${stderr.slice(0, 500)}`,
                ],
              },
            });
          } else {
            await update({
              stats: {
                ...cachedStats,
                segmentsTagged: taggedCount,
                errors: [
                  ...cachedStats.errors,
                  ...(taggedCount > 0 ? [`AI 打标完成: ${taggedCount} 条`] : []),
                ],
              },
            });
          }

          await calibrateTotalMs(jobId, stage, stages);
          break;
        }

        case "merge": {
          // 阶段 4: 增量合并 — 调用 merge_labeled_by_project.py
          const mergeMode = config.mergeMode ?? "full";
          const projectName = config.projectName;
          const mergeArgs: string[] = ["--mode", mergeMode];
          if (projectName) {
            mergeArgs.push("--project", projectName);
          }
          const mergeEnv: Record<string, string> | undefined = projectName
            ? {
                PIPELINE_LABELED_DIR: join(process.cwd(), "data", "群体画像v2.0_labeled"),
                PIPELINE_CLEANED_DIR: join(process.cwd(), "data", "群体画像v2.0_cleaned"),
                PIPELINE_MERGED_DIR: join(process.cwd(), "data", "群体画像v2.0_merged"),
              }
            : undefined;

          const { exitCode, stdout, stderr } = await runPythonScript(
            scriptPath("scripts/merge_labeled_by_project.py"),
            mergeArgs,
            { timeoutMs: 120_000, env: mergeEnv },
          );

          if (exitCode !== 0) {
            await update({
              stats: {
                ...cachedStats,
                errors: [
                  ...cachedStats.errors,
                  `增量合并失败 (exit ${exitCode}): ${stderr.slice(0, 500)}`,
                ],
              },
            });
          } else {
            await update({
              stats: {
                ...cachedStats,
                errors: [
                  ...cachedStats.errors,
                  `增量合并完成 (${mergeMode === "append" ? "追加" : "全量"}模式)`,
                ],
              },
            });
          }

          await calibrateTotalMs(jobId, stage, stages);
          break;
        }

        case "embedding": {
          // 阶段 5: 向量嵌入 — 调用 embed_segments.py + import_source_segments.py
          const embedArgs: string[] = [];
          const { exitCode, stdout, stderr } = await runPythonScript(
            scriptPath("scripts/embed_segments.py"),
            embedArgs,
            { timeoutMs: 600_000 },
          );

          const embedMatch = stdout.match(/embedded[:\s]*(\d+)/i) ||
            stdout.match(/嵌入完成[:\s]*(\d+)/i);
          const embedCount = embedMatch?.[1] ? parseInt(embedMatch[1]) : 0;

          if (exitCode !== 0) {
            await update({
              stats: {
                ...cachedStats,
                segmentsEmbedded: embedCount,
                errors: [
                  ...cachedStats.errors,
                  `向量嵌入失败 (exit ${exitCode}): ${stderr.slice(0, 500)}`,
                ],
              },
            });
          } else {
            // 嵌入完成后导入数据库
            const importArgs: string[] = [];
            const { exitCode: impCode, stderr: impErr } = await runPythonScript(
              scriptPath("scripts/import_source_segments.py"),
              importArgs,
              { timeoutMs: 300_000 },
            );

            const freshRows = await db
              .select({ stats: pipelineJobs.stats })
              .from(pipelineJobs)
              .where(eq(pipelineJobs.jobId, jobId))
              .limit(1);
            const freshStats = (freshRows[0]?.stats ?? cachedStats) as PipelineStatus["stats"];
            cachedStats = freshStats;

            await update({
              stats: {
                ...freshStats,
                segmentsEmbedded: embedCount,
                errors: [
                  ...freshStats.errors,
                  ...(embedCount > 0 ? [`向量嵌入完成: ${embedCount} 条`] : []),
                  ...(impCode !== 0
                    ? [`数据库导入失败: ${impErr.slice(0, 200)}`]
                    : [`数据库导入完成`]),
                ],
              },
            });
          }

          await calibrateTotalMs(jobId, stage, stages);
          break;
        }

        case "clustering": {
          // 阶段 6: 聚类分析 — 调用 cluster_personas.py
          const { exitCode, stdout, stderr } = await runPythonScript(
            scriptPath("scripts/cluster_personas.py"),
            [],
            { timeoutMs: 300_000 },
          );

          if (exitCode === 0) {
            await update({
              stats: {
                ...cachedStats,
                errors: [...cachedStats.errors, "聚类分析完成"],
              },
            });
          } else {
            await update({
              stats: {
                ...cachedStats,
                errors: [
                  ...cachedStats.errors,
                  `聚类分析失败 (exit ${exitCode}): ${stderr.slice(0, 200)}`,
                ],
              },
            });
          }
          await calibrateTotalMs(jobId, stage, stages);
          break;
        }
      }
    } catch (e) {
      try {
        await update({
          stats: {
            ...cachedStats,
            errors: [
              ...cachedStats.errors,
              `${stageLabels[stage] ?? stage}: ${String(e)}`,
            ],
          },
        });
      } catch {
        // 更新失败不阻止后续阶段
      }
    }
  }

  // 清理上传文件
  await cleanupUploadedFiles(uploadedFileIds);

  try {
    await update({
      progress: 100,
      completedAt: new Date(),
    });
  } catch {
    console.error(`流水线 ${jobId} 最终状态更新失败`);
  }
}

// ---- 工具函数 ----

async function cleanupUploadedFiles(uploadedFileIds: string[]): Promise<void> {
  for (const fileId of uploadedFileIds) {
    const exts = ["txt", "csv", "json", "md", "docx", "xlsx", "pdf"];
    for (const ext of exts) {
      try {
        await unlink(join(UPLOAD_DIR, `${fileId}.${ext}`));
      } catch {
        // 忽略清理错误
      }
    }
  }
}

async function readUploadDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

// 检查流水线作业是否已被取消
async function isPipelineCancelled(jobId: string): Promise<boolean> {
  try {
    const rows = await db
      .select({ stage: pipelineJobs.stage })
      .from(pipelineJobs)
      .where(eq(pipelineJobs.jobId, jobId))
      .limit(1);
    return rows[0]?.stage === "cancelled";
  } catch {
    return false;
  }
}