// 简洁筛选组件 — 3 道选择题（单张卡片内纵向排列，Q1 多选，Q2-Q3 单选）
import { RotateCcw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { parseMultiValue, SIMPLE_QUESTIONS, type SimpleFilterValue } from "@/lib/simple-filter";

interface SimpleFilterProps {
  value: SimpleFilterValue;
  onChange: (id: string, key: string) => void;
  onClear: () => void;
}

export function SimpleFilter({ value, onChange, onClear }: SimpleFilterProps) {
  const anySelected = Object.values(value).some(Boolean);

  return (
    <div className="space-y-5">
      {SIMPLE_QUESTIONS.map((q, idx) => {
        const raw = value[q.id] ?? "";
        const isMulti = q.multi === true;
        const selectedSet = isMulti ? parseMultiValue(raw) : null;
        const selectedCount = selectedSet?.size ?? 0;
        const atMax = isMulti && selectedCount >= (q.maxSelection ?? 99);

        return (
          <div key={q.id}>
            <p className="text-sm font-medium text-(--color-muted-foreground) mb-2">
              <span className="mr-1.5">{idx + 1}.</span>
              {q.title}
              {q.subtitle && (
                <span className="text-xs ml-1.5 opacity-60">（{q.subtitle}）</span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {q.options.map((opt) => {
                const isActive = isMulti ? selectedSet!.has(opt.key) : raw === opt.key;
                const isDisabled = isMulti && !isActive && atMax;

                return (
                  <Badge
                    key={opt.key}
                    variant={isActive ? "default" : "outline"}
                    className={`cursor-pointer hover:opacity-80 transition-all duration-150 select-none font-normal ${
                      isDisabled ? "opacity-30 cursor-not-allowed hover:opacity-30" : ""
                    }`}
                    title={opt.hint}
                    onClick={() => {
                      if (isDisabled) return;
                      onChange(q.id, opt.key);
                    }}
                  >
                    {isActive && <X className="h-3 w-3 mr-1" />}
                    {opt.label}
                  </Badge>
                );
              })}
            </div>
            {isMulti && selectedCount > 0 && (
              <p className="text-xs text-(--color-muted-foreground) mt-1">
                已选 {selectedCount}/{q.maxSelection ?? 3} 项
              </p>
            )}
          </div>
        );
      })}

      {anySelected && (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 text-xs text-(--color-muted-foreground) hover:text-(--color-foreground) transition-colors"
        >
          <RotateCcw className="h-3 w-3" /> 清空选择
        </button>
      )}
    </div>
  );
}