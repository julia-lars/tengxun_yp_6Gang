// 管理后台 — 数据表格浏览页（通用）
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BatchActionBar } from "@/components/admin/batch-action-bar.js";
import { api, type AdminListResponse } from "../lib/api.js";

// 表配置
const TABLE_META: Record<string, {
  label: string;
  columns: string[];
  /** 是否允许新增记录 */
  creatable: boolean;
  /** 是否允许编辑记录 */
  editable: boolean;
  /** 是否允许删除记录 */
  deletable: boolean;
}> = {
  "source-segments": {
    label: "用户原声片段",
    columns: ["id", "sourceFile", "speakerId", "speakerRole", "originalText", "charCount", "createdAt"],
    creatable: true,
    editable: true,
    deletable: true,
  },
  personas: {
    label: "用户画像",
    columns: ["id", "name", "description", "sampleCount", "clusterId", "createdAt"],
    creatable: true,
    editable: true,
    deletable: true,
  },
  respondents: {
    label: "受访者",
    columns: ["id", "sourceFile", "speakerId", "displayName", "groupCode", "createdAt"],
    creatable: true,
    editable: true,
    deletable: true,
  },
  "kol-profiles": {
    label: "KOL 画像",
    columns: ["id", "name", "bilibiliUid", "createdAt"],
    creatable: true,
    editable: true,
    deletable: true,
  },
  "kol-segments": {
    label: "KOL 语料",
    columns: ["id", "kolId", "bvid", "title", "adLabel", "createdAt"],
    creatable: true,
    editable: true,
    deletable: true,
  },
  "chat-sessions": {
    label: "对话记录",
    columns: ["id", "personaId", "title", "updatedAt"],
    creatable: false,  // 对话记录由系统自动生成
    editable: false,
    deletable: true,
  },
  "kol-chat-sessions": {
    label: "KOL 对话",
    columns: ["id", "kolId", "title", "updatedAt"],
    creatable: false,  // 对话记录由系统自动生成
    editable: false,
    deletable: true,
  },
};

const PAGE_SIZE = 20;

/** camelCase → snake_case */
function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** 从 sourceFile 路径中提取组号 */
function extractGroupCode(sourceFile: string): string | null {
  const base = sourceFile.split("/").pop() || sourceFile;
  const m = base.match(/^([A-Z]\d+)/i);
  return m?.[1] ? m[1].toUpperCase() : null;
}

export function AdminTablePage() {
  const navigate = useNavigate();
  const { table } = useParams<{ table: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<AdminListResponse<Record<string, unknown>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);

  const meta = table ? TABLE_META[table] : undefined;
  const page = Number(searchParams.get("page") ?? "1");
  const sort = searchParams.get("sort") ?? "id";
  const order = searchParams.get("order") ?? "desc";
  const filters = searchParams.get("filters") ?? "";

  const fetchData = useCallback(() => {
    if (!table) return;
    setLoading(true);
    setError(null);
    // API 的 sort 字段使用 snake_case
    const sortParam = sort ? camelToSnake(sort) : "id";
    api.adminList<Record<string, unknown>>(table, {
      page,
      limit: PAGE_SIZE,
      sort: sortParam,
      order,
      search: search || undefined,
      filters: filters || undefined,
    })
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [table, page, sort, order, search, filters]);

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
    // API 使用 snake_case 字段名排序
    params.set("sort", camelToSnake(col));
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

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!data) return;
    const allIds = data.data.map((r) => r.id as number);
    const allSelected = allIds.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allIds));
    }
  };

  const handleBatchDelete = async () => {
    if (!table || selectedIds.size === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedIds.size} 条记录吗？此操作不可撤销。`)) return;

    setBatchDeleting(true);
    try {
      await api.adminBatchDelete(table, Array.from(selectedIds));
      setSelectedIds(new Set());
      fetchData();
    } catch (e) {
      alert(`批量删除失败: ${e}`);
    } finally {
      setBatchDeleting(false);
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
    if (typeof value === "object") {
      const str = JSON.stringify(value);
      // 空对象 / 空数组显示为 —
      if (str === "{}" || str === "[]") return "—";
      return str.slice(0, 100);
    }
    const str = String(value).trim();
    // 无意义占位值统一显示为 —
    if (str === "" || str === "unknown" || str === "null" || str === "undefined") return "—";
    return str.slice(0, 200);
  };

  return (
    <div className="space-y-4">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1 text-sm text-(--color-muted-foreground) hover:text-(--color-primary) transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-3 w-3" /> 返回仪表盘
          </button>
          <h1 className="text-2xl font-bold text-(--color-content-primary) mt-1">
            {meta.label}
          </h1>
        </div>
        {meta.creatable && (
          <Link to={`/admin/${table}/new`}>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" />
              新增
            </Button>
          </Link>
        )}
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
                  <th className="px-3 py-2.5 w-10">
                    <input
                      type="checkbox"
                      className="rounded border-neutral-300"
                      checked={data ? data.data.length > 0 && data.data.every((r) => selectedIds.has(r.id as number)) : false}
                      onChange={toggleSelectAll}
                    />
                  </th>
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
                      colSpan={meta.columns.length + 2}
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
                      colSpan={meta.columns.length + 2}
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
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          className="rounded border-neutral-300"
                          checked={selectedIds.has(row.id as number)}
                          onChange={() => toggleSelect(row.id as number)}
                        />
                      </td>
                      {meta.columns.map((col) => {
                        // API 返回 snake_case 字段，前端列名使用 camelCase，需要做映射
                        let val = row[camelToSnake(col)] ?? row[col];
                        // groupCode 为 unknown 时，尝试从 sourceFile 推断真实组号
                        if (col === "groupCode" && val === "unknown") {
                          const sourceFile = row[camelToSnake("sourceFile")] ?? row["sourceFile"];
                          if (typeof sourceFile === "string") {
                            const inferred = extractGroupCode(sourceFile);
                            if (inferred) val = inferred;
                          }
                        }
                        return (
                          <td
                            key={col}
                            className="px-3 py-2 text-(--color-content-primary) max-w-xs truncate"
                            title={renderCellValue(val)}
                          >
                            {renderCellValue(val)}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          {meta.editable ? (
                            <Link to={`/admin/${table}/${row.id}`}>
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </Link>
                          ) : (
                            <Link to={`/admin/${table}/${row.id}`}>
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </Link>
                          )}
                          {meta.deletable && (
                            deleteConfirm === (row.id as number) ? (
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
                          ))}
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
      {/* 批量操作浮栏 */}
      <BatchActionBar
        selectedCount={selectedIds.size}
        onBatchDelete={handleBatchDelete}
        onClearSelection={() => setSelectedIds(new Set())}
        deleting={batchDeleting}
      />
    </div>
  );
}