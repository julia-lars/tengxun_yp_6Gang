// --------------------------------------------------------------
// 文件解析器 — 将上传的原始文件解析为结构化文本片段
// 支持: txt, csv, json, md, docx, xlsx, pdf
// --------------------------------------------------------------

import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { PDFParse } from "pdf-parse";

// ---- 类型定义 ----

export interface RawSegment {
  /** 来源文件名 */
  sourceFile: string;
  /** 片段在文件中的序号（1-based） */
  segmentIndex: number;
  /** 说话人标识（未知时使用文件名） */
  speakerId: string;
  /** 说话人角色 */
  speakerRole: "interviewee" | "moderator";
  /** 上一条 moderator 提问 */
  precedingQuestion: string | null;
  /** 原始文本 */
  originalText: string;
}

export interface ParseResult {
  segments: RawSegment[];
  /** 去重后的受访者信息 */
  respondents: Array<{
    sourceFile: string;
    speakerId: string;
    displayName: string;
  }>;
}

// ---- 主解析函数 ----

/**
 * 根据文件名和内容解析文件为文本片段
 */
export async function parseFile(
  buffer: Buffer,
  filename: string,
): Promise<ParseResult> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "txt";

  switch (ext) {
    case "txt":
    case "md":
      return parseTextFile(buffer, filename);
    case "csv":
      return parseCsvFile(buffer, filename);
    case "json":
      return parseJsonFile(buffer, filename);
    case "docx":
      return parseDocxFile(buffer, filename);
    case "xlsx":
      return parseXlsxFile(buffer, filename);
    case "pdf":
      return parsePdfFile(buffer, filename);
    default:
      // 尝试当作文本文件解析
      return parseTextFile(buffer, filename);
  }
}

// ---- 各格式解析器 ----

/**
 * 纯文本文件解析（txt, md）
 * 按行分割，空行作为段落分隔
 */
function parseTextFile(buffer: Buffer, filename: string): ParseResult {
  const text = buffer.toString("utf-8");
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { segments: [], respondents: [] };
  }

  const segments: RawSegment[] = [];
  let lastModeratorText: string | null = null;

  // 检测格式：如果行以 "Q:" / "A:" / "问：" 等开头，使用 QA 模式
  const qaPattern = /^(Q|问|提问|主持人|Moderator|Interviewer)[:：]\s*/i;
  const answerPattern = /^(A|答|回答|受访者|Interviewee|Respondent|Speaker)[:：]\s*/i;

  const isQaFormat = lines.some((l) => qaPattern.test(l) || answerPattern.test(l));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (isQaFormat) {
      if (qaPattern.test(line)) {
        lastModeratorText = line.replace(qaPattern, "").trim();
      } else if (answerPattern.test(line)) {
        const text = line.replace(answerPattern, "").trim();
        if (text.length > 0) {
          segments.push({
            sourceFile: filename,
            segmentIndex: segments.length + 1,
            speakerId: "speaker_1",
            speakerRole: "interviewee",
            precedingQuestion: lastModeratorText,
            originalText: text,
          });
        }
      } else {
        // 未标记行：如果前一行是 moderator 提问，则视为回答
        if (lastModeratorText) {
          segments.push({
            sourceFile: filename,
            segmentIndex: segments.length + 1,
            speakerId: "speaker_1",
            speakerRole: "interviewee",
            precedingQuestion: lastModeratorText,
            originalText: line,
          });
          lastModeratorText = null;
        } else {
          // 当作普通发言
          segments.push({
            sourceFile: filename,
            segmentIndex: segments.length + 1,
            speakerId: "speaker_1",
            speakerRole: "interviewee",
            precedingQuestion: null,
            originalText: line,
          });
        }
      }
    } else {
      // 普通格式：按段落分割，每行一条片段
      segments.push({
        sourceFile: filename,
        segmentIndex: segments.length + 1,
        speakerId: "speaker_1",
        speakerRole: "interviewee",
        precedingQuestion: null,
        originalText: line,
      });
    }
  }

  return {
    segments,
    respondents: [{ sourceFile: filename, speakerId: "speaker_1", displayName: "speaker_1" }],
  };
}

/**
 * CSV 文件解析
 * 期望列：speaker_id, speaker_role, preceding_question, original_text
 * 或简单的单列文本
 */
function parseCsvFile(buffer: Buffer, filename: string): ParseResult {
  const text = buffer.toString("utf-8");
  const workbook = XLSX.read(text, { type: "string" });
  return parseSheetToSegments(workbook, filename);
}

