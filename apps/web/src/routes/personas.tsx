// 标签选择器 + 画像列表页面
import type { PersonaSummary } from "@app/shared";
import { Filter, MessageCircle, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "../lib/api.js";

export function PersonasPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const selectedTags = searchParams.get("tags") ?? "";

  useEffect(() => {
    api.listPersonas(selectedTags).then(setPersonas).finally(() => setLoading(false));
  }, [selectedTags]);

  const allTags = [
    { dim: "诉求", options: ["竞技证明", "社交归属", "放松逃避", "探索收集"] },
    { dim: "能力", options: ["新手", "进阶", "高手", "职业级"] },
    { dim: "风格", options: ["主动求战", "苟活避战", "团队协作", "个人能力"] },
    { dim: "平台", options: ["PC端", "主机端", "手游端"] },
    { dim: "模式", options: ["PVP为主", "PVE为主", "PVP+PVE"] },
  ];

  const activeTags = selectedTags ? selectedTags.split(",") : [];

  function toggleTag(tag: string) {
    const current = new Set(activeTags);
    current.has(tag) ? current.delete(tag) : current.add(tag);
    const next = Array.from(current).join(",");
    setSearchParams(next ? { tags: next } : {});
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-bold text-[--color-primary]">
          选择目标用户
        </h1>
        <p className="text-[--color-muted-foreground] mt-1">
          从以下维度选择特征标签，匹配对应的模拟用户画像
        </p>
      </div>

      {/* Tag Selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-4 w-4" />
            特征标签
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {allTags.map(({ dim, options }) => (
            <div key={dim}>
              <p className="text-sm font-medium text-[--color-muted-foreground] mb-2">{dim}</p>
              <div className="flex flex-wrap gap-2">
                {options.map((tag) => {
                  const isActive = activeTags.includes(tag);
                  return (
                    <Badge
                      key={tag}
                      variant={isActive ? "default" : "outline"}
                      className="cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => toggleTag(tag)}
                    >
                      {tag}
                    </Badge>
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Matched Personas */}
      <div>
        <p className="text-sm text-[--color-muted-foreground] mb-3">
          {loading ? "匹配中..." : `匹配到 ${personas.length} 个画像`}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {personas.map((p) => (
            <Link key={p.id} to={`/personas/${p.id}`} className="block group">
              <Card className="h-full transition-all hover:border-[--color-primary] hover:shadow-md">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg font-serif text-[--color-primary] flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    {p.name}
                  </CardTitle>
                  <CardDescription className="line-clamp-2">{p.description}</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(p.tagSpec).map(([dim, val]) => {
                      const vals = Array.isArray(val) ? val : [val];
                      return vals.map((v) => (
                        <Badge key={`${dim}-${v}`} variant="secondary" className="text-xs">
                          {v}
                        </Badge>
                      ));
                    })}
                  </div>
                  <p className="text-xs text-[--color-muted-foreground] mt-2">
                    基于 {p.sampleCount} 个样本
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
          {!loading && personas.length === 0 && (
            <p className="text-[--color-muted-foreground] col-span-2 text-center py-8">
              没有匹配的画像，试试调整标签组合
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// Persona Detail Page
export { PersonaDetailPage } from "./persona-detail.js";
