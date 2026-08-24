// --------------------------------------------------------------
// 数据库写入 — 将流水线处理结果写入 source_segments 和 respondents 表
// 移植自 scripts/load_segments.py
// --------------------------------------------------------------

import { sql } from "drizzle-orm";

import { db, schema } from "../db/client.js";
import type { EmbeddedSegment } from "./pipeline-embedder.js";

// ---- 类型定义 ----

export interface DbWriteResult {
  /** 插入的片段数 */
  segmentsInserted: number;
  /** 插入的受访者数 */
  respondentsInserted: number;
  /** 错误信息 */
  errors: string[];
}

// ---- 受访者信息 ----

interface RespondentInfo {
  sourceFile: string;
  speakerId: string;
  displayName: string;
  groupCode: string;
}

// ---- 写入函数 ----

/**
 * 将处理后的片段写入数据库
 * 1. 先写入 respondents（去重）
 * 2. 再写入 source_segments
 */
export async function writeSegmentsToDb(
  segments: EmbeddedSegment[],
): Promise<DbWriteResult> {
  const result: DbWriteResult = {
    segmentsInserted: 0,
    respondentsInserted: 0,
    errors: [],
  };

  if (segments.length === 0) {
    return result;
  }

  try {
    // 1. 构建受访者去重集
    const respondentMap = new Map<string, RespondentInfo>();
    for (const seg of segments) {
      const key = `${seg.sourceFile}::${seg.speakerId}`;
      if (!seg.speakerId || respondentMap.has(key)) continue;

      respondentMap.set(key, {
        sourceFile: seg.sourceFile,
        speakerId: seg.speakerId,
        displayName: seg.speakerId,
        groupCode: classifySourceFile(seg.sourceFile),
      });
    }

    // 2. 写入受访者（去重）
    const respondents = Array.from(respondentMap.values());
    for (const resp of respondents) {
      try {
        await db
          .insert(schema.respondents)
          .values({
            sourceFile: resp.sourceFile,
            speakerId: resp.speakerId,
            displayName: resp.displayName,
            groupCode: resp.groupCode,
          })
          .onConflictDoNothing();
        result.respondentsInserted++;
      } catch (e) {
        result.errors.push(`写入受访者失败 (${resp.speakerId}): ${String(e)}`);
      }
    }

    // 3. 写入片段
    for (const seg of segments) {
      try {
        // 确保 speaker_role 是有效值
        const speakerRole =
          seg.speakerRole === "moderator" ? "moderator" : "interviewee";

        await db.insert(schema.sourceSegments).values({
          sourceFile: seg.sourceFile,
          segmentIndex: seg.segmentIndex,
          speakerId: seg.speakerId,
          speakerRole,
          precedingQuestion: seg.precedingQuestion,
          originalText: seg.originalText,
          cleanedText: seg.cleanedText,
          charCount: seg.charCount,
          annotation: seg.annotation,
          embedding: seg.embedding,
          embeddingVersion: seg.embeddingVersion,
          embeddedAt: seg.embedding ? new Date() : null,
        });

        result.segmentsInserted++;
      } catch (e) {
        result.errors.push(
          `写入片段失败 (${seg.sourceFile}#${seg.segmentIndex}): ${String(e)}`,
        );
      }
    }
  } catch (e) {
    result.errors.push(`数据库写入异常: ${String(e)}`);
  }

  return result;
}

/**
 * 根据来源文件名分类
 * 与 load_segments.py 的 sheet_from_source_file() 保持一致
 */
function classifySourceFile(sourceFile: string): string {
  if (sourceFile.includes("漫威")) return "中美用户洞察";
  if (sourceFile.includes("用户细分")) return "用户细分研究";
  if (sourceFile.includes("生态与决策")) return "用户生态与决策链路";
  if (sourceFile.includes("行为") || sourceFile.includes("乐趣")) return "玩家行为乐趣整理";
  if (sourceFile.includes("经验认知")) return "经验认知乐趣对比";
  return "未知";
}

/**
 * 检查数据库中是否已有数据
 */
export async function hasExistingData(): Promise<boolean> {
  try {
    const result = await db
      .select({ count: schema.sourceSegments.id })
      .from(schema.sourceSegments)
      .limit(1);
    return result.length > 0;
  } catch {
    return false;
  }
}

/**
 * 清空流水线相关的表（谨慎使用）
 */
export async function truncatePipelineTables(): Promise<void> {
  // 从 source_segments 中删除（保留其他表的数据）
  // 注意：不删除 personas 表，因为那是聚类结果
  try {
    await db.execute(sql`TRUNCATE source_segments, respondents RESTART IDENTITY CASCADE`);
  } catch (e) {
    console.error("清空表失败:", e);
    throw e;
  }
}