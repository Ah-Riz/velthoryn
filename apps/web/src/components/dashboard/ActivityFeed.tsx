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
        className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-[#222838] bg-[#161a25] text-[13px] ${config.color}`}
      >
        {config.icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-[#b4b9c5]">
          {eventDescription(event, mintDecimals ?? null)}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-[#64748b]">
          <Link
            href={`/campaign/${event.treeAddress}`}
            className="transition hover:text-[#a78bfa]"
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
            className="transition hover:text-[#b4b9c5]"
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
          <div className="h-7 w-7 animate-pulse rounded-lg bg-[#1c2130]" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-[#1c2130]" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-[#1c2130]" />
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
    <div className="rounded-2xl border border-[#222838] bg-[#13161f] p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[#64748b]">
          Recent Activity
        </h3>
        {data && data.total > data.events.length && (
          <span className="font-mono text-[10px] text-[#64748b]">
            {data.events.length} of {data.total}
          </span>
        )}
      </div>

      {isLoading ? (
        <ActivityFeedSkeleton />
      ) : !data || data.events.length === 0 ? (
        <p className="font-mono text-[12px] text-[#64748b]">No recent activity</p>
      ) : (
        <div className="divide-y divide-[#1c2130]">
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
