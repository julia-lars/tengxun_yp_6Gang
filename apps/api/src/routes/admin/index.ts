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
import { kolProfilesAdminRoute } from "./kol-profiles.js";
import { kolSegmentsAdminRoute } from "./kol-segments.js";
import { chatSessionsAdminRoute } from "./chat-sessions.js";
import { kolChatSessionsAdminRoute } from "./kol-chat-sessions.js";

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

// 最近操作（仪表盘用）
adminRoute.get("/recent-activity", async (c) => {
  try {
    const limit = Math.min(Number(c.req.query("limit")) || 5, 20);
    const { auditLog } = await import("../../db/schema.js");

    const rows = await db
      .select()
      .from(auditLog)
      .orderBy(sql`${auditLog.changedAt} DESC`)
      .limit(limit);

    return c.json({ data: rows });
  } catch (e) {
    return c.json({ error: `查询失败: ${String(e)}` }, 500);
  }
});

// 审计日志分页查询
adminRoute.get("/audit-log", async (c) => {
  try {
    const page = Math.max(Number(c.req.query("page")) || 1, 1);
    const limit = Math.min(Number(c.req.query("limit")) || 20, 100);
    const offset = (page - 1) * limit;
    const tableName = c.req.query("table");
    const action = c.req.query("action");
    const from = c.req.query("from");
    const to = c.req.query("to");

    const { auditLog } = await import("../../db/schema.js");

    // 构建条件
    const conditions: ReturnType<typeof sql>[] = [];

    if (tableName) {
      conditions.push(sql`${auditLog.tableName} = ${tableName}`);
    }
    if (action && ["INSERT", "UPDATE", "DELETE"].includes(action)) {
      conditions.push(sql`${auditLog.action} = ${action}`);
    }
    if (from) {
      conditions.push(sql`${auditLog.changedAt} >= ${from}`);
    }
    if (to) {
      conditions.push(sql`${auditLog.changedAt} <= ${to}`);
    }

    const where = conditions.length > 0
      ? sql`${sql.join(conditions, sql` AND `)}`
      : undefined;

    // 查询总数
    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(where);

    const total = countResult[0]?.count ?? 0;

    // 查询数据
    const rows = await db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(sql`${auditLog.changedAt} DESC`)
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
    return c.json({ error: `审计日志查询失败: ${String(e)}` }, 500);
  }
});

// ---- 子路由 ----

adminRoute.route("/source-segments", sourceSegmentsAdminRoute);
adminRoute.route("/personas", personasAdminRoute);
adminRoute.route("/respondents", respondentsAdminRoute);
adminRoute.route("/kol-profiles", kolProfilesAdminRoute);
adminRoute.route("/kol-segments", kolSegmentsAdminRoute);
adminRoute.route("/chat-sessions", chatSessionsAdminRoute);
adminRoute.route("/kol-chat-sessions", kolChatSessionsAdminRoute);