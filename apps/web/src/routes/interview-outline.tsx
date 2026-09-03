// 访谈大纲页面 — 主容器，管理所有子组件和状态
import type { InterviewOutline, PersonaSummary } from "@app/shared";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { api } from "@/lib/api";
import { exportOutlineToExcel } from "@/lib/outline-export";
import { GenerateConfig } from "./interview-outline/generate-config";
import { HistorySidebar } from "./interview-outline/history-sidebar";
import { ImportDialog } from "./interview-outline/import-dialog";
import { ManualCreateForm } from "./interview-outline/manual-create-form";
import { OutlineViewer } from "./interview-outline/outline-viewer";
import { TopActionBar } from "./interview-outline/top-action-bar";

type ConfigPanel = "none" | "generate" | "manual";

export function InterviewOutlinePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // ---- 数据状态 ----
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [history, setHistory] = useState<InterviewOutline[]>([]);
  const [outline, setOutline] = useState<InterviewOutline | null>(null);
  const [originalOutline, setOriginalOutline] =
    useState<InterviewOutline | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(),
  );

  // ---- UI 状态 ----
  const [configPanel, setConfigPanel] = useState<ConfigPanel>("none");
  const [generating, setGenerating] = useState(false);
  const [outlineJobId, setOutlineJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [estimatedRemainingMs, setEstimatedRemainingMs] = useState<number>();
  const [restoredFromServer, setRestoredFromServer] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<InterviewOutline | null>(
    null,
  );
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const containerRef = useRef<HTMLDivElement>(null);
  const hasUnsavedChanges = outline !== null && outline !== originalOutline;

  // ---- 加载画像列表 ----
  useEffect(() => {
    api.listPersonas().then(setPersonas).catch(console.error);
  }, []);

  // ---- 挂载时从后端恢复数据 ----
  useEffect(() => {
    if (restoredFromServer) return;

    Promise.allSettled([
      api.listOutlines(),
      api.listBatchInterviewJobs(),
    ]).then(([outlinesResult, jobsResult]) => {
      if (outlinesResult.status === "fulfilled" && outlinesResult.value.length > 0) {
        setHistory(outlinesResult.value);
        const latest = outlinesResult.value[0]!;
        setOutline(latest);
        setOriginalOutline(latest);
        setExpandedSections(
          new Set(latest.sections.map((_, i: number) => String(i))),
        );
      }

      const urlJobId = searchParams.get("jobId");
      if (urlJobId) {
        api
          .getOutlineGenerateStatus(urlJobId)
          .then((s) => {
            if (s.status === "pending" || s.status === "running") {
              setGenerating(true);
              setOutlineJobId(urlJobId);
              setProgress(s.progress);
              setEstimatedRemainingMs(s.estimatedRemainingMs);
              setConfigPanel("generate");
            }
          })
          .catch(() => {});
      }

      setRestoredFromServer(true);
    }).catch(() => {
      setRestoredFromServer(true);
    });
  }, []);

  // ---- 未保存修改提醒（浏览器关闭） ----
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges]);

  // ---- 禁用外层滚动 + 让父级成为定位参考以支持内部滚动 ----
  useLayoutEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    const prevOverflow = main.style.overflowY;
    main.style.overflowY = "hidden";

    const parent = containerRef.current?.parentElement;
    const prevPosition = parent?.style.position;
    if (parent) {
      parent.style.position = "relative";
    }

    return () => {
      main.style.overflowY = prevOverflow;
      if (parent) {
        parent.style.position = prevPosition ?? "";
      }
    };
  }, []);

  // ---- 轮询大纲生成状态 ----
  useEffect(() => {
    if (!outlineJobId || !generating) return;
    pollRef.current = setInterval(async () => {
      try {
        const status = await api.getOutlineGenerateStatus(outlineJobId);
        setProgress(status.progress);
        setEstimatedRemainingMs(status.estimatedRemainingMs);
        if (status.status === "completed" && status.result) {
          setOutline(status.result);
          setOriginalOutline(status.result);
          setHistory((prev) => {
            const filtered = prev.filter((o) => o.id !== status.result!.id);
            return [status.result!, ...filtered];
          });
          setExpandedSections(
            new Set(status.result.sections.map((_, i: number) => String(i))),
          );
          setGenerating(false);
          setOutlineJobId(null);
          setConfigPanel("none");
          setSearchParams({ outlineId: status.result.id }, { replace: true });
          toast.success("访谈大纲生成成功！");
        } else if (status.status === "failed") {
          setGenerating(false);
          setOutlineJobId(null);
          toast.error(status.error ?? "大纲生成失败");
        } else if (status.status === "cancelled") {
          setGenerating(false);
          setOutlineJobId(null);
          toast.info("大纲生成已取消");
        }
      } catch {
        // 轮询忽略错误
      }
    }, 1000);
    return () => clearInterval(pollRef.current);
  }, [outlineJobId, generating]);

  // ---- 切换配置面板 ----
  const toggleConfig = useCallback(
    (panel: ConfigPanel) => {
      setConfigPanel(panel);
    },
    [],
  );

  // ---- 手动创建大纲 ----
  const handleManualCreate = useCallback(
    async (theme: string, description: string) => {
      const newOutline: InterviewOutline = {
        id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        theme,
        description:
          description || `针对「${theme}」的访谈大纲`,
        targetPersona: undefined,
        sections: [
          {
            title: "开场与热身",
            purpose: "建立信任，了解受访者基本情况",
            durationMinutes: 5,
            questions: [],
          },
        ],
        totalDurationMinutes: 5,
        createdAt: new Date().toISOString(),
      };

      // 先持久化到后端
      try {
        const saved = await api.updateOutline(newOutline.id, {
          theme: newOutline.theme,
          description: newOutline.description,
          targetPersona: newOutline.targetPersona,
          sections: newOutline.sections,
          totalDurationMinutes: newOutline.totalDurationMinutes,
        });
        setOutline(saved);
        setOriginalOutline(saved);
        setHistory((prev) => [saved, ...prev]);
        setExpandedSections(new Set(["0"]));
        setConfigPanel("none");
        toast.success("大纲已创建，请在右侧编辑区添加问题");
      } catch (e) {
        toast.error(`创建失败: ${String(e)}`);
      }
    },
    [],
  );

  // ---- AI 生成 ----
  const handleGenerateStart = useCallback((jobId: string) => {
    setOutlineJobId(jobId);
    setGenerating(true);
    setProgress(0);
    setSearchParams({ jobId }, { replace: true });
  }, []);

  const handleCancelGenerate = useCallback(async () => {
    if (!outlineJobId) return;
    try {
      await api.cancelOutlineGeneration(outlineJobId);
      if (pollRef.current) clearInterval(pollRef.current);
      setGenerating(false);
      setOutlineJobId(null);
      setSearchParams({}, { replace: true });
    } catch (e) {
      toast.error(`取消失败: ${String(e)}`);
    }
  }, [outlineJobId]);

  // ---- 历史列表操作 ----
  const handleSelectOutline = useCallback(
    (selected: InterviewOutline) => {
      // 未保存提醒
      if (hasUnsavedChanges && outline) {
        if (
          !window.confirm(
            "当前大纲有未保存的修改，切换将丢失修改。是否继续？",
          )
        ) {
          return;
        }
      }
      setOutline(selected);
      setOriginalOutline(selected);
      setExpandedSections(
        new Set(selected.sections.map((_, i: number) => String(i))),
      );
      setSearchParams({ outlineId: selected.id }, { replace: true });
    },
    [hasUnsavedChanges, outline, setSearchParams],
  );

  const handleDeleteOutline = useCallback((target: InterviewOutline) => {
    setDeleteConfirm(target);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    try {
      await api.deleteOutline(deleteConfirm.id);
      setHistory((prev) => prev.filter((o) => o.id !== deleteConfirm.id));
      if (outline?.id === deleteConfirm.id) {
        // 切换到最近的另一个大纲
        const remaining = history.filter((o) => o.id !== deleteConfirm.id);
        const first = remaining[0];
        if (first) {
          setOutline(first);
          setOriginalOutline(first);
          setExpandedSections(
            new Set(first.sections.map((_, i: number) => String(i))),
          );
        } else {
          setOutline(null);
          setOriginalOutline(null);
        }
      }
      setDeleteConfirm(null);
      toast.success("大纲已删除");
    } catch (e) {
      toast.error(`删除失败: ${String(e)}`);
    }
  }, [deleteConfirm, history, outline]);

  // ---- 大纲编辑 ----
  const handleOutlineChange = useCallback((updated: InterviewOutline) => {
    setOutline(updated);
  }, []);

  const handleSaveOutline = useCallback(async () => {
    if (!outline) return;
    try {
      // 重新计算总时长
      const totalDuration = outline.sections.reduce(
        (sum, s) => sum + (s.durationMinutes || 0),
        0,
      );
      const toSave = { ...outline, totalDurationMinutes: totalDuration };

      const saved = await api.updateOutline(outline.id, {
        theme: toSave.theme,
        description: toSave.description,
        targetPersona: toSave.targetPersona,
        sections: toSave.sections,
        totalDurationMinutes: toSave.totalDurationMinutes,
      });
      setOutline(saved);
      setOriginalOutline(saved);
      setHistory((prev) =>
        prev.map((o) => (o.id === saved.id ? saved : o)),
      );
      toast.success("大纲已保存");
    } catch (e) {
      toast.error(`保存失败: ${String(e)}`);
    }
  }, [outline]);

  const toggleSection = useCallback((idx: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  // ---- 导出 Excel ----
  const handleExportExcel = useCallback(() => {
    if (!outline) return;
    try {
      exportOutlineToExcel(outline);
      toast.success("已导出为 Excel 文件");
    } catch (e) {
      toast.error(`导出失败: ${String(e)}`);
    }
  }, [outline]);

  // ---- 导入访谈 ----
  const handleImport = useCallback(
    async (parsedOutlines: Array<{
      theme: string;
      description: string;
      targetPersona?: string;
      sections: InterviewOutline["sections"];
    }>) => {
      let imported = 0;
      for (const parsed of parsedOutlines) {
        try {
          const id = `import-${Date.now()}-${imported}-${Math.random().toString(36).slice(2, 6)}`;
          const totalDuration = parsed.sections.reduce(
            (sum, s) => sum + (s.durationMinutes || 0),
            0,
          );
          const newOutline: InterviewOutline = {
            id,
            theme: parsed.theme,
            description: parsed.description,
            targetPersona: parsed.targetPersona,
            sections: parsed.sections,
            totalDurationMinutes: totalDuration,
            createdAt: new Date().toISOString(),
          };
          const saved = await api.updateOutline(id, {
            theme: newOutline.theme,
            description: newOutline.description,
            targetPersona: newOutline.targetPersona,
            sections: newOutline.sections,
            totalDurationMinutes: newOutline.totalDurationMinutes,
          });
          setHistory((prev) => [saved, ...prev]);
          imported++;
        } catch (e) {
          toast.error(`导入「${parsed.theme}」失败: ${String(e)}`);
        }
      }
      if (imported > 0) {
        toast.success(`成功导入 ${imported} 个大纲`);
        // 刷新历史列表
        const all = await api.listOutlines();
        setHistory(all);
        const first = all[0];
        if (first) {
          setOutline(first);
          setOriginalOutline(first);
          setExpandedSections(
            new Set(first.sections.map((_, i: number) => String(i))),
          );
        }
      }
    },
    [],
  );

  const goToBatchInterview = useCallback(() => {
    if (!outline) return;
    navigate(`/interview/batch?outlineId=${outline.id}`, {
      state: { outline },
    });
  }, [outline, navigate]);

  return (
    <div ref={containerRef} className="absolute inset-0 flex flex-col gap-4">
      {/* 返回按钮 */}
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
        title="访谈大纲"
        description="创建、生成和管理深度访谈大纲。支持手动编辑和 AI 辅助生成。"
      />

      {/* 顶部操作栏 */}
      <TopActionBar
        configPanel={configPanel}
        onToggleConfig={toggleConfig}
        onOpenImport={() => setImportDialogOpen(true)}
        activeOutline={outline}
        onExportExcel={handleExportExcel}
        onBatchInterview={goToBatchInterview}
      />

      {/* 配置面板（可展开） */}
      <div className="space-y-4">
        {configPanel === "generate" && (
          <GenerateConfig
            personas={personas}
            generating={generating}
            progress={progress}
            estimatedRemainingMs={estimatedRemainingMs}
            onGenerateStart={handleGenerateStart}
            onCancel={handleCancelGenerate}
          />
        )}
        {configPanel === "manual" && (
          <ManualCreateForm onCreate={handleManualCreate} />
        )}
      </div>

      {/* 下方：历史列表 + 大纲查看 */}
      <div className="flex-1 min-h-0 flex gap-0 border border-(--color-border-default) rounded-lg">
        {/* 左侧历史列表 */}
        <div className="w-64 flex-shrink-0 border-r border-(--color-border-default) bg-(--color-surface-primary) overflow-hidden flex flex-col">
          <HistorySidebar
            history={history}
            activeOutlineId={outline?.id ?? null}
            onSelect={handleSelectOutline}
            onDelete={handleDeleteOutline}
          />
        </div>

        {/* 右侧大纲查看/编辑 */}
        <div className="flex-1 min-w-0 overflow-y-scroll p-4 bg-(--color-surface-primary) scrollbar-blue">
          <OutlineViewer
            outline={outline}
            expandedSections={expandedSections}
            onToggleSection={toggleSection}
            onOutlineChange={handleOutlineChange}
            onSave={handleSaveOutline}
            hasUnsavedChanges={!!hasUnsavedChanges}
            personas={personas}
          />
        </div>
      </div>

      {/* 删除确认对话框 */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-medium text-(--color-content-primary)">
              确认删除
            </h3>
            <p className="text-sm text-(--color-content-secondary) mt-2">
              确定要删除大纲「{deleteConfirm.theme}」吗？此操作不可撤销。
            </p>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                type="button"
                className="px-4 py-2 text-sm rounded-md border border-(--color-border-default) hover:bg-(--color-surface-secondary) transition-colors"
                onClick={() => setDeleteConfirm(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors"
                onClick={confirmDelete}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 导入访谈对话框 */}
      <ImportDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        onImport={handleImport}
      />
    </div>
  );
}