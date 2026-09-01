// 管理后台 — 仪表盘
import {
  Clock,
  Database,
  FileText,
  MessageCircle,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, type AdminStats, type AuditLogEntry } from "../lib/api.js";

interface TableCardConfig {
  key: string;
  label: string;
  icon: LucideIcon;
  route: string;
  description: string;
}

interface TableGroup {
  title: string;
  tables: TableCardConfig[];
}

const TABLE_GROUPS: TableGroup[] = [
  {
    title: "核心数据",
    tables: [
      { key: "source_segments", label: "用户原声片段", icon: FileText, route: "/admin/source-segments", description: "原始用户反馈与语料" },
      { key: "personas", label: "用户画像", icon: Users, route: "/admin/personas", description: "AI 生成的用户画像" },
      { key: "respondents", label: "受访者", icon: Users, route: "/admin/respondents", description: "受访者信息" },
    ],
  },
  {
    title: "KOL 数据",
    tables: [
      { key: "kol_profiles", label: "KOL 画像", icon: MessageCircle, route: "/admin/kol-profiles", description: "KOL 分身画像" },
      { key: "kol_segments", label: "KOL 语料", icon: MessageCircle, route: "/admin/kol-segments", description: "KOL 原始语料片段" },
    ],
  },
  {
    title: "对话数据",
    tables: [
      { key: "chat_sessions", label: "画像对话", icon: Database, route: "/admin/chat-sessions", description: "AI 画像对话记录" },
      { key: "kol_chat_sessions", label: "KOL 对话", icon: Database, route: "/admin/kol-chat-sessions", description: "AI KOL 对话记录" },
    ],
  },
];

const ACTION_ICONS: Record<string, typeof FileText> = {
  INSERT: FileText,
  UPDATE: FileText,
  DELETE: FileText,
};

const ACTION_COLORS: Record<string, string> = {
  INSERT: "text-green-600 bg-green-50",
  UPDATE: "text-blue-600 bg-blue-50",
  DELETE: "text-red-600 bg-red-50",
};

const ACTION_LABELS: Record<string, string> = {
  INSERT: "新增",
  UPDATE: "修改",
  DELETE: "删除",
};

const TABLE_LABELS: Record<string, string> = {
  source_segments: "用户原声片段",
  personas: "用户画像",
  respondents: "受访者",
  kol_profiles: "KOL 画像",
  kol_segments: "KOL 语料",
  chat_sessions: "对话记录",
  kol_chat_sessions: "KOL 对话",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hours}:${minutes}`;
}

export function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [recentActivity, setRecentActivity] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.getAdminStats(),
      api.getRecentActivity(5),
    ])
      .then(([statsRes, activityRes]) => {
        setStats(statsRes);
        setRecentActivity(activityRes.data);
      })
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
          管理画像、用户原声、KOL 分身及所有对话记录
        </p>
      </div>

      {/* 快速操作 */}
      <div className="flex gap-3">
        <Link to="/admin/import">
          <Button size="sm" className="gap-1.5">
            <Upload className="h-4 w-4" />
            导入数据
          </Button>
        </Link>
        <Link to="/admin/audit-log">
          <Button variant="outline" size="sm" className="gap-1.5">
            <Clock className="h-4 w-4" />
            审计日志
          </Button>
        </Link>
      </div>

      {/* 分组统计卡片 */}
      {TABLE_GROUPS.map((group) => (
        <div key={group.title}>
          <h2 className="text-sm font-semibold text-(--color-content-secondary) mb-3 uppercase tracking-wide">
            {group.title}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {group.tables.map(({ key, label, icon: Icon, route, description }) => (
              <Link key={key} to={route}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer h-full group">
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
                    <p className="text-xs text-(--color-content-tertiary) mt-1 group-hover:text-(--color-content-secondary) transition-colors">
                      {description}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      ))}

      {/* 最近操作 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">最近操作</CardTitle>
            <Link to="/admin/audit-log" className="text-xs text-blue-500 hover:underline">
              查看全部
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {recentActivity.length === 0 ? (
            <div className="px-4 pb-4 text-sm text-(--color-content-tertiary)">暂无操作记录</div>
          ) : (
            <div>
              {recentActivity.map((entry) => {
                const ActionIcon = ACTION_ICONS[entry.action] ?? FileText;
                const data = entry.newData ?? entry.oldData;
                const recordName = data
                  ? (data.name ? String(data.name).slice(0, 30) : (data.title ? String(data.title).slice(0, 30) : `#${entry.recordId}`))
                  : `#${entry.recordId}`;

                return (
                  <div key={entry.id} className="flex items-start gap-3 px-4 py-2.5 border-b border-neutral-100 last:border-b-0">
                    <div className={`p-1 rounded-md mt-0.5 flex-shrink-0 ${ACTION_COLORS[entry.action] ?? "text-neutral-600 bg-neutral-50"}`}>
                      <ActionIcon className="h-3 w-3" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-(--color-content-primary)">
                        <span className="font-medium">{entry.changedBy}</span>
                        {" "}
                        <span className={`text-xs px-1 py-0.5 rounded font-medium ${ACTION_COLORS[entry.action] ?? ""}`}>
                          {ACTION_LABELS[entry.action] ?? entry.action}
                        </span>
                        {" "}
                        {TABLE_LABELS[entry.tableName] ?? entry.tableName}
                        {" "}
                        <span className="text-(--color-content-secondary)">{recordName}</span>
                      </p>
                      <p className="text-xs text-(--color-content-tertiary) mt-0.5 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatTime(entry.changedAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

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