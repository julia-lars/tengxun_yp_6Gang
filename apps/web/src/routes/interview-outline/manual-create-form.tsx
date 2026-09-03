// 手动创建表单 — 快速创建空白大纲
import { FileText, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";

interface ManualCreateFormProps {
  onCreate: (theme: string, description: string) => void;
}

export function ManualCreateForm({ onCreate }: ManualCreateFormProps) {
  const [theme, setTheme] = useState("");
  const [description, setDescription] = useState("");

  const handleCreate = useCallback(() => {
    if (!theme.trim()) {
      toast.error("请输入访谈主题");
      return;
    }
    onCreate(theme.trim(), description.trim());
    setTheme("");
    setDescription("");
  }, [theme, description, onCreate]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4 text-(--color-brand-500)" />
          新建访谈大纲
        </CardTitle>
        <CardDescription>
          手动创建空白大纲，之后可在右侧编辑区添加章节和问题
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="manual-theme">访谈主题 *</Label>
          <Input
            id="manual-theme"
            placeholder="例如：射击游戏新手用户体验调研"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="manual-desc">描述（可选）</Label>
          <Textarea
            id="manual-desc"
            placeholder="项目背景、研究目标等..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="text-xs"
          />
        </div>
        <Button className="w-full" onClick={handleCreate} disabled={!theme.trim()}>
          <Plus className="h-4 w-4 mr-2" />
          创建大纲
        </Button>
      </CardContent>
    </Card>
  );
}