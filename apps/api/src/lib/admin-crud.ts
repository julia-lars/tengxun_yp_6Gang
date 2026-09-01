// --------------------------------------------------------------
// 通用 CRUD 工厂 — 为任意表自动生成分页列表/详情/新增/更新/删除端点
// --------------------------------------------------------------

import type { PgTable } from "drizzle-orm/pg-core";
import { eq, and, or, ilike, sql, asc, desc } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { db, schema } from "../db/client.js";
import { writeAuditLog } from "./audit.js";

// ---- 类型定义 ----

export interface CrudConfig<T extends PgTable> {
  /** Drizzle 表定义 */
  table: T;
  /** 表名（用于审计日志） */
  tableName: string;
  /** 支持模糊搜索的字段名列表 */
  searchableFields: string[];
  /** 支持精确筛选的字段名列表 */
  filterableFields: string[];
  /** 支持排序的字段名列表 */
  sortableFields: string[];
  /** 列表查询时返回的字段（默认全选） */
  listSelect?: Record<string, unknown>;
  /** 允许通过 API 编辑的字段名列表 */
  editableFields: string[];
  /** 新增时必填的字段名列表 */
  requiredFields: string[];
  /** JSONB 类型字段（校验时做 JSON.parse 处理） */
  jsonbFields: string[];
  /** 数组类型字段 */
  arrayFields: string[];
  /** 删除前校验（返回 true 允许删除） */
  onBeforeDelete?: (id: number) => Promise<{ allowed: boolean; reason?: string }>;
  /** 新增前对数据的预处理 */
  beforeInsert?: (data: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** 更新前对数据的预处理 */
  beforeUpdate?: (id: number, data: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** 最大分页限制 */
  maxLimit?: number;
  /** 只读模式：仅暴露 GET 列表、GET 详情、DELETE，不暴露 POST/PUT（如对话记录） */
  readOnly?: boolean;
}

// ---- 通用查询 Schema ----

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().optional(),
  filters: z.string().optional(), // JSON 字符串: {"field":"value"}
});

// ---- 工厂函数 ----

