// KOL 分身列表页
import type { KolProfileSummary } from "@app/shared";
import { ArrowLeft, ArrowRight, Database, MessageCircle, User } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    return <div className="text-center py-16 text-[--color-muted-foreground]">加载中...</div>;
  }

  if (error) {
    return <div className="text-center py-16 text-red-500">加载失败: {error}</div>;
  }

  if (kols.length === 0) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="font-serif text-3xl font-bold text-[--color-primary]">KOL 数字孪生</h1>
          <p className="text-[--color-muted-foreground]">
            基于 B 站 UP 主真实内容构建的 AI 分身。选择一位 KOL，像与该 UP 主本人对话一样提问。
          </p>
        </div>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 space-y-4">
            <Database className="h-12 w-12 text-[--color-muted-foreground] opacity-30" />
            <div className="text-center space-y-2">
              <p className="text-[--color-muted-foreground] font-medium">暂无 KOL 数据</p>
              <p className="text-sm text-[--color-muted-foreground] opacity-70 max-w-md">
                KOL 分身功能将在下期上线。届时将基于 B 站 UP
                主（如冷面叶星星IKGN、鬼王陆行）的公开内容构建数字孪生。
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/personas">
                <ArrowRight className="h-3.5 w-3.5 mr-1" />
                先体验群体画像
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-[--color-muted-foreground] hover:text-[--color-primary] transition-colors"
      >
        <ArrowLeft className="h-3 w-3" /> 返回首页
      </Link>
      <div className="space-y-2">
        <h1 className="font-serif text-3xl font-bold text-[--color-primary]">KOL 数字孪生</h1>
        <p className="text-[--color-muted-foreground]">
          基于 B 站 UP 主真实内容构建的 AI 分身。选择一位 KOL，像与该 UP 主本人对话一样提问。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {kols.map((kol) => (
          <Card key={kol.id} className="hover:border-[--color-primary] transition-colors">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[--color-primary] flex items-center justify-center">
                    <User className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{kol.name}</CardTitle>
                    <CardDescription className="text-xs">
                      已分析 {kol.videoCount} 个视频
                    </CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-[--color-muted-foreground] line-clamp-2">
                {kol.description}
              </p>
              {kol.sampleSegments && kol.sampleSegments.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-[--color-muted-foreground] font-medium">代表性发言</p>
                  <div className="space-y-1">
                    {kol.sampleSegments.slice(0, 2).map((seg) => (
                      <p
                        key={seg.slice(0, 30)}
                        className="text-xs text-[--color-muted-foreground] bg-[--color-secondary] rounded px-2 py-1 line-clamp-2"
                      >
                        "{seg.slice(0, 150)}"
                      </p>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <Button asChild variant="outline" size="sm">
                  <Link to={`/kol/${kol.id}`}>
                    <User className="h-3.5 w-3.5 mr-1" />
                    查看画像
                    <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Link>
                </Button>
                <Button asChild size="sm">
                  <Link to={`/kol/${kol.id}/chat`}>
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
