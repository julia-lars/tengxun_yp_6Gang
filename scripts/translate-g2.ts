/**
 * 翻译 G2 座谈会笔录：cleaned + labeled + merged 三个版本
 * 使用项目现有的 LLM 模块（llm.ts）进行翻译
 *
 * 用法: npx tsx scripts/translate-g2.ts
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { chat } from "../apps/api/src/lib/llm.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

const FILES = {
  cleaned: `${DATA_DIR}/群体画像v2.0_cleaned/搜打撤品类研究/海外/座谈会笔录/座谈会笔录-G2_cleaned.json`,
  labeled: `${DATA_DIR}/群体画像v2.0_labeled/搜打撤品类研究/海外/座谈会笔录/座谈会笔录-G2.json`,
  merged: `${DATA_DIR}/群体画像v2.0_merged/搜打撤品类研究.json`,
};

const SYSTEM_PROMPT = `你是一个专业的游戏用户研究翻译助手。请将以下英文座谈会笔录翻译成中文。

翻译要求：
1. 翻译要自然流畅，符合中文口语习惯，模拟真实的中文座谈会对话
2. 游戏术语保留英文原名（如 Tarkov、FPS、extraction shooter 等），或使用业界通用译名
3. 保持原文的语气、情感和口语化表达（如犹豫、重复、口头禅等）
4. 不要添加或删减内容，忠实于原文
5. 输出格式：每行一个翻译结果，用 "---" 分隔每个条目，顺序与输入一致`;

const BATCH_SIZE = 15;

async function translateBatch(texts: string[], description: string): Promise<string[]> {
  const results: string[] = [];
  const total = texts.length;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const inputText = batch
      .map((t, j) => `[${i + j + 1}] ${t}`)
      .join("\n\n---\n\n");

    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: `请翻译以下${description}（共 ${batch.length} 条），保持编号和分隔符：\n\n${inputText}`,
      },
    ];

    try {
      const translated = await chat(messages, {
        temperature: 0.3,
        maxTokens: 8192,
      });

      // 解析翻译结果：按 "[N]" 分割
      const parts = translated
        .split(/\n?(?=\[\d+\])/)
        .map((p) => p.replace(/^\[\d+\]\s*/, "").trim())
        .filter(Boolean);

      if (parts.length === batch.length) {
        results.push(...parts);
      } else {
        console.log(
          `  Batch ${Math.floor(i / BATCH_SIZE) + 1} 解析数量不匹配: got ${parts.length}, expected ${batch.length}，保留原文`
        );
        results.push(...batch);
      }
    } catch (e) {
      console.error(`  Batch ${Math.floor(i / BATCH_SIZE) + 1} 翻译失败:`, String(e).slice(0, 100));
      results.push(...batch);
    }

    console.log(`  [${description}] 进度: ${Math.min(i + BATCH_SIZE, total)}/${total}`);
    // 避免请求过快
    await new Promise((r) => setTimeout(r, 500));
  }

  return results;
}

async function translateCleaned() {
  const filepath = FILES.cleaned;
  console.log(`\n=== 翻译 cleaned: ${filepath} ===`);

  const data = JSON.parse(readFileSync(filepath, "utf-8"));
  const segments = data.segments as Array<Record<string, unknown>>;
  const total = segments.length;

  const pqs = segments.map((s) => s.preceding_question as string);
  const texts = segments.map((s) => s.cleaned_text as string);

  // 翻译唯一 PQ
  const uniquePqs = [...new Set(pqs)];
  console.log(`翻译 ${uniquePqs.length} 个唯一问题...`);
  const translatedPqs = await translateBatch(uniquePqs, "主持人问题");
  const pqMap = new Map(uniquePqs.map((k, i) => [k, translatedPqs[i]]));

  // 翻译 cleaned_text
  console.log(`翻译 ${total} 个回答...`);
  const translatedTexts = await translateBatch(texts, "受访者回答");

  // 更新
  for (let i = 0; i < total; i++) {
    segments[i].preceding_question = pqMap.get(pqs[i]) ?? pqs[i];
    segments[i].cleaned_text = translatedTexts[i] ?? texts[i];
  }

  writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`cleaned 版本已保存: ${total} segments`);
}

