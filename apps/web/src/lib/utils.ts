// --------------------------------------------------------------
// cn = classnames merge —— shadcn 生态标配的类名合并工具
// - clsx 处理"条件类名"：cn("base", condition && "extra")
// - twMerge 处理"冲突类名"：cn("p-2", "p-4") 结果只保留 p-4
// 组合起来 = 写 UI 组件时最舒服的类名 API
// --------------------------------------------------------------

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 把课程/章节序号补零到 2 位 —— 元培古典风的编号样式
 * formatIndex(0) → "00"，formatIndex(7) → "07"，formatIndex(12) → "12"
 */
export function formatIndex(n: number) {
  return String(n).padStart(2, "0");
}

/**
 * 格式化剩余时间（毫秒）为可读字符串
 * formatRemainingTime(65000)  → "预计剩余 1 分 5 秒"
 * formatRemainingTime(30000)  → "预计剩余 30 秒"
 * formatRemainingTime(0)      → "处理中..."
 * formatRemainingTime(undefined) → "处理中..."
 */
export function formatRemainingTime(ms?: number): string {
  if (ms === undefined || ms === null || ms <= 0) return "处理中...";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `预计剩余 ${minutes} 分 ${seconds} 秒`;
  }
  return `预计剩余 ${seconds} 秒`;
}
