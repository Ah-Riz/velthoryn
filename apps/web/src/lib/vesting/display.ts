export const GRACE_PERIOD_SECS = 604800n;

const TYPE_LABELS: Record<number, string> = {
  0: "Cliff",
  1: "Linear",
  2: "Milestone",
};

const TYPE_BADGE_COLORS: Record<number, string> = {
  0: "bg-indigo-500/20 text-indigo-700 dark:text-indigo-400 border-indigo-500/40",
  1: "bg-violet-500/20 text-violet-700 dark:text-violet-400 border-violet-500/40",
  2: "bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/40",
};

/**
 * Format a raw on-chain amount using token decimals.
 * Example: formatTokenAmount(500_000_000n, 9) → "0.5"
 */
export function formatTokenAmount(raw: bigint, decimals: number | null | undefined): string {
  if (decimals === null || decimals === undefined) return raw.toString();
  if (decimals === 0) return raw.toLocaleString();
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
  return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
}

/** Sub-label for aggregate stats when totals span multiple token mints. */
export function mixedMintAggregateSub(mintCount: number, baseSub?: string): string | undefined {
  if (mintCount <= 1) return baseSub;
  const note = `raw units across ${mintCount} tokens`;
  return baseSub ? `${baseSub} · ${note}` : note;
}

export function getVestingTypeLabel(releaseType: number): string {
  return TYPE_LABELS[releaseType] ?? "Unknown";
}

export function getVestingTypeBadgeColor(releaseType: number): string {
  return TYPE_BADGE_COLORS[releaseType] ?? "bg-gray-500/20 text-gray-400 border-gray-500/40";
}

export function formatCountdown(targetUnix: bigint, nowUnix: bigint): string {
  if (nowUnix >= targetUnix) return "Reached";

  const diff = Number(targetUnix - nowUnix);
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);

  return parts.join(" ");
}

export type WithdrawDisabledParams = {
  loading: boolean;
  paused: boolean;
  claimable: bigint;
  cancelledAt: bigint | null;
  releaseType: number;
  nowTs: bigint;
  cliffTs: bigint;
  milestoneIdx?: number;
  milestoneBitmap?: Uint8Array;
  milestoneReleased?: boolean;
};

export type GracePeriodState =
  | { status: "not_cancelled" }
  | { status: "grace_active"; remaining: bigint; countdown: string }
  | { status: "grace_expired" };

export function getGracePeriodState(
  cancelledAt: bigint | null,
  nowTs: bigint,
): GracePeriodState {
  if (cancelledAt === null) return { status: "not_cancelled" };
  const graceEnd = cancelledAt + GRACE_PERIOD_SECS;
  if (nowTs < graceEnd) {
    return {
      status: "grace_active",
      remaining: graceEnd - nowTs,
      countdown: formatCountdown(graceEnd, nowTs),
    };
  }
  return { status: "grace_expired" };
}

export function getWithdrawDisabledReason(params: WithdrawDisabledParams): string | null {
  if (params.loading) return "Claiming...";
  if (params.paused) return "Campaign is paused";
  if (params.cancelledAt !== null && params.claimable === 0n)
    return "Stream cancelled — nothing to claim";
  if (params.releaseType === 0 && params.nowTs < params.cliffTs && params.claimable === 0n)
    return "Cliff not reached yet";
  if (params.releaseType === 2 && params.nowTs < params.cliffTs && params.claimable === 0n)
    return "Milestone not unlocked yet";
  if (params.releaseType === 2 && params.milestoneReleased === false)
    return "Milestone not released yet";
  if (params.releaseType === 2 && params.claimable === 0n && params.milestoneIdx !== undefined && params.milestoneBitmap) {
    const byteIdx = Math.floor(params.milestoneIdx / 8);
    const bitIdx = params.milestoneIdx % 8;
    if (byteIdx < params.milestoneBitmap.length && (params.milestoneBitmap[byteIdx] & (1 << bitIdx)) !== 0)
      return "Milestone already claimed";
  }
  if (params.claimable === 0n) return "Nothing to claim";
  return null;
}
