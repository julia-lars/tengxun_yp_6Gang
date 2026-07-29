// --------------------------------------------------------------
// KOL 语料 Embedding + 广告口播检测
//
// 流程：
//   1. 逐条读取 kol_segments（skip 已有 embedding 的）
//   2. LLM 快速分类：测评内容 / 广告口播 / 混合
//   3. 调用 GLM embedding API 生成 1024 维向量
//   4. 写入 kol_segments.embedding + kol_segments.ad_label
//
// 用法: bun run scripts/embed-kol.ts
// --------------------------------------------------------------

import { db } from "../src/db/client.js";
import { kolSegments } from "../src/db/schema.js";
import { eq, isNull } from "drizzle-orm";

// 手动加载 .env
import { readFileSync } from "node:fs";
const envPath = new URL("../.env", import.meta.url);
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
} catch { /* .env 不存在则跳过 */ }

// ---- 配置 ----
const GLM_KEY = process.env.GLM_API_KEY ?? "";
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY ?? "";

const BATCH_SIZE = 10;       // 每批处理 10 条
const BATCH_DELAY = 3000;    // 批次间休息 3 秒（避限流）
const EMBED_MODEL = "embedding-2";  // GLM embedding 模型

// ---- 广告口播关键词（快速预筛，不走 LLM 的明显广告） ----
const AD_KEYWORDS = [
  "购买链接", "优惠券", "下单", "限时优惠", "限量", "首发价", "到手价",
  "评论区置顶", "点击下方", "专属福利", "折扣码", "立减", "包邮",
  "盖世小机", "奥加诗", "联想云电脑", "清闲PRO", "雷蛇",  // 鬼王常见广告品牌
  "TMR瓷变组摇杆", "光微动", "霍尔线性",  // 外设广告术语
  "原生震动信号", "微软官方授权", "Xbox官方授权",  // 手柄广告标志词
  "DEEPSEEK_API_KEY", "API",  // 排除误匹配的通用词
].filter(w => !["DEEPSEEK_API_KEY", "API"].includes(w)); // 去掉太短的

// ---- LLM 广告分类 ----
async function classifyAdSegment(text: string): Promise<"测评内容" | "广告口播" | "混合"> {
  // 第一步：关键词快筛——如果广告词密度很高，直接判为广告
  const adHitCount = AD_KEYWORDS.filter((kw) => text.includes(kw)).length;
  const textLen = text.length;

  // 短文本中密集命中广告词 → 广告
  if (adHitCount >= 3) return "广告口播";
  // 一个广告词都没有且文本够长 → 测评
  if (adHitCount === 0 && textLen > 100) return "测评内容";

  // 第二步：LLM 精确判断（边缘 case）
  try {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEPSEEK_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content:
              "你是一个内容分类器。判断以下B站UP主视频片段属于哪一类。只输出一个词：测评内容、广告口播、混合。\n\n标准：\n- 测评内容：对游戏的评价、分析、体验分享\n- 广告口播：推广具体产品（手柄、椅子、云电脑等），包含价格、购买方式、参数介绍\n- 混合：在同一段中既有游戏测评内容又有产品推广",
          },
          { role: "user", content: text.slice(0, 800) },
        ],
        temperature: 0.1,
        max_tokens: 10,
      }),
    });

    if (!res.ok) throw new Error(`DeepSeek ${res.status}`);
    const data = (await res.json()) as { choices: [{ message: { content: string } }] };
    const label = data.choices[0].message.content.trim();

    if (label.includes("广告")) return "广告口播";
    if (label.includes("混合")) return "混合";
    return "测评内容";
  } catch {
    // LLM 挂了 → 用关键词兜底
    return adHitCount >= 2 ? "广告口播" : adHitCount >= 1 ? "混合" : "测评内容";
  }
}

// ---- GLM Embedding ----
async function embedWithGLM(text: string): Promise<number[]> {
  const res = await fetch("https://open.bigmodel.cn/api/paas/v4/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GLM_KEY}`,
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: text.slice(0, 2000), // GLM embedding 有 token 限制
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GLM embedding ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = (await res.json()) as { data: [{ embedding: number[] }] };
  return data.data[0].embedding;
}

// ---- 主流程 ----
async function main() {
  // 获取所有尚未 embed 的片段
  const segments = await db
    .select({ id: kolSegments.id, text: kolSegments.originalText, title: kolSegments.title })
    .from(kolSegments)
    .where(isNull(kolSegments.embedding));

  console.log(`📊 共 ${segments.length} 条待处理片段\n`);

  let done = 0;
  let adCount = 0;
  let reviewCount = 0;
  let mixedCount = 0;

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);

    for (const seg of batch) {
      try {
        // 1. 分类广告
        const label = await classifyAdSegment(seg.text);
        if (label === "广告口播") adCount++;
        else if (label === "混合") mixedCount++;
        else reviewCount++;

        // 2. 生成向量
        const vec = await embedWithGLM(seg.text);

        // 3. 写入
        await db
          .update(kolSegments)
          .set({
            embedding: vec,
            adLabel: label,
          })
          .where(eq(kolSegments.id, seg.id));

        done++;
        const icon = label === "广告口播" ? "📢" : label === "混合" ? "🔀" : "✅";
        process.stdout.write(
          `\r${icon} [${done}/${segments.length}] ${seg.title.slice(0, 40)}... (${label})     `,
        );
      } catch (e) {
        console.error(`\n❌ id=${seg.id}: ${e}`);
      }
    }

    // 批次间休息
    if (i + BATCH_SIZE < segments.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY));
    }
  }

  console.log("\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ Embedding 完成");
  console.log(`   测评内容: ${reviewCount} 条`);
  console.log(`   广告口播: ${adCount} 条`);
  console.log(`   混合内容: ${mixedCount} 条`);
  console.log(`   总计:     ${done} 条`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\n💡 提示: 接下来需要更新 routes/kol.ts 中的 RAG 检索，");
  console.log("   将 ILIKE 替换为 pgvector 向量相似搜索，并过滤 ad_label='广告口播' 的片段。");
}

main().catch((e) => {
  console.error("脚本失败:", e);
  process.exit(1);
});
