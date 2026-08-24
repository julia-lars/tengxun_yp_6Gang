// 根布局：侧边栏 + 顶栏 + 内容区
import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

export function Root() {
  const mainRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const scrollPositions = useRef<Record<string, number>>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebarCollapsed") === "true";
    } catch {
      return false;
    }
  });

  // 移动端侧栏抽屉状态
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // 持续记录当前页面的滚动位置
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const onScroll = () => {
      scrollPositions.current[pathname] = el.scrollTop;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [pathname]);

  // 路由变化时恢复滚动位置（有记录则恢复，无记录则滚到顶部）+ 关闭移动端侧栏
  useEffect(() => {
    const saved = scrollPositions.current[pathname];
    if (saved !== undefined && saved > 0) {
      requestAnimationFrame(() => {
        mainRef.current?.scrollTo(0, saved);
      });
    } else {
      mainRef.current?.scrollTo(0, 0);
    }
    setMobileSidebarOpen(false);
  }, [pathname]);

  // 持久化侧栏折叠状态
  useEffect(() => {
    try {
      localStorage.setItem("sidebarCollapsed", String(sidebarCollapsed));
    } catch {
      // localStorage 不可用
    }
  }, [sidebarCollapsed]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-(--color-surface-primary) text-(--color-content-primary)">
      {/* 顶栏 */}
      <AppHeader
        onMobileMenuToggle={() => setMobileSidebarOpen((v) => !v)}
        sidebarCollapsed={sidebarCollapsed}
      />

      <div className="flex flex-1 min-h-0">
        {/* 侧边栏 */}
        <AppSidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((v) => !v)}
          mobileOpen={mobileSidebarOpen}
          onMobileClose={() => setMobileSidebarOpen(false)}
        />

        {/* 主内容区 */}
        <main
          ref={mainRef}
          className={cn(
            "flex-1 min-h-0 overflow-y-auto transition-all duration-300",
            sidebarCollapsed ? "md:ml-16" : "md:ml-56",
            // 移动端无固定侧栏，不需要 margin
            "ml-0",
          )}
        >
          <div className="max-w-[80%] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
            <Outlet />
          </div>

          {/* 页脚 */}
          <footer className="max-w-[80%] mx-auto px-4 sm:px-6 lg:px-8 pb-8">
            <div className="border-t border-(--color-border-default) pt-6 text-center">
              <p className="text-xs text-(--color-content-tertiary)">
                MUR 用户智库 · 腾讯 IEG 市场与用户研究部 × 北京大学元培学院
              </p>
              <p className="text-[10px] text-(--color-content-tertiary) mt-1">
                AI 生成内容仅供参考，所有画像数据基于真实玩家访谈
              </p>
            </div>
          </footer>
        </main>
      </div>

      {/* Toast 通知 */}
      <Toaster position="top-right" />
    </div>
  );
}