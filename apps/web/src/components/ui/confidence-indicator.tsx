// 置信度指示器 — 简洁文字版（低/中/高）
import { cn } from "@/lib/utils";

interface ConfidenceIndicatorProps {
  score: number; // 0-1
  showLabel?: boolean;
  size?: "sm" | "md";
}

function getLevel(score: number): { label: string } {
  if (score >= 0.8) return { label: "高" };
  if (score >= 0.6) return { label: "中" };
  return { label: "低" };
}

export function ConfidenceIndicator({
  score,
  showLabel = true,
  size = "sm",
}: ConfidenceIndicatorProps) {
  const { label } = getLevel(score);

  if (!showLabel) return null;

  return (
    <span className={cn("font-medium", size === "sm" ? "text-xs" : "text-sm")}>
      可信度: {label}
    </span>
  );
}