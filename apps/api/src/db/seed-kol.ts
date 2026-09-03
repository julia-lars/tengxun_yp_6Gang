// --------------------------------------------------------------
// 种子脚本：导入 KOL 数据（两个 B 站 UP 主的最新视频内容）
// 运行: bun run apps/api/src/db/seed-kol.ts
// --------------------------------------------------------------

import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { db } from "./client.js";
import { kolProfiles, kolSegments } from "./schema.js";
import { chat } from "../lib/llm.js";
import { embedQuery } from "../lib/embed.js";

interface VideoData {
  bvid: string;
  aid: number;
  title: string;
  description: string;
  duration: string;
  play: number;
  comment_count: number;
  created: number;
  subtitles: Array<{ lang: string; text: string; method: string }>;
  up_replies: string[];
}

interface KolData {
  uid: number;
  videos: VideoData[];
}

const DATA_DIR = join(import.meta.dirname, "..", "..", "..", "..", "data", "kol");

function loadKolData(filename: string): KolData {
  const raw = readFileSync(join(DATA_DIR, filename), "utf-8");
  return JSON.parse(raw) as KolData;
}

// 清洗套话：去除 UP 主的固定开场白、结尾求三连、关注引流等纯套路表达
// 这些是视频格式套话，不包含对游戏的观点，保留会污染 RAG 检索和 AI 回答质量
function cleanText(text: string): string {
  let cleaned = text;

  // 开头自我介绍
  cleaned = cleaned.replace(/大家好[,，]?\s*我是.{0,30}(?=[。！？\n，,]|$)/g, "");
  cleaned = cleaned.replace(/大家好[,，]?\s*我说.{0,30}(?=[。！？\n，,]|$)/g, "");
  cleaned = cleaned.replace(/我是.{0,20}(UP主|up主|博主|游戏UP)/g, "");

  // 结尾求三连 / 引导
  cleaned = cleaned.replace(/如果你喜欢这[期些个]视频.{0,60}/g, "");
  cleaned = cleaned.replace(/如果.{0,5}(喜欢|觉得).{0,5}(这期|这个)?视频.{0,60}/g, "");
  cleaned = cleaned.replace(
    /(投币|点赞|收藏|转发|订阅|关注)[，,\s]*(投币|点赞|收藏|转发|订阅|关注)?[，,\s]*(投币|点赞|收藏|转发|订阅|关注)?/g,
    "",
  );
  cleaned = cleaned.replace(/一键三连/g, "");
  cleaned = cleaned.replace(/还请[您你]?.{0,30}(投币|点赞|收藏|转发|订阅|三连|关注).{0,30}/g, "");
  cleaned = cleaned.replace(/带给.{0,10}(伯伯的)?关注/g, "");

  // 结尾道别
  cleaned = cleaned.replace(/我们下期再见.{0,20}/g, "");
  cleaned = cleaned.replace(/下期再见.{0,10}/g, "");
  cleaned = cleaned.replace(/拜拜[~！!]*\s*$/gm, "");

  // 关注/互动引导
  cleaned = cleaned.replace(/也?可以在(私信|评论区).{0,40}/g, "");
  cleaned = cleaned.replace(/[有想]?.{0,15}(私信|评论区).{0,20}(告诉我|留言)/g, "");
  cleaned = cleaned.replace(/关注[我我]们?.{0,20}/g, "");
  cleaned = cleaned.replace(/希望大家.{0,20}(点赞|投币|收藏|支持)/g, "");

  // 清理多余空白
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned.replace(/ {2,}/g, " ");
  cleaned = cleaned.trim();

  return cleaned;
}

// ── LLM 画像提取 ──

