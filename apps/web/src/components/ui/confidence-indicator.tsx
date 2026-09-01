// 置信度指示器 — 可点击展开三维分解详情
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface ConfidenceIndicatorProps {
  score: number; // 0-1
  breakdown?: {
    evidenceScore: number;
    consistencyScore: number;
    sampleScore: number;
  };
  flags?: string[];
  showLabel?: boolean;
  size?: "sm" | "md";
}

function getLevel(score: number): { label: string; color: string } {
  if (score >= 0.8) return { label: "高", color: "text-green-600 dark:text-green-400" };
  if (score >= 0.6) return { label: "中", color: "text-yellow-600 dark:text-yellow-400" };
  return { label: "低", color: "text-red-600 dark:text-red-400" };
}

const flagLabel: Record<string, string> = {
  low_sample: "低样本",
  inferred: "基于推断",
  boundary: "边界外推",
  low_confidence: "低置信度",
};

export function ConfidenceIndicator({
  score,
  breakdown,
  flags,
  showLabel = true,
  size = "sm",
}: ConfidenceIndicatorProps) {
  const { label, color } = getLevel(score);
  const [expanded, setExpanded] = useState(false);

  if (!showLabel) return null;

  const hasDetail = breakdown || (flags && flags.length > 0);

  return (
    <div className={cn("relative inline-flex flex-col", hasDetail && expanded && "z-20")}>
      {/* 点击空白关闭遮罩 */}
      {hasDetail && expanded && (
        <div className="fixed inset-0 z-10" onClick={() => setExpanded(false)} />
      )}
      <button
        type="button"
        className={cn(
          "flex items-center gap-1 font-medium transition-colors",
          size === "sm" ? "text-xs" : "text-sm",
          color,
          hasDetail ? "cursor-pointer hover:underline" : "cursor-default",
        )}
        onClick={() => hasDetail && setExpanded(!expanded)}
        title={hasDetail ? "点击查看详情" : undefined}
      >
        可信度: {label} ({Math.round(score * 100)}%)
        {hasDetail && (
          expanded
            ? <ChevronUp className="h-3 w-3" />
            : <ChevronDown className="h-3 w-3" />
        )}
      </button>

      {hasDetail && expanded && (
        <div className="absolute top-full left-0 mt-1 z-20 w-48 rounded-lg border border-(--color-border) bg-(--color-surface-primary) shadow-lg p-3 space-y-2">
          {breakdown && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-(--color-content-secondary)">三维分解</p>
              <div className="space-y-0.5">
                <div className="flex justify-between text-xs">
                  <span className="text-(--color-content-tertiary)">证据匹配度</span>
                  <span className="font-medium text-(--color-content-primary)">{Math.round(breakdown.evidenceScore * 100)}%</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-(--color-content-tertiary)">标签一致性</span>
                  <span className="font-medium text-(--color-content-primary)">{Math.round(breakdown.consistencyScore * 100)}%</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-(--color-content-tertiary)">样本量</span>
                  <span className="font-medium text-(--color-content-primary)">{Math.round(breakdown.sampleScore * 100)}%</span>
                </div>
              </div>
            </div>
          )}

          {flags && flags.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-(--color-content-secondary)">风险标记</p>
              <div className="flex flex-wrap gap-1">
                {flags.map((f) => (
                  <span
                    key={f}
                    className="text-[10px] text-(--color-content-tertiary) bg-(--color-surface-secondary) px-1.5 py-0.5 rounded"
                  >
                    {flagLabel[f] ?? f}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}