// 项目首页 — AI 模拟用户系统
import type { ChatSession, KolChatSession, KolProfileSummary, PersonaSummary } from "@app/shared";
import {
  ArrowRight,
  Clock,
  MessageCircle,
  Search,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

interface HomeSession {
  id: number;
  type: "persona" | "kol";
  agentId: number;
  agentName?: string;
  title: string | null | undefined;
  messages: Array<{ role: string; content: string }>;
  createdAt: string;
  updatedAt: string;
}

export function HomePage() {
  const [sessions, setSessions] = useState<HomeSession[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getChatSessions().catch(() => [] as ChatSession[]),
      api.listKolChatSessions().catch(() => [] as KolChatSession[]),
      api.listPersonas().catch(() => [] as PersonaSummary[]),
      api.listKol().catch(() => [] as KolProfileSummary[]),
    ]).then(([personaSessions, kolSessions, personas, kols]) => {
      const personaMap = new Map(personas.map((p) => [p.id, p.name]));
      const kolMap = new Map(kols.map((k) => [k.id, k.name]));

      const merged: HomeSession[] = [
        ...personaSessions.map((s) => ({
          id: s.id,
          type: "persona" as const,
          agentId: s.personaId,
          agentName: personaMap.get(s.personaId),
          title: s.title,
          messages: (s.messages ?? []) as Array<{ role: string; content: string }>,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
        ...kolSessions.map((s) => ({
          id: s.id,
          type: "kol" as const,
          agentId: s.kolId,
          agentName: kolMap.get(s.kolId),
          title: s.title,
          messages: (s.messages ?? []) as Array<{ role: string; content: string }>,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
      ].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );

      setSessions(merged);
      setLoading(false);
    });
  }, []);

  const filteredSessions = useMemo(() => {
    let list = sessions.filter((s) => s.messages.length > 0);

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((s) => {
        const firstMsg = s.messages[0]?.content ?? "";
        return (
          (s.title ?? "").toLowerCase().includes(q) ||
          firstMsg.toLowerCase().includes(q) ||
          (s.agentName ?? "").toLowerCase().includes(q)
        );
      });
    }

    return list;
  }, [sessions, search]);

  const recent = filteredSessions.slice(0, 3);

  const typeLabel = (type: "persona" | "kol") => (type === "persona" ? "画像" : "KOL");

  return (
    <div className="space-y-6">
      {/* ========== Hero 横幅 ========== */}
      <section className="text-center space-y-2 pt-2">
        <div className="inline-flex items-center gap-2 px-3 py-0.5 rounded-full bg-(--color-brand-50) border border-(--color-brand-100)">
          <span className="w-1.5 h-1.5 rounded-full bg-(--color-brand-500) animate-pulse" />
          <span className="text-[10px] font-medium text-(--color-brand-600) tracking-[0.2em]">
            MUR AI · 模拟用户系统
          </span>
        </div>
        <h1 className="font-serif text-2xl sm:text-3xl font-bold text-black">
          AI 驱动的玩家画像模拟系统
        </h1>
        <p className="text-sm text-(--color-content-secondary)">
          基于 17,132 条真实玩家访谈片段 · 构建射击品类 AI 模拟用户画像
        </p>
      </section>

      {/* ========== 双功能入口 ========== */}
      <section className="grid gap-4 sm:grid-cols-2">
        {/* 群体画像 */}
        <Link to="/personas" className="block group">
          <Card className="h-48 transition-all duration-200 hover:border-(--color-brand-300) hover:shadow-md hover:-translate-y-0.5 cursor-pointer">
            <CardContent className="h-full flex flex-col items-center justify-center text-center gap-3 py-6">
              <div className="w-12 h-12 rounded-2xl bg-(--color-brand-50) flex items-center justify-center mt-2">
                <Users className="h-6 w-6 text-(--color-brand-500)" />
              </div>
              <div>
                <h2 className="font-serif text-lg font-bold text-black group-hover:text-(--color-brand-500) transition-colors">
                  群体画像
                </h2>
                <p className="text-xs text-(--color-content-tertiary)">Persona Matching</p>
              </div>
              <p className="text-sm text-(--color-content-secondary) leading-relaxed max-w-[280px]">
                从五维度标签筛选匹配目标玩家画像，<br />支持多标签组合与置信度排序
              </p>
            </CardContent>
          </Card>
        </Link>

        {/* KOL 数字孪生 */}
        <Link to="/kol" className="block group">
          <Card className="h-48 transition-all duration-200 hover:border-(--color-brand-300) hover:shadow-md hover:-translate-y-0.5 cursor-pointer">
            <CardContent className="h-full flex flex-col items-center justify-center text-center gap-3 py-6">
              <div className="w-12 h-12 rounded-2xl bg-(--color-brand-50) flex items-center justify-center mt-2">
                <MessageCircle className="h-6 w-6 text-(--color-brand-500)" />
              </div>
              <div>
                <h2 className="font-serif text-lg font-bold text-black group-hover:text-(--color-brand-500) transition-colors">
                  KOL 数字孪生
                </h2>
                <p className="text-xs text-(--color-content-tertiary)">Digital Twin</p>
              </div>
              <p className="text-sm text-(--color-content-secondary) leading-relaxed max-w-[280px]">
                基于 B 站 UP 主真实内容构建数字分身，<br />获取专业视角的游戏评测与见解
              </p>
            </CardContent>
          </Card>
        </Link>
      </section>

      {/* ========== 最近对话 ========== */}
      <section className="space-y-3">
        {/* 标题行 */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-serif text-lg font-bold text-black">
              最近对话
            </h2>
          </div>
        </div>

        {/* 搜索框 */}
        {sessions.length > 0 && (
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-(--color-content-tertiary)" />
            <Input
              placeholder="搜索历史对话..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
        )}

        {/* 对话列表 */}
        <div>
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Card key={i}>
                  <CardContent className="flex items-center gap-4 py-3 px-4">
                    <Skeleton className="w-8 h-8 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : recent.length > 0 ? (
            <div className="space-y-2">
              {recent.map((s) => {
                const firstMsg = (s.messages[0] as { content?: string } | undefined)?.content ?? "";
                const preview = s.title || firstMsg.slice(0, 60) || "新对话";
                const chatPath =
                  s.type === "persona"
                    ? `/personas/${s.agentId}/chat?session=${s.id}&from=home`
                    : `/kol/${s.agentId}/chat?session=${s.id}&from=home`;
                return (
                  <Link
                    key={`${s.type}-${s.id}`}
                    to={chatPath}
                    className="block group"
                  >
                    <Card className="transition-all duration-200 hover:border-(--color-brand-300) hover:shadow-sm">
                      <CardContent className="flex items-center gap-4 py-3 px-4">
                        <div className="w-8 h-8 rounded-full bg-(--color-surface-secondary) flex items-center justify-center flex-shrink-0">
                          <Clock className="h-4 w-4 text-(--color-content-tertiary)" />
                        </div>
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-(--color-content-primary) truncate group-hover:text-(--color-brand-500) transition-colors">
                              {preview}
                            </span>
                            <Badge variant="secondary" className="text-[10px] flex-shrink-0">
                              {typeLabel(s.type)}: {s.agentName ?? `#${s.agentId}`}
                            </Badge>
                          </div>
                          <div className="text-xs text-(--color-content-tertiary) flex items-center gap-3">
                            <span>
                              {new Date(s.createdAt).toLocaleDateString("zh-CN", {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                            <span>{Math.floor(s.messages.length / 2)} 轮对话</span>
                          </div>
                        </div>
                        <ArrowRight className="h-4 w-4 text-(--color-content-tertiary) opacity-0 group-hover:opacity-100 group-hover:text-(--color-brand-500) transition-all flex-shrink-0" />
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
              {filteredSessions.length > 3 && (
                <div className="flex justify-center pt-2">
                  <Button asChild variant="ghost" size="sm" className="text-xs text-(--color-content-secondary) hover:text-(--color-brand-500) hover:bg-transparent transition-colors">
                    <Link to="/history" className="group inline-flex items-center">
                      查看全部 <ArrowRight className="h-3 w-3 ml-1 text-(--color-content-secondary) group-hover:text-(--color-brand-500) transition-colors" />
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          ) : search ? (
            <EmptyState
              icon={Search}
              title="未找到匹配的对话"
              description="尝试使用不同的关键词搜索"
            />
          ) : (
            <EmptyState
              icon={MessageCircle}
              title="暂无历史对话"
              description="进入画像详情页，开始与虚拟玩家对话后，将在此显示"
              action={
                <Button asChild size="sm">
                  <Link to="/personas">开始匹配画像</Link>
                </Button>
              }
            />
          )}
        </div>
      </section>
    </div>
  );
}