async function translateLabeled() {
  const filepath = FILES.labeled;
  console.log(`\n=== 翻译 labeled: ${filepath} ===`);

  const data = JSON.parse(readFileSync(filepath, "utf-8"));
  const segments = data.segments as Array<Record<string, unknown>>;
  const total = segments.length;

  const pqs = segments.map((s) => s.preceding_question as string);
  const texts = segments.map((s) => s.cleaned_text as string);

  const uniquePqs = [...new Set(pqs)];
  console.log(`翻译 ${uniquePqs.length} 个唯一问题...`);
  const translatedPqs = await translateBatch(uniquePqs, "主持人问题");
  const pqMap = new Map(uniquePqs.map((k, i) => [k, translatedPqs[i]]));

  console.log(`翻译 ${total} 个回答...`);
  const translatedTexts = await translateBatch(texts, "受访者回答");

  for (let i = 0; i < total; i++) {
    const oldPq = pqs[i];
    const newPq = pqMap.get(oldPq) ?? oldPq;
    segments[i].preceding_question = newPq;
    segments[i].cleaned_text = translatedTexts[i] ?? texts[i];
    const ann = segments[i].annotation as Record<string, unknown> | undefined;
    if (ann?.source) {
      (ann.source as Record<string, unknown>).preceding_question = newPq;
    }
  }

  writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`labeled 版本已保存: ${total} segments`);
}

async function translateMerged() {
  const filepath = FILES.merged;
  console.log(`\n=== 翻译 merged: ${filepath} ===`);

  const data = JSON.parse(readFileSync(filepath, "utf-8"));
  const allSegments = data.segments as Array<Record<string, unknown>>;

  // 找到所有海外 G2 segments
  const g2Indices: number[] = [];
  for (let i = 0; i < allSegments.length; i++) {
    const src = allSegments[i].source_file as string;
    if (src && src.includes("海外") && src.includes("座谈会笔录-G2")) {
      g2Indices.push(i);
    }
  }

  console.log(`找到 ${g2Indices.length} 个海外 G2 segments`);

  const g2Segments = g2Indices.map((i) => allSegments[i]);
  const pqs = g2Segments.map((s) => s.preceding_question as string);
  const texts = g2Segments.map((s) => s.cleaned_text as string);

  const uniquePqs = [...new Set(pqs)];
  console.log(`翻译 ${uniquePqs.length} 个唯一问题...`);
  const translatedPqs = await translateBatch(uniquePqs, "主持人问题");
  const pqMap = new Map(uniquePqs.map((k, i) => [k, translatedPqs[i]]));

  console.log(`翻译 ${texts.length} 个回答...`);
  const translatedTexts = await translateBatch(texts, "受访者回答");

  for (let j = 0; j < g2Indices.length; j++) {
    const idx = g2Indices[j];
    const s = allSegments[idx];
    const oldPq = pqs[j];
    const newPq = pqMap.get(oldPq) ?? oldPq;
    s.preceding_question = newPq;
    s.cleaned_text = translatedTexts[j] ?? texts[j];
    const ann = s.annotation as Record<string, unknown> | undefined;
    if (ann?.source) {
      (ann.source as Record<string, unknown>).preceding_question = newPq;
    }
  }

  writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`merged 版本已保存: ${g2Indices.length} 个海外 G2 segments`);
}

// ---- Main ----
async function main() {
  await translateCleaned();
  await translateLabeled();
  await translateMerged();
  console.log("\n=== 全部翻译完成 ===");
}

main().catch((e) => {
  console.error("翻译失败:", e);
  process.exit(1);
});