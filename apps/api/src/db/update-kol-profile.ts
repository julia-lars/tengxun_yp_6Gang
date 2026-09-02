// --------------------------------------------------------------
// 更新 KOL 画像（重新调用 LLM 提取，不重新插入语料）
// 运行: bun run apps/api/src/db/update-kol-profile.ts
// --------------------------------------------------------------

import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { db } from "./client.js";
import { kolProfiles } from "./schema.js";
import { chat } from "../lib/llm.js";

const DATA_DIR = join(import.meta.dirname, "..", "..", "..", "..", "data", "kol");

function loadKolData(filename: string) {
  const raw = readFileSync(join(DATA_DIR, filename), "utf-8");
  return JSON.parse(raw) as {
    uid: number;
    videos: Array<{
      bvid: string;
      title: string;
      subtitles: Array<{ lang: string; text: string; method: string }>;
      up_replies: string[];
      play: number;
    }>;
  };
}

function cleanText(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/大家好[,，]?\s*我是.{0,30}(?=[。！？\n，,]|$)/g, "");
  cleaned = cleaned.replace(/大家好[,，]?\s*我说.{0,30}(?=[。！？\n，,]|$)/g, "");
  cleaned = cleaned.replace(/我是.{0,20}(UP主|up主|博主|游戏UP)/g, "");
  cleaned = cleaned.replace(/如果你喜欢这[期些个]视频.{0,60}/g, "");
  cleaned = cleaned.replace(/如果.{0,5}(喜欢|觉得).{0,5}(这期|这个)?视频.{0,60}/g, "");
  cleaned = cleaned.replace(
    /(投币|点赞|收藏|转发|订阅|关注)[，,\s]*(投币|点赞|收藏|转发|订阅|关注)?[，,\s]*(投币|点赞|收藏|转发|订阅|关注)?/g,
    "",
  );
  cleaned = cleaned.replace(/一键三连/g, "");
  cleaned = cleaned.replace(/还请[您你]?.{0,30}(投币|点赞|收藏|转发|订阅|三连|关注).{0,30}/g, "");
  cleaned = cleaned.replace(/带给.{0,10}(伯伯的)?关注/g, "");
  cleaned = cleaned.replace(/我们下期再见.{0,20}/g, "");
  cleaned = cleaned.replace(/下期再见.{0,10}/g, "");
  cleaned = cleaned.replace(/拜拜[~！!]*\s*$/gm, "");
  cleaned = cleaned.replace(/也?可以在(私信|评论区).{0,40}/g, "");
  cleaned = cleaned.replace(/[有想]?.{0,15}(私信|评论区).{0,20}(告诉我|留言)/g, "");
  cleaned = cleaned.replace(/关注[我我]们?.{0,20}/g, "");
  cleaned = cleaned.replace(/希望大家.{0,20}(点赞|投币|收藏|支持)/g, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned.replace(/ {2,}/g, " ");
  return cleaned.trim();
}

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
    content = content.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    return JSON.parse(content);
  } catch (e) {
    console.error(`  ⚠️ LLM提取失败: ${e}`);
    throw e;
  }
}

async function main() {
  const kols = [
    { file: "鬼王陆行_all.json", name: "鬼王陆行", uid: "1628647" },
    { file: "冷面叶星星IKGN_all.json", name: "冷面叶星星IKGN", uid: "518045432" },
  ];

  for (const kol of kols) {
    console.log(`\n📂 更新画像: ${kol.name}...`);

    const existing = await db.query.kolProfiles.findFirst({
      where: (k, { eq }) => eq(k.name, kol.name),
    });
    if (!existing) {
      console.log(`  ⏭️  KOL 不存在，跳过`);
      continue;
    }

    const data = loadKolData(kol.file);
    const videosWithSubtitles = data.videos.filter((v) => v.subtitles.length > 0);

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

    console.log(`  🤖 LLM 分析 ${llmSamples.length} 个样本文本...`);
    const { personaCard, styleProfile } = await extractWithLLM(kol.name, llmSamples);

    console.log(`  身份: ${personaCard.identity}`);
    console.log(`  说话风格: ${styleProfile.speechHabits || "未提取"}`);
    console.log(`  语气: ${styleProfile.tone}`);

    // 保留原有的 videoCount 和 totalPlayCount
    const oldStyle = existing.styleProfile as Record<string, unknown>;
    styleProfile.videoCount = oldStyle.videoCount;
    styleProfile.totalPlayCount = oldStyle.totalPlayCount;

    await db
      .update(kolProfiles)
      .set({ personaCard, styleProfile })
      .where(eq(kolProfiles.id, existing.id));

    console.log(`  ✅ 画像已更新 (id=${existing.id})`);
  }

  console.log("\n✅ KOL 画像更新完成");
}

main().catch((e) => {
  console.error("更新失败:", e);
  process.exit(1);
});
