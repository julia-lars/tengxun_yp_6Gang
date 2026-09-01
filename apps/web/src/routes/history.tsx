// 历史对话列表页 — 统一展示 Persona 和 KOL 会话
// 支持按画像筛选、批量删除（多选模式 + 全选）
import type { ChatSession, KolChatSession, KolProfileSummary, PersonaSummary } from "@app/shared";
import { ArrowLeft, Check, CheckSquare, ChevronDown, Clock, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent } from "@/components/ui/card";
import { SessionCard } from "@/components/shared/session-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { toast } from "sonner";

const PAGE_SIZE = 20;

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

interface AgentOption {
  value: string;   // "persona-123" 或 "kol-456"
  label: string;   // 画像名称
  type: "persona" | "kol";
}

export function HistoryPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [search, setSearch] = useState("");
  const [filterAgent, setFilterAgent] = useState<string>(""); // "" 表示全部
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([]);
  const [agentNameMap, setAgentNameMap] = useState<{ persona: Map<number, string>; kol: Map<number, string> }>({
    persona: new Map(),
    kol: new Map(),
  });
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const personaOffsetRef = useRef(0);
  const kolOffsetRef = useRef(0);
  const hasMorePersonaRef = useRef(true);
  const hasMoreKolRef = useRef(true);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  // 合并会话数据
  const mergeSessions = useCallback(
    (personaRes: { data: ChatSession[]; hasMore: boolean }, kolRes: { data: KolChatSession[]; hasMore: boolean }) => {
      const merged: HistoryItem[] = [
        ...personaRes.data.map((s) => ({
          id: s.id,
          type: "persona" as const,
          agentId: s.personaId,
          agentName: agentNameMap.persona.get(s.personaId),
          title: s.title,
          messages: (s.messages ?? []) as Array<{ role: string; content: string }>,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
        ...kolRes.data.map((s) => ({
          id: s.id,
          type: "kol" as const,
          agentId: s.kolId,
          agentName: agentNameMap.kol.get(s.kolId),
          title: s.title,
          messages: (s.messages ?? []) as Array<{ role: string; content: string }>,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
      ].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      return merged;
    },
    [agentNameMap],
  );

  // 加载更多
  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    const hasMore = hasMorePersonaRef.current || hasMoreKolRef.current;
    if (!hasMore) return;

    loadingRef.current = true;
    setIsLoadingMore(true);

    try {
      const [personaRes, kolRes] = await Promise.all([
        hasMorePersonaRef.current
          ? api.getChatSessions(undefined, { offset: personaOffsetRef.current, limit: PAGE_SIZE }).catch(() => ({ data: [] as ChatSession[], total: 0, hasMore: false }))
          : Promise.resolve({ data: [] as ChatSession[], total: 0, hasMore: false }),
        hasMoreKolRef.current
          ? api.listKolChatSessions(undefined, { offset: kolOffsetRef.current, limit: PAGE_SIZE }).catch(() => ({ data: [] as KolChatSession[], total: 0, hasMore: false }))
          : Promise.resolve({ data: [] as KolChatSession[], total: 0, hasMore: false }),
      ]);

      hasMorePersonaRef.current = personaRes.hasMore;
      hasMoreKolRef.current = kolRes.hasMore;
      personaOffsetRef.current += PAGE_SIZE;
      kolOffsetRef.current += PAGE_SIZE;

      const merged = mergeSessions(personaRes, kolRes);
      setItems((prev) => {
        // 去重
        const existingKeys = new Set(prev.map((i) => `${i.type}-${i.id}`));
        const newItems = merged.filter((i) => !existingKeys.has(`${i.type}-${i.id}`));
        return [...prev, ...newItems];
      });
    } catch (err) {
      console.error("加载历史对话失败:", err);
    } finally {
      loadingRef.current = false;
      setIsLoadingMore(false);
    }
  }, [mergeSessions]);

  // 初始加载
  useEffect(() => {
    Promise.all([
      api.getChatSessions(undefined, { offset: 0, limit: PAGE_SIZE }).catch(() => ({ data: [] as ChatSession[], total: 0, hasMore: false })),
      api.listKolChatSessions(undefined, { offset: 0, limit: PAGE_SIZE }).catch(() => ({ data: [] as KolChatSession[], total: 0, hasMore: false })),
      api.listPersonas().catch(() => [] as PersonaSummary[]),
      api.listKol().catch(() => [] as KolProfileSummary[]),
    ]).then(([personaRes, kolRes, personas, kols]) => {
      const personaMap = new Map(personas.map((p) => [p.id, p.name]));
      const kolMap = new Map(kols.map((k) => [k.id, k.name]));
      setAgentNameMap({ persona: personaMap, kol: kolMap });

      hasMorePersonaRef.current = personaRes.hasMore;
      hasMoreKolRef.current = kolRes.hasMore;
      personaOffsetRef.current = PAGE_SIZE;
      kolOffsetRef.current = PAGE_SIZE;

      const merged: HistoryItem[] = [
        ...personaRes.data.map((s) => ({
          id: s.id,
          type: "persona" as const,
          agentId: s.personaId,
          agentName: personaMap.get(s.personaId),
          title: s.title,
          messages: (s.messages ?? []) as Array<{ role: string; content: string }>,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
        ...kolRes.data.map((s) => ({
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
      setTotalCount(personaRes.total + kolRes.total);

      // 构建筛选下拉选项
      const options: AgentOption[] = [
        ...personas.map((p) => ({ value: `persona-${p.id}`, label: p.name, type: "persona" as const })),
        ...kols.map((k) => ({ value: `kol-${k.id}`, label: k.name, type: "kol" as const })),
      ].sort((a, b) => a.label.localeCompare(b.label, "zh"));
      setAgentOptions(options);
    });
  }, []);

  // 哨兵 IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: "200px", threshold: 0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const personaOptions = agentOptions.filter((o) => o.type === "persona");
  const kolOptions = agentOptions.filter((o) => o.type === "kol");

  const getAgentLabel = (value: string) => {
    if (!value) return "全部画像";
    return agentOptions.find((o) => o.value === value)?.label ?? "全部画像";
  };

  const handleDelete = useCallback(
    async (e: React.MouseEvent, id: number, type: "persona" | "kol") => {
      e.preventDefault();
      e.stopPropagation();
      if (!window.confirm("确定要删除这条对话记录吗？此操作不可恢复。")) return;
      try {
        if (type === "persona") {
          await api.deleteChatSession(id);
        } else {
          await api.deleteKolChatSession(id);
        }
        setItems((prev) => prev.filter((i) => !(i.type === type && i.id === id)));
        setTotalCount((prev) => prev - 1);
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(`${type}-${id}`);
          return next;
        });
        toast.success("对话已删除");
      } catch {
        toast.error("删除失败，请重试");
      }
    },
    [],
  );

  // 筛选：按具体画像 + 搜索
  const filtered = useMemo(() => {
    let list = items.filter((s) => s.messages.length > 0);

    if (filterAgent) {
      const [type, idStr] = filterAgent.split("-");
      const agentId = Number(idStr);
      list = list.filter((s) => s.type === type && s.agentId === agentId);
    }

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
  }, [items, search, filterAgent]);

  const itemKey = useCallback((i: HistoryItem) => `${i.type}-${i.id}`, []);

  // 进入/退出批量模式时清空选中
  const enterBatchMode = useCallback(() => {
    setBatchMode(true);
    setSelected(new Set());
  }, []);

  const exitBatchMode = useCallback(() => {
    setBatchMode(false);
    setSelected(new Set());
  }, []);

  const toggleSelect = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === filtered.length && filtered.length > 0) {
        return new Set();
      }
      return new Set(filtered.map(itemKey));
    });
  }, [filtered, itemKey]);

  const handleBatchDelete = useCallback(async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`确定要删除选中的 ${selected.size} 条对话记录吗？此操作不可恢复。`)) return;

    let successCount = 0;
    let failCount = 0;

    for (const key of selected) {
      const [type, idStr] = key.split("-");
      const id = Number(idStr);
      try {
        if (type === "persona") {
          await api.deleteChatSession(id);
        } else {
          await api.deleteKolChatSession(id);
        }
        successCount++;
      } catch {
        failCount++;
      }
    }

    setItems((prev) => prev.filter((i) => !selected.has(itemKey(i))));
    setTotalCount((prev) => prev - selected.size);
    setSelected(new Set());
    setBatchMode(false);

    if (failCount > 0) {
      toast.warning(`已删除 ${successCount} 条，${failCount} 条失败`);
    } else {
      toast.success(`已删除 ${successCount} 条对话`);
    }
  }, [selected, itemKey]);

  const allSelected = filtered.length > 0 && selected.size === filtered.length;

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
          共 {totalCount} 条对话记录
        </p>
      </div>

      {/* 搜索 + 筛选 + 批量删除 同一行 */}
      <div className="flex items-center gap-2">
        {/* 搜索框：占左半部分，从最左到中间 */}
        <div className="relative w-1/2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[--color-muted-foreground]" />
          <Input
            placeholder="搜索历史对话..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
              <Button variant="outline" size="default" className="gap-1 font-normal">
                {getAgentLabel(filterAgent)}
                <ChevronDown className="h-4 w-4 text-(--color-muted-foreground)" />
              </Button>
            </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
            <DropdownMenuItem
              onClick={() => setFilterAgent("")}
              className="gap-2"
            >
              {!filterAgent && <Check className="h-4 w-4" />}
              <span className={!filterAgent ? "" : "ml-6"}>全部</span>
            </DropdownMenuItem>
            {personaOptions.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>群体画像</DropdownMenuLabel>
                {personaOptions.map((o) => (
                  <DropdownMenuItem
                    key={o.value}
                    onClick={() => setFilterAgent(o.value)}
                    className="gap-2"
                  >
                    {filterAgent === o.value && <Check className="h-4 w-4" />}
                    <span className={filterAgent === o.value ? "" : "ml-6"}>{o.label}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
            {kolOptions.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>KOL</DropdownMenuLabel>
                {kolOptions.map((o) => (
                  <DropdownMenuItem
                    key={o.value}
                    onClick={() => setFilterAgent(o.value)}
                    className="gap-2"
                  >
                    {filterAgent === o.value && <Check className="h-4 w-4" />}
                    <span className={filterAgent === o.value ? "" : "ml-6"}>{o.label}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 中间占位，推批量删除到最右 */}
        <div className="flex-1" />

        {/* 批量删除 最右 */}
        {batchMode ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            <label className="flex items-center gap-1.5 text-sm text-(--color-muted-foreground) cursor-pointer select-none whitespace-nowrap">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="h-4 w-4 rounded border-(--color-border) accent-(--color-primary) cursor-pointer"
              />
              全选
            </label>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleBatchDelete}
              disabled={selected.size === 0}
              className="gap-1"
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除 ({selected.size})
            </Button>
            <Button variant="outline" size="default" onClick={exitBatchMode} className="gap-1 font-normal">
              <X className="h-4 w-4" /> 取消
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="default" onClick={enterBatchMode} className="gap-1 flex-shrink-0 font-normal">
            <CheckSquare className="h-4 w-4" /> 批量删除
          </Button>
        )}
      </div>

      {filtered.length > 0 ? (
        <div className="space-y-2">
          {filtered.map((s) => {
            const key = itemKey(s);
            const title = getTitle(s);
            const preview = getPreview(s);
            const chatPath =
              s.type === "persona"
                ? `/personas/${s.agentId}/chat?session=${s.id}`
                : `/kol/${s.agentId}/chat?session=${s.id}`;
            const roundCount = Math.floor(s.messages.length / 2);

            return (
              <div
                key={key}
                className={batchMode ? "relative cursor-pointer" : ""}
                onClick={batchMode ? () => toggleSelect(key) : undefined}
              >
                {batchMode && (
                  <div className="absolute right-3 bottom-2 z-10 pointer-events-none">
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      readOnly
                      className="h-4 w-4 rounded border-(--color-border) accent-(--color-primary)"
                    />
                  </div>
                )}
                <div className={batchMode ? "pointer-events-none" : ""}>
                  <SessionCard
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
                </div>
              </div>
            );
          })}
          {/* 无限滚动哨兵 */}
          <div ref={sentinelRef} className="h-1" />
          {isLoadingMore && (
            <div className="flex items-center justify-center py-4">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[--color-primary] border-t-transparent" />
              <span className="ml-2 text-sm text-[--color-muted-foreground]">加载更多...</span>
            </div>
          )}
        </div>
      ) : search || filterAgent ? (
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