// --------------------------------------------------------------
// 种子脚本：导入 source_segments 和 respondents 数据
// 数据来源：data/annotated/ (segments) + data/群体画像v2.0_merged/ (respondents)
//
// 运行: bun run apps/api/src/db/seed-data.ts
// 重灌: bun run apps/api/src/db/seed-data.ts --force
// --------------------------------------------------------------

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "./client.js";
import { sourceSegments, respondents } from "./schema.js";
import { sql } from "drizzle-orm";

const DATA_ANNOTATED = join(import.meta.dirname, "../../../../data/annotated");
const DATA_MERGED = join(import.meta.dirname, "../../../../data/群体画像v2.0_merged");

interface SegmentRow {
  source_file: string;
  segment_index: number;
  speaker_id: string;
  speaker_role: string;
  preceding_question: string | null;
  original_text: string;
  cleaned_text: string | null;
  char_count: number | null;
  annotation: Record<string, unknown> | null;
}

interface RespondentRow {
  source_file: string;
  speaker_id: string;
  display_name: string | null;
  group_code: string | null;
  background: Record<string, unknown> | null;
}

async function seedSourceSegments(force: boolean) {
  // 检查是否已有数据
  if (!force) {
    const existing = await db.select({ count: sql<number>`count(*)::int` }).from(sourceSegments);
    if ((existing[0]?.count ?? 0) > 0) {
      console.log(`  source_segments 已有 ${existing[0]!.count} 条，跳过（--force 强制重灌）`);
      return;
    }
  }

  if (force) {
    console.log("  --force: 清空 source_segments...");
    await db.delete(sourceSegments);
  }

  // 读取 annotated 目录
  let files: string[];
  try {
    files = (await readdir(DATA_ANNOTATED)).filter((f) => f.endsWith(".json"));
  } catch {
    console.log(`  ⚠ 未找到 annotated 数据目录: ${DATA_ANNOTATED}`);
    return;
  }

  console.log(`  找到 ${files.length} 个 annotated JSON 文件`);

  let totalInserted = 0;
  for (const file of files) {
    const filePath = join(DATA_ANNOTATED, file);
    try {
      const raw = await readFile(filePath, "utf-8");
      const data = JSON.parse(raw);
      const rows: Record<string, unknown>[] = Array.isArray(data) ? data : [data];

      const segments: SegmentRow[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] as Record<string, unknown>;
        if (!row) continue;

        const sourceFile = String(row.source_file ?? "");
        const originalText = String(row.original_text ?? "");
        if (!sourceFile || !originalText) continue;

        segments.push({
          source_file: sourceFile,
          segment_index: typeof row.segment_index === "number" ? row.segment_index : i,
          speaker_id: row.speaker_id ? String(row.speaker_id) : "unknown",
          speaker_role: row.speaker_role === "moderator" ? "moderator" : "interviewee",
          preceding_question: row.preceding_question ? String(row.preceding_question) : null,
          original_text: originalText,
          cleaned_text: row.cleaned_text ? String(row.cleaned_text) : null,
          char_count: row.char_count ? Number(row.char_count) : null,
          annotation: (row.annotation as Record<string, unknown>) ?? null,
        });
      }

      if (segments.length > 0) {
        // 批量插入
        await db.insert(sourceSegments).values(segments as any);
        totalInserted += segments.length;
      }
    } catch (e) {
      console.log(`  ⚠ 处理文件 ${file} 失败: ${String(e)}`);
    }
  }

  console.log(`  ✅ source_segments: 插入 ${totalInserted} 条`);
}

async function seedRespondents(force: boolean) {
  // 检查是否已有数据
  if (!force) {
    const existing = await db.select({ count: sql<number>`count(*)::int` }).from(respondents);
    if ((existing[0]?.count ?? 0) > 0) {
      console.log(`  respondents 已有 ${existing[0]!.count} 条，跳过（--force 强制重灌）`);
      return;
    }
  }

  if (force) {
    console.log("  --force: 清空 respondents...");
    await db.delete(respondents);
  }

  // 读取 merged 目录
  let files: string[];
  try {
    files = (await readdir(DATA_MERGED)).filter((f) => f.endsWith(".json"));
  } catch {
    console.log(`  ⚠ 未找到 merged 数据目录: ${DATA_MERGED}`);
    return;
  }

  console.log(`  找到 ${files.length} 个 merged JSON 文件`);

  let totalInserted = 0;
  const seen = new Set<string>();

  for (const file of files) {
    const filePath = join(DATA_MERGED, file);
    try {
      const raw = await readFile(filePath, "utf-8");
      const data = JSON.parse(raw);
      const respondentList: Record<string, unknown>[] = data.respondents ?? [];

      const respRows: RespondentRow[] = [];
      for (const r of respondentList) {
        const sourceFile = String(r.source_file ?? "");
        const speakerId = String(r.speaker_id ?? "");
        if (!sourceFile || !speakerId) continue;

        const key = `${sourceFile}::${speakerId}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // 构建 background
        const background: Record<string, unknown> = {};
        if (r.profile) background.profile = r.profile;
        if (r.gaming_background) background.gaming_background = r.gaming_background;
        if (r.background && typeof r.background === "object" && Object.keys(r.background as object).length > 0) {
          Object.assign(background, r.background as Record<string, unknown>);
        }

        respRows.push({
          source_file: sourceFile,
          speaker_id: speakerId,
          display_name: r.display_name ? String(r.display_name) : null,
          group_code: r.group_code ? String(r.group_code) : null,
          background: Object.keys(background).length > 0 ? background : null,
        });
      }

      if (respRows.length > 0) {
        await db.insert(respondents).values(respRows as any);
        totalInserted += respRows.length;
      }
    } catch (e) {
      console.log(`  ⚠ 处理文件 ${file} 失败: ${String(e)}`);
    }
  }

  console.log(`  ✅ respondents: 插入 ${totalInserted} 条`);
}

async function main() {
  const force = process.argv.includes("--force");

  console.log(force ? "🌱 --force 模式：清空并重灌数据" : "📥 增量导入数据（已有数据则跳过）");
  console.log();

  await seedSourceSegments(force);
  console.log();
  await seedRespondents(force);

  console.log();
  console.log("✅ 数据导入完成");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ 数据导入失败：", err);
  process.exit(1);
});