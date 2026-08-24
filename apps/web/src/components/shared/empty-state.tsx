// EmptyState — 空状态展示
import { type LucideIcon, PackageOpen } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon = PackageOpen,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 px-4 text-center",
        className,
      )}
    >
      <div className="w-16 h-16 rounded-2xl bg-(--color-surface-secondary) flex items-center justify-center mb-4">
        <Icon className="h-8 w-8 text-(--color-content-tertiary)" />
      </div>
      <p className="text-sm font-medium text-(--color-content-secondary)">
        {title}
      </p>
      {description && (
        <p className="text-xs text-(--color-content-tertiary) mt-1.5 max-w-[320px]">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}