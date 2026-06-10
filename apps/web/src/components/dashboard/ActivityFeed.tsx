"use client";

import { useState } from "react";
import Link from "next/link";
import { useRecentActivity, type ActivityEvent } from "@/hooks/useRecentActivity";
import {
  EVENT_CONFIG,
  eventDescription,
  formatBlockTime,
  truncateSig,
} from "@/lib/vesting/timeline-helpers";
import { explorerTxUrl } from "@/lib/sol/cluster";

const API_MAX = 100;
const LOAD_INCREMENT = 20;

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
        aria-hidden="true"
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
            aria-label={`View transaction ${event.signature} on Solana Explorer`}
            className="transition hover:text-[#b4b9c5]"
          >
            {truncateSig(event.signature)}
          </a>
        </div>
      </div>
    </div>
  );
}

function ActivityFeedSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {[...Array(rows)].map((_, i) => (
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
  viewAllHref,
}: {
  address: string;
  limit?: number;
  mintDecimals?: number | null;
  viewAllHref?: string;
}) {
  const [currentLimit, setCurrentLimit] = useState(limit);
  const { data, isLoading, isFetching } = useRecentActivity(address, currentLimit);

  const hasMore = data !== undefined && data.total > data.events.length;
  const atApiMax = currentLimit >= API_MAX;
  const canLoadMore = hasMore && !atApiMax;
  const remaining = data ? data.total - data.events.length : 0;
  const nextBatch = Math.min(LOAD_INCREMENT, API_MAX - currentLimit);

  return (
    <div className="rounded-2xl border border-[#222838] bg-[#13161f] p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[#64748b]">
          Recent Activity
        </h3>
        <div className="flex items-center gap-3">
          {data && data.total > 0 && (
            <span className="font-mono text-[10px] text-[#64748b]">
              {data.events.length} of {data.total}
            </span>
          )}
          {viewAllHref && hasMore && (
            <Link
              href={viewAllHref}
              className="font-mono text-[11px] text-[#7c3aed] transition hover:text-[#a78bfa]"
            >
              View all →
            </Link>
          )}
        </div>
      </div>

      {isLoading ? (
        <ActivityFeedSkeleton />
      ) : !data || data.events.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <div aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#222838] bg-[#161a25] text-[#64748b]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <p className="font-mono text-[12px] text-[#64748b]">No activity yet</p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-[#1c2130]">
            {data.events.map((event) => (
              <ActivityFeedRow
                key={`${event.signature}-${event.type}`}
                event={event}
                mintDecimals={mintDecimals}
              />
            ))}
          </div>

          {isFetching && !isLoading && (
            <ActivityFeedSkeleton rows={3} />
          )}

          {canLoadMore && !isFetching && (
            <button
              type="button"
              onClick={() => setCurrentLimit((prev) => Math.min(prev + nextBatch, API_MAX))}
              className="mt-3 w-full rounded-xl border border-[#222838] bg-[#13161f] px-4 py-2.5 font-mono text-[11px] text-[#64748b] transition hover:border-[#2e3648] hover:text-[#b4b9c5]"
            >
              Load {nextBatch} more
              <span className="ml-1.5 text-[#3d4a5e]">· {remaining} remaining</span>
            </button>
          )}

          {atApiMax && hasMore && (
            <p className="mt-3 text-center font-mono text-[10px] text-[#64748b]">
              Showing latest {API_MAX} events
              {viewAllHref && (
                <>
                  {" · "}
                  <Link href={viewAllHref} className="text-[#7c3aed] transition hover:text-[#a78bfa]">
                    view full history
                  </Link>
                </>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
