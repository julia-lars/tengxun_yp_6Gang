// KOL 画像详情页
import type { KolProfileDetail } from "@app/shared";
import { ArrowLeft, MessageCircle, User, Video, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

export function KolDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const kolId = Number(id);
  const [kol, setKol] = useState<KolProfileDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getKol(kolId)
      .then(setKol)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [kolId]);

  if (loading) {
    return (
      <div className="py-8 text-center text-(--color-muted-foreground)">
        <div className="skeleton-shimmer h-8 w-48 mx-auto rounded mb-4" />
        <div className="skeleton-shimmer h-4 w-64 mx-auto rounded" />
      </div>
    );
  }

  if (error || !kol) {
    return <div className="py-8 text-center text-red-500">{error ?? "KOL 不存在"}</div>;
  }

  const personaCard = kol.personaCard as Record<string, unknown>;
  const styleProfile = kol.styleProfile as Record<string, unknown>;
  const evalFramework = personaCard.evaluationFramework as Record<string, string> | undefined;
  const speechHabits = (styleProfile.speechHabits as string) ?? "";
  const contentFocus = (personaCard.contentFocus as string[]) ?? [];
  const platformPreference = (personaCard.platformPreference as string) ?? "";
  const tone = (styleProfile.tone as string) ?? "";
  const specialty = (personaCard.specialty as string) ?? "";
  const toneSummary = (personaCard.toneSummary as string) ?? "";

  const introText = [kol.description, toneSummary].filter(Boolean).join("。");

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-sm text-(--color-muted-foreground) hover:text-(--color-primary) transition-colors cursor-pointer"
      >
        <ArrowLeft className="h-3 w-3" /> 返回 KOL 列表
      </button>

      {/* 标题区 */}
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 rounded-2xl bg-(--color-brand-400) flex items-center justify-center flex-shrink-0 shadow-md">
          <User className="h-7 w-7 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-3xl font-bold text-(--color-foreground)">{kol.name}</h1>
          <p className="text-(--color-muted-foreground) mt-1 text-sm leading-relaxed">{introText}</p>
          <div className="flex items-center gap-4 mt-3 text-xs text-(--color-muted-foreground)">
            <span className="inline-flex items-center gap-1">
              <Video className="h-3 w-3" />
              {kol.videoCount} 个视频
            </span>
            <span className="inline-flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {kol.sourceTexts.length} 条语料
            </span>
          </div>
        </div>
      </div>

      {/* 对话按钮 */}
      <Link to={`/kol/${kol.id}/chat`} className="block">
        <Button size="lg" className="w-full sm:w-auto text-base px-8 py-6 bg-(--color-brand-500) hover:bg-(--color-brand-600) text-white">
          <MessageCircle className="h-5 w-5 mr-2" />
          与「{kol.name}」开始对话
        </Button>
      </Link>

      {/* 人设画像 */}
      <Card className="border-l-4 border-l-(--color-brand-300) overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-serif">人设画像</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 核心标签 */}
          <div className="flex flex-wrap gap-2">
            {contentFocus.map((f) => (
              <Badge key={f} className="bg-(--color-brand-50) text-(--color-brand-700) border-(--color-brand-200) text-xs">
                {f}
              </Badge>
            ))}
            {platformPreference && platformPreference !== "未知" && (
              <Badge variant="outline" className="bg-white text-xs">
                {platformPreference}
              </Badge>
            )}
            {tone && tone !== "—" && (
              <Badge variant="outline" className="bg-white text-xs">
                {tone}
              </Badge>
            )}
          </div>

          {/* 基本信息 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="flex gap-2">
              <span className="text-(--color-muted-foreground) shrink-0">内容领域</span>
              <span>{contentFocus.join(" · ")}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-(--color-muted-foreground) shrink-0">平台偏好</span>
              <span>{platformPreference && platformPreference !== "未知" ? platformPreference : "—"}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-(--color-muted-foreground) shrink-0">语气基调</span>
              <span>{tone && tone !== "—" ? tone : "—"}</span>
            </div>
            {specialty && specialty !== "未知" && (
              <div className="sm:col-span-2 flex gap-2">
                <span className="text-(--color-muted-foreground) shrink-0">专长特色</span>
                <span>{specialty}</span>
              </div>
            )}
          </div>

          {/* 评价体系 */}
          {evalFramework && (
            <div className="border-t border-(--color-border) pt-4">
              <p className="text-sm font-medium text-(--color-foreground) mb-3">评价维度权重</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {Object.entries(evalFramework).map(([k, v]) => (
                  <div key={k} className="flex items-start gap-2 text-sm">
                    <span className="inline-flex items-center justify-center bg-(--color-brand-50) text-(--color-brand-600) text-xs font-medium px-2 py-0.5 rounded shrink-0">
                      {k}
                    </span>
                    <span className="text-(--color-muted-foreground) leading-relaxed">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 风格特征 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-serif">风格特征</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {speechHabits && (
            <div className="bg-(--color-brand-50)/50 rounded-lg p-4 border border-(--color-brand-100)">
              <p className="text-xs text-(--color-brand-500) font-medium mb-1.5">说话风格</p>
              <p className="text-sm text-(--color-foreground) leading-relaxed">{speechHabits}</p>
            </div>
          )}
          <div className="flex items-center gap-4 text-xs text-(--color-muted-foreground)">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-(--color-brand-300)" />
              已分析 {kol.videoCount} 个视频
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-(--color-brand-300)" />
              {kol.sourceTexts.length} 条语料片段
            </span>
          </div>
        </CardContent>
      </Card>

      {/* 代表性发言 */}
      {kol.sampleSegments && kol.sampleSegments.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-serif">代表性发言</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {kol.sampleSegments.slice(0, 4).map((seg, i) => (
                <div key={i} className="relative pl-4 border-l-2 border-(--color-brand-200) hover:border-(--color-brand-300) transition-colors">
                  <span className="absolute left-0 top-0 text-(--color-brand-200) text-lg leading-none -translate-x-[0.6rem] -translate-y-1 select-none">
                    &ldquo;
                  </span>
                  <p className="text-sm text-(--color-muted-foreground) leading-relaxed italic line-clamp-2 pl-2">
                    {seg.slice(0, 150)}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}