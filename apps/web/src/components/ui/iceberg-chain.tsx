// 冰山模型 M1→M5 可视化
import { cn } from "@/lib/utils";

interface IcebergLevel {
  key: string;
  label: string;
  content: string;
}

interface IcebergChainProps {
  chain: Record<string, unknown>;
  className?: string;
}

const LEVELS: { key: string; aliases: string[]; label: string }[] = [
  { key: "M1_motivation", aliases: [], label: "M1 动机" },
  { key: "M2_expectation", aliases: [], label: "M2 期待" },
  { key: "M3_cognition", aliases: ["M3_perception"], label: "M3 认知" },
  { key: "M4_feeling", aliases: [], label: "M4 感受" },
  { key: "M5_behavior", aliases: [], label: "M5 行为" },
];

/** 安全地从 chain 中获取字符串值 */
function getChainString(chain: Record<string, unknown>, key: string, aliases: string[]): string {
  // 先尝试主 key
  const val = chain[key];
  if (typeof val === "string" && val.trim().length > 0) return val;
  // 尝试别名
  for (const alias of aliases) {
    const aliasVal = chain[alias];
    if (typeof aliasVal === "string" && aliasVal.trim().length > 0) return aliasVal;
  }
  return "";
}

export function IcebergChain({ chain, className }: IcebergChainProps) {
  const items: IcebergLevel[] = LEVELS.map(({ key, aliases, label }) => ({
    key,
    label,
    content: getChainString(chain, key, aliases),
  }));

  if (items.every((item) => !item.content)) {
    return <p className="text-sm text-(--color-muted-foreground)">暂无动机链数据</p>;
  }

  return (
    <div className={cn("space-y-0", className)}>
      {items.map((item, i) => (
        <div key={item.key} className="flex gap-3">
          {/* 连接线 + 圆点 */}
          <div className="flex flex-col items-center pt-1">
            <div
              className={cn(
                "w-2.5 h-2.5 rounded-full border-2 flex-shrink-0",
                "border-(--color-primary) bg-(--color-primary)",
              )}
            />
            {i < items.length - 1 && (
              <div className="w-px flex-1 min-h-[16px] bg-(--color-border)" />
            )}
          </div>
          {/* 内容 */}
          <div className={cn("pb-3", i === items.length - 1 && "pb-0")}>
            <span className="text-xs font-semibold text-(--color-primary)">{item.label}</span>
            <p className="text-sm text-(--color-foreground) mt-0.5 leading-relaxed">
              {item.content || "（待标注）"}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
