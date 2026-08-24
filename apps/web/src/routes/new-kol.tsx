// 新建 KOL 分身 — 手动创建或从 B 站导入
import {
  ArrowLeft,
  Download,
  FileText,
  Link,
  Plus,
  Save,
  Tag,
  Trash2,
  Upload,
  User,
  Video,
  X,
} from "lucide-react";
import { useCallback, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router";
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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/shared/page-header";

// KOL 评价维度预设
const EVAL_DIMENSIONS = [
  "核心玩法",
  "枪械手感",
  "地图设计",
  "平衡性",
  "画面表现",
  "音效音乐",
  "新手体验",
  "付费模式",
  "社交系统",
  "更新节奏",
  "竞技深度",
  "娱乐性",
];

interface SourceText {
  id: string;
  title: string;
  content: string;
  sourceUrl: string;
}

export function NewKolPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [bilibiliUid, setBilibiliUid] = useState("");
  const [identity, setIdentity] = useState("");
  const [contentFocus, setContentFocus] = useState<string[]>([]);
  const [newFocus, setNewFocus] = useState("");
  const [evalFramework, setEvalFramework] = useState<
    { dimension: string; description: string }[]
  >([]);
  const [newEvalDim, setNewEvalDim] = useState("");
  const [newEvalDesc, setNewEvalDesc] = useState("");
  const [speechHabits, setSpeechHabits] = useState("");
  const [tone, setTone] = useState("独立客观");
  const [sourceTexts, setSourceTexts] = useState<SourceText[]>([]);
  const [newSource, setNewSource] = useState({
    title: "",
    content: "",
    sourceUrl: "",
  });
  const [saving, setSaving] = useState(false);

  // 添加内容领域
  const addFocus = useCallback(() => {
    const val = newFocus.trim();
    if (!val || contentFocus.includes(val)) return;
    setContentFocus((prev) => [...prev, val]);
    setNewFocus("");
  }, [newFocus, contentFocus]);

  // 添加评价维度
  const addEvalDim = useCallback(() => {
    const dim = newEvalDim.trim();
    const desc = newEvalDesc.trim();
    if (!dim || !desc) return;
    setEvalFramework((prev) => [...prev, { dimension: dim, description: desc }]);
    setNewEvalDim("");
    setNewEvalDesc("");
  }, [newEvalDim, newEvalDesc]);

  // 添加来源文本
  const addSource = useCallback(() => {
    if (!newSource.content.trim()) return;
    setSourceTexts((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        title: newSource.title || `语料片段 ${prev.length + 1}`,
        content: newSource.content.trim(),
        sourceUrl: newSource.sourceUrl,
      },
    ]);
    setNewSource({ title: "", content: "", sourceUrl: "" });
  }, [newSource]);

  // 保存
  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      toast.error("请输入 KOL 名称");
      return;
    }
    if (!identity.trim()) {
      toast.error("请输入 KOL 身份定位");
      return;
    }
    setSaving(true);
    try {
      // TODO: 实际调用 POST /api/kol 创建接口
      await new Promise((r) => setTimeout(r, 800));
      toast.success(`KOL 分身「${name}」创建成功`);
      navigate("/kol");
    } catch {
      toast.error("创建失败，请重试");
    } finally {
      setSaving(false);
    }
  }, [name, identity, navigate]);

  return (
    <div className="space-y-6">
      <RouterLink
        to="/kol"
        className="inline-flex items-center gap-1 text-sm text-(--color-content-secondary) hover:text-(--color-brand-500) transition-colors"
      >
        <ArrowLeft className="h-3 w-3" /> 返回 KOL 列表
      </RouterLink>

      <PageHeader
        title="新建 KOL 分身"
        description="创建 KOL 数字孪生，配置人设画像、评价体系和说话风格。支持从 B 站导入真实内容。"
        actions={
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? (
              <>保存中...</>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                保存 KOL
              </>
            )}
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* 左侧：基本信息 + 评价体系 + 说话风格 */}
        <div className="lg:col-span-2 space-y-6">
          {/* 基本信息 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="h-4 w-4 text-(--color-brand-500)" />
                基本信息
              </CardTitle>
              <CardDescription>KOL 的基本身份信息和定位</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">KOL 名称 *</Label>
                  <Input
                    id="name"
                    placeholder="例如：冷面叶星星IKGN"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="uid">B 站 UID</Label>
                  <Input
                    id="uid"
                    placeholder="例如：123456789"
                    value={bilibiliUid}
                    onChange={(e) => setBilibiliUid(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="identity">身份定位 *</Label>
                <Input
                  id="identity"
                  placeholder="例如：硬核射击游戏测评UP主，专注FPS品类深度分析"
                  value={identity}
                  onChange={(e) => setIdentity(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>内容覆盖领域</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="添加内容领域，如：FPS测评、行业分析..."
                    value={newFocus}
                    onChange={(e) => setNewFocus(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addFocus())}
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={addFocus}
                    disabled={!newFocus.trim()}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {contentFocus.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {contentFocus.map((f) => (
                      <Badge
                        key={f}
                        variant="secondary"
                        className="cursor-pointer hover:opacity-80"
                        onClick={() =>
                          setContentFocus((prev) => prev.filter((x) => x !== f))
                        }
                      >
                        {f}
                        <X className="h-3 w-3 ml-1" />
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* 评价体系 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Tag className="h-4 w-4 text-(--color-brand-500)" />
                评价体系
              </CardTitle>
              <CardDescription>
                定义 KOL 评价游戏时关注的维度及标准
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">评价维度</Label>
                  <select
                    value={newEvalDim}
                    onChange={(e) => setNewEvalDim(e.target.value)}
                    className="w-full h-9 rounded-md border border-(--color-border-default) bg-(--color-surface-elevated) px-3 text-sm"
                  >
                    <option value="">选择维度...</option>
                    {EVAL_DIMENSIONS.filter(
                      (d) => !evalFramework.some((e) => e.dimension === d),
                    ).map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                    <option value="__custom__">自定义...</option>
                  </select>
                  {newEvalDim === "__custom__" && (
                    <Input
                      placeholder="输入自定义维度"
                      value=""
                      onChange={(e) => setNewEvalDim(e.target.value)}
                      className="mt-1"
                    />
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">评价标准描述</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="该维度的评价标准..."
                      value={newEvalDesc}
                      onChange={(e) => setNewEvalDesc(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && (e.preventDefault(), addEvalDim())
                      }
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={addEvalDim}
                      disabled={!newEvalDim.trim() || !newEvalDesc.trim()}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {evalFramework.length > 0 && (
                <div className="space-y-2">
                  {evalFramework.map((e) => (
                    <div
                      key={e.dimension}
                      className="flex items-start gap-3 p-3 rounded-lg bg-(--color-surface-secondary)"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-(--color-content-primary)">
                          {e.dimension}
                        </p>
                        <p className="text-xs text-(--color-content-secondary) mt-0.5">
                          {e.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setEvalFramework((prev) =>
                            prev.filter((x) => x.dimension !== e.dimension),
                          )
                        }
                        className="text-(--color-content-tertiary) hover:text-(--color-error-500) transition-colors flex-shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 说话风格 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="h-4 w-4 text-(--color-brand-500)" />
                说话风格
              </CardTitle>
              <CardDescription>
                定义 KOL 的语言习惯和表达风格
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="habits">语言习惯</Label>
                <Textarea
                  id="habits"
                  placeholder="例如：喜欢用「兄弟们」开场，常用「有一说一」「懂的都懂」等口头禅，喜欢用对比和类比来解释复杂概念..."
                  value={speechHabits}
                  onChange={(e) => setSpeechHabits(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>语气风格</Label>
                <div className="flex flex-wrap gap-2">
                  {[
                    "独立客观",
                    "犀利毒舌",
                    "幽默搞笑",
                    "专业严谨",
                    "热血激情",
                    "冷静理性",
                    "吐槽向",
                    "粉丝向",
                  ].map((t) => (
                    <Badge
                      key={t}
                      variant={tone === t ? "default" : "outline"}
                      className="cursor-pointer hover:opacity-80 transition-all"
                      onClick={() => setTone(t)}
                    >
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 来源语料 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Video className="h-4 w-4 text-(--color-brand-500)" />
                来源语料
                <Badge variant="secondary" className="text-[10px]">
                  {sourceTexts.length} 条
                </Badge>
              </CardTitle>
              <CardDescription>
                添加 KOL 的真实内容片段（视频字幕、动态、评论等），用于构建数字孪生
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 添加语料 */}
              <div className="space-y-3 p-4 rounded-lg bg-(--color-surface-secondary)">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    placeholder="来源标题（可选）"
                    value={newSource.title}
                    onChange={(e) =>
                      setNewSource((prev) => ({
                        ...prev,
                        title: e.target.value,
                      }))
                    }
                    className="text-xs"
                  />
                  <Input
                    placeholder="来源链接（可选）"
                    value={newSource.sourceUrl}
                    onChange={(e) =>
                      setNewSource((prev) => ({
                        ...prev,
                        sourceUrl: e.target.value,
                      }))
                    }
                    className="text-xs"
                  />
                </div>
                <Textarea
                  placeholder="粘贴 KOL 的真实发言内容..."
                  value={newSource.content}
                  onChange={(e) =>
                    setNewSource((prev) => ({
                      ...prev,
                      content: e.target.value,
                    }))
                  }
                  rows={3}
                  className="text-xs"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addSource}
                  disabled={!newSource.content.trim()}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  添加语料
                </Button>
              </div>

              {/* 已有语料 */}
              {sourceTexts.length > 0 && (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {sourceTexts.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-start gap-3 p-3 rounded-lg bg-(--color-surface-secondary)"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-(--color-content-primary)">
                            {s.title}
                          </span>
                          {s.sourceUrl && (
                            <a
                              href={s.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-(--color-brand-500) hover:underline"
                            >
                              查看来源 ↗
                            </a>
                          )}
                        </div>
                        <blockquote className="text-sm text-(--color-content-secondary) leading-relaxed border-l-2 border-(--color-brand-300) pl-2">
                          {s.content.slice(0, 200)}
                          {s.content.length > 200 ? "..." : ""}
                        </blockquote>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setSourceTexts((prev) =>
                            prev.filter((x) => x.id !== s.id),
                          )
                        }
                        className="text-(--color-content-tertiary) hover:text-(--color-error-500) transition-colors flex-shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 右侧：预览 + 提示 */}
        <div className="space-y-6">
          {/* 预览卡片 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">KOL 预览</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-(--color-brand-50) flex items-center justify-center mx-auto">
                <Video className="h-8 w-8 text-(--color-brand-500)" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-lg font-serif font-bold text-black">
                  {name || "未命名 KOL"}
                </p>
                <p className="text-xs text-(--color-content-tertiary)">
                  {identity || "暂无身份定位"}
                </p>
              </div>

              <Separator />

              <div className="space-y-2">
                <p className="text-xs text-(--color-content-tertiary)">
                  内容领域 ({contentFocus.length})
                </p>
                <div className="flex flex-wrap gap-1">
                  {contentFocus.length > 0 ? (
                    contentFocus.map((f) => (
                      <Badge
                        key={f}
                        variant="secondary"
                        className="text-[10px] bg-(--color-brand-50)"
                      >
                        {f}
                      </Badge>
                    ))
                  ) : (
                    <p className="text-xs text-(--color-content-tertiary)">
                      尚未添加
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-(--color-content-tertiary)">
                  评价维度 ({evalFramework.length})
                </p>
                {evalFramework.length > 0 ? (
                  <div className="space-y-1">
                    {evalFramework.slice(0, 5).map((e) => (
                      <p
                        key={e.dimension}
                        className="text-xs text-(--color-content-secondary)"
                      >
                        · {e.dimension}
                      </p>
                    ))}
                    {evalFramework.length > 5 && (
                      <p className="text-xs text-(--color-content-tertiary)">
                        ... 还有 {evalFramework.length - 5} 个维度
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-(--color-content-tertiary)">
                    尚未添加
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <p className="text-xs text-(--color-content-tertiary)">
                  语气风格
                </p>
                <Badge variant="secondary" className="text-[10px]">
                  {tone}
                </Badge>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-(--color-content-tertiary)">
                  语料片段 ({sourceTexts.length} 条)
                </p>
              </div>
            </CardContent>
          </Card>

          {/* 创建提示 */}
          <Card className="border-(--color-brand-200) bg-(--color-brand-50)/50">
            <CardContent className="py-4 space-y-2">
              <p className="text-sm font-medium text-(--color-brand-700)">
                💡 创建提示
              </p>
              <ul className="text-xs text-(--color-brand-600) space-y-1">
                <li>· KOL 名称应使用真实名称或常用昵称</li>
                <li>· 评价体系是 KOL 人设的核心，建议 5-10 个维度</li>
                <li>· 语料片段应来自真实视频/动态内容</li>
                <li>· 建议至少添加 20 条语料以获得较好的对话效果</li>
                <li>· 语料越多，AI 数字孪生的还原度越高</li>
              </ul>
            </CardContent>
          </Card>

          {/* 批量导入提示 */}
          <Card>
            <CardContent className="py-4 space-y-3">
              <div className="flex items-center gap-2">
                <Download className="h-4 w-4 text-(--color-brand-500)" />
                <p className="text-sm font-medium text-(--color-content-primary)">
                  批量导入
                </p>
              </div>
              <p className="text-xs text-(--color-content-secondary) leading-relaxed">
                你也可以通过数据流水线批量导入 KOL
                语料。支持上传文件夹、Word、Excel 等格式，AI 自动提取、清洗和嵌入。
              </p>
              <Button variant="outline" size="sm" className="w-full" asChild>
                <RouterLink to="/data-pipeline">
                  <Upload className="h-3.5 w-3.5 mr-1" />
                  前往数据流水线
                </RouterLink>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}