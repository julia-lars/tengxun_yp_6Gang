// 导入访谈大纲对话框 — 支持 Excel/CSV/JSON 文件导入
import type { InterviewOutline, InterviewQuestion } from "@app/shared";
import {
  AlertCircle,
  Check,
  FileSpreadsheet,
  FileText,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Section = InterviewOutline["sections"][number];

interface ParsedOutline {
  theme: string;
  description: string;
  targetPersona?: string;
  sections: Section[];
}

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (outlines: ParsedOutline[]) => void;
}

export function ImportDialog({ open, onClose, onImport }: ImportDialogProps) {
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedOutline[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseFile = useCallback(async (file: File) => {
    setParsing(true);
    setError(null);
    setParsed(null);

    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      const buffer = await file.arrayBuffer();

      if (ext === "xlsx" || ext === "xls") {
        // ---- Excel 解析 ----
        const wb = XLSX.read(buffer, { type: "array" });
        const outlines: ParsedOutline[] = [];

        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName];
          if (!ws) continue;
          const rows = XLSX.utils.sheet_to_json(ws, {
            header: 1,
            defval: "",
          }) as unknown[][];

          if (rows.length < 2) continue;

          // 尝试解析为大纲格式（含表头的问题表格）
          const header = rows[0] as string[];
          const hasQuestionHeaders =
            header.some(
              (h) =>
                typeof h === "string" &&
                (h.includes("问题") || h.includes("question")),
            ) ||
            header.some(
              (h) =>
                typeof h === "string" &&
                (h.includes("类别") || h.includes("category")),
            );

          if (hasQuestionHeaders) {
            // 这是问题表格：每个 sheet 是一个章节
            const questions = parseQuestionRows(rows as unknown[][]);
            if (questions.length > 0) {
              outlines.push({
                theme: extractTheme(file.name, sheetName),
                description: `从 ${file.name} 导入的「${sheetName}」`,
                sections: [
                  {
                    title: sheetName,
                    purpose: "从文件导入",
                    durationMinutes: questions.length * 3,
                    questions,
                  },
                ],
              });
            }
          } else {
            // 非问题表格：尝试作为多章节大纲
            const sections = parseMultiSectionRows(rows);
            if (sections.length > 0) {
              outlines.push({
                theme: extractTheme(file.name, sheetName),
                description: `从 ${file.name} 导入`,
                sections,
              });
            }
          }
        }

        if (outlines.length === 0) {
          setError("未能从文件中解析出有效的大纲数据。请确保文件包含问题表格。");
        } else {
          setParsed(outlines);
        }
      } else if (ext === "csv") {
        // ---- CSV 解析 ----
        const text = new TextDecoder().decode(buffer);
        const wb = XLSX.read(text, { type: "string" });
        const firstSheetName = wb.SheetNames[0];
        if (!firstSheetName) {
          setError("CSV 文件为空");
          setParsing(false);
          return;
        }
        const firstSheet = wb.Sheets[firstSheetName];
        if (!firstSheet) {
          setError("无法读取 CSV 内容");
          setParsing(false);
          return;
        }
        const rows = XLSX.utils.sheet_to_json(firstSheet, {
          header: 1,
          defval: "",
        }) as unknown[][];

        const questions = parseQuestionRows(rows);
        if (questions.length === 0) {
          setError("未能在 CSV 文件中解析出有效的问题数据。");
        } else {
          setParsed([
            {
              theme: extractTheme(file.name, "CSV导入"),
              description: `从 ${file.name} 导入`,
              sections: [
                {
                  title: "导入的问题",
                  purpose: "从 CSV 文件导入",
                  durationMinutes: questions.length * 3,
                  questions,
                },
              ],
            },
          ]);
        }
      } else if (ext === "json") {
        // ---- JSON 解析 ----
        const text = new TextDecoder().decode(buffer);
        const data = JSON.parse(text);

        // 支持单个大纲或大纲数组
        const items = Array.isArray(data) ? data : [data];
        const outlines: ParsedOutline[] = [];

        for (const item of items) {
          if (item.sections && Array.isArray(item.sections)) {
            outlines.push({
              theme: item.theme || extractTheme(file.name, "JSON导入"),
              description: item.description || `从 ${file.name} 导入`,
              targetPersona: item.targetPersona,
              sections: item.sections.map((s: Record<string, unknown>) => ({
                title: String(s.title || ""),
                purpose: String(s.purpose || ""),
                durationMinutes: Number(s.durationMinutes) || 5,
                questions: Array.isArray(s.questions)
                  ? s.questions.map((q: Record<string, unknown>) => ({
                      id: String(q.id || `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
                      question: String(q.question || ""),
                      category: String(q.category || "行为"),
                      purpose: String(q.purpose || ""),
                      expectedInsight: String(q.expectedInsight || ""),
                      followUps: Array.isArray(q.followUps)
                        ? q.followUps.map(String)
                        : undefined,
                    }))
                  : [],
              })),
            });
          }
        }

        if (outlines.length === 0) {
          setError("JSON 文件格式不正确。需要包含 sections 数组。");
        } else {
          setParsed(outlines);
        }
      } else {
        setError(
          `不支持的文件格式: .${ext}。支持的格式: .xlsx, .xls, .csv, .json`,
        );
      }
    } catch (e) {
      setError(`文件解析失败: ${String(e)}`);
    } finally {
      setParsing(false);
    }
  }, []);

  const handleFileDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) parseFile(file);
    },
    [parseFile],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) parseFile(file);
    },
    [parseFile],
  );

  const handleImport = useCallback(() => {
    if (parsed && parsed.length > 0) {
      onImport(parsed);
      onClose();
      setParsed(null);
      setError(null);
    }
  }, [parsed, onImport, onClose]);

  const handleReset = useCallback(() => {
    setParsed(null);
    setError(null);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-(--color-border-default)">
          <h3 className="text-lg font-medium text-(--color-content-primary)">
            导入访谈大纲
          </h3>
          <button
            type="button"
            className="p-1 rounded-md hover:bg-(--color-surface-secondary) transition-colors"
            onClick={onClose}
          >
            <X className="h-5 w-5 text-(--color-content-tertiary)" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-6">
          {parsing ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 text-(--color-brand-500) animate-spin mb-3" />
              <p className="text-sm text-(--color-content-secondary)">
                正在解析文件...
              </p>
            </div>
          ) : error ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-lg bg-red-50 border border-red-200">
                <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-700">解析失败</p>
                  <p className="text-xs text-red-600 mt-1">{error}</p>
                </div>
              </div>
              <Button variant="outline" className="w-full" onClick={handleReset}>
                重新选择文件
              </Button>
            </div>
          ) : parsed ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-green-600">
                <Check className="h-4 w-4" />
                成功解析 {parsed.length} 个大纲
              </div>

              {/* 预览 */}
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {parsed.map((outline, oi) => (
                  <div
                    key={oi}
                    className="p-3 rounded-lg bg-(--color-surface-secondary) border border-(--color-border-default)"
                  >
                    <p className="text-sm font-medium text-(--color-content-primary)">
                      {outline.theme}
                    </p>
                    <p className="text-xs text-(--color-content-secondary) mt-0.5">
                      {outline.description}
                    </p>
                    <div className="mt-2 space-y-1">
                      {outline.sections.map((section, si) => (
                        <div
                          key={si}
                          className="text-xs text-(--color-content-tertiary)"
                        >
                          · {section.title} ({section.questions.length} 个问题)
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 pt-2">
                <Button variant="outline" onClick={handleReset}>
                  重新选择
                </Button>
                <Button className="flex-1" onClick={handleImport}>
                  <Check className="h-4 w-4 mr-1.5" />
                  确认导入
                </Button>
              </div>
            </div>
          ) : (
            <div>
              {/* 拖拽上传区域 */}
              <div
                className={cn(
                  "border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer",
                  dragOver
                    ? "border-(--color-brand-400) bg-(--color-brand-50)"
                    : "border-(--color-border-default) hover:border-(--color-brand-300)",
                )}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") fileInputRef.current?.click();
                }}
                role="button"
                tabIndex={0}
              >
                <Upload className="h-10 w-10 mx-auto text-(--color-content-tertiary) mb-3" />
                <p className="text-sm font-medium text-(--color-content-primary)">
                  拖拽文件到此处，或点击选择文件
                </p>
                <p className="text-xs text-(--color-content-tertiary) mt-2">
                  支持 .xlsx、.xls、.csv、.json 格式
                </p>
              </div>

              {/* 格式说明 */}
              <div className="mt-6 space-y-3">
                <p className="text-xs font-medium text-(--color-content-secondary)">
                  支持的格式说明：
                </p>
                <div className="grid gap-3">
                  <FormatCard
                    icon={<FileSpreadsheet className="h-4 w-4" />}
                    title="Excel (.xlsx/.xls)"
                    desc="每个 Sheet 为一个章节，第一行为表头（序号、问题、类别、目的、预期洞察、追问建议），后续行为问题数据。"
                  />
                  <FormatCard
                    icon={<FileText className="h-4 w-4" />}
                    title="CSV (.csv)"
                    desc="与 Excel 格式相同，第一行为表头，后续行为问题数据。所有问题导入为一个章节。"
                  />
                  <FormatCard
                    icon={<FileText className="h-4 w-4" />}
                    title="JSON (.json)"
                    desc='{ "theme": "...", "sections": [{ "title": "...", "questions": [{ "question": "...", ... }] }] }'
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv,.json"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>
    </div>
  );
}

/** 格式说明卡片 */
function FormatCard({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-(--color-surface-secondary)">
      <div className="flex-shrink-0 mt-0.5 text-(--color-brand-500)">{icon}</div>
      <div>
        <p className="text-xs font-medium text-(--color-content-primary)">
          {title}
        </p>
        <p className="text-[10px] text-(--color-content-tertiary) mt-0.5">
          {desc}
        </p>
      </div>
    </div>
  );
}

// ---- 解析工具函数 ----

/** 从问题表格行解析 InterviewQuestion 列表 */
function parseQuestionRows(rows: unknown[][]): InterviewQuestion[] {
  if (rows.length < 2) return [];

  const headerRow = rows[0] as string[];
  const colMap = mapColumns(headerRow);

  const questions: InterviewQuestion[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as string[];
    const question = getCell(row, colMap, ["question", "问题", "问题内容"]);
    if (!question || !question.trim()) continue;

    questions.push({
      id: `q-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 4)}`,
      question: question.trim(),
      category: getCell(row, colMap, ["category", "类别", "问题类别"]) || "行为",
      purpose: getCell(row, colMap, ["purpose", "目的", "问题目的"]) || "",
      expectedInsight:
        getCell(row, colMap, ["expectedInsight", "预期洞察", "洞察"]) || "",
      followUps: parseFollowUps(
        getCell(row, colMap, ["followUps", "追问", "追问建议"]),
      ),
    });
  }

  return questions;
}

/** 尝试解析多章节结构（非标准格式） */
function parseMultiSectionRows(rows: unknown[][]): Section[] {
  // 寻找章节标记行（包含"章节"或"section"的行）
  const sections: Section[] = [];
  let currentSection: Section | null = null;
  let questions: InterviewQuestion[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as string[];
    const firstCell = String(row[0] || "").trim();

    // 检测章节标题行
    if (
      firstCell.includes("章节") ||
      firstCell.includes("section") ||
      firstCell.match(/^第[一二三四五六七八九十\d]+[章节部分]/)
    ) {
      // 保存上一个章节
      if (currentSection && questions.length > 0) {
        currentSection.questions = questions;
        sections.push(currentSection);
      }
      currentSection = {
        title: firstCell,
        purpose: String(row[1] || "").trim() || "",
        durationMinutes: 5,
        questions: [],
      };
      questions = [];
      continue;
    }

    // 检测问题行
    const questionText = firstCell || String(row[1] || "").trim();
    if (questionText && questionText.length > 3 && !questionText.match(/^[#\s]/)) {
      questions.push({
        id: `q-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 4)}`,
        question: questionText,
        category: String(row[2] || "行为").trim() || "行为",
        purpose: String(row[3] || "").trim() || "",
        expectedInsight: String(row[4] || "").trim() || "",
        followUps: parseFollowUps(String(row[5] || "").trim()),
      });
    }
  }

  // 保存最后一个章节
  if (currentSection && questions.length > 0) {
    currentSection.questions = questions;
    sections.push(currentSection);
  }

  // 如果没有检测到章节，将整个 sheet 作为一个章节
  if (sections.length === 0 && questions.length > 0) {
    sections.push({
      title: "导入的问题",
      purpose: "从文件导入",
      durationMinutes: questions.length * 3,
      questions,
    });
  }

  return sections;
}

/** 映射列名到列索引 */
function mapColumns(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((h, i) => {
    if (h && typeof h === "string") {
      map[h.trim().toLowerCase()] = i;
    }
  });
  return map;
}

/** 从列映射中获取单元格值 */
function getCell(
  row: string[],
  colMap: Record<string, number>,
  keys: string[],
): string {
  for (const key of keys) {
    const idx = colMap[key];
    if (idx !== undefined && idx < row.length) {
      const val = row[idx];
      if (val !== null && val !== undefined && String(val).trim() !== "") {
        return String(val);
      }
    }
  }
  return "";
}

/** 解析追问（分号、换行或逗号分隔） */
function parseFollowUps(raw: string | undefined): string[] | undefined {
  if (!raw || !raw.trim()) return undefined;
  const items = raw
    .split(/[；;\n,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/** 从文件名提取主题 */
function extractTheme(fileName: string, sheetName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  return sheetName && sheetName !== "Sheet1" ? `${base} - ${sheetName}` : base;
}