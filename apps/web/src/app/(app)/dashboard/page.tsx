"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCampaignList } from "@/hooks/useCampaignList";
import { useBeneficiaryCampaigns } from "@/hooks/useBeneficiaryCampaigns";
import { useLocalCampaigns } from "@/hooks/useLocalCampaigns";
import { getRecipientStreamStatus, getSenderStreamStatus } from "@/lib/vesting/list";

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#555d73]">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${accent ? "text-violet-400" : "text-white"}`}>{value}</div>
      {sub && <div className="mt-1 text-[12px] text-[#555d73]">{sub}</div>}
    </div>
  );
}

function ActionCard({ href, title, description, icon }: { href: string; title: string; description: string; icon: React.ReactNode }) {
  return (
    <Link href={href} className="group flex items-start gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 transition-colors hover:border-violet-500/20 hover:bg-violet-500/[0.03]">
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

  const senderCampaigns = useMemo(() => {
    const dbCampaigns = (senderQuery.data?.campaigns ?? []) as Array<{
      treeAddress: string;
      paused: boolean;
      cancelledAt: number | null;
      totalSupply: number | string;
      totalClaimed: number | string;
    }>;
    const seen = new Set(dbCampaigns.map((c) => c.treeAddress));
    const localOnly = senderQuery.error
      ? localCampaigns.senderCampaigns.filter((c) => !seen.has(c.treeAddress))
      : [];
    return [...dbCampaigns, ...localOnly];
  }, [senderQuery.data?.campaigns, senderQuery.error, localCampaigns.senderCampaigns]);

  const recipientCampaigns = useMemo(() => {
    const dbCampaigns = (recipientQuery.data?.campaigns ?? []) as Array<{
      treeAddress: string;
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

  const counts = useMemo(() => {
    const nowTs = BigInt(Math.floor(Date.now() / 1000));
    const statusesByTree = new Map<
      string,
      Array<"Active" | "Scheduled" | "Claimable" | "Claimed" | "Paused" | "Cancelled">
    >();

    for (const campaign of senderCampaigns) {
      const existing = statusesByTree.get(campaign.treeAddress) ?? [];
      existing.push(getSenderStreamStatus(campaign));
      statusesByTree.set(campaign.treeAddress, existing);
    }

    for (const campaign of recipientCampaigns) {
      const existing = statusesByTree.get(campaign.treeAddress) ?? [];
      existing.push(getRecipientStreamStatus(campaign, nowTs));
      statusesByTree.set(campaign.treeAddress, existing);
    }

    const activeCount = [...statusesByTree.values()].filter(
      (statuses) =>
        statuses.includes("Active") ||
        statuses.includes("Claimable"),
    ).length;

    // Total Value Locked (sender campaigns: totalSupply - totalClaimed)
    let tvl = 0n;
    for (const c of senderCampaigns) {
      const supply = BigInt(c.totalSupply?.toString() ?? "0");
      const claimed = BigInt(c.totalClaimed?.toString() ?? "0");
      if (supply > claimed) tvl += supply - claimed;
    }

    // Claimable now (recipient campaigns where status is Claimable)
    let claimableCount = 0;
    for (const campaign of recipientCampaigns) {
      const status = getRecipientStreamStatus(campaign, nowTs);
      if (status === "Claimable") claimableCount++;
    }

    return {
      total: statusesByTree.size,
      active: activeCount,
      sender: senderCampaigns.length,
      recipient: recipientCampaigns.length,
      tvl,
      claimableCount,
    };
  }, [recipientCampaigns, senderCampaigns]);

  const isLoading = senderQuery.isLoading || recipientQuery.isLoading || localCampaigns.isLoading;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Dashboard</h1>
        <p className="mt-1 text-[13px] text-[#8b92a5]">
          {publicKey ? `Welcome back, ${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}` : "Connect your wallet to get started"}
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
          <p className="mt-1 text-[13px] text-[#8b92a5]">Connect your Solana wallet using the button in the top right to view your streams.</p>
        </div>
      ) : (
        <>
          {/* Claimable Banner */}
          {counts.claimableCount > 0 && (
            <Link href="/campaigns" className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-5 transition hover:border-emerald-500/40">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              </div>
              <div className="flex-1">
                <p className="text-[14px] font-medium text-emerald-400">
                  {counts.claimableCount} stream{counts.claimableCount > 1 ? "s" : ""} ready to claim!
                </p>
                <p className="text-[12px] text-[#8b92a5]">You have tokens available for withdrawal. Click to view.</p>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#8b92a5]"><polyline points="9 18 15 12 9 6"/></svg>
            </Link>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total Streams" value={isLoading ? "..." : String(counts.total)} sub="All campaigns" />
            <StatCard label="Active" value={isLoading ? "..." : String(counts.active)} sub="Currently vesting" accent />
            <StatCard label="As Sender" value={isLoading ? "..." : String(counts.sender)} sub="Streams you created" />
            <StatCard label="As Recipient" value={isLoading ? "..." : String(counts.recipient)} sub="Streams you receive" />
          </div>

          <div>
            <h2 className="mb-3 text-[13px] font-medium uppercase tracking-[0.1em] text-[#555d73]">Quick Actions</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <ActionCard
                href="/campaign/create"
                title="Create New Stream"
                description="Set up a new vesting stream for token distribution"
                icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg>}
              />
              <ActionCard
                href="/campaigns"
                title="View My Campaigns"
                description="Monitor and manage your existing vesting streams"
                icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
