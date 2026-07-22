// 根布局：顶栏 + 单栏内容区
import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router";
import { AppHeader } from "./components/AppHeader";
import { Toaster } from "./components/ui/sonner";

export function Root() {
  const mainRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();

  useEffect(() => { mainRef.current?.scrollTo(0, 0); }, [pathname]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[--color-background] text-[--color-foreground]">
      <AppHeader />
      <main ref={mainRef} className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[860px] mx-auto px-4 sm:px-6 py-6 sm:py-10">
          <Outlet />
        </div>
      </main>
      <Toaster position="top-right" />
    </div>
  );
}
