// Logo — 品牌标识
import { Link } from "react-router";
import { cn } from "@/lib/utils";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  showSubtitle?: boolean;
  className?: string;
}

export function Logo({ size = "md", showSubtitle = false, className }: LogoProps) {
  const sizeClasses = {
    sm: "text-sm gap-2",
    md: "text-base gap-2.5",
    lg: "text-lg gap-3",
  };

  const iconSizes = {
    sm: "h-6 w-6",
    md: "h-7 w-7",
    lg: "h-8 w-8",
  };

  return (
    <Link to="/" className={cn("flex items-center group", sizeClasses[size], className)}>
      <div
        className={cn(
          "rounded-lg bg-gradient-to-br from-(--color-brand-500) to-(--color-brand-700) flex items-center justify-center text-white font-bold shadow-sm",
          iconSizes[size],
        )}
      >
        <span className={size === "sm" ? "text-xs" : size === "lg" ? "text-sm" : "text-xs"}>
          6G
        </span>
      </div>
      <div className="flex flex-col leading-tight">
        <span className="font-serif font-bold text-black tracking-tight">
          AI 模拟用户
        </span>
        {showSubtitle && (
          <span className="text-[10px] text-(--color-content-tertiary) tracking-[0.2em] font-medium">
            MUR · THINK TANK
          </span>
        )}
      </div>
    </Link>
  );
}