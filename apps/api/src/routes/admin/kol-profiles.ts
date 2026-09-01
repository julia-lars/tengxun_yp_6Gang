// --------------------------------------------------------------
// kol_profiles 管理 CRUD
// --------------------------------------------------------------

import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { createCrudRoutes } from "../../lib/admin-crud.js";
import { kolProfiles, kolSegments, kolChatSessions } from "../../db/schema.js";
import { db } from "../../db/client.js";

const route = new Hono();

// CRUD 路由
route.route("/", createCrudRoutes({
  table: kolProfiles,
  tableName: "kol_profiles",
  searchableFields: ["name", "bilibili_uid"],
  filterableFields: ["bilibili_uid"],
  sortableFields: ["id", "name", "created_at"],
  editableFields: [
    "name",
    "bilibili_uid",
    "persona_card",
    "style_profile",
    "source_texts",
  ],
  requiredFields: ["name", "persona_card", "style_profile"],
  jsonbFields: ["persona_card", "style_profile"],
  arrayFields: ["source_texts"],
  maxLimit: 50,
  onBeforeDelete: async (id) => {
    // 检查是否有关联的语料片段
    const segments = await db
      .select({ id: kolSegments.id })
      .from(kolSegments)
      .where(eq(kolSegments.kolId, id))
      .limit(1);

    if (segments.length > 0) {
      return {
        allowed: false,
        reason: "此 KOL 存在关联语料片段，请先删除语料后再删除 KOL 画像。",
      };
    }

    // 检查是否有关联的对话记录
    const sessions = await db
      .select({ id: kolChatSessions.id })
      .from(kolChatSessions)
      .where(eq(kolChatSessions.kolId, id))
      .limit(1);

    if (sessions.length > 0) {
      return {
        allowed: false,
        reason: "此 KOL 存在关联对话记录，请先删除对话记录后再删除 KOL 画像。",
      };
    }

    return { allowed: true };
  },
}));

export { route as kolProfilesAdminRoute };