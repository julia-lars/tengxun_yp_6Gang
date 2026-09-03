// 顶部操作栏 — 新建访谈、导入访谈、AI生成访谈按钮 + 当前大纲信息
import type { InterviewOutline } from "@app/shared";
import { Download, FileText, Import, Play, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type ConfigPanel = "none" | "generate" | "manual";

interface TopActionBarProps {
  configPanel: ConfigPanel;
  onToggleConfig: (panel: ConfigPanel) => void;
  onOpenImport: () => void;
  activeOutline: InterviewOutline | null;
  onExportExcel: () => void;
  onBatchInterview: () => void;
}

export function TopActionBar({
  configPanel,
  onToggleConfig,
  onOpenImport,
  activeOutline,
  onExportExcel,
  onBatchInterview,
}: TopActionBarProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <Button
          variant={configPanel === "manual" ? "default" : "outline"}
          size="sm"
          onClick={() =>
            onToggleConfig(configPanel === "manual" ? "none" : "manual")
          }
          className="text-xs"
        >
          <FileText className="h-3.5 w-3.5 mr-1.5" />
          新建访谈
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenImport}
          className="text-xs"
        >
          <Import className="h-3.5 w-3.5 mr-1.5" />
          导入访谈
        </Button>
        <Button
          variant={configPanel === "generate" ? "default" : "outline"}
          size="sm"
          onClick={() =>
            onToggleConfig(configPanel === "generate" ? "none" : "generate")
          }
          className="text-xs"
        >
          <Sparkles className="h-3.5 w-3.5 mr-1.5" />
          AI生成访谈
        </Button>
      </div>

      {activeOutline && (
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <Wand2 className="h-3.5 w-3.5 text-(--color-brand-500) flex-shrink-0" />
            <span className="text-sm text-(--color-content-secondary) truncate max-w-[300px]">
              {activeOutline.theme}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={onExportExcel}
              title="导出为 Excel"
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              导出Excel
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={onBatchInterview}
            >
              <Play className="h-3 w-3 mr-1" />
              批量访谈
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}