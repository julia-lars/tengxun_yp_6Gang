// 新建画像 — 手动添加用户画像
import { normalizeTagSpec } from "@app/shared";
import {
  ArrowLeft,
  Plus,
  Save,
  Tag,
  Trash2,
  Upload,
  User,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/shared/page-header";
import {
  TAG_DIMENSIONS,
  flattenOptions,
  getDisabledTags,
  getExclusionMessage,
  type TagDimension,
  type TagOption,
} from "@/lib/tag-data";

// 5 个主维度 + 展平后的 options
const MAIN_DIMENSIONS = TAG_DIMENSIONS.slice(0, 5).map((dim) => ({
  ...dim,
  flatOptions: flattenOptions(dim),
}));

interface EvidenceItem {
  id: string;
  sourceFile: string;
  originalText: string;
}

export function NewPersonaPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [evidenceList, setEvidenceList] = useState<EvidenceItem[]>([]);
  const [newEvidence, setNewEvidence] = useState({ sourceFile: "", text: "" });
  const [saving, setSaving] = useState(false);

  // ---- 互斥规则 ----

  const disabledTags = useMemo(() => getDisabledTags(selectedTags), [selectedTags]);

  const isTagDisabled = useCallback(
    (tagValue: string) => disabledTags.has(tagValue),
    [disabledTags],
  );

  const getDisabledReason = useCallback(
    (tagValue: string) => {
      for (const activeTag of selectedTags) {
        if (activeTag === tagValue) continue;
        const msg = getExclusionMessage(tagValue, activeTag);
        if (msg) return msg;
      }
      return null;
    },
    [selectedTags],
  );

  // ---- 标签操作 ----

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }, []);

  // ---- 证据操作 ----

  const addEvidence = useCallback(() => {
    if (!newEvidence.text.trim()) return;
    setEvidenceList((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        sourceFile: newEvidence.sourceFile || "手动录入",
        originalText: newEvidence.text.trim(),
      },
    ]);
    setNewEvidence({ sourceFile: "", text: "" });
  }, [newEvidence]);

  const removeEvidence = useCallback((id: string) => {
    setEvidenceList((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // ---- 保存 ----

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      toast.error("请输入画像名称");
      return;
    }

    // 组装 TagSpec v2（兼容旧扁平格式）
    const tagSpec = normalizeTagSpec({
      诉求: selectedTags,
      能力: selectedTags,
      风格: selectedTags,
      平台: selectedTags,
      模式: selectedTags,
    });

    setSaving(true);
    // TODO: 接入真实 API（createPersona）
    await new Promise((r) => setTimeout(r, 800));
    console.log("保存 TagSpec v2:", tagSpec);
    toast.success(`画像「${name}」创建成功`);
    setSaving(false);
    navigate("/personas");
  }, [name, selectedTags, navigate]);

  return (
    <div className="space-y-6">
      <Link
        to="/personas"
        className="inline-flex items-center gap-1 text-sm text-(--color-content-secondary) hover:text-(--color-brand-500) transition-colors"
      >
        <ArrowLeft className="h-3 w-3" /> 返回画像列表
      </Link>

      <PageHeader
        title="新建用户画像"
        description="手动创建用户画像，填写基本信息和特征标签，添加代表性原声证据。"
        actions={
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? (
              <>保存中...</>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                保存画像
              </>
            )}
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* 左侧：基本信息 + 标签 */}
        <div className="lg:col-span-2 space-y-6">
          {/* 基本信息 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="h-4 w-4 text-(--color-brand-500)" />
                基本信息
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">画像名称 *</Label>
                <Input
                  id="name"
                  placeholder="例如：竞技核心玩家、休闲社交玩家..."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">画像描述</Label>
                <Textarea
                  id="desc"
                  placeholder="描述该画像的典型特征、行为模式、游戏偏好等..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                />
              </div>
            </CardContent>
          </Card>

          {/* 特征标签 — 5 维度扁平选择器 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Tag className="h-4 w-4 text-(--color-brand-500)" />
                特征标签
                <Badge variant="secondary" className="text-[10px]">
                  {selectedTags.length} 已选
                </Badge>
              </CardTitle>
              <CardDescription>选择该画像的典型特征标签</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {MAIN_DIMENSIONS.map((dim) => (
                <div key={dim.name}>
                  <p className="text-sm font-medium text-(--color-content-secondary) mb-2">
                    {dim.label}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {dim.flatOptions.map((opt: TagOption) => {
                      const isActive = selectedTags.includes(opt.value);
                      const disabled = !isActive && isTagDisabled(opt.value);
                      const disabledReason = disabled ? getDisabledReason(opt.value) : null;

                      const badge = (
                        <Badge
                          key={opt.value}
                          variant={isActive ? "default" : "outline"}
                          className={`cursor-pointer hover:opacity-80 transition-all duration-150 ${
                            disabled ? "opacity-30 cursor-not-allowed hover:opacity-30" : ""
                          }`}
                          onClick={() => {
                            if (disabled) return;
                            toggleTag(opt.value);
                          }}
                          title={opt.description}
                        >
                          {isActive && <X className="h-3 w-3 mr-1" />}
                          {opt.label}
                        </Badge>
                      );

                      return badge;
                    })}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* 代表性原声 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Upload className="h-4 w-4 text-(--color-brand-500)" />
                代表性原声
                <Badge variant="secondary" className="text-[10px]">
                  {evidenceList.length} 条
                </Badge>
              </CardTitle>
              <CardDescription>
                添加该画像代表用户的真实访谈原声片段
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 添加原声 */}
              <div className="space-y-3 p-4 rounded-lg bg-(--color-surface-secondary)">
                <div className="grid grid-cols-3 gap-3">
                  <Input
                    placeholder="来源文件（可选）"
                    value={newEvidence.sourceFile}
                    onChange={(e) =>
                      setNewEvidence((prev) => ({ ...prev, sourceFile: e.target.value }))
                    }
                    className="text-xs"
                  />
                </div>
                <Textarea
                  placeholder="粘贴玩家原声文本..."
                  value={newEvidence.text}
                  onChange={(e) => setNewEvidence((prev) => ({ ...prev, text: e.target.value }))}
                  rows={2}
                  className="text-xs"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addEvidence}
                  disabled={!newEvidence.text.trim()}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  添加
                </Button>
              </div>

              {/* 已有原声列表 */}
              {evidenceList.length > 0 && (
                <div className="space-y-2">
                  {evidenceList.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-start gap-3 p-3 rounded-lg bg-(--color-surface-secondary)"
                    >
                      <div className="flex-1 min-w-0">
                        <blockquote className="text-sm text-(--color-content-secondary) leading-relaxed border-l-2 border-(--color-brand-300) pl-2">
                          {e.originalText.slice(0, 200)}
                          {e.originalText.length > 200 ? "..." : ""}
                        </blockquote>
                        <p className="text-[10px] text-(--color-content-tertiary) mt-1">
                          📁 {e.sourceFile}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeEvidence(e.id)}
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
              <CardTitle className="text-base">画像预览</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-(--color-brand-50) flex items-center justify-center mx-auto">
                <User className="h-8 w-8 text-(--color-brand-500)" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-lg font-serif font-bold text-black">
                  {name || "未命名画像"}
                </p>
                <p className="text-xs text-(--color-content-tertiary)">
                  {description
                    ? description.slice(0, 80) + (description.length > 80 ? "..." : "")
                    : "暂无描述"}
                </p>
              </div>

              <Separator />

              <div className="space-y-2">
                <p className="text-xs text-(--color-content-tertiary)">
                  已选标签 ({selectedTags.length})
                </p>
                <div className="flex flex-wrap gap-1">
                  {selectedTags.length > 0 ? (
                    selectedTags.map((t) => (
                      <Badge key={t} variant="secondary" className="text-[10px]">
                        {t}
                      </Badge>
                    ))
                  ) : (
                    <p className="text-xs text-(--color-content-tertiary)">尚未选择标签</p>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-(--color-content-tertiary)">
                  原声证据 ({evidenceList.length} 条)
                </p>
                <p className="text-xs text-(--color-content-tertiary)">
                  样本来源: {new Set(evidenceList.map((e) => e.sourceFile)).size} 个文件
                </p>
              </div>
            </CardContent>
          </Card>

          {/* 创建提示 */}
          <Card className="border-(--color-brand-200) bg-(--color-brand-50)/50">
            <CardContent className="py-4 space-y-2">
              <p className="text-sm font-medium text-(--color-brand-700)">💡 创建提示</p>
              <ul className="text-xs text-(--color-brand-600) space-y-1">
                <li>· 画像名称应简洁明了，如「竞技核心玩家」</li>
                <li>· 选择 3-8 个核心标签最能体现画像特征</li>
                <li>· 每条原声证据应来自真实访谈数据</li>
                <li>· 建议至少添加 5 条代表性原声</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}