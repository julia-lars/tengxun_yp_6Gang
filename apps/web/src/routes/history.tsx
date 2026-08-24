// 历史对话列表页 — 统一展示 Persona 和 KOL 会话
import type { ChatSession, KolChatSession, KolProfileSummary, PersonaSummary } from "@app/shared";
import { ArrowLeft, ArrowRight, Clock, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

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

  const typeLabel = (type: "persona" | "kol") => (type === "persona" ? "画像" : "KOL");

  return (
    <div className="space-y-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-[--color-muted-foreground] hover:text-[--color-primary] transition-colors"
      >
        <ArrowLeft className="h-3 w-3" /> 返回首页
      </Link>

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
            const firstMsg = s.messages[0]?.content ?? "";
            const preview = s.title || firstMsg.slice(0, 50) || "新对话";
            const chatPath =
              s.type === "persona"
                ? `/personas/${s.agentId}/chat?session=${s.id}&from=history`
                : `/kol/${s.agentId}/chat?session=${s.id}&from=history`;
            return (
              <Link
                key={`${s.type}-${s.id}`}
                to={chatPath}
                className="block group"
              >
                <Card className="transition-all duration-200 hover:border-[--color-primary] hover:shadow-sm">
                  <CardContent className="flex items-center gap-3 py-3 px-4">
                    <Clock className="h-4 w-4 text-[--color-muted-foreground] flex-shrink-0" />
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-[--color-foreground] truncate group-hover:text-[--color-primary] transition-colors">
                          {preview}
                        </span>
                        <Badge
                          variant="secondary"
                          className="text-[10px] flex-shrink-0"
                        >
                          {typeLabel(s.type)}: {s.agentName ?? `#${s.agentId}`}
                        </Badge>
                      </div>
                      <div className="text-xs text-[--color-muted-foreground] flex items-center gap-3">
                        <span>
                          {new Date(s.createdAt).toLocaleDateString("zh-CN", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span>{Math.floor(s.messages.length / 2)} 轮</span>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-[--color-muted-foreground] opacity-0 group-hover:opacity-100 group-hover:text-[--color-primary] transition-all flex-shrink-0" />
                  </CardContent>
                </Card>
              </Link>
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