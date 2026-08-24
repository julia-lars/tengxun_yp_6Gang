// PageHeader — 页面标题区域
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4",
        className,
      )}
    >
      <div className="space-y-1">
        <h1 className="text-2xl sm:text-3xl font-bold text-black font-serif">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-(--color-content-secondary) max-w-[640px]">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
      )}
    </div>
  );
}