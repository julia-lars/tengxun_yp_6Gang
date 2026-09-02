// 文件管理 — 按来源文件浏览 source_segments
import { ArrowLeft, FileText, MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { api } from "../lib/api.js";

interface FileItem {
  sourceFile: string;
  count: number;
}

export function AdminFilesPage() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getAdminStats()
      .then((stats) => {
        setFiles(stats.sourceDistribution ?? []);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
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
        title="按文件管理"
        description="按来源文件浏览所有用户原声片段，点击文件查看详情"
      />

      {error && (
        <div className="text-red-500 text-sm p-3 bg-red-50 rounded-lg">
          加载失败: {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-6 w-6 border-2 border-neutral-300 border-t-neutral-600 rounded-full" />
        </div>
      ) : files.length === 0 ? (
        <div className="text-center py-16 text-(--color-content-tertiary)">暂无文件</div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-neutral-100">
              {files.map((item) => (
                <Link
                  key={item.sourceFile}
                  to={`/admin/files/${encodeURIComponent(item.sourceFile)}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-neutral-50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="h-4 w-4 text-(--color-content-tertiary) flex-shrink-0" />
                    <span className="text-sm text-(--color-content-primary) truncate">
                      {item.sourceFile}
                    </span>
                  </div>
                  <span className="text-sm font-mono text-(--color-content-secondary) flex-shrink-0">
                    {item.count.toLocaleString()} 条片段
                  </span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// 单个文件下的片段列表
import { useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Segment {
  id: number;
  sourceFile: string;
  segmentIndex: number;
  speakerId: string | null;
  speakerRole: string;
  precedingQuestion: string | null;
  originalText: string;
  cleanedText: string | null;
  charCount: number | null;
  createdAt: string;
}

const PAGE_SIZE = 20;

export function AdminFileDetailPage() {
  const navigate = useNavigate();
  const { sourceFile } = useParams<{ sourceFile: string }>();
  const decodedFile = decodeURIComponent(sourceFile ?? "");

  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const fetchData = () => {
    if (!decodedFile) return;
    setLoading(true);
    setError(null);
    api
      .adminList<Segment>("source-segments", {
        page,
        limit: PAGE_SIZE,
        sort: "segment_index",
        order: "asc",
        filters: JSON.stringify({ source_file: decodedFile }),
        search: search || undefined,
      })
      .then((res) => {
        setSegments(res.data);
        setTotal(res.pagination.total);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, [decodedFile, page]);

  const handleSearch = () => {
    setPage(1);
    fetchData();
  };

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-10 -mt-6 pt-6 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 bg-neutral-50">
        <div className="pb-2 border-b border-neutral-200">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1 text-sm text-(--color-content-secondary) hover:text-(--color-brand-500) transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-3 w-3" /> 返回文件列表
          </button>
        </div>
      </div>

      <PageHeader
        title={decodedFile}
        description={`共 ${total.toLocaleString()} 条片段`}
      />

      {/* 搜索 */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            className="pl-3"
            placeholder="搜索片段内容..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch();
            }}
          />
        </div>
        <Button onClick={handleSearch}>搜索</Button>
      </div>

      {error && (
        <div className="text-red-500 text-sm p-3 bg-red-50 rounded-lg">
          加载失败: {error}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin h-6 w-6 border-2 border-neutral-300 border-t-neutral-600 rounded-full" />
            </div>
          ) : segments.length === 0 ? (
            <div className="py-16 text-center text-(--color-content-tertiary)">暂无片段</div>
          ) : (
            <div className="divide-y divide-neutral-100">
              {segments.map((seg) => (
                <div key={seg.id} className="p-4 hover:bg-neutral-50 transition-colors">
                  <div className="flex items-center gap-3 text-xs text-(--color-content-tertiary) mb-2">
                    <span className="font-mono">#{seg.segmentIndex}</span>
                    {seg.speakerId && (
                      <span className="inline-flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />
                        {seg.speakerId}
                      </span>
                    )}
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        seg.speakerRole === "interviewee"
                          ? "bg-blue-50 text-blue-600"
                          : "bg-purple-50 text-purple-600"
                      }`}
                    >
                      {seg.speakerRole}
                    </span>
                    {seg.charCount !== null && (
                      <span>{seg.charCount} 字</span>
                    )}
                  </div>

                  {seg.precedingQuestion && (
                    <p className="text-xs text-(--color-content-tertiary) mb-1.5 italic">
                      Q: {seg.precedingQuestion}
                    </p>
                  )}

                  <p className="text-sm text-(--color-content-primary) leading-relaxed whitespace-pre-wrap">
                    {seg.cleanedText ?? seg.originalText}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-(--color-content-secondary)">
            共 {total.toLocaleString()} 条，第 {page} / {totalPages} 页
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
