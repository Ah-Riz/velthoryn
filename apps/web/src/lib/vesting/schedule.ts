// Mirror of programs/vesting/src/math/schedule.rs
// All formulas and edge cases must match the Rust implementation exactly.

export type ReleaseType = 0 | 1 | 2; // Cliff | Linear | Milestone

export interface VestingSchedule {
  amount: bigint;
  releaseType: ReleaseType;
  startTime: bigint;
  cliffTime: bigint;
  endTime: bigint;
}

/**
 * Returns the time-based vested amount for a schedule at a given timestamp.
 * Mirrors `vested()` in programs/vesting/src/math/schedule.rs exactly.
 *
 * For Milestone (type 2): returns `amount` once `now >= cliffTime`, but the
 * caller MUST independently check milestone release flags before treating the
 * result as claimable.
 */
export function vested(schedule: VestingSchedule, now: bigint): bigint {
  const { amount, releaseType, cliffTime, endTime } = schedule;

  if (releaseType === 0) {
    // Cliff
    return now >= cliffTime ? amount : 0n;
  }

  if (releaseType === 1) {
    // Linear
    if (now >= endTime) return amount;
    if (now <= cliffTime) return 0n;
    const elapsed = now - cliffTime;
    const duration = endTime - cliffTime;
    // u128 intermediate to avoid overflow — BigInt handles arbitrary precision
    return (amount * elapsed) / duration;
  }

  if (releaseType === 2) {
    // Milestone
    return now >= cliffTime ? amount : 0n;
  }

  return 0n;
}

/**
 * Returns the vested amount capped at an optional cancellation time.
 * Mirrors `get_vested_amount()` in programs/vesting/src/math/schedule.rs.
 */
export function getVestedAmount(
  schedule: VestingSchedule,
  cancelledAt: bigint | null,
  now: bigint,
): bigint {
  const effectiveNow = cancelledAt !== null ? (now < cancelledAt ? now : cancelledAt) : now;
  return vested(schedule, effectiveNow);
}

/* ------------------------------------------------------------------ */
/*  Aggregate campaign-level schedule utilities                        */
/* ------------------------------------------------------------------ */

/**
 * Scheduled vesting amount — time-based, deterministic, assumes all unlock
 * conditions are met on schedule.
 *
 * For Cliff and Linear this equals the on-chain vested amount (`claim.rs`
 * calls `schedule::vested()` directly for those types).
 *
 * For Milestone (release_type 2) this returns `amount` once `t >= cliffTime`,
 * representing the **intended unlock schedule**. It does NOT reflect actual
 * on-chain claimability — milestones require the creator to set the
 * `milestone_released_flags` bit, which is not available in the indexed DB.
 *
 * Use for chart/schedule visualizations only, never for claim eligibility.
 */
export function scheduledVestingAmount(
  leaf: {
    amount: bigint;
    releaseType: number;
    cliffTime: bigint;
    endTime: bigint;
  },
  cancelledAt: bigint | null,
  t: bigint,
): bigint {
  return getVestedAmount(
    {
      amount: leaf.amount,
      releaseType: leaf.releaseType as ReleaseType,
      startTime: 0n, // unused by vested()
      cliffTime: leaf.cliffTime,
      endTime: leaf.endTime,
    },
    cancelledAt,
    t,
  );
}

/**
 * Sum scheduled vesting across all leaves at time `t`.
 * Used for the campaign-level aggregate vesting curve.
 */
export function aggregateScheduledVesting(
  leaves: ReadonlyArray<{
    amount: bigint;
    releaseType: number;
    cliffTime: bigint;
    endTime: bigint;
  }>,
  cancelledAt: bigint | null,
  t: bigint,
): bigint {
  let total = 0n;
  for (const leaf of leaves) {
    total += scheduledVestingAmount(leaf, cancelledAt, t);
  }
  return total;
}

const CURVE_SAMPLE_COUNT = 100;

/**
 * Build a sampled aggregate vesting curve for chart rendering.
 *
 * Returns time bounds and `CURVE_SAMPLE_COUNT` evenly-spaced `{ t, vested }`
 * points. For Cliff/Linear these are exact; for Milestone they represent the
 * scheduled unlock (see `scheduledVestingAmount` doc).
 */
export function buildVestingCurve(
  leaves: ReadonlyArray<{
    amount: bigint;
    releaseType: number;
    startTime: bigint;
    cliffTime: bigint;
    endTime: bigint;
  }>,
  totalSupply: bigint,
  cancelledAt: bigint | null,
): {
  minStartTime: number;
  maxEndTime: number;
  totalSupply: string;
  samples: Array<{ t: number; vested: string }>;
} {
  if (leaves.length === 0) {
    return { minStartTime: 0, maxEndTime: 0, totalSupply: totalSupply.toString(), samples: [] };
  }

  let minStart = leaves[0].startTime;
  let maxEnd = leaves[0].endTime;
  for (const l of leaves) {
    if (l.startTime < minStart) minStart = l.startTime;
    if (l.endTime > maxEnd) maxEnd = l.endTime;
  }

  const minStartNum = Number(minStart);
  const maxEndNum = Number(maxEnd);
  const range = maxEndNum - minStartNum;

  if (range <= 0) {
    const v = aggregateScheduledVesting(leaves, cancelledAt, maxEnd);
    return {
      minStartTime: minStartNum,
      maxEndTime: maxEndNum,
      totalSupply: totalSupply.toString(),
      samples: [{ t: maxEndNum, vested: v.toString() }],
    };
  }

  const step = range / (CURVE_SAMPLE_COUNT - 1);
  const samples: Array<{ t: number; vested: string }> = [];
  for (let i = 0; i < CURVE_SAMPLE_COUNT; i++) {
    const tNum = minStartNum + step * i;
    const tBig = BigInt(Math.round(tNum));
    const v = aggregateScheduledVesting(leaves, cancelledAt, tBig);
    samples.push({ t: Math.round(tNum), vested: v.toString() });
  }

  return {
    minStartTime: minStartNum,
    maxEndTime: maxEndNum,
    totalSupply: totalSupply.toString(),
    samples,
  };
}
