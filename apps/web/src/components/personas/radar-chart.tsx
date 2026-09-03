// 五维雷达图 — 纯 SVG 实现，不引入图表库
import { useState } from "react";
import { cn } from "@/lib/utils";

interface Dimension {
  label: string;
  value: number; // 0-1
}

interface RadarChartProps {
  dimensions: Dimension[];
  averages?: Dimension[];
  className?: string;
}

/** 维度名 → 颜色 */
const DIM_COLORS: Record<string, string> = {
  "诉求": "var(--color-dim-needs)",
  "能力": "var(--color-dim-ability)",
  "风格": "var(--color-dim-style)",
  "平台": "var(--color-dim-platform)",
  "模式": "var(--color-dim-mode)",
};

const DIM_LABELS: Record<string, string> = {
  "诉求": "游戏诉求",
  "能力": "游戏能力",
  "风格": "游戏风格",
  "平台": "平台偏好",
  "模式": "游戏模式",
};

const SIZE = 300;
const CENTER = SIZE / 2;
const RADIUS = 100; // 五边形外接圆半径
const LEVELS = 5; // 刻度圈数

/** 计算五边形顶点坐标（从顶部顺时针） */
function pentagonPoints(cx: number, cy: number, r: number): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i < 5; i++) {
    // 从顶部 (-90°) 开始，顺时针
    const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    points.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  return points;
}

/** 构建 SVG path d 属性 */
function buildPath(points: [number, number][]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ") + " Z";
}

export function RadarChart({ dimensions, averages, className }: RadarChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (dimensions.length === 0) return null;

  const gridPoints = pentagonPoints(CENTER, CENTER, RADIUS);

  // 数据多边形顶点
  const dataPoints = pentagonPoints(CENTER, CENTER, RADIUS).map((p, i) => {
    const v = dimensions[i]?.value ?? 0;
    const dx = p[0] - CENTER;
    const dy = p[1] - CENTER;
    return [CENTER + dx * v, CENTER + dy * v] as [number, number];
  });

  // 均值多边形顶点
  const avgPoints = averages
    ? pentagonPoints(CENTER, CENTER, RADIUS).map((p, i) => {
        const v = averages[i]?.value ?? 0;
        const dx = p[0] - CENTER;
        const dy = p[1] - CENTER;
        return [CENTER + dx * v, CENTER + dy * v] as [number, number];
      })
    : null;

  return (
    <div className={cn("relative", className)}>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full h-auto max-w-[260px] mx-auto"
        role="img"
        aria-label="五维画像雷达图"
      >
        {/* 刻度网格 */}
        {Array.from({ length: LEVELS }, (_, level) => {
          const r = (RADIUS / LEVELS) * (level + 1);
          const pts = pentagonPoints(CENTER, CENTER, r);
          return (
            <polygon
              key={level}
              points={pts.map((p) => `${p[0]},${p[1]}`).join(" ")}
              fill="none"
              stroke="var(--color-border-default)"
              strokeWidth="0.5"
              opacity={level === LEVELS - 1 ? 1 : 0.4}
            />
          );
        })}

        {/* 轴线（中心到顶点） */}
        {gridPoints.map((p, i) => (
          <line
            key={i}
            x1={CENTER}
            y1={CENTER}
            x2={p[0]}
            y2={p[1]}
            stroke="var(--color-border-default)"
            strokeWidth="0.5"
            opacity={0.5}
          />
        ))}

        
        {/* 均值多边形（虚线） */}
        {avgPoints && (
          <polygon
            points={avgPoints.map((p) => `${p[0]},${p[1]}`).join(" ")}
            fill="var(--color-neutral-300)"
            fillOpacity="0.15"
            stroke="var(--color-neutral-400)"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
        )}

        {/* 数据多边形 */}
        <polygon
          points={dataPoints.map((p) => `${p[0]},${p[1]}`).join(" ")}
          fill="var(--color-brand-500)"
          fillOpacity="0.18"
          stroke="var(--color-brand-500)"
          strokeWidth="2"
          strokeLinejoin="round"
        />

        {/* 数据顶点圆点 + 悬停区 */}
        {dataPoints.map((p, i) => {
          const dim = dimensions[i];
          if (!dim) return null;
          return (
            <g key={i}>
              <circle
                cx={p[0]}
                cy={p[1]}
                r="4"
                fill="var(--color-brand-500)"
                stroke="white"
                strokeWidth="1.5"
                className="cursor-pointer transition-transform duration-150 hover:scale-125"
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
              />
              {/* 透明大圆 — 扩大悬停区域 */}
              <circle
                cx={p[0]}
                cy={p[1]}
                r="16"
                fill="transparent"
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
              />
            </g>
          );
        })}

        {/* 维度标签 */}
        {gridPoints.map((p, i) => {
          const dim = dimensions[i];
          if (!dim) return null;
          const dx = p[0] - CENTER;
          const dy = p[1] - CENTER;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const nx = dx / dist;
          const ny = dy / dist;
          const labelR = RADIUS + 22;
          const lx = CENTER + nx * labelR;
          const ly = CENTER + ny * labelR + 4; // 垂直微调
          const anchor =
            Math.abs(nx) < 0.15 ? "middle" : nx > 0 ? "start" : "end";
          const pct = Math.round(dim.value * 100);

          return (
            <g key={i}>
              <text
                x={lx}
                y={ly}
                textAnchor={anchor}
                className="fill-neutral-600 text-[11px] font-medium"
              >
                {dim.label}
              </text>
              <text
                x={lx}
                y={ly + 14}
                textAnchor={anchor}
                className="fill-(--color-brand-600) text-[10px] font-semibold"
              >
                {pct}%
              </text>
            </g>
          );
        })}
      </svg>

      {/* 悬停 Tooltip */}
      {hoveredIdx !== null && dimensions[hoveredIdx] && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10">
          <div className="bg-white border border-(--color-border) rounded-lg shadow-lg px-3 py-2 text-center">
            <p className="text-xs font-medium text-(--color-content-secondary)">
              {DIM_LABELS[dimensions[hoveredIdx]!.label] ?? dimensions[hoveredIdx]!.label}
            </p>
            <p className="text-sm font-bold text-(--color-brand-600)">
              {Math.round(dimensions[hoveredIdx]!.value * 100)}%
            </p>
            {averages?.[hoveredIdx] != null && (
              <p className="text-[10px] text-(--color-content-tertiary)">
                均值 {Math.round(averages[hoveredIdx]!.value * 100)}%
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}