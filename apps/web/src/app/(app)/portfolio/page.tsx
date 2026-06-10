"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  useVestingProgressSummary,
  type VestingProgressCampaign,
} from "@/hooks/useVestingProgress";
import { CampaignCard, toCampaignCardData } from "@/components/campaign/CampaignCard";
import {
  formatTokenAmount,
  mixedMintAggregateSub,
} from "@/lib/vesting/display";
import { useMintDecimals } from "@/hooks/useMintDecimals";
import { StatCard } from "@/components/ui/StatCard";

type SortKey = "claimable" | "progress" | "nextUnlock";

function PortfolioSkeleton() {
  return (
    <div className="grid gap-4">
      {[...Array(3)].map((_, i) => (
        <div
          key={i}
          className="h-48 animate-pulse rounded-2xl border border-[#222838] bg-[#13161f]"
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
  const { decimalsMap, isLoading: decimalsLoading } = useMintDecimals(mintAddresses);

  const singleMint = mintAddresses.length === 1 ? mintAddresses[0] : null;
  const aggregateDecimals = singleMint ? (decimalsMap.get(singleMint) ?? null) : null;

  const statsLoading = isLoading || (mintAddresses.length > 0 && decimalsLoading);

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
        <div className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[#7c3aed]/70">Recipient</div>
        <h1 className="text-[28px] font-semibold tracking-tight text-[#e5e7eb]">Portfolio</h1>
        <p className="mt-1 font-mono text-[12px] text-[#64748b]">Your vesting portfolio at a glance</p>
      </div>

      {!address ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#222838] bg-[#13161f]/60 px-8 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#7c3aed]/20 bg-[#7c3aed]/10 text-[#a78bfa]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
            </svg>
          </div>
          <h2 className="mt-4 text-[15px] font-medium text-[#e5e7eb]">No wallet connected</h2>
          <p className="mt-1 text-[13px] text-[#64748b]">
            Connect your wallet to view your vesting allocations.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Total Entitled"
              value={formatTokenAmount(summary?.totalEntitled ?? 0n, aggregateDecimals)}
              sub={mixedMintAggregateSub(
                mintAddresses.length,
                summary ? `across ${summary.campaignCount} campaigns` : undefined,
              )}
              loading={statsLoading}
            />
            <StatCard
              label="Total Vested"
              value={formatTokenAmount(summary?.totalVested ?? 0n, aggregateDecimals)}
              sub={statsLoading ? undefined : mixedMintAggregateSub(mintAddresses.length, `${vestedPercent}%`)}
              loading={statsLoading}
            />
            <StatCard
              label="Total Claimed"
              value={formatTokenAmount(summary?.totalClaimed ?? 0n, aggregateDecimals)}
              sub={statsLoading ? undefined : mixedMintAggregateSub(mintAddresses.length, `${claimedPercent}%`)}
              loading={statsLoading}
            />
            <StatCard
              label="Claimable Now"
              value={formatTokenAmount(summary?.totalClaimable ?? 0n, aggregateDecimals)}
              sub={statsLoading ? undefined : mixedMintAggregateSub(mintAddresses.length, `${claimablePercent}%`)}
              accent
              loading={statsLoading}
            />
          </div>

          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[#64748b]">
                Vesting Progress
              </h2>
              {campaigns.length > 0 && (
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className="rounded-lg border border-[#222838] bg-[#13161f] px-3 py-1.5 font-mono text-[11px] text-[#64748b] outline-none transition focus:border-[#7c3aed]/40 focus:text-[#b4b9c5]"
                >
                  <option value="claimable">Sort: Claimable</option>
                  <option value="progress">Sort: Progress</option>
                  <option value="nextUnlock">Sort: Next Unlock</option>
                </select>
              )}
            </div>

            {statsLoading ? (
              <PortfolioSkeleton />
            ) : campaigns.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#222838] bg-[#13161f]/60 px-8 py-16 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#7c3aed]/20 bg-[#7c3aed]/10 text-[#a78bfa]">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                    <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
                  </svg>
                </div>
                <h2 className="mt-4 text-[15px] font-medium text-[#e5e7eb]">No vesting allocations yet</h2>
                <p className="mt-1 text-[13px] text-[#64748b]">
                  You&apos;ll see your vesting streams here once you&apos;re added as a recipient to a campaign.
                </p>
              </div>
            ) : (
              <div className="grid gap-4">
                {sortedCampaigns.map((campaign) => (
                  <CampaignCard
                    key={`${campaign.treeAddress}-${campaign.leaf.leafIndex}`}
                    campaign={toCampaignCardData(campaign, nowTs, fmtAmount)}
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
