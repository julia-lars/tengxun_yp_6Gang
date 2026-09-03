// AppSidebar — 侧边栏导航（桌面端固定 + 移动端抽屉）
import {
  BarChart3,
  ChevronLeft,
  Clock,
  Database,
  FilePlus,
  FileText,
  Home,
  type LucideIcon,
  MessageCircle,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { Link, useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface SidebarItem {
  path: string;
  label: string;
  icon: LucideIcon;
  badge?: string | number;
}

const MAIN_ITEMS: SidebarItem[] = [
  { path: "/", label: "首页", icon: Home },
  { path: "/personas", label: "群体画像", icon: Users },
  { path: "/kol", label: "KOL 分身", icon: MessageCircle },
  { path: "/history", label: "历史对话", icon: Clock },
];

const TOOL_ITEMS: SidebarItem[] = [
  { path: "/data-pipeline", label: "数据流水线", icon: Workflow },
  { path: "/interview/outline", label: "访谈大纲", icon: FileText },
  { path: "/interview/batch", label: "批量访谈", icon: BarChart3 },
  { path: "/admin", label: "数据管理", icon: Database },
];

const CREATE_ITEMS: SidebarItem[] = [
  { path: "/personas/new", label: "新建画像", icon: FilePlus },
  { path: "/kol/new", label: "新建 KOL", icon: FilePlus },
];

interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  /** 移动端抽屉是否打开 */
  mobileOpen: boolean;
  /** 关闭移动端抽屉 */
  onMobileClose: () => void;
}

export function AppSidebar({
  collapsed,
  onToggle,
  mobileOpen,
  onMobileClose,
}: AppSidebarProps) {
  const { pathname } = useLocation();

  const isActive = (path: string) => {
    if (path === "/") return pathname === "/";
    // 新建页面不应激活对应的列表项（如 /personas/new 不应高亮 /personas）
    return pathname === path || (pathname.startsWith(`${path}/`) && pathname !== `${path}/new`);
  };

  const sidebarContent = (
    <>
      {/* 折叠按钮 — 桌面端，hover 侧栏时显现 */}
      <div className="hidden md:flex justify-end p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onToggle}
          aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
        >
          <ChevronLeft
            className={cn(
              "h-4 w-4 text-neutral-400 transition-transform duration-300",
              collapsed && "rotate-180",
            )}
          />
        </Button>
      </div>

      {/* 移动端关闭按钮 */}
      <div className="flex md:hidden justify-end p-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onMobileClose}
          aria-label="关闭菜单"
        >
          <X className="h-4 w-4 text-neutral-400" />
        </Button>
      </div>

      {/* 主导航 */}
      <nav className="px-2 space-y-0.5">
        {MAIN_ITEMS.map(({ path, label, icon: Icon, badge }) => (
          <Link
            key={path}
            to={path}
            onClick={onMobileClose}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors group relative",
              isActive(path)
                ? "bg-neutral-100 text-black font-semibold"
                : "text-neutral-700 hover:bg-neutral-50 hover:text-black",
            )}
          >
            <Icon
              className={cn(
                "h-5 w-5 flex-shrink-0",
                isActive(path)
                  ? "text-black"
                  : "text-neutral-400",
              )}
            />
            <span
              className={cn(
                "truncate transition-opacity duration-300",
                collapsed ? "opacity-0 invisible" : "opacity-100 visible",
              )}
            >
              {label}
            </span>
            {badge !== undefined && (
              <span
                className={cn(
                  "ml-auto bg-neutral-200 text-neutral-600 text-xs font-medium px-1.5 py-0.5 rounded-full transition-opacity duration-300",
                  collapsed ? "opacity-0 invisible" : "opacity-100 visible",
                )}
              >
                {badge}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {/* 工具区 */}
      <div
        className={cn(
          "transition-opacity duration-300 overflow-hidden",
          collapsed ? "opacity-0 invisible" : "opacity-100 visible",
        )}
      >
        <Separator className="mx-3 mt-2" />
        <div className="px-3 py-2">
          <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-1 px-1">
            研究工具
          </p>
          <nav className="space-y-0.5">
            {TOOL_ITEMS.map(({ path, label, icon: Icon }) => (
              <Link
                key={path}
                to={path}
                onClick={onMobileClose}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive(path)
                    ? "bg-neutral-100 text-black font-semibold"
                    : "text-neutral-700 hover:bg-neutral-50 hover:text-black",
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 flex-shrink-0",
                    isActive(path)
                      ? "text-black"
                      : "text-neutral-400",
                  )}
                />
                <span className="truncate">{label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {/* 新建区 */}
      <div
        className={cn(
          "transition-opacity duration-300 overflow-hidden",
          collapsed ? "opacity-0 invisible" : "opacity-100 visible",
        )}
      >
        <Separator className="mx-3" />
        <div className="px-3 py-2">
          <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-1 px-1">
            新建
          </p>
          <nav className="space-y-0.5">
            {CREATE_ITEMS.map(({ path, label, icon: Icon }) => (
              <Link
                key={path}
                to={path}
                onClick={onMobileClose}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive(path)
                    ? "bg-neutral-100 text-black font-semibold"
                    : "text-neutral-700 hover:bg-neutral-50 hover:text-black",
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 flex-shrink-0",
                    isActive(path)
                      ? "text-black"
                      : "text-neutral-400",
                  )}
                />
                <span className="truncate">{label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {/* 底部品牌 */}
      <div
        className={cn(
          "mt-auto transition-opacity duration-300 overflow-hidden",
          collapsed ? "opacity-0 invisible" : "opacity-100 visible",
        )}
      >
        <div className="px-3 py-3 border-t border-neutral-200">
          <p className="text-[10px] text-neutral-400 leading-relaxed">
            MUR 用户智库
            <br />
            腾讯 IEG × 北大元培
          </p>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* 移动端遮罩 */}
      <div
        className={cn(
          "fixed inset-0 z-30 bg-black/50 transition-opacity duration-300 md:hidden",
          mobileOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none",
        )}
        onClick={onMobileClose}
        aria-hidden="true"
      />

      {/* 侧栏本体 */}
      <aside
        className={cn(
          "group fixed left-0 top-14 bottom-0 z-40 flex flex-col bg-white border-r border-neutral-200 transition-all duration-300",
          // 桌面端
          "md:translate-x-0",
          collapsed ? "md:w-16" : "md:w-56",
          // 移动端
          "w-56",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
}