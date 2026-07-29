// 匹配反馈面板 — 实时显示匹配画像数和样本量变化
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Info, Search } from "lucide-react";

interface MatchFeedbackProps {
  personaCount: number;
  sampleCount: number;
  previousCount?: number;
  limitingTag?: string;
  lowSample?: boolean;
  noMatch?: boolean;
  suggestions?: { action: string; expectedCount: number }[];
  onApplySuggestion?: (action: string) => void;
  className?: string;
}

export function MatchFeedback({
  personaCount,
  sampleCount,
  previousCount,
  limitingTag,
  lowSample,
  noMatch,
  suggestions,
  onApplySuggestion,
  className,
}: MatchFeedbackProps) {
  if (noMatch) {
    return (
      <div className={cn("rounded-lg border border-[--color-warning]/30 bg-[--color-warning]/5 p-4 space-y-3", className)}>
        <div className="flex items-center gap-2 text-sm">
          <Search className="h-4 w-4 text-[--color-warning]" />
          <span className="text-[--color-foreground] font-medium">当前标签组合没有精确匹配的画像</span>
        </div>
        {limitingTag && (
          <p className="text-xs text-[--color-muted-foreground]">
            最接近的条件是 <span className="text-[--color-warning] font-medium">"{limitingTag}"</span> 导致了结果骤减
          </p>
        )}
        {suggestions && suggestions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[--color-muted-foreground]">放宽建议</p>
            {suggestions.map((s, i) => (
              <div key={i} className="flex items-center justify-between text-xs bg-[--color-card] rounded p-2">
                <span className="text-[--color-muted-foreground]">
                  {s.action} → 预计匹配 <span className="text-[--color-primary] font-medium">{s.expectedCount}</span> 个画像
                </span>
                {onApplySuggestion && (
                  <button
                    type="button"
                    onClick={() => onApplySuggestion(s.action)}
                    className="text-[--color-primary] hover:underline font-medium ml-2"
                  >
                    一键应用
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-sm", className)}>
      <span className="flex items-center gap-1.5 text-[--color-foreground] font-medium">
        <CheckCircle2 className="h-4 w-4 text-[--color-success]" />
        匹配到 <span className="text-[--color-primary]">{personaCount}</span> 个画像
      </span>
      <span className="text-[--color-muted-foreground]">
        · 基于 <span className="text-[--color-foreground]">{sampleCount.toLocaleString()}</span> 个匹配样本
      </span>
      {previousCount !== undefined && previousCount !== personaCount && (
        <span
          className={cn(
            "text-xs px-2 py-0.5 rounded-full animate-count-change",
            personaCount < previousCount
              ? "bg-[--color-warning]/10 text-[--color-warning]"
              : "bg-[--color-success]/10 text-[--color-success]",
          )}
        >
          {personaCount < previousCount ? `-${((1 - personaCount / previousCount) * 100).toFixed(0)}%` : `+${((personaCount / previousCount - 1) * 100).toFixed(0)}%`}
        </span>
      )}
      {lowSample && (
        <span className="flex items-center gap-1 text-xs text-[--color-warning]">
          <AlertTriangle className="h-3 w-3" />
          低样本警告
        </span>
      )}
      {limitingTag && !noMatch && (
        <span className="flex items-center gap-1 text-xs text-[--color-muted-foreground]">
          <Info className="h-3 w-3" />
          限制条件: {limitingTag}
        </span>
      )}
    </div>
  );
}