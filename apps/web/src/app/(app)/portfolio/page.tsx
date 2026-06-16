"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useVestingProgressSummary } from "@/hooks/useVestingProgress";
import { formatUsd } from "@/lib/vesting/display";
import { useMintDecimals } from "@/hooks/useMintDecimals";
import { useMintPrices } from "@/hooks/useMintPrices";
import { POPULAR_TOKENS } from "@/lib/constants/popular-tokens";
import { NATIVE_SOL_MINT_ADDRESS } from "@/lib/sol/auto-wrap";
import { CLUSTER } from "@/lib/sol/cluster";

// ─── Token metadata ───────────────────────────────────────────────────────────

type MintMeta = {
  symbol: string;
  name: string;
  logoURI?: string;
  isDevnet: boolean;
};

function getMintMeta(mint: string): MintMeta {
  if (mint === NATIVE_SOL_MINT_ADDRESS)
    return {
      symbol: "SOL",
      name: "Solana",
      logoURI:
        "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
      isDevnet: false,
    };
  const p = POPULAR_TOKENS.find((t) => t.mint === mint);
  if (p) {
    const isDevnet =
      p.name.toLowerCase().includes("devnet") ||
      p.name.toLowerCase().includes("testnet") ||
      CLUSTER !== "mainnet-beta";
    return { symbol: p.symbol, name: p.name, logoURI: p.logoURI, isDevnet };
  }
  return {
    symbol: mint.slice(0, 4).toUpperCase(),
    name: `${mint.slice(0, 8)}…`,
    isDevnet: CLUSTER !== "mainnet-beta",
  };
}

// ─── Token logo ───────────────────────────────────────────────────────────────

function TokenLogo({ logoURI, symbol }: { logoURI?: string; symbol: string }) {
  const [imgErr, setImgErr] = useState(false);
  if (logoURI && !imgErr)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoURI}
        alt={symbol}
        className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-white/10"
        onError={() => setImgErr(true)}
      />
    );
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[11px] font-bold text-primary ring-1 ring-white/10">
      {symbol[0]}
    </div>
  );
}

// ─── Network badge ────────────────────────────────────────────────────────────

function NetworkBadge({ cluster }: { cluster: typeof CLUSTER }) {
  if (cluster === "mainnet-beta") return null;
  const label = cluster === "devnet" ? "Devnet" : "Testnet";
  return (
    <span className="inline-flex items-center rounded px-1 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider border border-amber-500/30 bg-amber-500/10 text-amber-400">
      {label}
    </span>
  );
}

// ─── Asset status badge ───────────────────────────────────────────────────────

function AssetStatusBadge({ vestedPct, claimable }: { vestedPct: number; claimable: number }) {
  const isCompleted = vestedPct >= 99.9 && claimable === 0;
  const isClaimable = claimable > 0;

  if (isCompleted) {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/[0.07] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-emerald-500">
        Completed
      </span>
    );
  }
  if (isClaimable) {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-emerald-400">
        Claimable
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-violet-500/25 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-violet-400/80">
      Locked
    </span>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function PortfolioSkeleton() {
  return (
    <div className="grid gap-4">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="h-48 animate-pulse rounded-2xl border border-line bg-foreground/10" />
      ))}
    </div>
  );
}

// ─── Stat card with optional progress bar ─────────────────────────────────────

interface ProgressStatCardProps {
  label: string;
  value: string;
  sub?: string;
  pct?: number;
  accent?: boolean;      // violet accent
  claimable?: boolean;   // green accent — for "Claimable Now"
  loading?: boolean;
  className?: string;
}

