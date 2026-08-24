// KOL 分身列表页
import type { KolProfileSummary } from "@app/shared";
import { ArrowLeft, ArrowRight, Database, MessageCircle, User } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { api } from "@/lib/api";

export function KolListPage() {
  const [kols, setKols] = useState<KolProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listKol()
      .then(setKols)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton h-10 w-64" />
        <div className="skeleton h-4 w-96" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        message={`KOL 数据加载失败: ${error}`}
        onRetry={() => {
          setLoading(true);
          setError(null);
          api.listKol().then(setKols).catch((e) => setError(String(e))).finally(() => setLoading(false));
        }}
      />
    );
  }

  if (kols.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="KOL 数字孪生"
          description="基于 B 站 UP 主真实内容构建的 AI 分身。选择一位 KOL，像与该 UP 主本人对话一样提问。"
        />
        <EmptyState
          icon={Database}
          title="暂无 KOL 数据"
          description="KOL 分身功能将在下期上线。届时将基于 B 站 UP 主（如冷面叶星星IKGN、鬼王陆行）的公开内容构建数字孪生。"
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/personas">
                <ArrowRight className="h-3.5 w-3.5 mr-1" />
                先体验群体画像
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-(--color-content-secondary) hover:text-(--color-brand-500) transition-colors"
      >
        <ArrowLeft className="h-3 w-3" /> 返回首页
      </Link>

      <PageHeader
        title="KOL 数字孪生"
        description="基于 B 站 UP 主真实内容构建的 AI 分身。选择一位 KOL，像与该 UP 主本人对话一样提问。"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {kols.map((kol) => (
          <Card
            key={kol.id}
            className="h-full transition-all duration-200 hover:border-(--color-brand-300) hover:shadow-md hover:-translate-y-0.5"
          >
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-(--color-brand-50) flex items-center justify-center flex-shrink-0">
                  <User className="h-5 w-5 text-(--color-brand-500)" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-lg font-serif text-black">{kol.name}</CardTitle>
                  <CardDescription className="text-xs text-(--color-content-tertiary)">
                    已分析 {kol.videoCount} 个视频
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-(--color-content-secondary) text-clamp-2">
                {kol.description}
              </p>
              {kol.sampleSegments && kol.sampleSegments.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-(--color-content-tertiary) font-medium">代表性发言</p>
                  <div className="space-y-1">
                    {kol.sampleSegments.slice(0, 2).map((seg) => (
                      <p
                        key={seg.slice(0, 30)}
                        className="text-xs text-(--color-content-secondary) bg-(--color-surface-secondary) rounded-md px-2 py-1 text-clamp-2"
                      >
                        "{seg.slice(0, 150)}"
                      </p>
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
                  <Link to={`/kol/${kol.id}`}>
                    查看画像
                    <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover/view:translate-x-0.5" />
                  </Link>
                </Button>
                <Button asChild size="sm">
                  <Link to={`/kol/${kol.id}/chat?from=kol`}>
                    <MessageCircle className="h-3.5 w-3.5 mr-1" />
                    开始对话
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}