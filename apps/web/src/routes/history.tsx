// 历史对话列表页 — 统一展示 Persona 和 KOL 会话
import type { ChatSession, KolChatSession, KolProfileSummary, PersonaSummary } from "@app/shared";
import { ArrowLeft, Clock, Search } from "lucide-react";
import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router";
import { Card, CardContent } from "@/components/ui/card";
import { SessionCard } from "@/components/shared/session-card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface HistoryItem {
  id: number;
  type: "persona" | "kol";
  agentId: number;
  agentName?: string;
  title: string | null | undefined;
  messages: Array<{ role: string; content: string }>;
  createdAt: string;
  updatedAt: string;
}

export function HistoryPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    Promise.all([
      api.getChatSessions().catch(() => [] as ChatSession[]),
      api.listKolChatSessions().catch(() => [] as KolChatSession[]),
      api.listPersonas().catch(() => [] as PersonaSummary[]),
      api.listKol().catch(() => [] as KolProfileSummary[]),
    ]).then(([personaSessions, kolSessions, personas, kols]) => {
      const personaMap = new Map(personas.map((p) => [p.id, p.name]));
      const kolMap = new Map(kols.map((k) => [k.id, k.name]));

      const merged: HistoryItem[] = [
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

      setItems(merged);
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
        setItems((prev) => prev.filter((i) => !(i.type === type && i.id === id)));
        toast.success("对话已删除");
      } catch {
        toast.error("删除失败，请重试");
      }
    },
    [],
  );

  const filtered = useMemo(() => {
    let list = items.filter((s) => s.messages.length > 0);

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
  }, [items, search]);

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

  const getTitle = (s: HistoryItem) => {
    if (s.title) return s.title;
    const firstUserMsg = s.messages.find((m) => m.role === "user");
    if (firstUserMsg?.content) return firstUserMsg.content.slice(0, 30);
    return "新对话";
  };

  const getPreview = (s: HistoryItem) => {
    const lastAiMsg = [...s.messages].reverse().find((m) => m.role === "assistant");
    if (lastAiMsg?.content) return lastAiMsg.content;
    return "";
  };

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-10 -mt-6 pt-6 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 bg-neutral-50">
        <div className="pb-2 border-b border-neutral-200">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1 text-sm text-(--color-muted-foreground) hover:text-(--color-primary) transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-3 w-3" /> 返回上一页
          </button>
        </div>
      </div>

      <div>
        <h1 className="font-serif text-3xl font-bold text-[--color-primary]">历史对话</h1>
        <p className="text-[--color-muted-foreground] mt-1">
          共 {filtered.length} 条对话记录
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[--color-muted-foreground]" />
        <Input
          placeholder="搜索历史对话..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {filtered.length > 0 ? (
        <div className="space-y-2">
          {filtered.map((s) => {
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
        </div>
      ) : search ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Search className="h-8 w-8 text-[--color-muted-foreground] opacity-30 mb-2" />
            <p className="text-sm text-[--color-muted-foreground]">未找到匹配的对话</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Clock className="h-8 w-8 text-[--color-muted-foreground] opacity-30 mb-2" />
            <p className="text-sm text-[--color-muted-foreground]">暂无历史对话</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}