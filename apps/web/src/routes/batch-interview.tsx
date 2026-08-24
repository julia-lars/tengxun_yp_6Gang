// 批量访谈 — 大规模自动访谈 + 报告生成
import type {
  BatchInterviewConfig,
  BatchInterviewReport,
  BatchInterviewStatus,
  InterviewOutline,
  InterviewResult,
  PersonaSummary,
} from "@app/shared";
import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Lightbulb,
  Loader2,
  MessageCircle,
  Play,
  RefreshCw,
  Sparkles,
  Target,
  Users,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { api } from "@/lib/api";
import { cn, formatRemainingTime } from "@/lib/utils";

export function BatchInterviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialOutline = (location.state as { outline?: InterviewOutline })
    ?.outline;

  // 表单状态
  const [selectedPersonas, setSelectedPersonas] = useState<number[]>([]);
  const [concurrency, setConcurrency] = useState(3);
  const [maxRounds, setMaxRounds] = useState(10);
  const [outline, setOutline] = useState<InterviewOutline | null>(
    initialOutline ?? null,
  );

  // 数据状态
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(() => {
    // 从 URL 恢复 jobId（支持页面刷新后继续轮询）
    return searchParams.get("jobId");
  });
  const [status, setStatus] = useState<BatchInterviewStatus | null>(null);
  const [report, setReport] = useState<BatchInterviewReport | null>(null);
  const [expandedPersonas, setExpandedPersonas] = useState<Set<string>>(
    new Set(),
  );
  const [expandedComparisons, setExpandedComparisons] = useState<Set<string>>(
    new Set(),
  );
  const [estimatedRemainingMs, setEstimatedRemainingMs] = useState<number | undefined>();
  const [restoredFromServer, setRestoredFromServer] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // ★ 挂载时从后端恢复最新数据（不依赖 URL 参数，切换页面也能恢复）
  useEffect(() => {
    if (restoredFromServer) return;

    // 同时拉取最新大纲和正在运行的作业
    Promise.allSettled([
      api.listOutlines(),
      api.listBatchInterviewJobs(),
    ]).then(([outlinesResult, jobsResult]) => {
      // 1. 恢复 outline（从 URL 参数或后端最新数据）
      const urlOutlineId = searchParams.get("outlineId");
      if (urlOutlineId && !initialOutline && !outline) {
        api.getOutline(urlOutlineId).then(setOutline).catch(() => {});
      } else if (!initialOutline && !outline && outlinesResult.status === "fulfilled" && outlinesResult.value.length > 0) {
        setOutline(outlinesResult.value[0]!);
      }

      // 2. 恢复最近运行的作业
      const urlJobId = searchParams.get("jobId");
      if (urlJobId) {
        api.getBatchInterviewStatus(urlJobId).then((s) => {
          setStatus(s);
          setRunning(s.status === "pending" || s.status === "running");
          if (s.status === "completed") {
            api.getBatchInterviewReport(urlJobId).then(setReport).catch(() => {});
          }
        }).catch(() => {});
      } else if (jobsResult.status === "fulfilled" && jobsResult.value.length > 0) {
        // 从后端获取最近作业
        const latestJob = jobsResult.value[0]!;
        if (latestJob.status === "pending" || latestJob.status === "running") {
          setJobId(latestJob.jobId);
          setStatus(latestJob);
          setRunning(true);
        } else if (latestJob.status === "completed") {
          setStatus(latestJob);
          api.getBatchInterviewReport(latestJob.jobId).then(setReport).catch(() => {});
          // 从报告恢复 outline
          api.getBatchInterviewReport(latestJob.jobId).then((r) => {
            if (r.config.outline) setOutline(r.config.outline);
          }).catch(() => {});
        }
      }

      setRestoredFromServer(true);
    }).catch(() => {
      setRestoredFromServer(true);
    });
  }, []); // 仅在挂载时执行一次

  // 旧：页面加载时，如果 URL 中有 jobId，自动恢复轮询（保留作为 fallback）
  useEffect(() => {
    const savedJobId = searchParams.get("jobId");
    if (!savedJobId || running) return;

    // 检查作业是否还存在
    api.getBatchInterviewStatus(savedJobId).then((s) => {
      setStatus(s);
      setRunning(s.status === "pending" || s.status === "running");
      if (s.status === "completed") {
        api.getBatchInterviewReport(savedJobId).then(setReport).catch(() => {});
      }
    }).catch(() => {
      setSearchParams({}, { replace: true });
    });
  }, []); // 仅在挂载时执行一次

  // 加载画像
  useEffect(() => {
    api.listPersonas().then(setPersonas).catch(console.error);
  }, []);

  // 轮询状态
  useEffect(() => {
    if (!jobId || !running) return;
    pollRef.current = setInterval(async () => {
      try {
        const s = await api.getBatchInterviewStatus(jobId);
        setStatus(s);
        setEstimatedRemainingMs(s.estimatedRemainingMs);
        if (s.status === "completed" || s.status === "failed" || s.status === "cancelled") {
          setRunning(false);
          // 清除 URL 中的 jobId，保留 outlineId
          const next = new URLSearchParams(searchParams);
          next.delete("jobId");
          setSearchParams(next, { replace: true });
          if (s.status === "completed") {
            try {
              const r = await api.getBatchInterviewReport(jobId);
              setReport(r);
              toast.success("批量访谈完成！");
            } catch {
              toast.error("报告获取失败");
            }
          } else if (s.status === "cancelled") {
            toast.info("批量访谈已取消");
          } else {
            toast.error(s.error ? `批量访谈失败: ${s.error}` : "批量访谈执行失败");
          }
        }
      } catch {
        // 轮询中忽略错误
      }
    }, 2000);
    return () => clearInterval(pollRef.current);
  }, [jobId, running, setSearchParams]);

  // 启动批量访谈
  const handleStart = useCallback(async () => {
    if (selectedPersonas.length === 0) {
      toast.error("请至少选择一个画像");
      return;
    }
    setRunning(true);
    setReport(null);
    setStatus(null);
    try {
      const config: BatchInterviewConfig = {
        outlineId: outline?.id,
        personaIds: selectedPersonas,
        personaNames: selectedPersonas.map(
          (id) => personas.find((p) => p.id === id)?.name ?? `画像 #${id}`,
        ),
        concurrency,
        maxRoundsPerPersona: maxRounds,
        outline: outline ?? undefined,
      };
      const { jobId: newJobId, status: initialStatus } =
        await api.startBatchInterview(config);
      setJobId(newJobId);
      setStatus(initialStatus);
      // 将 jobId 和 outlineId 写入 URL
      const next = new URLSearchParams();
      next.set("jobId", newJobId);
      if (outline?.id) next.set("outlineId", outline.id);
      setSearchParams(next, { replace: true });
      toast.success("批量访谈已启动");
    } catch (e) {
      toast.error(`启动失败: ${String(e)}`);
      setRunning(false);
    }
  }, [selectedPersonas, personas, concurrency, maxRounds, outline, setSearchParams]);

  // 取消批量访谈
  const cancelBatch = useCallback(async () => {
    if (!jobId) return;
    try {
      await api.cancelBatchInterview(jobId);
      toast.success("批量访谈已取消");
    } catch (e) {
      toast.error(`取消失败: ${String(e)}`);
    }
    if (pollRef.current) clearInterval(pollRef.current);
    setRunning(false);
    setJobId(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("jobId");
      return next;
    });
  }, [jobId, setSearchParams]);

  // 全选/取消全选
  const toggleAllPersonas = useCallback(() => {
    if (selectedPersonas.length === personas.length) {
      setSelectedPersonas([]);
    } else {
      setSelectedPersonas(personas.map((p) => p.id));
    }
  }, [selectedPersonas, personas]);

  // 展开/折叠
  const togglePersona = useCallback((id: string) => {
    setExpandedPersonas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleComparison = useCallback((theme: string) => {
    setExpandedComparisons((prev) => {
      const next = new Set(prev);
      if (next.has(theme)) next.delete(theme);
      else next.add(theme);
      return next;
    });
  }, []);

  // 导出报告
  const exportReport = useCallback(() => {
    if (!report) return;
    const text = [
      `# 批量访谈报告`,
      `生成时间：${new Date(report.generatedAt).toLocaleString("zh-CN")}`,
      `画像数：${report.summary.completedInterviews}/${report.summary.totalInterviews}`,
      `总轮次：${report.summary.totalRounds}`,
      "",
      "## 跨画像共性主题",
      ...report.summary.crossCuttingThemes.map((t) => `- ${t}`),
      "",
      "## 画像对比分析",
      ...report.summary.personaComparison.flatMap((pc) => [
        `### ${pc.theme}`,
        ...pc.observations.map(
          (o) => `- **${o.personaName}**: ${o.stance}${o.quote ? `\n  > "${o.quote}"` : ""}`,
        ),
        "",
      ]),
      "",
      "## 各画像访谈详情",
      ...report.results.flatMap((r) => [
        `### ${r.personaName}`,
        `关键洞察：`,
        ...r.keyInsights.map((i) => `- ${i}`),
        "",
        `问答摘录：`,
        ...r.rounds.slice(0, 5).map(
          (round) =>
            `- Q: ${round.question}\n- A: ${round.answer.slice(0, 200)}`,
        ),
        "",
      ]),
    ].join("\n");

    const blob = new Blob([text], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `batch-interview-report-${report.jobId}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("报告已下载");
  }, [report]);

  const totalQuestions = useMemo(
    () =>
      outline
        ? outline.sections.reduce((sum, s) => sum + s.questions.length, 0)
        : maxRounds,
    [outline, maxRounds],
  );

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
        title="批量访谈"
        description="选择多个用户画像，AI 自动进行大规模并行访谈，并生成综合分析报告。支持使用访谈大纲或默认问题集。"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* 左侧：配置面板 */}
        <div className="lg:col-span-1 space-y-6">
          {/* 画像选择 */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-(--color-brand-500)" />
                  选择画像
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={toggleAllPersonas}
                >
                  {selectedPersonas.length === personas.length
                    ? "取消全选"
                    : "全选"}
                </Button>
              </div>
              <CardDescription>
                已选 {selectedPersonas.length}/{personas.length}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-60 overflow-y-auto space-y-1">
                {personas.map((p) => (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-(--color-surface-secondary) cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedPersonas.includes(p.id)}
                      onChange={() =>
                        setSelectedPersonas((prev) =>
                          prev.includes(p.id)
                            ? prev.filter((x) => x !== p.id)
                            : [...prev, p.id],
                        )
                      }
                      disabled={running}
                      className="rounded"
                    />
                    <span className="text-(--color-content-primary) truncate">
                      {p.name}
                    </span>
                    <span className="text-[10px] text-(--color-content-tertiary) ml-auto flex-shrink-0">
                      {p.sampleCount ?? 0} 样本
                    </span>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 访谈参数 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-4 w-4 text-(--color-brand-500)" />
                访谈参数
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 大纲状态 */}
              <div className="space-y-2">
                <Label>访谈大纲</Label>
                {outline ? (
                  <div className="p-3 rounded-lg bg-(--color-brand-50) space-y-1">
                    <p className="text-sm font-medium text-(--color-brand-700)">
                      {outline.theme}
                    </p>
                    <p className="text-xs text-(--color-brand-500)">
                      {outline.sections.length} 章节 ·{" "}
                      {outline.sections.reduce(
                        (sum, s) => sum + s.questions.length,
                        0,
                      )}{" "}
                      个问题
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-(--color-brand-500)"
                      onClick={() => {
                          setOutline(null);
                          const next = new URLSearchParams(searchParams);
                          next.delete("outlineId");
                          setSearchParams(next, { replace: true });
                        }}
                    >
                      清除大纲
                    </Button>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-(--color-surface-secondary) space-y-2">
                    <p className="text-xs text-(--color-content-secondary)">
                      未使用大纲，将使用默认问题集
                    </p>
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/interview/outline">
                        <Sparkles className="h-3 w-3 mr-1" />
                        生成大纲
                      </Link>
                    </Button>
                  </div>
                )}
              </div>

              {/* 并发数 */}
              <div className="space-y-2">
                <Label>并发数：{concurrency}</Label>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                  disabled={running}
                  className="w-full"
                />
              </div>

              {/* 每画像轮次 */}
              <div className="space-y-2">
                <Label>每画像最多轮次：{maxRounds}</Label>
                <input
                  type="range"
                  min={1}
                  max={20}
                  value={maxRounds}
                  onChange={(e) => setMaxRounds(Number(e.target.value))}
                  disabled={running}
                  className="w-full"
                />
              </div>

              {/* 预估 */}
              <div className="p-3 rounded-lg bg-(--color-surface-secondary) space-y-1">
                <p className="text-xs text-(--color-content-secondary)">
                  预估访谈量
                </p>
                <p className="text-lg font-bold text-(--color-content-primary)">
                  {selectedPersonas.length * totalQuestions} 轮
                </p>
                <p className="text-[10px] text-(--color-content-tertiary)">
                  {selectedPersonas.length} 画像 × {totalQuestions} 问题
                </p>
              </div>

              {/* 启动按钮 */}
              <Button
                className="w-full"
                onClick={handleStart}
                disabled={
                  running || selectedPersonas.length === 0
                }
              >
                {running ? (
                  <div className="space-y-2">
                    <Button className="w-full" disabled>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {formatRemainingTime(estimatedRemainingMs)}
                    </Button>
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={cancelBatch}
                    >
                      <XCircle className="h-4 w-4 mr-2 text-red-500" />
                      取消访谈
                    </Button>
                  </div>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    开始批量访谈
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* 右侧：执行状态 + 报告 */}
        <div className="lg:col-span-2 space-y-6">
          {/* 执行状态 */}
          {status && (status.status === "running" || status.status === "pending") && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Loader2 className="h-4 w-4 text-(--color-brand-500) animate-spin" />
                  访谈进行中
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-(--color-content-secondary)">
                      {formatRemainingTime(estimatedRemainingMs)}
                    </span>
                    <span className="font-medium text-(--color-brand-500)">
                      {status.progress}%
                    </span>
                  </div>
                  <Progress value={status.progress} className="h-2" />
                </div>
                {/* 当前正在访谈的画像和问题（并发下多个画像各自展示） */}
                {Object.entries(status.progressByPersona ?? {}).length > 0 && (
                  <div className="space-y-2">
                    {Object.entries(status.progressByPersona ?? {}).map(
                      ([personaId, progress]) => (
                        <div
                          key={personaId}
                          className="p-3 rounded-lg bg-(--color-brand-50) space-y-1"
                        >
                          <p className="text-xs text-(--color-brand-500) font-medium">
                            正在访谈
                          </p>
                          <p className="text-sm text-(--color-brand-700) font-medium">
                            {progress.name}
                          </p>
                          <p className="text-xs text-(--color-brand-500) truncate">
                            {progress.question}
                          </p>
                        </div>
                      ),
                    )}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold text-black">
                      {status.completedPersonas.length}
                    </p>
                    <p className="text-xs text-(--color-content-tertiary)">
                      已完成
                    </p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-black">
                      {status.totalPersonas}
                    </p>
                    <p className="text-xs text-(--color-content-tertiary)">
                      总画像
                    </p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-black">
                      {status.totalRounds}
                    </p>
                    <p className="text-xs text-(--color-content-tertiary)">
                      已完成轮次
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 失败状态 */}
          {status?.status === "failed" && (
            <Card className="border-red-200">
              <CardContent className="py-8 text-center space-y-3">
                <XCircle className="h-10 w-10 mx-auto text-red-500" />
                <p className="text-lg font-medium text-red-700">
                  批量访谈执行失败
                </p>
                <p className="text-sm text-red-500">
                  {status.error
                    ? status.error.slice(0, 200)
                    : "请检查网络连接和 API 配置后重试"}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleStart}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  重试
                </Button>
              </CardContent>
            </Card>
          )}

          {/* 报告 */}
          {report ? (
            <div className="space-y-6">
              {/* 概览统计 */}
              <div className="grid gap-4 sm:grid-cols-4">
                <StatCard
                  label="完成画像"
                  value={report.summary.completedInterviews}
                  icon={Users}
                />
                <StatCard
                  label="总轮次"
                  value={report.summary.totalRounds}
                  icon={MessageCircle}
                />
                <StatCard
                  label="共性主题"
                  value={report.summary.crossCuttingThemes.length}
                  icon={Sparkles}
                />
                <StatCard
                  label="对比维度"
                  value={report.summary.personaComparison.length}
                  icon={BarChart3}
                />
              </div>

              {/* 跨画像共性主题 */}
              {report.summary.crossCuttingThemes.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-amber-500" />
                      跨画像共性主题
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {report.summary.crossCuttingThemes.map((theme, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-3 p-3 rounded-lg bg-(--color-surface-secondary)"
                        >
                          <span className="text-sm font-medium text-(--color-brand-500) mt-0.5">
                            {i + 1}.
                          </span>
                          <p className="text-sm text-(--color-content-primary)">
                            {theme}
                          </p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* 画像对比分析 */}
              {report.summary.personaComparison.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-(--color-brand-500)" />
                      画像对比分析
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {report.summary.personaComparison.map((pc) => (
                      <div key={pc.theme}>
                        <div
                          className="flex items-center gap-2 p-2 rounded-md hover:bg-(--color-surface-secondary) cursor-pointer transition-colors"
                          onClick={() => toggleComparison(pc.theme)}
                        >
                          {expandedComparisons.has(pc.theme) ? (
                            <ChevronDown className="h-4 w-4 text-(--color-content-tertiary)" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-(--color-content-tertiary)" />
                          )}
                          <span className="text-sm font-medium text-(--color-content-primary)">
                            {pc.theme}
                          </span>
                          <Badge variant="secondary" className="text-[10px]">
                            {pc.observations.length} 画像
                          </Badge>
                        </div>
                        {expandedComparisons.has(pc.theme) && (
                          <div className="mt-2 space-y-2 pl-6">
                            {pc.observations.map((obs, i) => (
                              <div
                                key={i}
                                className="p-3 rounded-lg bg-(--color-surface-secondary)"
                              >
                                <div className="flex items-center gap-2 mb-1">
                                  <Badge className="text-[10px]">
                                    {obs.personaName}
                                  </Badge>
                                  <span className="text-sm text-(--color-content-primary)">
                                    {obs.stance}
                                  </span>
                                </div>
                                {obs.quote && (
                                  <blockquote className="text-xs text-(--color-content-secondary) italic border-l-2 border-(--color-brand-300) pl-2 mt-1">
                                    "{obs.quote}"
                                  </blockquote>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* 各画像详细结果 */}
              <div className="space-y-4">
                <h3 className="text-lg font-serif font-bold text-black">
                  各画像详细结果
                </h3>
                {report.results.map((result) => (
                  <Card key={result.personaId}>
                    <CardHeader
                      className="pb-3 cursor-pointer hover:bg-(--color-surface-secondary) transition-colors"
                      onClick={() =>
                        togglePersona(String(result.personaId))
                      }
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-(--color-brand-50) flex items-center justify-center text-sm font-bold text-(--color-brand-600)">
                          {result.personaName.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-base">
                            {result.personaName}
                          </CardTitle>
                          <CardDescription className="text-xs">
                            {result.rounds.length} 轮 ·{" "}
                            {result.keyInsights.length} 个关键洞察
                          </CardDescription>
                        </div>
                        {expandedPersonas.has(String(result.personaId)) ? (
                          <ChevronDown className="h-5 w-5 text-(--color-content-tertiary)" />
                        ) : (
                          <ChevronRight className="h-5 w-5 text-(--color-content-tertiary)" />
                        )}
                      </div>
                    </CardHeader>
                    {expandedPersonas.has(String(result.personaId)) && (
                      <CardContent className="space-y-4 pt-0">
                        {/* 关键洞察 */}
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-(--color-content-secondary)">
                            🎯 关键洞察
                          </p>
                          {result.keyInsights.map((insight, i) => (
                            <div
                              key={i}
                              className="flex items-start gap-2 p-2 rounded-md bg-(--color-brand-50)"
                            >
                              <Lightbulb className="h-3.5 w-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                              <p className="text-sm text-(--color-brand-700)">
                                {insight}
                              </p>
                            </div>
                          ))}
                        </div>

                        {/* 问答摘录 */}
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-(--color-content-secondary)">
                            💬 问答摘录
                          </p>
                          {result.rounds.slice(0, 8).map((round, i) => (
                            <div
                              key={i}
                              className="p-3 rounded-lg bg-(--color-surface-secondary) space-y-2"
                            >
                              <p className="text-sm font-medium text-(--color-content-primary)">
                                Q{i + 1}: {round.question}
                              </p>
                              <p className="text-sm text-(--color-content-secondary) leading-relaxed">
                                {round.answer.slice(0, 300)}
                                {round.answer.length > 300 ? "..." : ""}
                              </p>
                            </div>
                          ))}
                          {result.rounds.length > 8 && (
                            <p className="text-xs text-(--color-content-tertiary) text-center">
                              ... 还有 {result.rounds.length - 8} 轮问答
                            </p>
                          )}
                        </div>
                      </CardContent>
                    )}
                  </Card>
                ))}
              </div>

              {/* 导出按钮 */}
              <div className="flex justify-center">
                <Button onClick={exportReport} size="lg">
                  <Download className="h-4 w-4 mr-2" />
                  导出报告 (Markdown)
                </Button>
              </div>
            </div>
          ) : status?.status === "failed" ? null : (
            <EmptyState
              icon={BarChart3}
              title="选择画像并启动访谈"
              description="在左侧选择目标画像，配置访谈参数，点击「开始批量访谈」按钮。AI 将自动对每个画像进行深度访谈，并生成综合分析报告。"
              action={
                !running && selectedPersonas.length === 0 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleAllPersonas}
                  >
                    <Users className="h-4 w-4 mr-2" />
                    全选所有画像
                  </Button>
                ) : undefined
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}