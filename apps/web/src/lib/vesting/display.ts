export const GRACE_PERIOD_SECS = 604800n;

const TYPE_LABELS: Record<number, string> = {
  0: "Cliff",
  1: "Linear",
  2: "Milestone",
};

const TYPE_BADGE_COLORS: Record<number, string> = {
  0: "bg-amber-500/20 text-amber-400 border-amber-500/40",
  1: "bg-purple-500/20 text-purple-400 border-purple-500/40",
  2: "bg-blue-500/20 text-blue-400 border-blue-500/40",
};

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
  if (params.claimable === 0n) return "Nothing to claim";
  return null;
}