async function extractWithLLM(
  name: string,
  samples: string,
): Promise<{ personaCard: Record<string, unknown>; styleProfile: Record<string, unknown> }> {
  const prompt = `你是游戏行业的内容分析师。请分析以下B站UP主「${name}」的视频转录文本，提取两份结构化画像。

## 提取要求

### personaCard（人设画像）：
1. identity: 一句话定位（30字以内，包含内容领域和核心特色）
2. contentFocus: 主要覆盖的游戏类型/内容方向（数组，3-6个）
3. evaluationFramework: 评价游戏时的维度权重（对象，4-5个维度，每个一句话说明）。必须从原文中推断真实关注点，不要套模板。
4. platformPreference: 平台偏好（PC/主机/NS/手机）
5. specialty: 专业特长和独特性（1-2句话，区别于其他UP主）
6. toneSummary: 整体语气的概括描述（如"批判性"、"热情"、"客观冷静"等）
7. representativeTopics: 代表性议题/常讨论话题（数组，3-5个，从原文高频主题中提取，如"武器平衡"、"匹配机制"、"新手体验"）
8. audiencePositioning: 受众定位（1句话，描述主要面向哪类玩家群体，如"核心FPS玩家"、"休闲向游戏爱好者"）
9. contentFormats: 常用内容形式（数组，1-3个，如"深度测评"、"游戏杂谈"、"实况解说"）

### styleProfile（风格画像）：
1. tone: 语气倾向（"偏批判" / "偏正面" / "均衡" / "幽默调侃"之一）
2. avgSentenceLength: 估算的平均句长（数字）
3. firstPersonStyle: 第一人称表达方式（如"我觉得"、"我个人"、"鬼王我"、"我说"等）
4. speechHabits: 说话时的自然语言习惯（2-3句话描述整体质感，如"略带东北方言，会用单字评价、反问句式较多"，描述"怎么说话"而不是罗列具体词汇）
5. catchphrases: 常用口头禅或高频短语（数组，3-5个，必须从原文中真实提取，如"不是哥们"、"有一说一"）
6. signaturePatterns: 标志性表达句式或语言模式（数组，2-3个，如"进来，告诉你XXX"、"XXX这点我得说道说道"）
7. pacingStyle: 内容节奏/语速风格（如"快节奏直切主题"、"娓娓道来"、"先抑后扬"）
8. vocabularyStyle: 词汇风格（如"通俗易懂"、"专业术语较多"、"网络梗密集"）

### 重要规则
- 所有提取必须基于原文实际内容，不要编造
- speechHabits 描述风格的整体感觉，让AI理解"怎么说话"；catchphrases 和 signaturePatterns 则从原文中如实提取具体短语和句式
- catchphrases / signaturePatterns 如果无法从原文确定，返回空数组 []，不要编造
- 如果无法从原文中确定其他字段，写"未知"而不是编造

## 视频转录样本（已清洗，取代表性片段）

${samples.slice(0, 8000)}

请只输出一个JSON对象，包含 personaCard 和 styleProfile 两个字段。`;

  try {
    let content = await chat(
      [{ role: "user", content: prompt }],
      { temperature: 0.3, maxTokens: 2048 },
    );
    // 清理可能的 Markdown 代码块标记
    content = content.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    return JSON.parse(content);
  } catch (e) {
    console.error(`  ⚠️ LLM提取失败，使用备用统计方法: ${e}`);
    return buildFallbackProfile(name, samples);
  }
}

