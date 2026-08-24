// AppHeader — 顶栏：极简化，导航交由侧栏负责
import {
  ChevronDown,
  FilePlus,
  Menu,
  Plus,
  Search,
} from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { SearchBox } from "@/components/SearchBox";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface AppHeaderProps {
  /** 移动端汉堡按钮回调 */
  onMobileMenuToggle: () => void;
  /** 侧栏是否折叠 */
  sidebarCollapsed: boolean;
}

export function AppHeader({ onMobileMenuToggle, sidebarCollapsed }: AppHeaderProps) {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-50 h-14 bg-(--color-surface-elevated) border-b border-(--color-border-default) shadow-sm">
      <div className="h-full flex items-center">
        {/* 左侧：Logo 区，宽度匹配侧栏 */}
        <div
          className={cn(
            "hidden md:flex items-center flex-shrink-0 transition-all duration-300 overflow-hidden",
            sidebarCollapsed ? "w-16" : "w-56",
          )}
        >
          <div className="px-3 lg:px-5">
            <Logo size="md" showSubtitle className="flex-shrink-0" />
          </div>
        </div>

        {/* 移动端：汉堡 + Logo */}
        <div className="flex md:hidden items-center gap-3 px-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-shrink-0"
            onClick={onMobileMenuToggle}
            aria-label="打开菜单"
          >
            <Menu className="h-4 w-4" />
          </Button>
          <Logo size="md" showSubtitle className="flex-shrink-0" />
        </div>

        {/* 右侧：内容区，与主内容对齐 */}
        <div className="flex-1 flex items-center gap-3 px-4 sm:px-6 lg:px-8 min-w-0">
          {/* 全局搜索框 */}
          <SearchBox />

          {/* 右侧操作区 */}
          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            {/* 移动端搜索图标 */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 sm:hidden"
              onClick={() => navigate("/history")}
              aria-label="搜索"
            >
              <Search className="h-4 w-4 text-(--color-content-secondary)" />
            </Button>

            {/* 新建下拉 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="default"
                  size="sm"
                  className="h-8 gap-1 text-xs"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">新建</span>
                  <ChevronDown className="h-3 w-3 opacity-50 hidden sm:block" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={() => navigate("/personas/new")}>
                  <FilePlus className="h-4 w-4" />
                  新建画像
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/kol/new")}>
                  <FilePlus className="h-4 w-4" />
                  新建 KOL
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 主题切换 */}
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}