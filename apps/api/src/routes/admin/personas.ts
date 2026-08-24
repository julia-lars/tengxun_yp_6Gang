// --------------------------------------------------------------
// personas 管理 CRUD
// --------------------------------------------------------------

import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import { createCrudRoutes } from "../../lib/admin-crud.js";
import { personas, chatSessions } from "../../db/schema.js";
import { db } from "../../db/client.js";

const route = new Hono();

// CRUD 路由
route.route("/", createCrudRoutes({
  table: personas,
  tableName: "personas",
  searchableFields: ["name", "description"],
  filterableFields: ["cluster_id"],
  sortableFields: ["id", "name", "sample_count", "created_at"],
  editableFields: [
    "name",
    "description",
    "tag_spec",
    "motivation_chain",
    "evidence_ids",
    "cluster_id",
    "sample_count",
  ],
  requiredFields: ["name", "tag_spec"],
  jsonbFields: ["tag_spec", "motivation_chain"],
  arrayFields: ["evidence_ids"],
  maxLimit: 50,
  onBeforeDelete: async (id) => {
    // 检查是否有对话记录
    const sessions = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(eq(chatSessions.personaId, id))
      .limit(1);

    if (sessions.length > 0) {
      return {
        allowed: false,
        reason: "此画像存在对话记录，无法删除。请先删除关联的对话记录。",
      };
    }
    return { allowed: true };
  },
}));

export { route as personasAdminRoute };