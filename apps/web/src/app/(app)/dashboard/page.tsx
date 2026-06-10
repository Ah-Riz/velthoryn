"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCampaignList } from "@/hooks/useCampaignList";
import { useBeneficiaryCampaigns } from "@/hooks/useBeneficiaryCampaigns";
import { useLocalCampaigns } from "@/hooks/useLocalCampaigns";
import { useVestingProgressSummary } from "@/hooks/useVestingProgress";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatCard } from "@/components/ui/StatCard";
import { GracePeriodCountdown } from "@/components/campaign/detail/GracePeriodCountdown";
import { getRecipientStreamStatus, getSenderStreamStatus } from "@/lib/vesting/list";
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
      className="group flex items-start gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 transition-colors hover:border-violet-500/20 hover:bg-violet-500/[0.03]"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600/15 text-violet-400 transition-colors group-hover:bg-violet-600/25">
        {icon}
      </div>
      <div>
        <div className="text-[14px] font-medium text-white">{title}</div>
        <div className="mt-1 text-[12px] text-[#8b92a5]">{description}</div>
      </div>
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
      totalSupply: number | string;
      totalClaimed: number | string;
      creator: string;
      metadata?: { name?: string } | null;
    }>).filter((campaign) => campaign.creator === walletAddress);
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
  const { decimalsMap } = useMintDecimals(allMintAddresses);

  const vestingSingleMint = vestingMintAddresses.length === 1 ? vestingMintAddresses[0] : null;
  const vestingAggregateDecimals = vestingSingleMint
    ? (decimalsMap.get(vestingSingleMint) ?? null)
    : null;

  const tvlSingleMint = senderMintAddresses.length === 1 ? senderMintAddresses[0] : null;
  const tvlAggregateDecimals = tvlSingleMint ? (decimalsMap.get(tvlSingleMint) ?? null) : null;

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
      .filter((c) => c.cancelledAt !== null)
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

  const isLoading =
    senderQuery.isLoading || recipientQuery.isLoading || localCampaigns.isLoading;

  const claimableAmount = vestingSummary?.totalClaimable ?? 0n;
  const claimableStreams = vestingSummary?.claimableCampaigns ?? counts.claimableCount;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Dashboard</h1>
        <p className="mt-1 text-[13px] text-[#8b92a5]">
          {publicKey
            ? `Welcome back, ${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`
            : "Connect your wallet to get started"}
        </p>
      </div>

      {!publicKey ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] px-8 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600/15 text-violet-400">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M22 10H2" /><path d="M6 14h.01" />
            </svg>
          </div>
          <h2 className="mt-4 text-[15px] font-medium text-white">No wallet connected</h2>
          <p className="mt-1 text-[13px] text-[#8b92a5]">
            Connect your Solana wallet using the button in the top right to view your streams.
          </p>
        </div>
      ) : (
        <>
          {/* Claimable Banner */}
          {claimableStreams > 0 && (
            <Link
              href="/portfolio"
              className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-5 transition hover:border-emerald-500/40"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-[14px] font-medium text-emerald-400">
                  {claimableStreams} stream{claimableStreams > 1 ? "s" : ""} ready to claim!
                </p>
                <p className="text-[12px] text-[#8b92a5]">
                  {formatTokenAmount(claimableAmount, vestingAggregateDecimals)} tokens available for withdrawal. Click to view.
                </p>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#8b92a5]">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
          )}

          {/* Needs Attention */}
          {needsAttention.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-[13px] font-medium uppercase tracking-[0.1em] text-[#555d73]">
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
                      className="flex items-center gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-5 transition hover:border-amber-500/40"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400">
                        <span className="text-lg">⚠</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-[14px] font-medium text-amber-400">
                          {name} —{" "}
                          <GracePeriodCountdown cancelledAt={BigInt(campaign.cancelledAt!)} />
                        </p>
                        <p className="text-[12px] text-[#8b92a5]">
                          Recipients can still claim vested tokens before expiry.
                        </p>
                      </div>
                      <span className="text-[12px] font-medium text-amber-400">Claim Now →</span>
                    </Link>
                  );
                }
                return (
                  <Link
                    key={campaign.treeAddress}
                    href={`/campaign/${campaign.treeAddress}`}
                    className="flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/[0.05] p-5 transition hover:border-red-500/40"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/20 text-red-400">
                      <span className="text-lg">⚠</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-[14px] font-medium text-red-400">
                        {name} — Grace period expired
                      </p>
                      <p className="text-[12px] text-[#8b92a5]">
                        Unvested tokens can be withdrawn by the creator.
                      </p>
                    </div>
                    <span className="text-[12px] font-medium text-red-400">Withdraw Unvested →</span>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Summary Stats */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard label="Total Streams" value={isLoading ? "..." : String(counts.total)} sub="All campaigns" />
            <StatCard label="Active" value={isLoading ? "..." : String(counts.active)} sub="Currently vesting" accent />
            <StatCard
              label="TVL"
              value={isLoading ? "..." : formatTokenAmount(counts.tvl, tvlAggregateDecimals)}
              sub={mixedMintAggregateSub(senderMintAddresses.length, "Locked value")}
            />
            <StatCard label="As Sender" value={isLoading ? "..." : String(counts.sender)} sub="Streams you created" />
            <StatCard label="As Recipient" value={isLoading ? "..." : String(counts.recipient)} sub="Streams you receive" />
            <StatCard
              label="Claimable Now"
              value={vestingLoading ? "..." : formatTokenAmount(claimableAmount, vestingAggregateDecimals)}
              sub={mixedMintAggregateSub(
                vestingMintAddresses.length,
                claimableStreams > 0
                  ? `${claimableStreams} stream${claimableStreams > 1 ? "s" : ""} ready`
                  : "Ready to withdraw",
              )}
              accent
            />
          </div>

          {/* Vesting Progress Summary */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-medium uppercase tracking-[0.1em] text-[#555d73]">
                Vesting Progress
              </h2>
              {vestingCampaigns.length > 0 && (
                <Link href="/portfolio" className="text-[12px] text-violet-400 transition hover:text-violet-300">
                  View All →
                </Link>
              )}
            </div>

            {vestingLoading ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {[...Array(2)].map((_, i) => (
                  <div key={i} className="h-28 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />
                ))}
              </div>
            ) : topVestingCampaigns.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
                <p className="text-[13px] text-[#555d73]">No vesting streams yet.</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {topVestingCampaigns.map((campaign) => {
                  const name =
                    campaign.metadata?.name ?? truncateAddress(campaign.treeAddress);
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
                      className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 transition hover:border-violet-500/20"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[14px] font-medium text-white">{name}</span>
                        <span className="shrink-0 text-[11px] text-[#555d73]">
                          {getVestingTypeLabel(campaign.leaf.releaseType)}
                        </span>
                      </div>
                      <div className="mt-3">
                        <ProgressBar
                          percentage={campaign.progress.progressPercent}
                          size="sm"
                          colorClass={claimable > 0n ? "bg-emerald-500" : "bg-violet-500"}
                        />
                        <div className="mt-2 text-[11px] text-[#555d73]">
                          {fmtAmount(vestedSoFar, campaign)} / {fmtAmount(totalEntitled, campaign)} vested
                          {" · "}Next: {nextUnlockLabel}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent Activity */}
          <ActivityFeed address={walletAddress!} limit={10} />

          {/* Quick Actions */}
          <div>
            <h2 className="mb-3 text-[13px] font-medium uppercase tracking-[0.1em] text-[#555d73]">
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
        </>
      )}
    </div>
  );
}
