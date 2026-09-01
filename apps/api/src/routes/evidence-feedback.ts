// --------------------------------------------------------------
// 证据反馈 API — 用户对证据检索结果的 👍/👎 反馈
// --------------------------------------------------------------

import { zValidator } from "@hono/zod-validator";
import { desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { db } from "../db/client.js";
import { evidenceFeedback } from "../db/schema.js";

export const evidenceFeedbackRoute = new Hono();

const feedbackSchema = z.object({
  evidenceId: z.number().int().positive(),
  rating: z.enum(["helpful", "not_helpful"]),
  chatSessionId: z.number().int().positive().optional(),
  messageIndex: z.number().int().min(0).optional(),
  queryText: z.string().max(2000).optional(),
  personaId: z.number().int().positive().optional(),
});

// POST /api/evidence/feedback — 提交证据反馈
evidenceFeedbackRoute.post("/", zValidator("json", feedbackSchema), async (c) => {
  const body = c.req.valid("json");

  const [row] = await db
    .insert(evidenceFeedback)
    .values({
      evidenceId: body.evidenceId,
      rating: body.rating,
      chatSessionId: body.chatSessionId ?? null,
      messageIndex: body.messageIndex ?? null,
      queryText: body.queryText ?? null,
      personaId: body.personaId ?? null,
    })
    .returning();

  return c.json({ success: true, id: row!.id });
});

// GET /api/evidence/feedback/stats — 证据反馈统计
evidenceFeedbackRoute.get("/stats", async (c) => {
  const evidenceId = c.req.query("evidenceId");
  const personaId = c.req.query("personaId");

  const conditions = [];
  if (evidenceId) conditions.push(eq(evidenceFeedback.evidenceId, Number(evidenceId)));
  if (personaId) conditions.push(eq(evidenceFeedback.personaId, Number(personaId)));

  const rows = await db
    .select({
      rating: evidenceFeedback.rating,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(evidenceFeedback)
    .where(conditions.length > 0 ? sql`${conditions[0]!}` : undefined)
    .groupBy(evidenceFeedback.rating);

  const stats = {
    helpful: 0,
    notHelpful: 0,
    total: 0,
  };

  for (const row of rows) {
    if (row.rating === "helpful") stats.helpful = row.count;
    if (row.rating === "not_helpful") stats.notHelpful = row.count;
    stats.total += row.count;
  }

  return c.json(stats);
});

// GET /api/evidence/feedback/low-quality — 获取低质量证据列表（not_helpful 比例高的）
evidenceFeedbackRoute.get("/low-quality", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? "20"), 100);

  const rows = await db
    .select({
      evidenceId: evidenceFeedback.evidenceId,
      total: sql<number>`COUNT(*)::int`,
      notHelpful: sql<number>`SUM(CASE WHEN rating = 'not_helpful' THEN 1 ELSE 0 END)::int`,
    })
    .from(evidenceFeedback)
    .groupBy(evidenceFeedback.evidenceId)
    .having(({ total, notHelpful }) => sql`${notHelpful} > 0 AND ${notHelpful}::float / ${total}::float >= 0.5`)
    .orderBy(desc(sql`${sql`SUM(CASE WHEN rating = 'not_helpful' THEN 1 ELSE 0 END)`}::float / ${sql`COUNT(*)`}::float`))
    .limit(limit);

  return c.json(
    rows.map((r) => ({
      evidenceId: r.evidenceId,
      total: r.total,
      notHelpful: r.notHelpful,
      notHelpfulRatio: r.total > 0 ? r.notHelpful / r.total : 0,
    })),
  );
});