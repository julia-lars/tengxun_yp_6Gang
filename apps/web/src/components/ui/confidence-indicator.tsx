// 置信度指示器 — 五圆点 + 文字等级
import { cn } from "@/lib/utils";

interface ConfidenceIndicatorProps {
  score: number; // 0-1
  showLabel?: boolean;
  size?: "sm" | "md";
}

function getLevel(score: number): { label: string; filled: number; color: string } {
  if (score >= 0.8) return { label: "高", filled: 5, color: "var(--color-success)" };
  if (score >= 0.6) return { label: "中", filled: 3, color: "var(--color-warning)" };
  return { label: "低", filled: 2, color: "var(--color-destructive)" };
}

export function ConfidenceIndicator({
  score,
  showLabel = true,
  size = "sm",
}: ConfidenceIndicatorProps) {
  const { label, filled, color } = getLevel(score);
  const dotSize = size === "sm" ? "w-2 h-2" : "w-2.5 h-2.5";

  return (
    <span className={cn("inline-flex items-center gap-1", size === "sm" ? "text-xs" : "text-sm")}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={`confidence-dot-${i}`}
          className={cn(dotSize, "rounded-full transition-colors")}
          style={{ background: i < filled ? color : "var(--color-border)" }}
        />
      ))}
      {showLabel && (
        <span className="ml-1 text-[--color-muted-foreground]" style={{ color }}>
          {label}
        </span>
      )}
    </span>
  );
}
