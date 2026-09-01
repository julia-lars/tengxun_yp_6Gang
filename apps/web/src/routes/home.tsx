// 项目首页 — AI 模拟用户系统
import type { ChatSession, KolChatSession, KolProfileSummary, PersonaSummary } from "@app/shared";
import {
  ArrowRight,
  MessageCircle,
  Search,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { SessionCard } from "@/components/shared/session-card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { toast } from "sonner";

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
      api.getChatSessions().then((r) => r.data).catch(() => [] as ChatSession[]),
      api.listKolChatSessions().then((r) => r.data).catch(() => [] as KolChatSession[]),
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

  const handleDelete = useCallback(
    async (e: React.MouseEvent, id: number, type: "persona" | "kol") => {
      e.preventDefault();
      e.stopPropagation();
      if (!window.confirm(`确定要删除这条对话记录吗？此操作不可恢复。`)) return;
      try {
        if (type === "persona") {
          await api.deleteChatSession(id);
        } else {
          await api.deleteKolChatSession(id);
        }
        setSessions((prev) => prev.filter((s) => !(s.type === type && s.id === id)));
        toast.success("对话已删除");
      } catch {
        toast.error("删除失败，请重试");
      }
    },
    [],
  );

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

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const weekStart = new Date(today.getTime() - today.getDay() * 86400000);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const time = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    const weekDays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

    if (d >= today) return time;
    if (d >= yesterday) return `昨天 ${time}`;
    if (d >= weekStart) return `${weekDays[d.getDay()]} ${time}`;
    if (d >= yearStart) return d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
    return d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
  };

  const getTitle = (s: HomeSession) => {
    if (s.title) return s.title;
    const firstUserMsg = s.messages.find((m) => m.role === "user");
    if (firstUserMsg?.content) return firstUserMsg.content.slice(0, 30);
    return "新对话";
  };

  const getPreview = (s: HomeSession) => {
    const lastAiMsg = [...s.messages].reverse().find((m) => m.role === "assistant");
    if (lastAiMsg?.content) return lastAiMsg.content;
    return "";
  };

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
                const title = getTitle(s);
                const preview = getPreview(s);
                const chatPath =
                  s.type === "persona"
                    ? `/personas/${s.agentId}/chat?session=${s.id}`
                    : `/kol/${s.agentId}/chat?session=${s.id}`;
                const roundCount = Math.floor(s.messages.length / 2);
                return (
                  <SessionCard
                    key={`${s.type}-${s.id}`}
                    id={s.id}
                    type={s.type}
                    agentId={s.agentId}
                    agentName={s.agentName}
                    title={title}
                    preview={preview}
                    roundCount={roundCount}
                    time={formatTime(s.createdAt)}
                    chatPath={chatPath}
                    onDelete={handleDelete}
                  />
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