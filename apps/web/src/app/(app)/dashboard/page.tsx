"use client";

import Link from "next/link";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { useVestingProgram } from "@/hooks/useVestingProgram";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

type CampaignSummary = {
  total: number;
  active: number;
  totalSupply: string;
};

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

function formatWithDecimals(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toLocaleString();
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
}

export default function DashboardPage() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const program = useVestingProgram();
  const [summary, setSummary] = useState<CampaignSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!publicKey || !program) {
      setSummary(null);
      return;
    }
    setLoading(true);
    (program.account as any).vestingTree
      .all([{ memcmp: { offset: 8, bytes: publicKey.toBase58() } }])
      .then(async (accounts: { account: any }[]) => {
        const active = accounts.filter(
          (a) => !a.account.paused && !a.account.cancelledAt,
        ).length;

        const mintKeys = [...new Set(accounts.map((a) => (a.account.mint as PublicKey).toBase58()))];
        const decimalsMap: Record<string, number> = {};
        await Promise.all(
          mintKeys.map(async (mint) => {
            try {
              const info = await connection.getParsedAccountInfo(new PublicKey(mint));
              const parsed = (info.value?.data as any)?.parsed;
              if (parsed?.type === "mint") decimalsMap[mint] = parsed.info.decimals;
            } catch {}
          }),
        );

        const perMint: Record<string, bigint> = {};
        for (const a of accounts) {
          const mint = (a.account.mint as PublicKey).toBase58();
          const supply = BigInt((a.account.totalSupply as BN).toString());
          perMint[mint] = (perMint[mint] ?? 0n) + supply;
        }

        let totalHuman = 0;
        for (const [mint, raw] of Object.entries(perMint)) {
          const dec = decimalsMap[mint] ?? 0;
          totalHuman += Number(raw) / (10 ** dec);
        }

        const totalSupply = totalHuman % 1 === 0
          ? totalHuman.toLocaleString()
          : totalHuman.toLocaleString(undefined, { maximumFractionDigits: 6 });

        setSummary({
          total: accounts.length,
          active,
          totalSupply,
        });
      })
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [publicKey, program, connection]);

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
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <path d="M22 10H2" />
              <path d="M6 14h.01" />
            </svg>
          </div>
          <h2 className="mt-4 text-[15px] font-medium text-white">No wallet connected</h2>
          <p className="mt-1 text-[13px] text-[#8b92a5]">
            Connect your Solana wallet using the button in the top right to view your streams.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Total Streams"
              value={loading ? "..." : String(summary?.total ?? 0)}
              sub="All campaigns"
            />
            <StatCard
              label="Active"
              value={loading ? "..." : String(summary?.active ?? 0)}
              sub="Currently vesting"
              accent
            />
            <StatCard
              label="Total Supply"
              value={loading ? "..." : summary?.totalSupply ?? "0"}
              sub="Across all streams"
            />
          </div>

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
