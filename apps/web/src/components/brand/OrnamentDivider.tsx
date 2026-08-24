// --------------------------------------------------------------
// 中式徽章分隔线：两条横线 + 中央印章样式徽章
// 用于章节标题下方、章节间的视觉分节
// --------------------------------------------------------------

import { cn } from "@/lib/utils";

interface OrnamentDividerProps {
  className?: string;
  /** 徽章中心的字，默认"元" */
  seal?: string;
}

export function OrnamentDivider({ className, seal = "元" }: OrnamentDividerProps) {
  return (
    <div className={cn("my-8 flex items-center gap-4 text-(--color-primary)", className)}>
      <div className="flex-1 h-px bg-current opacity-25" />
      <div className="relative shrink-0">
        <svg
          className="h-8 w-8"
          viewBox="0 0 40 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="装饰徽章"
        >
          <title>装饰徽章</title>
          {/* 外圈方形印章 */}
          <rect
            x="4"
            y="4"
            width="32"
            height="32"
            rx="3"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
          />
          {/* 内圈装饰 */}
          <rect
            x="8"
            y="8"
            width="24"
            height="24"
            rx="2"
            stroke="currentColor"
            strokeWidth="0.6"
            fill="none"
            opacity="0.6"
          />
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center font-serif text-sm font-bold text-(--color-primary) leading-none"
          style={{ paddingTop: "1px" }}
        >
          {seal}
        </span>
      </div>
      <div className="flex-1 h-px bg-current opacity-25" />
    </div>
  );
}
