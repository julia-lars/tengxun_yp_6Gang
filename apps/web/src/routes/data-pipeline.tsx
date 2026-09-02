// 数据流水线 — 上传原始数据 → AI 全流程处理
import type { PipelineStatus } from "@app/shared";
import {
  ArrowLeft,
  ArrowRight,
  Braces,
  CheckCircle2,
  Circle,
  Database,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Loader2,
  Play,
  RotateCw,
  Tag,
  Upload,
  Users,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/shared/page-header";
import { api } from "@/lib/api";
import { cn, formatRemainingTime } from "@/lib/utils";

// ---- 流水线阶段 ----
type PipelineStage = "idle" | "uploading" | "extracting" | "cleaning" | "tagging" | "embedding" | "clustering" | "cancelled" | "done";

interface StageInfo {
  key: PipelineStage;
  label: string;
  description: string;
  icon: typeof Circle;
}

const STORAGE_KEY = "pipeline-state";

interface StoredFileMeta {
  name: string;
  size: number;
  type: string;
}

interface StoredPipelineState {
  jobId: string;
  stage: PipelineStage;
  progress: number;
  target: "personas" | "kol";
  selectedKol: string;
  notes: string;
  enableClustering: boolean;
  fileNames: StoredFileMeta[];
  uploadResult: { fileIds: string[]; fileNames: string[] } | null;
  stats: PipelineStatus["stats"] | null;
}

function savePipelineState(state: Partial<StoredPipelineState>) {
  try {
    const existing = loadPipelineState();
    const merged = { ...existing, ...state };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // sessionStorage 不可用时忽略
  }
}

function loadPipelineState(): Partial<StoredPipelineState> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<StoredPipelineState>) : {};
  } catch {
    return {};
  }
}

function clearPipelineState() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略
  }
}
  const STAGES: StageInfo[] = [
  { key: "uploading", label: "上传解析", description: "读取文件内容，提取文本", icon: Upload },
  { key: "extracting", label: "数据提取", description: "结构化提取关键信息", icon: Braces },
  { key: "cleaning", label: "数据清洗", description: "去重、去噪、格式标准化", icon: RotateCw },
  { key: "tagging", label: "AI 打标", description: "冰山模型标注 M1-M5", icon: Tag },
  { key: "embedding", label: "向量嵌入", description: "生成语义向量，建立索引", icon: Zap },
];

// 文件类型
const ACCEPTED_TYPES = [
  ".txt",
  ".docx",
  ".xlsx",
  ".csv",
  ".json",
  ".pdf",
  ".md",
];

interface UploadedFile {
  file: File;
  name: string;
  size: number;
  type: string;
  status: "pending" | "uploading" | "processing" | "done" | "error";
}

