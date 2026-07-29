// --------------------------------------------------------------
// 种子脚本：导入 KOL 数据（两个 B 站 UP 主的最新视频内容）
// 运行: bun run apps/api/src/db/seed-kol.ts
// --------------------------------------------------------------

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

  // 开头自我介绍（"大家好，我是XXX" / "大家好，我说XXX" 及其变体）
  cleaned = cleaned.replace(/大家好[，,]\s*我是[^。！？\n，,]{0,30}[。！？]?\s*/g, "");
  cleaned = cleaned.replace(/大家好[，,]\s*我说[^。！？\n，,]{0,30}[。！？]?\s*/g, "");
  cleaned = cleaned.replace(/我是[^。！？\n，,]{0,20}(UP主|up主|博主)[。！？]?\s*/g, "");

  // 结尾求三连 / 订阅引导（各种变体）
  cleaned = cleaned.replace(/如果你喜欢这[期些个]视频[，,]?[^。！？\n]{0,60}[。！？]?/g, "");
  cleaned = cleaned.replace(/如果喜欢我[的下][一]?期视频[，,]?[^。！？\n]{0,60}[。！？]?/g, "");
  cleaned = cleaned.replace(/(投币|点赞|收藏|转发|订阅|按赞)[，,\s]*(投币|点赞|收藏|转发|订阅|按赞)?[，,\s]*(投币|点赞|收藏|转发|订阅|按赞)?[，,\s]*(投币|点赞|收藏|转发|订阅|按赞)?[，,\s]*(投币|点赞|收藏|转发|订阅|按赞)?[。！？]?\s*/g, "");
  cleaned = cleaned.replace(/请不吝(点赞|订阅|转发|打赏)[^。！？\n]{0,50}[。！？]?/g, "");
  cleaned = cleaned.replace(/还请[您你]?[^。！？\n]{0,30}(投币|点赞|收藏|转发|订阅)[^。！？\n]{0,30}[。！？]?/g, "");

  // 结尾道别
  cleaned = cleaned.replace(/我们下期再见[，,]?拜拜[。！？]?\s*/g, "");
  cleaned = cleaned.replace(/我们下期再见[。！？]?\s*/g, "");

  // 关注引导
  cleaned = cleaned.replace(/当然也不?[要忘][了记]?[^。！？\n]{0,30}关注[^。！？\n]{0,20}[。！？]?/g, "");
  cleaned = cleaned.replace(/也?可以在(私信|评论区)[^。！？\n]{0,40}[。！？]?/g, "");
  cleaned = cleaned.replace(/有任何想看的[^。！？\n]{0,30}(私信|评论区)[^。！？\n]{0,30}[。！？]?/g, "");

  // 清理多余空白
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned.replace(/^\s+|\s+$/g, "");

  return cleaned;
}

function buildStyleProfile(name: string, videos: VideoData[]): Record<string, unknown> {
  // 清洗后再分析
  const allText = videos
    .flatMap((v) => v.subtitles.map((s) => cleanText(s.text)))
    .join("\n");

  // 提取口头禅/高频短语（只保留有信息量的，不包含套话）
  const catchphrases: string[] = [];
  if (name === "鬼王陆行") {
    catchphrases.push(
      "鬼王我",
      "说实话",
      "我只能说",
      "必须得说",
    );
  } else {
    catchphrases.push(
      "1000小时",
      "11分",
      "叶指导",
      "冷面姐",
    );
  }

  // 统计基本特征
  const sentences = allText.split(/[。！？\n]/).filter(Boolean);
  const avgLen = Math.round(sentences.reduce((s, x) => s + x.length, 0) / sentences.length);

  // 情感分析粗略统计
  const praiseWords = ["好", "不错", "强", "厉害", "惊艳", "满意", "喜欢", "爱", "爽", "帅", "优秀", "出色"];
  const criticizeWords = ["差", "烂", "不行", "失望", "问题", "不足", "缺陷", "糟糕", "无聊", "粗糙"];

  let praiseCount = 0;
  let criticCount = 0;
  for (const w of praiseWords) {
    praiseCount += (allText.match(new RegExp(w, "g")) ?? []).length;
  }
  for (const w of criticizeWords) {
    criticCount += (allText.match(new RegExp(w, "g")) ?? []).length;
  }

  return {
    catchphrases,
    avgSentenceLength: avgLen,
    tone: praiseCount > criticCount * 1.5 ? "偏正面" : criticCount > praiseCount * 1.5 ? "偏批判" : "均衡",
    firstPersonPref: allText.includes("我觉得") ? "我觉得" : allText.includes("我个人") ? "我个人" : "我",
    videoCount: videos.length,
    totalPlayCount: videos.reduce((s, v) => s + v.play, 0),
  };
}

function buildPersonaCard(name: string, videos: VideoData[]): Record<string, unknown> {
  const allTitles = videos.map((v) => v.title).join(" | ");

  if (name === "鬼王陆行") {
    return {
      identity: "B站硬核游戏测评UP主，专注PC/主机端射击与动作游戏",
      contentFocus: ["射击游戏", "动作游戏", "独立游戏", "展会体验", "硬件外设"],
      evaluationFramework: {
        手感: "最看重，格斗/动作游戏的手感细节决定评价",
        玩法: "重要，创新机制和玩法深度是加分项",
        画面: "参考，不是决定因素但影响体验",
        叙事: "重要，角色塑造和故事线是系列测评的核心",
      },
      platformPreference: "PC端为主，主机（PS5/NS2）也会覆盖",
      tone: "偏正面但保持独立判断，对游戏性有严格要求",
      specialty: "展会前线体验 + 深度测评 + 游戏文化解读",
      recentTopics: allTitles,
    };
  }

  return {
    identity: "B站游戏测评UP主（IKGN频道），以深度测评和独特视角著称",
    contentFocus: ["动作游戏", "RPG", "独立游戏", "PV解析", "展会试玩"],
    evaluationFramework: {
      手感: "核心关注，对打击感、动作系统有专业分析",
      玩法: "最看重，对系统深度和创新性要求高",
      画面: "参考但不过分追求，更重美术风格",
      叙事: "因人而异，角色驱动型游戏会更关注剧情",
    },
    platformPreference: "PC端+主机端并重，NS2也经常测评",
    tone: "批判性较强，有独立评价体系，善用幽默和比喻",
    specialty: "PV前瞻分析 + 深度系统测评 + 1000小时梗",
    recentTopics: allTitles,
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
    { file: "鬼王陆行_videos.json", name: "鬼王陆行", uid: "1628647" },
    { file: "冷面叶星星IKGN_videos.json", name: "冷面叶星星IKGN", uid: "518045432" },
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

    // 构建风格画像
    const styleProfile = buildStyleProfile(kol.name, videosWithSubtitles);
    const personaCard = buildPersonaCard(kol.name, videosWithSubtitles);

    // 收集所有文本用于 sourceTexts（清洗后）
    const allTexts = videosWithSubtitles.flatMap((v) =>
      v.subtitles.map((s) => cleanText(s.text)).filter((t) => t.length > 20),
    );

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
        if (cleaned.length < 40) continue; // 洗完太短就整段跳过
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
