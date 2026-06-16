"use client";

import Link from "next/link";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useCampaignList } from "@/hooks/useCampaignList";
import { useBeneficiaryCampaigns } from "@/hooks/useBeneficiaryCampaigns";
import { useLocalCampaigns } from "@/hooks/useLocalCampaigns";
import { useMintPrices } from "@/hooks/useMintPrices";
import { CampaignRow } from "@/components/campaign/list/CampaignRow";
import { GracePeriodCountdown } from "@/components/campaign/detail/GracePeriodCountdown";
import { EmptyState } from "@/components/campaign/list/EmptyState";
import {
  getRecipientClaimableAmount,
  getRecipientStreamStatus,
  getMultiLeafRecipientStreamStatus,
  getMultiLeafClaimableAmount,
  getSenderStreamStatus,
  type StreamStatus,
} from "@/lib/vesting/list";
import { isStreamSettledLocal } from "@/lib/stream/persist";
import { POPULAR_TOKENS } from "@/lib/constants/popular-tokens";
import { NATIVE_SOL_MINT_ADDRESS } from "@/lib/sol/auto-wrap";

type TabKey = "all" | "recipient" | "sender" | "action";

type SenderCampaign = {
  treeAddress: string;
  creator: string;
  mint: string;
  campaignId: number;
  leafCount: number;
  totalSupply: number | string;
  totalClaimed: number | string;
  cancellable: boolean;
  paused: boolean;
  cancelledAt: number | null;
  instantRefunded: boolean;
  streamSettled: boolean;
  createdAt: number;
  metadata: { name?: string; description?: string; logoUri?: string } | null;
};

type RecipientCampaign = {
  treeAddress: string;
  creator: string;
  mint: string;
  campaignId: number;
  totalSupply: number | string;
  leafCount: number;
  paused: boolean;
  cancelledAt: number | null;
  createdAt: number;
  metadata: { name?: string; description?: string; logoUri?: string } | null;
  myClaimed: number | string;
  streamSettled?: boolean;
  myLeaf: {
    leafIndex: number;
    amount: number | string;
    releaseType: number;
    startTime: number;
    cliffTime: number;
    endTime: number;
    milestoneIdx: number;
  };
};

