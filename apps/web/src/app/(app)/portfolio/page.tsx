"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  useVestingProgressSummary,
  type VestingProgressCampaign,
} from "@/hooks/useVestingProgress";
import { StatusBadge } from "@/components/campaign/list/StatusBadge";
import {
  formatCountdown,
  formatTokenAmount,
  getVestingTypeBadgeColor,
  getVestingTypeLabel,
  mixedMintAggregateSub,
} from "@/lib/vesting/display";
import { useMintDecimals } from "@/hooks/useMintDecimals";
import { truncateAddress } from "@/lib/vesting/timeline-helpers";
import type { StreamStatus } from "@/lib/vesting/list";

type SortKey = "claimable" | "progress" | "nextUnlock";

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#555d73]">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold ${accent ? "text-violet-400" : "text-white"}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-[12px] text-[#555d73]">{sub}</div>}
    </div>
  );
}

function getCampaignStatus(campaign: VestingProgressCampaign): StreamStatus {
  const claimable = BigInt(campaign.progress.claimable);
  const entitled = BigInt(campaign.progress.totalEntitled);
  const claimed = BigInt(campaign.progress.claimedSoFar);

  if (entitled > 0n && claimed >= entitled) return "Claimed";
  if (campaign.cancelledAt !== null) return "Cancelled";
  if (campaign.paused) return "Paused";
  if (claimable > 0n) return "Claimable";
  if (campaign.leaf.releaseType === 2 && !campaign.milestoneReleased) return "Scheduled";
  return "Active";
}

function formatNextUnlock(
  campaign: VestingProgressCampaign,
  nowTs: bigint,
): string {
  if (campaign.leaf.releaseType === 2 && !campaign.milestoneReleased) {
    return "Milestone not released";
  }
  if (!campaign.progress.nextUnlock) return "Fully vested";
  return formatCountdown(BigInt(campaign.progress.nextUnlock), nowTs);
}

