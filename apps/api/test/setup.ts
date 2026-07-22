// --------------------------------------------------------------
// apps/api 测试环境 setup
// - 起 in-memory pglite（WASM Postgres）
// - 跑 migration 建表（跳过 pgvector 相关的）
// - pglite 不支持 pgvector，测试中不验证向量检索功能
// --------------------------------------------------------------

import path from "node:path";
import { existsSync, mkdirSync, readdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach } from "vitest";
import * as schema from "../src/db/schema.js";
import { setTestDb } from "../src/db/client.js";

const pg = new PGlite();
export const testDb = drizzle(pg, { schema });

const here = path.dirname(fileURLToPath(import.meta.url));
const realFolder = path.resolve(here, "../drizzle");
const testFolder = path.resolve(here, "../drizzle-test");

beforeAll(async () => {
  // 从真实 migration 目录复制可用的 migration 到测试目录
  // 排除包含 pgvector 的 migration（pglite 不支持）
  if (!existsSync(testFolder)) mkdirSync(testFolder, { recursive: true });
  const metaDest = path.join(testFolder, "meta");
  if (!existsSync(metaDest)) mkdirSync(metaDest, { recursive: true });

  const sqlFiles = readdirSync(realFolder)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // 只复制 0000（原始教程表），跳过 0001/0002（新业务表含 vector）
  const skippedTags: string[] = [];
  for (const f of sqlFiles) {
    if (f.includes("0001") || f.includes("0002")) {
      skippedTags.push(f.replace(".sql", ""));
      continue;
    }
    copyFileSync(path.join(realFolder, f), path.join(testFolder, f));
  }

  // 复制 journal，但排除跳过的 migration
  const journalSrc = path.join(realFolder, "meta", "_journal.json");
  if (existsSync(journalSrc)) {
    const journal = JSON.parse(readFileSync(journalSrc, "utf-8"));
    journal.entries = journal.entries.filter(
      (e: { tag: string }) => !skippedTags.includes(e.tag),
    );
    writeFileSync(path.join(metaDest, "_journal.json"), JSON.stringify(journal, null, 2));
  }

  await migrate(testDb, { migrationsFolder: testFolder });
  setTestDb(testDb as unknown as Parameters<typeof setTestDb>[0]);
});

beforeEach(async () => {
  await testDb.execute(
    "TRUNCATE demo_events, sections, chapters, courses RESTART IDENTITY CASCADE",
  );
});

afterAll(async () => {
  await pg.close();
});
