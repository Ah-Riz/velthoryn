"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCampaignList } from "@/hooks/useCampaignList";
import { useBeneficiaryCampaigns } from "@/hooks/useBeneficiaryCampaigns";
import { useLocalCampaigns } from "@/hooks/useLocalCampaigns";
import { useVestingProgressSummary } from "@/hooks/useVestingProgress";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { StatCard } from "@/components/ui/StatCard";
import { GracePeriodCountdown } from "@/components/campaign/detail/GracePeriodCountdown";
import { getRecipientStreamStatus, getSenderStreamStatus } from "@/lib/vesting/list";
import { isStreamSettledLocal } from "@/lib/stream/persist";
import {
  formatCountdown,
  formatTokenAmount,
  getGracePeriodState,
  getVestingTypeLabel,
  mixedMintAggregateSub,
} from "@/lib/vesting/display";
import { useMintDecimals } from "@/hooks/useMintDecimals";
import { truncateAddress } from "@/lib/vesting/timeline-helpers";

function ActionCard({
  href,
  title,
  description,
  icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 sm:gap-4 rounded-xl sm:rounded-2xl border border-line bg-muted p-3.5 sm:p-5 transition-all hover:border-primary/30 hover:bg-surface-hover"
    >
      <div className="flex h-8 w-8 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-lg sm:rounded-xl border border-primary/20 bg-primary/10 text-accent-light transition-all group-hover:border-primary/40 group-hover:bg-primary/20">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] sm:text-[14px] font-medium text-foreground">{title}</div>
        <div className="mt-0.5 sm:mt-1 text-[11px] sm:text-[12px] text-muted-foreground">{description}</div>
      </div>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </Link>
  );
}

