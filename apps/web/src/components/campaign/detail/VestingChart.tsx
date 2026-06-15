"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";

type VestingChartProps = {
  releaseType: number;
  startTs: number;
  cliffTs: number;
  endTs: number;
  totalAmount: bigint;
  vestedAmount: bigint;
  cancelledAt?: number | null;
  milestoneCount?: number;
  formatAmount?: (raw: bigint) => string;
};

type TimeRange = "1d" | "1w" | "1m" | "1y" | "all";

const TIME_RANGES: { key: TimeRange; label: string; seconds: number }[] = [
  { key: "1d", label: "Daily", seconds: 86400 },
  { key: "1w", label: "Weekly", seconds: 604800 },
  { key: "1m", label: "Monthly", seconds: 2592000 },
  { key: "1y", label: "Yearly", seconds: 31536000 },
  { key: "all", label: "All", seconds: 0 },
];

function fmtPct(n: number): string {
  return n % 1 === 0 ? `${n}%` : `${n.toFixed(1)}%`;
}

function fmtDateFull(ts: number): string {
  const d = new Date(ts * 1000);
  const mon = d.toLocaleString("en", { month: "short" });
  return `${mon} ${d.getDate()}, ${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtDateShort(ts: number): { line1: string; line2: string } {
  const d = new Date(ts * 1000);
  const mon = d.toLocaleString("en", { month: "short" });
  return { line1: `${mon} ${d.getDate()}`, line2: `${d.getFullYear()}` };
}

function safePct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function pctBetween(start: number, current: number, end: number): number {
  const duration = end - start;
  if (duration <= 0) return current >= end ? 100 : 0;
  return safePct(((current - start) / duration) * 100);
}

function defaultFmtAmount(raw: bigint): string {
  if (raw === 0n) return "0";
  return raw.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function vestedPctAt(
  t: number,
  releaseType: number,
  startTs: number,
  cliffTs: number,
  endTs: number,
  cancelledAt: number | null,
  milestoneCount: number,
): number {
  const effectiveEnd = cancelledAt && cancelledAt < endTs ? cancelledAt : endTs;
  if (t <= startTs) return 0;

  if (releaseType === 0) {
    return t >= cliffTs ? 100 : 0;
  }
  if (releaseType === 1) {
    if (t <= cliffTs) return 0;
    if (t >= effectiveEnd) {
      return cancelledAt ? pctBetween(cliffTs, effectiveEnd, endTs) : 100;
    }
    const duration = endTs - cliffTs;
    return duration > 0 ? safePct(((t - cliffTs) / duration) * 100) : 0;
  }
  const steps = milestoneCount || 1;
  const stepPct = 100 / steps;
  const stepDuration = (effectiveEnd - startTs) / steps;
  let pct = 0;
  for (let i = 0; i < steps; i++) {
    const stepT = startTs + stepDuration * (i + 1);
    if (t >= stepT) pct = stepPct * (i + 1);
  }
  return Math.min(pct, 100);
}

function getSmartDefault(startTs: number, endTs: number, now: number): TimeRange {
  const totalDuration = endTs - startTs;
  const elapsed = now - startTs;
  if (totalDuration <= 86400 * 2) return "all";
  if (totalDuration <= 604800 * 2) return "all";
  if (elapsed < 0) return "all";
  if (elapsed <= 86400) return "1d";
  if (elapsed <= 604800) return "1w";
  if (elapsed <= 2592000) return "1m";
  return "all";
}

function getCompletedDefault(startTs: number, endTs: number): TimeRange {
  const totalDuration = endTs - startTs;
  if (totalDuration <= 86400 * 14) return "1d";
  if (totalDuration <= 86400 * 90) return "1w";
  if (totalDuration <= 86400 * 540) return "1m";
  return "1y";
}

function buildCurvePath(
  x: (t: number) => number,
  y: (pct: number) => number,
  releaseType: number,
  startTs: number,
  cliffTs: number,
  endTs: number,
  effectiveEnd: number,
  cancelledAt: number | null,
  milestoneCount: number,
  tMin: number,
): string {
  if (releaseType === 0) {
    return [
      `M${x(Math.max(tMin, startTs))},${y(0)}`,
      `L${x(cliffTs)},${y(0)}`,
      `L${x(cliffTs)},${y(100)}`,
      `L${x(effectiveEnd)},${y(100)}`,
    ].join(" ");
  }

  if (releaseType === 1) {
    const endPct = cancelledAt ? pctBetween(cliffTs, effectiveEnd, endTs) : 100;
    const hasCliff = cliffTs > startTs;

    if (!hasCliff) {
      const steps = 30;
      const pts: [number, number][] = [];
      for (let i = 0; i <= steps; i++) {
        const t = startTs + ((effectiveEnd - startTs) * i) / steps;
        const pct = ((t - startTs) / (endTs - startTs)) * endPct;
        pts.push([x(t), y(Math.min(safePct(pct), endPct))]);
      }
      return `M${pts.map((p) => `${p[0]},${p[1]}`).join(" L")}`;
    }

    return [
      `M${x(Math.max(tMin, startTs))},${y(0)}`,
      `L${x(cliffTs)},${y(0)}`,
      `L${x(effectiveEnd)},${y(endPct)}`,
    ].join(" ");
  }

  // Milestone: step chart
  const steps = milestoneCount || 1;
  const stepPct = 100 / steps;
  const stepDuration = (effectiveEnd - startTs) / steps;
  const pts: string[] = [`M${x(Math.max(tMin, startTs))},${y(0)}`];

  for (let i = 0; i < steps; i++) {
    const stepT = startTs + stepDuration * (i + 1);
    const prevPct = stepPct * i;
    const nextPct = stepPct * (i + 1);
    const sX = x(stepT);
    pts.push(`L${sX},${y(prevPct)}`);
    pts.push(`L${sX},${y(nextPct)}`);
  }

  return pts.join(" ");
}

export function VestingChart({
  releaseType,
  startTs,
  cliffTs,
  endTs,
  totalAmount,
  vestedAmount: _vestedAmount,
  cancelledAt,
  milestoneCount = 1,
  formatAmount = defaultFmtAmount,
}: VestingChartProps) {
  const now = Math.floor(Date.now() / 1000);
  const W = 392;
  const H = 256;
  const PAD = { top: 28, right: 10, bottom: 44, left: 50 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const [timeRange, setTimeRange] = useState<TimeRange>(() =>
    now >= endTs ? getCompletedDefault(startTs, endTs) : getSmartDefault(startTs, endTs, now),
  );
  const [userChangedRange, setUserChangedRange] = useState(false);

  const effectiveEnd = cancelledAt && cancelledAt < endTs ? cancelledAt : endTs;
  const vestingComplete = now >= effectiveEnd;
  const finalPct = cancelledAt
    ? pctBetween(cliffTs, effectiveEnd, endTs)
    : 100;

  useEffect(() => {
    if (userChangedRange) return;
    if (vestingComplete) {
      setTimeRange(getCompletedDefault(startTs, endTs));
      return;
    }
    setTimeRange(getSmartDefault(startTs, endTs, now));
  }, [userChangedRange, vestingComplete, startTs, endTs, now]);

  const { viewStart, viewEnd } = useMemo(() => {
    if (timeRange === "all") {
      const pad = Math.max((endTs - startTs) * 0.05, 3600);
      return { viewStart: startTs - pad, viewEnd: Math.max(endTs, now) + pad };
    }
    const rangeDef = TIME_RANGES.find((r) => r.key === timeRange)!;
    const halfRange = rangeDef.seconds / 2;
    const center = Math.min(Math.max(now, startTs), Math.max(endTs, now));
    let vStart = center - halfRange;
    let vEnd = center + halfRange;
    if (vStart < startTs - rangeDef.seconds * 0.1) {
      vStart = startTs - rangeDef.seconds * 0.05;
      vEnd = vStart + rangeDef.seconds;
    }
    return { viewStart: vStart, viewEnd: vEnd };
  }, [timeRange, startTs, endTs, now, vestingComplete]);

  const tMin = viewStart;
  const tMax = viewEnd;
  const tRange = tMax - tMin || 1;

  const x = useCallback((t: number) => {
    const next = PAD.left + ((t - tMin) / tRange) * chartW;
    return Number.isFinite(next) ? next : PAD.left;
  }, [PAD.left, tMin, tRange, chartW]);
  const y = useCallback((pct: number) => PAD.top + chartH - (safePct(pct) / 100) * chartH, [PAD.top, chartH]);
  const tFromX = useCallback((px: number) => tMin + ((px - PAD.left) / chartW) * tRange, [tMin, PAD.left, chartW, tRange]);

  const curvePath = buildCurvePath(x, y, releaseType, startTs, cliffTs, endTs, effectiveEnd, cancelledAt ?? null, milestoneCount, tMin);

  // Extend the curve if vesting is complete and we're past the end
  const extendedCurve = vestingComplete && now > effectiveEnd
    ? `${curvePath} L${x(Math.min(now, tMax))},${y(finalPct)}`
    : curvePath;

  // Build the fill path (area under the curve, closed to bottom)
  const trailEnd = vestingComplete ? Math.min(now, tMax) : effectiveEnd;
  const fillPath = `${extendedCurve} L${x(trailEnd)},${y(0)} L${x(Math.max(tMin, startTs))},${y(0)} Z`;

  const nowX = x(Math.min(now, tMax));
  const nowCurvePct = vestedPctAt(
    Math.min(now, effectiveEnd),
    releaseType,
    startTs,
    cliffTs,
    endTs,
    cancelledAt ?? null,
    milestoneCount,
  );
  const nowInView = now >= tMin && now <= tMax;

  // Hover state
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ svgX: number; t: number; pct: number } | null>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const svgX = ((e.clientX - rect.left) / rect.width) * W;
      if (svgX < PAD.left || svgX > W - PAD.right) {
        setHover(null);
        return;
      }
      const t = tFromX(svgX);
      const pct = vestedPctAt(t, releaseType, startTs, cliffTs, endTs, cancelledAt ?? null, milestoneCount);
      setHover({ svgX, t, pct });
    },
    [W, PAD.left, PAD.right, tFromX, releaseType, startTs, cliffTs, endTs, cancelledAt, milestoneCount],
  );

  const handleMouseLeave = useCallback(() => setHover(null), []);

  const hoverAmountStr =
    hover && totalAmount > 0n
      ? formatAmount((totalAmount * BigInt(Math.round(hover.pct * 100))) / 10000n)
      : null;

  const releaseLabel = releaseType === 0 ? "Cliff" : releaseType === 1 ? "Linear" : "Milestone";

  const availableRanges = useMemo(() => {
    const totalDuration = endTs - startTs;
    return TIME_RANGES.filter((r) => {
      if (r.key === "all") return true;
      return r.seconds < totalDuration * 2;
    });
  }, [startTs, endTs]);

  // X-axis: evenly spaced date labels
  const xAxisLabels = useMemo(() => {
    const count = Math.min(5, Math.max(3, Math.floor(chartW / 72)));
    const labels: { t: number; x: number }[] = [];
    for (let i = 0; i < count; i++) {
      const t = tMin + (tRange * (i + 0.5)) / count;
      labels.push({ t, x: x(t) });
    }
    return labels;
  }, [tMin, tRange, chartW, x]);

  // Clip IDs (unique per instance to avoid collisions)
  const clipId = useRef(`vc-${Math.random().toString(36).slice(2, 8)}`).current;
  const pastClipId = `${clipId}-past`;
  const futureClipId = `${clipId}-future`;
  const gradId = `${clipId}-grad`;

  return (
    <div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] font-medium text-foreground">Vesting Curve</p>
        <div className="flex items-center gap-2">
          {availableRanges.length > 2 && (
            <div className="flex items-center rounded-lg border border-foreground/[0.06] bg-black/20 p-0.5">
              {availableRanges.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => {
                    setUserChangedRange(true);
                    setTimeRange(r.key);
                  }}
                  className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition ${
                    timeRange === r.key
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">{releaseLabel}</p>
        </div>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair"
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" />
            <stop offset="100%" stopColor="var(--background)" />
          </linearGradient>
          {nowInView && (
            <>
              <clipPath id={pastClipId}>
                <rect x={PAD.left} y={PAD.top} width={Math.max(0, nowX - PAD.left)} height={chartH} />
              </clipPath>
              <clipPath id={futureClipId}>
                <rect x={nowX} y={PAD.top} width={Math.max(0, W - PAD.right - nowX)} height={chartH} />
              </clipPath>
            </>
          )}
        </defs>

        {/* Horizontal grid lines — 20% increments */}
        {[0, 20, 40, 60, 80, 100].map((pct) => (
          <g key={pct}>
            <line
              x1={PAD.left}
              y1={y(pct)}
              x2={W - PAD.right}
              y2={y(pct)}
              stroke="var(--foreground)"
              strokeWidth="0.5"
              opacity={pct === 0 ? 0.15 : 0.06}
            />
            <text
              x={PAD.left - 8}
              y={y(pct) + 1}
              textAnchor="end"
              dominantBaseline="central"
              className="fill-muted-foreground"
              style={{ fontSize: 11 }}
            >
              {pct}%
            </text>
          </g>
        ))}

        {/* X-axis tick marks */}
        {xAxisLabels.map((lbl, i) => {
          const d = fmtDateShort(Math.round(lbl.t));
          return (
            <g key={i}>
              <line
                x1={lbl.x}
                y1={y(0)}
                x2={lbl.x}
                y2={y(0) + 5}
                stroke="var(--foreground)"
                strokeWidth="0.5"
                opacity="0.15"
              />
              <text
                x={lbl.x}
                y={y(0) + 16}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-muted-foreground"
                style={{ fontSize: 11 }}
              >
                {d.line1}
              </text>
              <text
                x={lbl.x}
                y={y(0) + 30}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-muted-foreground"
                style={{ fontSize: 11 }}
              >
                {d.line2}
              </text>
            </g>
          );
        })}

        {/* ---- Past: solid curve + gradient fill ---- */}
        {nowInView ? (
          <g clipPath={`url(#${pastClipId})`}>
            <path d={fillPath} fill={`url(#${gradId})`} fillOpacity="0.6" />
            <path
              d={extendedCurve}
              fill="none"
              stroke="var(--primary)"
              strokeWidth="2"
              strokeLinejoin="bevel"
            />
          </g>
        ) : (
          <>
            <path d={fillPath} fill={`url(#${gradId})`} fillOpacity="0.6" />
            <path
              d={extendedCurve}
              fill="none"
              stroke="var(--primary)"
              strokeWidth="2"
              strokeLinejoin="bevel"
            />
          </>
        )}

        {/* ---- Future: dashed curve, no fill ---- */}
        {nowInView && (
          <g clipPath={`url(#${futureClipId})`}>
            <path
              d={extendedCurve}
              fill="none"
              stroke="var(--primary)"
              strokeOpacity="0.4"
              strokeWidth="2"
              strokeDasharray="6,3"
              strokeLinejoin="bevel"
            />
          </g>
        )}

        {/* Cancelled marker */}
        {cancelledAt && cancelledAt >= tMin && cancelledAt <= tMax && (
          <>
            <line
              x1={x(cancelledAt)}
              y1={PAD.top}
              x2={x(cancelledAt)}
              y2={y(0)}
              stroke="#ef4444"
              strokeWidth="1"
              strokeDasharray="4,3"
            />
            <text
              x={x(cancelledAt) + 5}
              y={PAD.top + 10}
              className="fill-red-700 dark:fill-red-400"
              style={{ fontSize: 9, fontWeight: 500 }}
            >
              cancelled
            </text>
          </>
        )}

        {/* ---- NOW marker ---- */}
        {nowInView && (
          <>
            {/* Vertical dashed line */}
            <line
              x1={nowX}
              y1={y(0)}
              x2={nowX}
              y2={PAD.top}
              stroke="#fff"
              strokeWidth="1"
              strokeDasharray="4,2"
            />
            {/* Circle at curve intersection */}
            <circle
              cx={nowX}
              cy={y(nowCurvePct)}
              r="4"
              fill="#fff"
            />
            {/* Arrow/triangle at top */}
            <path
              d={`M0,0 L4.5,12 L0,9 L-4.5,12 Z`}
              transform={`translate(${nowX},${PAD.top})`}
              fill="#fff"
            />
            {/* NOW label */}
            <text
              x={nowX}
              y={PAD.top - 8}
              textAnchor="middle"
              fill="#fff"
              style={{ fontSize: 12, fontWeight: 500, fontFamily: "inter, sans-serif" }}
            >
              {vestingComplete ? "DONE" : "NOW"}
            </text>
          </>
        )}

        {/* Cliff marker */}
        {cliffTs > startTs && cliffTs < endTs && cliffTs >= tMin && cliffTs <= tMax && (
          <>
            <line
              x1={x(cliffTs)}
              y1={PAD.top}
              x2={x(cliffTs)}
              y2={y(0)}
              stroke="var(--violet)"
              strokeWidth="0.8"
              strokeDasharray="3,3"
              opacity="0.5"
            />
            <text
              x={x(cliffTs) + 5}
              y={PAD.top + 10}
              className="fill-violet"
              style={{ fontSize: 9, fontWeight: 500 }}
            >
              cliff
            </text>
          </>
        )}

        {/* Hover crosshair + tooltip */}
        {hover && (
          <>
            <line
              x1={hover.svgX}
              y1={PAD.top}
              x2={hover.svgX}
              y2={y(0)}
              stroke="var(--foreground)"
              strokeWidth="0.5"
              opacity="0.2"
            />
            <circle
              cx={hover.svgX}
              cy={y(hover.pct)}
              r="3.5"
              fill="none"
              stroke="var(--foreground)"
              strokeWidth="1.5"
              opacity="0.6"
            />
            <circle cx={hover.svgX} cy={y(hover.pct)} r="2" fill="var(--primary)" />

            <rect
              x={Math.min(hover.svgX + 8, W - PAD.right - 110)}
              y={Math.max(y(hover.pct) - 32, PAD.top)}
              width="105"
              height="28"
              rx="4"
              fill="var(--card)"
              stroke="var(--border)"
              strokeWidth="0.5"
            />
            <text
              x={Math.min(hover.svgX + 14, W - PAD.right - 104)}
              y={Math.max(y(hover.pct) - 19, PAD.top + 13)}
              className="fill-foreground"
              style={{ fontSize: 9, fontWeight: 600 }}
            >
              {fmtPct(hover.pct)}{hoverAmountStr ? ` · ${hoverAmountStr}` : ""}
            </text>
            <text
              x={Math.min(hover.svgX + 14, W - PAD.right - 104)}
              y={Math.max(y(hover.pct) - 7, PAD.top + 25)}
              className="fill-muted-foreground"
              style={{ fontSize: 7.5 }}
            >
              {fmtDateFull(Math.round(hover.t))}
            </text>
          </>
        )}
      </svg>

      {/* Legend */}
      <div className="mt-2 flex items-center gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 rounded bg-primary" />
          Vested
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 border-b border-dashed border-primary/40" />
          Projected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-white" />
          {vestingComplete ? "Complete" : "Current"}
        </span>
        {cliffTs > startTs && cliffTs < endTs && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 border-b border-dashed border-violet" />
            Cliff
          </span>
        )}
      </div>
    </div>
  );
}