// 备用方案：LLM 不可用时用统计方法
function buildFallbackProfile(
  name: string,
  allText: string,
): { personaCard: Record<string, unknown>; styleProfile: Record<string, unknown> } {
  const sentences = allText.split(/[。！？\n]/).filter(Boolean);
  const avgLen = Math.round(
    sentences.reduce((s, x) => s + x.length, 0) / Math.max(sentences.length, 1),
  );

  const praiseWords = [
    "好",
    "不错",
    "强",
    "厉害",
    "惊艳",
    "满意",
    "喜欢",
    "爱",
    "爽",
    "帅",
    "优秀",
    "出色",
  ];
  const criticizeWords = [
    "差",
    "烂",
    "不行",
    "失望",
    "问题",
    "不足",
    "缺陷",
    "糟糕",
    "无聊",
    "粗糙",
  ];
  let praiseCount = 0,
    criticCount = 0;
  for (const w of praiseWords) praiseCount += (allText.match(new RegExp(w, "g")) ?? []).length;
  for (const w of criticizeWords) criticCount += (allText.match(new RegExp(w, "g")) ?? []).length;

  return {
    personaCard: {
      identity: `${name}，B站游戏测评UP主`,
      contentFocus: ["游戏测评"],
      evaluationFramework: { 玩法: "重要", 手感: "重要", 画面: "参考", 叙事: "参考" },
      platformPreference: "未知",
      specialty: "未知",
      toneSummary:
        praiseCount > criticCount * 1.5
          ? "偏正面"
          : criticCount > praiseCount * 1.5
            ? "偏批判"
            : "均衡",
    },
    styleProfile: {
      tone:
        praiseCount > criticCount * 1.5
          ? "偏正面"
          : criticCount > praiseCount * 1.5
            ? "偏批判"
            : "均衡",
      avgSentenceLength: avgLen,
      firstPersonStyle: allText.includes("我觉得") ? "我觉得" : "我",
      speechHabits: "",
      catchphrases: [],
      signaturePatterns: [],
      pacingStyle: "未知",
      vocabularyStyle: "未知",
    },
  };
}

// ── 语义分段：多级边界检测 + 话题相似度（解决语义不连贯和 chunk 过大的问题）──
// 策略：先按语义相似度检测话题边界，再在边界内做多级标点切分
// 边界优先级：段落 > 话题边界 > 句子（。！？）> 从句（，；：）> 短语（、）> 强制切分

const MAX_CHUNK_LEN = 500;

// ── 广告/赞助关键词（用于广告段检测）──
const AD_BRAND_KEYWORDS = [
  "盖世小机", "奥加诗", "联想云电脑", "清闲PRO", "雷蛇",
  "TMR瓷变组摇杆", "光微动", "霍尔线性",
  "原生震动信号", "微软官方授权", "Xbox官方授权",
  "购买链接", "优惠券", "下单", "限时优惠", "限量", "首发价", "到手价",
  "评论区置顶", "点击下方", "专属福利", "折扣码", "立减", "包邮",
];

const AD_TRANSITION_PATTERNS = [
  /有一款好的.{0,10}(外设|手柄|键盘|鼠标|耳机|显示器)/,
  /比如这台.{0,20}/,
  /推荐.{0,5}(大家|各位|一下)/,
  /这.{0,5}(手柄|外设|键盘|鼠标|耳机|显示器).{0,10}(真|确实|太|很)/,
  /说(到这|到这里|到这了).{0,5}(必须|不得不|要)/,
];

function isAdSegment(text: string): boolean {
  const hitCount = AD_BRAND_KEYWORDS.filter((kw) => text.includes(kw)).length;
  if (hitCount >= 2) return true;
  for (const pat of AD_TRANSITION_PATTERNS) {
    if (pat.test(text)) return true;
  }
  return false;
}

// ── 语义特征提取（用于话题相似度计算）──
const SEMANTIC_KEY_TERMS = [
  "游戏", "玩家", "战斗", "玩法", "画面", "设计", "系统", "体验",
  "BOSS", "关卡", "武器", "角色", "剧情", "手感", "打击", "操作",
  "魂系", "硬核", "开放世界", "RPG", "FPS", "动作", "射击", "策略",
  "PVP", "PVE", "竞技", "单人", "多人", "联机", "在线",
  "画质", "帧率", "优化", "引擎", "物理", "AI",
  "音效", "配乐", "配音", "剧情", "叙事", "世界观",
  "价格", "性价比", "氪金", "付费", "免费", "买断",
  "手柄", "键盘", "鼠标", "主机", "PC", "手机", "平台",
  "新手", "老玩家", "硬核玩家", "休闲玩家",
  "育碧", "卡普空", "任天堂", "索尼", "微软",
  "广告", "赞助", "推广", "合作",
];

