// 管理后台 — 操作审计日志
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Plus,
  Minus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { api, type AuditLogEntry } from "../lib/api.js";

const ACTION_ICONS: Record<string, typeof Plus> = {
  INSERT: Plus,
  UPDATE: FileText,
  DELETE: Trash2,
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
  import_jobs: "导入作业",
  interview_outlines: "访谈大纲",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hours}:${minutes}`;
}

function getChangedFields(oldData: Record<string, unknown> | null, newData: Record<string, unknown> | null): string[] {
  if (!newData) return [];
  if (!oldData) return Object.keys(newData);
  const changed: string[] = [];
  for (const key of Object.keys(newData)) {
    if (JSON.stringify(oldData[key]) !== JSON.stringify(newData[key])) {
      changed.push(key);
    }
  }
  return changed;
}

function getRecordName(entry: AuditLogEntry): string {
  const data = entry.newData ?? entry.oldData;
  if (!data) return `#${entry.recordId}`;
  if (data.name) return `"${String(data.name).slice(0, 30)}"`;
  if (data.title) return `"${String(data.title).slice(0, 30)}"`;
  return `#${entry.recordId}`;
}

export function AdminAuditLogPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<AuditLogEntry[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const page = Number(searchParams.get("page") ?? "1");
  const tableFilter = searchParams.get("table") ?? "";
  const actionFilter = searchParams.get("action") ?? "";

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    api.getAuditLog({
      page,
      limit: 20,
      table: tableFilter || undefined,
      action: actionFilter || undefined,
    })
      .then((res) => {
        setData(res.data);
        setPagination(res.pagination);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [page, tableFilter, actionFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const setFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    params.set("page", "1");
    setSearchParams(params);
  };

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(newPage));
    setSearchParams(params);
  };

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div className="sticky top-0 z-10 -mt-6 pt-6 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 bg-neutral-50">
        <div className="pb-2 border-b border-neutral-200">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1 text-sm text-(--color-content-secondary) hover:text-(--color-brand-500) transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-3 w-3" /> 返回上一页
          </button>
        </div>
      </div>
      <PageHeader
        title="操作审计日志"
        description="查看所有数据变更记录，支持按表名和操作类型筛选"
      />

      {/* 筛选栏 */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-(--color-content-secondary)">表名</label>
              <select
                className="border border-neutral-300 rounded-lg px-2 py-1.5 text-sm bg-white"
                value={tableFilter}
                onChange={(e) => setFilter("table", e.target.value)}
              >
                <option value="">全部</option>
                {Object.entries(TABLE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-(--color-content-secondary)">操作</label>
              <select
                className="border border-neutral-300 rounded-lg px-2 py-1.5 text-sm bg-white"
                value={actionFilter}
                onChange={(e) => setFilter("action", e.target.value)}
              >
                <option value="">全部</option>
                <option value="INSERT">新增</option>
                <option value="UPDATE">修改</option>
                <option value="DELETE">删除</option>
              </select>
            </div>
            {(tableFilter || actionFilter) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const params = new URLSearchParams();
                  params.set("page", "1");
                  setSearchParams(params);
                }}
              >
                重置筛选
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 错误提示 */}
      {error && (
        <div className="text-red-500 text-sm p-3 bg-red-50 rounded-lg">
          加载失败: {error}
          <button type="button" className="ml-2 underline" onClick={fetchData}>重试</button>
        </div>
      )}

      {/* 日志列表 */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin h-6 w-6 border-2 border-neutral-300 border-t-neutral-600 rounded-full" />
            </div>
          ) : data.length === 0 ? (
            <div className="py-16 text-center text-(--color-content-tertiary)">暂无审计日志</div>
          ) : (
            <div>
              {data.map((entry) => {
                const ActionIcon = ACTION_ICONS[entry.action] ?? FileText;
                const changedFields = getChangedFields(entry.oldData, entry.newData);
                const isExpanded = expandedId === entry.id;

                return (
                  <div key={entry.id} className="border-b border-neutral-100 last:border-b-0">
                    <div
                      className="flex items-start gap-3 px-4 py-3 hover:bg-neutral-50 cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    >
                      <div className={`p-1.5 rounded-md mt-0.5 flex-shrink-0 ${ACTION_COLORS[entry.action] ?? "text-neutral-600 bg-neutral-50"}`}>
                        <ActionIcon className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-(--color-content-primary)">
                            {TABLE_LABELS[entry.tableName] ?? entry.tableName}
                          </span>
                          <span className="text-xs text-(--color-content-tertiary)">{getRecordName(entry)}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${ACTION_COLORS[entry.action] ?? ""}`}>
                            {ACTION_LABELS[entry.action] ?? entry.action}
                          </span>
                        </div>
                        {entry.action === "UPDATE" && changedFields.length > 0 && (
                          <p className="text-xs text-(--color-content-secondary) mt-1 truncate">
                            修改了: {changedFields.slice(0, 3).join(", ")}
                            {changedFields.length > 3 && ` 等 ${changedFields.length} 个字段`}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <Clock className="h-3 w-3 text-(--color-content-tertiary)" />
                          <span className="text-xs text-(--color-content-tertiary)">{formatTime(entry.changedAt)}</span>
                          <span className="text-xs text-(--color-content-tertiary)">· {entry.changedBy}</span>
                        </div>
                      </div>
                    </div>

                    {/* 展开详情 */}
                    {isExpanded && (
                      <div className="px-4 pb-3 pl-16">
                        <div className="bg-neutral-50 rounded-lg p-3 text-xs font-mono space-y-2">
                          {entry.oldData && (
                            <div>
                              <p className="text-(--color-content-secondary) mb-1 font-medium">变更前 (old_data):</p>
                              <pre className="whitespace-pre-wrap text-red-700 bg-red-50/50 p-2 rounded overflow-x-auto max-h-48">
                                {JSON.stringify(entry.oldData, null, 2)}
                              </pre>
                            </div>
                          )}
                          {entry.newData && (
                            <div>
                              <p className="text-(--color-content-secondary) mb-1 font-medium">变更后 (new_data):</p>
                              <pre className="whitespace-pre-wrap text-green-700 bg-green-50/50 p-2 rounded overflow-x-auto max-h-48">
                                {JSON.stringify(entry.newData, null, 2)}
                              </pre>
                            </div>
                          )}
                          {!entry.oldData && !entry.newData && (
                            <p className="text-(--color-content-tertiary)">无变更数据</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 分页 */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-(--color-content-secondary)">
            共 {pagination.total.toLocaleString()} 条，第 {page} / {pagination.totalPages} 页
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => handlePageChange(page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pagination.totalPages}
              onClick={() => handlePageChange(page + 1)}
            >
              下一页
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}