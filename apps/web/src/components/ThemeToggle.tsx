// --------------------------------------------------------------
// 主题切换按钮：在 <html> 上加 / 去 .dark 类
// - 首次进入读 localStorage，无值时看 prefers-color-scheme
// - 每次 toggle 写回 localStorage
// --------------------------------------------------------------

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem("theme");
    if (saved === "dark") return true;
    if (saved === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setDark((v) => !v)}
      className="text-[var(--color-header-foreground)] hover:bg-white/10"
      aria-label={dark ? "切换到浅色主题" : "切换到深色主题"}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
