// KOL 画像详情页
import type { KolProfileDetail } from "@app/shared";
import { ArrowLeft, MessageCircle, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

export function KolDetailPage() {
  const { id } = useParams<{ id: string }>();
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
      <div className="text-center py-16 text-[--color-muted-foreground]">
        加载中...
      </div>
    );
  }

  if (error || !kol) {
    return (
      <div className="text-center py-16 text-red-500">
        {error ?? "KOL 不存在"}
      </div>
    );
  }

  const personaCard = kol.personaCard as Record<string, unknown>;
  const styleProfile = kol.styleProfile as Record<string, unknown>;
  const evalFramework = personaCard.evaluationFramework as Record<string, string> | undefined;
  const catchphrases = (styleProfile.catchphrases as string[]) ?? [];
  const contentFocus = (personaCard.contentFocus as string[]) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/kol" className="text-[--color-muted-foreground] hover:text-[--color-primary]">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-serif text-2xl font-bold text-[--color-primary]">{kol.name}</h1>
      </div>

      <p className="text-sm text-[--color-muted-foreground]">{kol.description}</p>

      {/* 内容领域 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">内容领域</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {contentFocus.map((f) => (
              <Badge key={f} variant="secondary">{f}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 评价体系 */}
      {evalFramework && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">评价体系</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {Object.entries(evalFramework).map(([k, v]) => (
                <div key={k} className="flex gap-2 text-sm">
                  <span className="font-medium text-[--color-primary] min-w-[4em]">{k}:</span>
                  <span className="text-[--color-muted-foreground]">{v}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 风格特征 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">风格特征</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <p className="text-xs text-[--color-muted-foreground] mb-1.5">整体语气</p>
            <Badge>{String(styleProfile.tone ?? "—")}</Badge>
          </div>
          {catchphrases.length > 0 && (
            <div>
              <p className="text-xs text-[--color-muted-foreground] mb-1.5">标志性表达</p>
              <div className="flex flex-wrap gap-1">
                {catchphrases.map((c) => (
                  <Badge key={c} variant="outline" className="text-xs">{c}</Badge>
                ))}
              </div>
            </div>
          )}
          <div className="text-xs text-[--color-muted-foreground]">
            已分析 {kol.videoCount} 个视频 · {kol.sourceTexts.length} 条语料片段
          </div>
        </CardContent>
      </Card>

      {/* 代表性发言 */}
      {kol.sampleSegments && kol.sampleSegments.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">代表性发言</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {kol.sampleSegments.map((seg, i) => (
                <p
                  key={`${kol.id}-detail-${i}-${seg.slice(0, 20)}`}
                  className="text-xs text-[--color-muted-foreground] bg-[--color-secondary] rounded p-2"
                >
                  "{seg}"
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 操作 */}
      <div className="flex gap-3 pt-2">
        <Button asChild>
          <Link to={`/kol/${kol.id}/chat`}>
            <MessageCircle className="h-4 w-4 mr-2" />
            进入对话
          </Link>
        </Button>
      </div>
    </div>
  );
}
