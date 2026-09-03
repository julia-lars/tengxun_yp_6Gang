// 标签选择器 + 画像列表页面 — 交互设计规范 v1.0
import type { PersonaSummary } from "@app/shared";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Filter,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { PersonaCard } from "@/components/personas/persona-card";
import { api } from "../lib/api.js";
import { buildSimpleQuery, getAllSimpleTags } from "../lib/simple-filter.js";
import {
  flattenOptions,
  getDisabledTags,
  getExclusionMessage,
  TAG_DIMENSIONS,
  type TagOption,
} from "../lib/tag-data.js";
import { SimpleFilter } from "@/components/personas/simple-filter";

// 5 个主维度 + 展平后的 options（与新建画像页面保持一致）
const MAIN_DIMENSIONS = TAG_DIMENSIONS.slice(0, 5).map((dim) => ({
  ...dim,
  flatOptions: flattenOptions(dim),
}));

// 标签值 → 所属维度名（用于 OR 组内 / AND 跨组查询）
const TAG_TO_DIMENSION = new Map<string, string>();
for (const dim of MAIN_DIMENSIONS) {
  for (const opt of dim.flatOptions) {
    TAG_TO_DIMENSION.set(opt.value, dim.name);
  }
}

// 标签值在 URL 中的分隔符
const TAG_SEPARATOR = ",";

