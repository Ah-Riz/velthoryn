"use client";

/**
 * SVG-based vesting curve chart. No external dependencies.
 * Renders cliff, linear, or milestone unlock schedules.
 */

type VestingChartProps = {
  releaseType: number; // 0=cliff, 1=linear, 2=milestone
  startTs: number;
  cliffTs: number;
  endTs: number;
  totalAmount: bigint;
  vestedAmount: bigint;
  cancelledAt?: number | null;
  milestoneCount?: number;
};

export function VestingChart({
  releaseType,
  startTs,
  cliffTs,
  endTs,
  totalAmount,
  vestedAmount,
  cancelledAt,
  milestoneCount = 1,
}: VestingChartProps) {
  const now = Math.floor(Date.now() / 1000);
  const W = 400;
  const H = 160;
  const PAD = { top: 20, right: 20, bottom: 30, left: 50 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const tMin = startTs;
  const tMax = Math.max(endTs, now + 60);
  const tRange = tMax - tMin || 1;

  const x = (t: number) => PAD.left + ((t - tMin) / tRange) * chartW;
  const y = (pct: number) => PAD.top + chartH - (pct / 100) * chartH;

  // Build curve points
  let curvePath: string;
  const effectiveEnd = cancelledAt && cancelledAt < endTs ? cancelledAt : endTs;

  if (releaseType === 0) {
    // Cliff: 0% until cliffTs, then 100%
    curvePath = `M${x(tMin)},${y(0)} L${x(cliffTs)},${y(0)} L${x(cliffTs)},${y(100)} L${x(effectiveEnd)},${y(100)}`;
  } else if (releaseType === 1) {
    // Linear: 0% at start, ramp from cliffTs to endTs
    const pts: string[] = [`M${x(tMin)},${y(0)}`];
    if (cliffTs > startTs) pts.push(`L${x(cliffTs)},${y(0)}`);
    pts.push(`L${x(effectiveEnd)},${y(cancelledAt ? ((effectiveEnd - cliffTs) / (endTs - cliffTs)) * 100 : 100)}`);
    curvePath = pts.join(" ");
  } else {
    // Milestone: step function
    const pts: string[] = [`M${x(tMin)},${y(0)}`];
    const steps = milestoneCount || 1;
    const stepPct = 100 / steps;
    const stepDuration = (effectiveEnd - tMin) / steps;
    for (let i = 0; i < steps; i++) {
      const stepT = tMin + stepDuration * (i + 1);
      const prevPct = stepPct * i;
      const nextPct = stepPct * (i + 1);
      pts.push(`L${x(stepT)},${y(prevPct)}`);
      pts.push(`L${x(stepT)},${y(nextPct)}`);
    }
    curvePath = pts.join(" ");
  }

  // Now marker
  const nowX = x(Math.min(now, tMax));
  const progressPct = totalAmount > 0n ? Number((vestedAmount * 100n) / totalAmount) : 0;

  // Time labels
  const formatDate = (ts: number) => {
    const d = new Date(ts * 1000);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] font-medium text-white">Vesting Curve</p>
        <p className="text-[11px] text-[#8b92a5]">
          {releaseType === 0 ? "Cliff" : releaseType === 1 ? "Linear" : "Milestone"}
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Grid lines */}
        {[0, 25, 50, 75, 100].map((pct) => (
          <g key={pct}>
            <line x1={PAD.left} y1={y(pct)} x2={W - PAD.right} y2={y(pct)} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
            <text x={PAD.left - 6} y={y(pct) + 3} textAnchor="end" className="fill-[#6f7c95] text-[8px]">{pct}%</text>
          </g>
        ))}

        {/* Curve */}
        <path d={curvePath} fill="none" stroke="url(#curveGrad)" strokeWidth="2" strokeLinecap="round" />

        {/* Filled area */}
        <path d={`${curvePath} L${x(effectiveEnd)},${y(0)} L${x(tMin)},${y(0)} Z`} fill="url(#areaGrad)" opacity="0.15" />

        {/* Now marker */}
        <line x1={nowX} y1={PAD.top} x2={nowX} y2={H - PAD.bottom} stroke="#a78bfa" strokeWidth="1" strokeDasharray="3,3" />
        <circle cx={nowX} cy={y(progressPct)} r="4" fill="#a78bfa" />

        {/* Cancelled marker */}
        {cancelledAt && (
          <line x1={x(cancelledAt)} y1={PAD.top} x2={x(cancelledAt)} y2={H - PAD.bottom} stroke="#ef4444" strokeWidth="1" strokeDasharray="2,2" />
        )}

        {/* X-axis labels */}
        <text x={x(tMin)} y={H - 8} textAnchor="start" className="fill-[#6f7c95] text-[8px]">{formatDate(startTs)}</text>
        {cliffTs > startTs && cliffTs < endTs && (
          <text x={x(cliffTs)} y={H - 8} textAnchor="middle" className="fill-[#6f7c95] text-[8px]">{formatDate(cliffTs)}</text>
        )}
        <text x={x(endTs)} y={H - 8} textAnchor="end" className="fill-[#6f7c95] text-[8px]">{formatDate(endTs)}</text>

        {/* Gradients */}
        <defs>
          <linearGradient id="curveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#6d28d9" />
          </linearGradient>
          <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
