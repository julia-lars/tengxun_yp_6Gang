// PersonaCard — 画像卡片组件（样式对齐 KOL 分身卡片）
import type { PersonaSummary } from "@app/shared";
import { ArrowRight, MessageCircle, Users } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { extractTopTags } from "@/lib/tag-display";

interface PersonaCardProps {
  persona: PersonaSummary;
}

export function PersonaCard({ persona }: PersonaCardProps) {
  const spec = persona.tagSpec as Record<string, string | string[]>;
  const topTags = extractTopTags(spec, 5);

  return (
    <Card className="h-full group transition-all duration-200 hover:border-(--color-brand-300) hover:shadow-md hover:-translate-y-0.5">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-(--color-brand-50) flex items-center justify-center flex-shrink-0">
            <Users className="h-5 w-5 text-(--color-brand-500)" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-lg font-serif text-black group-hover:text-(--color-brand-500) transition-colors">{persona.name}</CardTitle>
            <CardDescription className="text-xs text-(--color-content-tertiary)">
              基于 {persona.sampleCount} 个样本
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-(--color-content-secondary) text-clamp-2">
          {persona.description}
        </p>

        {/* 特征标签 — 5 个维度标签 + 折叠计数 */}
        {topTags.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-(--color-content-tertiary) font-medium">特征标签</p>
            <div className="flex flex-wrap gap-1">
              {topTags.map(({ dim, value }) => (
                <Badge
                  key={`${dim}-${value}`}
                  variant="secondary"
                  className="text-[10px]"
                >
                  {value}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="group/view font-normal text-(--color-foreground) hover:border-(--color-brand-500) hover:bg-transparent hover:text-(--color-brand-600)"
          >
            <Link to={`/personas/${persona.id}`}>
              查看画像
              <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover/view:translate-x-0.5" />
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link to={`/personas/${persona.id}/chat`}>
              <MessageCircle className="h-3.5 w-3.5 mr-1" />
              开始访谈
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
