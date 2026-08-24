// --------------------------------------------------------------
// 管理 API 路由汇总 + 仪表盘统计
// --------------------------------------------------------------

import { sql } from "drizzle-orm";
import { Hono } from "hono";

import { db } from "../../db/client.js";
import {
  sourceSegments,
  personas,
  respondents,
  kolProfiles,
  kolSegments,
  chatSessions,
  kolChatSessions,
  importJobs,
} from "../../db/schema.js";
import { sourceSegmentsAdminRoute } from "./source-segments.js";
import { personasAdminRoute } from "./personas.js";
import { respondentsAdminRoute } from "./respondents.js";

export const adminRoute = new Hono();

// ---- 仪表盘统计 ----

adminRoute.get("/stats", async (c) => {
  try {
    const counts = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(sourceSegments),
      db.select({ count: sql<number>`count(*)::int` }).from(personas),
      db.select({ count: sql<number>`count(*)::int` }).from(respondents),
      db.select({ count: sql<number>`count(*)::int` }).from(kolProfiles),
      db.select({ count: sql<number>`count(*)::int` }).from(kolSegments),
      db.select({ count: sql<number>`count(*)::int` }).from(chatSessions),
      db.select({ count: sql<number>`count(*)::int` }).from(kolChatSessions),
    ]);

    // 各 source_file 的片段数分布
    const sourceDistribution = await db
      .select({
        sourceFile: sourceSegments.sourceFile,
        count: sql<number>`count(*)::int`,
      })
      .from(sourceSegments)
      .groupBy(sourceSegments.sourceFile)
      .orderBy(sql`count DESC`)
      .limit(20);

    return c.json({
      tables: {
        source_segments: counts[0]?.[0]?.count ?? 0,
        personas: counts[1]?.[0]?.count ?? 0,
        respondents: counts[2]?.[0]?.count ?? 0,
        kol_profiles: counts[3]?.[0]?.count ?? 0,
        kol_segments: counts[4]?.[0]?.count ?? 0,
        chat_sessions: counts[5]?.[0]?.count ?? 0,
        kol_chat_sessions: counts[6]?.[0]?.count ?? 0,
      },
      sourceDistribution,
    });
  } catch (e) {
    return c.json({ error: `统计查询失败: ${String(e)}` }, 500);
  }
});

// ---- 审计日志查询 ----

adminRoute.get("/audit-log", async (c) => {
  try {
    const limit = Math.min(Number(c.req.query("limit")) || 50, 100);
    const tableName = c.req.query("table");

    const { auditLog } = await import("../../db/schema.js");

    let rows;
    if (tableName) {
      rows = await db
        .select()
        .from(auditLog)
        .where(sql`${auditLog.tableName} = ${tableName}`)
        .orderBy(sql`${auditLog.changedAt} DESC`)
        .limit(limit);
    } else {
      rows = await db
        .select()
        .from(auditLog)
        .orderBy(sql`${auditLog.changedAt} DESC`)
        .limit(limit);
    }

    return c.json({ data: rows });
  } catch (e) {
    return c.json({ error: `审计日志查询失败: ${String(e)}` }, 500);
  }
});

// ---- 子路由 ----

adminRoute.route("/source-segments", sourceSegmentsAdminRoute);
adminRoute.route("/personas", personasAdminRoute);
adminRoute.route("/respondents", respondentsAdminRoute);