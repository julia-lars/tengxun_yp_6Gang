// SessionCard — 对话会话卡片（首页 & 历史对话统一模板）
import { ArrowRight, MessageCircle, Trash2, Users } from "lucide-react";
import { Link } from "react-router";
import { Card, CardContent } from "@/components/ui/card";

interface SessionCardProps {
  id: number;
  type: "persona" | "kol";
  agentId: number;
  agentName?: string;
  title: string;
  preview: string;
  roundCount: number;
  time: string;
  chatPath: string;
  onDelete?: (e: React.MouseEvent, id: number, type: "persona" | "kol") => void;
}

export function SessionCard({
  id,
  type,
  agentName,
  agentId,
  title,
  preview,
  roundCount,
  time,
  chatPath,
  onDelete,
}: SessionCardProps) {
  const isPersona = type === "persona";
  const typeLabel = isPersona ? "画像" : "KOL";

  return (
    <Link to={chatPath} className="block group">
      <Card className="transition-all duration-200 hover:shadow-sm hover:border-(--color-brand-300)">
        <CardContent className="flex items-start gap-3 py-3 px-4">
          {/* 头像 */}
          <div className="w-10 h-10 rounded-xl bg-(--color-brand-50) flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-105">
            {isPersona ? (
              <Users className="h-5 w-5 text-(--color-brand-500)" />
            ) : (
              <MessageCircle className="h-5 w-5 text-(--color-brand-500)" />
            )}
          </div>

          {/* 内容区 */}
          <div className="flex-1 min-w-0">
            {/* 第一行：标题 + 画像名 + 类型 + 轮次时间（右移） */}
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-(--color-content-primary) truncate group-hover:text-(--color-brand-500) transition-colors">
                {title}
              </span>
              <span className="text-xs text-black flex-shrink-0">
                {agentName ?? `#${agentId}`}
              </span>
              <span className="flex items-center gap-1 text-xs text-black flex-shrink-0">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-(--color-brand-500)" />
                {typeLabel}
              </span>
              <span className="flex-1" />
              <span className="text-xs text-(--color-content-tertiary) flex-shrink-0">
                {roundCount} 轮 · {time}
              </span>
            </div>

            {/* 第二行：预览 + 删除 + 箭头（删除和箭头下移到轮次时间下方） */}
            <div className="flex items-center gap-2 mt-0.5">
              {preview ? (
                <p className="flex-1 text-xs text-(--color-content-tertiary) leading-relaxed line-clamp-1">
                  {preview}
                </p>
              ) : (
                <span className="flex-1" />
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={(e) => onDelete(e, id, type)}
                  className="flex-shrink-0 p-1 text-(--color-content-tertiary) hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                  title="删除对话"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              <ArrowRight className="h-4 w-4 flex-shrink-0 opacity-0 group-hover:opacity-100 text-(--color-brand-400) transition-all duration-200 group-hover:translate-x-0.5" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}