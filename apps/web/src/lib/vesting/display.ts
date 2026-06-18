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

/**
 * When campaigns span mints with different decimals, format each mint's amount
 * separated by " · " (not "+" — these are different assets, not addable).
 *
 * Example: formatMintBreakdown(mintSums, 'entitled', decimalsMap)
 *   → "17.875 · 2.5"
 */
export function formatMintBreakdown(
  mintSums: Map<string, { entitled: bigint; vested: bigint; claimed: bigint; claimable: bigint }>,
  field: "entitled" | "vested" | "claimed" | "claimable",
  decimalsMap: Map<string, number>,
): string {
  const parts: string[] = [];
  for (const [mint, sums] of mintSums) {
    const decimals = decimalsMap.get(mint) ?? null;
    parts.push(formatTokenAmount(sums[field], decimals));
  }
  return parts.join(" · ") || "—";
}

/** Sub-label for the multi-mint case when amounts ARE already formatted (not raw). */
export function multiMintSub(mintCount: number, baseSub?: string): string | undefined {
  const note = `${mintCount} token types`;
  return baseSub ? `${baseSub} · ${note}` : note;
}

/**
 * Same as formatSummedMintAmounts but for a plain mint→amount map (e.g. TVL).
 */
export function formatSummedAmounts(
  mintAmounts: Map<string, bigint>,
  decimalsMap: Map<string, number>,
): string {
  if (mintAmounts.size === 0) return "—";

  let maxDecimals = 0;
  for (const [mint] of mintAmounts) {
    const dec = decimalsMap.get(mint);
    if (dec === undefined) return "—";
    if (dec > maxDecimals) maxDecimals = dec;
  }

  let total = 0n;
  for (const [mint, amount] of mintAmounts) {
    const dec = decimalsMap.get(mint)!;
    total += amount * (10n ** BigInt(maxDecimals - dec));
  }

  return formatTokenAmount(total, maxDecimals);
}

/**
 * Sums amounts across mints by normalizing each to the highest decimal before adding,
 * so 1 SOL (9 dec) + 17 USDC (6 dec) displays as "18", not raw gibberish.
 * Returns "—" if any mint's decimal is still loading.
 */
export function formatSummedMintAmounts(
  mintSums: Map<string, { entitled: bigint; vested: bigint; claimed: bigint; claimable: bigint }>,
  field: "entitled" | "vested" | "claimed" | "claimable",
  decimalsMap: Map<string, number>,
): string {
  if (mintSums.size === 0) return "—";

  let maxDecimals = 0;
  for (const [mint] of mintSums) {
    const dec = decimalsMap.get(mint);
    if (dec === undefined) return "—";
    if (dec > maxDecimals) maxDecimals = dec;
  }

  let total = 0n;
  for (const [mint, sums] of mintSums) {
    const dec = decimalsMap.get(mint)!;
    total += sums[field] * (10n ** BigInt(maxDecimals - dec));
  }

  return formatTokenAmount(total, maxDecimals);
}

/**
 * Format a USD dollar value with appropriate scale suffix.
 * Examples: 1500 → "$1,500.00", 2_000_000 → "$2.00M"
 */
export function formatUsd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return "< $0.01";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000)
    return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${value.toFixed(2)}`;
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
