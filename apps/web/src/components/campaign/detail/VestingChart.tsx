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

function fmtDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtDateFull(ts: number): string {
  const d = new Date(ts * 1000);
  const mon = d.toLocaleString("en", { month: "short" });
  return `${mon} ${d.getDate()}, ${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
      return cancelledAt ? Math.min(100, ((effectiveEnd - cliffTs) / (endTs - cliffTs)) * 100) : 100;
    }
    const duration = endTs - cliffTs;
    return duration > 0 ? ((t - cliffTs) / duration) * 100 : 0;
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

function buildSmoothLinearPath(
  x: (t: number) => number,
  y: (pct: number) => number,
  startTs: number,
  cliffTs: number,
  endTs: number,
  effectiveEnd: number,
  cancelledAt: number | null,
): string {
  const endPct = cancelledAt ? Math.min(100, ((effectiveEnd - cliffTs) / (endTs - cliffTs)) * 100) : 100;
  const hasCliff = cliffTs > startTs;

  if (!hasCliff) {
    const steps = 20;
    const pts: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = startTs + ((effectiveEnd - startTs) * i) / steps;
      const pct = ((t - startTs) / (endTs - startTs)) * endPct;
      pts.push([x(t), y(Math.min(pct, endPct))]);
    }
    return `M${pts.map((p) => `${p[0]},${p[1]}`).join(" L")}`;
  }

  const cx1 = x(cliffTs);
  const cy1 = y(0);
  const cx2 = x(effectiveEnd);
  const cy2 = y(endPct);
  const bendRadius = Math.min((cx2 - cx1) * 0.15, 15);

  return [
    `M${x(startTs)},${y(0)}`,
    `L${cx1},${cy1}`,
    `C${cx1 + bendRadius},${cy1} ${cx1 + bendRadius},${cy1 - (cy1 - cy2) * 0.1} ${cx1 + bendRadius * 1.5},${cy1 - (cy1 - cy2) * 0.15}`,
    `L${cx2 - bendRadius},${cy2 + (cy1 - cy2) * 0.05}`,
    `C${cx2},${cy2} ${cx2},${cy2} ${cx2},${cy2}`,
  ].join(" ");
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
  const W = 400;
  const H = 160;
  const PAD = { top: 20, right: 20, bottom: 30, left: 50 };
  const padTop = PAD.top;
  const padRight = PAD.right;
  const padBottom = PAD.bottom;
  const padLeft = PAD.left;
  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;

  const [timeRange, setTimeRange] = useState<TimeRange>(() =>
    now >= endTs ? getCompletedDefault(startTs, endTs) : getSmartDefault(startTs, endTs, now),
  );
  const [userChangedRange, setUserChangedRange] = useState(false);

  const effectiveEnd = cancelledAt && cancelledAt < endTs ? cancelledAt : endTs;
  const vestingComplete = now >= effectiveEnd;
  const finalPct = cancelledAt
    ? Math.min(100, ((effectiveEnd - cliffTs) / (endTs - cliffTs)) * 100)
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
      const vStart = startTs;
      const vEnd = vestingComplete ? Math.max(endTs, now + 60) : Math.max(endTs, now + 60);
      return { viewStart: vStart, viewEnd: vEnd };
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

  const x = useCallback((t: number) => padLeft + ((t - tMin) / tRange) * chartW, [padLeft, tMin, tRange, chartW]);
  const y = useCallback((pct: number) => padTop + chartH - (pct / 100) * chartH, [padTop, chartH]);
  const tFromX = useCallback((px: number) => tMin + ((px - padLeft) / chartW) * tRange, [tMin, padLeft, chartW, tRange]);

  let curvePath: string;
  let fillPath: string;

  if (releaseType === 0) {
    const cX = x(cliffTs);
    const r = Math.min(4, Math.max(0, (x(effectiveEnd) - cX) * 0.1));
    curvePath = [
      `M${x(Math.max(tMin, startTs))},${y(0)}`,
      `L${cX},${y(0)}`,
      `L${cX},${y(100) + r}`,
      `Q${cX},${y(100)} ${cX + r},${y(100)}`,
      `L${x(effectiveEnd)},${y(100)}`,
    ].join(" ");

    if (vestingComplete && now > effectiveEnd) {
      curvePath += ` L${x(Math.min(now, tMax))},${y(100)}`;
    }

    fillPath = `${curvePath} L${x(vestingComplete ? Math.min(now, tMax) : effectiveEnd)},${y(0)} L${x(Math.max(tMin, startTs))},${y(0)} Z`;
  } else if (releaseType === 1) {
    curvePath = buildSmoothLinearPath(x, y, startTs, cliffTs, endTs, effectiveEnd, cancelledAt ?? null);

    if (vestingComplete && now > effectiveEnd) {
      curvePath += ` L${x(Math.min(now, tMax))},${y(finalPct)}`;
    }

    fillPath = `${curvePath} L${x(vestingComplete ? Math.min(now, tMax) : effectiveEnd)},${y(0)} L${x(Math.max(tMin, startTs))},${y(0)} Z`;
  } else {
    const steps = milestoneCount || 1;
    const stepPct = 100 / steps;
    const stepDuration = (effectiveEnd - startTs) / steps;
    const r = Math.min(3, (chartW / steps) * 0.08);
    const pts: string[] = [`M${x(Math.max(tMin, startTs))},${y(0)}`];

    for (let i = 0; i < steps; i++) {
      const stepT = startTs + stepDuration * (i + 1);
      const prevPct = stepPct * i;
      const nextPct = stepPct * (i + 1);
      const sX = x(stepT);

      pts.push(`L${sX},${y(prevPct)}`);
      if (r > 0.5) {
        pts.push(`L${sX},${y(nextPct) + r}`);
        pts.push(`Q${sX},${y(nextPct)} ${sX + r},${y(nextPct)}`);
      } else {
        pts.push(`L${sX},${y(nextPct)}`);
      }
    }
    curvePath = pts.join(" ");

    if (vestingComplete && now > effectiveEnd) {
      const lastPct = vestedPctAt(effectiveEnd, releaseType, startTs, cliffTs, endTs, cancelledAt ?? null, milestoneCount);
      curvePath += ` L${x(Math.min(now, tMax))},${y(lastPct)}`;
    }

    const trailEnd = vestingComplete ? Math.min(now, tMax) : effectiveEnd;
    fillPath = `${curvePath} L${x(trailEnd)},${y(0)} L${x(Math.max(tMin, startTs))},${y(0)} Z`;
  }

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

  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ svgX: number; t: number; pct: number } | null>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const svgX = ((e.clientX - rect.left) / rect.width) * W;
      if (svgX < padLeft || svgX > W - padRight) {
        setHover(null);
        return;
      }
      const t = tFromX(svgX);
      const pct = vestedPctAt(t, releaseType, startTs, cliffTs, endTs, cancelledAt ?? null, milestoneCount);
      setHover({ svgX, t, pct });
    },
    [W, padLeft, padRight, tFromX, releaseType, startTs, cliffTs, endTs, cancelledAt, milestoneCount],
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

  const xAxisLabels = useMemo(() => {
    const labels: { t: number; anchor: string }[] = [];
    labels.push({ t: Math.max(tMin, startTs), anchor: "start" });

    if (cliffTs > startTs && cliffTs < endTs && cliffTs >= tMin && cliffTs <= tMax) {
      labels.push({ t: cliffTs, anchor: "middle" });
    }

    if (endTs >= tMin && endTs <= tMax) {
      labels.push({ t: endTs, anchor: "end" });
    }

    if (vestingComplete && now > endTs && now <= tMax) {
      const tooClose = labels.some((l) => Math.abs(x(now) - x(l.t)) < 30);
      if (!tooClose) {
        labels.push({ t: now, anchor: "end" });
      }
    }

    return labels;
  }, [tMin, tMax, startTs, cliffTs, endTs, now, vestingComplete, x]);

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] font-medium text-white">Vesting Curve</p>
        <div className="flex items-center gap-2">
          {availableRanges.length > 2 && (
            <div className="flex items-center rounded-lg border border-white/[0.06] bg-black/20 p-0.5">
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
                      ? "bg-violet-500/20 text-violet-400"
                      : "text-[#6f7c95] hover:text-white"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-[#8b92a5]">{releaseLabel}</p>
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
          <linearGradient id="curveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#6d28d9" />
          </linearGradient>
          <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="trailGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {[0, 25, 50, 75, 100].map((pct) => (
          <g key={pct}>
            <line x1={PAD.left} y1={y(pct)} x2={W - PAD.right} y2={y(pct)} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
            <text x={PAD.left - 6} y={y(pct) + 3} textAnchor="end" className="fill-[#6f7c95]" style={{ fontSize: 8 }}>{pct}%</text>
          </g>
        ))}

        {/* Filled area */}
        <path d={fillPath} fill="url(#areaGrad)" />

        {/* Curve */}
        <path d={curvePath} fill="none" stroke="url(#curveGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* Vesting complete flat line indicator */}
        {vestingComplete && now > effectiveEnd && (
          <line
            x1={x(effectiveEnd)}
            y1={y(finalPct)}
            x2={x(Math.min(now, tMax))}
            y2={y(finalPct)}
            stroke="#a78bfa"
            strokeWidth="1"
            strokeDasharray="4,3"
            opacity="0.4"
          />
        )}

        {/* End marker when vesting complete */}
        {vestingComplete && endTs >= tMin && endTs <= tMax && (
          <>
            <line x1={x(endTs)} y1={PAD.top} x2={x(endTs)} y2={H - PAD.bottom} stroke="#22c55e" strokeWidth="0.8" strokeDasharray="3,3" opacity="0.4" />
            <text x={x(endTs) + 4} y={PAD.top + 8} className="fill-emerald-400" style={{ fontSize: 7, letterSpacing: 0.3 }}>end</text>
          </>
        )}

        {/* Cliff marker */}
        {cliffTs > startTs && cliffTs < endTs && cliffTs >= tMin && cliffTs <= tMax && (
          <>
            <line x1={x(cliffTs)} y1={PAD.top} x2={x(cliffTs)} y2={H - PAD.bottom} stroke="#14F1D9" strokeWidth="0.8" strokeDasharray="3,3" opacity="0.5" />
            <text x={x(cliffTs) + 4} y={PAD.top + 8} className="fill-[#14F1D9]" style={{ fontSize: 7, letterSpacing: 0.3 }}>cliff</text>
          </>
        )}

        {/* Now marker */}
        {now >= tMin && now <= tMax && (
          <>
            <line x1={nowX} y1={PAD.top} x2={nowX} y2={H - PAD.bottom} stroke="#a78bfa" strokeWidth="1" strokeDasharray="3,3" />
            <circle cx={nowX} cy={y(nowCurvePct)} r="4" fill="#a78bfa" />
            <text x={nowX} y={PAD.top - 4} textAnchor="middle" className="fill-[#a78bfa]" style={{ fontSize: 7, fontWeight: 600 }}>
              {vestingComplete ? "DONE" : "NOW"}
            </text>
          </>
        )}

        {/* Cancelled marker */}
        {cancelledAt && cancelledAt >= tMin && cancelledAt <= tMax && (
          <>
            <line x1={x(cancelledAt)} y1={PAD.top} x2={x(cancelledAt)} y2={H - PAD.bottom} stroke="#ef4444" strokeWidth="1" strokeDasharray="2,2" />
            <text x={x(cancelledAt) + 4} y={PAD.top + 8} className="fill-red-400" style={{ fontSize: 7 }}>cancelled</text>
          </>
        )}

        {/* Hover crosshair + tooltip */}
        {hover && (
          <>
            <line x1={hover.svgX} y1={PAD.top} x2={hover.svgX} y2={H - PAD.bottom} stroke="rgba(255,255,255,0.2)" strokeWidth="0.5" />
            <circle cx={hover.svgX} cy={y(hover.pct)} r="3.5" fill="none" stroke="#fff" strokeWidth="1.5" />
            <circle cx={hover.svgX} cy={y(hover.pct)} r="2" fill="#a78bfa" />

            <rect
              x={Math.min(hover.svgX + 8, W - PAD.right - 100)}
              y={Math.max(y(hover.pct) - 30, PAD.top)}
              width="95"
              height="26"
              rx="4"
              fill="rgba(13,17,23,0.92)"
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="0.5"
            />
            <text
              x={Math.min(hover.svgX + 12, W - PAD.right - 96)}
              y={Math.max(y(hover.pct) - 18, PAD.top + 12)}
              className="fill-white"
              style={{ fontSize: 7, fontWeight: 600 }}
            >
              {fmtPct(hover.pct)}{hoverAmountStr ? ` · ${hoverAmountStr}` : ""}
            </text>
            <text
              x={Math.min(hover.svgX + 12, W - PAD.right - 96)}
              y={Math.max(y(hover.pct) - 8, PAD.top + 22)}
              className="fill-[#8b92a5]"
              style={{ fontSize: 6 }}
            >
              {fmtDateFull(Math.round(hover.t))}
            </text>
          </>
        )}

        {/* X-axis labels */}
        {xAxisLabels.map((lbl, i) => (
          <text
            key={i}
            x={x(lbl.t)}
            y={H - 8}
            textAnchor={lbl.anchor as "start" | "middle" | "end"}
            className="fill-[#6f7c95]"
            style={{ fontSize: 8 }}
          >
            {fmtDate(lbl.t)}
          </text>
        ))}
      </svg>

      {/* Legend */}
      <div className="mt-2 flex items-center gap-4 text-[10px] text-[#6f7c95]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 rounded bg-gradient-to-r from-[#a78bfa] to-[#6d28d9]" />
          Vesting curve
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-[#a78bfa]" />
          {vestingComplete ? "Complete" : "Current"}
        </span>
        {cliffTs > startTs && cliffTs < endTs && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 border-b border-dashed border-[#14F1D9]" />
            Cliff
          </span>
        )}
        {vestingComplete && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 border-b border-dashed border-emerald-400" />
            Ended
          </span>
        )}
      </div>
    </div>
  );
}
