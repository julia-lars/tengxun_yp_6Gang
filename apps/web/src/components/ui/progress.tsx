// Progress — 进度条
import * as React from "react";
import { cn } from "@/lib/utils";

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-(--color-surface-secondary)",
        className,
      )}
      {...props}
    >
      <div
        className="h-full rounded-full bg-(--color-brand-500) transition-all duration-500 ease-out"
        style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
      />
    </div>
  ),
);
Progress.displayName = "Progress";

export { Progress };