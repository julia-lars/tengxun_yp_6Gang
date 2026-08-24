// --------------------------------------------------------------
// 导入执行引擎 — 批量将数据写入数据库
// --------------------------------------------------------------

import { sql } from "drizzle-orm";

import { db, schema } from "../db/client.js";
import type { TableFieldMap, ValidationResult } from "./field-mapper.js";
import { validateAndMap } from "./field-mapper.js";

// ---- 类型 ----

export type ImportStrategy = "upsert" | "insert-only" | "append";

export interface ImportConfig {
  targetTable: string;
  strategy: ImportStrategy;
  fieldMap: TableFieldMap;
  batchSize?: number;
  jobId?: number;
}

export interface ImportResult {
  totalRows: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
  validation: ValidationResult;
  durationMs: number;
}

// ---- 表 → Drizzle 表映射 ----

function getDrizzleTable(tableName: string): any {
  switch (tableName) {
    case "source_segments":
      return schema.sourceSegments;
    case "respondents":
      return schema.respondents;
    case "personas":
      return schema.personas;
    case "kol_profiles":
      return schema.kolProfiles;
    case "kol_segments":
      return schema.kolSegments;
    default:
      throw new Error(`未知目标表: ${tableName}`);
  }
}

// ---- 更新导入作业状态 ----

async function updateJobStatus(
  jobId: number | undefined,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!jobId) return;
  try {
    await db.update(schema.importJobs).set(patch).where(
      sql`${schema.importJobs.id} = ${jobId}`,
    );
  } catch (e) {
    console.error("[import] 更新作业状态失败:", e);
  }
}

// ---- 执行导入 ----

export async function executeImport(
  rawRows: Record<string, unknown>[],
  config: ImportConfig,
  options?: { jobId?: number },
): Promise<ImportResult> {
  const startTime = Date.now();
  const batchSize = config.batchSize ?? 500;
  const jobId = options?.jobId;

  const result: ImportResult = {
    totalRows: rawRows.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    validation: { valid: true, errors: [], warnings: [], mappedRows: [] },
    durationMs: 0,
  };

  // 1. 校验 + 映射
  await updateJobStatus(jobId, { status: "validating" });
  const validation = validateAndMap(rawRows, config.fieldMap);
  result.validation = validation;

  if (!validation.valid && validation.errors.length > 0) {
    result.errors.push(
      ...validation.errors.map((e) => ({
        row: e.row,
        message: `[${e.field}] ${e.message}`,
      })),
    );
    // 有错误但仍有有效行时继续处理
    if (validation.mappedRows.length === 0) {
      await updateJobStatus(jobId, {
        status: "failed",
        completedAt: new Date(),
        errors: result.errors,
      });
      return result;
    }
  }

  // 2. 写入数据库
  await updateJobStatus(jobId, {
    status: "running",
    totalRows: validation.mappedRows.length,
  });

  const drizzleTable = getDrizzleTable(config.targetTable);

  for (let i = 0; i < validation.mappedRows.length; i += batchSize) {
    const batch = validation.mappedRows.slice(i, i + batchSize);

    try {
      switch (config.strategy) {
        case "upsert": {
          // 对每条记录逐一 upsert（基于唯一键）
          for (const row of batch) {
            try {
              const conflictTarget = config.fieldMap.uniqueKeys
                .map((k) => config.fieldMap.mapping[k] ?? k)
                .filter(Boolean);

              if (conflictTarget.length > 0) {
                // 先查是否存在
                const conditions = conflictTarget.map((key) => {
                  const col = (drizzleTable as any)[key];
                  return sql`${col} = ${row[key]}`;
                });

                const existing = await db
                  .select()
                  .from(drizzleTable)
                  .where(sql.join(conditions, sql` AND `))
                  .limit(1);

                if (existing.length > 0) {
                  const idCol = (drizzleTable as any)["id"];
                  const existingId = (existing[0] as any).id as number;
                  await db.update(drizzleTable).set(row as any).where(sql`${idCol} = ${existingId}`);
                  result.updated++;
                } else {
                  await db.insert(drizzleTable).values(row as any);
                  result.inserted++;
                }
              } else {
                await db.insert(drizzleTable).values(row as any);
                result.inserted++;
              }
            } catch (e) {
              result.errors.push({
                row: i + batch.indexOf(row) + 1,
                message: String(e),
              });
            }
          }
          break;
        }

        case "insert-only":
        case "append": {
          try {
            await db.insert(drizzleTable).values(batch as any).onConflictDoNothing();
            result.inserted += batch.length;
          } catch (e) {
            // 批量插入失败时逐条重试
            for (const row of batch) {
              try {
                await db.insert(drizzleTable).values(row as any);
                result.inserted++;
              } catch (innerErr) {
                result.errors.push({
                  row: i + batch.indexOf(row) + 1,
                  message: String(innerErr),
                });
              }
            }
          }
          break;
        }
      }
    } catch (e) {
      result.errors.push({
        row: i + 1,
        message: `批次写入失败 (rows ${i + 1}-${i + batch.length}): ${String(e)}`,
      });
    }

    // 更新进度
    const progress = Math.min(100, Math.round((i + batch.length) / validation.mappedRows.length * 100));
    await updateJobStatus(jobId, {
      inserted: result.inserted,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors.slice(-50), // 只保留最近 50 条错误
    });
  }

  result.durationMs = Date.now() - startTime;

  await updateJobStatus(jobId, {
    status: "completed",
    completedAt: new Date(),
    inserted: result.inserted,
    updated: result.updated,
    skipped: result.skipped,
    errors: result.errors.slice(-100),
  });

  return result;
}

/**
 * 从文件路径读取并解析 JSON
 */
export async function readJsonFile(filePath: string): Promise<{
  rows: Record<string, unknown>[];
  format: string;
  error?: string;
}> {
  try {
    const file = Bun.file(filePath);
    const text = await file.text();

    // 尝试解析 JSONL
    if (filePath.endsWith(".jsonl")) {
      const lines = text.trim().split("\n").filter(Boolean);
      const rows = lines.map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      }).filter(Boolean) as Record<string, unknown>[];
      return { rows, format: "jsonl" };
    }

    // 解析 JSON
    const data = JSON.parse(text);

    if (Array.isArray(data)) {
      return { rows: data as Record<string, unknown>[], format: "json-array" };
    }

    // JSON 对象：尝试找数组字段
    for (const [_key, value] of Object.entries(data)) {
      if (Array.isArray(value) && value.length > 0) {
        return {
          rows: value as Record<string, unknown>[],
          format: "json-object",
        };
      }
    }

    return { rows: [data as Record<string, unknown>], format: "json-object" };
  } catch (e) {
    return { rows: [], format: "unknown", error: `文件读取失败: ${String(e)}` };
  }
}