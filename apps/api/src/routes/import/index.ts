// --------------------------------------------------------------
// 数据导入 API — 上传 JSON/JSONL 文件导入 + 从 data/ 目录导入
// --------------------------------------------------------------

import { eq, desc } from "drizzle-orm";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readdir, stat } from "node:fs/promises";

import { db } from "../../db/client.js";
import { importJobs } from "../../db/schema.js";
import { executeImport, readJsonFile } from "../../lib/import-runner.js";
import {
  SOURCE_SEGMENTS_MAP,
  RESPONDENTS_MAP,
  PERSONAS_MAP,
  detectFormat,
  type TableFieldMap,
} from "../../lib/field-mapper.js";

export const importRoute = new Hono();

const UPLOAD_DIR = join(tmpdir(), "import-uploads");

async function ensureUploadDir(): Promise<void> {
  await mkdir(UPLOAD_DIR, { recursive: true });
}

// ---- 表名 → 字段映射 ----

const TABLE_MAPS: Record<string, TableFieldMap> = {
  source_segments: SOURCE_SEGMENTS_MAP,
  respondents: RESPONDENTS_MAP,
  personas: PERSONAS_MAP,
};

// ---- 上传 JSON/JSONL 导入 ----

// POST /api/import/json
importRoute.post("/json", async (c) => {
  try {
    await ensureUploadDir();

    const body = await c.req.parseBody();
    const file = body["file"];
    const targetTable = (body["target_table"] as string) ?? "source_segments";
    const strategy = (body["strategy"] as string) ?? "insert-only";

    if (!file || !(file instanceof File)) {
      return c.json({ error: "请上传一个 JSON 或 JSONL 文件" }, 400);
    }

    const fieldMap = TABLE_MAPS[targetTable];
    if (!fieldMap) {
      return c.json({ error: `未知目标表: ${targetTable}` }, 400);
    }

    // 保存文件
    const fileId = `import-${randomUUID().slice(0, 8)}`;
    const ext = file.name.endsWith(".jsonl") ? ".jsonl" : ".json";
    const filePath = join(UPLOAD_DIR, `${fileId}${ext}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    // 读取并解析
    const { rows, format, error } = await readJsonFile(filePath);
    if (error) {
      return c.json({ error }, 400);
    }

    if (rows.length === 0) {
      return c.json({ error: "文件中没有有效数据" }, 400);
    }

    // 创建导入作业
    const [job] = await db
      .insert(importJobs)
      .values({
        source: `upload:${file.name}`,
        targetTable,
        fileName: file.name,
        totalRows: rows.length,
        status: "running",
        startedAt: new Date(),
      })
      .returning();

    if (!job) {
      return c.json({ error: "创建导入作业失败" }, 500);
    }

    // 异步执行导入
    executeImport(rows, {
      targetTable,
      strategy: strategy as "insert-only" | "upsert" | "append",
      fieldMap,
    }, { jobId: job.id }).catch((e) => {
      console.error("[import] 异步导入失败:", e);
    });

    return c.json({
      jobId: job.id,
      fileName: file.name,
      targetTable,
      totalRows: rows.length,
      format,
      status: "running",
    });
  } catch (e) {
    return c.json({ error: `导入失败: ${String(e)}` }, 500);
  }
});

// ---- 从 data/ 目录导入 ----

// POST /api/import/from-data-dir
importRoute.post("/from-data-dir", async (c) => {
  try {
    const body = await c.req.json<{
      dataPath?: string;
      targetTable: string;
      filePattern?: string;
      strategy?: string;
    }>();

    const targetTable = body.targetTable;
    const dataPath = body.dataPath ?? "data/群体画像";
    const filePattern = body.filePattern ?? "segments_*.json";
    const strategy = body.strategy ?? "insert-only";

    const fieldMap = TABLE_MAPS[targetTable];
    if (!fieldMap) {
      return c.json({ error: `未知目标表: ${targetTable}` }, 400);
    }

    // 解析 data/ 目录路径
    const projectRoot = process.cwd();
    const fullDataPath = join(projectRoot, dataPath);

    // 列出匹配的文件
    let files: string[];
    try {
      const entries = await readdir(fullDataPath);
      files = entries.filter((name) => {
        if (!name.endsWith(".json") && !name.endsWith(".jsonl")) return false;
        if (filePattern === "*") return true;
        // 简单 glob 匹配
        const regex = new RegExp(
          "^" + filePattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
        );
        return regex.test(name);
      });
    } catch {
      return c.json({ error: `目录不存在或无法读取: ${dataPath}` }, 400);
    }

    if (files.length === 0) {
      return c.json({ error: `未找到匹配文件: ${filePattern}` }, 400);
    }

    // 创建导入作业
    const [job] = await db
      .insert(importJobs)
      .values({
        source: dataPath,
        targetTable,
        fileName: filePattern,
        totalRows: 0,
        status: "running",
        startedAt: new Date(),
      })
      .returning();

    if (!job) {
      return c.json({ error: "创建导入作业失败" }, 500);
    }

    // 异步执行批量导入
    runBatchImport(fullDataPath, files, targetTable, strategy, fieldMap, job.id).catch((e) => {
      console.error("[import] 批量导入失败:", e);
    });

    return c.json({
      jobId: job.id,
      files,
      targetTable,
      dataPath,
      status: "running",
    });
  } catch (e) {
    return c.json({ error: `导入失败: ${String(e)}` }, 500);
  }
});

// ---- 导入作业管理 ----

// GET /api/import/jobs
importRoute.get("/jobs", async (c) => {
  try {
    const limit = Math.min(Number(c.req.query("limit")) || 20, 100);
    const rows = await db
      .select()
      .from(importJobs)
      .orderBy(desc(importJobs.createdAt))
      .limit(limit);

    return c.json({ data: rows });
  } catch (e) {
    return c.json({ error: `查询失败: ${String(e)}` }, 500);
  }
});

// GET /api/import/jobs/:id
importRoute.get("/jobs/:id", async (c) => {
  try {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) return c.json({ error: "无效的 ID" }, 400);

    const row = await db
      .select()
      .from(importJobs)
      .where(eq(importJobs.id, id))
      .limit(1);

    if (!row.length) return c.json({ error: "作业不存在" }, 404);

    return c.json({ data: row[0] });
  } catch (e) {
    return c.json({ error: `查询失败: ${String(e)}` }, 500);
  }
});

// ---- 预检 ----

// POST /api/import/dry-run
importRoute.post("/dry-run", async (c) => {
  try {
    await ensureUploadDir();

    const body = await c.req.parseBody();
    const file = body["file"];
    const targetTable = (body["target_table"] as string) ?? "source_segments";

    if (!file || !(file instanceof File)) {
      return c.json({ error: "请上传一个 JSON 或 JSONL 文件" }, 400);
    }

    const fieldMap = TABLE_MAPS[targetTable];
    if (!fieldMap) {
      return c.json({ error: `未知目标表: ${targetTable}` }, 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const text = new TextDecoder().decode(buffer);

    let data: unknown;
    try {
      if (file.name.endsWith(".jsonl")) {
        data = text
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      } else {
        data = JSON.parse(text);
      }
    } catch {
      return c.json({ error: "文件不是有效的 JSON 格式" }, 400);
    }

    const format = detectFormat(data);

    let rows: Record<string, unknown>[] = [];
    if (Array.isArray(data)) {
      rows = data as Record<string, unknown>[];
    } else if (typeof data === "object" && data !== null) {
      let found = false;
      for (const key of Object.keys(data)) {
        const val = (data as Record<string, unknown>)[key];
        if (Array.isArray(val) && val.length > 0) {
          rows = val as Record<string, unknown>[];
          found = true;
          break;
        }
      }
      if (!found) {
        rows = [data as Record<string, unknown>];
      }
    } else {
      rows = [];
    }

    // 运行校验
    const { validateAndMap } = await import("../../lib/field-mapper.js");
    const validation = validateAndMap(rows, fieldMap);

    // 字段匹配分析
    const sampleKeys = format.sampleKeys;
    const targetFields = Object.keys(fieldMap.mapping);
    const matched = sampleKeys.filter((k) => targetFields.includes(k));
    const unmatched = sampleKeys.filter((k) => !targetFields.includes(k));
    const missing = targetFields.filter((k) => !sampleKeys.includes(k));

    return c.json({
      format,
      sampleKeys,
      targetFields,
      fieldMatch: {
        matched,
        unmatched,
        missing,
        matchRate: sampleKeys.length > 0
          ? Math.round(matched.length / sampleKeys.length * 100)
          : 0,
      },
      validation: {
        valid: validation.valid,
        errorCount: validation.errors.length,
        warningCount: validation.warnings.length,
        sampleErrors: validation.errors.slice(0, 10),
        sampleWarnings: validation.warnings.slice(0, 10),
      },
    });
  } catch (e) {
    return c.json({ error: `预检失败: ${String(e)}` }, 500);
  }
});

// ---- 批量导入执行器 ----

async function runBatchImport(
  dataDir: string,
  files: string[],
  targetTable: string,
  strategy: string,
  fieldMap: TableFieldMap,
  jobId: number,
): Promise<void> {
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  const allErrors: Array<{ row: number; message: string }> = [];

  for (let fi = 0; fi < files.length; fi++) {
    const fileName = files[fi]!;
    const filePath = join(dataDir, fileName);

    try {
      const { rows, error } = await readJsonFile(filePath);
      if (error) {
        allErrors.push({ row: fi + 1, message: `文件 ${fileName}: ${error}` });
        continue;
      }

      if (rows.length === 0) {
        allErrors.push({ row: fi + 1, message: `文件 ${fileName}: 无有效数据` });
        continue;
      }

      // 为每个文件创建子导入作业
      const subJobResult = await db
        .insert(importJobs)
        .values({
          source: `batch:${fileName}`,
          targetTable,
          fileName,
          totalRows: rows.length,
          status: "running",
          startedAt: new Date(),
        })
        .returning();

      const subJob = subJobResult[0];
      if (!subJob) {
        allErrors.push({ row: fi + 1, message: `文件 ${fileName}: 创建子作业失败` });
        continue;
      }

      const result = await executeImport(rows, {
        targetTable,
        strategy: strategy as "insert-only" | "upsert" | "append",
        fieldMap,
      }, { jobId: subJob.id });

      totalInserted += result.inserted;
      totalUpdated += result.updated;
      totalSkipped += result.skipped;

      // 更新子作业
      await db
        .update(importJobs)
        .set({
          status: "completed",
          completedAt: new Date(),
          inserted: result.inserted,
          updated: result.updated,
          skipped: result.skipped,
          errors: result.errors.slice(-50),
        })
        .where(eq(importJobs.id, subJob.id));
    } catch (e) {
      allErrors.push({
        row: fi + 1,
        message: `文件 ${fileName}: ${String(e)}`,
      });
    }
  }

  // 更新主作业
  await db
    .update(importJobs)
    .set({
      status: "completed",
      completedAt: new Date(),
      inserted: totalInserted,
      updated: totalUpdated,
      skipped: totalSkipped,
      errors: allErrors.slice(-100),
    })
    .where(eq(importJobs.id, jobId));
}