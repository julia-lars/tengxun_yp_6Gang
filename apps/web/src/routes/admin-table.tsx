// 管理后台 — 数据表格浏览页（通用）
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, type AdminListResponse } from "../lib/api.js";

// 表配置
const TABLE_META: Record<string, { label: string; columns: string[] }> = {
  "source-segments": {
    label: "用户原声片段",
    columns: ["id", "source_file", "speaker_id", "speaker_role", "original_text", "char_count", "created_at"],
  },
  personas: {
    label: "用户画像",
    columns: ["id", "name", "description", "sample_count", "cluster_id", "created_at"],
  },
  respondents: {
    label: "受访者",
    columns: ["id", "source_file", "speaker_id", "display_name", "group_code", "created_at"],
  },
  "kol-profiles": {
    label: "KOL 画像",
    columns: ["id", "name", "bilibili_uid", "created_at"],
  },
  "kol-segments": {
    label: "KOL 语料",
    columns: ["id", "kol_id", "title", "ad_label", "created_at"],
  },
  "chat-sessions": {
    label: "对话记录",
    columns: ["id", "persona_id", "title", "updated_at"],
  },
  "kol-chat-sessions": {
    label: "KOL 对话",
    columns: ["id", "kol_id", "title", "updated_at"],
  },
};

const PAGE_SIZE = 20;

export function AdminTablePage() {
  const { table } = useParams<{ table: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<AdminListResponse<Record<string, unknown>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const meta = table ? TABLE_META[table] : undefined;
  const page = Number(searchParams.get("page") ?? "1");
  const sort = searchParams.get("sort") ?? "id";
  const order = searchParams.get("order") ?? "desc";

  const fetchData = useCallback(() => {
    if (!table) return;
    setLoading(true);
    setError(null);
    api.adminList<Record<string, unknown>>(table, {
      page,
      limit: PAGE_SIZE,
      sort,
      order,
      search: search || undefined,
    })
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [table, page, sort, order, search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSearch = (value: string) => {
    setSearch(value);
    const params = new URLSearchParams(searchParams);
    if (value) params.set("search", value);
    else params.delete("search");
    params.set("page", "1");
    setSearchParams(params);
  };

  const handleSort = (col: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("sort", col);
    params.set("order", order === "asc" ? "desc" : "asc");
    params.set("page", "1");
    setSearchParams(params);
  };

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(newPage));
    setSearchParams(params);
  };

  const handleDelete = async (id: number) => {
    if (!table) return;
    try {
      await api.adminDelete(table, id);
      setDeleteConfirm(null);
      fetchData();
    } catch (e) {
      alert(`删除失败: ${e}`);
    }
  };

  if (!meta) {
    return (
      <div className="py-10 text-center text-(--color-content-secondary)">
        未知表: {table}
      </div>
    );
  }

  const renderCellValue = (value: unknown): string => {
    if (value === null || value === undefined) return "—";
    if (typeof value === "object") return JSON.stringify(value).slice(0, 100);
    return String(value).slice(0, 200);
  };

  return (
    <div className="space-y-4">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div>
          <Link to="/admin" className="text-sm text-blue-500 hover:underline">
            ← 返回仪表盘
          </Link>
          <h1 className="text-2xl font-bold text-(--color-content-primary) mt-1">
            {meta.label}
          </h1>
        </div>
        <Link to={`/admin/${table}/new`}>
          <Button size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            新增
          </Button>
        </Link>
      </div>

      {/* 搜索 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-(--color-content-tertiary)" />
        <Input
          className="pl-9"
          placeholder="搜索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSearch(search);
          }}
        />
      </div>

      {/* 表格 */}
      {error && (
        <div className="text-red-500 text-sm p-3 bg-red-50 rounded-lg">
          加载失败: {error}
          <button
            type="button"
            className="ml-2 underline"
            onClick={fetchData}
          >
            重试
          </button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50">
                  {meta.columns.map((col) => (
                    <th
                      key={col}
                      className="px-3 py-2.5 text-left font-medium text-(--color-content-secondary) cursor-pointer hover:text-(--color-content-primary) whitespace-nowrap"
                      onClick={() => handleSort(col)}
                    >
                      {col}
                      {sort === col && (
                        <span className="ml-1 text-xs">
                          {order === "asc" ? "↑" : "↓"}
                        </span>
                      )}
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-right font-medium text-(--color-content-secondary) w-24">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={meta.columns.length + 1}
                      className="px-3 py-10 text-center text-(--color-content-tertiary)"
                    >
                      <div className="flex items-center justify-center gap-2">
                        <div className="animate-spin h-4 w-4 border-2 border-neutral-300 border-t-neutral-600 rounded-full" />
                        加载中...
                      </div>
                    </td>
                  </tr>
                ) : data?.data.length === 0 ? (
                  <tr>
                    <td
                      colSpan={meta.columns.length + 1}
                      className="px-3 py-10 text-center text-(--color-content-tertiary)"
                    >
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  data?.data.map((row) => (
                    <tr
                      key={row.id as number}
                      className="border-b border-neutral-100 hover:bg-neutral-50"
                    >
                      {meta.columns.map((col) => (
                        <td
                          key={col}
                          className="px-3 py-2 text-(--color-content-primary) max-w-xs truncate"
                          title={renderCellValue(row[col])}
                        >
                          {renderCellValue(row[col])}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <Link to={`/admin/${table}/${row.id}`}>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </Link>
                          {deleteConfirm === (row.id as number) ? (
                            <div className="flex items-center gap-1">
                              <Button
                                variant="destructive"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => handleDelete(row.id as number)}
                              >
                                确认
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => setDeleteConfirm(null)}
                              >
                                取消
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-red-500 hover:text-red-700"
                              onClick={() => setDeleteConfirm(row.id as number)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 分页 */}
      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-(--color-content-secondary)">
            共 {data.pagination.total.toLocaleString()} 条，第 {page} / {data.pagination.totalPages} 页
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
              disabled={page >= data.pagination.totalPages}
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