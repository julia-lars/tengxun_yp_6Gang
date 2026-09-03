// 大纲导出工具 — Excel 格式导出
import type { InterviewOutline } from "@app/shared";
import * as XLSX from "xlsx";

/**
 * 将访谈大纲导出为 Excel 文件并触发下载
 * 结构：
 *   Sheet 1 "概览" — 主题、描述、目标画像、统计信息
 *   后续每个 Sheet 对应一个章节 — 问题明细表格
 */
export function exportOutlineToExcel(outline: InterviewOutline): void {
  const wb = XLSX.utils.book_new();

  // ---- Sheet 1: 概览 ----
  const overviewData = [
    ["访谈大纲", outline.theme],
    ["描述", outline.description || ""],
    ["目标画像", outline.targetPersona || "通用"],
    ["总时长（分钟）", outline.totalDurationMinutes],
    ["章节数", outline.sections.length],
    [
      "总问题数",
      outline.sections.reduce((sum, s) => sum + s.questions.length, 0),
    ],
    ["创建时间", outline.createdAt],
  ];
  const overviewSheet = XLSX.utils.aoa_to_sheet(overviewData);
  // 设置列宽
  overviewSheet["!cols"] = [{ wch: 16 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, overviewSheet, "概览");

  // ---- 每个章节一个 Sheet ----
  for (let i = 0; i < outline.sections.length; i++) {
    const section = outline.sections[i]!;
    const sheetName = sanitizeSheetName(
      `${i + 1}-${section.title}`.slice(0, 31),
    );

    const headerRow = [
      "序号",
      "问题",
      "类别",
      "目的",
      "预期洞察",
      "追问建议",
    ];
    const dataRows = section.questions.map((q, qi) => [
      qi + 1,
      q.question,
      q.category,
      q.purpose,
      q.expectedInsight,
      q.followUps?.join("；") || "",
    ]);

    const sheetData = [
      [`章节: ${section.title}`],
      [`目的: ${section.purpose}`],
      [`时长: ${section.durationMinutes} 分钟`],
      [""],
      headerRow,
      ...dataRows,
    ];

    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws["!cols"] = [
      { wch: 6 },  // 序号
      { wch: 50 }, // 问题
      { wch: 10 }, // 类别
      { wch: 30 }, // 目的
      { wch: 40 }, // 预期洞察
      { wch: 40 }, // 追问建议
    ];
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  // 下载
  const fileName = `访谈大纲-${sanitizeFileName(outline.theme)}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

/** 清理 Sheet 名称中的非法字符 */
function sanitizeSheetName(name: string): string {
  return name.replace(/[\\/:*?[\]]/g, "_");
}

/** 清理文件名中的非法字符 */
function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 100);
}