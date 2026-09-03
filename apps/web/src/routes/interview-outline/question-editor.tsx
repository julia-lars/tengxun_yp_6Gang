// 问题编辑器 — 内联编辑单个问题，支持 AI 优化
import type { InterviewQuestion } from "@app/shared";
import { Check, Lightbulb, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const QUESTION_CATEGORIES = ["行为", "态度", "动机", "场景", "评价"] as const;

interface QuestionEditorProps {
  question: InterviewQuestion;
  index: number;
  refining: boolean;
  isRefiningThis: boolean;
  onUpdate: (updated: InterviewQuestion) => void;
  onDelete: () => void;
  onRefine: (question: InterviewQuestion) => void;
}

export function QuestionEditor({
  question,
  index,
  refining,
  isRefiningThis,
  onUpdate,
  onDelete,
  onRefine,
}: QuestionEditorProps) {
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState(question);
  const [newFollowUp, setNewFollowUp] = useState("");

  const handleStartEdit = () => {
    setEditData({ ...question });
    setEditing(true);
  };

  const handleSave = () => {
    if (!editData.question.trim()) return;
    onUpdate(editData);
    setEditing(false);
  };

  const handleCancel = () => {
    setEditData({ ...question });
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") handleCancel();
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleSave();
  };

  if (editing) {
    return (
      <div className="p-3 rounded-lg bg-(--color-surface-secondary) border border-(--color-brand-200) space-y-3">
        {/* 问题文本 */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-medium text-(--color-content-tertiary)">
            问题 {index + 1}
          </label>
          <Textarea
            value={editData.question}
            onChange={(e) =>
              setEditData((prev) => ({ ...prev, question: e.target.value }))
            }
            onKeyDown={handleKeyDown}
            rows={2}
            className="text-sm"
            placeholder="输入问题..."
            autoFocus
          />
        </div>

        {/* 类别 */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-medium text-(--color-content-tertiary)">
            类别
          </label>
          <select
            value={editData.category}
            onChange={(e) =>
              setEditData((prev) => ({ ...prev, category: e.target.value }))
            }
            className="w-full text-xs rounded-md border border-(--color-border-default) px-2 py-1.5 bg-(--color-surface-primary)"
          >
            {QUESTION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* 目的 */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-medium text-(--color-content-tertiary)">
            目的
          </label>
          <Input
            value={editData.purpose}
            onChange={(e) =>
              setEditData((prev) => ({ ...prev, purpose: e.target.value }))
            }
            onKeyDown={handleKeyDown}
            className="text-xs"
            placeholder="此问题的目的..."
          />
        </div>

        {/* 预期洞察 */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-medium text-(--color-content-tertiary)">
            预期洞察
          </label>
          <Input
            value={editData.expectedInsight}
            onChange={(e) =>
              setEditData((prev) => ({
                ...prev,
                expectedInsight: e.target.value,
              }))
            }
            onKeyDown={handleKeyDown}
            className="text-xs"
            placeholder="预期获得的洞察..."
          />
        </div>

        {/* 追问 */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-medium text-(--color-content-tertiary)">
            追问建议
          </label>
          {(editData.followUps ?? []).map((fu, fi) => (
            <div key={fi} className="flex gap-1.5 items-center">
              <Input
                value={fu}
                onChange={(e) => {
                  const newFollowUps = [...(editData.followUps ?? [])];
                  newFollowUps[fi] = e.target.value;
                  setEditData((prev) => ({ ...prev, followUps: newFollowUps }));
                }}
                className="text-xs flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 flex-shrink-0"
                onClick={() => {
                  const newFollowUps = (editData.followUps ?? []).filter(
                    (_, i) => i !== fi,
                  );
                  setEditData((prev) => ({
                    ...prev,
                    followUps: newFollowUps.length > 0 ? newFollowUps : undefined,
                  }));
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <div className="flex gap-1.5">
            <Input
              placeholder="添加追问..."
              value={newFollowUp}
              onChange={(e) => setNewFollowUp(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newFollowUp.trim()) {
                  e.preventDefault();
                  setEditData((prev) => ({
                    ...prev,
                    followUps: [...(prev.followUps ?? []), newFollowUp.trim()],
                  }));
                  setNewFollowUp("");
                }
              }}
              className="text-xs flex-1"
            />
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              disabled={!newFollowUp.trim()}
              onClick={() => {
                if (!newFollowUp.trim()) return;
                setEditData((prev) => ({
                  ...prev,
                  followUps: [...(prev.followUps ?? []), newFollowUp.trim()],
                }));
                setNewFollowUp("");
              }}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* 编辑操作按钮 */}
        <div className="flex items-center justify-end gap-1.5 pt-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleCancel}>
            <X className="h-3 w-3 mr-1" />
            取消
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={handleSave}
            disabled={!editData.question.trim()}
          >
            <Check className="h-3 w-3 mr-1" />
            保存
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 rounded-lg bg-(--color-surface-secondary) space-y-2 group">
      <div className="flex items-start gap-2">
        <span className="text-xs font-medium text-(--color-brand-500) mt-0.5">
          {index + 1}.
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-(--color-content-primary)">
            {question.question}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <Badge variant="outline" className="text-[10px]">
              {question.category}
            </Badge>
            <span className="text-xs text-(--color-content-tertiary)">
              {question.purpose}
            </span>
          </div>
          <p className="text-xs text-(--color-content-secondary) mt-1">
            <Lightbulb className="h-3 w-3 inline mr-1 text-amber-500" />
            {question.expectedInsight}
          </p>
          {question.followUps && question.followUps.length > 0 && (
            <div className="mt-2 space-y-0.5">
              <p className="text-[10px] font-medium text-(--color-content-tertiary)">
                追问建议：
              </p>
              {question.followUps.map((fu, fi) => (
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
        <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleStartEdit}
            title="编辑问题"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onRefine(question)}
            disabled={refining}
            title="AI 优化"
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5",
                isRefiningThis && "animate-spin",
              )}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-(--color-content-tertiary) hover:text-red-500"
            onClick={onDelete}
            title="删除问题"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}