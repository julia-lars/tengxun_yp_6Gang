// 历史列表侧边栏 — 大纲列表、搜索过滤、选中切换、删除
import type { InterviewOutline } from "@app/shared";
import { Clock, FileText, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface HistorySidebarProps {
  history: InterviewOutline[];
  activeOutlineId: string | null;
  onSelect: (outline: InterviewOutline) => void;
  onDelete: (outline: InterviewOutline) => void;
}

export function HistorySidebar({
  history,
  activeOutlineId,
  onSelect,
  onDelete,
}: HistorySidebarProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return history;
    const q = search.toLowerCase();
    return history.filter(
      (o) =>
        o.theme.toLowerCase().includes(q) ||
        (o.targetPersona && o.targetPersona.toLowerCase().includes(q)),
    );
  }, [history, search]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-3 pt-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-(--color-content-tertiary)" />
          <Input
            placeholder="搜索大纲..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-7 h-8 text-xs"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pt-1 pb-2">
        {filtered.length === 0 ? (
          <p className="text-xs text-(--color-content-tertiary) text-center py-8 px-2">
            {search.trim() ? "无匹配结果" : "暂无历史大纲"}
          </p>
        ) : (
          <div className="space-y-1">
            {filtered.map((o) => {
              const isActive = o.id === activeOutlineId;
              return (
                <div
                  key={o.id}
                  className={cn(
                    "group flex items-start gap-2 p-2 rounded-md transition-colors cursor-pointer",
                    isActive
                      ? "bg-(--color-brand-50) ring-1 ring-(--color-brand-200)"
                      : "hover:bg-(--color-surface-secondary)",
                  )}
                  onClick={() => onSelect(o)}
                  onKeyDown={(e) => e.key === "Enter" && onSelect(o)}
                  tabIndex={0}
                  role="button"
                >
                  <FileText
                    className={cn(
                      "h-4 w-4 flex-shrink-0 mt-0.5",
                      isActive
                        ? "text-(--color-brand-500)"
                        : "text-(--color-content-tertiary)",
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{o.theme}</p>
                    <p className="text-[10px] text-(--color-content-tertiary) mt-0.5 flex items-center gap-1.5">
                      <Clock className="h-3 w-3" />
                      {o.sections.length} 章节 ·{" "}
                      {o.sections.reduce(
                        (sum, s) => sum + s.questions.length,
                        0,
                      )}{" "}
                      题
                    </p>
                    {o.targetPersona && o.targetPersona !== "通用" && (
                      <p className="text-[10px] text-(--color-content-tertiary) truncate">
                        {o.targetPersona}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-(--color-content-tertiary) hover:text-red-500"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(o);
                    }}
                    title="删除大纲"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}