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
    // 在事务中写入，保证原子性
    await db.transaction(async (tx) => {
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
          await tx
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

          await tx.insert(schema.sourceSegments).values({
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
    });
  } catch (e) {
    result.errors.push(`数据库事务异常: ${String(e)}`);
  }

  return result;
}

/**
 * 根据来源文件名分类（覆盖全部 14 个项目类型）
 */
function classifySourceFile(sourceFile: string): string {
  const m = sourceFile;

  if (m.includes("漫威")) return "漫威争锋中美用户洞察研究";
  if (m.includes("用户细分")) return "美国HD端射击市场用户细分研究";
  if (m.includes("生态与决策")) return "美国HD端用户生态与决策链路研究";
  if (m.includes("Deadlock") || m.includes("deadlock")) return "Deadlock竞品研究";
  if (m.includes("IMUR") || m.includes("AI模拟")) return "IMUR AI模拟用户基座数据采集";
  if (m.includes("竞技品类")) return "竞技品类基础研究";
  if (m.includes("绝地潜兵") && m.includes("摸底")) return "绝地潜兵2竞品研究-摸底期";
  if (m.includes("绝地潜兵") && m.includes("拓圈")) return "绝地潜兵2竞品研究-拓圈期";
  if (m.includes("枪战") || m.includes("长线新手")) return "枪战类长线新手体验研究";
  if (m.includes("生存撤离") || m.includes("新手引导")) return "生存撤离类新手引导体验研究";
  if (m.includes("搜打撤")) return "搜打撤品类研究";
  if (m.includes("瓦洛兰特")) return "瓦洛兰特海外人群玩法研究";
  if (m.includes("玩家能力") || m.includes("射击产品")) return "玩家能力对射击产品规模影响研究";
  if (m.includes("萤火突击")) return "萤火突击竞品研究";

  return sourceFile || "未知";
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