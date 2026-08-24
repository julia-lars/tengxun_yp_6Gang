// --------------------------------------------------------------
// 标签 + 画像 路由
// --------------------------------------------------------------

import type { PersonaDetail, PersonaSummary } from "@app/shared";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { Hono } from "hono";

import { db } from "../db/client.js";
import { personas, sourceSegments } from "../db/schema.js";

export const personasRoute = new Hono();

// ---- 画像列表 ----

// GET /api/personas?tags=...&limit=20&offset=0
personasRoute.get("/", async (c) => {
  const tagsParam = c.req.query("tags");
  const limit = Math.min(Number(c.req.query("limit")) || 50, 100);
  const offset = Number(c.req.query("offset")) || 0;

  const conditions = [];

  // 标签筛选：使用 PostgreSQL jsonb 操作符
  // 格式：用 | 分隔题组（AND），, 分隔组内选项（OR）
  // 无 | 时整个字符串视为一组，组内逗号为 OR（兼容旧格式但语义变为 OR）
  if (tagsParam) {
    const groups = tagsParam
      .split("|")
      .map((g) =>
        g
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      )
      .filter((g) => g.length > 0);

    for (const group of groups) {
      if (group.length === 1) {
        conditions.push(
          sql`EXISTS (
            SELECT 1 FROM jsonb_each_text(${personas.tagSpec}) AS kv
            WHERE kv.value ILIKE ${"%" + group[0] + "%"}
          )`,
        );
      } else {
        // 组内 OR：任一标签命中即匹配
        const orConditions = group.map(
          (tag) =>
            sql`EXISTS (
              SELECT 1 FROM jsonb_each_text(${personas.tagSpec}) AS kv
              WHERE kv.value ILIKE ${"%" + tag + "%"}
            )`,
        );
        conditions.push(or(...orConditions)!);
      }
    }
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(personas)
    .where(where)
    .orderBy(sql`${personas.sampleCount} DESC`)
    .limit(limit)
    .offset(offset);

  const result: PersonaSummary[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    tagSpec: r.tagSpec as Record<string, string | string[]>,
    sampleCount: r.sampleCount ?? 0,
    createdAt: r.createdAt.toISOString(),
  }));

  return c.json(result);
});

// ---- 画像详情 ----

// GET /api/personas/:id
personasRoute.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "无效的 ID" }, 400);

  const row = await db.query.personas.findFirst({
    where: eq(personas.id, id),
  });

  if (!row) return c.json({ error: "画像不存在" }, 404);

  // 获取关联证据
  const evidenceIds = (row.evidenceIds ?? []) as number[];
  let evidenceList: Array<{
    id: number;
    sourceFile: string;
    originalText: string;
    annotation: Record<string, unknown> | null;
  }> = [];

  if (evidenceIds.length > 0) {
    const evidenceRows = await db
      .select({
        id: sourceSegments.id,
        sourceFile: sourceSegments.sourceFile,
        originalText: sourceSegments.originalText,
        annotation: sourceSegments.annotation,
      })
      .from(sourceSegments)
      .where(inArray(sourceSegments.id, evidenceIds))
      .limit(10);

    evidenceList = evidenceRows.map((e) => ({
      id: e.id,
      sourceFile: e.sourceFile,
      originalText: e.originalText,
      annotation: (e.annotation as Record<string, unknown>) ?? null,
    }));
  }

  const result: PersonaDetail = {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    tagSpec: row.tagSpec as Record<string, string | string[]>,
    sampleCount: row.sampleCount ?? 0,
    createdAt: row.createdAt.toISOString(),
    motivationChain: (row.motivationChain as Record<string, unknown>) ?? null,
    clusterId: row.clusterId,
    evidenceList,
  };

  return c.json(result);
});
