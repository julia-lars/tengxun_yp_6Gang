// --------------------------------------------------------------
// 种子脚本：导入 KOL 数据（两个 B 站 UP 主的最新视频内容）
// 运行: bun run apps/api/src/db/seed-kol.ts
// --------------------------------------------------------------

import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { db } from "./client.js";
import { kolProfiles, kolSegments } from "./schema.js";

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

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY ?? "";

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

### styleProfile（风格画像）：
1. tone: 语气倾向（"偏批判" / "偏正面" / "均衡" / "幽默调侃"之一）
2. avgSentenceLength: 估算的平均句长（数字）
3. firstPersonStyle: 第一人称表达方式（如"我觉得"、"我个人"、"鬼王我"、"我说"等）
4. speechHabits: 说话时的自然语言习惯（2-3句话描述，如"略带东北方言，会用单字评价、反问句式较多"，重点是自然融入回答而不是罗列关键词）。注意：不要列出具体的词汇或短语作为口头禅——描述语言风格的整体质感即可

### 重要规则
- 所有提取必须基于原文实际内容，不要编造
- speechHabits 不要罗列具体词汇——描述风格的整体感觉，让AI理解"怎么说话"而不是"说什么词"
- 如果无法从原文中确定某个字段，写"未知"而不是编造

## 视频转录样本（已清洗，取代表性片段）

${samples.slice(0, 8000)}

请只输出一个JSON对象，包含 personaCard 和 styleProfile 两个字段。`;

  try {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${DEEPSEEK_KEY}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 2048,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`DeepSeek API ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = (await res.json()) as { choices: [{ message: { content: string } }] };
    return JSON.parse(data.choices[0].message.content);
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
    },
  };
}

function chunkText(text: string, maxLen = 500): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[。！？\n])/);
  let current = "";
  for (const s of sentences) {
    if (current.length + s.length > maxLen && current) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
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

    // 插入语料片段（清洗后的文本）
    let segmentCount = 0;
    for (const video of videosWithSubtitles) {
      for (const sub of video.subtitles) {
        const cleaned = cleanText(sub.text);
        if (cleaned.length < 40) continue;
        const chunks = chunkText(cleaned);
        for (const chunk of chunks) {
          if (chunk.length < 20) continue;
          await db.insert(kolSegments).values({
            kolId: profile!.id,
            bvid: video.bvid,
            title: video.title,
            originalText: chunk,
            sourceUrl: `https://www.bilibili.com/video/${video.bvid}`,
          });
          segmentCount++;
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
