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
import { PortfolioDonut, type DonutSegment } from "@/components/ui/PortfolioDonut";
import { GracePeriodCountdown } from "@/components/campaign/detail/GracePeriodCountdown";
import { getRecipientStreamStatus, getSenderStreamStatus, isGracePeriodVisible } from "@/lib/vesting/list";
import {
  formatCountdown,
  formatTokenAmount,
  formatSummedMintAmounts,
  formatUsd,
  getGracePeriodState,
  getVestingTypeLabel,
} from "@/lib/vesting/display";
import { useMintDecimals } from "@/hooks/useMintDecimals";
import { useMintPrices } from "@/hooks/useMintPrices";
import { POPULAR_TOKENS } from "@/lib/constants/popular-tokens";
import { NATIVE_SOL_MINT_ADDRESS } from "@/lib/sol/auto-wrap";
import { truncateAddress } from "@/lib/vesting/timeline-helpers";

function getMintSymbol(mint: string): string {
  if (mint === NATIVE_SOL_MINT_ADDRESS) return "SOL";
  return POPULAR_TOKENS.find((t) => t.mint === mint)?.symbol ?? mint.slice(0, 4).toUpperCase();
}

function ActionCard({
  href,
  title,
  description,
  icon,
  className,
}: {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-3 sm:gap-4 rounded-xl sm:rounded-2xl border border-line bg-muted p-3.5 sm:p-5 transition-all hover:border-primary/30 hover:bg-surface-hover${className ? ` ${className}` : ""}`}
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

  const [donutView, setDonutView] = useState<"receiving" | "created">("receiving");

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
      hasCancelEvent: boolean;
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
  const { decimalsMap, isLoading: decimalsLoading } = useMintDecimals(allMintAddresses);

  const mintCount = vestingSummary?.mintSums.size ?? 0;
  const isMixedTokens = mintCount > 1;

  const claimableFormatted = vestingSummary
    ? isMixedTokens
      ? "Mixed tokens"
      : formatSummedMintAmounts(vestingSummary.mintSums, "claimable", decimalsMap)
    : "—";

  const claimableSub = isMixedTokens
    ? "Open portfolio for per-token amounts"
    : undefined;

  const activityMintDecimals = useMemo(() => {
    if (allMintAddresses.length === 0) return null;
    const vals = allMintAddresses.map((m) => decimalsMap.get(m));
    if (vals.some((d) => d === undefined)) return null;
    const unique = new Set(vals);
    return unique.size === 1 ? (vals[0] ?? null) : null;
  }, [allMintAddresses, decimalsMap]);

  // treeAddress → mint — used for per-event decimal resolution in ActivityFeed
  const mintByTree = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of senderCampaigns) {
      if (c.mint) map.set(c.treeAddress, c.mint);
    }
    for (const c of vestingCampaigns) {
      if (c.mint) map.set(c.treeAddress, c.mint);
    }
    return map;
  }, [senderCampaigns, vestingCampaigns]);

  const mintTvlSums = useMemo(() => {
    const map = new Map<string, bigint>();
    for (const c of senderCampaigns) {
      if (!c.mint) continue;
      // Exclude campaigns where tokens are no longer locked in the vault
      if (c.instantRefunded) continue; // all tokens returned to creator
      if (c.streamSettled) continue;   // tokens distributed; unvested returned
      const supply = BigInt(c.totalSupply?.toString() ?? "0");
      const claimed = BigInt(c.totalClaimed?.toString() ?? "0");
      const locked = supply > claimed ? supply - claimed : 0n;
      map.set(c.mint, (map.get(c.mint) ?? 0n) + locked);
    }
    return map;
  }, [senderCampaigns]);

  function fmtAmount(raw: bigint, campaign: (typeof vestingCampaigns)[number]): string {
    return formatTokenAmount(raw, decimalsMap.get(campaign.mint) ?? null);
  }

  const recipientCampaigns = useMemo(() => {
    const dbCampaigns = (recipientQuery.data?.campaigns ?? []) as Array<{
      treeAddress: string;
      creator: string;
      paused: boolean;
      cancelledAt: number | null;
      instantRefunded?: boolean;
      streamSettled?: boolean;
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
      .filter((c) => isGracePeriodVisible({
        cancelledAt: c.cancelledAt,
        instantRefunded: c.instantRefunded,
        streamSettled: c.streamSettled,
      }))
      .map((c) => ({
        campaign: c,
        graceState: getGracePeriodState(BigInt(c.cancelledAt!), nowTs),
      }))
      .filter(
        ({ graceState }) =>
          graceState.status === "grace_active" || graceState.status === "grace_expired",
      );
  }, [senderCampaigns, nowTs]);

  const recipientGraceActions = useMemo(() => {
    return vestingCampaigns.filter((c) =>
      isGracePeriodVisible({
        cancelledAt: c.cancelledAt !== null ? Number(c.cancelledAt) : null,
        instantRefunded: c.instantRefunded,
        streamSettled: c.streamSettled,
      }) && BigInt(c.progress.claimable) > 0n,
    );
  }, [vestingCampaigns]);

  const topVestingCampaigns = useMemo(() => {
    return [...vestingCampaigns]
      .sort(
        (a, b) =>
          Number(BigInt(b.progress.claimable) - BigInt(a.progress.claimable)),
      )
      .slice(0, 5);
  }, [vestingCampaigns]);

  const tvlMintAddresses = useMemo(() => [...mintTvlSums.keys()], [mintTvlSums]);
  const { pricesMap, isLoading: pricesLoading } = useMintPrices(allMintAddresses);

  const { tvlValue, tvlSub } = useMemo(() => {
    if (mintTvlSums.size === 0) return { tvlValue: "$0.00", tvlSub: "No active vesting streams" };

    let totalUsd = 0;
    let pricedCount = 0;
    const unpricedParts: string[] = [];

    for (const [mint, locked] of mintTvlSums) {
      const dec = decimalsMap.get(mint);
      const price = pricesMap.get(mint);
      if (price == null || price === 0 || dec === undefined) {
        if (dec !== undefined) {
          const humanAmt = Number(locked) / Math.pow(10, dec);
          unpricedParts.push(
            `${humanAmt % 1 === 0 ? humanAmt.toLocaleString() : humanAmt.toFixed(4).replace(/\.?0+$/, "")} ${getMintSymbol(mint)}`,
          );
        }
        continue;
      }
      totalUsd += (Number(locked) / Math.pow(10, dec)) * price;
      pricedCount++;
    }

    if (pricedCount === 0) {
      // No price data for any token — show token amounts instead
      if (unpricedParts.length === 1) {
        const [amount, symbol] = unpricedParts[0]!.split(" ");
        return { tvlValue: amount!, tvlSub: `${symbol} locked` };
      }
      return { tvlValue: "—", tvlSub: unpricedParts.join(" · ") };
    }

    const sub =
      unpricedParts.length > 0
        ? `Est. USD · excl. ${unpricedParts.join(" + ")}`
        : "Estimated USD";
    return { tvlValue: formatUsd(totalUsd), tvlSub: sub };
  }, [mintTvlSums, pricesMap, decimalsMap]);

  const claimableValueUsd = useMemo(() => {
    if (!vestingSummary || vestingSummary.mintSums.size === 0) return null;
    let total = 0;
    let hasPriced = false;
    for (const [mint, sums] of vestingSummary.mintSums) {
      const dec = decimalsMap.get(mint);
      const price = pricesMap.get(mint);
      if (dec === undefined || price == null || price === 0) continue;
      total += (Number(sums.claimable) / Math.pow(10, dec)) * price;
      hasPriced = true;
    }
    return hasPriced ? total : null;
  }, [vestingSummary, decimalsMap, pricesMap]);

  const ONGOING_COLOR   = "#7c3aed";
  const SCHEDULED_COLOR = "#E8B84B";
  const COMPLETED_COLOR = "#22c55e";
  const CANCELED_COLOR  = "#f87171";

  const receivingStatusData = useMemo(() => {
    let ongoing = 0, scheduled = 0, completed = 0, canceled = 0;
    for (const [, row] of rows) {
      if (!row.recipientStatus) continue;
      switch (row.recipientStatus) {
        case "Claimable": case "Paused": ongoing++; break;
        case "Scheduled": scheduled++; break;
        case "Claimed": case "Settled": completed++; break;
        case "Cancelled": canceled++; break;
      }
    }
    const total = ongoing + scheduled + completed + canceled;
    return {
      segments: [
        { proportion: total > 0 ? ongoing / total : 0,   color: ONGOING_COLOR,   label: "Ongoing",   amount: String(ongoing) },
        { proportion: total > 0 ? scheduled / total : 0, color: SCHEDULED_COLOR, label: "Scheduled", amount: String(scheduled) },
        { proportion: total > 0 ? completed / total : 0, color: COMPLETED_COLOR, label: "Completed", amount: String(completed) },
        { proportion: total > 0 ? canceled / total : 0,  color: CANCELED_COLOR,  label: "Canceled",  amount: String(canceled) },
      ] as DonutSegment[],
      centerValue: claimableValueUsd !== null ? formatUsd(claimableValueUsd) : claimableFormatted,
      centerSub: "Claimable Now",
    };
  }, [rows, claimableValueUsd, claimableFormatted]);

  const createdStatusData = useMemo(() => {
    let ongoing = 0, completed = 0, canceled = 0;
    for (const [, row] of rows) {
      if (!row.senderStatus) continue;
      switch (row.senderStatus) {
        case "Active": case "Paused": ongoing++; break;
        case "Claimed": case "Settled": completed++; break;
        case "Cancelled": case "Grace Period": case "Refunded": canceled++; break;
      }
    }
    const total = ongoing + completed + canceled;
    return {
      segments: [
        { proportion: total > 0 ? ongoing / total : 0,   color: ONGOING_COLOR,   label: "Ongoing",   amount: String(ongoing) },
        { proportion: total > 0 ? completed / total : 0, color: COMPLETED_COLOR, label: "Completed", amount: String(completed) },
        { proportion: total > 0 ? canceled / total : 0,  color: CANCELED_COLOR,  label: "Canceled",  amount: String(canceled) },
      ] as DonutSegment[],
      centerValue: tvlValue,
      centerSub: "TVL Locked",
    };
  }, [rows, tvlValue]);

  // Count-based stats only need sender/recipient DB queries to resolve.
  // localCampaigns is a fallback (only used on DB error) — don't block counts on its slow RPC fetch.
  const countLoading = senderQuery.isLoading || recipientQuery.isLoading;
  // TVL needs sender mint decimals + Jupiter prices.
  const tvlLoading = countLoading || (senderMintAddresses.length > 0 && (decimalsLoading || pricesLoading));
  // Portfolio hero needs vesting progress + decimals + prices.
  const portfolioLoading = vestingLoading || (vestingMintAddresses.length > 0 && (decimalsLoading || pricesLoading));

  const activeDonutData    = donutView === "receiving" ? receivingStatusData : createdStatusData;
  const activeDonutLoading = donutView === "receiving" ? portfolioLoading    : tvlLoading;

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
          {/* Hero: Portfolio donut (left) + Quick Actions (right) */}
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            {/* Portfolio Donut Card */}
            <Link
              href="/portfolio"
              className="group relative overflow-hidden rounded-2xl border border-violet/25 bg-violet/[0.04] p-5 transition-all hover:border-violet/40 hover:bg-violet/[0.07]"
            >
              <div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ background: "radial-gradient(ellipse at top left, rgba(124,58,237,0.13), transparent 60%)" }} />

              {/* Header */}
              <div className="relative flex items-center justify-between gap-2 mb-5">
                <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-violet/70">Portfolio</span>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5 rounded-full border border-violet/20 bg-violet/[0.06] p-0.5">
                    {(["receiving", "created"] as const).map((view) => (
                      <button
                        key={view}
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDonutView(view); }}
                        className={`rounded-full px-2.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.1em] transition-all ${
                          donutView === view
                            ? "bg-violet/20 text-violet"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {view === "receiving" ? "Receiving" : "Created"}
                      </button>
                    ))}
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </div>

              {/* Centered body: donut + horizontal legend */}
              <div className="relative flex flex-col items-center gap-4 pb-1">
                <PortfolioDonut
                  segments={activeDonutData.segments}
                  centerValue={activeDonutData.centerValue}
                  centerSub={activeDonutData.centerSub}
                  size={148}
                  showLegend={false}
                  isLoading={activeDonutLoading}
                />

                {activeDonutLoading ? (
                  <div className="flex items-center gap-5 sm:gap-8">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="flex flex-col items-center gap-1.5">
                        <div className="h-3 w-12 animate-pulse rounded bg-foreground/10" />
                        <div className="h-[20px] w-16 animate-pulse rounded-lg bg-foreground/10" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-start justify-center gap-5 sm:gap-8 flex-wrap">
                    {activeDonutData.segments.filter((seg) => seg.proportion > 0).map((seg) => (
                      <div key={seg.label} className="flex flex-col items-center gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <div className="shrink-0 rounded-full" style={{ width: 6, height: 6, backgroundColor: seg.color }} />
                          <span className="font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                            {seg.label}
                          </span>
                        </div>
                        <span className="text-[13px] sm:text-[14px] font-semibold leading-tight tracking-tight text-foreground tabular-nums">
                          {seg.amount}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {!activeDonutLoading && (
                  <div className="font-mono text-[10px] text-muted-foreground/70">
                    {counts.active > 0
                      ? `${counts.active} active stream${counts.active > 1 ? "s" : ""}`
                      : "No active streams"}
                  </div>
                )}
              </div>
            </Link>

            {/* Quick Actions — right column */}
            <div className="flex flex-col gap-3">
              <ActionCard
                className="flex-1"
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
                className="flex-1"
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

          {/* Recipient Grace Period Notifications */}
          {recipientGraceActions.length > 0 && (
            <div className="space-y-3">
              <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Action Required
              </h2>
              {recipientGraceActions.map((campaign) => {
                const name = campaign.metadata?.name ?? truncateAddress(campaign.treeAddress);
                return (
                  <Link
                    key={`${campaign.treeAddress}-${campaign.leaf.leafIndex}`}
                    href={`/campaign/${campaign.treeAddress}`}
                    className="flex items-center gap-3 rounded-2xl border border-amber-500/25 bg-muted p-5 transition-all hover:border-amber-500/40"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    </div>
                    <div className="flex-1">
                      <p className="text-[14px] font-medium text-amber-700 dark:text-amber-400">
                        {name} — Claim before grace period ends
                      </p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        This campaign was cancelled, but vested tokens are still withdrawable during grace period.
                      </p>
                    </div>
                    <span className="font-mono text-[11px] font-medium text-amber-700 dark:text-amber-400">Claim Now →</span>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Summary Stats */}
          <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-3">
            <StatCard label="Total Streams" value={String(counts.total)} sub="All campaigns" loading={countLoading} />
            <StatCard
              label="Active"
              value={String(counts.active)}
              sub={counts.active > 0 ? "Currently vesting" : "No active vesting schedules"}
              accent
              loading={countLoading}
            />
            <StatCard
              label="TVL"
              value={tvlValue}
              sub={tvlSub}
              loading={tvlLoading}
            />
            <StatCard label="As Sender" value={String(counts.sender)} sub="Streams you created" loading={countLoading} />
            <StatCard label="As Recipient" value={String(counts.recipient)} sub="Streams you receive" loading={countLoading} />
            <StatCard
              label="Claimable Now"
              value={claimableValueUsd !== null ? formatUsd(claimableValueUsd) : claimableFormatted}
              sub={claimableSub ?? (claimableStreams > 0
                ? `${claimableStreams} stream${claimableStreams > 1 ? "s" : ""} ready`
                : "Nothing available to claim")}
              accent
              loading={portfolioLoading}
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
                <p className="mt-3 text-[13px] font-medium text-secondary-foreground">No vesting campaigns yet</p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">Create your first vesting stream to get started</p>
                <Link
                  href="/campaign/create"
                  className="mt-4 rounded-lg border border-primary/25 bg-primary/10 px-4 py-2 font-mono text-[11px] font-medium text-accent-light transition hover:border-primary/40 hover:bg-primary/15"
                >
                  Create New Stream
                </Link>
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
            mintByTree={mintByTree}
            decimalsMap={decimalsMap}
            pricesMap={pricesMap}
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
              {(() => {
                const isCompleted = campaign.progress.progressPercent >= 100 && claimable === 0n;
                const isClaimable = claimable > 0n;
                return (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] sm:text-[14px] font-medium text-foreground">{name}</span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {isCompleted && (
                          <span className="rounded-full border border-sky-500/25 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-sky-400">
                            Completed
                          </span>
                        )}
                        {!isCompleted && isClaimable && (
                          <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-emerald-400">
                            Claimable
                          </span>
                        )}
                        <span className="font-mono text-[10px] tracking-[0.1em] text-muted-foreground">
                          {getVestingTypeLabel(campaign.leaf.releaseType)}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 sm:mt-3">
                      <div className="h-1 overflow-hidden rounded-full bg-line">
                        <div
                          className="h-full rounded-full transition-all duration-500 ease-out"
                          style={{
                            width: `${Math.min(100, campaign.progress.progressPercent)}%`,
                            background: isCompleted
                              ? "#38bdf8"
                              : isClaimable
                                ? "linear-gradient(90deg, #7c3aed, #14f1d9)"
                                : "#7c3aed",
                          }}
                        />
                      </div>
                      <div className="mt-1.5 sm:mt-2 font-mono text-[10px] text-muted-foreground">
                        {campaign.progress.progressPercent.toFixed(1)}% vested
                        {" · "}
                        {fmtAmount(totalEntitled - vestedSoFar, campaign)} remaining
                        {" · "}
                        {nextUnlockLabel}
                      </div>
                    </div>
                  </>
                );
              })()}
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
