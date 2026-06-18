"use client";

import { useCampaignTimeline, type TimelineEvent } from "@/hooks/useCampaignTimeline";
import {
  EVENT_CONFIG,
  eventDescription,
  formatBlockTime,
  truncateSig,
} from "@/lib/vesting/timeline-helpers";
import { explorerTxUrl } from "@/lib/sol/cluster";

function TimelineItem({ event, mintDecimals, isLast }: { event: TimelineEvent; mintDecimals: number | null; isLast: boolean }) {
  const config = EVENT_CONFIG[event.type] ?? {
    icon: "•",
    color: "text-muted-foreground",
    label: event.type,
  };

  const explorerUrl = explorerTxUrl(event.signature);

  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center">
        <div
          className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-foreground/[0.04] text-[12px] ${config.color}`}
        >
          {config.icon}
        </div>
        {!isLast && <div className="mt-0.5 h-full w-px bg-foreground/[0.05]" />}
      </div>
      <div className="min-w-0 flex-1 pb-3.5">
        <p className="text-[13px] font-medium text-foreground/85">
          {eventDescription(event, mintDecimals)}
        </p>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground/50">
          <span className={`font-medium ${config.color} opacity-70`}>{config.label}</span>
          <span className="text-foreground/10">·</span>
          <span>{formatBlockTime(event.blockTime)}</span>
          <span className="text-foreground/10">·</span>
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono transition hover:text-foreground/60"
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
      <div className="rounded-2xl border border-foreground/[0.06] bg-background px-5 py-4">
        <h3 className="mb-3 text-[14px] font-semibold text-foreground">
          Activity
        </h3>
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="h-7 w-7 animate-pulse rounded-md bg-foreground/[0.06]" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-3/4 animate-pulse rounded bg-foreground/[0.06]" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-foreground/[0.06]" />
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
      <div className="rounded-2xl border border-foreground/[0.06] bg-background px-5 py-4">
        <h3 className="mb-3 text-[14px] font-semibold text-foreground">
          Activity
        </h3>
        <div className="flex flex-col items-center py-5 text-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground/[0.04] text-muted-foreground/40">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
            </svg>
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground/60">No events recorded yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-foreground/[0.06] bg-background px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-foreground">
          Activity
        </h3>
        {data.total > data.events.length && (
          <span className="text-[11px] text-muted-foreground/50">
            {data.events.length} of {data.total}
          </span>
        )}
      </div>
      <div>
        {data.events.map((event, i) => (
          <TimelineItem
            key={event.signature}
            event={event}
            mintDecimals={mintDecimals ?? null}
            isLast={i === data.events.length - 1}
          />
        ))}
      </div>
    </div>
  );
}
