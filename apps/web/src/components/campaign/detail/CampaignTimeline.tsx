"use client";

import { useCampaignTimeline, type TimelineEvent } from "@/hooks/useCampaignTimeline";
import {
  EVENT_CONFIG,
  eventDescription,
  formatBlockTime,
  truncateSig,
} from "@/lib/vesting/timeline-helpers";

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
