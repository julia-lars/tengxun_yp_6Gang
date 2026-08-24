// --------------------------------------------------------------
// 数据流水线路由 — AI 全流程处理
// 上传文件 → 数据提取 → 数据清洗 → AI 打标 → 向量嵌入 → (聚类)
// --------------------------------------------------------------

import type { PipelineConfig, PipelineStatus } from "@app/shared";
import { pipelineConfigSchema } from "@app/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir, unlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { parseFile, type RawSegment } from "../lib/file-parser.js";
import {
  cleanSegments,
  getCleaningStats,
  type CleanedSegment,
} from "../lib/pipeline-cleaner.js";
import { tagSegments } from "../lib/pipeline-tagger.js";
import type { TaggedSegment } from "../lib/pipeline-tagger.js";
import {
  embedSegments,
  getEmbeddingStats,
} from "../lib/pipeline-embedder.js";
import { writeSegmentsToDb } from "../lib/pipeline-db.js";
import { db } from "../db/client.js";
import { pipelineJobs, sourceSegments, respondents } from "../db/schema.js";
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

// 阶段权重（用于阶段切换时动态校准 estimatedTotalMs）
const STAGE_WEIGHTS: Record<string, number> = {
  uploading: 10,
  extracting: 5,
  cleaning: 15,
  tagging: 35,
  embedding: 25,
  clustering: 10,
};

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

// ---- 流水线执行逻辑 ----

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

  // 计算已完成阶段的总权重
  let completedWeight = 0;
  for (const s of stages) {
    if (s === completedStage) break;
    completedWeight += STAGE_WEIGHTS[s] ?? 0;
  }

  // 加上当前阶段的权重（假设已完成）
  const currentStageWeight = STAGE_WEIGHTS[completedStage] ?? 0;
  completedWeight += currentStageWeight;

  if (completedWeight > 0) {
    // 基于实际耗时重新预估总时间
    const currentEstimate = job.estimatedTotalMs ?? 60000;
    const newEstimatedTotal = Math.round(elapsed / completedWeight * 100);
    // 只增不减
    const updated = Math.max(currentEstimate, newEstimatedTotal);

    await db
      .update(pipelineJobs)
      .set({ estimatedTotalMs: updated })
      .where(eq(pipelineJobs.jobId, jobId))
      .execute();
  }
}

