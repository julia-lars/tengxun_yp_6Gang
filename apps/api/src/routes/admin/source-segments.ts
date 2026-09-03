// --------------------------------------------------------------
// source_segments 管理 CRUD
// --------------------------------------------------------------

import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import { createCrudRoutes } from "../../lib/admin-crud.js";
import { sourceSegments, personas } from "../../db/schema.js";
import { db } from "../../db/client.js";

const route = new Hono();

// 额外端点：按 source_file 批量获取（必须在 CRUD 路由前注册，避免 /:id 拦截）
route.get("/by-source", async (c) => {
  const sourceFile = c.req.query("source_file");
  if (!sourceFile) {
    return c.json({ error: "缺少 source_file 参数" }, 400);
  }

  try {
    const rows = await db
      .select()
      .from(sourceSegments)
      .where(eq(sourceSegments.sourceFile, sourceFile))
      .orderBy(sql`${sourceSegments.segmentIndex} ASC`)
      .limit(500);

    return c.json({ data: rows, total: rows.length });
  } catch (e) {
    return c.json({ error: `查询失败: ${String(e)}` }, 500);
  }
});

// 批量删除
route.post("/batch-delete", async (c) => {
  try {
    const body = await c.req.json<{ ids: number[] }>();
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return c.json({ error: "请提供要删除的 ID 列表" }, 400);
    }

    // 检查引用
    for (const id of body.ids) {
      const refs = await db
        .select({ id: personas.id })
        .from(personas)
        .where(sql`${personas.evidenceIds} @> ARRAY[${id}]`)
        .limit(1);
      if (refs.length > 0) {
        return c.json({
          error: `片段 #${id} 被画像引用，无法删除。请先从画像中移除引用。`,
        }, 400);
      }
    }

    const result = await db
      .delete(sourceSegments)
      .where(sql`${sourceSegments.id} = ANY(ARRAY[${sql.join(body.ids, sql`, `)}]::int[])`);

    return c.json({ success: true, deleted: body.ids.length });
  } catch (e) {
    return c.json({ error: `批量删除失败: ${String(e)}` }, 500);
  }
});

// CRUD 路由
route.route("/", createCrudRoutes({
  table: sourceSegments,
  tableName: "source_segments",
  searchableFields: ["source_file", "original_text", "cleaned_text", "speaker_id"],
  filterableFields: ["source_file", "speaker_role", "speaker_id"],
  sortableFields: ["id", "source_file", "speaker_id", "char_count", "created_at", "segment_index"],
  editableFields: [
    "source_file",
    "segment_index",
    "speaker_id",
    "speaker_role",
    "preceding_question",
    "original_text",
    "cleaned_text",
    "char_count",
    "annotation",
    "persona_ids",
  ],
  requiredFields: ["source_file", "original_text"],
  jsonbFields: ["annotation"],
  arrayFields: ["persona_ids"],
  maxLimit: 100,
  onBeforeDelete: async (id) => {
    const refs = await db
      .select({ id: personas.id, name: personas.name })
      .from(personas)
      .where(sql`${personas.evidenceIds} @> ARRAY[${id}]`)
      .limit(5);

    if (refs.length > 0) {
      const names = refs.map((r) => `#${r.id} ${r.name}`).join(", ");
      return {
        allowed: false,
        reason: `此片段被以下画像引用: ${names}。请先从画像中移除引用后再删除。`,
      };
    }
    return { allowed: true };
  },
}));

export { route as sourceSegmentsAdminRoute };