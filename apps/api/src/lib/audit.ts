// --------------------------------------------------------------
// 审计日志 — 记录所有手动 CRUD 操作，用于数据追溯
// --------------------------------------------------------------

import { eq, and, desc } from "drizzle-orm";

import { db, schema } from "../db/client.js";

export type AuditAction = "INSERT" | "UPDATE" | "DELETE";

export interface AuditEntry {
  tableName: string;
  recordId: number;
  action: AuditAction;
  changedBy?: string;
  oldData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
}

/**
 * 记录一条审计日志。所有管理端 CUD 操作都应调用此函数。
 */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(schema.auditLog).values({
      tableName: entry.tableName,
      recordId: entry.recordId,
      action: entry.action,
      changedBy: entry.changedBy ?? "admin",
      oldData: entry.oldData ?? null,
      newData: entry.newData ?? null,
    });
  } catch (e) {
    // 审计日志写入失败不应阻塞主流程
    console.error("[audit] 写入审计日志失败:", e);
  }
}

/**
 * 查询某条记录的变更历史
 */
export async function getRecordHistory(
  tableName: string,
  recordId: number,
): Promise<typeof schema.auditLog.$inferSelect[]> {
  return db
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.tableName, tableName),
        eq(schema.auditLog.recordId, recordId),
      ),
    )
    .orderBy(desc(schema.auditLog.changedAt))
    .limit(50);
}