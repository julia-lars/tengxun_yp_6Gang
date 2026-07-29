// 三态标签 — 用于二级模式标签（未表态/喜欢/回避）
import { cn } from "@/lib/utils";
import { ThumbsDown, ThumbsUp } from "lucide-react";

export type TriState = "neutral" | "liked" | "disliked";

interface TriStateTagProps {
  label: string;
  value: TriState;
  onChange: (value: TriState) => void;
  disabled?: boolean;
  className?: string;
}

const STATE_CYCLE: Record<TriState, TriState> = {
  neutral: "liked",
  liked: "disliked",
  disliked: "neutral",
};

const STATE_STYLE: Record<TriState, string> = {
  neutral:
    "border-[--color-border] bg-transparent text-[--color-muted-foreground]",
  liked:
    "border-[--color-success] bg-[--color-success]/15 text-[--color-success]",
  disliked:
    "border-[--color-destructive] bg-[--color-destructive]/10 text-[--color-destructive] line-through",
};

export function TriStateTag({
  label,
  value,
  onChange,
  disabled,
  className,
}: TriStateTagProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(STATE_CYCLE[value])}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium",
        "border transition-all duration-150",
        "hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed",
        STATE_STYLE[value],
        className,
      )}
    >
      {label}
      {value === "liked" && <ThumbsUp className="h-3 w-3" />}
      {value === "disliked" && <ThumbsDown className="h-3 w-3" />}
    </button>
  );
}