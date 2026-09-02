// 置信度指示器 — 可点击展开三维分解详情
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface ConfidenceIndicatorProps {
  score: number; // 0-1
  breakdown?: {
    evidenceScore: number;
    consistencyScore: number;
    evidenceCountScore: number;
  };
  flags?: string[];
  showLabel?: boolean;
  size?: "sm" | "md";
  evidenceCount?: number;
}

function getLevel(score: number): { label: string; color: string } {
  if (score >= 0.8) return { label: "高", color: "text-green-600 dark:text-green-400" };
  if (score >= 0.6) return { label: "中", color: "text-yellow-600 dark:text-yellow-400" };
  return { label: "低", color: "text-red-600 dark:text-red-400" };
}

const flagLabel: Record<string, string> = {
  low_evidence: "证据不足",
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
  evidenceCount,
}: ConfidenceIndicatorProps) {
  const { label, color } = getLevel(score);
  const [expanded, setExpanded] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (!showLabel) return null;

  const hasDetail = breakdown || (flags && flags.length > 0);

  // 计算展开内容的位置（相对于 trigger 按钮）
  const recalcPosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPopoverStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left,
      zIndex: 60,
    });
  };

  const handleToggle = () => {
    if (!hasDetail) return;
    const next = !expanded;
    setExpanded(next);
    if (next) {
      // 展开时计算位置，延迟一帧确保 DOM 更新
      requestAnimationFrame(recalcPosition);
    }
  };

  // 窗口大小变化时重新计算位置
  useEffect(() => {
    if (!expanded) return;
    const onResize = () => recalcPosition();
    window.addEventListener("resize", onResize);
    // 滚动容器可能改变 trigger 位置，用 scroll 事件处理
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [expanded]);

  const popover = hasDetail && expanded && (
    <div
      className="w-48 rounded-lg border border-(--color-border) bg-(--color-surface-primary) shadow-lg p-3 space-y-2"
      style={popoverStyle}
    >
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
              <span className="text-(--color-content-tertiary)">证据量</span>
              <span className="font-medium text-(--color-content-primary)">
                {Math.round(breakdown.evidenceCountScore * 100)}%
                {evidenceCount !== undefined && (
                  <span className="text-(--color-content-tertiary) font-normal ml-1">
                    ({evidenceCount} 条证据)
                  </span>
                )}
              </span>
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
  );

  return (
    <div className="relative inline-flex flex-col">
      {/* 点击空白关闭遮罩 */}
      {hasDetail && expanded && (
        <div className="fixed inset-0 z-50" onClick={() => setExpanded(false)} />
      )}
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          "flex items-center gap-1 font-medium transition-colors",
          size === "sm" ? "text-xs" : "text-sm",
          color,
          hasDetail ? "cursor-pointer hover:underline" : "cursor-default",
        )}
        onClick={handleToggle}
        title={hasDetail ? "点击查看详情" : undefined}
      >
        可信度: {label} ({Math.round(score * 100)}%)
        {hasDetail && (
          expanded
            ? <ChevronUp className="h-3 w-3" />
            : <ChevronDown className="h-3 w-3" />
        )}
      </button>

      {/* 通过 Portal 渲染到 body，避免被父级 overflow/stacking context 裁剪 */}
      {createPortal(popover, document.body)}
    </div>
  );
}