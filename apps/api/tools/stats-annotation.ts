import { db } from "../src/db/client.js";
import { sourceSegments } from "../src/db/schema.js";
import { sql } from "drizzle-orm";

// 统计 annotation 中 framework 各字段的有效率
const segments = await db.select({
  annotation: sourceSegments.annotation,
})
  .from(sourceSegments)
  .where(sql`${sourceSegments.annotation} IS NOT NULL`)
  .limit(100);

let total = 0;
let needsPrimary = 0;
let abilityLevel = 0;
let styleCombat = 0;
let platformPrimary = 0;
let modeStructure = 0;
let m1Motivation = 0;

for (const seg of segments) {
  const ann = seg.annotation as Record<string, unknown> | null;
  if (!ann) continue;
  total++;

  const fw = ann.framework as Record<string, unknown> | undefined;
  if (fw) {
    const needs = fw.needs as Record<string, unknown> | undefined;
    if (needs?.primary && needs.primary !== "unknown" && needs.primary !== null) needsPrimary++;
    const ability = fw.ability as Record<string, unknown> | undefined;
    const lvl = (ability?.level ?? ability?.lvl) as string | undefined;
    if (lvl && lvl !== "unknown") abilityLevel++;
    const style = fw.style as Record<string, unknown> | undefined;
    if (style?.combat && style.combat !== "unknown") styleCombat++;
    const platform = fw.platform as Record<string, unknown> | undefined;
    const p = (platform?.primary ?? platform?.p) as string | undefined;
    if (p && p !== "unknown") platformPrimary++;
    const mode = fw.mode as Record<string, unknown> | undefined;
    const s = (mode?.structure ?? mode?.struct) as string | undefined;
    if (s && s !== "unknown") modeStructure++;
  }

  const iceberg = ann.iceberg as Record<string, unknown> | undefined;
  if (iceberg) {
    const m1 = (iceberg.M1_motivation ?? iceberg.M1) as Array<unknown> | undefined;
    if (Array.isArray(m1) && m1.length > 0) m1Motivation++;
  }
}

console.log(`Total annotations: ${total}`);
console.log(`framework.needs.primary 有效: ${needsPrimary} (${(needsPrimary/total*100).toFixed(1)}%)`);
console.log(`framework.ability.level 有效: ${abilityLevel} (${(abilityLevel/total*100).toFixed(1)}%)`);
console.log(`framework.style.combat 有效: ${styleCombat} (${(styleCombat/total*100).toFixed(1)}%)`);
console.log(`framework.platform.primary 有效: ${platformPrimary} (${(platformPrimary/total*100).toFixed(1)}%)`);
console.log(`framework.mode.structure 有效: ${modeStructure} (${(modeStructure/total*100).toFixed(1)}%)`);
console.log(`iceberg.M1_motivation 有值: ${m1Motivation} (${(m1Motivation/total*100).toFixed(1)}%)`);