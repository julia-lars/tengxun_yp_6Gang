// 历史对话列表页
import type { ChatSession, PersonaSummary } from "@app/shared";
import { ArrowLeft, ArrowRight, Clock, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

export function HistoryPage() {
  const [sessions, setSessions] = useState<(ChatSession & { personaName?: string })[]>([]);
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.getChatSessions().then(setSessions).catch(() => {});
    api.listPersonas().then(setPersonas).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    let list = sessions
      .map((s) => {
        const p = personas.find((p) => p.id === s.personaId);
        return { ...s, personaName: p?.name };
      })
      .filter((s) => s.messages.length > 0);

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((s) => {
        const firstMsg = (s.messages[0] as { content?: string } | undefined)?.content ?? "";
        return (
          (s.title ?? "").toLowerCase().includes(q) ||
          firstMsg.toLowerCase().includes(q) ||
          (s.personaName ?? "").toLowerCase().includes(q)
        );
      });
    }

    return list;
  }, [sessions, personas, search]);

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
            const firstMsg = (s.messages[0] as { content?: string } | undefined)?.content ?? "";
            const preview = s.title || firstMsg.slice(0, 50) || "新对话";
            return (
              <Link
                key={s.id}
                to={`/personas/${s.personaId}/chat?session=${s.id}&from=history`}
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
                        <Badge variant="secondary" className="text-[10px] flex-shrink-0">
                          {s.personaName ? `画像: ${s.personaName}` : `画像 #${s.personaId}`}
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
                        <span>{s.messages.length} 轮</span>
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