// 访谈大纲生成器 — 根据主题自动生成访谈大纲和问题
import type {
  InterviewOutline,
  OutlineGenerateRequest,
  PersonaSummary,
} from "@app/shared";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Clock,
  Download,
  FileText,
  Lightbulb,
  Loader2,
  MessageCircle,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  Users,
  Wand2,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
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
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { api } from "@/lib/api";
import { cn, formatRemainingTime } from "@/lib/utils";

export function InterviewOutlinePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // 表单状态
  const [theme, setTheme] = useState("");
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const [newFocus, setNewFocus] = useState("");
  const [additionalContext, setAdditionalContext] = useState("");
  const [questionCount, setQuestionCount] = useState(15);
  const [selectedPersonas, setSelectedPersonas] = useState<number[]>([]);

  // 数据状态
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [generating, setGenerating] = useState(false);
  const [outlineProgress, setOutlineProgress] = useState(0);
  const [outlineJobId, setOutlineJobId] = useState<string | null>(null);
  const [outline, setOutline] = useState<InterviewOutline | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(),
  );
  const [editingQuestion, setEditingQuestion] = useState<string | null>(null);
  const [refining, setRefining] = useState(false);
  const [estimatedRemainingMs, setEstimatedRemainingMs] = useState<number | undefined>();
  const [restoredFromServer, setRestoredFromServer] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // 加载画像列表
  useEffect(() => {
    api.listPersonas().then(setPersonas).catch(console.error);
  }, []);

  // ★ 挂载时从后端恢复最新数据（不依赖 URL 参数，切换页面也能恢复）
  useEffect(() => {
    if (restoredFromServer) return;

    // 同时拉取最新大纲和正在运行的作业
    Promise.allSettled([
      api.listOutlines(),
      api.listBatchInterviewJobs(),
    ]).then(([outlinesResult, jobsResult]) => {
      // 1. 恢复最新大纲
      if (outlinesResult.status === "fulfilled" && outlinesResult.value.length > 0) {
        const latest = outlinesResult.value[0]!;
        setOutline(latest);
        setExpandedSections(new Set(latest.sections.map((_, i: number) => String(i))));
      }

      // 2. 检查是否有正在运行的 outline 作业
      // 从 URL 或最近的 job 中查找
      const urlJobId = searchParams.get("jobId");
      if (urlJobId) {
        api.getOutlineGenerateStatus(urlJobId).then((s) => {
          if (s.status === "pending" || s.status === "running") {
            setGenerating(true);
            setOutlineJobId(urlJobId);
            setOutlineProgress(s.progress);
            setEstimatedRemainingMs(s.estimatedRemainingMs);
          }
        }).catch(() => {});
      }

      setRestoredFromServer(true);
    }).catch(() => {
      setRestoredFromServer(true);
    });
  }, []); // 仅在挂载时执行一次

  // 添加关注领域
  const addFocus = useCallback(() => {
    const val = newFocus.trim();
    if (!val || focusAreas.includes(val)) return;
    setFocusAreas((prev) => [...prev, val]);
    setNewFocus("");
  }, [newFocus, focusAreas]);

  // 生成大纲（异步）
  const handleGenerate = useCallback(async () => {
    if (!theme.trim()) {
      toast.error("请输入访谈主题");
      return;
    }
    setGenerating(true);
    setOutline(null);
    setOutlineProgress(0);
    try {
      const req: OutlineGenerateRequest = {
        theme: theme.trim(),
        targetPersonaIds:
          selectedPersonas.length > 0 ? selectedPersonas : undefined,
        focusAreas: focusAreas.length > 0 ? focusAreas : undefined,
        additionalContext: additionalContext.trim() || undefined,
        questionCount,
      };
      const { jobId } = await api.generateOutline(req);
      setOutlineJobId(jobId);
      setSearchParams({ jobId }, { replace: true });
    } catch (e) {
      toast.error(`生成失败: ${String(e)}`);
      setGenerating(false);
    }
  }, [theme, selectedPersonas, focusAreas, additionalContext, questionCount]);

  // 取消大纲生成
  const cancelGeneration = useCallback(async () => {
    if (!outlineJobId) return;
    try {
      await api.cancelOutlineGeneration(outlineJobId);
      toast.success("大纲生成已取消");
    } catch (e) {
      toast.error(`取消失败: ${String(e)}`);
    }
    if (pollRef.current) clearInterval(pollRef.current);
    setGenerating(false);
    setOutlineJobId(null);
    setSearchParams({}, { replace: true });
  }, [outlineJobId, setSearchParams]);

  // 轮询大纲生成状态
  useEffect(() => {
    if (!outlineJobId || !generating) return;
    pollRef.current = setInterval(async () => {
      try {
        const status = await api.getOutlineGenerateStatus(outlineJobId);
        setOutlineProgress(status.progress);
        setEstimatedRemainingMs(status.estimatedRemainingMs);
        if (status.status === "completed" && status.result) {
          setOutline(status.result);
          setExpandedSections(new Set(status.result.sections.map((_, i: number) => String(i))));
          setGenerating(false);
          setOutlineJobId(null);
          setSearchParams({ outlineId: status.result.id }, { replace: true });
          toast.success("访谈大纲生成成功！");
        } else if (status.status === "failed") {
          setGenerating(false);
          setOutlineJobId(null);
          setSearchParams({}, { replace: true });
          toast.error(status.error ?? "大纲生成失败");
        } else if (status.status === "cancelled") {
          setGenerating(false);
          setOutlineJobId(null);
          setSearchParams({}, { replace: true });
          toast.info("大纲生成已取消");
        }
      } catch {
        // 轮询忽略错误
      }
    }, 1000);
    return () => clearInterval(pollRef.current);
  }, [outlineJobId, generating]);

  // 优化单个问题
  const refineQuestion = useCallback(
    async (question: string) => {
      setRefining(true);
      setEditingQuestion(question);
      try {
        const result = await api.refineQuestion({
          question,
          theme,
          personaContext: selectedPersonas
            .map(
              (id) =>
                personas.find((p) => p.id === id)?.name ?? `画像 #${id}`,
            )
            .join("、"),
        });
        toast.success("问题已优化", {
          description: result.rationale.slice(0, 100),
        });
        // 在实际应用中，这里应该更新 outline 中的问题
      } catch {
        toast.error("优化失败");
      } finally {
        setRefining(false);
        setEditingQuestion(null);
      }
    },
    [theme, selectedPersonas, personas],
  );

  // 切换章节展开
  const toggleSection = useCallback((idx: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  // 复制大纲
  const copyOutline = useCallback(() => {
    if (!outline) return;
    const text = outline.sections
      .map(
        (s, i) =>
          `## ${i + 1}. ${s.title} (${s.durationMinutes}分钟)\n目的：${s.purpose}\n\n${s.questions
            .map((q, j) => `${j + 1}. ${q.question}\n   目的：${q.purpose}`)
            .join("\n\n")}`,
      )
      .join("\n\n---\n\n");
    navigator.clipboard.writeText(text).then(() => {
      toast.success("已复制到剪贴板");
    });
  }, [outline]);

  // 跳转到批量访谈
  const goToBatchInterview = useCallback(() => {
    if (!outline) return;
    navigate(`/interview/batch?outlineId=${outline.id}`, { state: { outline } });
  }, [outline, navigate]);

  const questionCategories = useMemo(() => {
    if (!outline) return [];
    const cats = new Set<string>();
    for (const s of outline.sections) {
      for (const q of s.questions) {
        cats.add(q.category);
      }
    }
    return Array.from(cats);
  }, [outline]);

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-10 -mt-6 pt-6 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 bg-neutral-50">
        <div className="pb-2 border-b border-neutral-200">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm text-(--color-content-secondary) hover:text-(--color-brand-500) transition-colors"
          >
            <ArrowLeft className="h-3 w-3" /> 返回首页
          </Link>
        </div>
      </div>

      <PageHeader
        title="访谈大纲生成器"
        description="输入访谈主题，AI 自动生成结构化访谈大纲和问题列表。支持指定目标画像，生成针对性问题。"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* 左侧：配置面板 */}
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Wand2 className="h-4 w-4 text-(--color-brand-500)" />
                生成配置
              </CardTitle>
              <CardDescription>设置访谈主题和参数</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 主题 */}
              <div className="space-y-2">
                <Label htmlFor="theme">访谈主题 *</Label>
                <Textarea
                  id="theme"
                  placeholder="例如：玩家对「搜打撤」玩法的接受度与改进建议"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  rows={2}
                  className="text-sm"
                />
              </div>

              {/* 关注领域 */}
              <div className="space-y-2">
                <Label>重点关注领域</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="添加领域..."
                    value={newFocus}
                    onChange={(e) => setNewFocus(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && (e.preventDefault(), addFocus())
                    }
                    className="text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    onClick={addFocus}
                    disabled={!newFocus.trim()}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {focusAreas.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {focusAreas.map((f) => (
                      <Badge
                        key={f}
                        variant="secondary"
                        className="text-[10px] cursor-pointer"
                        onClick={() =>
                          setFocusAreas((prev) => prev.filter((x) => x !== f))
                        }
                      >
                        {f}
                        <X className="h-3 w-3 ml-1" />
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* 目标画像 */}
              <div className="space-y-2">
                <Label>目标画像（可选）</Label>
                <div className="max-h-32 overflow-y-auto space-y-1">
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
                        className="rounded"
                      />
                      <span className="text-(--color-content-primary)">
                        {p.name}
                      </span>
                    </label>
                  ))}
                  {personas.length === 0 && (
                    <p className="text-xs text-(--color-content-tertiary)">
                      暂无画像数据
                    </p>
                  )}
                </div>
              </div>

              {/* 问题数量 */}
              <div className="space-y-2">
                <Label>问题数量：{questionCount}</Label>
                <input
                  type="range"
                  min={5}
                  max={50}
                  value={questionCount}
                  onChange={(e) => setQuestionCount(Number(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-[10px] text-(--color-content-tertiary)">
                  <span>5</span>
                  <span>50</span>
                </div>
              </div>

              {/* 补充上下文 */}
              <div className="space-y-2">
                <Label htmlFor="context">补充信息</Label>
                <Textarea
                  id="context"
                  placeholder="项目背景、研究目标、已知信息等..."
                  value={additionalContext}
                  onChange={(e) => setAdditionalContext(e.target.value)}
                  rows={3}
                  className="text-xs"
                />
              </div>

              {/* 生成按钮 */}
              {generating ? (
                <div className="space-y-2">
                  <Button className="w-full" disabled>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {formatRemainingTime(estimatedRemainingMs)}
                  </Button>
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={cancelGeneration}
                  >
                    <XCircle className="h-4 w-4 mr-2 text-red-500" />
                    取消生成
                  </Button>
                </div>
              ) : (
                <Button
                  className="w-full"
                  onClick={handleGenerate}
                  disabled={!theme.trim()}
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  生成大纲
                </Button>
              )}
            </CardContent>
          </Card>

          {/* 历史大纲 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-(--color-content-tertiary)" />
                最近生成
              </CardTitle>
            </CardHeader>
            <CardContent>
              {outline ? (
                <div className="space-y-2">
                  <div className="p-2 rounded-md bg-(--color-brand-50)">
                    <p className="text-sm font-medium text-(--color-brand-700) truncate">
                      {outline.theme}
                    </p>
                    <p className="text-[10px] text-(--color-brand-500)">
                      {outline.sections.length} 章节 ·{" "}
                      {outline.totalDurationMinutes} 分钟
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-(--color-content-tertiary)">
                  尚未生成大纲
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 右侧：大纲预览 */}
        <div className="lg:col-span-2">
          {generating ? (
            <Card>
              <CardContent className="py-16 text-center space-y-4">
                <Loader2 className="h-10 w-10 mx-auto text-(--color-brand-500) animate-spin" />
                <div>
                  <p className="text-lg font-medium text-(--color-content-primary)">
                    正在生成访谈大纲...
                  </p>
                  <p className="text-sm text-(--color-content-secondary) mt-1">
                    AI 正在根据主题「{theme}」设计结构化访谈问题
                  </p>
                </div>
                <div className="max-w-xs mx-auto space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-(--color-content-secondary)">
                      {formatRemainingTime(estimatedRemainingMs)}
                    </span>
                    <span className="font-medium text-(--color-brand-500)">{outlineProgress}%</span>
                  </div>
                  <Progress value={outlineProgress} className="h-2" />
                </div>
              </CardContent>
            </Card>
          ) : outline ? (
            <div className="space-y-6">
              {/* 大纲概览 */}
              <Card>
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-xl flex items-center gap-2">
                        <FileText className="h-5 w-5 text-(--color-brand-500)" />
                        {outline.theme}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {outline.description}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={copyOutline}
                      >
                        <Clipboard className="h-3.5 w-3.5 mr-1" />
                        复制
                      </Button>
                      <Button size="sm" onClick={goToBatchInterview}>
                        <Play className="h-3.5 w-3.5 mr-1" />
                        批量访谈
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-3 text-sm">
                    <div className="flex items-center gap-1.5 text-(--color-content-secondary)">
                      <Clock className="h-4 w-4" />
                      总计 {outline.totalDurationMinutes} 分钟
                    </div>
                    <div className="flex items-center gap-1.5 text-(--color-content-secondary)">
                      <FileText className="h-4 w-4" />
                      {outline.sections.length} 个章节
                    </div>
                    <div className="flex items-center gap-1.5 text-(--color-content-secondary)">
                      <MessageCircle className="h-4 w-4" />
                      {outline.sections.reduce(
                        (sum, s) => sum + s.questions.length,
                        0,
                      )}{" "}
                      个问题
                    </div>
                    {outline.targetPersona && (
                      <div className="flex items-center gap-1.5 text-(--color-content-secondary)">
                        <Target className="h-4 w-4" />
                        {outline.targetPersona}
                      </div>
                    )}
                  </div>
                  {questionCategories.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {questionCategories.map((c) => (
                        <Badge
                          key={c}
                          variant="secondary"
                          className="text-[10px]"
                        >
                          {c}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 章节列表 */}
              <div className="space-y-4">
                {outline.sections.map((section, sIdx) => {
                  const isExpanded = expandedSections.has(String(sIdx));
                  return (
                    <Card key={sIdx}>
                      <CardHeader
                        className="pb-3 cursor-pointer hover:bg-(--color-surface-secondary) transition-colors"
                        onClick={() => toggleSection(String(sIdx))}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-(--color-brand-50) flex items-center justify-center text-sm font-bold text-(--color-brand-600) flex-shrink-0">
                            {sIdx + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-base">
                              {section.title}
                            </CardTitle>
                            <CardDescription className="text-xs mt-0.5">
                              {section.purpose} · {section.durationMinutes} 分钟
                            </CardDescription>
                          </div>
                          {isExpanded ? (
                            <ChevronDown className="h-5 w-5 text-(--color-content-tertiary)" />
                          ) : (
                            <ChevronRight className="h-5 w-5 text-(--color-content-tertiary)" />
                          )}
                        </div>
                      </CardHeader>
                      {isExpanded && (
                        <CardContent className="space-y-3 pt-0">
                          {section.questions.map((q, qIdx) => (
                            <div
                              key={q.id}
                              className="p-3 rounded-lg bg-(--color-surface-secondary) space-y-2"
                            >
                              <div className="flex items-start gap-2">
                                <span className="text-xs font-medium text-(--color-brand-500) mt-0.5">
                                  {qIdx + 1}.
                                </span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-(--color-content-primary)">
                                    {q.question}
                                  </p>
                                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                    <Badge
                                      variant="outline"
                                      className="text-[10px]"
                                    >
                                      {q.category}
                                    </Badge>
                                    <span className="text-xs text-(--color-content-tertiary)">
                                      {q.purpose}
                                    </span>
                                  </div>
                                  <p className="text-xs text-(--color-content-secondary) mt-1">
                                    <Lightbulb className="h-3 w-3 inline mr-1 text-amber-500" />
                                    {q.expectedInsight}
                                  </p>
                                  {q.followUps && q.followUps.length > 0 && (
                                    <div className="mt-2 space-y-0.5">
                                      <p className="text-[10px] font-medium text-(--color-content-tertiary)">
                                        追问建议：
                                      </p>
                                      {q.followUps.map((fu, fi) => (
                                        <p
                                          key={fi}
                                          className="text-xs text-(--color-content-secondary) pl-2 border-l-2 border-(--color-border-default)"
                                        >
                                          {fu}
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 flex-shrink-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    refineQuestion(q.question);
                                  }}
                                  disabled={refining}
                                >
                                  <RefreshCw
                                    className={cn(
                                      "h-3.5 w-3.5",
                                      refining &&
                                        editingQuestion === q.question &&
                                        "animate-spin",
                                    )}
                                  />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={Sparkles}
              title="输入主题，生成访谈大纲"
              description="在左侧填写访谈主题和配置参数，点击「生成大纲」按钮，AI 将自动生成结构化访谈问题"
            />
          )}
        </div>
      </div>
    </div>
  );
}