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
import { formatUsd } from "@/lib/vesting/display";
import { POPULAR_TOKENS } from "@/lib/constants/popular-tokens";
import { NATIVE_SOL_MINT_ADDRESS } from "@/lib/sol/auto-wrap";

function getMintSymbol(mint: string): string {
  if (mint === NATIVE_SOL_MINT_ADDRESS) return "SOL";
  return POPULAR_TOKENS.find((t) => t.mint === mint)?.symbol ?? mint.slice(0, 4).toUpperCase();
}

const API_MAX = 100;
const LOAD_INCREMENT = 20;

function ActivityFeedRow({
  event,
  mintDecimals,
  mintByTree,
  decimalsMap,
  pricesMap,
}: {
  event: ActivityEvent;
  mintDecimals?: number | null;
  mintByTree?: Map<string, string>;
  decimalsMap?: Map<string, number>;
  pricesMap?: Map<string, number | null>;
}) {
  const config = EVENT_CONFIG[event.type] ?? {
    icon: "•",
    color: "text-muted-foreground",
    label: event.type,
  };

  // Per-event decimal + mint lookup: treeAddress → mint → decimals
  const eventMint = mintByTree?.get(event.treeAddress) ?? null;
  const resolvedDecimals = (() => {
    if (eventMint && decimalsMap) return decimalsMap.get(eventMint) ?? null;
    return mintDecimals ?? null;
  })();

  // USD value for claim-type events
  const eventUsd = (() => {
    if (event.type !== "claimed" && event.type !== "withdrawn") return null;
    const rawAmount = event.data?.amount as string | undefined;
    if (!rawAmount || !eventMint || resolvedDecimals == null) return null;
    const price = pricesMap?.get(eventMint);
    if (!price || price === 0) return null;
    return (Number(rawAmount) / Math.pow(10, resolvedDecimals)) * price;
  })();

  const eventSymbol = eventMint ? getMintSymbol(eventMint) : null;
  const campaignLabel = event.campaignName ?? `${event.treeAddress.slice(0, 4)}...${event.treeAddress.slice(-4)}`;
  const explorerUrl = explorerTxUrl(event.signature);

  return (
    <div className="flex items-start gap-3 py-3">
      <div
        aria-hidden="true"
        className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-line bg-surface-hover text-[13px] ${config.color}`}
      >
        {config.icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-secondary-foreground">
          {eventDescription(event, resolvedDecimals)}
          {eventSymbol && (event.type === "claimed" || event.type === "withdrawn") && (
            <span className="ml-1 font-semibold text-foreground">{eventSymbol}</span>
          )}
        </p>
        {eventUsd !== null && eventUsd > 0 && (
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
            ≈ {formatUsd(eventUsd)}
          </div>
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
          <Link
            href={`/campaign/${event.treeAddress}`}
            className="transition hover:text-accent-light"
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
            className="transition hover:text-secondary-foreground"
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
          <div className="h-7 w-7 animate-pulse rounded-lg bg-foreground/10" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-foreground/10" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-foreground/10" />
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
  mintByTree,
  decimalsMap,
  pricesMap,
  viewAllHref,
}: {
  address: string;
  limit?: number;
  mintDecimals?: number | null;
  mintByTree?: Map<string, string>;
  decimalsMap?: Map<string, number>;
  pricesMap?: Map<string, number | null>;
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
    <div className="rounded-2xl border border-line bg-muted p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Recent Activity
        </h3>
        <div className="flex items-center gap-3">
          {data && data.total > 0 && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {data.events.length} of {data.total}
            </span>
          )}
          {viewAllHref && hasMore && (
            <Link
              href={viewAllHref}
              className="font-mono text-[11px] text-primary transition hover:text-accent-light"
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
          <div aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface-hover text-muted-foreground">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <p className="font-mono text-[12px] text-muted-foreground">No activity yet</p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-border">
            {data.events.map((event) => (
              <ActivityFeedRow
                key={`${event.signature}-${event.type}`}
                event={event}
                mintDecimals={mintDecimals}
                mintByTree={mintByTree}
                decimalsMap={decimalsMap}
                pricesMap={pricesMap}
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
              className="mt-3 w-full rounded-xl border border-line bg-muted px-4 py-2.5 font-mono text-[11px] text-muted-foreground transition hover:border-line-hover hover:text-secondary-foreground"
            >
              Load {nextBatch} more
              <span className="ml-1.5 text-muted-foreground">· {remaining} remaining</span>
            </button>
          )}

          {atApiMax && hasMore && (
            <p className="mt-3 text-center font-mono text-[10px] text-muted-foreground">
              Showing latest {API_MAX} events
              {viewAllHref && (
                <>
                  {" · "}
                  <Link href={viewAllHref} className="text-primary transition hover:text-accent-light">
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