export default function DashboardPage() {
  const { publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58();

  const senderQuery = useCampaignList(walletAddress ? { creator: walletAddress, limit: 200 } : undefined);
  const recipientQuery = useBeneficiaryCampaigns(walletAddress);
  const localCampaigns = useLocalCampaigns(walletAddress);
  const { summary: vestingSummary, isLoading: vestingLoading, campaigns: vestingCampaigns } =
    useVestingProgressSummary(walletAddress);

  const vestingMintAddresses = useMemo(
    () => [...new Set(vestingCampaigns.map((c) => c.mint).filter(Boolean))],
    [vestingCampaigns],
  );

  const senderCampaigns = useMemo(() => {
    const dbCampaigns = ((senderQuery.data?.campaigns ?? []) as Array<{
      treeAddress: string;
      mint: string;
      paused: boolean;
      cancelledAt: number | null;
      instantRefunded: boolean;
      streamSettled: boolean;
      totalSupply: number | string;
      totalClaimed: number | string;
      creator: string;
      metadata?: { name?: string } | null;
    }>).filter((campaign) => campaign.creator === walletAddress).map((campaign) => {
      if (!campaign.streamSettled && isStreamSettledLocal(campaign.treeAddress)) {
        return { ...campaign, streamSettled: true };
      }
      return campaign;
    });
    const seen = new Set(dbCampaigns.map((c) => c.treeAddress));
    const localOnly = senderQuery.error
      ? localCampaigns.senderCampaigns.filter((c) => !seen.has(c.treeAddress))
      : [];
    return [...dbCampaigns, ...localOnly];
  }, [senderQuery.data?.campaigns, senderQuery.error, localCampaigns.senderCampaigns, walletAddress]);

  const senderMintAddresses = useMemo(
    () => [...new Set(senderCampaigns.map((c) => c.mint).filter(Boolean))],
    [senderCampaigns],
  );

  const allMintAddresses = useMemo(
    () => [...new Set([...vestingMintAddresses, ...senderMintAddresses])],
    [vestingMintAddresses, senderMintAddresses],
  );
  const { decimalsMap, isLoading: decimalsLoading } = useMintDecimals(allMintAddresses);

  const vestingAggregateDecimals = useMemo(() => {
    if (vestingMintAddresses.length === 0) return null;
    const vals = vestingMintAddresses.map((m) => decimalsMap.get(m));
    if (vals.some((d) => d === undefined)) return null;
    const unique = new Set(vals);
    return unique.size === 1 ? (vals[0] ?? null) : null;
  }, [vestingMintAddresses, decimalsMap]);

  const activityMintDecimals = useMemo(() => {
    if (allMintAddresses.length === 0) return null;
    const vals = allMintAddresses.map((m) => decimalsMap.get(m));
    if (vals.some((d) => d === undefined)) return null;
    const unique = new Set(vals);
    return unique.size === 1 ? (vals[0] ?? null) : null;
  }, [allMintAddresses, decimalsMap]);

  const tvlAggregateDecimals = useMemo(() => {
    if (senderMintAddresses.length === 0) return null;
    const vals = senderMintAddresses.map((m) => decimalsMap.get(m));
    if (vals.some((d) => d === undefined)) return null;
    const unique = new Set(vals);
    return unique.size === 1 ? (vals[0] ?? null) : null;
  }, [senderMintAddresses, decimalsMap]);

  function fmtAmount(raw: bigint, campaign: (typeof vestingCampaigns)[number]): string {
    return formatTokenAmount(raw, decimalsMap.get(campaign.mint) ?? null);
  }

  const recipientCampaigns = useMemo(() => {
    const dbCampaigns = (recipientQuery.data?.campaigns ?? []) as Array<{
      treeAddress: string;
      creator: string;
      paused: boolean;
      cancelledAt: number | null;
      myClaimed: number | string;
      myLeaf: {
        amount: number | string;
        releaseType: number;
        cliffTime: number;
        endTime: number;
      };
    }>;
    const seen = new Set(dbCampaigns.map((c) => c.treeAddress));
    const localOnly = recipientQuery.error
      ? localCampaigns.recipientCampaigns.filter((c) => !seen.has(c.treeAddress))
      : [];
    return [...dbCampaigns, ...localOnly];
  }, [recipientQuery.data?.campaigns, recipientQuery.error, localCampaigns.recipientCampaigns]);

  const rows = useMemo(() => {
    const nowTs = BigInt(Math.floor(Date.now() / 1000));
    const map = new Map<
      string,
      {
        role: "sender" | "recipient" | "both";
        senderStatus?: ReturnType<typeof getSenderStreamStatus>;
        recipientStatus?: ReturnType<typeof getRecipientStreamStatus>;
      }
    >();

    for (const campaign of senderCampaigns) {
      map.set(campaign.treeAddress, {
        role: "sender",
        senderStatus: getSenderStreamStatus(campaign),
      });
    }

    for (const campaign of recipientCampaigns) {
      const existing = map.get(campaign.treeAddress);
      const recipientStatus = getRecipientStreamStatus(campaign, nowTs);
      if (existing) {
        map.set(campaign.treeAddress, {
          ...existing,
          role: campaign.creator === walletAddress ? "both" : "recipient",
          recipientStatus,
        });
      } else {
        map.set(campaign.treeAddress, {
          role: "recipient",
          recipientStatus,
        });
      }
    }

    return [...map.entries()];
  }, [recipientCampaigns, senderCampaigns, walletAddress]);

  const counts = useMemo(() => {
    const activeCount = rows.filter(
      ([, row]) => row.senderStatus === "Active" || row.recipientStatus === "Claimable",
    ).length;

    let tvl = 0n;
    for (const c of senderCampaigns) {
      const supply = BigInt(c.totalSupply?.toString() ?? "0");
      const claimed = BigInt(c.totalClaimed?.toString() ?? "0");
      if (supply > claimed) tvl += supply - claimed;
    }

    let claimableCount = 0;
    for (const [, row] of rows) {
      if (row.recipientStatus === "Claimable") claimableCount += 1;
    }

    return {
      total: rows.length,
      active: activeCount,
      sender: rows.filter(([, row]) => row.role === "sender" || row.role === "both").length,
      recipient: rows.filter(([, row]) => row.role === "recipient" || row.role === "both").length,
      tvl,
      claimableCount,
    };
  }, [rows, senderCampaigns]);

  const nowTs = BigInt(Math.floor(Date.now() / 1000));

  const needsAttention = useMemo(() => {
    return senderCampaigns
      .filter((c) => getSenderStreamStatus(c) === "Grace Period")
      .map((c) => ({
        campaign: c,
        graceState: getGracePeriodState(BigInt(c.cancelledAt!), nowTs),
      }))
      .filter(
        ({ graceState }) =>
          graceState.status === "grace_active" || graceState.status === "grace_expired",
      );
  }, [senderCampaigns, nowTs]);

  const topVestingCampaigns = useMemo(() => {
    return [...vestingCampaigns]
      .sort(
        (a, b) =>
          Number(BigInt(b.progress.claimable) - BigInt(a.progress.claimable)),
      )
      .slice(0, 5);
  }, [vestingCampaigns]);

  // Count-based stats only need sender/recipient DB queries to resolve.
  // localCampaigns is a fallback (only used on DB error) — don't block counts on its slow RPC fetch.
  const countLoading = senderQuery.isLoading || recipientQuery.isLoading;
  // TVL needs sender mint decimals; other count cards don't.
  const tvlLoading = countLoading || (senderMintAddresses.length > 0 && decimalsLoading);

  const claimableAmount = vestingSummary?.totalClaimable ?? 0n;
  const claimableStreams = vestingSummary?.claimableCampaigns ?? counts.claimableCount;

  return (
    <div className="mx-auto max-w-5xl space-y-5 sm:space-y-8">
      <div>
        <div className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-primary/70">Overview</div>
        <h1 className="text-[22px] sm:text-[28px] font-semibold tracking-tight text-foreground">Dashboard</h1>
        <p className="mt-1 font-mono text-[12px] text-muted-foreground">
          {publicKey
            ? `Welcome back, ${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`
            : "Connect your wallet to get started"}
        </p>
      </div>

      {!publicKey ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-muted/60 px-8 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-accent-light">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M22 10H2" /><path d="M6 14h.01" />
            </svg>
          </div>
          <h2 className="mt-4 text-[15px] font-medium text-foreground">No wallet connected</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Connect your Solana wallet using the button in the top right to view your streams.
          </p>
        </div>
      ) : (
        <>
          {/* Claimable Banner */}
          {claimableStreams > 0 && (
            <Link
              href="/portfolio"
              className="flex items-center gap-2.5 sm:gap-3 rounded-xl sm:rounded-2xl border border-violet/20 bg-violet/[0.04] p-3.5 sm:p-5 transition-all hover:border-violet/35 hover:bg-violet/[0.06]"
            >
              <div className="flex h-8 w-8 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-lg sm:rounded-xl border border-violet/20 bg-violet/10 text-violet">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="sm:h-5 sm:w-5">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] sm:text-[14px] font-medium text-violet">
                  {claimableStreams} stream{claimableStreams > 1 ? "s" : ""} ready to claim
                </p>
                <p className="font-mono text-[10px] sm:text-[11px] text-muted-foreground truncate">
                  {formatTokenAmount(claimableAmount, vestingAggregateDecimals)} tokens available
                </p>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-muted-foreground">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
          )}

          {/* Needs Attention */}
          {needsAttention.length > 0 && (
            <div className="space-y-3">
              <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Needs Attention
              </h2>
              {needsAttention.map(({ campaign, graceState }) => {
                const name =
                  campaign.metadata?.name ?? truncateAddress(campaign.treeAddress);
                if (graceState.status === "grace_active") {
                  return (
                    <Link
                      key={campaign.treeAddress}
                      href={`/campaign/${campaign.treeAddress}`}
                      className="flex items-center gap-3 rounded-2xl border border-amber-500/25 bg-muted p-5 transition-all hover:border-amber-500/40"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                      </div>
                      <div className="flex-1">
                        <p className="text-[14px] font-medium text-amber-700 dark:text-amber-400">
                          {name} —{" "}
                          <GracePeriodCountdown cancelledAt={BigInt(campaign.cancelledAt!)} />
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          Recipients can still claim vested tokens before expiry
                        </p>
                      </div>
                      <span className="font-mono text-[11px] font-medium text-amber-700 dark:text-amber-400">Claim Now →</span>
                    </Link>
                  );
                }
                return (
                  <Link
                    key={campaign.treeAddress}
                    href={`/campaign/${campaign.treeAddress}`}
                    className="flex items-center gap-3 rounded-2xl border border-red-500/25 bg-muted p-5 transition-all hover:border-red-500/40"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    </div>
                    <div className="flex-1">
                      <p className="text-[14px] font-medium text-red-700 dark:text-red-400">
                        {name} — Grace period expired
                      </p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        Unvested tokens can be withdrawn by the creator
                      </p>
                    </div>
                    <span className="font-mono text-[11px] font-medium text-red-700 dark:text-red-400">Withdraw →</span>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Quick Actions */}
          <div>
            <h2 className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Quick Actions
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <ActionCard
                href="/campaign/create"
                title="Create New Stream"
                description="Set up a new vesting stream for token distribution"
                icon={
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="16" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                }
              />
              <ActionCard
                href="/campaigns"
                title="View My Campaigns"
                description="Monitor and manage your existing vesting streams"
                icon={
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                }
              />
            </div>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-3">
            <StatCard label="Total Streams" value={String(counts.total)} sub="All campaigns" loading={countLoading} />
            <StatCard label="Active" value={String(counts.active)} sub="Currently vesting" accent loading={countLoading} />
            <StatCard
              label="TVL"
              value={formatTokenAmount(counts.tvl, tvlAggregateDecimals)}
              sub={mixedMintAggregateSub(tvlAggregateDecimals !== null ? 1 : senderMintAddresses.length, "Locked value")}
              loading={tvlLoading}
            />
            <StatCard label="As Sender" value={String(counts.sender)} sub="Streams you created" loading={countLoading} />
            <StatCard label="As Recipient" value={String(counts.recipient)} sub="Streams you receive" loading={countLoading} />
            <StatCard
              label="Claimable Now"
              value={formatTokenAmount(claimableAmount, vestingAggregateDecimals)}
              sub={mixedMintAggregateSub(
                vestingAggregateDecimals !== null ? 1 : vestingMintAddresses.length,
                claimableStreams > 0
                  ? `${claimableStreams} stream${claimableStreams > 1 ? "s" : ""} ready`
                  : "Ready to withdraw",
              )}
              accent
              loading={vestingLoading || (vestingMintAddresses.length > 0 && decimalsLoading)}
            />
          </div>

          {/* Vesting Progress Summary */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Vesting Progress
              </h2>
              {vestingCampaigns.length > 0 && (
                <Link href="/portfolio" className="text-[12px] text-violet-700 dark:text-violet-400 transition hover:text-violet-700 dark:text-violet-300">
                  View All →
                </Link>
              )}
            </div>

            {vestingLoading || (vestingMintAddresses.length > 0 && decimalsLoading) ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {[...Array(2)].map((_, i) => (
                  <div key={i} className="h-28 animate-pulse rounded-2xl border border-line bg-foreground/10" />
                ))}
              </div>
            ) : topVestingCampaigns.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-muted/60 px-8 py-10 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface-hover text-muted-foreground">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                </div>
                <p className="mt-3 text-[13px] font-medium text-secondary-foreground">No vesting streams yet</p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">Streams you receive will appear here</p>
              </div>
            ) : (
              <VestingProgressGrid
                campaigns={topVestingCampaigns}
                fmtAmount={fmtAmount}
                nowTs={nowTs}
              />
            )}
          </div>

          {/* Recent Activity */}
          <ActivityFeed
            address={walletAddress!}
            limit={10}
            mintDecimals={activityMintDecimals}
            viewAllHref="/activity"
          />
        </>
      )}
    </div>
  );
}

const MOBILE_VESTING_LIMIT = 2;

function VestingProgressGrid({
  campaigns,
  fmtAmount,
  nowTs,
}: {
  campaigns: ReturnType<typeof useVestingProgressSummary>["campaigns"];
  fmtAmount: (raw: bigint, campaign: ReturnType<typeof useVestingProgressSummary>["campaigns"][number]) => string;
  nowTs: bigint;
}) {
  const [expanded, setExpanded] = useState(false);
  const showExpand = campaigns.length > MOBILE_VESTING_LIMIT;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {campaigns.map((campaign, idx) => {
          const name = campaign.metadata?.name ?? truncateAddress(campaign.treeAddress);
          const vestedSoFar = BigInt(campaign.progress.vestedSoFar);
          const totalEntitled = BigInt(campaign.progress.totalEntitled);
          const claimable = BigInt(campaign.progress.claimable);
          const nextUnlockLabel =
            campaign.leaf.releaseType === 2 && !campaign.milestoneReleased
              ? "Milestone not released"
              : campaign.progress.nextUnlock
                ? formatCountdown(BigInt(campaign.progress.nextUnlock), nowTs)
                : "Complete";

          return (
            <Link
              key={`${campaign.treeAddress}-${campaign.leaf.leafIndex}`}
              href={`/campaign/${campaign.treeAddress}`}
              className={`rounded-xl border border-line bg-muted p-3 sm:rounded-2xl sm:p-4 transition-all hover:border-primary/25 hover:bg-surface-hover ${
                !expanded && showExpand && idx >= MOBILE_VESTING_LIMIT ? "hidden sm:block" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] sm:text-[14px] font-medium text-foreground">{name}</span>
                <span className="shrink-0 font-mono text-[10px] tracking-[0.1em] text-muted-foreground">
                  {getVestingTypeLabel(campaign.leaf.releaseType)}
                </span>
              </div>
              <div className="mt-2 sm:mt-3">
                <div className="h-1 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full transition-all duration-500 ease-out"
                    style={{
                      width: `${Math.min(100, campaign.progress.progressPercent)}%`,
                      background: claimable > 0n
                        ? "linear-gradient(90deg, #7c3aed, #14f1d9)"
                        : "#7c3aed",
                    }}
                  />
                </div>
                <div className="mt-1.5 sm:mt-2 font-mono text-[10px] text-muted-foreground">
                  {fmtAmount(vestedSoFar, campaign)} / {fmtAmount(totalEntitled, campaign)} vested
                  {" · "}Next: {nextUnlockLabel}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      {showExpand && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 w-full rounded-xl border border-dashed border-line py-2 text-center font-mono text-[11px] text-muted-foreground transition hover:border-primary/30 hover:text-violet-700 dark:text-violet-400 sm:hidden"
        >
          Show {campaigns.length - MOBILE_VESTING_LIMIT} more streams
        </button>
      )}
    </>
  );
}
