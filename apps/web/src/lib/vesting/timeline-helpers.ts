import type { TimelineEvent } from "@/hooks/useCampaignTimeline";

export const EVENT_CONFIG: Record<
  TimelineEvent["type"],
  { icon: string; color: string; label: string }
> = {
  claimed: { icon: "↓", color: "text-green-400", label: "Claimed" },
  cancelled: { icon: "✕", color: "text-red-700 dark:text-red-400", label: "Campaign Cancelled" },
  paused: { icon: "⏸", color: "text-yellow-400", label: "Paused" },
  root_updated: { icon: "↻", color: "text-blue-400", label: "Root Updated" },
  withdrawn: { icon: "↑", color: "text-amber-700 dark:text-amber-400", label: "Unvested Withdrawn" },
  milestone_released: { icon: "◆", color: "text-violet-700 dark:text-violet-400", label: "Milestone Released" },
  stream_cancelled: { icon: "⚡", color: "text-orange-400", label: "Stream Settled" },
  instant_refunded: { icon: "↩", color: "text-rose-400", label: "Instant Refund" },
};

export function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

export function truncateSig(sig: string): string {
  if (sig.length <= 16) return sig;
  return `${sig.slice(0, 8)}...${sig.slice(-4)}`;
}

export function formatBlockTime(blockTime: string): string {
  const ts = Number(blockTime);
  if (!ts) return "—";

  const now = Date.now();
  const diffSec = Math.floor(now / 1000) - ts;
  if (diffSec < 0) {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} hour${Math.floor(diffSec / 3600) === 1 ? "" : "s"} ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)} day${Math.floor(diffSec / 86400) === 1 ? "" : "s"} ago`;

  const d = new Date(ts * 1000);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatAmount(raw: string, decimals: number | null): string {
  const n = Number(raw);
  if (!n) return raw;
  if (decimals !== null && decimals > 0) {
    const human = n / 10 ** decimals;
    if (human >= 1_000_000) return `${(human / 1_000_000).toFixed(2)}M`;
    if (human >= 1_000) return `${(human / 1_000).toFixed(1)}K`;
    const fracDigits = human % 1 === 0 ? 0 : Math.min(4, decimals);
    return human.toLocaleString(undefined, { maximumFractionDigits: fracDigits });
  }
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return raw;
}

export function eventDescription(event: TimelineEvent, decimals: number | null): string {
  const { type, data } = event;
  switch (type) {
    case "claimed": {
      const beneficiary = data.beneficiary as string | undefined;
      const amount = data.amount as string | undefined;
      return `${beneficiary ? truncateAddress(beneficiary) : "User"} claimed ${amount ? formatAmount(amount, decimals) : "tokens"}`;
    }
    case "cancelled": {
      const claimedAtCancel = data.claimedAtCancel as string | undefined;
      return `Campaign cancelled${claimedAtCancel ? ` (${formatAmount(claimedAtCancel, decimals)} claimed at cancel)` : ""}`;
    }
    case "paused": {
      const paused = data.paused as boolean | undefined;
      return paused ? "Campaign paused" : "Campaign unpaused";
    }
    case "root_updated": {
      const newLeafCount = data.newLeafCount as number | undefined;
      return `Root updated${newLeafCount !== undefined ? ` — ${newLeafCount} recipients` : ""}`;
    }
    case "withdrawn": {
      const amount = data.amount as string | undefined;
      return `Creator withdrew ${amount ? formatAmount(amount, decimals) : "unvested tokens"}`;
    }
    case "milestone_released": {
      const idx = data.milestoneIdx as number | undefined;
      return `Milestone #${idx ?? "?"} released`;
    }
    case "stream_cancelled": {
      const toBeneficiary = data.amountToBeneficiary as string | undefined;
      const toCreator = data.amountToCreator as string | undefined;
      return `Stream settled${toBeneficiary ? ` — ${formatAmount(toBeneficiary, decimals)} to recipient` : ""}${toCreator ? `, ${formatAmount(toCreator, decimals)} to creator` : ""}`;
    }
    case "instant_refunded": {
      const refundedTo = data.refundedTo as string | undefined;
      const amount = data.amount as string | undefined;
      return `Instant refund${amount ? ` of ${formatAmount(amount, decimals)}` : ""}${refundedTo ? ` to ${truncateAddress(refundedTo)}` : ""}`;
    }
    default:
      return type;
  }
}
