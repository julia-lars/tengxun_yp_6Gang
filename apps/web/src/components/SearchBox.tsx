// SearchBox — 全局搜索框，支持搜索画像、KOL、历史对话
import { Clock, Loader2, MessageCircle, Search, Users, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { ChatSession, KolProfileSummary, PersonaSummary } from "@app/shared";

interface SearchResult {
  type: "persona" | "kol" | "session";
  id: number;
  label: string;
  desc: string;
  url: string;
}

export function SearchBox() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [kols, setKols] = useState<KolProfileSummary[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 首次聚焦时加载数据
  const [fetched, setFetched] = useState(false);
  const handleFocus = useCallback(async () => {
    setOpen(true);
    if (fetched) return;
    setLoading(true);
    const [p, k, s] = await Promise.all([
      api.listPersonas().catch(() => [] as PersonaSummary[]),
      api.listKol().catch(() => [] as KolProfileSummary[]),
      api.getChatSessions().catch(() => [] as ChatSession[]),
    ]);
    setPersonas(p);
    setKols(k);
    setSessions(s);
    setFetched(true);
    setLoading(false);
  }, [fetched]);

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // 搜索过滤
  const results = (() => {
    if (!query.trim()) return [] as SearchResult[];
    const q = query.toLowerCase();

    const matched: SearchResult[] = [];

    for (const p of personas) {
      if (p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)) {
        matched.push({
          type: "persona" as const,
          id: p.id,
          label: p.name,
          desc: p.description.slice(0, 60),
          url: `/personas/${p.id}`,
        });
      }
    }

    for (const k of kols) {
      if (k.name.toLowerCase().includes(q) || k.description.toLowerCase().includes(q)) {
        matched.push({
          type: "kol" as const,
          id: k.id,
          label: k.name,
          desc: k.description.slice(0, 60),
          url: `/kol/${k.id}`,
        });
      }
    }

    for (const s of sessions) {
      if (s.messages.length === 0) continue;
      const firstMsg = (s.messages[0] as { content?: string })?.content ?? "";
      const title = s.title || firstMsg.slice(0, 40);
      if (title.toLowerCase().includes(q) || firstMsg.toLowerCase().includes(q)) {
        const p = personas.find((pp) => pp.id === s.personaId);
        matched.push({
          type: "session" as const,
          id: s.id,
          label: title || "对话",
          desc: p ? `画像: ${p.name}` : "历史对话",
          url: `/personas/${s.personaId}/chat?session=${s.id}&from=search`,
        });
      }
    }

    return matched.slice(0, 8);
  })();

  const grouped = {
    persona: results.filter((r) => r.type === "persona"),
    kol: results.filter((r) => r.type === "kol"),
    session: results.filter((r) => r.type === "session"),
  };

  const handleSelect = (r: SearchResult) => {
    navigate(r.url);
    setQuery("");
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const clearSearch = () => {
    setQuery("");
    setOpen(true);
  };

  const hasResults = grouped.persona.length > 0 || grouped.kol.length > 0 || grouped.session.length > 0;

  return (
    <div ref={containerRef} className="relative flex-1 max-w-sm hidden sm:block">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-(--color-content-tertiary) pointer-events-none z-10" />
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder="搜索画像、KOL、对话…"
        className="pl-8 pr-8 h-8 text-xs bg-(--color-surface-secondary) border-transparent focus:bg-(--color-surface-primary)"
      />
      {query && (
        <button
          type="button"
          onClick={clearSearch}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-(--color-content-tertiary) hover:text-(--color-content-primary) z-10"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {/* 下拉结果 */}
      {open && query.trim() && (
        <div className="absolute top-full mt-1 left-0 right-0 bg-(--color-surface-elevated) border border-(--color-border-default) rounded-lg shadow-lg overflow-hidden z-50">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-(--color-content-tertiary)">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              加载中…
            </div>
          ) : !hasResults ? (
            <div className="py-6 text-center text-xs text-(--color-content-tertiary)">
              未找到相关结果
            </div>
          ) : (
            <div className="py-1">
              {grouped.persona.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-(--color-content-tertiary) uppercase tracking-wider">
                    <Users className="h-3 w-3 inline mr-1" />
                    群体画像
                  </div>
                  {grouped.persona.map((r) => (
                    <button
                      key={`p-${r.id}`}
                      type="button"
                      onClick={() => handleSelect(r)}
                      className="w-full text-left px-3 py-2 hover:bg-(--color-surface-secondary) transition-colors"
                    >
                      <div className="text-sm font-medium text-(--color-content-primary)">{r.label}</div>
                      <div className="text-xs text-(--color-content-tertiary) truncate">{r.desc}</div>
                    </button>
                  ))}
                </div>
              )}
              {grouped.kol.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-(--color-content-tertiary) uppercase tracking-wider">
                    <MessageCircle className="h-3 w-3 inline mr-1" />
                    KOL 分身
                  </div>
                  {grouped.kol.map((r) => (
                    <button
                      key={`k-${r.id}`}
                      type="button"
                      onClick={() => handleSelect(r)}
                      className="w-full text-left px-3 py-2 hover:bg-(--color-surface-secondary) transition-colors"
                    >
                      <div className="text-sm font-medium text-(--color-content-primary)">{r.label}</div>
                      <div className="text-xs text-(--color-content-tertiary) truncate">{r.desc}</div>
                    </button>
                  ))}
                </div>
              )}
              {grouped.session.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-(--color-content-tertiary) uppercase tracking-wider">
                    <Clock className="h-3 w-3 inline mr-1" />
                    历史对话
                  </div>
                  {grouped.session.map((r) => (
                    <button
                      key={`s-${r.id}`}
                      type="button"
                      onClick={() => handleSelect(r)}
                      className="w-full text-left px-3 py-2 hover:bg-(--color-surface-secondary) transition-colors"
                    >
                      <div className="text-sm font-medium text-(--color-content-primary) truncate">{r.label}</div>
                      <div className="text-xs text-(--color-content-tertiary)">{r.desc}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}