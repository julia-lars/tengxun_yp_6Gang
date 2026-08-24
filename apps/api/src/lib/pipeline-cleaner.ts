// --------------------------------------------------------------
// 数据清洗 — 去噪、去重、格式标准化
// 移植自 scripts/clean_segments.py
// --------------------------------------------------------------

import type { RawSegment } from "./file-parser.js";

// ---- 清洗后的片段类型 ----

export interface CleanedSegment extends RawSegment {
  /** 清洗后的文本 */
  cleanedText: string;
  /** 字符数 */
  charCount: number;
}

// ---- 噪声/填充词模式（移植自 clean_segments.py）----

/** 纯噪声/对话流程填充词 */
const NOISE_PATTERN = new RegExp(
  [
    // 中文噪声
    "^[对是嗯好行可可以的]+[，,。.]?$",
    "^[没不][有会是知道清楚懂行能]+[，,。.]?$",
    "^[啊哦嗯呃唉哎哟嘿]$",
    // 英文噪声
    "^(Cool|Yeah|Yep|Nope|Yes|No|Okay|Ok|Sure|Right|Gotcha|Perfect|Fantastic|Great|Nice|Thanks|Sorry|Fine|Alright|Absolutely|Exactly|Definitely|Totally|Indeed|Correct|Fair|True|Maybe|Perhaps|Probably|Hello|Hi|Hey|Wow|What|Why|When|Where|How|Who)$",
    "^[Mm]+[hm]+[，,。.]?$",
    // 对话流程
    "^(Dial-up|Go ahead|I'll start|Yay|Good shirt|There you go|That's it|No sleep|All right|See you)",
  ].join("|"),
  "i",
);

/** 纯对话流程/管理内容（无游戏讨论） */
const FLOW_PATTERN = new RegExp(
  [
    "^I'll start\\.?$",
    "^Go ahead\\.?$",
    "^Dial-up\\.?$",
    "^Sorry\\.?$",
    "^Excuse me\\.?$",
    "^You look great.*$",
    "^That's funny\\.?$",
    "^That's great\\.?$",
    "^Oh, cool\\.?$",
    "^Oh, yeah\\.?$",
    "^Yeah, yeah\\.?$",
    "^No, no\\.?$",
    "^There you go\\.?$",
    "^That's it\\.?$",
    "^No sleep\\.?$",
    "^All right\\.?$",
    "^Is it the new DLC\\?$",
    "^Happy early birthday\\.?$",
    "^Thank you\\.?$",
    "^Probably not\\.?$",
    "^Cool\\. All right\\.?$",
  ].join("|"),
  "i",
);

// ---- 清洗函数 ----

/**
 * 判断文本是否为纯噪声/填充词
 */
export function isNoise(text: string): boolean {
  return NOISE_PATTERN.test(text.trim());
}

/**
 * 判断文本是否为纯对话流程（非实质性内容）
 */
export function isConversationFlow(text: string): boolean {
  return FLOW_PATTERN.test(text.trim());
}

/**
 * 文本标准化
 */
export function normalizeText(text: string): string {
  let cleaned = text.trim();

  // 合并多余空格
  cleaned = cleaned.replace(/\s{2,}/g, " ");

  // 统一中文标点
  cleaned = cleaned.replace(/,,/g, "，");
  cleaned = cleaned.replace(/\.\./g, "。");

  // 移除开头无意义的填充词
  cleaned = cleaned.replace(/^[那个就是然后怎么说呢嗯啊哦]+[，,。.]?\s*/g, "");

  return cleaned;
}

/**
 * 计算两个文本的相似度（基于 trigram Jaccard）
 * 用于去重检测
 */
export function trigramSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (!a || !b) return 0;

  // 短字符串（< 3 字符）无法生成 trigram，直接判定为不相似
  if (a.length < 3 && b.length < 3) return 0;
  if (a.length < 3 || b.length < 3) return 0;

  const getTrigrams = (s: string): Set<string> => {
    const trigrams = new Set<string>();
    for (let i = 0; i < s.length - 2; i++) {
      trigrams.add(s.slice(i, i + 3));
    }
    return trigrams;
  };

  const triA = getTrigrams(a);
  const triB = getTrigrams(b);

  if (triA.size === 0 && triB.size === 0) return 1.0;
  if (triA.size === 0 || triB.size === 0) return 0;

  let intersection = 0;
  for (const t of triA) {
    if (triB.has(t)) intersection++;
  }

  const union = triA.size + triB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 对片段列表进行去重
 * 规则：同一 speaker + 同一 preceding_question 下，相似度 > 90% 的只保留最长的一条
 */
export function dedupSegments(segments: CleanedSegment[]): CleanedSegment[] {
  // 按 (speakerId, precedingQuestion) 分组
  const groups = new Map<string, CleanedSegment[]>();
  for (const seg of segments) {
    const key = `${seg.speakerId}::${seg.precedingQuestion ?? ""}`;
    const group = groups.get(key) || [];
    group.push(seg);
    groups.set(key, group);
  }

  const result: CleanedSegment[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(group[0]!);
      continue;
    }

    // 按字符数降序排列
    group.sort((a, b) => b.charCount - a.charCount);

    const kept: CleanedSegment[] = [group[0]!];
    for (let i = 1; i < group.length; i++) {
      const seg = group[i]!;
      let isDuplicate = false;
      for (const k of kept) {
        if (trigramSimilarity(seg.cleanedText, k.cleanedText) > 0.9) {
          isDuplicate = true;
          break;
        }
      }
      if (!isDuplicate) {
        kept.push(seg);
      }
    }
    result.push(...kept);
  }

  return result;
}

/**
 * 清洗片段列表：去噪 → 去短 → 去流程 → 标准化 → 去重
 */
export function cleanSegments(segments: RawSegment[]): CleanedSegment[] {
  const cleaned = segments
    // 1. 过滤噪声
    .filter((s) => !isNoise(s.originalText))
    // 2. 过滤过短片段（< 15 字符）
    .filter((s) => s.originalText.trim().length >= 15)
    // 3. 过滤纯对话流程
    .filter((s) => !isConversationFlow(s.originalText))
    // 4. 标准化文本
    .map((s) => ({
      ...s,
      cleanedText: normalizeText(s.originalText),
      charCount: s.originalText.trim().length,
    }));

  // 5. 去重
  return dedupSegments(cleaned);
}

/**
 * 获取清洗统计
 */
export function getCleaningStats(
  before: number,
  after: number,
): { removed: number; kept: number; removalRate: number } {
  return {
    removed: before - after,
    kept: after,
    removalRate: before > 0 ? Math.round(((before - after) / before) * 100) : 0,
  };
}