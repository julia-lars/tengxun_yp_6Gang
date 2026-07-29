// 打字光标 — 跟随 AI 流式输出
import { cn } from "@/lib/utils";

interface TypingCursorProps {
  active: boolean;
  className?: string;
}

export function TypingCursor({ active, className }: TypingCursorProps) {
  if (!active) return null;
  return <span className={cn("typing-cursor", className)} />;
}
