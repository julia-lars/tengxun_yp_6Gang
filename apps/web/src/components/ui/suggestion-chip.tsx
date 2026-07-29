// 建议追问 — AI 回答后可选的追问提示

import { Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";

interface SuggestionChipProps {
  text: string;
  onClick: (text: string) => void;
  className?: string;
}

export function SuggestionChip({ text, onClick, className }: SuggestionChipProps) {
  return (
    <button
      type="button"
      onClick={() => onClick(text)}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs",
        "border border-[--color-border] bg-[--color-card]",
        "text-[--color-muted-foreground] hover:text-[--color-primary] hover:border-[--color-primary]",
        "transition-all duration-150",
        className,
      )}
    >
      <Lightbulb className="h-3 w-3" />
      {text}
    </button>
  );
}
