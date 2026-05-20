"use client";

import Link from "next/link";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useEffect, useState, useCallback } from "react";
import { useVestingProgram } from "@/hooks/useVestingProgram";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

type Campaign = {
  treeAddress: string;
  creator: string;
  mint: string;
  totalSupply: bigint;
  totalClaimed: bigint;
  paused: boolean;
  cancelledAt: bigint | null;
  createdAt: number;
  campaignId: string;
};

function StatusBadge({ paused, cancelledAt }: { paused: boolean; cancelledAt: bigint | null }) {
  if (cancelledAt) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-0.5 text-[11px] font-medium text-red-400">
        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
        Cancelled
      </span>
    );
  }
  if (paused) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-400">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        Paused
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      Active
    </span>
  );
}

function truncAddr(addr: string) {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function progressPercent(claimed: bigint, supply: bigint): number {
  if (supply === 0n) return 0;
  return Number((claimed * 100n) / supply);
}

function formatWithDecimals(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toLocaleString();
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
}

export default function CampaignsPage() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const program = useVestingProgram();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mintDecimals, setMintDecimals] = useState<Record<string, number>>({});

  const fetchOnChain = useCallback(async () => {
    if (!publicKey || !program) return;
    setLoading(true);
    setError(null);
    try {
      const accounts = await (program.account as any).vestingTree.all([
        {
          memcmp: {
            offset: 8,
            bytes: publicKey.toBase58(),
          },
        },
      ]);

      const mapped: Campaign[] = accounts.map(
        (acc: { publicKey: PublicKey; account: any }) => ({
          treeAddress: acc.publicKey.toBase58(),
          creator: (acc.account.creator as PublicKey).toBase58(),
          mint: (acc.account.mint as PublicKey).toBase58(),
          totalSupply: BigInt((acc.account.totalSupply as BN).toString()),
          totalClaimed: BigInt((acc.account.totalClaimed as BN).toString()),
          paused: acc.account.paused as boolean,
          cancelledAt: acc.account.cancelledAt
            ? BigInt((acc.account.cancelledAt as BN).toString())
            : null,
          createdAt: (acc.account.createdAt as BN).toNumber(),
          campaignId: (acc.account.campaignId as BN).toString(),
        }),
      );

      mapped.sort((a, b) => b.createdAt - a.createdAt);
      setCampaigns(mapped);

      const uniqueMints = [...new Set(mapped.map((c) => c.mint))];
      const decimalsMap: Record<string, number> = {};
      await Promise.all(
        uniqueMints.map(async (mint) => {
          try {
            const info = await connection.getParsedAccountInfo(new PublicKey(mint));
            const parsed = (info.value?.data as any)?.parsed;
            if (parsed?.type === "mint") decimalsMap[mint] = parsed.info.decimals;
          } catch {}
        }),
      );
      setMintDecimals(decimalsMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch campaigns");
    } finally {
      setLoading(false);
    }
  }, [publicKey, program, connection]);

  useEffect(() => {
    fetchOnChain();
  }, [fetchOnChain]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">My Campaigns</h1>
          <p className="mt-1 text-[13px] text-[#8b92a5]">
            Vesting streams you created — fetched directly from Solana
          </p>
        </div>
        <div className="flex items-center gap-3">
          {publicKey && (
            <button
              onClick={fetchOnChain}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[12px] text-[#8b92a5] transition hover:bg-white/[0.06] disabled:opacity-50"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={loading ? "animate-spin" : ""}
              >
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              Refresh
            </button>
          )}
          <Link
            href="/campaign/create"
            className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-violet-500"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Stream
          </Link>
        </div>
      </div>

      {!publicKey ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] px-8 py-16 text-center">
          <div className="text-[14px] font-medium text-white">Connect your wallet</div>
          <p className="mt-1 text-[13px] text-[#8b92a5]">
            Your campaigns will appear here once connected.
          </p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.02] py-16">
          <div className="flex items-center gap-3 text-[13px] text-[#8b92a5]">
            <svg className="h-5 w-5 animate-spin text-violet-400" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            Fetching from Solana...
          </div>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-5 py-4 text-[13px] text-red-300">
          {error}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] px-8 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] text-[#555d73]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <h3 className="mt-4 text-[14px] font-medium text-white">No campaigns yet</h3>
          <p className="mt-1 text-[13px] text-[#8b92a5]">
            Create your first vesting stream to get started.
          </p>
          <Link
            href="/campaign/create"
            className="mt-4 rounded-xl bg-violet-600 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-violet-500"
          >
            Create Stream
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/[0.06]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                <th className="px-5 py-3 text-left text-[11px] font-medium uppercase tracking-[0.1em] text-[#555d73]">
                  Stream
                </th>
                <th className="px-5 py-3 text-left text-[11px] font-medium uppercase tracking-[0.1em] text-[#555d73]">
                  Mint
                </th>
                <th className="px-5 py-3 text-right text-[11px] font-medium uppercase tracking-[0.1em] text-[#555d73]">
                  Supply
                </th>
                <th className="px-5 py-3 text-right text-[11px] font-medium uppercase tracking-[0.1em] text-[#555d73]">
                  Progress
                </th>
                <th className="px-5 py-3 text-center text-[11px] font-medium uppercase tracking-[0.1em] text-[#555d73]">
                  Status
                </th>
                <th className="px-5 py-3 text-left text-[11px] font-medium uppercase tracking-[0.1em] text-[#555d73]">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const pct = progressPercent(c.totalClaimed, c.totalSupply);
                return (
                  <tr
                    key={c.treeAddress}
                    className="border-b border-white/[0.04] transition-colors last:border-b-0 hover:bg-white/[0.02]"
                  >
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/campaign/${c.treeAddress}`}
                        className="font-mono text-[13px] text-violet-400 hover:text-violet-300"
                      >
                        {truncAddr(c.treeAddress)}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[13px] text-[#8b92a5]">
                      {truncAddr(c.mint)}
                    </td>
                    <td className="px-5 py-3.5 text-right font-mono text-[13px] text-white">
                      {formatWithDecimals(c.totalSupply, mintDecimals[c.mint] ?? 0)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/[0.06]">
                          <div
                            className="h-full rounded-full bg-violet-500"
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                        <span className="text-[12px] tabular-nums text-[#8b92a5]">{pct}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <StatusBadge paused={c.paused} cancelledAt={c.cancelledAt} />
                    </td>
                    <td className="px-5 py-3.5 text-[13px] text-[#8b92a5]">
                      {c.createdAt ? formatDate(c.createdAt) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
