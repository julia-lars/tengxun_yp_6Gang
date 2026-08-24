// TagBadge — 标签 Badge 组件（支持选中/禁用/冲突状态）
import { Star, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface TagBadgeProps {
  label: string;
  value: string;
  isActive: boolean;
  isPrimary?: boolean;
  isDisabled?: boolean;
  disabledReason?: string | null;
  noMatch?: boolean;
  onClick: () => void;
}

export function TagBadge({
  label,
  isActive,
  isPrimary = false,
  isDisabled = false,
  disabledReason,
  noMatch = false,
  onClick,
}: TagBadgeProps) {
  const badge = (
    <Badge
      variant={isActive ? "default" : "outline"}
      className={cn(
        "cursor-pointer hover:opacity-80 transition-all duration-150 select-none",
        isDisabled && "opacity-30 cursor-not-allowed hover:opacity-30",
        isPrimary && isActive && "ring-1 ring-(--color-brand-300)",
        noMatch && isActive && "animate-pulse",
      )}
      onClick={() => {
        if (isDisabled) return;
        onClick();
      }}
    >
      {isPrimary && isActive ? (
        <Star className="h-3 w-3 mr-1 text-yellow-500" />
      ) : isActive ? (
        <X className="h-3 w-3 mr-1" />
      ) : null}
      {label}
    </Badge>
  );

  if (isDisabled && disabledReason) {
    return (
      <Tooltip
        content={
          <div className="max-w-[240px] text-xs">
            <p className="font-medium">⚠ 与已选标签冲突</p>
            <p className="text-(--color-content-tertiary) mt-0.5">{disabledReason}</p>
          </div>
        }
      >
        {badge}
      </Tooltip>
    );
  }

  return badge;
}