function extractFeatures(text: string): Set<string> {
  const features = new Set<string>();
  // 游戏名《XXX》
  for (const m of text.matchAll(/《([^》]+)》/g)) {
    features.add(`GAME:${m[1]!}`);
  }
  // 关键术语
  for (const term of SEMANTIC_KEY_TERMS) {
    if (text.includes(term)) features.add(`TERM:${term}`);
  }
  // 广告标记
  if (isAdSegment(text)) features.add("AD");
  return features;
}

function featureSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0.5;
  if (a.size === 0 || b.size === 0) return 0.3;
  let intersection = 0;
  for (const x of a) {
    if (b.has(x)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0.5;
}

// ── 语义分段主函数 ──
function semanticChunkText(text: string, maxLen = MAX_CHUNK_LEN): string[] {
  if (!text || text.trim().length < 20) return [];

  // Step 1: 按句子拆分
  const sentences = text
    .split(/(?<=[。！？])\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length <= 3) {
    return chunkByPunctuation(text, maxLen);
  }

  // Step 2: 把句子合并成 ~200-400 字的块，用于相似度计算
  const blocks: string[] = [];
  let current = "";
  for (const sent of sentences) {
    if (current.length + sent.length > 400 && current.length > 100) {
      blocks.push(current.trim());
      current = sent;
    } else {
      current += sent;
    }
  }
  if (current.trim()) blocks.push(current.trim());

  if (blocks.length <= 2) {
    return chunkByPunctuation(text, maxLen);
  }

  // Step 3: 计算相邻块的语义相似度
  const blockFeatures = blocks.map((b) => extractFeatures(b));
  const similarities: number[] = [];
  for (let i = 0; i < blockFeatures.length - 1; i++) {
    similarities.push(featureSimilarity(blockFeatures[i]!, blockFeatures[i + 1]!));
  }

  // Step 4: 检测话题边界（相似度的谷底）
  const mean = similarities.reduce((a, b) => a + b, 0) / similarities.length;
  const variance =
    similarities.reduce((a, b) => a + (b - mean) ** 2, 0) / similarities.length;
  const std = Math.sqrt(variance);
  const threshold = Math.max(0.15, mean - 0.5 * std);

  const boundaries = new Set<number>();
  for (let i = 0; i < similarities.length; i++) {
    const prev = i > 0 ? similarities[i - 1]! : 1;
    const next = i < similarities.length - 1 ? similarities[i + 1]! : 1;
    if (similarities[i]! < threshold && similarities[i]! < prev && similarities[i]! < next) {
      boundaries.add(i + 1); // 边界在第 i 块之后
    }
  }

  // 额外：广告段强制边界
  for (let i = 0; i < blocks.length; i++) {
    if (isAdSegment(blocks[i]!)) {
      if (i > 0) boundaries.add(i); // 广告开始前
      boundaries.add(i + 1); // 广告结束后
    }
  }

  // Step 5: 按边界合并块，形成语义段
  const semanticSegments: string[] = [];
  current = "";
  for (let i = 0; i < blocks.length; i++) {
    if (boundaries.has(i) && current.trim()) {
      semanticSegments.push(current.trim());
      current = blocks[i]!;
    } else {
      current = current ? `${current} ${blocks[i]}` : blocks[i]!;
    }
  }
  if (current.trim()) semanticSegments.push(current.trim());

  // Step 6: 对每个语义段，如果超过 maxLen 则用标点切分
  const finalChunks: string[] = [];
  for (const seg of semanticSegments) {
    if (seg.length > maxLen) {
      finalChunks.push(...chunkByPunctuation(seg, maxLen));
    } else if (seg.length >= 20) {
      finalChunks.push(seg);
    }
  }

  return finalChunks.length > 0 ? finalChunks : chunkByPunctuation(text, maxLen);
}

// ── 多级标点切分（语义段内部的 fallback）──
function chunkByPunctuation(text: string, maxLen = MAX_CHUNK_LEN): string[] {
  const targetMin = 150;
  const targetMax = maxLen;
  const hardMax = targetMax + 50;

  if (!text || text.trim().length < 20) return [];

  const paragraphs = text.trim().split(/\n{2,}/);
  const chunks: string[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    if (trimmed.length <= targetMax) {
      if (trimmed.length >= 20) chunks.push(trimmed);
      continue;
    }
    chunks.push(...splitBySentences(trimmed, targetMin, targetMax, hardMax));
  }

  return chunks;
}

function splitBySentences(
  text: string,
  targetMin: number,
  targetMax: number,
  hardMax: number,
): string[] {
  const parts = text.split(/(?<=[。！？])\s*/).filter((s) => s.trim());
  if (parts.length === 1 && parts[0]!.length > targetMax) {
    return splitByClauses(parts[0]!, targetMin, targetMax, hardMax);
  }

  const result: string[] = [];
  let current = "";

  for (const part of parts) {
    const s = part.trim();
    if (!s) continue;

    if (s.length > hardMax) {
      if (current.trim()) {
        result.push(current.trim());
        current = "";
      }
      result.push(...splitByClauses(s, targetMin, targetMax, hardMax));
      continue;
    }

    const combinedLen = current.length + s.length + (current ? 1 : 0);
    if (combinedLen > targetMax) {
      if (current.trim()) result.push(current.trim());
      current = s;
    } else {
      current = current ? `${current} ${s}` : s;
    }
  }

  if (current.trim()) result.push(current.trim());
  return result;
}

function splitByClauses(
  text: string,
  targetMin: number,
  targetMax: number,
  hardMax: number,
): string[] {
  const parts = text.split(/(?<=[，；：])\s*/).filter((s) => s.trim());
  if (parts.length === 1) {
    return splitByPhrases(parts[0]!, targetMin, targetMax, hardMax);
  }

  const result: string[] = [];
  let current = "";

  for (const part of parts) {
    const c = part.trim();
    if (!c) continue;

    if (c.length > hardMax) {
      if (current.trim()) {
        result.push(current.trim());
        current = "";
      }
      result.push(...splitByPhrases(c, targetMin, targetMax, hardMax));
      continue;
    }

    const combinedLen = current.length + c.length + (current ? 1 : 0);
    if (combinedLen > targetMax) {
      if (current.trim()) result.push(current.trim());
      current = c;
    } else {
      current = current ? `${current} ${c}` : c;
    }
  }

  if (current.trim()) result.push(current.trim());
  return result;
}

function splitByPhrases(
  text: string,
  targetMin: number,
  targetMax: number,
  hardMax: number,
): string[] {
  const parts = text.split(/(?<=[、])\s*/).filter((s) => s.trim());
  if (parts.length === 1) {
    return forceSplit(parts[0]!, targetMax);
  }

  const result: string[] = [];
  let current = "";

  for (const part of parts) {
    const p = part.trim();
    if (!p) continue;

    if (p.length > hardMax) {
      if (current.trim()) {
        result.push(current.trim());
        current = "";
      }
      result.push(...forceSplit(p, targetMax));
      continue;
    }

    const combinedLen = current.length + p.length + (current ? 1 : 0);
    if (combinedLen > targetMax) {
      if (current.trim()) result.push(current.trim());
      current = p;
    } else {
      current = current ? `${current} ${p}` : p;
    }
  }

  if (current.trim()) result.push(current.trim());
  return result;
}

function forceSplit(text: string, maxLen: number): string[] {
  const result: string[] = [];
  let remaining = text.trim();

  while (remaining.length > maxLen) {
    let splitAt = maxLen;
    for (let i = maxLen - 1; i >= Math.max(0, maxLen - 60); i--) {
      if ("，；：。！？、 ".includes(remaining[i]!)) {
        splitAt = i + 1;
        break;
      }
    }
    const chunk = remaining.slice(0, splitAt).trim();
    if (chunk) result.push(chunk);
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) result.push(remaining);
  return result;
}

// 对外统一入口：语义分段，过滤过短片段
function chunkText(text: string, maxLen = MAX_CHUNK_LEN): string[] {
  return semanticChunkText(text, maxLen).filter((c) => c.length >= 20);
}

async function main() {
  const force = process.argv.includes("--force");

  if (force) {
    console.log("🧹 --force: 清空现有 KOL 数据...");
    await db.delete(kolSegments);
    await db.delete(kolProfiles);
  }

  const kols = [
    { file: "鬼王陆行_all.json", name: "鬼王陆行", uid: "1628647" },
    { file: "冷面叶星星IKGN_all.json", name: "冷面叶星星IKGN", uid: "518045432" },
  ];

  for (const kol of kols) {
    console.log(`\n📂 处理 ${kol.name}...`);

    // 检查是否已导入
    const existing = await db.query.kolProfiles.findFirst({
      where: (k, { eq }) => eq(k.name, kol.name),
    });
    if (existing && !force) {
      console.log(`  ⏭️  已存在，跳过`);
      continue;
    }

    const data = loadKolData(kol.file);
    const videosWithSubtitles = data.videos.filter((v) => v.subtitles.length > 0);

    console.log(`  📹 ${videosWithSubtitles.length}/${data.videos.length} 个视频含字幕`);

    // 收集清洗后的样本文本（选最有代表性的：总字数最多的前 5 个视频 + 随机 3 个）
    const cleanedSamples = videosWithSubtitles
      .map((v) => ({
        title: v.title,
        text: v.subtitles
          .map((s) => cleanText(s.text))
          .filter((t) => t.length > 30)
          .join("\n"),
      }))
      .filter((s) => s.text.length > 100)
      .sort((a, b) => b.text.length - a.text.length);

    const topSamples = cleanedSamples.slice(0, 5);
    const randomSamples = cleanedSamples
      .slice(5)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);
    const llmSamples = [...topSamples, ...randomSamples]
      .map((s) => `### ${s.title}\n${s.text.slice(0, 800)}`)
      .join("\n\n---\n\n");

    // LLM 提取画像
    console.log(`  🤖 LLM 分析 ${llmSamples.length} 个样本文本...`);
    const { personaCard, styleProfile } = await extractWithLLM(kol.name, llmSamples);

    console.log(`  身份: ${personaCard.identity}`);
    console.log(`  说话风格: ${styleProfile.speechHabits || "未提取"}`);
    console.log(`  语气: ${styleProfile.tone}`);

    // 收集所有文本用于 sourceTexts（清洗后）
    const allTexts = videosWithSubtitles.flatMap((v) =>
      v.subtitles.map((s) => cleanText(s.text)).filter((t) => t.length > 20),
    );

    // 统计视频数据补充到 styleProfile
    styleProfile.videoCount = videosWithSubtitles.length;
    styleProfile.totalPlayCount = videosWithSubtitles.reduce((s, v) => s + v.play, 0);

    // 插入 KOL Profile
    const [profile] = await db
      .insert(kolProfiles)
      .values({
        name: kol.name,
        bilibiliUid: kol.uid,
        personaCard,
        styleProfile,
        sourceTexts: allTexts,
      })
      .returning();

    console.log(`  ✅ KOL 画像已创建 (id=${profile!.id})`);

    // 插入语料片段（清洗后的文本），同步生成 embedding
    let segmentCount = 0;
    for (const video of videosWithSubtitles) {
      for (const sub of video.subtitles) {
        const cleaned = cleanText(sub.text);
        if (cleaned.length < 40) continue;
        const chunks = chunkText(cleaned);
        for (const chunk of chunks) {
          if (chunk.length < 20) continue;
          try {
            const embedding = await embedQuery(chunk);
            await db.insert(kolSegments).values({
              kolId: profile!.id,
              bvid: video.bvid,
              title: video.title,
              originalText: chunk,
              sourceUrl: `https://www.bilibili.com/video/${video.bvid}`,
              embedding,
            });
            segmentCount++;
          } catch (e) {
            console.error(`  ⚠️ embedding 生成失败，跳过片段: ${e}`);
          }
        }
      }
    }
    console.log(`  📝 ${segmentCount} 个语料片段已入库`);
  }

  console.log("\n✅ KOL 种子数据完成");
}

main().catch((e) => {
  console.error("种子数据失败:", e);
  process.exit(1);
});
