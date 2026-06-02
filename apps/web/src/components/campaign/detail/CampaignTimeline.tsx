"use client";

import { useCampaignTimeline, type TimelineEvent } from "@/hooks/useCampaignTimeline";

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function truncateSig(sig: string): string {
  if (sig.length <= 16) return sig;
  return `${sig.slice(0, 8)}...${sig.slice(-4)}`;
}

function formatBlockTime(blockTime: string): string {
  const ts = Number(blockTime);
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAmount(raw: string, decimals: number | null): string {
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

const EVENT_CONFIG: Record<
  TimelineEvent["type"],
  { icon: string; color: string; label: string }
> = {
  claimed: { icon: "↓", color: "text-green-400", label: "Claimed" },
  cancelled: { icon: "✕", color: "text-red-400", label: "Campaign Cancelled" },
  paused: { icon: "⏸", color: "text-yellow-400", label: "Paused" },
  root_updated: { icon: "↻", color: "text-blue-400", label: "Root Updated" },
  withdrawn: { icon: "↑", color: "text-amber-400", label: "Unvested Withdrawn" },
  milestone_released: { icon: "◆", color: "text-purple-400", label: "Milestone Released" },
  stream_cancelled: { icon: "⚡", color: "text-orange-400", label: "Stream Settled" },
};

function eventDescription(event: TimelineEvent, decimals: number | null): string {
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
    default:
      return type;
  }
}

function TimelineItem({ event, mintDecimals }: { event: TimelineEvent; mintDecimals: number | null }) {
  const config = EVENT_CONFIG[event.type] ?? {
    icon: "•",
    color: "text-[#8b92a5]",
    label: event.type,
  };

  const explorerUrl = `https://explorer.solana.com/tx/${event.signature}?cluster=devnet`;

  return (
    <div className="flex items-start gap-3 py-2.5">
      <div
        className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-[13px] ${config.color}`}
      >
        {config.icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-[#c8cdd8]">
          {eventDescription(event, mintDecimals)}
        </p>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[#555d73]">
          <span>{formatBlockTime(event.blockTime)}</span>
          <span>·</span>
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="transition hover:text-[#8b92a5]"
          >
            {truncateSig(event.signature)}
          </a>
        </div>
      </div>
    </div>
  );
}

export function CampaignTimeline({
  treeAddress,
  mintDecimals,
}: {
  treeAddress: string;
  mintDecimals?: number | null;
}) {
  const { data, isLoading, error } = useCampaignTimeline(treeAddress);

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-[#0d1017] p-5">
        <h3 className="mb-3 text-[13px] font-medium uppercase tracking-wider text-[#555d73]">
          Activity
        </h3>
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="h-7 w-7 animate-pulse rounded-lg bg-white/[0.04]" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-3/4 animate-pulse rounded bg-white/[0.04]" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-white/[0.04]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return null;
  }

  if (data.events.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-[#0d1017] p-5">
        <h3 className="mb-3 text-[13px] font-medium uppercase tracking-wider text-[#555d73]">
          Activity
        </h3>
        <p className="text-[13px] text-[#555d73]">No events recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[#0d1017] p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-medium uppercase tracking-wider text-[#555d73]">
          Activity
        </h3>
        {data.total > data.events.length && (
          <span className="text-[11px] text-[#555d73]">
            Showing {data.events.length} of {data.total}
          </span>
        )}
      </div>
      <div className="divide-y divide-white/[0.04]">
        {data.events.map((event) => (
          <TimelineItem key={event.signature} event={event} mintDecimals={mintDecimals ?? null} />
        ))}
      </div>
    </div>
  );
}