async function executePipeline(jobId: string, config: PipelineConfig) {
  // 从 DB 读取初始 stats 作为缓存
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

  const stageLabels: Record<string, string> = {
    uploading: "上传解析",
    extracting: "数据提取",
    cleaning: "数据清洗",
    tagging: "AI 打标",
    embedding: "向量嵌入",
    clustering: "聚类分析",
  };

  const stages: PipelineStatus["stage"][] = [
    "uploading",
    "extracting",
    "cleaning",
    "tagging",
    "embedding",
  ];
  if (config.enableClustering) stages.push("clustering");

  // 流水线状态：在各个阶段之间传递
  let allSegments: RawSegment[] = [];
  let cleanedSegments: CleanedSegment[] | TaggedSegment[] = [];
  const allFiles = config.fileNames ?? [];

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i]!;

    // 每个阶段开始前检查是否已被取消
    if (await isPipelineCancelled(jobId)) {
      // 清理上传的文件
      if (config.uploadedFileIds) {
        for (const fileId of config.uploadedFileIds) {
          const exts = ["txt", "csv", "json", "md", "docx", "xlsx", "pdf"];
          for (const ext of exts) {
            try { await unlink(join(UPLOAD_DIR, `${fileId}.${ext}`)); } catch { /* 忽略 */ }
          }
        }
      }
      console.log(`流水线作业 ${jobId} 已被取消，停止执行`);
      return;
    }

    await update({ stage: stage as PipelineStatus["stage"] });

    try {
      switch (stage) {
        case "uploading": {
          // 阶段 1: 上传解析 — 读取上传的文件并提取文本
          let processed = 0;
          const stageErrors: string[] = [];

          const uploadedFileIds = config.uploadedFileIds ?? [];

          for (let fi = 0; fi < allFiles.length; fi++) {
            const fileName = allFiles[fi]!;
            try {
              const fileId = uploadedFileIds[fi];
              let buffer: Buffer | undefined;

              if (fileId) {
                const exts = ["txt", "csv", "json", "md", "docx", "xlsx", "pdf"];
                for (const ext of exts) {
                  const filePath = join(UPLOAD_DIR, `${fileId}.${ext}`);
                  try {
                    buffer = await readFileBuffer(filePath);
                    break;
                  } catch {
                    // 尝试下一个扩展名
                  }
                }
              }

              if (buffer) {
                const result = await parseFile(buffer, fileName);
                allSegments.push(...result.segments);
                processed++;
              } else {
                stageErrors.push(
                  `文件未找到: ${fileName}（请先通过 /api/pipeline/upload 上传）`,
                );
              }
            } catch (e) {
              stageErrors.push(`解析文件失败 ${fileName}: ${String(e)}`);
            }
          }

          await update({
            stats: {
              ...cachedStats,
              filesProcessed: processed,
              segmentsExtracted: allSegments.length,
              errors: [...cachedStats.errors, ...stageErrors],
            },
          });

          // 阶段完成后校准预估总时间
          await calibrateTotalMs(jobId, stage, stages);
          break;
        }

        case "extracting": {
          await update({
            stats: {
              ...cachedStats,
              segmentsExtracted: allSegments.length,
            },
          });
          await calibrateTotalMs(jobId, stage, stages);
          break;
        }

        case "cleaning": {
          const before = allSegments.length;

          cleanedSegments = cleanSegments(allSegments);
          const stats = getCleaningStats(before, cleanedSegments.length);

          await update({
            stats: {
              ...cachedStats,
              segmentsCleaned: cleanedSegments.length,
              errors: [
                ...cachedStats.errors,
                `清洗完成: 移除 ${stats.removed} 条 (${stats.removalRate}%)，保留 ${stats.kept} 条`,
              ],
            },
          });
          await calibrateTotalMs(jobId, stage, stages);
          break;
        }

        case "tagging": {
          if (cleanedSegments.length === 0) {
            await update({
              stats: {
                ...cachedStats,
                segmentsTagged: 0,
                errors: [...cachedStats.errors, "没有可标注的片段"],
              },
            });
            await calibrateTotalMs(jobId, stage, stages);
            break;
          }

          const tagged = await tagSegments(cleanedSegments);
          const taggedCount = tagged.filter((s) => s.annotation !== null).length;

          await update({
            stats: {
              ...cachedStats,
              segmentsTagged: taggedCount,
            },
          });

          cleanedSegments = tagged;
          await calibrateTotalMs(jobId, stage, stages);
          break;
        }

        case "embedding": {
          if (cleanedSegments.length === 0) {
            await update({
              stats: {
                ...cachedStats,
                segmentsEmbedded: 0,
                errors: [...cachedStats.errors, "没有可嵌入的片段"],
              },
            });
            await calibrateTotalMs(jobId, stage, stages);
            break;
          }

          const embedded = await embedSegments(cleanedSegments as TaggedSegment[]);
          const embedStats = getEmbeddingStats(embedded);

          let dbErrors: string[] = [];
          let dbInserted = 0;
          let dbRespondents = 0;
          if (embedded.length > 0) {
            const dbResult = await writeSegmentsToDb(embedded);
            dbInserted = dbResult.segmentsInserted;
            dbRespondents = dbResult.respondentsInserted;
            dbErrors = dbResult.errors;
          }

          // 重新从 DB 读取最新 stats（可能在 embedding 阶段被其他更新修改）
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
              segmentsEmbedded: embedStats.embedded,
              errors: [
                ...freshStats.errors,
                ...(dbInserted > 0
                  ? [`写入数据库: ${dbInserted} 条片段, ${dbRespondents} 位受访者`]
                  : []),
                ...dbErrors,
              ],
            },
          });

          await calibrateTotalMs(jobId, stage, stages);
          break;
        }

        case "clustering": {
          try {
            const proc = Bun.spawn(["python3", "scripts/cluster_personas.py"], {
              cwd: process.cwd(),
              stdout: "pipe",
              stderr: "pipe",
            });

            const exitCode = await proc.exited;
            if (exitCode === 0) {
              await update({
                stats: {
                  ...cachedStats,
                  errors: [...cachedStats.errors, "聚类分析完成"],
                },
              });
            } else {
              const stderr = await new Response(proc.stderr).text();
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
          } catch (e) {
            await update({
              stats: {
                ...cachedStats,
                errors: [...cachedStats.errors, `聚类分析异常: ${String(e)}`],
              },
            });
          }
          await calibrateTotalMs(jobId, stage, stages);
          break;
        }
      }
    } catch (e) {
      await update({
        stats: {
          ...cachedStats,
          errors: [
            ...cachedStats.errors,
            `${stageLabels[stage] ?? stage}: ${String(e)}`,
          ],
        },
      });
    }
  }

  // 清理上传的文件
  if (config.uploadedFileIds) {
    for (const fileId of config.uploadedFileIds) {
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

  await update({
    progress: 100,
    completedAt: new Date(),
  });
}

// ---- 工具函数 ----

async function readFileBuffer(filePath: string): Promise<Buffer> {
  const file = Bun.file(filePath);
  const arrayBuffer = await file.arrayBuffer();
  return Buffer.from(arrayBuffer);
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

// AI 打标已统一走 lib/pipeline-tagger.ts 的批量标注实现，
// 单条标注请直接使用 pipeline-tagger 导出的 labelSegment()。