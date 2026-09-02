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
  const avgSentenceLength = (styleProfile.avgSentenceLength as number) ?? 0;
  const firstPersonStyle = (styleProfile.firstPersonStyle as string) ?? "";
  const identity = (personaCard.identity as string) ?? "";
  const catchphrases = (styleProfile.catchphrases as string[]) ?? [];
  const signaturePatterns = (styleProfile.signaturePatterns as string[]) ?? [];
  const totalPlayCount = (styleProfile.totalPlayCount as number) ?? 0;
  const representativeTopics = (personaCard.representativeTopics as string[]) ?? [];
  const audiencePositioning = (personaCard.audiencePositioning as string) ?? "";
  const contentFormats = (personaCard.contentFormats as string[]) ?? [];
  const pacingStyle = (styleProfile.pacingStyle as string) ?? "";
  const vocabularyStyle = (styleProfile.vocabularyStyle as string) ?? "";
  const totalWordCount = kol.totalWordCount ?? kol.sourceTexts.reduce((sum, t) => sum + t.length, 0);

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
      <div className="mt-4">
        <Link to={`/kol/${kol.id}/chat`}>
          <Button size="lg" variant="outline" className="text-base px-8 py-6 bg-white">
            <MessageCircle className="h-5 w-5 mr-2" />
            与「{kol.name}」开始对话
          </Button>
        </Link>
      </div>

      {/* 人设画像 */}
      <Card className="overflow-hidden">
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
              <Badge className="bg-(--color-brand-50) text-(--color-brand-700) border-(--color-brand-200) text-xs">
                {platformPreference}
              </Badge>
            )}
            {tone && tone !== "—" && (
              <Badge className="bg-(--color-brand-50) text-(--color-brand-700) border-(--color-brand-200) text-xs">
                {tone}
              </Badge>
            )}
          </div>

          {/* 基本信息 */}
          <div className="flex flex-col gap-3 text-sm">
            {identity && identity !== "未知" && (
              <div className="flex gap-2">
                <span className="text-(--color-muted-foreground) shrink-0">身份定位</span>
                <span>{identity}</span>
              </div>
            )}
            <div className="flex gap-2">
              <span className="text-(--color-muted-foreground) shrink-0">内容领域</span>
              <span>{contentFocus.length > 0 ? contentFocus.join(" · ") : "—"}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-(--color-muted-foreground) shrink-0">语气基调</span>
              <span>{tone && tone !== "—" ? tone : "—"}</span>
            </div>
            {toneSummary && toneSummary !== "未知" && (
              <div className="flex gap-2">
                <span className="text-(--color-muted-foreground) shrink-0">语气概括</span>
                <span>{toneSummary}</span>
              </div>
            )}
            <div className="flex gap-2">
              <span className="text-(--color-muted-foreground) shrink-0">平台偏好</span>
              <span>{platformPreference && platformPreference !== "未知" ? platformPreference : "—"}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-(--color-muted-foreground) shrink-0">专场特色</span>
              <span>{specialty && specialty !== "未知" ? specialty : "—"}</span>
            </div>
            {audiencePositioning && audiencePositioning !== "未知" && (
              <div className="flex gap-2">
                <span className="text-(--color-muted-foreground) shrink-0">受众定位</span>
                <span>{audiencePositioning}</span>
              </div>
            )}
            {kol.bilibiliUid && (
              <div className="flex gap-2">
                <span className="text-(--color-muted-foreground) shrink-0">B站主页</span>
                <a
                  href={`https://space.bilibili.com/${kol.bilibiliUid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-(--color-brand-500) hover:underline text-sm"
                >
                  查看空间 ↗
                </a>
              </div>
            )}
          </div>

          {/* 内容形式 & 代表性议题 */}
          {(contentFormats.length > 0 || representativeTopics.length > 0) && (
            <div className="border-t border-(--color-border) pt-4 space-y-3">
              {contentFormats.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-(--color-muted-foreground) font-medium">内容形式</p>
                  <div className="flex flex-wrap gap-1.5">
                    {contentFormats.map((cf) => (
                      <Badge key={cf} className="bg-(--color-brand-50) text-(--color-brand-700) border-(--color-brand-200) text-xs">
                        {cf}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {representativeTopics.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-(--color-muted-foreground) font-medium">代表性议题</p>
                  <div className="flex flex-wrap gap-1.5">
                    {representativeTopics.map((rt) => (
                      <Badge key={rt} className="bg-(--color-brand-50) text-(--color-brand-700) border-(--color-brand-200) text-xs">
                        {rt}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

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

          {/* 统计信息 */}
          <div className="flex items-center gap-4 text-xs text-(--color-muted-foreground) border-t border-(--color-border) pt-4">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-(--color-brand-300)" />
              已分析 {kol.videoCount} 个视频
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-(--color-brand-300)" />
              {kol.sourceTexts.length} 条语料片段
            </span>
            {totalWordCount > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-(--color-brand-300)" />
                {(() => {
                  if (totalWordCount < 1000) return `约 ${totalWordCount} 字语料`;
                  if (totalWordCount < 10000) return `约 ${(totalWordCount / 1000).toFixed(1)} 千字语料`;
                  return `约 ${(totalWordCount / 10000).toFixed(1)} 万字语料`;
                })()}
              </span>
            )}
          </div>
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
          {catchphrases.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-(--color-muted-foreground) font-medium">口头禅</p>
              <div className="flex flex-wrap gap-1.5">
                {catchphrases.map((cp) => (
                  <Badge key={cp} variant="secondary" className="text-xs">
                    {cp}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {signaturePatterns.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-(--color-muted-foreground) font-medium">表达特征</p>
              <div className="flex flex-col gap-1">
                {signaturePatterns.map((sp) => (
                  <p key={sp} className="text-sm text-(--color-foreground)">· {sp}</p>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-3 text-sm">
            {tone && tone !== "—" && (
              <div className="flex gap-2">
                <span className="text-(--color-muted-foreground) shrink-0">语气倾向</span>
                <span>{tone}</span>
              </div>
            )}
            {avgSentenceLength > 0 && (
              <div className="flex gap-2">
                <span className="text-(--color-muted-foreground) shrink-0">平均句长</span>
                <span>约 {avgSentenceLength} 字</span>
              </div>
            )}
            {firstPersonStyle && firstPersonStyle !== "未知" && (
              <div className="flex gap-2">
                <span className="text-(--color-muted-foreground) shrink-0">第一人称</span>
                <span>{firstPersonStyle}</span>
              </div>
            )}
            {totalPlayCount > 0 && (
              <div className="flex gap-2">
                <span className="text-(--color-muted-foreground) shrink-0">总播放量</span>
                <span>{(totalPlayCount / 10000).toFixed(1)} 万</span>
              </div>
            )}
            {pacingStyle && pacingStyle !== "未知" && (
              <div className="flex gap-2">
                <span className="text-(--color-muted-foreground) shrink-0">内容节奏</span>
                <span>{pacingStyle}</span>
              </div>
            )}
            {vocabularyStyle && vocabularyStyle !== "未知" && (
              <div className="flex gap-2">
                <span className="text-(--color-muted-foreground) shrink-0">词汇风格</span>
                <span>{vocabularyStyle}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 代表性发言 */}
      {(() => {
        const repTexts = kol.sampleSegments?.length ? kol.sampleSegments : kol.sourceTexts;
        if (!repTexts || repTexts.length === 0) return null;
        return (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-serif">代表性发言</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(() => {
                const segs = repTexts;
                if (segs.length <= 5) {
                  return segs.map((seg, i) => (
                    <div key={i} className="relative pl-4 border-l-2 border-(--color-brand-200) hover:border-(--color-brand-300) transition-colors">
                      <span className="absolute left-0 top-0 text-(--color-brand-200) text-lg leading-none -translate-x-[0.6rem] -translate-y-1 select-none">
                        &ldquo;
                      </span>
                      <p className="text-sm text-(--color-muted-foreground) leading-relaxed line-clamp-4 pl-2">
                        {seg.slice(0, 500)}
                      </p>
                    </div>
                  ));
                }

                // 去重后按长度排序，均匀选取 5 段（短、较短、中、较长、长）
                const seen = new Set<string>();
                const uniqueSegs = segs.filter((s) => {
                  if (seen.has(s)) return false;
                  seen.add(s);
                  return true;
                });
                const sorted = uniqueSegs.sort((a, b) => a.length - b.length);

                const picked: string[] = [];
                const positions = [
                  0,
                  Math.floor(sorted.length * 0.25),
                  Math.floor(sorted.length * 0.5),
                  Math.floor(sorted.length * 0.75),
                  sorted.length - 1,
                ];
                for (const pos of positions) {
                  const seg = sorted[Math.min(pos, sorted.length - 1)];
                  if (seg && !picked.includes(seg)) picked.push(seg);
                }

                // 若去重后不足 5 段，从排序列表中补充其他不同长度的片段
                for (const seg of sorted) {
                  if (picked.length >= 5) break;
                  if (!picked.includes(seg)) picked.push(seg);
                }

                return picked.map((seg, i) => (
                  <div key={i} className="relative pl-4 border-l-2 border-(--color-brand-200) hover:border-(--color-brand-300) transition-colors">
                    <span className="absolute left-0 top-0 text-(--color-brand-200) text-lg leading-none -translate-x-[0.6rem] -translate-y-1 select-none">
                      &ldquo;
                    </span>
                    <p className="text-sm text-(--color-muted-foreground) leading-relaxed line-clamp-4 pl-2">
                      {seg.slice(0, 500)}
                    </p>
                  </div>
                ));
              })()}
            </div>
          </CardContent>
        </Card>
        );
      })()}
    </div>
  );
}