// 分段滑块 — 用于游戏风格双极轴选择
import { cn } from "@/lib/utils";

interface SegmentedControlProps<T extends string> {
  options: { value: T; label: string; icon?: string }[];
  value: T | null;
  onChange: (value: T) => void;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={cn("flex rounded-md border border-[--color-border] overflow-hidden", className)}
    >
      {options.map((opt, i) => {
        const isSelected = value === opt.value;
        const isFirst = i === 0;
        const isLast = i === options.length - 1;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex-1 px-3 py-1.5 text-xs font-medium transition-all duration-150",
              "border-r border-[--color-border] last:border-r-0",
              isSelected
                ? "bg-[--color-primary] text-[--color-primary-foreground]"
                : "bg-transparent text-[--color-muted-foreground] hover:bg-[--color-secondary] hover:text-[--color-foreground]",
            )}
          >
            {opt.icon && <span className="mr-1">{opt.icon}</span>}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
