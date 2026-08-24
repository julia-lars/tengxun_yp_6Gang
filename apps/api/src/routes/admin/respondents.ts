// --------------------------------------------------------------
// respondents 管理 CRUD
// --------------------------------------------------------------

import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import { createCrudRoutes } from "../../lib/admin-crud.js";
import { respondents, sourceSegments } from "../../db/schema.js";
import { db } from "../../db/client.js";

const route = new Hono();

// CRUD 路由
route.route("/", createCrudRoutes({
  table: respondents,
  tableName: "respondents",
  searchableFields: ["source_file", "speaker_id", "display_name", "group_code"],
  filterableFields: ["source_file", "group_code"],
  sortableFields: ["id", "source_file", "speaker_id", "display_name", "created_at"],
  editableFields: [
    "source_file",
    "speaker_id",
    "display_name",
    "group_code",
    "background",
  ],
  requiredFields: ["source_file", "speaker_id"],
  jsonbFields: ["background"],
  arrayFields: [],
  maxLimit: 50,
  onBeforeDelete: async (id) => {
    // 检查是否有关联的 segments
    const respondent = await db
      .select({ sourceFile: respondents.sourceFile, speakerId: respondents.speakerId })
      .from(respondents)
      .where(eq(respondents.id, id))
      .limit(1);

    if (respondent.length > 0) {
      const r = respondent[0]!;
      const segments = await db
        .select({ id: sourceSegments.id })
        .from(sourceSegments)
        .where(
          sql`${sourceSegments.sourceFile} = ${r.sourceFile} AND ${sourceSegments.speakerId} = ${r.speakerId}`,
        )
        .limit(1);

      if (segments.length > 0) {
        return {
          allowed: false,
          reason: "此受访者存在关联的发言片段，无法删除。请先删除关联的片段。",
        };
      }
    }
    return { allowed: true };
  },
}));

export { route as respondentsAdminRoute };