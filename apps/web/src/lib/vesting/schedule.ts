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
