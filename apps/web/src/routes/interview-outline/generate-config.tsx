// AI 生成配置面板 — 从现有代码提取，可展开/收起
import type { OutlineGenerateRequest, PersonaSummary } from "@app/shared";
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
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { formatRemainingTime } from "@/lib/utils";
import { Loader2, Plus, Sparkles, Wand2, X, XCircle } from "lucide-react";

interface GenerateConfigProps {
  personas: PersonaSummary[];
  generating: boolean;
  progress: number;
  estimatedRemainingMs: number | undefined;
  onGenerateStart: (jobId: string) => void;
  onCancel: () => void;
}

export function GenerateConfig({
  personas,
  generating,
  progress,
  estimatedRemainingMs,
  onGenerateStart,
  onCancel,
}: GenerateConfigProps) {
  const [theme, setTheme] = useState("");
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const [newFocus, setNewFocus] = useState("");
  const [additionalContext, setAdditionalContext] = useState("");
  const [questionCount, setQuestionCount] = useState(15);
  const [selectedPersonas, setSelectedPersonas] = useState<number[]>([]);

  const addFocus = useCallback(() => {
    const val = newFocus.trim();
    if (!val || focusAreas.includes(val)) return;
    setFocusAreas((prev) => [...prev, val]);
    setNewFocus("");
  }, [newFocus, focusAreas]);

  const handleGenerate = useCallback(async () => {
    if (!theme.trim()) {
      toast.error("请输入访谈主题");
      return;
    }
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
      onGenerateStart(jobId);
    } catch (e) {
      toast.error(`生成失败: ${String(e)}`);
    }
  }, [theme, selectedPersonas, focusAreas, additionalContext, questionCount, onGenerateStart]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-(--color-brand-500)" />
          AI 生成配置
        </CardTitle>
        <CardDescription>设置访谈主题和参数，AI 自动生成结构化大纲</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 主题 */}
        <div className="space-y-2">
          <Label htmlFor="gen-theme">访谈主题 *</Label>
          <Textarea
            id="gen-theme"
            placeholder="例如：玩家对「搜打撤」玩法的接受度与改进建议"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            rows={2}
            className="text-sm"
            disabled={generating}
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
              disabled={generating}
            />
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={addFocus}
              disabled={!newFocus.trim() || generating}
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
                    !generating &&
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
                  disabled={generating}
                  className="rounded"
                />
                <span className="text-(--color-content-primary)">{p.name}</span>
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
            disabled={generating}
            className="w-full"
          />
          <div className="flex justify-between text-[10px] text-(--color-content-tertiary)">
            <span>5</span>
            <span>50</span>
          </div>
        </div>

        {/* 补充上下文 */}
        <div className="space-y-2">
          <Label htmlFor="gen-context">补充信息</Label>
          <Textarea
            id="gen-context"
            placeholder="项目背景、研究目标、已知信息等..."
            value={additionalContext}
            onChange={(e) => setAdditionalContext(e.target.value)}
            rows={3}
            className="text-xs"
            disabled={generating}
          />
        </div>

        {/* 生成按钮 */}
        {generating ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-(--color-content-secondary)">
                {formatRemainingTime(estimatedRemainingMs)}
              </span>
              <span className="font-medium text-(--color-brand-500)">
                {progress}%
              </span>
            </div>
            <Progress value={progress} className="h-2" />
            <Button className="w-full" disabled>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {formatRemainingTime(estimatedRemainingMs)}
            </Button>
            <Button
              className="w-full"
              variant="outline"
              onClick={onCancel}
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
  );
}