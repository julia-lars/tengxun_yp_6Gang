// --------------------------------------------------------------
// kol_segments 管理 CRUD
// --------------------------------------------------------------

import { Hono } from "hono";

import { createCrudRoutes } from "../../lib/admin-crud.js";
import { kolSegments } from "../../db/schema.js";

const route = new Hono();

// CRUD 路由
route.route("/", createCrudRoutes({
  table: kolSegments,
  tableName: "kol_segments",
  searchableFields: ["title", "original_text", "bvid"],
  filterableFields: ["kol_id", "bvid", "ad_label"],
  sortableFields: ["id", "kol_id", "created_at"],
  editableFields: [
    "kol_id",
    "bvid",
    "title",
    "original_text",
    "source_url",
    "ad_label",
  ],
  requiredFields: ["kol_id", "bvid", "title", "original_text"],
  jsonbFields: [],
  arrayFields: [],
  maxLimit: 100,
}));

export { route as kolSegmentsAdminRoute };