/**
 * 把表格（CSV/XLSX 共用的 sheet）解析为结构化片段
 */
function parseSheetToSegments(
  workbook: XLSX.WorkBook,
  filename: string,
): ParseResult {
  const sheet = workbook.Sheets[workbook.SheetNames[0]!];
  if (!sheet) return { segments: [], respondents: [] };

  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
  if (rows.length === 0) return { segments: [], respondents: [] };

  const segments: RawSegment[] = [];
  const respondentSet = new Map<string, { sourceFile: string; speakerId: string; displayName: string }>();

  // 检测列名
  const firstRow = rows[0]!;
  const keys = Object.keys(firstRow);
  const hasStructured =
    keys.some((k) => /speaker|说话人/i.test(k)) ||
    keys.some((k) => /original|原文|内容|发言/i.test(k));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;

    if (hasStructured) {
      const speakerId = findColumn(row, ["speaker_id", "说话人", "speaker", "发言人"]) || `speaker_${i + 1}`;
      const speakerRole = normalizeSpeakerRole(
        findColumn(row, ["speaker_role", "角色", "role"]) || "interviewee",
      );
      const precedingQuestion = findColumn(row, ["preceding_question", "提问", "question", "问题"]) || null;
      const originalText = findColumn(row, ["original_text", "原文", "内容", "发言", "text", "content"]) || "";

      if (originalText.trim().length > 0) {
        segments.push({
          sourceFile: filename,
          segmentIndex: segments.length + 1,
          speakerId,
          speakerRole,
          precedingQuestion,
          originalText: originalText.trim(),
        });

        if (!respondentSet.has(speakerId)) {
          respondentSet.set(speakerId, {
            sourceFile: filename,
            speakerId,
            displayName: speakerId,
          });
        }
      }
    } else {
      // 单列文本：第一列作为原文
      const values = Object.values(row).filter((v) => String(v).trim().length > 0);
      if (values.length > 0) {
        segments.push({
          sourceFile: filename,
          segmentIndex: segments.length + 1,
          speakerId: "speaker_1",
          speakerRole: "interviewee",
          precedingQuestion: null,
          originalText: String(values[0]).trim(),
        });
      }
    }
  }

  return {
    segments,
    respondents: Array.from(respondentSet.values()),
  };
}

/**
 * JSON 文件解析
 * 期望格式：对象数组，每个对象包含 speaker_id, speaker_role, preceding_question, original_text
 * 或已有的 segments 格式
 */
function parseJsonFile(buffer: Buffer, filename: string): ParseResult {
  const text = buffer.toString("utf-8");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { segments: [], respondents: [] };
  }

  // 支持多种 JSON 结构
  let items: Record<string, unknown>[] = [];
  if (Array.isArray(data)) {
    items = data as Record<string, unknown>[];
  } else if (typeof data === "object" && data !== null) {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.segments)) {
      items = d.segments as Record<string, unknown>[];
    } else if (Array.isArray(d.data)) {
      items = d.data as Record<string, unknown>[];
    } else if (Array.isArray(d.results)) {
      items = d.results as Record<string, unknown>[];
    } else {
      // 单个对象
      items = [d];
    }
  }

  const segments: RawSegment[] = [];
  const respondentSet = new Map<string, { sourceFile: string; speakerId: string; displayName: string }>();

  for (const item of items) {
    const speakerId = String(item.speaker_id ?? item.speakerId ?? item.speaker ?? `speaker_1`);
    const speakerRole = normalizeSpeakerRole(
      String(item.speaker_role ?? item.speakerRole ?? item.role ?? "interviewee"),
    );
    const precedingQuestion = item.preceding_question ?? item.precedingQuestion ?? item.question ?? null;
    const originalText = String(
      item.original_text ?? item.originalText ?? item.text ?? item.content ?? "",
    );

    if (originalText.trim().length > 0) {
      segments.push({
        sourceFile: filename,
        segmentIndex: segments.length + 1,
        speakerId,
        speakerRole,
        precedingQuestion: precedingQuestion ? String(precedingQuestion) : null,
        originalText: originalText.trim(),
      });

      if (!respondentSet.has(speakerId)) {
        respondentSet.set(speakerId, {
          sourceFile: filename,
          speakerId,
          displayName: speakerId,
        });
      }
    }
  }

  return {
    segments,
    respondents: Array.from(respondentSet.values()),
  };
}

/**
 * DOCX 文件解析
 * 使用 mammoth 提取纯文本，然后按段落处理
 */
