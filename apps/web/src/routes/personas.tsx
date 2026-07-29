// 标签选择器 + 画像列表页面 — 交互设计规范 v1.0
import type { PersonaSummary } from "@app/shared";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Filter,
  MessageCircle,
  Star,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MatchFeedback } from "@/components/ui/match-feedback";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Tooltip } from "@/components/ui/tooltip";
import { type TriState, TriStateTag } from "@/components/ui/tri-state-tag";
import { api } from "../lib/api.js";
import {
  EXTENDED_DIMENSIONS,
  getDisabledTags,
  getExclusionMessage,
  TAG_DIMENSIONS,
  type TagDimension,
} from "../lib/tag-data.js";

// 标签值在 URL 中的分隔符
const TAG_SEPARATOR = ",";

export function PersonasPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedFilters, setExpandedFilters] = useState(false);
  const [showTooltip, setShowTooltip] = useState<string | null>(null);
  const previousCountRef = useRef<number>(0);

  const selectedTags = searchParams.get("tags") ?? "";
  const activeTags = useMemo(
    () => (selectedTags ? selectedTags.split(TAG_SEPARATOR) : []),
    [selectedTags],
  );

  // 风格轴选择（存为 "风格/combat:主动求战/刚枪" 格式）
  const styleValues = useMemo(() => {
    const map: Record<string, string> = {};
    for (const tag of activeTags) {
      if (tag.startsWith("风格/")) {
        const [axis, val] = tag.slice(3).split(":");
        if (axis && val) map[axis] = val;
      }
    }
    return map;
  }, [activeTags]);

  // 平台选择
  const platformPrimary = useMemo(() => {
    const tag = activeTags.find((t) => t.startsWith("平台/主选:"));
    return tag?.slice(6) ?? null;
  }, [activeTags]);
  const platformSecondary = useMemo(() => {
    const tag = activeTags.find((t) => t.startsWith("平台/次选:"));
    return tag?.slice(6) ?? null;
  }, [activeTags]);

  // 模式主结构选择
  const modeStructure = useMemo(() => {
    const tag = activeTags.find((t) => t.startsWith("模式/主结构:"));
    return tag?.slice(7) ?? null;
  }, [activeTags]);

  // 二级模式三态
  const submodeStates = useMemo(() => {
    const map: Record<string, TriState> = {};
    for (const tag of activeTags) {
      if (tag.startsWith("模式/二级:")) {
        const [name, state] = tag.slice(6).split(":");
        if (name && state) map[name] = state as TriState;
      }
    }
    return map;
  }, [activeTags]);

  // 能力等级
  const abilityLevel = useMemo(() => {
    const tag = activeTags.find((t) => t.startsWith("能力/等级:"));
    return tag?.slice(6) ?? null;
  }, [activeTags]);

  // 能力技巧强项/短板
  const abilityStrengths = useMemo(() => {
    return activeTags.filter((t) => t.startsWith("能力/强项:")).map((t) => t.slice(6));
  }, [activeTags]);
  const abilityWeaknesses = useMemo(() => {
    return activeTags.filter((t) => t.startsWith("能力/短板:")).map((t) => t.slice(6));
  }, [activeTags]);

  // 纯标签值（不含前缀，用于 API 查询和互斥判断）
  const plainTags = useMemo(() => {
    return activeTags
      .filter((t) => !t.includes(":"))
      .concat(
        activeTags
          .filter((t) => t.includes(":"))
          .map((t) => {
            const parts = t.split(":");
            return parts[parts.length - 1];
          }),
      );
  }, [activeTags]);

  // 禁用的标签
  const disabledTags = useMemo(() => getDisabledTags(plainTags), [plainTags]);

  // 获取画像数据
  const queryTags = useMemo(() => {
    // 只有简单标签值传给 API
    const simple = activeTags.filter(
      (t) =>
        !t.startsWith("风格/") &&
        !t.startsWith("平台/") &&
        !t.startsWith("模式/二级:") &&
        !t.startsWith("能力/"),
    );
    return simple.join(TAG_SEPARATOR);
  }, [activeTags]);

  useEffect(() => {
    setLoading(true);
    previousCountRef.current = personas.length;
    api
      .listPersonas(queryTags || undefined)
      .then(setPersonas)
      .finally(() => setLoading(false));
  }, [queryTags]);

  // 更新 URL
  const updateTags = useCallback(
    (newTags: string[]) => {
      const next = newTags.join(TAG_SEPARATOR);
      setSearchParams(next ? { tags: next } : {});
    },
    [setSearchParams],
  );

  // 添加/移除标签
  const toggleTag = useCallback(
    (tag: string) => {
      const current = new Set(activeTags);
      if (current.has(tag)) {
        current.delete(tag);
      } else {
        // 检查互斥
        const plainTag = tag.includes(":") ? tag.split(":").pop()! : tag;
        if (disabledTags.has(plainTag)) return;
        current.add(tag);
      }
      updateTags(Array.from(current));
    },
    [activeTags, disabledTags, updateTags],
  );

  // 替换标签（用于单选）
  const replaceTag = useCallback(
    (prefix: string, newTag: string) => {
      const filtered = activeTags.filter((t) => !t.startsWith(prefix));
      filtered.push(newTag);
      updateTags(filtered);
    },
    [activeTags, updateTags],
  );

  // 清空全部
  const clearAll = useCallback(() => updateTags([]), [updateTags]);

  // 判断标签是否被禁用
  const isTagDisabled = useCallback(
    (tagValue: string) => {
      if (disabledTags.has(tagValue)) return true;
      // 检查同轴互斥（风格轴）
      if (styleValues) {
        for (const [axis, val] of Object.entries(styleValues)) {
          if (val === tagValue) continue; // 已选中不算禁用
          const message = getExclusionMessage(tagValue, val);
          if (message) return true;
        }
      }
      return false;
    },
    [disabledTags, styleValues],
  );

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

  const noMatch = !loading && personas.length === 0 && activeTags.length > 0;
  const lowSample = !loading && personas.length > 0 && personas.every((p) => p.sampleCount < 30);

  // 渲染标签 Badge
  const renderTag = (tag: TagDimension["options"][0], dimName: string, groupName?: string) => {
    const isActive = plainTags.includes(tag.value);
    const isDisabled = !isActive && isTagDisabled(tag.value);
    const disabledReason = isDisabled ? getDisabledReason(tag.value) : null;

    const badge = (
      <Badge
        key={tag.value}
        variant={isActive ? "default" : "outline"}
        className={`cursor-pointer hover:opacity-80 transition-all duration-150 ${
          isDisabled ? "opacity-30 cursor-not-allowed hover:opacity-30" : ""
        } ${noMatch && isActive ? "animate-warning-pulse" : ""}`}
        onClick={() => {
          if (isDisabled) return;
          const tagKey = groupName ? `${dimName}/${groupName}:${tag.value}` : tag.value;
          toggleTag(tagKey);
        }}
        title={tag.description}
      >
        {isActive ? <X className="h-3 w-3 mr-1" /> : null}
        {tag.label}
      </Badge>
    );

    if (isDisabled && disabledReason) {
      return (
        <Tooltip
          key={tag.value}
          content={
            <div className="max-w-[240px] text-xs">
              <p className="font-medium">⚠ 与已选标签冲突</p>
              <p className="text-[--color-muted-foreground] mt-0.5">{disabledReason}</p>
            </div>
          }
        >
          {badge}
        </Tooltip>
      );
    }

    return badge;
  };

  return (
    <div className="space-y-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-[--color-muted-foreground] hover:text-[--color-primary] transition-colors"
      >
        <ArrowLeft className="h-3 w-3" /> 返回首页
      </Link>
      <div>
        <h1 className="font-serif text-3xl font-bold text-[--color-primary]">选择目标用户</h1>
        <p className="text-[--color-muted-foreground] mt-1">
          从以下维度选择特征标签，匹配对应的模拟用户画像
        </p>
      </div>

      {/* Tag Selector */}
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
          {/* 诉求 — 多选最多3个 */}
          <div>
            <p className="text-sm font-medium text-[--color-muted-foreground] mb-2">
              游戏诉求
              <span className="text-xs ml-1 font-normal">（多选，最多3个）</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {TAG_DIMENSIONS[0].options!.map((opt) => {
                const isActive = plainTags.includes(opt.value);
                const isDisabled = !isActive && isTagDisabled(opt.value);
                const isPrimary = isActive && activeTags[0] === opt.value;
                const disabledReason = isDisabled ? getDisabledReason(opt.value) : null;

                const badge = (
                  <Badge
                    key={opt.value}
                    variant={isActive ? "default" : "outline"}
                    className={`cursor-pointer hover:opacity-80 transition-all duration-150 ${
                      isDisabled ? "opacity-30 cursor-not-allowed hover:opacity-30" : ""
                    } ${isPrimary ? "ring-1 ring-[--color-accent]" : ""}`}
                    onClick={() => {
                      if (isDisabled) return;
                      if (isActive) {
                        toggleTag(opt.value);
                      } else if (
                        plainTags.filter((t) =>
                          TAG_DIMENSIONS[0].options!.some((o) => o.value === t),
                        ).length >= 3
                      ) {
                        return; // 最多3个
                      } else {
                        toggleTag(opt.value);
                      }
                    }}
                    title={opt.description}
                  >
                    {isPrimary && <Star className="h-3 w-3 mr-1 text-[--color-accent]" />}
                    {isActive && !isPrimary && <X className="h-3 w-3 mr-1" />}
                    {opt.label}
                  </Badge>
                );

                if (isDisabled && disabledReason) {
                  return (
                    <Tooltip
                      key={opt.value}
                      content={
                        <div className="max-w-[240px] text-xs">
                          <p className="font-medium">⚠ 与已选标签冲突</p>
                          <p className="text-[--color-muted-foreground] mt-0.5">{disabledReason}</p>
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

          {/* 能力 — 单选等级 + 多选技巧 */}
          <div>
            <p className="text-sm font-medium text-[--color-muted-foreground] mb-2">游戏能力</p>
            {/* 综合等级 */}
            <div className="mb-2">
              <span className="text-xs text-[--color-muted-foreground]">综合等级</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {TAG_DIMENSIONS[1].groups![0].options.map((opt) => {
                  const isActive = abilityLevel === opt.value;
                  return (
                    <Badge
                      key={opt.value}
                      variant={isActive ? "default" : "outline"}
                      className="cursor-pointer hover:opacity-80 transition-all duration-150"
                      onClick={() => {
                        if (isActive) {
                          updateTags(activeTags.filter((t) => !t.startsWith("能力/等级:")));
                        } else {
                          replaceTag("能力/等级:", `能力/等级:${opt.value}`);
                        }
                      }}
                      title={opt.description}
                    >
                      {isActive && <X className="h-3 w-3 mr-1" />}
                      {opt.label}
                    </Badge>
                  );
                })}
              </div>
            </div>
            {/* 技巧强项 */}
            <div className="mb-2">
              <span className="text-xs text-[--color-muted-foreground]">技巧强项（最多3个）</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {TAG_DIMENSIONS[1].groups![1].options.map((opt) => {
                  const isActive = abilityStrengths.includes(opt.value);
                  const isDisabledInWeakness = abilityWeaknesses.includes(opt.value);
                  return (
                    <Badge
                      key={`str-${opt.value}`}
                      variant={isActive ? "default" : "outline"}
                      className={`cursor-pointer hover:opacity-80 transition-all duration-150 ${
                        isDisabledInWeakness ? "opacity-30 cursor-not-allowed hover:opacity-30" : ""
                      }`}
                      onClick={() => {
                        if (isDisabledInWeakness) return;
                        if (isActive) {
                          updateTags(activeTags.filter((t) => t !== `能力/强项:${opt.value}`));
                        } else if (abilityStrengths.length < 3) {
                          updateTags([...activeTags, `能力/强项:${opt.value}`]);
                        }
                      }}
                    >
                      {isActive && <X className="h-3 w-3 mr-1" />}
                      {opt.label}
                    </Badge>
                  );
                })}
              </div>
            </div>
            {/* 技巧短板 */}
            <div>
              <span className="text-xs text-[--color-muted-foreground]">技巧短板（最多3个）</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {TAG_DIMENSIONS[1].groups![2].options.map((opt) => {
                  const isActive = abilityWeaknesses.includes(opt.value);
                  const isDisabledInStrength = abilityStrengths.includes(opt.value);
                  return (
                    <Badge
                      key={`wk-${opt.value}`}
                      variant={isActive ? "default" : "outline"}
                      className={`cursor-pointer hover:opacity-80 transition-all duration-150 ${
                        isDisabledInStrength ? "opacity-30 cursor-not-allowed hover:opacity-30" : ""
                      }`}
                      onClick={() => {
                        if (isDisabledInStrength) return;
                        if (isActive) {
                          updateTags(activeTags.filter((t) => t !== `能力/短板:${opt.value}`));
                        } else if (abilityWeaknesses.length < 3) {
                          updateTags([...activeTags, `能力/短板:${opt.value}`]);
                        }
                      }}
                    >
                      {isActive && <X className="h-3 w-3 mr-1" />}
                      {opt.label}
                    </Badge>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 风格 — 分段滑块 */}
          <div>
            <p className="text-sm font-medium text-[--color-muted-foreground] mb-2">
              游戏风格
              <span className="text-xs ml-1 font-normal">（每组单选）</span>
            </p>
            <div className="space-y-3">
              {TAG_DIMENSIONS[2].segmentedAxes!.map((axis) => (
                <div key={axis.name}>
                  <span className="text-xs text-[--color-muted-foreground] block mb-1">
                    {axis.label}
                  </span>
                  <SegmentedControl
                    options={axis.options}
                    value={styleValues[axis.name] ?? null}
                    onChange={(val) => {
                      replaceTag(`风格/${axis.name}:`, `风格/${axis.name}:${val}`);
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* 平台 — 主选 + 次选 */}
          <div>
            <p className="text-sm font-medium text-[--color-muted-foreground] mb-2">平台偏好</p>
            <div className="mb-2">
              <span className="text-xs text-[--color-muted-foreground]">主选平台</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {TAG_DIMENSIONS[3].groups![0].options.map((opt) => {
                  const isActive = platformPrimary === opt.value;
                  const isSecondary = platformSecondary === opt.value;
                  return (
                    <Badge
                      key={`pri-${opt.value}`}
                      variant={isActive ? "default" : "outline"}
                      className={`cursor-pointer hover:opacity-80 transition-all duration-150 ${
                        isSecondary ? "opacity-30" : ""
                      }`}
                      onClick={() => {
                        if (isActive) {
                          updateTags(activeTags.filter((t) => t !== `平台/主选:${opt.value}`));
                        } else {
                          replaceTag("平台/主选:", `平台/主选:${opt.value}`);
                        }
                      }}
                    >
                      {isActive && <X className="h-3 w-3 mr-1" />}
                      {opt.label}
                    </Badge>
                  );
                })}
              </div>
            </div>
            <div>
              <span className="text-xs text-[--color-muted-foreground]">次选平台</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {TAG_DIMENSIONS[3].groups![1].options.map((opt) => {
                  const isActive = platformSecondary === opt.value;
                  const isPrimary = platformPrimary === opt.value;
                  return (
                    <Badge
                      key={`sec-${opt.value}`}
                      variant={isActive ? "default" : "outline"}
                      className={`cursor-pointer hover:opacity-80 transition-all duration-150 ${
                        isPrimary ? "opacity-30 cursor-not-allowed hover:opacity-30" : ""
                      }`}
                      onClick={() => {
                        if (isPrimary) return;
                        if (isActive) {
                          updateTags(activeTags.filter((t) => t !== `平台/次选:${opt.value}`));
                        } else {
                          replaceTag("平台/次选:", `平台/次选:${opt.value}`);
                        }
                      }}
                    >
                      {isActive && <X className="h-3 w-3 mr-1" />}
                      {opt.label}
                    </Badge>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 模式 — 主结构 + 二级三态 */}
          <div>
            <p className="text-sm font-medium text-[--color-muted-foreground] mb-2">模式偏好</p>
            {/* 主结构 */}
            <div className="mb-2">
              <span className="text-xs text-[--color-muted-foreground]">主结构</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {TAG_DIMENSIONS[4].groups![0].options.map((opt) => {
                  const isActive = modeStructure === opt.value;
                  const isDisabled = !isActive && isTagDisabled(opt.value);
                  const disabledReason = isDisabled ? getDisabledReason(opt.value) : null;

                  const badge = (
                    <Badge
                      key={opt.value}
                      variant={isActive ? "default" : "outline"}
                      className={`cursor-pointer hover:opacity-80 transition-all duration-150 ${
                        isDisabled ? "opacity-30 cursor-not-allowed hover:opacity-30" : ""
                      }`}
                      onClick={() => {
                        if (isDisabled) return;
                        if (isActive) {
                          updateTags(activeTags.filter((t) => t !== `模式/主结构:${opt.value}`));
                        } else {
                          replaceTag("模式/主结构:", `模式/主结构:${opt.value}`);
                        }
                      }}
                    >
                      {isActive && <X className="h-3 w-3 mr-1" />}
                      {opt.label}
                    </Badge>
                  );

                  if (isDisabled && disabledReason) {
                    return (
                      <Tooltip
                        key={opt.value}
                        content={
                          <div className="max-w-[240px] text-xs">
                            <p className="font-medium">⚠ 与已选标签冲突</p>
                            <p className="text-[--color-muted-foreground] mt-0.5">
                              {disabledReason}
                            </p>
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
            {/* 二级模式 */}
            <div>
              <span className="text-xs text-[--color-muted-foreground]">二级模式</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {TAG_DIMENSIONS[4].groups![1].options.map((opt) => (
                  <TriStateTag
                    key={opt.value}
                    label={opt.label}
                    value={submodeStates[opt.value] ?? "neutral"}
                    onChange={(newState) => {
                      const filtered = activeTags.filter(
                        (t) => !t.startsWith(`模式/二级:${opt.value}:`),
                      );
                      if (newState !== "neutral") {
                        filtered.push(`模式/二级:${opt.value}:${newState}`);
                      }
                      updateTags(filtered);
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* 更多筛选 */}
          <div className="border-t border-[--color-border] pt-4">
            <button
              type="button"
              onClick={() => setExpandedFilters(!expandedFilters)}
              className="flex items-center gap-2 text-sm text-[--color-muted-foreground] hover:text-[--color-foreground] transition-colors"
            >
              {expandedFilters ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
              更多筛选
            </button>

            {expandedFilters && (
              <div className="mt-4 space-y-5 animate-fade-in-up">
                {EXTENDED_DIMENSIONS.map((dim) => (
                  <div key={dim.name}>
                    <p className="text-sm font-medium text-[--color-muted-foreground] mb-2">
                      {dim.label}
                    </p>
                    {dim.segmentedAxes ? (
                      <div className="space-y-2">
                        {dim.segmentedAxes.map((axis) => (
                          <div key={axis.name}>
                            <span className="text-xs text-[--color-muted-foreground] block mb-1">
                              {axis.label}
                            </span>
                            <SegmentedControl
                              options={axis.options}
                              value={styleValues[axis.name] ?? null}
                              onChange={(val) => {
                                replaceTag(`风格/${axis.name}:`, `风格/${axis.name}:${val}`);
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    ) : dim.groups ? (
                      <div className="space-y-2">
                        {dim.groups.map((group) => (
                          <div key={group.name}>
                            <span className="text-xs text-[--color-muted-foreground] block mb-1">
                              {group.label}
                            </span>
                            <div className="flex flex-wrap gap-2">
                              {group.options.map((opt) => renderTag(opt, dim.name, group.name))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Match Feedback */}
      <MatchFeedback
        personaCount={personas.length}
        sampleCount={personas.reduce((sum, p) => sum + p.sampleCount, 0)}
        previousCount={previousCountRef.current || undefined}
        noMatch={noMatch}
        lowSample={lowSample}
        suggestions={noMatch ? [{ action: "取消最近选择的标签", expectedCount: 2 }] : undefined}
        onApplySuggestion={(action) => {
          if (action === "取消最近选择的标签" && activeTags.length > 0) {
            updateTags(activeTags.slice(0, -1));
          }
        }}
      />

      {/* Persona Cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {personas.map((p) => (
          <Link key={p.id} to={`/personas/${p.id}`} className="block group">
            <Card className="h-full transition-all duration-200 hover:border-[--color-primary] hover:shadow-md hover:-translate-y-0.5">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg font-serif text-[--color-primary] flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  {p.name}
                </CardTitle>
                <CardDescription className="line-clamp-2">{p.description}</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-1">
                  {Object.entries(p.tagSpec as Record<string, string | string[]>).map(
                    ([dim, val]) => {
                      const vals = Array.isArray(val) ? val : [val];
                      return vals.map((v) => (
                        <Badge key={`${dim}-${v}`} variant="secondary" className="text-xs">
                          {v}
                        </Badge>
                      ));
                    },
                  )}
                </div>
                <div className="flex items-center justify-between mt-3">
                  <p className="text-xs text-[--color-muted-foreground]">
                    基于 {p.sampleCount} 个样本
                  </p>
                  <span className="text-xs text-[--color-primary] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                    <MessageCircle className="h-3 w-3" /> 开始访谈
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {!loading && personas.length === 0 && !noMatch && (
          <p className="text-[--color-muted-foreground] col-span-2 text-center py-8">
            选择标签开始匹配画像
          </p>
        )}
        {loading && (
          <p className="text-[--color-muted-foreground] col-span-2 text-center py-8">匹配中...</p>
        )}
      </div>
    </div>
  );
}

// Persona Detail Page
export { PersonaDetailPage } from "./persona-detail.js";
