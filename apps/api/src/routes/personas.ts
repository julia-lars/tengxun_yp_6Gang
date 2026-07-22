// --------------------------------------------------------------
// 标签 + 画像 路由
// --------------------------------------------------------------

import type { PersonaDetail, PersonaSummary, TagDimension } from "@app/shared";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import { db } from "../db/client.js";
import { personas, sourceSegments } from "../db/schema.js";

export const personasRoute = new Hono();

// ---- 标签维度 ----

// 初期硬编码，后续可从配置表读取
const TAG_DIMENSIONS: TagDimension[] = [
  {
    name: "诉求",
    label: "游戏诉求",
    values: [
      { value: "竞技证明", label: "竞技证明" },
      { value: "社交归属", label: "社交归属" },
      { value: "放松逃避", label: "放松/逃避" },
      { value: "探索收集", label: "探索/收集" },
      { value: "角色沉浸", label: "角色沉浸" },
    ],
  },
  {
    name: "能力",
    label: "游戏能力",
    values: [
      { value: "新手", label: "新手" },
      { value: "进阶", label: "进阶" },
      { value: "高手", label: "高手" },
      { value: "职业级", label: "职业级" },
    ],
  },
  {
    name: "风格",
    label: "游戏风格",
    values: [
      { value: "主动求战刚枪", label: "主动求战/刚枪" },
      { value: "苟活避战", label: "苟活避战" },
      { value: "本能快速反应", label: "本能快速反应" },
      { value: "仔细思考决策", label: "仔细思考/决策" },
      { value: "个人能力取胜", label: "个人能力取胜" },
      { value: "团队协作取胜", label: "团队协作取胜" },
    ],
  },
  {
    name: "平台",
    label: "平台偏好",
    values: [
      { value: "PC端", label: "PC端" },
      { value: "主机端", label: "主机端" },
      { value: "手游端", label: "手游端" },
    ],
  },
  {
    name: "模式",
    label: "游戏模式",
    values: [
      { value: "PVP为主", label: "PVP为主" },
      { value: "PVE为主", label: "PVE为主" },
      { value: "PVP+PVE", label: "PVP+PVE都玩" },
    ],
  },
];


// ---- 画像 ----

// GET /api/personas
personasRoute.get("/", async (c) => {
  const tagsParam = c.req.query("tags");

  let query = db.select().from(personas).orderBy(sql`${personas.sampleCount} DESC`);

  const rows = await query;

  // 如果有标签筛选，做简单的 jsonb 匹配
  let filtered = rows;
  if (tagsParam) {
    const tags = tagsParam.split(",").map((t) => t.trim()).filter(Boolean);
    filtered = rows.filter((row) => {
      const spec = row.tagSpec as Record<string, unknown>;
      return tags.every((tag) => JSON.stringify(spec).includes(tag));
    });
  }

  const result: PersonaSummary[] = filtered.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    tagSpec: r.tagSpec as Record<string, string | string[]>,
    sampleCount: r.sampleCount ?? 0,
    createdAt: r.createdAt.toISOString(),
  }));

  return c.json(result);
});

// GET /api/personas/:id
personasRoute.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "无效的 ID" }, 400);

  const row = await db.query.personas.findFirst({
    where: eq(personas.id, id),
  });

  if (!row) return c.json({ error: "画像不存在" }, 404);

  // 获取关联证据
  const evidenceIds = (row.evidenceIds ?? []) as number[];
  let evidenceList: Array<{
    id: number;
    sourceFile: string;
    originalText: string;
    annotation: Record<string, unknown> | null;
  }> = [];

  if (evidenceIds.length > 0) {
    const evidenceRows = await db
      .select({
        id: sourceSegments.id,
        sourceFile: sourceSegments.sourceFile,
        originalText: sourceSegments.originalText,
        annotation: sourceSegments.annotation,
      })
      .from(sourceSegments)
      .where(sql`${sourceSegments.id} = ANY(${evidenceIds})`)
      .limit(10);

    evidenceList = evidenceRows.map((e) => ({
      id: e.id,
      sourceFile: e.sourceFile,
      originalText: e.originalText,
      annotation: (e.annotation as Record<string, unknown>) ?? null,
    }));
  }

  const result: PersonaDetail = {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    tagSpec: row.tagSpec as Record<string, string | string[]>,
    sampleCount: row.sampleCount ?? 0,
    createdAt: row.createdAt.toISOString(),
    motivationChain: (row.motivationChain as Record<string, unknown>) ?? null,
    clusterId: row.clusterId,
    evidenceList,
  };

  return c.json(result);
});
