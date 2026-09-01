import { db } from "../src/db/client.js";
import { personas, sourceSegments } from "../src/db/schema.js";
import { sql } from "drizzle-orm";

const persona = await db.query.personas.findFirst();
console.log("=== Persona tagSpec ===");
console.log(JSON.stringify(persona?.tagSpec, null, 2));

const segments = await db.select({
  id: sourceSegments.id,
  annotation: sourceSegments.annotation,
})
  .from(sourceSegments)
  .where(sql`${sourceSegments.annotation} IS NOT NULL`)
  .limit(2);

console.log("\n=== Evidence annotations ===");
for (const seg of segments) {
  console.log(JSON.stringify(seg.annotation, null, 2));
  console.log("---");
}
// 再取一个有丰富标签的 segment
import { eq } from "drizzle-orm";
const richSegment = await db.query.sourceSegments.findFirst({
  where: sql`${sourceSegments.annotation} IS NOT NULL AND (${sourceSegments.annotation}->'iceberg'->'M1_motivation' IS NOT NULL AND jsonb_array_length(${sourceSegments.annotation}->'iceberg'->'M1_motivation') > 0)`,
});
if (richSegment) {
  console.log("\n=== Rich annotation ===");
  console.log(JSON.stringify(richSegment.annotation, null, 2));
}

// 再取几个不同 persona 的 tagSpec
const allPersonas = await db.select({ name: personas.name, tagSpec: personas.tagSpec })
  .from(personas)
  .limit(5);
console.log("\n=== All persona tagSpecs ===");
for (const p of allPersonas) {
  console.log(p.name, ":", JSON.stringify(p.tagSpec));
}