export function DataPipelinePage() {
  const navigate = useNavigate();
  const saved = loadPipelineState();

  const [files, setFiles] = useState<UploadedFile[]>(() => {
    // 从 sessionStorage 恢复文件元数据（File 对象无法序列化，仅恢复显示信息）
    return (saved.fileNames ?? []).map((f) => ({
      file: new File([], f.name), // 占位 File 对象（刷新后不可用于上传）
      name: f.name,
      size: f.size,
      type: f.type,
      status: saved.jobId ? ("processing" as const) : ("pending" as const),
    }));
  });
  const [currentStage, setCurrentStage] = useState<PipelineStage>(
    saved.stage ?? "idle",
  );
  const [progress, setProgress] = useState(saved.progress ?? 0);
  const [target, setTarget] = useState<"personas" | "kol">(
    saved.target ?? "personas",
  );
  const [selectedKol, setSelectedKol] = useState<string>(saved.selectedKol ?? "");
  const [notes, setNotes] = useState(saved.notes ?? "");
  const [enableClustering, setEnableClustering] = useState(
    saved.enableClustering ?? false,
  );
  const [dragOver, setDragOver] = useState(false);
  const [jobId, setJobId] = useState<string | null>(saved.jobId ?? null);
  const [pipelineStats, setPipelineStats] = useState<PipelineStatus["stats"] | null>(
    saved.stats ?? null,
  );
  const [uploadResult, setUploadResult] = useState<{
    fileIds: string[];
    fileNames: string[];
  } | null>(saved.uploadResult ?? null);
  const [estimatedRemainingMs, setEstimatedRemainingMs] = useState<number | undefined>();
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const isRunning = currentStage !== "idle" && currentStage !== "done" && currentStage !== "cancelled";

  // 页面刷新后恢复轮询（优先 sessionStorage，兜底 API）
  useEffect(() => {
    const recoverJob = async () => {
      // 1. 优先从 sessionStorage 恢复
      if (saved.jobId) {
        const restoredStage = saved.stage ?? "uploading";
        if (restoredStage === "done") {
          clearPipelineState();
          setCurrentStage("done");
          setProgress(100);
          return;
        }
        // jobId 已通过 useState 初始化，轮询 effect 会自动启动
        return;
      }

      // 2. 兜底：从 API 查找是否有运行中的作业
      try {
        const jobs = await api.listPipelineJobs();
        const activeJob = jobs.find((j) => !j.completedAt);
        if (activeJob) {
          setJobId(activeJob.jobId);
          setCurrentStage(activeJob.stage);
          setProgress(activeJob.progress);
          setPipelineStats(activeJob.stats);
          setEstimatedRemainingMs(activeJob.estimatedRemainingMs);
          savePipelineState({
            jobId: activeJob.jobId,
            stage: activeJob.stage,
            progress: activeJob.progress,
            stats: activeJob.stats,
          });
          // 轮询 effect 会通过 jobId/isRunning 变化自动启动
        }
      } catch {
        // 无活跃作业，忽略
      }
    };
    recoverJob();
  }, []); // 仅在挂载时执行一次

  // 轮询流水线状态
  useEffect(() => {
    if (!jobId || !isRunning) return;
    pollRef.current = setInterval(async () => {
      try {
        const status = await api.getPipelineStatus(jobId);
        setCurrentStage(status.stage);
        setProgress(status.progress);
        setPipelineStats(status.stats);
        setEstimatedRemainingMs(status.estimatedRemainingMs);
        savePipelineState({
          stage: status.stage,
          progress: status.progress,
          stats: status.stats,
        });
        if (status.completedAt) {
          setCurrentStage("done");
          setProgress(100);
          setJobId(null);
          clearPipelineState();
          toast.success("数据流水线处理完成！");
        }
        if (status.stage === "cancelled") {
          clearInterval(pollRef.current);
          setCurrentStage("idle");
          setJobId(null);
          clearPipelineState();
          toast.info("流水线已取消");
        }
      } catch {
        // 轮询失败（作业可能已过期或不存在），停止
        clearInterval(pollRef.current);
        setCurrentStage("idle");
        setJobId(null);
        clearPipelineState();
        toast.error("流水线作业已过期，请重新上传文件");
      }
    }, 1500);
    return () => clearInterval(pollRef.current);
  }, [jobId, isRunning]);

  // 处理文件上传
  const handleFiles = useCallback((newFiles: FileList | File[]) => {
    const entries = Array.from(newFiles).map((f) => ({
      file: f,
      name: f.name,
      size: f.size,
      type: f.name.split(".").pop()?.toLowerCase() ?? "unknown",
      status: "pending" as const,
    }));
    setFiles((prev) => [...prev, ...entries]);
    toast.success(`已添加 ${entries.length} 个文件`);
  }, []);

  // 拖拽处理
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles],
  );

  // 移除文件
  const removeFile = useCallback((name: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  }, []);

  // 真实流水线执行
  const startPipeline = useCallback(async () => {
    if (files.length === 0) {
      toast.error("请先上传文件");
      return;
    }

    setCurrentStage("uploading");
    setProgress(0);
    setPipelineStats(null);

    try {
      // Step 1: 上传文件到服务器
      setFiles((prev) =>
        prev.map((f) => ({ ...f, status: "uploading" as const })),
      );

      const uploadRes = await api.uploadPipelineFiles(
        files.map((f) => f.file),
      );

      setFiles((prev) =>
        prev.map((f) => ({ ...f, status: "done" as const })),
      );
      setUploadResult(uploadRes);

      toast.success(`文件上传完成: ${uploadRes.fileNames.length} 个文件`);

      // 安全检查：开启聚类将删除并重建所有画像
      if (enableClustering) {
        const confirmed = window.confirm(
          "⚠️ 警告：开启聚类分析将删除所有现有群体画像并重新生成。\n\n" +
          "此操作不可撤销，确定要继续吗？\n\n" +
          "如果只想导入新数据而不影响现有画像，请取消并关闭「启用聚类分析」开关。",
        );
        if (!confirmed) return;
      }

      // Step 2: 启动流水线
      const { jobId: newJobId } = await api.startPipeline({
        target,
        kolId: selectedKol && selectedKol !== "new" ? Number(selectedKol) : undefined,
        uploadedFileIds: uploadRes.fileIds,
        fileNames: uploadRes.fileNames,
        notes: notes || undefined,
        enableClustering,
        enableKol: target === "kol",
      });
      setJobId(newJobId);

      toast.success("开始处理...");

      // 持久化到 sessionStorage，防止刷新丢失
      savePipelineState({
        jobId: newJobId,
        stage: "uploading",
        progress: 0,
        target,
        selectedKol,
        notes,
        enableClustering,
        fileNames: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
        uploadResult: uploadRes,
        stats: null,
      });

      // 更新文件状态
      setFiles((prev) =>
        prev.map((f) => ({ ...f, status: "processing" as const })),
      );
    } catch (e) {
      toast.error(`流水线启动失败: ${String(e)}`);
      setCurrentStage("idle");
      clearPipelineState();
      setFiles((prev) =>
        prev.map((f) => ({ ...f, status: "error" as const })),
      );
    }
  }, [files, target, selectedKol, notes]);

  // 重置
  const reset = useCallback(() => {
    setCurrentStage("idle");
    setProgress(0);
    setFiles([]);
    setNotes("");
    setEnableClustering(false);
    setJobId(null);
    setPipelineStats(null);
    setUploadResult(null);
    setEstimatedRemainingMs(undefined);
    clearPipelineState();
  }, []);

  // 取消流水线
  const cancelPipeline = useCallback(async () => {
    if (!jobId) return;
    try {
      await api.cancelPipeline(jobId);
      toast.success("流水线已取消，已清理相关数据");
    } catch (e) {
      toast.error(`取消失败: ${String(e)}`);
    }
    // 无论取消请求是否成功，都停止轮询并重置 UI
    if (pollRef.current) clearInterval(pollRef.current);
    reset();
  }, [jobId, reset]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
            <ArrowLeft className="h-3 w-3" /> 返回上一页
          </button>
        </div>
      </div>

      <PageHeader
        title="数据流水线"
        description="上传原始数据文件，AI 自动完成提取、清洗、打标、嵌入全流程。支持文件夹、Word、Excel、CSV 等格式。"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* 左侧：上传区域 */}
        <div className="lg:col-span-2 space-y-6">
          {/* 文件上传 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-(--color-brand-500)" />
                上传原始数据
              </CardTitle>
              <CardDescription>
                支持 .txt .docx .xlsx .csv .json .pdf .md 格式，可拖拽或点击上传
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 拖拽区域 */}
              <div
                className={cn(
                  "relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 cursor-pointer",
                  dragOver
                    ? "border-(--color-brand-500) bg-(--color-brand-50)"
                    : "border-(--color-border-default) hover:border-(--color-brand-300) hover:bg-(--color-surface-secondary)",
                  isRunning && "pointer-events-none opacity-50",
                )}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.multiple = true;
                  input.accept = ACCEPTED_TYPES.join(",");
                  input.onchange = (e) => {
                    const files = (e.target as HTMLInputElement).files;
                    if (files && files.length > 0) handleFiles(files);
                  };
                  input.click();
                }}
              >
                <Upload className="h-10 w-10 mx-auto mb-3 text-(--color-content-tertiary)" />
                <p className="text-sm font-medium text-(--color-content-secondary)">
                  拖拽文件到此处，或点击选择文件
                </p>
                <p className="text-xs text-(--color-content-tertiary) mt-1">
                  支持文件夹批量上传，单文件最大 50MB
                </p>
              </div>

              {/* 文件列表 */}
              {files.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-(--color-content-secondary)">
                    已添加 {files.length} 个文件
                  </p>
                  <div className="space-y-1">
                    {files.map((f) => (
                      <div
                        key={f.name}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg bg-(--color-surface-secondary) text-sm"
                      >
                        {f.type === "xlsx" || f.type === "csv" ? (
                          <FileSpreadsheet className="h-4 w-4 text-green-500 flex-shrink-0" />
                        ) : f.type === "docx" || f.type === "pdf" ? (
                          <FileText className="h-4 w-4 text-blue-500 flex-shrink-0" />
                        ) : (
                          <Database className="h-4 w-4 text-(--color-content-tertiary) flex-shrink-0" />
                        )}
                        <span className="flex-1 truncate text-(--color-content-primary)">
                          {f.name}
                        </span>
                        <span className="text-xs text-(--color-content-tertiary) flex-shrink-0">
                          {formatSize(f.size)}
                        </span>
                        {f.status === "done" && (
                          <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                        )}
                        {f.status === "error" && (
                          <Badge variant="destructive" className="text-[10px]">
                            失败
                          </Badge>
                        )}
                        {!isRunning && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeFile(f.name);
                            }}
                            className="text-(--color-content-tertiary) hover:text-(--color-error-500) transition-colors"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 流水线进度 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Zap className="h-4 w-4 text-(--color-brand-500)" />
                处理进度
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 进度条 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-(--color-content-secondary)">
                    {currentStage === "idle"
                      ? "等待开始"
                      : currentStage === "done"
                        ? "处理完成"
                        : formatRemainingTime(estimatedRemainingMs)}
                  </span>
                  <span className="font-medium text-(--color-brand-500)">{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>

              {/* 阶段指示器 */}
              <div className="space-y-2">
                {STAGES.map((stage, i) => {
                  const isActive = currentStage === stage.key;
                  const isComplete =
                    STAGES.findIndex((s) => s.key === currentStage) > i ||
                    currentStage === "done";
                  const Icon = isActive ? Loader2 : isComplete ? CheckCircle2 : stage.icon;

                  return (
                    <div
                      key={stage.key}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                        isActive && "bg-(--color-brand-50)",
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-4 w-4 flex-shrink-0",
                          isComplete && "text-green-500",
                          isActive && "text-(--color-brand-500) animate-spin",
                          !isComplete && !isActive && "text-(--color-content-tertiary)",
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <p
                          className={cn(
                            "text-sm font-medium",
                            isComplete && "text-(--color-content-primary)",
                            isActive && "text-(--color-brand-600)",
                            !isComplete && !isActive && "text-(--color-content-tertiary)",
                          )}
                        >
                          {stage.label}
                        </p>
                        <p className="text-xs text-(--color-content-tertiary)">
                          {stage.description}
                        </p>
                      </div>
                      {isComplete && <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 右侧：配置面板 */}
        <div className="space-y-6">
          {/* 目标选择 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">处理目标</CardTitle>
              <CardDescription>选择数据注入的目标模块</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Tabs
                value={target}
                onValueChange={(v) => setTarget(v as "personas" | "kol")}
              >
                <TabsList className="w-full">
                  <TabsTrigger value="personas" className="flex-1">
                    <Users className="h-3.5 w-3.5 mr-1" />
                    用户画像
                  </TabsTrigger>
                  <TabsTrigger value="kol" className="flex-1">
                    <FileText className="h-3.5 w-3.5 mr-1" />
                    KOL 分身
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="personas" className="space-y-3 mt-3">
                  <p className="text-xs text-(--color-content-secondary)">
                    数据将注入群体画像语料库，用于更新已有画像或创建新画像
                  </p>
                  <div className="flex items-center gap-2 text-xs text-(--color-content-tertiary)">
                    <Database className="h-3.5 w-3.5" />
                    当前语料库: 17,132 条片段
                  </div>
                </TabsContent>
                <TabsContent value="kol" className="space-y-3 mt-3">
                  <p className="text-xs text-(--color-content-secondary)">
                    数据将注入指定 KOL 的语料库，用于更新或创建数字孪生
                  </p>
                  <div>
                    <label className="text-xs text-(--color-content-secondary) block mb-1">
                      选择目标 KOL
                    </label>
                    <select
                      value={selectedKol}
                      onChange={(e) => setSelectedKol(e.target.value)}
                      className="w-full h-9 rounded-md border border-(--color-border-default) bg-(--color-surface-elevated) px-3 text-sm text-(--color-content-primary)"
                    >
                      <option value="">选择 KOL...</option>
                      <option value="new">+ 新建 KOL 分身</option>
                      <option value="kol-1">冷面叶星星IKGN</option>
                      <option value="kol-2">鬼王陆行</option>
                    </select>
                  </div>
                </TabsContent>
              </Tabs>

              <Separator />

              {/* 聚类分析开关 */}
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableClustering}
                    onChange={(e) => setEnableClustering(e.target.checked)}
                    disabled={isRunning}
                    className="h-4 w-4 rounded border-(--color-border-default) text-(--color-brand-500) focus:ring-(--color-brand-500)"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-(--color-content-primary)">
                      启用聚类分析
                    </p>
                    <p className="text-xs text-(--color-content-tertiary)">
                      基于全部语料重新生成群体画像（将删除现有画像）
                    </p>
                  </div>
                </label>
                {enableClustering && (
                  <div className="rounded-lg border border-(--color-warning-500) bg-(--color-warning-50) p-3">
                    <p className="text-xs text-(--color-warning-700)">
                      ⚠️ 此操作将<strong>删除所有现有群体画像</strong>并基于全量数据重新聚类生成。
                      仅在确认需要更新画像体系时开启。
                    </p>
                  </div>
                )}
              </div>

              <Separator />

              {/* 备注 */}
              <div>
                <label className="text-xs text-(--color-content-secondary) block mb-1">
                  处理备注
                </label>
                <Textarea
                  placeholder="可选：描述这批数据的来源、采集时间、注意事项等..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="text-xs"
                />
              </div>
            </CardContent>
          </Card>

          {/* 操作按钮 */}
          <div className="space-y-2">
            {currentStage === "idle" && (
              <Button className="w-full" onClick={startPipeline} disabled={files.length === 0}>
                <Play className="h-4 w-4 mr-2" />
                开始处理
              </Button>
            )}
            {isRunning && (
              <div className="space-y-2">
                <Button className="w-full" disabled>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {formatRemainingTime(estimatedRemainingMs)}
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={cancelPipeline}
                >
                  <XCircle className="h-4 w-4 mr-2 text-red-500" />
                  取消处理
                </Button>
              </div>
            )}
            {currentStage === "done" && (
              <>
                <Button className="w-full" variant="outline" onClick={reset}>
                  <RotateCw className="h-4 w-4 mr-2" />
                  处理新批次
                </Button>
                <Button className="w-full" asChild>
                  <Link to={target === "personas" ? "/personas" : "/kol"}>
                    查看结果
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Link>
                </Button>
              </>
            )}
          </div>

          {/* 数据统计 */}
          {currentStage === "done" && (
            <Card className="border-green-200 bg-green-50/50">
              <CardContent className="py-4 space-y-2">
                <p className="text-sm font-medium text-green-700 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4" />
                  处理完成
                </p>
                <div className="text-xs text-green-600 space-y-0.5">
                  <p>· 提取片段: {pipelineStats?.segmentsExtracted ?? "—"} 条</p>
                  <p>· 清洗完成: {pipelineStats?.segmentsCleaned ?? "—"} 条</p>
                  <p>· 标注完成: {pipelineStats?.segmentsTagged ?? "—"} 条</p>
                  <p>· 向量嵌入: {pipelineStats?.segmentsEmbedded ? "已完成" : "—"}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}