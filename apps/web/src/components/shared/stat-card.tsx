// StatCard — 统计卡片
import { type LucideIcon, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  trend?: { value: number; direction: "up" | "down" };
  description?: string;
  className?: string;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  description,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-(--color-border-default) bg-(--color-surface-elevated) p-5 shadow-sm transition-shadow hover:shadow-md",
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-(--color-content-tertiary) uppercase tracking-wider">
            {label}
          </p>
          <p className="text-2xl font-bold text-black font-serif">
            {value}
          </p>
          {trend && (
            <div className="flex items-center gap-1">
              {trend.direction === "up" ? (
                <TrendingUp className="h-3.5 w-3.5 text-(--color-success-500)" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5 text-(--color-error-500)" />
              )}
              <span
                className={cn(
                  "text-xs font-medium",
                  trend.direction === "up"
                    ? "text-(--color-success-600)"
                    : "text-(--color-error-600)",
                )}
              >
                {trend.value}%
              </span>
            </div>
          )}
          {description && (
            <p className="text-xs text-(--color-content-tertiary)">
              {description}
            </p>
          )}
        </div>
        {Icon && (
          <div className="w-10 h-10 rounded-lg bg-(--color-brand-50) flex items-center justify-center flex-shrink-0">
            <Icon className="h-5 w-5 text-(--color-brand-500)" />
          </div>
        )}
      </div>
    </div>
  );
}