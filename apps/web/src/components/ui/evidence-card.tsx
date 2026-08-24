// 证据溯源卡片 — 用于侧栏展示

import { Copy, FileText, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "./badge";
import { ConfidenceIndicator } from "./confidence-indicator";

interface EvidenceCardProps {
  id: number;
  sourceFile: string;
  originalText: string;
  annotation?: Record<string, unknown> | null;
  speakerId?: string;
  confidence?: number;
  isActive?: boolean;
  onCopy?: () => void;
  className?: string;
}

export function EvidenceCard({
  sourceFile,
  originalText,
  annotation,
  speakerId,
  confidence = 0.85,
  isActive,
  onCopy,
  className,
}: EvidenceCardProps) {
  const iceberg = (annotation as Record<string, unknown>)?.iceberg as
    | Record<string, string[]>
    | undefined;
  const framework = (annotation as Record<string, unknown>)?.framework as
    | Record<string, unknown>
    | undefined;

  return (
    <div
      className={cn(
        "rounded-lg border p-4 space-y-3 transition-all",
        isActive
          ? "border-(--color-primary) bg-(--color-primary)/5"
          : "border-(--color-border) bg-(--color-card)",
        className,
      )}
    >
      {/* 原文引用 */}
      <div>
        <p className="text-xs font-medium text-(--color-muted-foreground) mb-1 flex items-center gap-1">
          <FileText className="h-3 w-3" /> 原文引用
        </p>
        <blockquote className="text-sm text-(--color-foreground) leading-relaxed border-l-2 border-(--color-primary) pl-3 py-1">
          {originalText}
        </blockquote>
      </div>

      {/* 冰山标签 */}
      {iceberg && Object.keys(iceberg).length > 0 && (
        <div>
          <p className="text-xs font-medium text-(--color-muted-foreground) mb-1">冰山标签</p>
          <div className="flex flex-wrap gap-1">
            {Object.entries(iceberg).map(([key, vals]) =>
              (Array.isArray(vals) ? vals : [vals]).map((v) => (
                <Badge key={`${key}-${v}`} variant="secondary" className="text-[10px]">
                  {key}: {v}
                </Badge>
              )),
            )}
          </div>
        </div>
      )}

      {/* 元信息 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-(--color-muted-foreground)">
        <span className="flex items-center gap-1">
          <FileText className="h-3 w-3" /> {sourceFile}
        </span>
        {speakerId && (
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" /> {speakerId}
          </span>
        )}
        <ConfidenceIndicator score={confidence} size="sm" />
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