function CampaignCard({
  campaign,
  nowTs,
  fmtAmount,
}: {
  campaign: VestingProgressCampaign;
  nowTs: bigint;
  fmtAmount: (raw: bigint, campaign: VestingProgressCampaign) => string;
}) {
  const name =
    campaign.metadata?.name ??
    truncateAddress(campaign.treeAddress);
  const status = getCampaignStatus(campaign);
  const claimable = BigInt(campaign.progress.claimable);
  const typeLabel = getVestingTypeLabel(campaign.leaf.releaseType);
  const typeBadgeColor = getVestingTypeBadgeColor(campaign.leaf.releaseType);

  return (
    <Link
      href={`/campaign/${campaign.treeAddress}`}
      className="group block rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 transition-colors hover:border-violet-500/20 hover:bg-violet-500/[0.03]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-medium text-white group-hover:text-violet-300">
            {name}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${typeBadgeColor}`}
          >
            {typeLabel}
          </span>
          <StatusBadge status={status} />
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-[11px] text-[#555d73]">
          <span>Progress</span>
          <span>{campaign.progress.progressPercent.toFixed(1)}%</span>
        </div>
        <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className={`h-full rounded-full transition-all ${
              claimable > 0n ? "bg-emerald-500" : status === "Claimed" ? "bg-sky-500" : "bg-violet-500"
            }`}
            style={{ width: `${Math.min(100, campaign.progress.progressPercent)}%` }}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-[12px] sm:grid-cols-2">
        <div className="text-[#8b92a5]">
          Entitled: <span className="text-white">{fmtAmount(BigInt(campaign.progress.totalEntitled), campaign)}</span>
        </div>
        <div className="text-[#8b92a5]">
          Vested: <span className="text-white">{fmtAmount(BigInt(campaign.progress.vestedSoFar), campaign)}</span>
        </div>
        <div className="text-[#8b92a5]">
          Claimed: <span className="text-white">{fmtAmount(BigInt(campaign.progress.claimedSoFar), campaign)}</span>
        </div>
        <div className="text-[#8b92a5]">
          Claimable: <span className={claimable > 0n ? "text-emerald-400" : "text-white"}>
            {fmtAmount(claimable, campaign)}
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-[12px] text-[#555d73]">
          Next unlock: {formatNextUnlock(campaign, nowTs)}
        </span>
        {claimable > 0n && (
          <span className="text-[12px] font-medium text-emerald-400">
            Claim →
          </span>
        )}
      </div>
    </Link>
  );
}

function PortfolioSkeleton() {
  return (
    <div className="grid gap-4">
      {[...Array(3)].map((_, i) => (
        <div
          key={i}
          className="h-48 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]"
        />
      ))}
    </div>
  );
}

export default function PortfolioPage() {
  const { publicKey } = useWallet();
  const address = publicKey?.toBase58();
  const { summary, isLoading, campaigns } = useVestingProgressSummary(address);
  const [sortKey, setSortKey] = useState<SortKey>("claimable");

  const mintAddresses = useMemo(
    () => [...new Set(campaigns.map((c) => c.mint).filter(Boolean))],
    [campaigns],
  );
  const { decimalsMap } = useMintDecimals(mintAddresses);

  const singleMint = mintAddresses.length === 1 ? mintAddresses[0] : null;
  const aggregateDecimals = singleMint ? (decimalsMap.get(singleMint) ?? null) : null;

  function fmtAmount(raw: bigint, campaign: VestingProgressCampaign): string {
    return formatTokenAmount(raw, decimalsMap.get(campaign.mint) ?? null);
  }

  const nowTs = BigInt(Math.floor(Date.now() / 1000));

  const sortedCampaigns = useMemo(() => {
    const list = [...campaigns];
    switch (sortKey) {
      case "claimable":
        return list.sort(
          (a, b) =>
            Number(BigInt(b.progress.claimable) - BigInt(a.progress.claimable)),
        );
      case "progress":
        return list.sort(
          (a, b) => b.progress.progressPercent - a.progress.progressPercent,
        );
      case "nextUnlock":
        return list.sort((a, b) => {
          const aUnlock = a.progress.nextUnlock ? BigInt(a.progress.nextUnlock) : null;
          const bUnlock = b.progress.nextUnlock ? BigInt(b.progress.nextUnlock) : null;
          if (aUnlock === null && bUnlock === null) return 0;
          if (aUnlock === null) return 1;
          if (bUnlock === null) return -1;
          return Number(aUnlock - bUnlock);
        });
      default:
        return list;
    }
  }, [campaigns, sortKey]);

  const vestedPercent =
    summary && summary.totalEntitled > 0n
      ? ((Number(summary.totalVested) / Number(summary.totalEntitled)) * 100).toFixed(1)
      : "0.0";
  const claimedPercent =
    summary && summary.totalEntitled > 0n
      ? ((Number(summary.totalClaimed) / Number(summary.totalEntitled)) * 100).toFixed(1)
      : "0.0";
  const claimablePercent =
    summary && summary.totalEntitled > 0n
      ? ((Number(summary.totalClaimable) / Number(summary.totalEntitled)) * 100).toFixed(1)
      : "0.0";

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Portfolio</h1>
        <p className="mt-1 text-[13px] text-[#8b92a5]">
          Your vesting portfolio at a glance
        </p>
      </div>

      {!address ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] px-8 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600/15 text-violet-400">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
            </svg>
          </div>
          <h2 className="mt-4 text-[15px] font-medium text-white">No wallet connected</h2>
          <p className="mt-1 text-[13px] text-[#8b92a5]">
            Connect your wallet to view your vesting allocations.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Total Entitled"
              value={isLoading ? "..." : formatTokenAmount(summary?.totalEntitled ?? 0n, aggregateDecimals)}
              sub={mixedMintAggregateSub(
                mintAddresses.length,
                summary ? `across ${summary.campaignCount} campaigns` : undefined,
              )}
            />
            <StatCard
              label="Total Vested"
              value={isLoading ? "..." : formatTokenAmount(summary?.totalVested ?? 0n, aggregateDecimals)}
              sub={isLoading ? undefined : mixedMintAggregateSub(mintAddresses.length, `${vestedPercent}%`)}
            />
            <StatCard
              label="Total Claimed"
              value={isLoading ? "..." : formatTokenAmount(summary?.totalClaimed ?? 0n, aggregateDecimals)}
              sub={isLoading ? undefined : mixedMintAggregateSub(mintAddresses.length, `${claimedPercent}%`)}
            />
            <StatCard
              label="Claimable Now"
              value={isLoading ? "..." : formatTokenAmount(summary?.totalClaimable ?? 0n, aggregateDecimals)}
              sub={isLoading ? undefined : mixedMintAggregateSub(mintAddresses.length, `${claimablePercent}%`)}
              accent
            />
          </div>

          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[13px] font-medium uppercase tracking-[0.1em] text-[#555d73]">
                Vesting Progress
              </h2>
              {campaigns.length > 0 && (
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[12px] text-[#8b92a5] outline-none focus:border-violet-500/30"
                >
                  <option value="claimable">Sort: Claimable</option>
                  <option value="progress">Sort: Progress</option>
                  <option value="nextUnlock">Sort: Next Unlock</option>
                </select>
              )}
            </div>

            {isLoading ? (
              <PortfolioSkeleton />
            ) : campaigns.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] px-8 py-16 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600/15 text-violet-400">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                    <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
                  </svg>
                </div>
                <h2 className="mt-4 text-[15px] font-medium text-white">No vesting allocations yet</h2>
                <p className="mt-1 text-[13px] text-[#8b92a5]">
                  You&apos;ll see your vesting streams here once you&apos;re added as a recipient to a campaign.
                </p>
              </div>
            ) : (
              <div className="grid gap-4">
                {sortedCampaigns.map((campaign) => (
                  <CampaignCard
                    key={`${campaign.treeAddress}-${campaign.leaf.leafIndex}`}
                    campaign={campaign}
                    nowTs={nowTs}
                    fmtAmount={fmtAmount}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
