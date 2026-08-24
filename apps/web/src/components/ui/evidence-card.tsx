// 证据溯源卡片 — 内联展开式，简洁展示原文与来源
import { Copy, FileText, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "./badge";

interface EvidenceCardProps {
  id: number;
  sourceFile: string;
  originalText: string;
  annotation?: Record<string, unknown> | null;
  speakerId?: string;
  confidence?: number;
  /** 向量相似度 (0-1) */
  similarity?: number;
  /** 证据等级 */
  matchLevel?: "direct" | "partial" | "inferred";
  isActive?: boolean;
  onCopy?: () => void;
  className?: string;
}

const matchLevelLabel: Record<string, string> = {
  direct: "直引",
  partial: "部分关联",
  inferred: "推断",
};

export function EvidenceCard({
  sourceFile,
  originalText,
  annotation,
  speakerId,
  similarity,
  matchLevel,
  isActive,
  onCopy,
  className,
}: EvidenceCardProps) {
  const iceberg = (annotation as Record<string, unknown>)?.iceberg as
    | Record<string, string[]>
    | undefined;

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
      {/* 原文引用 */}
      <blockquote className="leading-relaxed border-l-2 border-(--color-border) pl-3 py-1 text-(--color-foreground)">
        {originalText}
      </blockquote>

      {/* 冰山标签 */}
      {iceberg && Object.keys(iceberg).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(iceberg).map(([key, vals]) =>
            (Array.isArray(vals) ? vals : [vals]).map((v) => (
              <Badge key={`${key}-${v}`} variant="secondary" className="text-[10px]">
                {key}: {v}
              </Badge>
            )),
          )}
        </div>
      )}

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
          <span>匹配 {Math.round(similarity * 100)}%</span>
        )}
      </div>

      {/* 操作 */}
      {onCopy && (
        <button
          type="button"
          onClick={onCopy}
          className="text-xs text-(--color-muted-foreground) hover:text-(--color-primary) flex items-center gap-1 transition-colors"
        >
          <Copy className="h-3 w-3" /> 复制引用
        </button>
      )}
    </div>
  );
}