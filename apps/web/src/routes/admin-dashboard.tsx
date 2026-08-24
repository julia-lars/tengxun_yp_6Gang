// 管理后台 — 仪表盘
import {
  Database,
  FileText,
  MessageCircle,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, type AdminStats } from "../lib/api.js";

const TABLE_CONFIG: Array<{
  key: string;
  label: string;
  icon: LucideIcon;
  route: string;
}> = [
  { key: "source_segments", label: "用户原声片段", icon: FileText, route: "/admin/source-segments" },
  { key: "personas", label: "用户画像", icon: Users, route: "/admin/personas" },
  { key: "respondents", label: "受访者", icon: Users, route: "/admin/respondents" },
  { key: "kol_profiles", label: "KOL 画像", icon: MessageCircle, route: "/admin/kol-profiles" },
  { key: "kol_segments", label: "KOL 语料", icon: MessageCircle, route: "/admin/kol-segments" },
  { key: "chat_sessions", label: "对话记录", icon: Database, route: "/admin/chat-sessions" },
  { key: "kol_chat_sessions", label: "KOL 对话", icon: Database, route: "/admin/kol-chat-sessions" },
];

export function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAdminStats()
      .then(setStats)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-8 w-8 border-2 border-neutral-300 border-t-neutral-600 rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-10 text-center">
        <p className="text-red-500">加载失败: {error}</p>
        <button
          type="button"
          className="mt-3 text-sm text-blue-500 hover:underline"
          onClick={() => window.location.reload()}
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-(--color-content-primary)">数据管理</h1>
        <p className="text-sm text-(--color-content-secondary) mt-1">
          查看、编辑、导入数据库中的数据
        </p>
      </div>

      {/* 快速操作 */}
      <div className="flex gap-3">
        <Link
          to="/admin/import"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Upload className="h-4 w-4" />
          导入数据
        </Link>
        <Link
          to="/admin/audit-log"
          className="inline-flex items-center gap-2 px-4 py-2 border border-neutral-300 rounded-lg text-sm font-medium hover:bg-neutral-50 transition-colors"
        >
          审计日志
        </Link>
      </div>

      {/* 表统计卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {TABLE_CONFIG.map(({ key, label, icon: Icon, route }) => (
          <Link key={key} to={route}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-(--color-content-secondary) flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  {label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-(--color-content-primary)">
                  {(stats?.tables[key] ?? 0).toLocaleString()}
                </p>
                <p className="text-xs text-(--color-content-tertiary) mt-1">条记录</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* 来源分布 */}
      {stats?.sourceDistribution && stats.sourceDistribution.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">source_segments 来源分布（Top 20）</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {stats.sourceDistribution.map((item) => (
                <div
                  key={item.sourceFile}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-(--color-content-secondary) truncate max-w-[80%]" title={item.sourceFile}>
                    {item.sourceFile}
                  </span>
                  <span className="font-mono text-(--color-content-primary) font-medium">
                    {item.count.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}