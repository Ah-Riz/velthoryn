"use client";

import Link from "next/link";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useCampaignList } from "@/hooks/useCampaignList";
import { useBeneficiaryCampaigns } from "@/hooks/useBeneficiaryCampaigns";
import { useLocalCampaigns } from "@/hooks/useLocalCampaigns";
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
import { POPULAR_TOKENS } from "@/lib/constants/popular-tokens";

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
  metadata: { name?: string; description?: string; logoUri?: string } | null;
};

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "recipient", label: "As Recipient" },
  { key: "sender", label: "As Sender" },
  { key: "action", label: "Needs Action" },
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
  if (status === "Cancelled") return "Cancelled";
  return `${campaign.leafCount} ${campaign.leafCount === 1 ? "recipient" : "recipients"}`;
}

export default function CampaignsPage() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const [activeTab, setActiveTab] = useState<TabKey>("all");
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
    );

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
      const dbRecipientCampaigns = (recipientCampaignsQuery.data?.campaigns ?? []) as RecipientCampaign[];

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

  const actionCount = useMemo(() => {
    let n = 0;
    for (const row of rows) {
      if (row.role === "sender" || row.role === "both") {
        const senderMatch = senderCampaigns.find((c) => c.treeAddress === row.treeAddress);
        if (senderMatch && senderMatch.cancelledAt !== null) {
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
        if (senderMatch && senderMatch.cancelledAt !== null) return true;
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
      <div className="rounded-xl sm:rounded-2xl border border-[#222838] bg-[#13161f] p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[#7c3aed]/70">Streams</div>
            <h1 className="text-[22px] sm:text-[28px] font-semibold tracking-tight text-[#e5e7eb]">Vesting Streams</h1>
            <p className="mt-1 font-mono text-[12px] text-[#64748b]">
              Track streams you received and streams you created.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {publicKey && (
              <button
                onClick={refreshAll}
                disabled={isLoading}
                className="rounded-xl border border-[#222838] bg-[#161a25] px-4 py-2.5 text-[13px] text-[#b4b9c5] transition hover:border-[#2e3648] hover:text-[#e5e7eb] disabled:opacity-50"
              >
                Refresh
              </button>
            )}
            <Link
              href="/campaign/create"
              className="rounded-xl bg-[#7c3aed] px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-[#8b50f1]"
            >
              New Stream
            </Link>
          </div>
        </div>
      </div>

      {!publicKey ? (
        <div className="rounded-2xl border border-dashed border-[#222838] bg-[#13161f]/60 px-8 py-16 text-center">
          <h2 className="text-[16px] font-semibold text-[#e5e7eb]">Connect your wallet</h2>
          <p className="mt-2 font-mono text-[12px] text-[#64748b]">
            Your sender and recipient streams will appear here.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-xl sm:rounded-2xl border border-[#222838] bg-[#13161f] p-3 sm:p-4">
            <div className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-1.5 sm:gap-2">
                {TABS.map((tab) => {
                  const active = activeTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key)}
                      className={`rounded-full px-3 py-1.5 sm:px-4 sm:py-2 font-mono text-[11px] transition ${
                        active
                          ? "border border-[#7c3aed]/40 bg-[#7c3aed]/15 text-[#a78bfa]"
                          : "border border-[#222838] bg-transparent text-[#64748b] hover:border-[#2e3648] hover:text-[#b4b9c5]"
                      }`}
                    >
                      {tab.label} ({tabCounts[tab.key]})
                      {tab.key === "action" && !active && actionCount > 0 && (
                        <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500/20 px-1 text-[10px] font-medium text-amber-400">
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
                  placeholder="Search by campaign, address, or token"
                  className="w-full rounded-xl border border-[#222838] bg-[#0b0d12] px-4 py-2.5 font-mono text-[12px] text-[#b4b9c5] outline-none placeholder:text-[#64748b] transition focus:border-[#7c3aed]/40"
                />
              </div>
            </div>
          </div>

          {showingLocalFallback ? (
            <div className="flex items-center gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-5 py-3.5">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-amber-400">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <p className="flex-1 text-[12px] text-amber-200">
                Indexed API unavailable — showing local cache. Some streams may be missing.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="shrink-0 rounded-lg border border-amber-500/30 px-3 py-1.5 text-[11px] font-medium text-amber-300 transition hover:bg-amber-500/10"
              >
                Retry
              </button>
            </div>
          ) : null}

          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="flex animate-pulse items-center gap-4 rounded-2xl border border-[#222838] bg-[#13161f] px-5 py-4"
                >
                  <div className="h-9 w-9 shrink-0 rounded-xl bg-[#1c2130]" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-1/3 rounded-full bg-[#1c2130]" />
                    <div className="h-2.5 w-1/2 rounded-full bg-[#161a25]" />
                  </div>
                  <div className="hidden space-y-2 sm:block">
                    <div className="h-3 w-20 rounded-full bg-[#1c2130]" />
                    <div className="h-2.5 w-16 rounded-full bg-[#161a25]" />
                  </div>
                  <div className="h-6 w-16 shrink-0 rounded-lg bg-[#1c2130]" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-500/25 bg-[#13161f] p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 text-red-400">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <div>
                  <p className="text-[13px] font-medium text-red-300">Failed to load streams</p>
                  <p className="mt-1 font-mono text-[11px] text-[#64748b]">{error}</p>
                </div>
              </div>
            </div>
          ) : filteredRows.length === 0 ? (
            activeTab === "action" ? (
              <div className="rounded-2xl border border-[#222838] bg-[#13161f] px-8 py-16 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-[#14f1d9]/20 bg-[#14f1d9]/10">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#14f1d9" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </div>
                <h2 className="text-[16px] font-semibold text-[#e5e7eb]">All caught up</h2>
                <p className="mt-2 font-mono text-[12px] text-[#64748b]">No campaigns need attention right now.</p>
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
                actionHref="/campaign/create"
                actionLabel="Create stream"
              />
            )
          ) : (
            <div className="space-y-3 sm:space-y-4">
              {filteredRows.map((row) => {
                const decimals = mintDecimals[row.mint];
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
                const senderMatch =
                  activeTab === "action" && (row.role === "sender" || row.role === "both")
                    ? senderCampaigns.find((c) => c.treeAddress === row.treeAddress)
                    : undefined;
                const actionNote =
                  senderMatch?.cancelledAt != null ? (
                    <GracePeriodCountdown
                      cancelledAt={BigInt(senderMatch.cancelledAt)}
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
                    title={row.metadata?.name || `Campaign #${row.campaignId}`}
                    amountLabel={row.amountLabel}
                    amountDisplay={amountDisplay}
                    secondaryAmountLabel={row.secondaryAmountLabel}
                    secondaryAmountDisplay={secondaryAmountDisplay}
                    claimableDisplay={row.primaryRole === "recipient" ? claimableDisplay : null}
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