async function parseDocxFile(buffer: Buffer, filename: string): Promise<ParseResult> {
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value;

  if (!text.trim()) {
    return { segments: [], respondents: [] };
  }

  // 按段落分割
  const paragraphs = text
    .split(/\n\n+/)
    .map((p: string) => p.replace(/\n/g, " ").trim())
    .filter((p: string) => p.length > 0);

  const segments: RawSegment[] = [];
  let lastModeratorText: string | null = null;

  // 检测 QA 格式
  const qaPattern = /^(Q|问|提问|主持人|Moderator|Interviewer)[:：\s]/i;
  const answerPattern = /^(A|答|回答|受访者|Interviewee|Respondent)[:：\s]/i;
  // 说话人标记格式：SPEAKER_XX(timestamp): 或 说话人XX:
  const speakerTagPattern = /^(SPEAKER_\d+|说话人\d+|Speaker\s*\d+)[(（].*?[)）]?[:：]\s*/i;

  for (const para of paragraphs) {
    if (qaPattern.test(para)) {
      lastModeratorText = para.replace(qaPattern, "").trim();
    } else if (answerPattern.test(para)) {
      const answerText = para.replace(answerPattern, "").trim();
      if (answerText.length > 0) {
        segments.push({
          sourceFile: filename,
          segmentIndex: segments.length + 1,
          speakerId: "speaker_1",
          speakerRole: "interviewee",
          precedingQuestion: lastModeratorText,
          originalText: answerText,
        });
      }
    } else if (speakerTagPattern.test(para)) {
      const match = para.match(speakerTagPattern);
      const speakerId = match?.[1] ?? "speaker_1";
      const text = para.replace(speakerTagPattern, "").trim();
      if (text.length > 0) {
        // 判断角色：如果文本是提问形式，则为 moderator
        const isQuestion = /[?？]$/.test(text) || /^(大家|请|可以|能否|有没有|你觉得)/.test(text);
        if (isQuestion) {
          lastModeratorText = text;
        } else {
          segments.push({
            sourceFile: filename,
            segmentIndex: segments.length + 1,
            speakerId,
            speakerRole: "interviewee",
            precedingQuestion: lastModeratorText,
            originalText: text,
          });
        }
      }
    } else {
      // 普通段落
      segments.push({
        sourceFile: filename,
        segmentIndex: segments.length + 1,
        speakerId: "speaker_1",
        speakerRole: "interviewee",
        precedingQuestion: lastModeratorText,
        originalText: para,
      });
      lastModeratorText = null;
    }
  }

  return {
    segments,
    respondents: [{ sourceFile: filename, speakerId: "speaker_1", displayName: "speaker_1" }],
  };
}

/**
 * XLSX 文件解析
 * 与 CSV 共用 parseSheetToSegments，仅读取方式不同
 */
async function parseXlsxFile(buffer: Buffer, filename: string): Promise<ParseResult> {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  return parseSheetToSegments(workbook, filename);
}

/**
 * PDF 文件解析
 * 使用 pdf-parse 提取文本，然后按段落分割
 */
async function parsePdfFile(buffer: Buffer, filename: string): Promise<ParseResult> {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  const text = result.text;

  if (!text.trim()) {
    return { segments: [], respondents: [] };
  }

  // 按段落分割（双换行或单换行后跟缩进）
  const paragraphs = text
    .split(/\n\n+/)
    .map((p: string) => p.replace(/\n/g, " ").trim())
    .filter((p: string) => p.length > 0);

  const segments: RawSegment[] = [];

  for (const para of paragraphs) {
    // 跳过页码、页眉等
    if (/^\d+$/.test(para)) continue;
    if (para.length < 5) continue;

    segments.push({
      sourceFile: filename,
      segmentIndex: segments.length + 1,
      speakerId: "speaker_1",
      speakerRole: "interviewee",
      precedingQuestion: null,
      originalText: para,
    });
  }

  return {
    segments,
    respondents: [{ sourceFile: filename, speakerId: "speaker_1", displayName: "speaker_1" }],
  };
}

// ---- 工具函数 ----

function findColumn(row: Record<string, string>, candidates: string[]): string | undefined {
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const match = keys.find(
      (k) =>
        k.toLowerCase() === candidate.toLowerCase() ||
        k.includes(candidate),
    );
    if (match) {
      const val = row[match];
      if (val && val.trim().length > 0) return val.trim();
    }
  }
  return undefined;
}

function normalizeSpeakerRole(role: string): "interviewee" | "moderator" {
  const r = role.toLowerCase().trim();
  if (r === "moderator" || r === "主持人" || r === "interviewer" || r === "mod") {
    return "moderator";
  }
  return "interviewee";
}