// 画像详情页面 — 仪表盘布局 v2.0
import type { PersonaDetail, PersonaSummary } from "@app/shared";
import {
  ArrowLeft,
  BarChart3,
  Clock,
  Hash,
  Layers,
  MessageCircle,
  Percent,
  Users,
} from "lucide-react";
import { useEffect, useState, useCallback, useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfidenceIndicator } from "@/components/ui/confidence-indicator";
import { IcebergChain } from "@/components/ui/iceberg-chain";
import { RadarChart } from "@/components/personas/radar-chart";
import { SimilarPersonas } from "@/components/personas/similar-personas";
import { api } from "../lib/api.js";
import { computePersonaConfidence } from "../lib/utils.js";
import { cn } from "@/lib/utils.js";

// ============================================================
// 工具函数
// ============================================================

/** 从 tagSpec 获取字符串数组 */
function getArray(spec: Record<string, string | string[]>, key: string): string[] {
  const val = spec[key];
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

/** 从 tagSpec 获取字符串 */
function getString(spec: Record<string, string | string[]>, key: string): string | null {
  const val = spec[key];
  if (!val) return null;
  if (Array.isArray(val)) return val.length > 0 ? (val[0] ?? null) : null;
  return val;
}

/** 风格中性值 */
const STYLE_NEUTRAL = new Set(["灵活平衡", "情境切换", "团队个人平衡", "混合", "均可"]);

/** 维度元信息 */
const DIM_META: Record<string, { label: string; color: string; max: number }> = {
  "诉求": { label: "游戏诉求", color: "var(--color-dim-needs)", max: 12 },
  "能力": { label: "游戏能力", color: "var(--color-dim-ability)", max: 1 },
  "风格": { label: "游戏风格", color: "var(--color-dim-style)", max: 5 },
  "平台": { label: "平台偏好", color: "var(--color-dim-platform)", max: 1 },
  "模式": { label: "游戏模式", color: "var(--color-dim-mode)", max: 1 },
};

/** 维度两端标签 */
const DIM_ENDS: Record<string, [string, string]> = {
  "诉求": ["少", "多"],
  "能力": ["低", "高"],
  "风格": ["弱", "强"],
  "平台": ["移动端", "PC端"],
  "模式": ["单一", "多样"],
};

/** 根据维度值生成分析文本 */
function analyzeDim(label: string, value: number): string {
  const tiers: Record<string, string[]> = {
    "诉求": ["诉求聚焦单一，目标明确", "有少量核心诉求", "诉求较为多样化", "诉求非常丰富，兴趣广泛"],
    "能力": ["新手入门阶段", "休闲玩家水平", "具备一定游戏理解", "核心玩家，理解深入"],
    "风格": ["风格均衡，适应性广", "有轻度风格偏好", "风格特征较为明显", "风格特征鲜明，偏好独特"],
    "平台": ["纯移动端玩家", "偏好移动端", "偏好PC/主机端", "纯PC/主机端玩家"],
    "模式": ["模式较为聚焦", "偏好特定模式", "模式多样化", "全模式通吃，涉猎广泛"],
  };
  const list = tiers[label];
  if (!list) return "";
  const idx = value >= 0.75 ? 3 : value >= 0.5 ? 2 : value >= 0.25 ? 1 : 0;
  return list[idx]!;
}

/** 计算 tagSpec 各维度归一化值（0-1） */
function computeTagSpecNormalized(
  spec: Record<string, string | string[]>,
): { label: string; value: number }[] {
  const needs = getArray(spec, "诉求");
  const ability = getString(spec, "能力");
  const style = getArray(spec, "风格");
  const platform = getString(spec, "平台");
  const mode = getString(spec, "模式");

  const needsVal = Math.min(needs.length / 12, 1);
  const abilityVal = ability && ability !== "未知" ? 0.75 : 0.25;
  const styleCount = style.filter((s) => !STYLE_NEUTRAL.has(s)).length;
  const styleVal = Math.min(styleCount / 5, 1);
  const platformVal = platform && platform !== "未知" ? 0.75 : 0.25;
  const modeVal = mode ? 0.75 : 0.25;

  return [
    { label: "诉求", value: needsVal },
    { label: "能力", value: abilityVal },
    { label: "风格", value: styleVal },
    { label: "平台", value: platformVal },
    { label: "模式", value: modeVal },
  ];
}

/** 计算全体画像各维度均值 */
function computeAllPersonaAverages(
  personas: PersonaSummary[],
): { label: string; value: number }[] {
  if (personas.length === 0) return [];
  const sums = [0, 0, 0, 0, 0];
  for (const p of personas) {
    const spec = p.tagSpec as Record<string, string | string[]>;
    const vals = computeTagSpecNormalized(spec);
    vals.forEach((v, i) => {
      if (sums[i] !== undefined) sums[i] += v.value;
    });
  }
  return [
    { label: "诉求", value: sums[0]! / personas.length },
    { label: "能力", value: sums[1]! / personas.length },
    { label: "风格", value: sums[2]! / personas.length },
    { label: "平台", value: sums[3]! / personas.length },
    { label: "模式", value: sums[4]! / personas.length },
  ];
}

/** 从证据列表提取来源文件名（去重） */
function extractSourceFiles(evidenceList: { sourceFile: string }[]): string[] {
  return [...new Set(evidenceList.map((e) => e.sourceFile.split("/").pop() ?? e.sourceFile))];
}

// ============================================================
// 子组件：维度行
// ============================================================

function DimensionRow({
  label,
  children,
}: {
  label: string;
  count: number;
  max: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-sm font-medium text-(--color-content-secondary) w-20 flex-shrink-0 pt-0.5">{label}</span>
      <div className="flex flex-wrap gap-1.5 flex-1">{children}</div>
    </div>
  );
}

// ============================================================
// 主页面组件
// ============================================================

export function PersonaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [persona, setPersona] = useState<PersonaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [allPersonas, setAllPersonas] = useState<PersonaSummary[]>([]);
  const [expandedEvidence, setExpandedEvidence] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!id) return;
    api
      .getPersona(Number(id))
      .then(setPersona)
      .finally(() => setLoading(false));

    api
      .listPersonas()
      .then(setAllPersonas)
      .catch(() => setAllPersonas([]));
  }, [id]);

  const toggleEvidence = useCallback((evidenceId: number) => {
    setExpandedEvidence((prev) => {
      const next = new Set(prev);
      if (next.has(evidenceId)) next.delete(evidenceId);
      else next.add(evidenceId);
      return next;
    });
  }, []);

  // ---- 派生数据（必须在 early return 之前）----
  const tagSpec = (persona?.tagSpec ?? {}) as Record<string, string | string[]>;
  const motivationChain = (persona?.motivationChain as Record<string, string>) ?? {};
  const radarData = persona ? computeTagSpecNormalized(tagSpec) : [];
  const averages = useMemo(() => computeAllPersonaAverages(allPersonas), [allPersonas]);
  const sourceFiles = persona ? extractSourceFiles(persona.evidenceList) : [];
  const confidenceScore = persona
    ? computePersonaConfidence({
        sampleCount: persona.sampleCount,
        evidenceCount: persona.evidenceList.length,
        tagSpec,
        motivationChain: persona.motivationChain as Record<string, unknown> | null,
      })
    : 0;

  // ---- loading ----
  if (loading)
    return (
      <div className="py-8 text-center text-[--color-muted-foreground]">
        <div className="skeleton-shimmer h-8 w-48 mx-auto rounded mb-4" />
        <div className="skeleton-shimmer h-4 w-64 mx-auto rounded" />
      </div>
    );

  // ---- empty ----
  if (!persona)
    return <div className="py-8 text-center text-[--color-muted-foreground]">画像不存在</div>;

  // 维度标签数据
  const needs = getArray(tagSpec, "诉求");
  const ability = getString(tagSpec, "能力");
  const style = getArray(tagSpec, "风格");
  const platform = getString(tagSpec, "平台");
  const mode = getString(tagSpec, "模式");

  return (
    <div className="space-y-6">
      {/* ====== 返回按钮 ====== */}
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-sm text-(--color-muted-foreground) hover:text-(--color-primary) transition-colors cursor-pointer"
      >
        <ArrowLeft className="h-3 w-3" /> 返回画像列表
      </button>

      {/* ====== Hero 标题区 ====== */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-14 h-14 rounded-2xl bg-(--color-brand-400) flex items-center justify-center flex-shrink-0 shadow-md">
              <Users className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="font-serif text-3xl font-bold text-(--color-foreground)">
                {persona.name}
              </h1>
              <div className="flex items-center gap-2 mt-0.5">
                {persona.clusterId && (
                  <span className="text-xs text-(--color-content-tertiary) bg-(--color-surface-secondary) px-2 py-0.5 rounded-full">
                    聚类 {persona.clusterId}
                  </span>
                )}
                <span className="text-xs text-(--color-content-tertiary)">#{persona.id}</span>
              </div>
            </div>
          </div>
          <p className="text-(--color-muted-foreground) mt-2 max-w-2xl">{persona.description}</p>
          <div className="mt-4">
            <Link to={`/personas/${persona.id}/chat`}>
              <Button size="lg" variant="outline" className="text-base px-8 py-6 bg-white">
                <MessageCircle className="h-5 w-5 mr-2" />
                与「{persona.name}」开始对话
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* ====== 顶部双栏：雷达图 + 画像概况 ====== */}
      <div className="lg:grid lg:grid-cols-2 lg:gap-6 space-y-6 lg:space-y-0">
        {/* 雷达图 */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-(--color-brand-500)" />
              画像雷达图
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RadarChart
              dimensions={radarData}
              averages={averages.length > 0 ? averages : undefined}
            />
            <div className="flex items-center justify-center gap-4 mt-3 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-(--color-brand-500) opacity-40 border border-(--color-brand-500)" />
                本画像
              </span>
              {averages.length > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0 border-t border-dashed border-(--color-neutral-400)" />
                  全体均值
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 画像概况 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">画像概况</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            <p className="text-sm text-(--color-content-secondary) leading-relaxed">
              {persona.description || "暂无描述"}
            </p>
            <div className="space-y-3 pt-2 border-t border-(--color-border)">
              <div className="flex items-center justify-between text-sm">
                <span className="text-(--color-content-secondary) flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  样本数量
                </span>
                <span className="text-(--color-content-primary)">
                  {persona.sampleCount}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-(--color-content-secondary) flex items-center gap-1.5">
                  <Hash className="h-3.5 w-3.5" />
                  聚类编号
                </span>
                <span className="text-(--color-content-primary)">
                  {persona.clusterId ?? "未知"}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-(--color-content-secondary) flex items-center gap-1.5">
                  <BarChart3 className="h-3.5 w-3.5" />
                  数据量
                </span>
                <span className="text-(--color-content-primary)">
                  {persona.segmentCount} 条 segments
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-(--color-content-secondary) flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  创建时间
                </span>
                <span className="text-(--color-content-primary)">
                  {new Date(persona.createdAt).toLocaleDateString("zh-CN", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-(--color-content-secondary) flex items-center gap-1.5">
                  <Percent className="h-3.5 w-3.5" />
                  置信度
                </span>
                <ConfidenceIndicator score={confidenceScore} size="sm" />
              </div>
            </div>
            {sourceFiles.length > 0 && (
              <div className="pt-2 border-t border-(--color-border)">
                <p className="text-xs text-(--color-content-secondary) mb-1.5">数据来源</p>
                <div className="space-y-1">
                  {sourceFiles.slice(0, 3).map((f) => (
                    <p key={f} className="text-xs text-(--color-content-tertiary) truncate">
                      📁 {f}
                    </p>
                  ))}
                  {sourceFiles.length > 3 && (
                    <p className="text-xs text-(--color-brand-500)">
                      +{sourceFiles.length - 3} 个来源
                    </p>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ====== 动机因果链 ====== */}
      {Object.keys(motivationChain).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Layers className="h-4 w-4 text-(--color-brand-500)" />
              动机因果链（冰山模型）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <IcebergChain chain={motivationChain} />
          </CardContent>
        </Card>
      )}

      {/* ====== 特征标签（按维度分组） ====== */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Hash className="h-4 w-4 text-(--color-brand-500)" />
            特征标签
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* 诉求 */}
          <DimensionRow label="游戏诉求" count={needs.length} max={12}>
            {needs.map((v) => (
              <Badge
                key={v}
                className="bg-amber-50 text-amber-700 border-amber-200 text-xs font-normal"
              >
                {v}
              </Badge>
            ))}
          </DimensionRow>

          {/* 能力 */}
          <DimensionRow
            label="游戏能力"
            count={ability && ability !== "未知" ? 1 : 0}
            max={1}
          >
            {ability && (
              <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-normal">
                {ability}
              </Badge>
            )}
          </DimensionRow>

          {/* 风格 */}
          <DimensionRow label="游戏风格" count={style.length} max={5}>
            {style.map((v) => (
              <Badge
                key={v}
                className="bg-violet-50 text-violet-700 border-violet-200 text-xs font-normal"
              >
                {v}
              </Badge>
            ))}
          </DimensionRow>

          {/* 平台 */}
          <DimensionRow
            label="平台偏好"
            count={platform && platform !== "未知" ? 1 : 0}
            max={1}
          >
            {platform && (
              <Badge className="bg-sky-50 text-sky-700 border-sky-200 text-xs font-normal">
                {platform}
              </Badge>
            )}
          </DimensionRow>

          {/* 模式 */}
          <DimensionRow label="游戏模式" count={mode ? 1 : 0} max={1}>
            {mode && (
              <Badge className="bg-rose-50 text-rose-700 border-rose-200 text-xs font-normal">
                {mode}
              </Badge>
            )}
          </DimensionRow>
        </CardContent>
      </Card>

      {/* ====== 特征分布对比 ====== */}
      {averages.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-(--color-brand-500)" />
              画像特征分布
            </CardTitle>
            <p className="text-xs text-(--color-content-tertiary) mt-1">
              色块为本画像当前值，竖线为全体画像均值
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 图例 */}
            <div className="flex items-center gap-6 text-xs pb-2 border-b border-(--color-border)">
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-3 rounded-sm bg-(--color-brand-500) opacity-60 inline-block" />
                本画像
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-0.5 h-3 bg-(--color-neutral-400) inline-block" />
                全体均值
              </span>
            </div>
            {radarData.map((dim, i) => {
              const avg = averages[i]?.value ?? 0;
              const diff = dim.value - avg;
              const dimMeta = DIM_META[dim.label];
              return (
                <div key={dim.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-(--color-content-secondary)">
                      {dimMeta?.label ?? dim.label}
                    </span>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-(--color-content-tertiary)">
                        本画像 {Math.round(dim.value * 100)}%
                      </span>
                      <span className="text-(--color-content-tertiary)">
                        均值 {Math.round(avg * 100)}%
                      </span>
                      <span
                        className={cn(
                          "font-semibold min-w-[4ch] text-right",
                          diff > 0.05
                            ? "text-green-600"
                            : diff < -0.05
                              ? "text-red-500"
                              : "text-(--color-content-secondary)",
                        )}
                      >
                        {diff > 0 ? "+" : ""}
                        {Math.round(diff * 100)}%
                      </span>
                    </div>
                  </div>
                  {/* 对比条 */}
                  <div className="relative h-4 bg-(--color-surface-secondary) rounded-full overflow-hidden">
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-(--color-neutral-400) z-10"
                      style={{ left: `${avg * 100}%` }}
                    />
                    <div
                      className="absolute top-0 bottom-0 rounded-full transition-all duration-500"
                      style={{
                        width: `${dim.value * 100}%`,
                        backgroundColor: dimMeta?.color ?? "var(--color-brand-500)",
                        opacity: 0.6,
                      }}
                    />
                  </div>
                  <div className="flex items-center text-[10px] text-(--color-content-tertiary) mt-0.5 px-0.5">
                    <span className="flex-shrink-0">{DIM_ENDS[dim.label]?.[0] ?? "低"}</span>
                    <span className="flex-1 text-center">{analyzeDim(dim.label, dim.value)}</span>
                    <span className="flex-shrink-0">{DIM_ENDS[dim.label]?.[1] ?? "高"}</span>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ====== 代表性原声（增强） ====== */}
      {persona.evidenceList.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">代表性原声（{persona.evidenceList.length} 条）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {persona.evidenceList.map((e) => {
              const isExpanded = expandedEvidence.has(e.id);
              const annotation = (e.annotation as Record<string, unknown> | null) ?? {};
              const icebergLevel = annotation.iceberg as string | undefined;
              const truncated = e.originalText.length > 300;

              return (
                <div key={e.id} className="animate-fade-in-up">
                  <blockquote className="border-l-2 border-[--color-primary] pl-3 py-1 text-sm text-[--color-muted-foreground] leading-relaxed">
                    {isExpanded || !truncated
                      ? e.originalText
                      : `${e.originalText.slice(0, 300)}...`}
                    {truncated && (
                      <button
                        type="button"
                        onClick={() => toggleEvidence(e.id)}
                        className="ml-1 text-(--color-brand-500) hover:text-(--color-brand-600) text-xs cursor-pointer"
                      >
                        {isExpanded ? "收起" : "展开全文"}
                      </button>
                    )}
                  </blockquote>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-[--color-muted-foreground]/70">
                    <span>📁 {e.sourceFile.split("/").pop() ?? e.sourceFile}</span>
                    {icebergLevel && (
                      <span className="text-(--color-brand-600) font-medium">
                        🧊 {icebergLevel}
                      </span>
                    )}
                    {annotation.iceberg ? (
                      <span className="text-green-600">M1-M5 已标注</span>
                    ) : (
                      <span className="text-(--color-content-tertiary)">未标注</span>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ====== 相似画像推荐 ====== */}
      {allPersonas.length > 1 && (
        <SimilarPersonas currentId={persona.id} personas={allPersonas} />
      )}

          </div>
  );
}