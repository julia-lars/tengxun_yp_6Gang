// 大纲查看/编辑器 — 主要查看和编辑区域
import type { InterviewOutline, InterviewQuestion } from "@app/shared";
import {
  Check,
  Clock,
  FileText,
  MessageCircle,
  Plus,
  Save,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { useCallback, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { api } from "@/lib/api";
import { SectionEditor } from "./section-editor";

type Section = InterviewOutline["sections"][number];

interface OutlineViewerProps {
  outline: InterviewOutline | null;
  expandedSections: Set<string>;
  onToggleSection: (idx: string) => void;
  onOutlineChange: (updated: InterviewOutline) => void;
  onSave: () => void;
  hasUnsavedChanges: boolean;
  personas: Array<{ id: number; name: string }>;
}

export function OutlineViewer({
  outline,
  expandedSections,
  onToggleSection,
  onOutlineChange,
  onSave,
  hasUnsavedChanges,
  personas,
}: OutlineViewerProps) {
  const [refining, setRefining] = useState(false);
  const [refiningQuestionId, setRefiningQuestionId] = useState<string | null>(
    null,
  );

  const [editingMeta, setEditingMeta] = useState(false);
  const [editTheme, setEditTheme] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTargetPersona, setEditTargetPersona] = useState("");

  const startEditMeta = useCallback(() => {
    if (!outline) return;
    setEditTheme(outline.theme);
    setEditDescription(outline.description);
    setEditTargetPersona(outline.targetPersona ?? "");
    setEditingMeta(true);
  }, [outline]);

  const saveMeta = useCallback(() => {
    if (!outline) return;
    onOutlineChange({
      ...outline,
      theme: editTheme.trim() || outline.theme,
      description: editDescription.trim(),
      targetPersona: editTargetPersona.trim() || undefined,
    });
    setEditingMeta(false);
  }, [outline, editTheme, editDescription, editTargetPersona, onOutlineChange]);

  const updateSection = useCallback(
    (sIdx: number, updated: Section) => {
      if (!outline) return;
      const newSections = [...outline.sections];
      newSections[sIdx] = updated;
      onOutlineChange({ ...outline, sections: newSections });
    },
    [outline, onOutlineChange],
  );

  const deleteSection = useCallback(
    (sIdx: number) => {
      if (!outline) return;
      const newSections = outline.sections.filter((_, i) => i !== sIdx);
      onOutlineChange({ ...outline, sections: newSections });
      toast.success("章节已删除");
    },
    [outline, onOutlineChange],
  );

  const addSection = useCallback(() => {
    if (!outline) return;
    const newSection: Section = {
      title: "新章节",
      purpose: "请编辑本章节目的",
      durationMinutes: 10,
      questions: [],
    };
    onOutlineChange({
      ...outline,
      sections: [...outline.sections, newSection],
    });
    // 自动展开新章节
    const newIdx = String(outline.sections.length);
    onToggleSection(newIdx);
    toast.success("新章节已添加");
  }, [outline, onOutlineChange, onToggleSection]);

  const addQuestion = useCallback(
    (sIdx: number) => {
      if (!outline) return;
      const newQ: InterviewQuestion = {
        id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
        question: "新问题",
        category: "行为",
        purpose: "请编辑问题目的",
        expectedInsight: "请编辑预期洞察",
      };
      const newSections = [...outline.sections];
      newSections[sIdx] = {
        ...newSections[sIdx]!,
        questions: [...newSections[sIdx]!.questions, newQ],
      } as Section;
      onOutlineChange({ ...outline, sections: newSections });
      // 确保章节展开
      if (!expandedSections.has(String(sIdx))) {
        onToggleSection(String(sIdx));
      }
    },
    [outline, onOutlineChange, expandedSections, onToggleSection],
  );

  const updateQuestion = useCallback(
    (sIdx: number, qIdx: number, updated: InterviewQuestion) => {
      if (!outline) return;
      const newSections = [...outline.sections];
      const newQuestions = [...newSections[sIdx]!.questions];
      newQuestions[qIdx] = updated;
      newSections[sIdx] = { ...newSections[sIdx], questions: newQuestions } as Section;
      onOutlineChange({ ...outline, sections: newSections });
    },
    [outline, onOutlineChange],
  );

  const deleteQuestion = useCallback(
    (sIdx: number, qIdx: number) => {
      if (!outline) return;
      const newSections = [...outline.sections];
      const newQuestions = newSections[sIdx]!.questions.filter(
        (_, i) => i !== qIdx,
      );
      newSections[sIdx] = { ...newSections[sIdx], questions: newQuestions } as Section;
      onOutlineChange({ ...outline, sections: newSections });
      toast.success("问题已删除");
    },
    [outline, onOutlineChange],
  );

  const refineQuestion = useCallback(
    async (sIdx: number, qIdx: number, question: InterviewQuestion) => {
      if (!outline) return;
      setRefining(true);
      setRefiningQuestionId(question.id);
      try {
        const personaContext = personas
          .map((p) => p.name)
          .join("、");
        const result = await api.refineQuestion({
          question: question.question,
          theme: outline.theme,
          personaContext: personaContext || undefined,
        });
        const updated: InterviewQuestion = {
          ...question,
          question: result.refined,
          followUps: result.suggestedFollowUps ?? question.followUps,
        };
        updateQuestion(sIdx, qIdx, updated);
        toast.success("问题已优化", {
          description: result.rationale.slice(0, 100),
        });
      } catch {
        toast.error("优化失败");
      } finally {
        setRefining(false);
        setRefiningQuestionId(null);
      }
    },
    [outline, personas, updateQuestion],
  );

  if (!outline) {
    return (
      <EmptyState
        icon={Sparkles}
        title="选择或创建访谈大纲"
        description="从左侧历史列表中选择一个大纲，或在上方新建/AI生成访谈大纲"
      />
    );
  }

  const questionCount = outline.sections.reduce(
    (sum, s) => sum + s.questions.length,
    0,
  );
  const questionCategories = [
    ...new Set(
      outline.sections.flatMap((s) => s.questions.map((q) => q.category)),
    ),
  ];

  return (
    <div className="space-y-6">
      {/* 大纲概览（可编辑） */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between">
            {editingMeta ? (
              <div className="flex-1 space-y-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium text-(--color-content-tertiary)">
                    主题
                  </label>
                  <Input
                    value={editTheme}
                    onChange={(e) => setEditTheme(e.target.value)}
                    className="text-sm"
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium text-(--color-content-tertiary)">
                    描述
                  </label>
                  <Textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={2}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium text-(--color-content-tertiary)">
                    目标画像
                  </label>
                  <Input
                    value={editTargetPersona}
                    onChange={(e) => setEditTargetPersona(e.target.value)}
                    className="text-xs"
                    placeholder="例如：竞技玩家、休闲玩家"
                  />
                </div>
                <div className="flex items-center gap-1.5 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setEditingMeta(false)}
                  >
                    <X className="h-3 w-3 mr-1" />
                    取消
                  </Button>
                  <Button size="sm" className="h-7 text-xs" onClick={saveMeta}>
                    <Check className="h-3 w-3 mr-1" />
                    保存
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <CardTitle className="text-xl flex items-center gap-2">
                  <FileText className="h-5 w-5 text-(--color-brand-500)" />
                  <span
                    className="cursor-pointer hover:text-(--color-brand-500) transition-colors"
                    onClick={startEditMeta}
                    title="点击编辑"
                  >
                    {outline.theme}
                  </span>
                </CardTitle>
                <CardDescription
                  className="mt-1 cursor-pointer hover:text-(--color-brand-500) transition-colors"
                  onClick={startEditMeta}
                  title="点击编辑"
                >
                  {outline.description || "点击编辑描述..."}
                </CardDescription>
              </div>
            )}
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                variant={hasUnsavedChanges ? "default" : "outline"}
                size="sm"
                onClick={onSave}
              >
                <Save className="h-3.5 w-3.5 mr-1" />
                {hasUnsavedChanges ? "保存修改 *" : "保存"}
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
              {questionCount} 个问题
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
                <Badge key={c} variant="secondary" className="text-[10px]">
                  {c}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 章节列表 */}
      <div className="space-y-4">
        {outline.sections.map((section, sIdx) => (
          <SectionEditor
            key={`${sIdx}-${section.title}`}
            section={section}
            sectionIndex={sIdx}
            isExpanded={expandedSections.has(String(sIdx))}
            onToggle={() => onToggleSection(String(sIdx))}
            onUpdate={(updated) => updateSection(sIdx, updated)}
            onDelete={() => deleteSection(sIdx)}
            onAddQuestion={() => addQuestion(sIdx)}
            onUpdateQuestion={(qIdx, updated) =>
              updateQuestion(sIdx, qIdx, updated)
            }
            onDeleteQuestion={(qIdx) => deleteQuestion(sIdx, qIdx)}
            onRefineQuestion={(qIdx, question) =>
              refineQuestion(sIdx, qIdx, question)
            }
            refining={refining}
            refiningQuestionId={refiningQuestionId}
          />
        ))}
      </div>

      {/* 添加章节 */}
      <Button
        variant="outline"
        className="w-full"
        onClick={addSection}
      >
        <Plus className="h-4 w-4 mr-2" />
        添加章节
      </Button>
    </div>
  );
}