function ProgressStatCard({ label, value, sub, pct, accent, claimable, loading, className }: ProgressStatCardProps) {
  const isGreen = claimable && !accent;
  const border = isGreen
    ? "border-emerald-500/25 hover:border-emerald-500/40"
    : accent
      ? "border-line-hover hover:border-primary/40"
      : "border-line hover:border-line-hover";
  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-muted px-3 py-2.5 sm:rounded-2xl sm:p-5 transition-colors ${border} ${className ?? ""}`}
    >
      {isGreen && (
        <div
          className="pointer-events-none absolute inset-0 rounded-xl sm:rounded-2xl"
          style={{ background: "radial-gradient(ellipse at top right, rgba(16,185,129,0.08), transparent 70%)" }}
        />
      )}
      {accent && !isGreen && (
        <div
          className="pointer-events-none absolute inset-0 rounded-xl sm:rounded-2xl"
          style={{ background: "radial-gradient(ellipse at top right, rgba(124,58,237,0.10), transparent 70%)" }}
        />
      )}
      <div className="font-mono text-[9px] sm:text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      {loading ? (
        <div className="mt-1.5 sm:mt-2 h-6 sm:h-8 w-14 sm:w-16 animate-pulse rounded-lg bg-foreground/10" />
      ) : (
        <div
          className={`mt-1 sm:mt-2 text-[20px] sm:text-[28px] font-semibold leading-none tracking-tight ${
            isGreen ? "text-emerald-400" : accent ? "text-accent-light" : "text-foreground"
          }`}
        >
          {value}
        </div>
      )}
      {/* Progress bar */}
      {pct !== undefined && !loading && (
        <div className="mt-2 h-0.5 w-full rounded-full bg-foreground/[0.08] sm:mt-2.5">
          <div
            className={`h-0.5 rounded-full transition-all ${
              isGreen ? "bg-emerald-400" : accent ? "bg-accent-light" : "bg-primary/50"
            }`}
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        </div>
      )}
      {sub && (
        <div className="mt-1 sm:mt-1.5 font-mono text-[10px] sm:text-[11px] text-muted-foreground truncate">
          {sub}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const { publicKey } = useWallet();
  const address = publicKey?.toBase58();
  const { summary, isLoading, campaigns } = useVestingProgressSummary(address);

  const mintAddresses = useMemo(
    () => [...new Set(campaigns.map((c) => c.mint).filter(Boolean))],
    [campaigns],
  );

  const { decimalsMap, isLoading: decimalsLoading } = useMintDecimals(mintAddresses);
  const { pricesMap, isLoading: pricesLoading } = useMintPrices(mintAddresses);

  // ── Lifecycle-aware per-mint sums ──────────────────────────────────────────
  // For cancelled campaigns, effective entitled = vestedSoFar (unvested returned).
  const effectiveMintSums = useMemo(() => {
    const map = new Map<string, { entitled: bigint; vested: bigint; claimed: bigint; claimable: bigint }>();
    for (const campaign of campaigns) {
      const isCancelled = campaign.cancelledAt !== null;
      const vested = BigInt(campaign.progress.vestedSoFar);
      const entitled = isCancelled ? vested : BigInt(campaign.progress.totalEntitled);
      const claimed = BigInt(campaign.progress.claimedSoFar);
      const claimable = BigInt(campaign.progress.claimable);
      const existing = map.get(campaign.mint) ?? { entitled: 0n, vested: 0n, claimed: 0n, claimable: 0n };
      map.set(campaign.mint, {
        entitled: existing.entitled + entitled,
        vested: existing.vested + vested,
        claimed: existing.claimed + claimed,
        claimable: existing.claimable + claimable,
      });
    }
    return map;
  }, [campaigns]);

  // ── Per-mint USD breakdown ──────────────────────────────────────────────────

  const portfolioData = useMemo(() => {
    if (!summary || effectiveMintSums.size === 0) return null;

    type MintRow = {
      mint: string;
      symbol: string;
      name: string;
      logoURI?: string;
      isDevnet: boolean;
      decimals: number;
      entitled: number;
      vested: number;
      claimed: number;
      claimable: number;
      vestedPct: number;
      claimedPct: number;
      claimablePct: number;
      price: number | null;
      entitledUsd: number | null;
      vestedUsd: number | null;
      claimedUsd: number | null;
      claimableUsd: number | null;
      allocationPct: number; // % of total portfolio by entitled USD
    };

    const rows: MintRow[] = [];
    let totalEntitledUsd = 0;
    let totalVestedUsd = 0;
    let totalClaimedUsd = 0;
    let totalClaimableUsd = 0;
    let hasAnyPrice = false;

    for (const [mint, sums] of effectiveMintSums) {
      const dec = decimalsMap.get(mint);
      if (dec === undefined) continue;

      const div = Math.pow(10, dec);
      const entitled = Number(sums.entitled) / div;
      const vested = Number(sums.vested) / div;
      const claimed = Number(sums.claimed) / div;
      const claimable = Number(sums.claimable) / div;

      const vestedPct = entitled > 0 ? (vested / entitled) * 100 : 0;
      const claimedPct = entitled > 0 ? (claimed / entitled) * 100 : 0;
      const claimablePct = entitled > 0 ? (claimable / entitled) * 100 : 0;

      const price = pricesMap.get(mint) ?? null;
      let entitledUsd: number | null = null;
      let vestedUsd: number | null = null;
      let claimedUsd: number | null = null;
      let claimableUsd: number | null = null;

      if (price != null && price > 0) {
        entitledUsd = entitled * price;
        vestedUsd = vested * price;
        claimedUsd = claimed * price;
        claimableUsd = claimable * price;
        totalEntitledUsd += entitledUsd;
        totalVestedUsd += vestedUsd;
        totalClaimedUsd += claimedUsd;
        totalClaimableUsd += claimableUsd;
        hasAnyPrice = true;
      }

      const meta = getMintMeta(mint);
      rows.push({
        mint,
        ...meta,
        decimals: dec,
        entitled,
        vested,
        claimed,
        claimable,
        vestedPct,
        claimedPct,
        claimablePct,
        price,
        entitledUsd,
        vestedUsd,
        claimedUsd,
        claimableUsd,
        allocationPct: 0, // calculated below after total is known
      });
    }

    // Back-fill allocation percentages now that totalEntitledUsd is known
    for (const row of rows) {
      row.allocationPct =
        totalEntitledUsd > 0 && row.entitledUsd != null
          ? (row.entitledUsd / totalEntitledUsd) * 100
          : 0;
    }

    // Sort by USD value desc, then by entitled amount desc
    rows.sort((a, b) => {
      if (a.entitledUsd !== null && b.entitledUsd !== null) return b.entitledUsd - a.entitledUsd;
      if (a.entitledUsd !== null) return -1;
      if (b.entitledUsd !== null) return 1;
      return b.entitled - a.entitled;
    });

    // Portfolio Value = remaining unclaimed allocation
    const portfolioValueUsd = totalEntitledUsd - totalClaimedUsd;

    const vestedPctOverall =
      totalEntitledUsd > 0 ? (totalVestedUsd / totalEntitledUsd) * 100 : 0;
    const claimedPctOverall =
      totalEntitledUsd > 0 ? (totalClaimedUsd / totalEntitledUsd) * 100 : 0;
    const claimablePctOverall =
      totalEntitledUsd > 0 ? (totalClaimableUsd / totalEntitledUsd) * 100 : 0;
    const portfolioPct =
      totalEntitledUsd > 0 ? (portfolioValueUsd / totalEntitledUsd) * 100 : 0;

    return {
      rows,
      hasAnyPrice,
      portfolioValueUsd,
      portfolioPct,
      totalEntitledUsd,
      totalVestedUsd,
      totalClaimedUsd,
      totalClaimableUsd,
      vestedPctOverall,
      claimedPctOverall,
      claimablePctOverall,
      unpricedCount: rows.filter((r) => r.price == null).length,
    };
  }, [summary, effectiveMintSums, decimalsMap, pricesMap]);

  // ── Derived values ──────────────────────────────────────────────────────────

  const statsLoading =
    isLoading || (mintAddresses.length > 0 && (decimalsLoading || pricesLoading));

  function fmtToken(amount: number, decimals: number): string {
    if (amount === 0) return "0";
    const fixed = amount.toFixed(decimals > 6 ? 4 : 3).replace(/\.?0+$/, "");
    return Number(fixed).toLocaleString("en-US", { maximumFractionDigits: 4 });
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-5xl space-y-5 sm:space-y-8">
      {/* Page header */}
      <div>
        <div className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-primary/70">
          Recipient
        </div>
        <h1 className="text-[22px] sm:text-[28px] font-semibold tracking-tight text-foreground">
          Portfolio
        </h1>
        <p className="mt-1 font-mono text-[12px] text-muted-foreground">
          Your vesting portfolio at a glance
        </p>
      </div>

      {!address ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-muted/60 px-8 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-accent-light">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
            </svg>
          </div>
          <h2 className="mt-4 text-[15px] font-medium text-foreground">No wallet connected</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Connect your wallet to view your vesting allocations.
          </p>
        </div>
      ) : (
        <>
          {/* ── Summary stat cards ── */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
            {/*
             * Portfolio Value = remaining unclaimed (entitled - claimed).
             * This is what the user still has locked or claimable.
             */}
            <ProgressStatCard
              label="Portfolio Value"
              value={
                statsLoading ? "—"
                : portfolioData ? formatUsd(portfolioData.portfolioValueUsd)
                : "—"
              }
              pct={statsLoading ? undefined : portfolioData?.portfolioPct}
              sub={
                statsLoading ? undefined
                : portfolioData?.hasAnyPrice
                  ? portfolioData.portfolioValueUsd === 0
                    ? "All funds claimed"
                    : "Current unclaimed portfolio value"
                  : portfolioData ? "Price data unavailable"
                  : summary ? `${summary.campaignCount} campaign${(summary.campaignCount ?? 0) !== 1 ? "s" : ""}` : undefined
              }
              loading={statsLoading}
            />
            {/*
             * Total Allocated = full gross allocation regardless of claimed amount.
             * Distinct from Portfolio Value when claimed > 0.
             */}
            <ProgressStatCard
              label="Total Allocated"
              value={
                statsLoading ? "—"
                : portfolioData ? formatUsd(portfolioData.totalEntitledUsd)
                : "—"
              }
              sub={
                statsLoading ? undefined
                : portfolioData?.hasAnyPrice ? "Total vesting allocation received"
                : portfolioData ? "Price data unavailable"
                : undefined
              }
              loading={statsLoading}
            />
            <ProgressStatCard
              label="Total Vested"
              value={
                statsLoading ? "—"
                : portfolioData ? formatUsd(portfolioData.totalVestedUsd)
                : "—"
              }
              pct={statsLoading ? undefined : portfolioData?.vestedPctOverall}
              sub={
                statsLoading ? undefined
                : portfolioData?.hasAnyPrice
                  ? `Amount successfully vested · ${portfolioData.vestedPctOverall.toFixed(1)}%`
                  : portfolioData ? "Price data unavailable"
                  : undefined
              }
              loading={statsLoading}
            />
            <ProgressStatCard
              label="Total Claimed"
              value={
                statsLoading ? "—"
                : portfolioData ? formatUsd(portfolioData.totalClaimedUsd)
                : "—"
              }
              pct={statsLoading ? undefined : portfolioData?.claimedPctOverall}
              sub={
                statsLoading ? undefined
                : portfolioData?.hasAnyPrice
                  ? portfolioData.totalClaimedUsd === 0
                    ? "Nothing withdrawn yet"
                    : `Amount already withdrawn · ${portfolioData.claimedPctOverall.toFixed(1)}%`
                  : portfolioData ? "Price data unavailable"
                  : undefined
              }
              loading={statsLoading}
            />
            <ProgressStatCard
              label="Claimable Now"
              value={
                statsLoading ? "—"
                : portfolioData ? formatUsd(portfolioData.totalClaimableUsd)
                : "—"
              }
              pct={statsLoading ? undefined : portfolioData?.claimablePctOverall}
              sub={
                statsLoading ? undefined
                : portfolioData?.hasAnyPrice
                  ? portfolioData.totalClaimableUsd === 0
                    ? "Nothing available to claim"
                    : "Available for immediate claim"
                  : portfolioData ? "Price data unavailable"
                  : undefined
              }
              claimable
              loading={statsLoading}
              className="col-span-2 lg:col-span-1"
            />
          </div>

          {/* ── Assets breakdown ── */}
          {!statsLoading && portfolioData && portfolioData.rows.length > 0 && (
            <div>
              {/* Section header with quickstats */}
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Assets
                </h2>
                <span className="font-mono text-[11px] text-muted-foreground/70">
                  {summary?.campaignCount ?? 0} Campaign{(summary?.campaignCount ?? 0) !== 1 ? "s" : ""}
                  {" · "}
                  {portfolioData.rows.length} Asset{portfolioData.rows.length !== 1 ? "s" : ""}
                  {portfolioData.hasAnyPrice && portfolioData.totalClaimableUsd > 0 && (
                    <>
                      {" · "}
                      <span className="text-emerald-400">
                        {formatUsd(portfolioData.totalClaimableUsd)} Claimable
                      </span>
                    </>
                  )}
                </span>
              </div>

              {/* Desktop table */}
              <div className="hidden overflow-hidden rounded-2xl border border-line md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-muted/60">
                      <th className="px-4 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Asset
                      </th>
                      <th className="px-4 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Entitled
                      </th>
                      <th className="px-4 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Vested
                      </th>
                      <th className="px-4 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Claimed
                      </th>
                      <th className="px-4 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Claimable
                      </th>
                      <th className="px-4 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        USD Value
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-line">
                    {portfolioData.rows.map((row) => (
                      <tr
                        key={row.mint}
                        className="group bg-muted transition-colors hover:bg-surface-hover"
                      >
                        {/* Asset */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <TokenLogo logoURI={row.logoURI} symbol={row.symbol} />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[13px] font-semibold text-foreground">
                                  {row.symbol}
                                </span>
                                {row.isDevnet && <NetworkBadge cluster={CLUSTER} />}
                                <AssetStatusBadge vestedPct={row.vestedPct} claimable={row.claimable} />
                              </div>
                              <div className="text-[11px] text-muted-foreground leading-tight">
                                {row.name}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Entitled */}
                        <td className="px-4 py-3.5 text-right font-mono text-[13px] text-foreground">
                          {fmtToken(row.entitled, row.decimals)}{" "}
                          <span className="text-[11px] text-muted-foreground">{row.symbol}</span>
                        </td>

                        {/* Vested */}
                        <td className="px-4 py-3.5 text-right font-mono text-[13px] text-foreground">
                          {fmtToken(row.vested, row.decimals)}{" "}
                          <span className="text-[11px] text-muted-foreground">{row.symbol}</span>
                          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">
                            {row.vestedPct.toFixed(1)}%
                          </div>
                        </td>

                        {/* Claimed */}
                        <td className="px-4 py-3.5 text-right font-mono text-[13px] text-foreground">
                          {fmtToken(row.claimed, row.decimals)}{" "}
                          <span className="text-[11px] text-muted-foreground">{row.symbol}</span>
                          {row.claimed > 0 && (
                            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">
                              {row.claimedPct.toFixed(1)}%
                            </div>
                          )}
                        </td>

                        {/* Claimable */}
                        <td className="px-4 py-3.5 text-right font-mono text-[13px]">
                          <span
                            className={
                              row.claimable > 0
                                ? "font-semibold text-emerald-400"
                                : "text-muted-foreground"
                            }
                          >
                            {fmtToken(row.claimable, row.decimals)}
                          </span>
                          {" "}
                          <span className="text-[11px] text-muted-foreground">{row.symbol}</span>
                          {row.claimable > 0 && (
                            <div className="mt-0.5 font-mono text-[10px] text-emerald-400/60">
                              {row.claimablePct.toFixed(1)}%
                            </div>
                          )}
                        </td>

                        {/* USD Value */}
                        <td className="px-4 py-3.5 text-right">
                          {row.entitledUsd != null ? (
                            <div className="space-y-0.5">
                              <div className="font-semibold text-[13px] text-foreground">
                                {formatUsd(row.entitledUsd)}
                              </div>
                              {/* Allocation share */}
                              {portfolioData.rows.length > 1 && row.allocationPct > 0 && (
                                <div className="font-mono text-[10px] text-muted-foreground/60">
                                  {row.allocationPct.toFixed(1)}% of portfolio
                                </div>
                              )}
                              {/* Claimable USD */}
                              {row.claimableUsd != null && row.claimableUsd > 0 && (
                                <div className="font-mono text-[10px] text-emerald-400">
                                  {formatUsd(row.claimableUsd)} claimable
                                </div>
                              )}
                              {/* Token price */}
                              {row.price != null && (
                                <div className="font-mono text-[10px] text-muted-foreground/50">
                                  {formatUsd(row.price)} / {row.symbol}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="font-mono text-[12px] text-muted-foreground/40">
                              Price Unavailable
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>

                  {/* Portfolio Summary footer */}
                  {portfolioData.hasAnyPrice && portfolioData.rows.length > 1 && (
                    <tfoot>
                      <tr className="border-t-2 border-line bg-gradient-to-r from-primary/[0.04] to-transparent">
                        <td className="px-4 py-4">
                          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            Portfolio Summary
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/50">
                            {portfolioData.rows.length} asset{portfolioData.rows.length !== 1 ? "s" : ""}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-right font-semibold text-[13px] text-foreground">
                          {formatUsd(portfolioData.totalEntitledUsd)}
                        </td>
                        <td className="px-4 py-4 text-right font-semibold text-[13px] text-foreground">
                          {formatUsd(portfolioData.totalVestedUsd)}
                        </td>
                        <td className="px-4 py-4 text-right font-semibold text-[13px] text-foreground">
                          {formatUsd(portfolioData.totalClaimedUsd)}
                        </td>
                        <td className="px-4 py-4 text-right font-semibold text-[13px] text-emerald-400">
                          {formatUsd(portfolioData.totalClaimableUsd)}
                        </td>
                        <td className="px-4 py-4 text-right font-semibold text-[13px] text-foreground">
                          {formatUsd(portfolioData.totalEntitledUsd)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* Mobile cards */}
              <div className="space-y-2 md:hidden">
                {portfolioData.rows.map((row) => (
                  <div
                    key={row.mint}
                    className="rounded-xl border border-line bg-muted px-4 py-3.5 space-y-3"
                  >
                    {/* Token header */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <TokenLogo logoURI={row.logoURI} symbol={row.symbol} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[13px] font-semibold text-foreground">
                              {row.symbol}
                            </span>
                            {row.isDevnet && <NetworkBadge cluster={CLUSTER} />}
                            <AssetStatusBadge vestedPct={row.vestedPct} claimable={row.claimable} />
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">{row.name}</div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {row.entitledUsd != null ? (
                          <>
                            <div className="text-[15px] font-semibold text-foreground">
                              {formatUsd(row.entitledUsd)}
                            </div>
                            {portfolioData.rows.length > 1 && row.allocationPct > 0 && (
                              <div className="font-mono text-[10px] text-muted-foreground/60">
                                {row.allocationPct.toFixed(1)}% of portfolio
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="font-mono text-[12px] text-muted-foreground/40">Price Unavailable</span>
                        )}
                        {row.price != null && (
                          <div className="font-mono text-[10px] text-muted-foreground/50">
                            {formatUsd(row.price)} / {row.symbol}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Token amounts */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      {(
                        [
                          { label: "Entitled", value: row.entitled, pct: null, accent: false },
                          { label: "Vested", value: row.vested, pct: row.vestedPct, accent: false },
                          { label: "Claimed", value: row.claimed, pct: row.claimed > 0 ? row.claimedPct : null, accent: false },
                          { label: "Claimable", value: row.claimable, pct: row.claimable > 0 ? row.claimablePct : null, accent: true },
                        ] as Array<{ label: string; value: number; pct: number | null; accent: boolean }>
                      ).map(({ label, value, pct, accent }) => (
                        <div key={label}>
                          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                            {label}
                          </div>
                          <div
                            className={`font-mono text-[12px] font-medium ${
                              accent && value > 0 ? "text-emerald-400" : "text-foreground"
                            }`}
                          >
                            {fmtToken(value, row.decimals)}{" "}
                            <span className="text-[11px] font-normal text-muted-foreground">
                              {row.symbol}
                            </span>
                          </div>
                          {pct !== null && (
                            <div className="font-mono text-[10px] text-muted-foreground/50">
                              {pct.toFixed(1)}%
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Claimable callout */}
                    {row.claimableUsd != null && row.claimableUsd > 0 && (
                      <div className="flex items-center justify-between rounded-lg border border-accent-light/20 bg-accent-light/5 px-3 py-2">
                        <span className="text-[12px] text-accent-light">Claimable now</span>
                        <span className="font-semibold text-[13px] text-accent-light">
                          {formatUsd(row.claimableUsd)}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

        </>
      )}
    </div>
  );
}
