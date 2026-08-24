// AI 思考指示器 — 三点弹跳动画
import { cn } from "@/lib/utils";

interface ThinkingDotsProps {
  className?: string;
  showText?: boolean;
}

export function ThinkingDots({ className, showText = false }: ThinkingDotsProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex items-center gap-4 px-4 py-3 rounded-lg bg-(--color-secondary)">
        <div className="thinking-dots">
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
        </div>
      </div>
      {showText && <span className="text-xs text-(--color-muted-foreground)">正在思考...</span>}
    </div>
  );
}