export function PersonasPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const selectedTags = searchParams.get("tags") ?? "";
  const activeTags = useMemo(
    () => (selectedTags ? selectedTags.split(TAG_SEPARATOR) : []),
    [selectedTags],
  );

  // 简洁筛选状态（3 道选择题，独立于高级筛选的 tags）
  const simpleValue = useMemo(
    () => ({
      need: searchParams.get("need") ?? undefined,
      mode: searchParams.get("mode") ?? undefined,
      pace: searchParams.get("pace") ?? undefined,
    }),
    [searchParams],
  );

  // 合并式更新 URL 参数，避免覆盖其它参数
  const updateParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams);
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") next.delete(k);
        else next.set(k, v);
      }
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const setSimpleOption = useCallback(
    (id: string, key: string) => {
      const current = searchParams.get(id) ?? "";
      // Q1（need）多选：逗号分隔 toggle
      if (id === "need") {
        const values = current ? current.split(",") : [];
        const next = values.includes(key)
          ? values.filter((v) => v !== key)
          : [...values, key];
        updateParams({ [id]: next.length > 0 ? next.join(",") : null });
      } else {
        // 单选：点击切换
        updateParams({ [id]: current === key ? null : key });
      }
    },
    [searchParams, updateParams],
  );

  const clearSimple = useCallback(
    () => updateParams({ need: null, mode: null, pace: null }),
    [updateParams],
  );

  // 纯标签值（高级筛选均为 plain tags，不再使用前缀）
  const plainTags = useMemo(() => activeTags, [activeTags]);

  // 禁用的标签
  const disabledTags = useMemo(() => getDisabledTags(plainTags), [plainTags]);

  // 获取画像数据
  // 简洁筛选用 | 分隔题组（组内 OR，跨组 AND），高级筛选标签各自成组（AND）
  const simpleQuery = useMemo(() => buildSimpleQuery(simpleValue), [simpleValue]);
  const simpleTags = useMemo(() => getAllSimpleTags(simpleValue), [simpleValue]);
  const queryTags = useMemo(() => {
    // 高级筛选：按维度分组，同一维度内 OR（,），跨维度 AND（|）
    const dimGroups = new Map<string, string[]>();
    for (const tag of activeTags) {
      const dim = TAG_TO_DIMENSION.get(tag);
      if (dim) {
        if (!dimGroups.has(dim)) dimGroups.set(dim, []);
        dimGroups.get(dim)!.push(tag);
      }
    }
    const advancedQuery = Array.from(dimGroups.values())
      .map((g) => g.join(","))
      .join("|");

    const parts: string[] = [];
    if (simpleQuery) parts.push(simpleQuery);
    if (advancedQuery) parts.push(advancedQuery);
    return parts.join("|");
  }, [simpleQuery, activeTags]);

  useEffect(() => {
    setLoading(true);
    api
      .listPersonas(queryTags || undefined)
      .then(setPersonas)
      .finally(() => setLoading(false));
  }, [queryTags]);

  // 更新 URL
  const updateTags = useCallback(
    (newTags: string[]) => {
      const next = newTags.join(TAG_SEPARATOR);
      updateParams({ tags: next || null });
    },
    [updateParams],
  );

  // 添加/移除标签
  const toggleTag = useCallback(
    (tag: string) => {
      const current = new Set(activeTags);
      if (current.has(tag)) {
        current.delete(tag);
      } else {
        if (disabledTags.has(tag)) return;
        current.add(tag);
      }
      updateTags(Array.from(current));
    },
    [activeTags, disabledTags, updateTags],
  );

  // 判断标签是否被禁用
  const isTagDisabled = useCallback(
    (tagValue: string) => disabledTags.has(tagValue),
    [disabledTags],
  );

  // 清空全部
  const clearAll = useCallback(() => updateTags([]), [updateTags]);

  // 获取禁用原因
  const getDisabledReason = useCallback(
    (tagValue: string) => {
      for (const activeTag of plainTags) {
        if (activeTag === tagValue) continue;
        const msg = getExclusionMessage(tagValue, activeTag);
        if (msg) return msg;
      }
      return null;
    },
    [plainTags],
  );

  const noMatch = !loading && personas.length === 0 && (activeTags.length > 0 || simpleTags.length > 0);

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-10 -mt-6 pt-6 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 bg-neutral-50">
        <div className="pb-2 border-b border-neutral-200">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1 text-sm text-(--color-muted-foreground) hover:text-(--color-primary) transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-3 w-3" /> 返回上一页
          </button>
        </div>
      </div>
      <div>
        <h1 className="font-serif text-2xl sm:text-3xl font-bold text-black">选择目标用户</h1>
        <p className="text-sm text-(--color-content-secondary) mt-1">
          回答 3 道选择题，快速匹配模拟用户画像；需要更多条件可展开高级筛选
        </p>
      </div>

      {/* 简洁筛选 — 3 道选择题 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Filter className="h-4 w-4" />
              快速筛选
            </CardTitle>
            {Object.values(simpleValue).some(Boolean) && (
              <Button variant="ghost" size="sm" onClick={clearSimple} className="text-xs h-7 text-neutral-600">
                <X className="h-3 w-3 mr-1" /> 清空全部
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <SimpleFilter value={simpleValue} onChange={setSimpleOption} onClear={clearSimple} />
        </CardContent>
      </Card>

      {/* 高级筛选（专家模式，默认折叠） */}
      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-2 text-sm text-(--color-muted-foreground) hover:text-(--color-foreground) transition-colors"
      >
        {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        高级筛选（专家模式，按标签维度精确筛选）
      </button>

      {showAdvanced && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Filter className="h-4 w-4" />
                特征标签
              </CardTitle>
            {activeTags.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearAll} className="text-xs h-7">
                <X className="h-3 w-3 mr-1" /> 清空全部
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
              {MAIN_DIMENSIONS.map((dim) => (
                <div key={dim.name}>
                  <p className="text-sm font-medium text-(--color-muted-foreground) mb-2">
                    {dim.label}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {dim.flatOptions.map((opt: TagOption) => {
                      const isActive = plainTags.includes(opt.value);
                      const disabled = !isActive && isTagDisabled(opt.value);
                      const disabledReason = disabled ? getDisabledReason(opt.value) : null;

                      const badge = (
                        <Badge
                          key={opt.value}
                          variant={isActive ? "default" : "outline"}
                          className={`cursor-pointer hover:opacity-80 transition-all duration-150 font-normal ${
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

                      if (disabled && disabledReason) {
                        return (
                          <Tooltip
                            key={opt.value}
                            content={
                              <div className="max-w-[240px] text-xs">
                                <p className="font-medium">⚠ 与已选标签冲突</p>
                                <p className="text-(--color-muted-foreground) mt-0.5">{disabledReason}</p>
                              </div>
                            }
                          >
                            {badge}
                          </Tooltip>
                        );
                      }
                      return badge;
                    })}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          )}

      {/* Persona Cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {personas.map((p) => (
          <PersonaCard key={p.id} persona={p} />
        ))}
        {!loading && personas.length === 0 && !noMatch && (
          <p className="text-(--color-content-secondary) col-span-2 text-center py-8">
            选择答案开始匹配画像
          </p>
        )}
        {loading && (
          <p className="text-(--color-content-secondary) col-span-2 text-center py-8">匹配中...</p>
        )}
      </div>
    </div>
  );
}

// Persona Detail Page
export { PersonaDetailPage } from "./persona-detail.js";
