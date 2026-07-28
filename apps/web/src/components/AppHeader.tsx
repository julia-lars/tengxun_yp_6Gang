// 顶栏 — AI 模拟用户系统
import { Link } from "react-router";
import { ThemeToggle } from "./ThemeToggle";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 h-12 lg:h-14 bg-[var(--color-header)] text-[var(--color-header-foreground)] border-b border-[var(--color-header-border)]">
      <div className="h-full px-4 lg:px-6 flex items-center gap-4">
        <Link to="/" className="flex items-baseline gap-3 min-w-0">
          <span className="font-serif text-base lg:text-lg tracking-wide whitespace-nowrap">
            AI 模拟用户系统
          </span>
          <span className="hidden xl:inline text-[10px] tracking-[0.3em] text-[var(--color-header-muted)]">
            MUR · USER THINK TANK
          </span>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <Link
            to="/personas"
            className="text-xs text-[var(--color-header-muted)] hover:text-[var(--color-header-foreground)] transition-colors"
          >
            画像系统
          </Link>
          <ThemeToggle className="text-[var(--color-header-foreground)] hover:bg-white/10" />
        </div>
      </div>
    </header>
  );
}
