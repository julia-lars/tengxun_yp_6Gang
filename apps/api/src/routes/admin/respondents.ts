// --------------------------------------------------------------
// respondents 管理 CRUD
// --------------------------------------------------------------

import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import { createCrudRoutes } from "../../lib/admin-crud.js";
import { respondents, sourceSegments } from "../../db/schema.js";
import { db } from "../../db/client.js";

const PROFILE_DIR = "../../../../data/群体画像v2.0_profile/";

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

// 从 profile 文件补充受访者背景信息
route.get("/background", async (c) => {
  try {
    const sourceFile = c.req.query("source_file");
    const speakerId = c.req.query("speaker_id");
    if (!sourceFile || !speakerId) {
      return c.json({ error: "缺少 source_file 或 speaker_id 参数" }, 400);
    }

    // 遍历 profile 目录
    const dir = Bun.file(PROFILE_DIR);
    // Bun.file 对目录不可用，改用 glob
    const glob = new Bun.Glob("*_profiles.json");
    const files = Array.from(glob.scanSync(PROFILE_DIR));

    for (const fileName of files) {
      const file = Bun.file(`${PROFILE_DIR}${fileName}`);
      const text = await file.text();
      let profiles: unknown;
      try {
        profiles = JSON.parse(text);
      } catch {
        continue;
      }
      if (!Array.isArray(profiles)) continue;

      for (const p of profiles) {
        if (
          typeof p === "object" &&
          p !== null &&
          (p as Record<string, unknown>).respondent_id === speakerId
        ) {
          const metadata = (p as Record<string, unknown>).metadata as
            | Record<string, unknown>
            | undefined;
          if (!metadata) continue;

          const demographics = metadata.demographics as
            | Record<string, unknown>
            | undefined;
          const gamingBackground = metadata.gaming_background as
            | Record<string, unknown>
            | undefined;

          return c.json({
            data: {
              demographics: demographics ?? null,
              gaming_background: gamingBackground ?? null,
            },
          });
        }
      }
    }

    return c.json({ data: null }, 404);
  } catch (e) {
    return c.json({ error: `查询失败: ${String(e)}` }, 500);
  }
});

export { route as respondentsAdminRoute };