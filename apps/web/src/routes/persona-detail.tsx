// 画像详情页面
import type { PersonaDetail } from "@app/shared";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "../lib/api.js";

export function PersonaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [persona, setPersona] = useState<PersonaDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    api
      .getPersona(Number(id))
      .then(setPersona)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading)
    return <div className="py-8 text-center text-[--color-muted-foreground]">加载中...</div>;
  if (!persona)
    return <div className="py-8 text-center text-[--color-muted-foreground]">画像不存在</div>;

  return (
    <div className="space-y-6">
      <Link
        to="/personas"
        className="inline-flex items-center gap-1 text-sm text-[--color-muted-foreground] hover:text-[--color-primary]"
      >
        <ArrowLeft className="h-3 w-3" /> 返回画像列表
      </Link>

      <div>
        <h1 className="font-serif text-3xl font-bold text-[--color-primary]">{persona.name}</h1>
        <p className="text-[--color-muted-foreground] mt-1">{persona.description}</p>
      </div>

      {/* Tags */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">特征标签</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.entries(persona.tagSpec).map(([dim, val]) => {
              const vals = Array.isArray(val) ? val : [val];
              return vals.map((v) => (
                <Badge key={`${dim}-${v}`}>
                  {dim}: {v}
                </Badge>
              ));
            })}
          </div>
          <p className="text-xs text-[--color-muted-foreground] mt-3">
            基于 {persona.sampleCount} 个真实用户样本 · 聚类 {persona.clusterId ?? "未知"}
          </p>
        </CardContent>
      </Card>

      {/* Motivation Chain */}
      {persona.motivationChain && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">动机因果链</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(persona.motivationChain as Record<string, string>).map(([key, val]) => (
              <div key={key} className="text-sm">
                <span className="font-medium text-[--color-primary]">{key.replace("_", " ")}</span>
                <span className="text-[--color-muted-foreground]"> — {val}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Evidence */}
      {persona.evidenceList.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">
              代表性原声（{persona.evidenceList.length} 条）
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {persona.evidenceList.map((e) => (
              <blockquote
                key={e.id}
                className="border-l-2 border-[--color-primary] pl-3 py-1 text-sm text-[--color-muted-foreground]"
              >
                {e.originalText.slice(0, 200)}
                {e.originalText.length > 200 ? "..." : ""}
                <footer className="text-xs mt-1 text-[--color-muted-foreground]/70">
                  — {e.sourceFile}
                </footer>
              </blockquote>
            ))}
          </CardContent>
        </Card>
      )}

      <Link to={`/personas/${persona.id}/chat`}>
        <Button size="lg" className="w-full sm:w-auto">
          <MessageCircle className="h-4 w-4 mr-2" />
          与「{persona.name}」开始对话
        </Button>
      </Link>
    </div>
  );
}
