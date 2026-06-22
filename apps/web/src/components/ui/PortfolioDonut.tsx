"use client";

const C = 2 * Math.PI * 40; // circumference for r=40

export interface DonutSegment {
  proportion: number;
  color: string;
  label: string;
  amount: string;
}

interface Props {
  segments: DonutSegment[];
  centerValue: string;
  centerSub: string;
  size?: number;
  isLoading?: boolean;
  showLegend?: boolean;
}

export function PortfolioDonut({ segments, centerValue, centerSub, size = 108, isLoading, showLegend = true }: Props) {
  if (isLoading) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div style={{ width: size, height: size }} className="rounded-full animate-pulse bg-foreground/10" />
        {showLegend && (
          <div className="flex gap-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-8 w-14 animate-pulse rounded-lg bg-foreground/10" />
            ))}
          </div>
        )}
      </div>
    );
  }

  const gap = 3;
  const valueFontSize = centerValue.length <= 6 ? 13 : centerValue.length <= 9 ? 10.5 : 8.5;

  const segmentData = segments.reduce<Array<DonutSegment & { start: number; arcLen: number }>>(
    (arr, seg) => {
      const prev = arr.at(-1);
      const start = prev ? prev.start + prev.proportion : 0;
      return [...arr, { ...seg, start, arcLen: Math.max(0, seg.proportion * C - gap) }];
    },
    []
  );

  return (
    <div className="flex flex-col items-center gap-3">
      <svg width={size} height={size} viewBox="0 0 100 100">
        <g transform="rotate(-90 50 50)">
          {/* Background track */}
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="12"
          />
          {segmentData.map((seg, i) => {
            const { start, arcLen } = seg;
            if (arcLen <= 0) return null;
            return (
              <circle
                key={i}
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke={seg.color}
                strokeWidth="12"
                strokeDasharray={`${arcLen} ${C}`}
                strokeDashoffset={C * (1 - start)}
                strokeLinecap="butt"
              />
            );
          })}
        </g>
        {/* Center value */}
        <text
          x="50"
          y="44"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={valueFontSize}
          fontWeight="600"
          fill="currentColor"
          style={{ fontFamily: "inherit" }}
        >
          {centerValue}
        </text>
        {/* Center sub-label */}
        <text
          x="50"
          y="57"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="6"
          fill="rgba(255,255,255,0.4)"
          style={{ fontFamily: "monospace", letterSpacing: "0.1em" }}
        >
          {centerSub.toUpperCase()}
        </text>
      </svg>

      {/* Legend (horizontal, compact) */}
      {showLegend && (
        <div className="flex items-start gap-5">
          {segments.map((seg, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5">
              <div className="flex items-center gap-1">
                <div
                  className="shrink-0 rounded-full"
                  style={{ width: 6, height: 6, backgroundColor: seg.color }}
                />
                <span className="font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {seg.label}
                </span>
              </div>
              <span className="font-mono text-[10px] font-semibold text-foreground">
                {seg.amount}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
