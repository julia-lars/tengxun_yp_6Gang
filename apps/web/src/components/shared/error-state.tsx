// ErrorState — 错误状态展示
import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = "加载失败",
  message = "请检查网络连接后重试",
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 px-4 text-center",
        className,
      )}
    >
      <div className="w-16 h-16 rounded-2xl bg-(--color-error-50) flex items-center justify-center mb-4">
        <AlertTriangle className="h-8 w-8 text-(--color-error-500)" />
      </div>
      <p className="text-sm font-medium text-(--color-content-primary)">
        {title}
      </p>
      <p className="text-xs text-(--color-content-secondary) mt-1.5 max-w-[320px]">
        {message}
      </p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-4">
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          重试
        </Button>
      )}
    </div>
  );
}