// 证据溯源卡片 — 内联展开式，简洁展示原文与来源
import { Copy, FileText, User } from "lucide-react";
import { cn } from "@/lib/utils";
interface EvidenceCardProps {
  id: number;
  sourceFile: string;
  originalText: string;
  annotation?: Record<string, unknown> | null;
  speakerId?: string;
  /** 该条发言对应的上一条主持人的提问（语境还原） */
  precedingQuestion?: string | null;
  confidence?: number;
  /** 向量相似度 (0-1) */
  similarity?: number;
  /** 证据等级 */
  matchLevel?: "direct" | "partial" | "inferred";
  /** LLM 判断的匹配理由（证据-回答相关性） */
  relevanceReason?: string | null;
  /** LLM 判断的相关性分数（0-1），独立于向量相似度 */
  relevanceScore?: number | null;
  isActive?: boolean;
  onCopy?: () => void;
  onClick?: (id: number) => void;
  className?: string;
}

const matchLevelLabel: Record<string, string> = {
  direct: "直引",
  partial: "部分关联",
  inferred: "推断",
};

export function EvidenceCard({
  id,
  sourceFile,
  originalText,
  annotation,
  speakerId,
  precedingQuestion,
  similarity,
  matchLevel,
  relevanceReason,
  relevanceScore,
  isActive,
  onCopy,
  onClick,
  className,
}: EvidenceCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3 space-y-2 transition-all text-sm",
        isActive
          ? "border-(--color-primary) bg-(--color-primary)/5"
          : "border-(--color-border) bg-(--color-card)",
        className,
      )}
    >
      {/* 前置问题 */}
      {precedingQuestion && (
        <div className="text-xs text-(--color-muted-foreground) bg-(--color-muted)/30 rounded px-2 py-1.5 leading-relaxed">
          <span className="font-medium">问题：</span>{precedingQuestion}
        </div>
      )}

      {/* 原文引用 */}
      <blockquote className="leading-relaxed border-l-2 border-(--color-border) pl-3 py-1 text-(--color-foreground)">
        {originalText}
      </blockquote>

      {/* 元信息 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-(--color-muted-foreground)">
        <span className="flex items-center gap-1">
          <FileText className="h-3 w-3" /> {sourceFile}
        </span>
        {speakerId && (
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" /> {speakerId}
          </span>
        )}
        {matchLevel && (
          <span>{matchLevelLabel[matchLevel] ?? matchLevel}</span>
        )}
        {similarity !== undefined && (
          <span>相关 {Math.round(similarity * 100)}%</span>
        )}
      </div>

      {/* 相关性理由 */}
      {relevanceReason && (
        <div className="text-xs text-(--color-muted-foreground) bg-(--color-muted)/20 rounded px-2 py-1 leading-relaxed">
          <span className="font-medium">支撑理由：</span>{relevanceReason}
        </div>
      )}

      {/* 操作 */}
      <div className="flex items-center gap-3">
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
            className="text-xs text-(--color-muted-foreground) hover:text-(--color-primary) flex items-center gap-1 transition-colors"
          >
            <Copy className="h-3 w-3" /> 复制引用
          </button>
        )}
        {onClick && (
          <button
            type="button"
            onClick={() => onClick(id)}
            className="text-xs text-(--color-brand-500) hover:underline"
          >
            定位句子
          </button>
        )}
      </div>
    </div>
  );
}