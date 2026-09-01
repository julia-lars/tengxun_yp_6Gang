// 批量操作浮栏 — 选中行后底部浮现的操作栏
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BatchActionBarProps {
  selectedCount: number;
  onBatchDelete: () => void;
  onClearSelection: () => void;
  deleting?: boolean;
}

export function BatchActionBar({
  selectedCount,
  onBatchDelete,
  onClearSelection,
  deleting,
}: BatchActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 flex justify-center pb-4 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-4 px-5 py-3 bg-white border border-neutral-300 rounded-xl shadow-lg">
        <span className="text-sm font-medium text-(--color-content-primary)">
          已选 <span className="text-blue-600 font-semibold">{selectedCount}</span> 条
        </span>
        <Button
          variant="destructive"
          size="sm"
          className="gap-1.5"
          onClick={onBatchDelete}
          disabled={deleting}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {deleting ? "删除中..." : "批量删除"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          onClick={onClearSelection}
          disabled={deleting}
        >
          <X className="h-3.5 w-3.5" />
          取消选择
        </Button>
      </div>
    </div>
  );
}