export function createCrudRoutes<T extends PgTable>(config: CrudConfig<T>) {
  const route = new Hono();
  const maxLimit = config.maxLimit ?? 100;

  // ============================================================
  // GET / — 分页列表（支持搜索、筛选、排序）
  // ============================================================
  route.get("/", zValidator("query", listQuerySchema), async (c) => {
    try {
      const { page, limit, sort, order, search, filters } = c.req.valid("query");
      const offset = (page - 1) * limit;

      // 构建 WHERE 条件
      const conditions: ReturnType<typeof eq>[] = [];

      // 模糊搜索
      if (search && config.searchableFields.length > 0) {
        const searchConditions = config.searchableFields.map((field) => {
          const col = (config.table as Record<string, unknown>)[field] as ReturnType<typeof sql>;
          return ilike(col, `%${search}%`);
        });
        conditions.push(or(...searchConditions)!);
      }

      // 精确筛选
      if (filters) {
        try {
          const filterObj = JSON.parse(filters) as Record<string, string>;
          for (const [key, value] of Object.entries(filterObj)) {
            if (config.filterableFields.includes(key) && value) {
              const col = (config.table as Record<string, unknown>)[key] as ReturnType<typeof sql>;
              conditions.push(eq(col, value));
            }
          }
        } catch {
          // 忽略无效的 filters JSON
        }
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      // 查询总数
      const countResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(config.table)
        .where(where);

      const total = countResult[0]?.count ?? 0;

      // 排序
      let orderBy;
      if (sort && config.sortableFields.includes(sort)) {
        const sortCol = (config.table as Record<string, unknown>)[sort] as ReturnType<typeof sql>;
        orderBy = order === "asc" ? asc(sortCol) : desc(sortCol);
      } else {
        // 默认按 id 降序
        const idCol = (config.table as Record<string, unknown>)["id"] as ReturnType<typeof sql>;
        orderBy = desc(idCol);
      }

      // 查询数据
      const rows = await db
        .select()
        .from(config.table)
        .where(where)
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset);

      return c.json({
        data: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (e) {
      console.error(`[crud] ${config.tableName} 列表查询失败:`, e);
      return c.json({ error: `查询失败: ${String(e)}` }, 500);
    }
  });

  // ============================================================
  // GET /:id — 单条详情
  // ============================================================
  route.get("/:id", async (c) => {
    try {
      const id = Number(c.req.param("id"));
      if (Number.isNaN(id)) return c.json({ error: "无效的 ID" }, 400);

      const idCol = (config.table as Record<string, unknown>)["id"] as ReturnType<typeof sql>;
      const row = await db
        .select()
        .from(config.table)
        .where(eq(idCol, id))
        .limit(1);

      if (!row.length) return c.json({ error: "记录不存在" }, 404);

      return c.json({ data: row[0] });
    } catch (e) {
      console.error(`[crud] ${config.tableName} 详情查询失败:`, e);
      return c.json({ error: `查询失败: ${String(e)}` }, 500);
    }
  });

  // ============================================================
  // POST / — 新增记录（readOnly 模式下跳过）
  // ============================================================
  if (!config.readOnly) {
    route.post("/", async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();

      // 必填字段校验
      for (const field of config.requiredFields) {
        if (body[field] === undefined || body[field] === null || body[field] === "") {
          return c.json({ error: `缺少必填字段: ${field}` }, 400);
        }
      }

      // 只保留可编辑字段
      const insertData: Record<string, unknown> = {};
      for (const field of config.editableFields) {
        if (body[field] !== undefined) {
          insertData[field] = body[field];
        }
      }

      // 处理 JSONB 字段
      for (const field of config.jsonbFields) {
        if (insertData[field] && typeof insertData[field] === "string") {
          try {
            insertData[field] = JSON.parse(insertData[field] as string);
          } catch {
            return c.json({ error: `字段 ${field} 不是有效的 JSON` }, 400);
          }
        }
      }

      // 预处理
      let finalData = insertData;
      if (config.beforeInsert) {
        finalData = await config.beforeInsert(insertData);
      }

      const result = await db.insert(config.table).values(finalData as any).returning();
      const newRecord = result[0];

      // 审计
      await writeAuditLog({
        tableName: config.tableName,
        recordId: (newRecord as Record<string, unknown>).id as number,
        action: "INSERT",
        newData: finalData,
      });

      return c.json({ data: newRecord }, 201);
    } catch (e) {
      console.error(`[crud] ${config.tableName} 新增失败:`, e);
      return c.json({ error: `新增失败: ${String(e)}` }, 500);
    }
  });
  } // end readOnly check for POST

  // ============================================================
  // PUT /:id — 更新记录（readOnly 模式下跳过）
  // ============================================================
  if (!config.readOnly) {
    route.put("/:id", async (c) => {
    try {
      const id = Number(c.req.param("id"));
      if (Number.isNaN(id)) return c.json({ error: "无效的 ID" }, 400);

      const body = await c.req.json<Record<string, unknown>>();

      // 只保留可编辑字段
      const updateData: Record<string, unknown> = {};
      for (const field of config.editableFields) {
        if (body[field] !== undefined) {
          updateData[field] = body[field];
        }
      }

      if (Object.keys(updateData).length === 0) {
        return c.json({ error: "没有可更新的字段" }, 400);
      }

      // 处理 JSONB 字段
      for (const field of config.jsonbFields) {
        if (updateData[field] && typeof updateData[field] === "string") {
          try {
            updateData[field] = JSON.parse(updateData[field] as string);
          } catch {
            return c.json({ error: `字段 ${field} 不是有效的 JSON` }, 400);
          }
        }
      }

      // 预处理
      let finalData = updateData;
      if (config.beforeUpdate) {
        finalData = await config.beforeUpdate(id, updateData);
      }

      const idCol = (config.table as Record<string, unknown>)["id"] as ReturnType<typeof sql>;

      // 查旧值用于审计
      const oldRow = await db.select().from(config.table).where(eq(idCol, id)).limit(1);
      const oldData = oldRow.length > 0 ? (oldRow[0] as Record<string, unknown>) : null;

      const result = await db
        .update(config.table)
        .set(finalData as any)
        .where(eq(idCol, id))
        .returning();

      if (!result.length) return c.json({ error: "记录不存在" }, 404);

      // 审计
      await writeAuditLog({
        tableName: config.tableName,
        recordId: id,
        action: "UPDATE",
        oldData: oldData ? sanitizeForAudit(oldData) : null,
        newData: finalData,
      });

      return c.json({ data: result[0] });
    } catch (e) {
      console.error(`[crud] ${config.tableName} 更新失败:`, e);
      return c.json({ error: `更新失败: ${String(e)}` }, 500);
    }
  });
  } // end readOnly check for PUT

  // ============================================================
  // DELETE /:id — 删除记录
  // ============================================================
  route.delete("/:id", async (c) => {
    try {
      const id = Number(c.req.param("id"));
      if (Number.isNaN(id)) return c.json({ error: "无效的 ID" }, 400);

      // 删除前校验
      if (config.onBeforeDelete) {
        const check = await config.onBeforeDelete(id);
        if (!check.allowed) {
          return c.json({ error: check.reason ?? "不允许删除此记录" }, 403);
        }
      }

      const idCol = (config.table as Record<string, unknown>)["id"] as ReturnType<typeof sql>;

      // 查旧值用于审计
      const oldRow = await db.select().from(config.table).where(eq(idCol, id)).limit(1);
      if (!oldRow.length) return c.json({ error: "记录不存在" }, 404);

      const oldData = oldRow[0] as Record<string, unknown>;

      await db.delete(config.table).where(eq(idCol, id));

      // 审计
      await writeAuditLog({
        tableName: config.tableName,
        recordId: id,
        action: "DELETE",
        oldData: sanitizeForAudit(oldData),
      });

      return c.json({ success: true, message: "删除成功" });
    } catch (e) {
      console.error(`[crud] ${config.tableName} 删除失败:`, e);
      return c.json({ error: `删除失败: ${String(e)}` }, 500);
    }
  });

  // ============================================================
  // POST /batch-delete — 批量删除记录
  // ============================================================
  route.post("/batch-delete", async (c) => {
    try {
      const body = await c.req.json<{ ids: number[] }>();
      if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
        return c.json({ error: "请提供要删除的 ID 列表" }, 400);
      }

      // 删除前逐条校验
      if (config.onBeforeDelete) {
        for (const id of body.ids) {
          const check = await config.onBeforeDelete(id);
          if (!check.allowed) {
            return c.json({
              error: `记录 #${id}: ${check.reason ?? "不允许删除"}`,
            }, 403);
          }
        }
      }

      const idCol = (config.table as Record<string, unknown>)["id"] as ReturnType<typeof sql>;
      const result = await db
        .delete(config.table)
        .where(sql`${idCol} = ANY(ARRAY[${sql.join(body.ids, sql`, `)}]::int[])`);

      return c.json({ success: true, deleted: body.ids.length });
    } catch (e) {
      console.error(`[crud] ${config.tableName} 批量删除失败:`, e);
      return c.json({ error: `批量删除失败: ${String(e)}` }, 500);
    }
  });

  return route;
}

// ---- 辅助函数 ----

/** 清理审计数据：移除不可序列化的字段 */
function sanitizeForAudit(data: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value instanceof Date) {
      clean[key] = value.toISOString();
    } else if (typeof value !== "function" && typeof value !== "symbol") {
      clean[key] = value;
    }
  }
  return clean;
}