type StreamRow = {
  treeAddress: string;
  role: "sender" | "recipient" | "both";
  primaryRole: "sender" | "recipient";
  creator: string;
  mint: string;
  campaignId: number;
  createdAt: number;
  status: StreamStatus;
  roleLabel: string;
  amountLabel: "Your Allocation" | "Total Supply";
  amountRaw: bigint;
  secondaryAmountLabel?: "Total Supply";
  secondaryAmountRaw?: bigint;
  nextLabel: string;
  nextValue: string;
  typeLabel: string;
  counterpartyLabel: string;
  counterpartyValue: string;
  claimableRaw?: bigint;
  claimedRaw?: bigint;
  metadata: { name?: string; description?: string; logoUri?: string } | null;
};

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "action", label: "Needs Action" },
  { key: "all", label: "All" },
  { key: "recipient", label: "Recipient" },
  { key: "sender", label: "Sender" },
];

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function truncateAddress(addr: string) {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function toBigInt(value: number | string): bigint {
  return BigInt(String(value));
}

function formatWithDecimals(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toLocaleString();
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
}

function getReleaseTypeLabel(releaseType: number): string {
  if (releaseType === 0) return "Cliff";
  if (releaseType === 1) return "Linear";
  if (releaseType === 2) return "Milestone";
  return "Unknown";
}

function getReleaseStateText(campaign: RecipientCampaign, nowTs: bigint): string {
  const status = getRecipientStreamStatus(campaign, nowTs);
  if (status === "Claimed") return "Fully claimed";
  if (status === "Claimable") return "Claim available";
  if (status === "Paused") return "Paused";
  if (status === "Cancelled") return "Cancelled";

  if (campaign.myLeaf.releaseType === 1) {
    const startTs = BigInt(campaign.myLeaf.cliffTime);
    const endTs = BigInt(campaign.myLeaf.endTime);
    if (nowTs < startTs) return `Starts ${formatDate(Number(startTs))}`;
    return `Ends ${formatDate(Number(endTs))}`;
  }

  const unlockTs = BigInt(campaign.myLeaf.cliffTime);
  if (nowTs >= unlockTs) return "Unlock reached";
  return `Unlocks ${formatDate(Number(unlockTs))}`;
}

function getSenderStateText(campaign: SenderCampaign): string {
  const status = getSenderStreamStatus(campaign);
  if (status === "Claimed") return "Fully claimed";
  if (status === "Paused") return "Paused";
  if (status === "Settled") return "Settled";
  if (status === "Grace Period") return "Grace period";
  if (status === "Cancelled") return "Cancelled";
  return `${campaign.leafCount} ${campaign.leafCount === 1 ? "recipient" : "recipients"}`;
}

type MintInfo = { symbol: string; name: string; logoURI?: string };

function getMintInfo(mint: string): MintInfo {
  if (mint === NATIVE_SOL_MINT_ADDRESS) {
    return {
      symbol: "SOL",
      name: "Solana · Native",
      logoURI:
        "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
    };
  }
  const p = POPULAR_TOKENS.find((t) => t.mint === mint);
  if (p) return { symbol: p.symbol, name: p.name, logoURI: p.logoURI };
  return { symbol: mint.slice(0, 4).toUpperCase(), name: `${mint.slice(0, 8)}…` };
}

function generateTitle(
  mintInfo: MintInfo,
  typeLabel: string,
  primaryRole: "sender" | "recipient",
): string {
  const { symbol } = mintInfo;
  if (typeLabel === "Single Stream") return `${symbol} Stream`;
  if (primaryRole === "recipient") return `${symbol} Distribution`;
  return `${symbol} Campaign`;
}

function rawToNumber(raw: bigint, decimals: number): number {
  if (decimals === 0) return Number(raw);
  return Number(raw) / Math.pow(10, decimals);
}

export default function CampaignsPage() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const [activeTab, setActiveTab] = useState<TabKey>("action");
  const [search, setSearch] = useState("");
  const [mintDecimals, setMintDecimals] = useState<Record<string, number>>({});
  const [decimalsLoading, setDecimalsLoading] = useState(false);
  const [localRefreshKey, setLocalRefreshKey] = useState(0);

  // Auto-refresh when page becomes visible (e.g., after tab switch)
  useEffect(() => {
    const handler = () => setLocalRefreshKey((k) => k + 1);
    const visHandler = () => {
      if (document.visibilityState === "visible") handler();
    };
    window.addEventListener("focus", handler);
    document.addEventListener("visibilitychange", visHandler);
    return () => {
      window.removeEventListener("focus", handler);
      document.removeEventListener("visibilitychange", visHandler);
    };
  }, []);

  const walletAddress = publicKey?.toBase58();
  const senderCampaignsQuery = useCampaignList(
    walletAddress ? { creator: walletAddress, limit: 100 } : undefined,
  );
  const recipientCampaignsQuery = useBeneficiaryCampaigns(walletAddress);
  const localCampaigns = useLocalCampaigns(walletAddress, localRefreshKey);

  const senderCampaigns = useMemo(() => {
    const dbSenderCampaigns = ((senderCampaignsQuery.data?.campaigns ?? []) as SenderCampaign[]).filter(
      (campaign) => campaign.creator === walletAddress,
    ).map((campaign) => {
      if (!campaign.streamSettled && isStreamSettledLocal(campaign.treeAddress)) {
        return { ...campaign, streamSettled: true };
      }
      return campaign;
    });

    const seen = new Set(dbSenderCampaigns.map((campaign) => campaign.treeAddress));
    const localOnly = localCampaigns.senderCampaigns.filter(
      (campaign) => !seen.has(campaign.treeAddress) && campaign.creator === walletAddress,
    );

    return [...dbSenderCampaigns, ...localOnly];
  }, [
    senderCampaignsQuery.data?.campaigns,
    localCampaigns.senderCampaigns,
    walletAddress,
  ]);

  const recipientCampaigns = useMemo(
    () => {
      const dbRecipientCampaigns = ((recipientCampaignsQuery.data?.campaigns ?? []) as RecipientCampaign[]).map(
        (campaign) => {
          if (!campaign.streamSettled && isStreamSettledLocal(campaign.treeAddress)) {
            return { ...campaign, streamSettled: true };
          }
          return campaign;
        },
      );

      const seen = new Set(dbRecipientCampaigns.map((campaign) => campaign.treeAddress));
      const localOnly = localCampaigns.recipientCampaigns.filter(
        (campaign) => !seen.has(campaign.treeAddress),
      );

      return [...dbRecipientCampaigns, ...localOnly];
    },
    [
      localCampaigns.recipientCampaigns,
      recipientCampaignsQuery.data?.campaigns,
    ],
  );

  useEffect(() => {
    const uniqueMints = [
      ...new Set([
        ...senderCampaigns.map((item) => item.mint),
        ...recipientCampaigns.map((item) => item.mint),
      ]),
    ];

    if (uniqueMints.length === 0) {
      setMintDecimals({});
      setDecimalsLoading(false);
      return;
    }

    let cancelled = false;
    setDecimalsLoading(true);
    void Promise.all(
      uniqueMints.map(async (mint) => {
        try {
          const popularToken = POPULAR_TOKENS.find((token) => token.mint === mint);
          if (popularToken) {
            return [mint, popularToken.decimals] as const;
          }

          const pubkey = new PublicKey(mint);
          const parsedInfo = await connection.getParsedAccountInfo(pubkey);
          const parsed = (parsedInfo.value?.data as any)?.parsed;
          if (parsed?.type === "mint") {
            return [mint, parsed.info.decimals] as const;
          }

          const rawInfo = await connection.getAccountInfo(pubkey);
          if (!rawInfo || rawInfo.data.length < 45) return null;
          return [mint, rawInfo.data[44]] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, number> = {};
      for (const entry of entries) {
        if (entry) next[entry[0]] = entry[1];
      }
      setMintDecimals(next);
      setDecimalsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [connection, senderCampaigns, recipientCampaigns]);

  const rows = useMemo(() => {
    const nowTs = BigInt(Math.floor(Date.now() / 1000));
    const map = new Map<string, StreamRow>();

    for (const campaign of senderCampaigns) {
      map.set(campaign.treeAddress, {
        treeAddress: campaign.treeAddress,
        role: "sender",
        primaryRole: "sender",
        roleLabel: "Sender",
        creator: campaign.creator,
        mint: campaign.mint,
        campaignId: campaign.campaignId,
        createdAt: campaign.createdAt,
        status: getSenderStreamStatus(campaign),
        amountLabel: "Total Supply",
        amountRaw: toBigInt(campaign.totalSupply),
        claimedRaw: toBigInt(campaign.totalClaimed),
        nextLabel: "Recipients",
        nextValue: getSenderStateText(campaign),
        typeLabel: campaign.leafCount === 1 ? "Single Stream" : "Campaign",
        counterpartyLabel: "Recipients",
        counterpartyValue: `${campaign.leafCount}`,
        metadata: campaign.metadata,
      });
    }

    const recipientGroups = new Map<string, RecipientCampaign[]>();
    for (const campaign of recipientCampaigns) {
      const group = recipientGroups.get(campaign.treeAddress) ?? [];
      group.push(campaign);
      recipientGroups.set(campaign.treeAddress, group);
    }

    for (const [, campaigns] of recipientGroups) {
      const first = campaigns[0];
      const isMultiLeaf = campaigns.length > 1;

      const status = isMultiLeaf
        ? getMultiLeafRecipientStreamStatus(campaigns, nowTs)
        : getRecipientStreamStatus(first, nowTs);
      const allocationRaw = isMultiLeaf
        ? campaigns.reduce((sum, c) => sum + toBigInt(c.myLeaf.amount), 0n)
        : toBigInt(first.myLeaf.amount);
      const claimableRaw = isMultiLeaf
        ? getMultiLeafClaimableAmount(campaigns, nowTs)
        : getRecipientClaimableAmount(first, nowTs);
      const claimedRaw = isMultiLeaf
        ? campaigns.reduce((sum, c) => sum + toBigInt(c.myClaimed), 0n)
        : toBigInt(first.myClaimed);

      const releaseStateText = isMultiLeaf
        ? (status === "Claimed" ? "Fully claimed"
          : status === "Claimable" ? "Claim available"
          : status === "Paused" ? "Paused"
          : status === "Cancelled" ? "Cancelled"
          : `${campaigns.length} milestones`)
        : getReleaseStateText(first, nowTs);

      const row: StreamRow = {
        treeAddress: first.treeAddress,
        role: "recipient",
        primaryRole: "recipient",
        roleLabel: "Recipient",
        creator: first.creator,
        mint: first.mint,
        campaignId: first.campaignId,
        createdAt: first.createdAt,
        status,
        amountLabel: "Your Allocation",
        amountRaw: allocationRaw,
        secondaryAmountLabel: "Total Supply",
        secondaryAmountRaw: toBigInt(first.totalSupply),
        nextLabel: "Release",
        nextValue: releaseStateText,
        typeLabel: isMultiLeaf ? "Milestone" : getReleaseTypeLabel(first.myLeaf.releaseType),
        counterpartyLabel: "Sender",
        counterpartyValue: first.creator,
        claimableRaw,
        claimedRaw,
        metadata: first.metadata,
      };

      const existing = map.get(first.treeAddress);
      if (existing) {
        map.set(first.treeAddress, {
          ...row,
          role: existing.creator === walletAddress ? "both" : "recipient",
          roleLabel: existing.creator === walletAddress ? "Sender + Recipient" : "Recipient",
        });
      } else {
        map.set(first.treeAddress, row);
      }
    }

    return [...map.values()].sort((a, b) => b.createdAt - a.createdAt);
  }, [recipientCampaigns, senderCampaigns, walletAddress]);

  // Mint prices for USD values
  const mintAddresses = useMemo(
    () => [...new Set(rows.map((r) => r.mint).filter(Boolean))],
    [rows],
  );
  const { pricesMap } = useMintPrices(mintAddresses);

  const actionCount = useMemo(() => {
    let n = 0;
    for (const row of rows) {
      if (row.role === "sender" || row.role === "both") {
        const senderMatch = senderCampaigns.find((c) => c.treeAddress === row.treeAddress);
        if (senderMatch && getSenderStreamStatus(senderMatch) === "Grace Period") {
          n++;
          continue;
        }
      }
      if (row.status === "Claimable") {
        n++;
      }
    }
    return n;
  }, [rows, senderCampaigns]);

  const filteredRows = rows.filter((row) => {
    if (activeTab === "recipient" && row.role === "sender") return false;
    if (activeTab === "sender" && row.role === "recipient") return false;
    if (activeTab === "action") {
      if (row.role === "sender" || row.role === "both") {
        const senderMatch = senderCampaigns.find((c) => c.treeAddress === row.treeAddress);
        if (senderMatch && getSenderStreamStatus(senderMatch) === "Grace Period") return true;
      }
      if (row.status === "Claimable") return true;
      return false;
    }

    const q = search.trim().toLowerCase();
    if (!q) return true;

    return [
      row.treeAddress,
      row.mint,
      row.creator,
      row.counterpartyValue,
      row.metadata?.name ?? "",
      row.typeLabel,
      String(row.campaignId),
      row.status,
    ].some((value) => value.toLowerCase().includes(q));
  });

  const tabCounts = useMemo(
    () => ({
      all: rows.length,
      recipient: rows.filter((row) => row.role === "recipient" || row.role === "both").length,
      sender: rows.filter((row) => row.role === "sender" || row.role === "both").length,
      action: actionCount,
    }),
    [rows, actionCount],
  );

  const hasLocalRows =
    localCampaigns.senderCampaigns.length > 0 || localCampaigns.recipientCampaigns.length > 0;

  const isLoading =
    senderCampaignsQuery.isFetching ||
    recipientCampaignsQuery.isFetching ||
    localCampaigns.isLoading ||
    decimalsLoading;
  const apiError =
    senderCampaignsQuery.error?.message ?? recipientCampaignsQuery.error?.message ?? null;
  const error = rows.length === 0 ? apiError ?? localCampaigns.error : null;
  const showingLocalFallback = !!apiError && hasLocalRows;

  async function refreshAll() {
    setLocalRefreshKey((k) => k + 1);
    await Promise.all([senderCampaignsQuery.refetch(), recipientCampaignsQuery.refetch()]);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      {/* Page header */}
      <div className="rounded-xl sm:rounded-2xl border border-line bg-muted p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-primary/70">
              Streams
            </div>
            <h1 className="text-[22px] sm:text-[28px] font-semibold tracking-tight text-foreground">
              Vesting Streams
            </h1>
            <p className="mt-1 font-mono text-[12px] text-muted-foreground">
              Track streams you received and streams you created.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {publicKey && (
              <button
                onClick={refreshAll}
                disabled={isLoading}
                className="rounded-xl border border-line bg-surface-hover px-4 py-2.5 text-[13px] text-secondary-foreground transition hover:border-line-hover hover:text-foreground disabled:opacity-50"
              >
                Refresh
              </button>
            )}
            <Link
              href="/campaign/create"
              className="rounded-xl bg-primary px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-primary/90"
            >
              New Stream
            </Link>
          </div>
        </div>
      </div>

      {!publicKey ? (
        <div className="rounded-2xl border border-dashed border-line bg-muted/60 px-8 py-16 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/[0.07]">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-accent-light">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
            </svg>
          </div>
          <h2 className="text-[16px] font-semibold text-foreground">Connect your wallet</h2>
          <p className="mt-2 font-mono text-[12px] text-muted-foreground">
            Your sender and recipient streams will appear here.
          </p>
        </div>
      ) : (
        <>
          {/* Filter bar */}
          <div className="rounded-xl sm:rounded-2xl border border-line bg-muted p-3 sm:p-4">
            <div className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-center lg:justify-between">
              {/* Mobile: native select */}
              <div className="sm:hidden">
                <select
                  value={activeTab}
                  onChange={(e) => setActiveTab(e.target.value as TabKey)}
                  className="w-full rounded-xl border border-line bg-background px-3 py-2.5 font-mono text-[12px] text-secondary-foreground outline-none transition focus:border-primary/40"
                >
                  {TABS.map((tab) => (
                    <option key={tab.key} value={tab.key}>
                      {tab.label} ({tabCounts[tab.key]}){tab.key === "action" && actionCount > 0 ? " !" : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Desktop: tab buttons */}
              <div className="hidden sm:flex flex-wrap gap-1.5 sm:gap-2">
                {TABS.map((tab) => {
                  const active = activeTab === tab.key;
                  const isAction = tab.key === "action";
                  const hasAction = isAction && actionCount > 0;
                  const btnClass = hasAction && active
                    ? "border border-amber-500/40 bg-amber-500/15 text-amber-400"
                    : hasAction
                      ? "border border-amber-500/25 bg-amber-500/[0.07] text-amber-500/80 hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-400"
                      : active
                        ? "border border-primary/40 bg-primary/15 text-accent-light"
                        : "border border-line bg-transparent text-muted-foreground hover:border-line-hover hover:text-secondary-foreground";
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key)}
                      className={`rounded-full px-3 py-1.5 sm:px-4 sm:py-2 font-mono text-[11px] transition ${btnClass}`}
                    >
                      {tab.label}
                      <span className={`ml-1.5 ${active ? "opacity-70" : "opacity-60"}`}>
                        ({tabCounts[tab.key]})
                      </span>
                      {isAction && !active && actionCount > 0 && (
                        <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500/20 px-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                          {actionCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="w-full lg:w-[320px]">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by token, address, or type"
                  className="w-full rounded-xl border border-line bg-background px-4 py-2.5 font-mono text-[12px] text-secondary-foreground outline-none placeholder:text-muted-foreground transition focus:border-primary/40"
                />
              </div>
            </div>
          </div>

          {/* Local fallback banner */}
          {showingLocalFallback ? (
            <div className="flex items-center gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-5 py-3.5">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-amber-700 dark:text-amber-400">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <p className="flex-1 text-[12px] text-amber-200">
                Indexed API unavailable — showing local cache. Some streams may be missing.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="shrink-0 rounded-lg border border-amber-500/30 px-3 py-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 transition hover:bg-amber-500/10"
              >
                Retry
              </button>
            </div>
          ) : null}

          {/* Content */}
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-2xl border border-line bg-muted p-5"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 shrink-0 rounded-full bg-foreground/10" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-1/3 rounded-full bg-foreground/10" />
                      <div className="h-3 w-1/4 rounded-full bg-foreground/[0.06]" />
                    </div>
                    <div className="h-5 w-16 rounded-full bg-secondary" />
                  </div>
                  <div className="mt-4 h-1.5 w-full rounded-full bg-foreground/[0.06]" />
                  <div className="mt-4 grid grid-cols-4 gap-4 border-t border-border pt-4">
                    {[...Array(4)].map((_, j) => (
                      <div key={j} className="space-y-1.5">
                        <div className="h-2.5 w-12 rounded-full bg-foreground/[0.06]" />
                        <div className="h-3.5 w-16 rounded-full bg-foreground/10" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-500/25 bg-muted p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <div>
                  <p className="text-[13px] font-medium text-red-600 dark:text-red-300">Failed to load streams</p>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">{error}</p>
                </div>
              </div>
            </div>
          ) : filteredRows.length === 0 ? (
            activeTab === "action" ? (
              <div className="rounded-2xl border border-line bg-muted px-8 py-16 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.07]">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </div>
                <h2 className="text-[16px] font-semibold text-foreground">All caught up</h2>
                <p className="mt-2 font-mono text-[12px] text-muted-foreground">
                  No campaigns need attention right now.
                </p>
              </div>
            ) : search.trim() ? (
              <EmptyState
                title="No results"
                body={`No streams match "${search.trim()}". Try a different search term.`}
              />
            ) : activeTab === "recipient" ? (
              <EmptyState
                title="No recipient streams"
                body="You haven't been added as a recipient to any vesting campaigns yet."
              />
            ) : activeTab === "sender" ? (
              <EmptyState
                title="No campaigns created"
                body="You haven't created any vesting campaigns yet."
                actionHref="/campaign/create"
                actionLabel="Create your first stream"
              />
            ) : (
              <EmptyState
                title="No streams yet"
                body="Create a vesting stream or ask a project to add you as a recipient."
                showCreateButton
              />
            )
          ) : (
            <div className="space-y-3 sm:space-y-4">
              {filteredRows.map((row) => {
                const decimals = mintDecimals[row.mint];
                const mintInfo = getMintInfo(row.mint);
                const price = pricesMap.get(row.mint) ?? null;

                const amountDisplay = decimals !== undefined
                  ? formatWithDecimals(row.amountRaw, decimals)
                  : "...";

                const claimableDisplay =
                  row.claimableRaw !== undefined && decimals !== undefined
                    ? formatWithDecimals(row.claimableRaw, decimals)
                    : null;

                const secondaryAmountDisplay =
                  row.secondaryAmountRaw !== undefined && decimals !== undefined
                    ? formatWithDecimals(row.secondaryAmountRaw, decimals)
                    : null;

                // USD values
                const usdValue =
                  price != null && decimals !== undefined
                    ? rawToNumber(row.amountRaw, decimals) * price
                    : null;
                const claimableUsd =
                  price != null && decimals !== undefined && row.claimableRaw !== undefined
                    ? rawToNumber(row.claimableRaw, decimals) * price
                    : null;

                // Progress (claimed %)
                const progressPct =
                  row.amountRaw > 0n && row.claimedRaw !== undefined && decimals !== undefined
                    ? Math.min(100, Math.round(Number(row.claimedRaw * 10000n / row.amountRaw) / 100))
                    : 0;

                const generatedTitle = row.metadata?.name ?? generateTitle(mintInfo, row.typeLabel, row.primaryRole);

                const senderMatch =
                  activeTab === "action" && (row.role === "sender" || row.role === "both")
                    ? senderCampaigns.find((c) => c.treeAddress === row.treeAddress)
                    : undefined;
                const actionNote =
                  senderMatch && getSenderStreamStatus(senderMatch) === "Grace Period" ? (
                    <GracePeriodCountdown
                      cancelledAt={BigInt(senderMatch.cancelledAt!)}
                      className="text-[12px]"
                    />
                  ) : undefined;

                return (
                  <CampaignRow
                    key={row.treeAddress}
                    treeAddress={row.treeAddress}
                    role={row.role}
                    status={row.status}
                    typeLabel={row.typeLabel}
                    title={generatedTitle}
                    mintSymbol={mintInfo.symbol}
                    mintName={mintInfo.name}
                    mintLogoURI={mintInfo.logoURI}
                    amountLabel={row.amountLabel}
                    amountDisplay={amountDisplay}
                    secondaryAmountLabel={row.secondaryAmountLabel}
                    secondaryAmountDisplay={secondaryAmountDisplay}
                    claimableDisplay={row.primaryRole === "recipient" ? claimableDisplay : null}
                    claimableUsd={row.primaryRole === "recipient" ? claimableUsd : null}
                    usdValue={usdValue}
                    progressPct={progressPct}
                    counterpartyLabel={row.counterpartyLabel}
                    counterpartyValue={truncateAddress(row.counterpartyValue)}
                    mintValue={truncateAddress(row.mint)}
                    nextLabel={row.nextLabel}
                    nextValue={row.nextValue}
                    createdAtLabel={formatDate(row.createdAt)}
                    actionNote={actionNote}
                  />
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
