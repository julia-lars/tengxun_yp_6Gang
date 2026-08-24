// --------------------------------------------------------------
// 数据流水线路由 — AI 全流程处理
// 上传文件 → 数据提取 → 数据清洗 → AI 打标 → 向量嵌入 → (聚类)
// --------------------------------------------------------------

import type { PipelineConfig, PipelineStatus } from "@app/shared";
import { pipelineConfigSchema } from "@app/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir, unlink } from "node:fs/promises";
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

export const pipelineRoute = new Hono();

// ---- 内存中的作业状态存储 ----

const jobStore = new Map<string, PipelineStatus>();

// ---- 上传目录 ----

const UPLOAD_DIR = join(tmpdir(), "pipeline-uploads");

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

    const status: PipelineStatus = {
      jobId,
      stage: "uploading",
      progress: 0,
      estimatedTotalMs,
      stats: {
        filesTotal: config.fileNames?.length ?? 0,
        filesProcessed: 0,
        segmentsExtracted: 0,
        segmentsCleaned: 0,
        segmentsTagged: 0,
        segmentsEmbedded: 0,
        errors: [],
      },
      startedAt: new Date().toISOString(),
      completedAt: null,
    };

    jobStore.set(jobId, status);

    // 异步执行流水线（不阻塞响应）
    executePipeline(jobId, config).catch((e) => {
      const current = jobStore.get(jobId);
      if (current) {
        current.stats.errors.push(`流水线异常: ${String(e)}`);
        current.completedAt = new Date().toISOString();
      }
      console.error("流水线执行失败:", e);
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
  const status = jobStore.get(jobId);
  if (!status) return c.json({ error: "作业不存在" }, 404);

  if (!status.completedAt) {
    const elapsed = Date.now() - new Date(status.startedAt).getTime();

    // 时间驱动进度（单调，不回退）
    const rawProgress = Math.round((elapsed / status.estimatedTotalMs) * 100);
    const monotonicProgress = Math.max(status.progress, Math.min(99, rawProgress));
    status.progress = monotonicProgress;

    // 剩余时间
    status.estimatedRemainingMs = Math.max(0, status.estimatedTotalMs - elapsed);
  }

  return c.json(status);
});

// ---- 流水线执行逻辑 ----

// 阶段切换时校准 estimatedTotalMs
function calibrateTotalMs(
  jobId: string,
  completedStage: string,
  stages: string[],
) {
  const status = jobStore.get(jobId);
  if (!status) return;

  const elapsed = Date.now() - new Date(status.startedAt).getTime();

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
    const newEstimatedTotal = Math.round(elapsed / completedWeight * 100);
    // 只增不减，且至少保留 10% buffer
    status.estimatedTotalMs = Math.max(
      status.estimatedTotalMs,
      newEstimatedTotal,
    );
  }
}

async function executePipeline(jobId: string, config: PipelineConfig) {
  const update = (patch: Partial<PipelineStatus>) => {
    const current = jobStore.get(jobId);
    if (current) Object.assign(current, patch);
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
    update({ stage: stage as PipelineStatus["stage"] });

    try {
      switch (stage) {
        case "uploading": {
          // 阶段 1: 上传解析 — 读取上传的文件并提取文本
          const currentStats = jobStore.get(jobId)!.stats;
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

          update({
            stats: {
              ...currentStats,
              filesProcessed: processed,
              segmentsExtracted: allSegments.length,
              errors: [...currentStats.errors, ...stageErrors],
            },
          });

          // 阶段完成后校准预估总时间
          calibrateTotalMs(jobId, stage, stages);
          break;
        }

        case "extracting": {
          const currentStats = jobStore.get(jobId)!.stats;
          update({
            stats: {
              ...currentStats,
              segmentsExtracted: allSegments.length,
            },
          });
          calibrateTotalMs(jobId, stage, stages);
          break;
        }

        case "cleaning": {
          const currentStats = jobStore.get(jobId)!.stats;
          const before = allSegments.length;

          cleanedSegments = cleanSegments(allSegments);
          const stats = getCleaningStats(before, cleanedSegments.length);

          update({
            stats: {
              ...currentStats,
              segmentsCleaned: cleanedSegments.length,
              errors: [
                ...currentStats.errors,
                `清洗完成: 移除 ${stats.removed} 条 (${stats.removalRate}%)，保留 ${stats.kept} 条`,
              ],
            },
          });
          calibrateTotalMs(jobId, stage, stages);
          break;
        }

        case "tagging": {
          const currentStats = jobStore.get(jobId)!.stats;

          if (cleanedSegments.length === 0) {
            update({
              stats: {
                ...currentStats,
                segmentsTagged: 0,
                errors: [...currentStats.errors, "没有可标注的片段"],
              },
            });
            calibrateTotalMs(jobId, stage, stages);
            break;
          }

          const tagged = await tagSegments(cleanedSegments);
          const taggedCount = tagged.filter((s) => s.annotation !== null).length;

          update({
            stats: {
              ...currentStats,
              segmentsTagged: taggedCount,
            },
          });

          cleanedSegments = tagged;
          calibrateTotalMs(jobId, stage, stages);
          break;
        }

        case "embedding": {
          const currentStats = jobStore.get(jobId)!.stats;

          if (cleanedSegments.length === 0) {
            update({
              stats: {
                ...currentStats,
                segmentsEmbedded: 0,
                errors: [...currentStats.errors, "没有可嵌入的片段"],
              },
            });
            calibrateTotalMs(jobId, stage, stages);
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

          const freshStats = jobStore.get(jobId)!.stats;
          update({
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

          calibrateTotalMs(jobId, stage, stages);
          break;
        }

        case "clustering": {
          const currentStats = jobStore.get(jobId)!.stats;

          try {
            const proc = Bun.spawn(["python3", "scripts/cluster_personas.py"], {
              cwd: process.cwd(),
              stdout: "pipe",
              stderr: "pipe",
            });

            const exitCode = await proc.exited;
            if (exitCode === 0) {
              update({
                stats: {
                  ...currentStats,
                  errors: [...currentStats.errors, "聚类分析完成"],
                },
              });
            } else {
              const stderr = await new Response(proc.stderr).text();
              update({
                stats: {
                  ...currentStats,
                  errors: [
                    ...currentStats.errors,
                    `聚类分析失败 (exit ${exitCode}): ${stderr.slice(0, 200)}`,
                  ],
                },
              });
            }
          } catch (e) {
            update({
              stats: {
                ...currentStats,
                errors: [...currentStats.errors, `聚类分析异常: ${String(e)}`],
              },
            });
          }
          calibrateTotalMs(jobId, stage, stages);
          break;
        }
      }
    } catch (e) {
      const currentStats = jobStore.get(jobId)!.stats;
      update({
        stats: {
          ...currentStats,
          errors: [
            ...currentStats.errors,
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

  update({
    progress: 100,
    completedAt: new Date().toISOString(),
  });
}

// ---- 工具函数 ----

async function readFileBuffer(filePath: string): Promise<Buffer> {
  const file = Bun.file(filePath);
  const arrayBuffer = await file.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// AI 打标已统一走 lib/pipeline-tagger.ts 的批量标注实现，
// 单条标注请直接使用 pipeline-tagger 导出的 labelSegment()。