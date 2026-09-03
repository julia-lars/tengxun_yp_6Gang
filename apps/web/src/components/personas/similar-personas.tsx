// 相似画像推荐 — 基于标签 Jaccard 相似度
import type { PersonaSummary } from "@app/shared";
import { ArrowRight, Users } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { extractTopTags } from "@/lib/tag-display";
import { cn } from "@/lib/utils";

interface SimilarPersonasProps {
  currentId: number;
  personas: PersonaSummary[];
  className?: string;
}

/** 提取 tagSpec 中所有标签值（扁平化） */
function getAllTagValues(spec: Record<string, string | string[]>): string[] {
  const vals: string[] = [];
  for (const val of Object.values(spec)) {
    if (Array.isArray(val)) vals.push(...val);
    else vals.push(val);
  }
  return vals;
}

/** Jaccard 相似度：|A ∩ B| / |A ∪ B| */
function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

export function SimilarPersonas({ currentId, personas, className }: SimilarPersonasProps) {
  const currentPersona = personas.find((p) => p.id === currentId);
  if (!currentPersona || personas.length <= 1) return null;

  const currentTags = currentPersona.tagSpec as Record<string, string | string[]>;

  // 计算所有画像的相似度，排除自身
  const scored = personas
    .filter((p) => p.id !== currentId)
    .map((p) => {
      const otherTags = (p.tagSpec as Record<string, string | string[]>) ?? {};
      const sim = jaccardSimilarity(
        getAllTagValues(currentTags),
        getAllTagValues(otherTags),
      );
      return { persona: p, similarity: sim };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 4);

  if (scored.length === 0) return null;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">相似画像</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-3 overflow-x-auto scrollbar-hide py-1 -mx-1 px-1">
          {scored.map(({ persona, similarity }) => {
            const spec = persona.tagSpec as Record<string, string | string[]>;
            const topTags = extractTopTags(spec, 3);
            const pct = Math.round(similarity * 100);

            return (
              <Link
                key={persona.id}
                to={`/personas/${persona.id}`}
                className="flex-shrink-0 w-44 group"
              >
                <div
                  className={cn(
                    "border border-(--color-border) rounded-lg p-3 h-full",
                    "transition-all duration-200",
                    "hover:border-(--color-brand-300) hover:shadow-sm hover:-translate-y-0.5",
                  )}
                >
                  {/* 相似度 */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 text-(--color-brand-400)" />
                      <span className="text-xs font-medium text-(--color-content-primary) truncate max-w-[100px]">
                        {persona.name}
                      </span>
                    </div>
                    <span
                      className={cn(
                        "text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
                        pct >= 70
                          ? "bg-green-50 text-green-700"
                          : pct >= 40
                            ? "bg-amber-50 text-amber-700"
                            : "bg-neutral-100 text-neutral-600",
                      )}
                    >
                      {pct}%
                    </span>
                  </div>

                  {/* 标签 */}
                  <div className="flex flex-wrap gap-1 mb-2">
                    {topTags.map((t) => (
                      <Badge
                        key={`${t.dim}-${t.value}`}
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0"
                      >
                        {t.value}
                      </Badge>
                    ))}
                  </div>

                  {/* 跳转箭头 */}
                  <div className="flex items-center gap-1 text-[10px] text-(--color-content-tertiary) group-hover:text-(--color-brand-500) transition-colors">
                    查看详情
                    <ArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}