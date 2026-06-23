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

  const valueFontSize = centerValue.length <= 6 ? 13 : centerValue.length <= 9 ? 10.5 : 8.5;

  const activeSegments = segments.filter((s) => s.proportion > 0);
  const gap = activeSegments.length > 1 ? 3 : 0;

  const segmentData = activeSegments.reduce<Array<DonutSegment & { start: number; arcLen: number }>>(
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
          {/* Background track — only when no active segments (empty/loading state) */}
          {activeSegments.length === 0 && (
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke="var(--foreground)"
              strokeOpacity="0.07"
              strokeWidth="12"
            />
          )}
          {segmentData.map((seg, i) => {
            const { start, arcLen } = seg;
            if (arcLen <= 0) return null;
            // Single active segment: arcLen = C causes the entire circle to fall in the
            // dasharray "skip" zone (offset=C puts us at the exact gap boundary).
            // Render as a plain circle instead — true 360°, no dasharray needed.
            if (activeSegments.length === 1) {
              return (
                <circle
                  key={i}
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  stroke={seg.color}
                  strokeWidth="12"
                />
              );
            }
            return (
              <circle
                key={i}
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke={seg.color}
                strokeWidth="12"
                strokeDasharray={`${arcLen} ${C - arcLen}`}
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
          fill="var(--muted-foreground)"
          style={{ fontFamily: "monospace", letterSpacing: "0.1em" }}
        >
          {centerSub.toUpperCase()}
        </text>
      </svg>

      {/* Legend (horizontal, compact) */}
      {showLegend && (
        <div className="flex items-start gap-5">
          {segments.filter((s) => s.proportion > 0).map((seg, i) => (
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
