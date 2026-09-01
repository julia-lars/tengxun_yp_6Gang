// --------------------------------------------------------------
// chat_sessions 只读管理（对话记录不可手动编辑，仅查看和删除）
// --------------------------------------------------------------

import { Hono } from "hono";

import { createCrudRoutes } from "../../lib/admin-crud.js";
import { chatSessions } from "../../db/schema.js";

const route = new Hono();

// 只读 CRUD：仅 GET 列表、GET 详情、DELETE
route.route("/", createCrudRoutes({
  table: chatSessions,
  tableName: "chat_sessions",
  searchableFields: ["title"],
  filterableFields: ["persona_id"],
  sortableFields: ["id", "persona_id", "created_at", "updated_at"],
  editableFields: [], // 不可编辑，但保留字段声明
  requiredFields: [],
  jsonbFields: [],
  arrayFields: [],
  maxLimit: 50,
  readOnly: true, // 对话记录由系统自动生成，不开放手动创建/编辑
}));

export { route as chatSessionsAdminRoute };