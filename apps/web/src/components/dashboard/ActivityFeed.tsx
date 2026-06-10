"use client";

import Link from "next/link";
import { useRecentActivity, type ActivityEvent } from "@/hooks/useRecentActivity";
import {
  EVENT_CONFIG,
  eventDescription,
  formatBlockTime,
  truncateSig,
} from "@/lib/vesting/timeline-helpers";
import { explorerTxUrl } from "@/lib/sol/cluster";

function ActivityFeedRow({
  event,
  mintDecimals,
}: {
  event: ActivityEvent;
  mintDecimals?: number | null;
}) {
  const config = EVENT_CONFIG[event.type] ?? {
    icon: "•",
    color: "text-[#8b92a5]",
    label: event.type,
  };

  const campaignLabel = event.campaignName ?? `${event.treeAddress.slice(0, 4)}...${event.treeAddress.slice(-4)}`;
  const explorerUrl = explorerTxUrl(event.signature);

  return (
    <div className="flex items-start gap-3 py-3">
      <div
        className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-[13px] ${config.color}`}
      >
        {config.icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-[#c8cdd8]">
          {eventDescription(event, mintDecimals ?? null)}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#555d73]">
          <Link
            href={`/campaign/${event.treeAddress}`}
            className="transition hover:text-violet-400"
          >
            {campaignLabel}
          </Link>
          <span>·</span>
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

function ActivityFeedSkeleton() {
  return (
    <div className="space-y-3">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-start gap-3 py-1">
          <div className="h-7 w-7 animate-pulse rounded-lg bg-white/[0.04]" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-white/[0.04]" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.04]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ActivityFeed({
  address,
  limit = 20,
  mintDecimals,
}: {
  address: string;
  limit?: number;
  mintDecimals?: number | null;
}) {
  const { data, isLoading } = useRecentActivity(address, limit);

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-medium uppercase tracking-[0.1em] text-[#555d73]">
          Recent Activity
        </h3>
        {data && data.total > data.events.length && (
          <span className="text-[11px] text-[#555d73]">
            Showing {data.events.length} of {data.total}
          </span>
        )}
      </div>

      {isLoading ? (
        <ActivityFeedSkeleton />
      ) : !data || data.events.length === 0 ? (
        <p className="text-[13px] text-[#555d73]">No recent activity</p>
      ) : (
        <div className="divide-y divide-white/[0.04]">
          {data.events.map((event) => (
            <ActivityFeedRow
              key={`${event.signature}-${event.type}`}
              event={event}
              mintDecimals={mintDecimals}
            />
          ))}
        </div>
      )}
    </div>
  );
}
