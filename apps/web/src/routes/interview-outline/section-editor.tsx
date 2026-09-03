// 章节编辑器 — 可折叠的章节，包含问题列表和增删操作
import type { InterviewQuestion, InterviewOutline } from "@app/shared";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { QuestionEditor } from "./question-editor";

type Section = InterviewOutline["sections"][number];

interface SectionEditorProps {
  section: Section;
  sectionIndex: number;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdate: (updated: Section) => void;
  onDelete: () => void;
  onAddQuestion: () => void;
  onUpdateQuestion: (qIndex: number, updated: InterviewQuestion) => void;
  onDeleteQuestion: (qIndex: number) => void;
  onRefineQuestion: (qIndex: number, question: InterviewQuestion) => void;
  refining: boolean;
  refiningQuestionId: string | null;
}

export function SectionEditor({
  section,
  sectionIndex,
  isExpanded,
  onToggle,
  onUpdate,
  onDelete,
  onAddQuestion,
  onUpdateQuestion,
  onDeleteQuestion,
  onRefineQuestion,
  refining,
  refiningQuestionId,
}: SectionEditorProps) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(section.title);
  const [editPurpose, setEditPurpose] = useState(section.purpose);
  const [editDuration, setEditDuration] = useState(section.durationMinutes);

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditTitle(section.title);
    setEditPurpose(section.purpose);
    setEditDuration(section.durationMinutes);
    setEditing(true);
  };

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdate({
      ...section,
      title: editTitle.trim() || section.title,
      purpose: editPurpose.trim() || section.purpose,
      durationMinutes: editDuration > 0 ? editDuration : section.durationMinutes,
    });
    setEditing(false);
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(false);
  };

  return (
    <Card className="shadow-none">
      <CardHeader
        className="pb-3 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-(--color-brand-50) flex items-center justify-center text-sm font-bold text-(--color-brand-600) flex-shrink-0">
            {sectionIndex + 1}
          </div>
          {editing ? (
            <div
              className="flex-1 min-w-0 space-y-2"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setEditing(false);
                }
              }}
            >
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="text-sm font-medium"
                placeholder="章节标题"
                autoFocus
              />
              <div className="flex gap-2">
                <Input
                  value={editPurpose}
                  onChange={(e) => setEditPurpose(e.target.value)}
                  className="text-xs flex-1"
                  placeholder="本章节目的"
                />
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    value={editDuration}
                    onChange={(e) => setEditDuration(Number(e.target.value))}
                    className="text-xs w-16"
                    min={1}
                  />
                  <span className="text-xs text-(--color-content-tertiary) whitespace-nowrap">
                    分钟
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={handleCancel}
                >
                  <X className="h-3 w-3 mr-1" />
                  取消
                </Button>
                <Button size="sm" className="h-6 text-xs" onClick={handleSave}>
                  <Check className="h-3 w-3 mr-1" />
                  保存
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base truncate">
                  {section.title}
                </CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  onClick={handleStartEdit}
                  title="编辑章节"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-(--color-content-tertiary) hover:text-red-500 flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  title="删除章节"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <CardDescription className="text-xs mt-0.5">
                {section.purpose} · {section.durationMinutes} 分钟 ·{" "}
                {section.questions.length} 个问题
              </CardDescription>
            </div>
          )}
          <div className="flex-shrink-0">
            {isExpanded ? (
              <ChevronDown className="h-5 w-5 text-(--color-brand-500)" />
            ) : (
              <ChevronRight className="h-5 w-5 text-(--color-brand-500)" />
            )}
          </div>
        </div>
      </CardHeader>
      {isExpanded && !editing && (
        <CardContent className="space-y-3 pt-0">
          {section.questions.map((q, qIdx) => (
            <QuestionEditor
              key={q.id}
              question={q}
              index={qIdx}
              refining={refining}
              isRefiningThis={refiningQuestionId === q.id}
              onUpdate={(updated) => onUpdateQuestion(qIdx, updated)}
              onDelete={() => onDeleteQuestion(qIdx)}
              onRefine={(question) => onRefineQuestion(qIdx, question)}
            />
          ))}
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={onAddQuestion}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            添加问题
          </Button>
        </CardContent>
      )}
    </Card>
  );
}