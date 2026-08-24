// --------------------------------------------------------------
// 向量嵌入 — 为标注后的片段生成语义向量
// 使用本地 embed server (bge-large-zh-v1.5)；不可用时跳过嵌入，embedding 保持 null 供后续重跑
// --------------------------------------------------------------

import { EMBED_SERVER_URL, embedQuery } from "./embed.js";
import type { TaggedSegment } from "./pipeline-tagger.js";

// ---- 类型定义 ----

export interface EmbeddedSegment extends TaggedSegment {
  /** 向量嵌入 */
  embedding: number[] | null;
  /** 嵌入版本 */
  embeddingVersion: string | null;
}

// ---- 配置 ----

const EMBED_VERSION = "bge-large-zh-v1.5";
const MIN_TEXT_LENGTH = 10; // 最短文本长度（低于此跳过嵌入）

// ---- 嵌入函数 ----

/**
 * 为标注后的片段生成向量嵌入
 */
export async function embedSegments(
  segments: TaggedSegment[],
  onProgress?: (embedded: number, total: number) => void,
): Promise<EmbeddedSegment[]> {
  // 先检测 embed server 是否可用
  const serverAvailable = await checkEmbedServer();

  // 不可用时只 warn 一次，不在循环内重复打印
  if (!serverAvailable) {
    console.warn("embed server 不可用，跳过所有向量嵌入（后续可重跑）");
  }

  const results: EmbeddedSegment[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const embedText = buildEmbedText(seg);

    let embedding: number[] | null = null;
    let version: string | null = null;

    if (embedText.length >= MIN_TEXT_LENGTH && serverAvailable) {
      try {
        embedding = await embedQuery(embedText);
        version = EMBED_VERSION;
      } catch (e) {
        console.error(
          `嵌入失败 (segment ${seg.segmentIndex}, source ${seg.sourceFile}):`,
          e,
        );
      }
    }

    results.push({
      ...seg,
      embedding,
      embeddingVersion: version,
    });

    if (onProgress) {
      onProgress(i + 1, segments.length);
    }
  }

  return results;
}

/**
 * 构建嵌入文本
 * 根据标注质量分层：
 * - A 级 (auto_pass)：标签描述 + 原声 + 语境
 * - B 级 (review 或无标签)：仅原声
 * - C 级 (skip 或 < 10 字符)：空字符串（跳过嵌入）
 */
function buildEmbedText(seg: TaggedSegment): string {
  const annotation = seg.annotation;
  const text = seg.cleanedText || seg.originalText;

  if (!annotation || text.length < MIN_TEXT_LENGTH) {
    return "";
  }

  const meta = annotation.meta as { rs?: string } | undefined;
  const rs = meta?.rs ?? "review";

  if (rs === "skip") {
    return "";
  }

  if (rs === "auto_pass") {
    return buildTierAText(seg, annotation);
  }

  // Tier B: 仅原声
  return `原声：${text}`;
}

/**
 * 构建 Tier A 嵌入文本（包含完整标签上下文）
 */
function buildTierAText(
  seg: TaggedSegment,
  annotation: Record<string, unknown>,
): string {
  const parts: string[] = [];
  const text = seg.cleanedText || seg.originalText;

  // 冰山模型标签
  const iceberg = annotation.iceberg as Record<string, unknown> | undefined;
  if (iceberg) {
    const m1Labels = extractLabelValues(iceberg.M1 as Array<{ v: string }> | undefined);
    const m2Labels = extractLabelValues(iceberg.M2 as Array<{ v: string }> | undefined);
    const m3Labels = extractLabelValues(iceberg.M3 as Array<{ v: string }> | undefined);
    const m4Labels = extractLabelValues(iceberg.M4 as Array<{ v: string }> | undefined);
    const m5Labels = extractLabelValues(iceberg.M5 as Array<{ v: string }> | undefined);

    if (m1Labels.length) parts.push(`动机：${m1Labels.join("，")}`);
    if (m2Labels.length) parts.push(`期待：${m2Labels.join("，")}`);
    if (m3Labels.length) parts.push(`认知：${m3Labels.join("，")}`);
    if (m4Labels.length) parts.push(`感受：${m4Labels.join("，")}`);
    if (m5Labels.length) parts.push(`行为：${m5Labels.join("，")}`);
  }

  // 框架标签
  const framework = annotation.framework as Record<string, unknown> | undefined;
  if (framework) {
    const needs = framework.needs as { p?: string; s?: string[] } | undefined;
    if (needs?.p) parts.push(`主诉求：${needs.p}`);

    const ability = framework.ability as { lvl?: string } | undefined;
    if (ability?.lvl) parts.push(`能力：${ability.lvl}`);

    const style = framework.style as Record<string, string> | undefined;
    if (style) {
      const styleParts: string[] = [];
      if (style.combat) styleParts.push(style.combat);
      if (style.decision) styleParts.push(style.decision);
      if (style.social) styleParts.push(style.social);
      if (styleParts.length) parts.push(`风格：${styleParts.join("，")}`);
    }

    const platform = framework.platform as { p?: string } | undefined;
    if (platform?.p) parts.push(`平台：${platform.p}`);
  }

  // 产品标签
  const productTags = annotation.product_tags as Record<string, string> | undefined;
  if (productTags) {
    const tagParts: string[] = [];
    if (productTags.city_tier) tagParts.push(productTags.city_tier);
    if (productTags.life_stage) tagParts.push(productTags.life_stage);
    if (productTags.spending_level) tagParts.push(productTags.spending_level);
    if (tagParts.length) parts.push(`用户属性：${tagParts.join("，")}`);
  }

  // 原声和语境
  parts.push(`原声：${text}`);
  if (seg.precedingQuestion) {
    parts.push(`语境：${seg.precedingQuestion}`);
  }

  return parts.join(" | ");
}

function extractLabelValues(items: Array<{ v: string }> | undefined): string[] {
  if (!items || !Array.isArray(items)) return [];
  return items.map((item) => item.v).filter(Boolean);
}

// ---- Embed Server 通信 ----

/**
 * 检测 embed server 是否可用
 */
async function checkEmbedServer(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(`${EMBED_SERVER_URL.replace("/embed", "")}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 获取嵌入统计
 */
export function getEmbeddingStats(
  segments: EmbeddedSegment[],
): { total: number; embedded: number; skipped: number; skippedRate: number } {
  const total = segments.length;
  const embedded = segments.filter((s) => s.embedding !== null).length;
  const skipped = total - embedded;

  return {
    total,
    embedded,
    skipped,
    skippedRate: total > 0 ? Math.round((skipped / total) * 100) : 0,
  };
}