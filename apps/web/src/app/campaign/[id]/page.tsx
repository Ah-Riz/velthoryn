"use client";

import { useEffect, useState, useCallback, use } from "react";
import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);
import { BN } from "@coral-xyz/anchor";
import { useVestingProgram } from "@/hooks/useVestingProgram";
import { derivePda } from "@/lib/anchor/client";

type TreeState = {
  creator: PublicKey;
  mint: PublicKey;
  vault: PublicKey;
  campaignId: BN;
  totalSupply: BN;
  totalClaimed: BN;
  cancelledAt: BN | null;
  paused: boolean;
  createdAt: BN;
  leafCount: number;
};

function vestedAmount(
  amount: bigint,
  releaseType: number,
  cliffTs: bigint,
  endTs: bigint,
  cancelledAt: bigint | null,
  now: bigint,
): bigint {
  const effectiveNow = cancelledAt !== null && cancelledAt < now ? cancelledAt : now;

  switch (releaseType) {
    case 0:
      return effectiveNow >= cliffTs ? amount : 0n;
    case 1: {
      if (effectiveNow >= endTs) return amount;
      if (effectiveNow <= cliffTs) return 0n;
      const elapsed = effectiveNow - cliffTs;
      const duration = endTs - cliffTs;
      return (amount * elapsed) / duration;
    }
    case 2:
      return effectiveNow >= cliffTs ? amount : 0n;
    default:
      return 0n;
  }
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

function progressPercent(vested: bigint, total: bigint): number {
  if (total === 0n) return 0;
  return Number((vested * 100n) / total);
}

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: treeAddress } = use(params);
  const { publicKey } = useWallet();
  const program = useVestingProgram();

  const [treeState, setTreeState] = useState<TreeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [releaseType, setReleaseType] = useState(1);
  const [startTime, setStartTime] = useState("");
  const [cliffTime, setCliffTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [milestoneIdx, setMilestoneIdx] = useState("0");

  const [txStatus, setTxStatus] = useState<
    { type: "idle" } | { type: "loading" } | { type: "success"; sig: string } | { type: "error"; msg: string }
  >({ type: "idle" });

  const fetchTree = useCallback(async () => {
    if (!program) return;
    setLoading(true);
    try {
      const treePubkey = new PublicKey(treeAddress);
      const account = await (program.account as any).vestingTree.fetch(treePubkey);
      setTreeState({
        creator: account.creator,
        mint: account.mint,
        vault: account.vault,
        campaignId: account.campaignId,
        totalSupply: account.totalSupply,
        totalClaimed: account.totalClaimed,
        cancelledAt: account.cancelledAt ?? null,
        paused: account.paused,
        createdAt: account.createdAt,
        leafCount: account.leafCount,
      });
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch campaign");
    } finally {
      setLoading(false);
    }
  }, [program, treeAddress]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  const nowTs = BigInt(Math.floor(Date.now() / 1000));
  const totalSupply = treeState ? BigInt(treeState.totalSupply.toString()) : 0n;
  const totalClaimed = treeState ? BigInt(treeState.totalClaimed.toString()) : 0n;
  const cancelledAtBigint = treeState?.cancelledAt
    ? BigInt(treeState.cancelledAt.toString())
    : null;

  const cliffTsBigint = cliffTime ? BigInt(Math.floor(new Date(cliffTime).getTime() / 1000)) : 0n;
  const endTsBigint = endTime ? BigInt(Math.floor(new Date(endTime).getTime() / 1000)) : 0n;

  const vested = cliffTime && endTime
    ? vestedAmount(totalSupply, releaseType, cliffTsBigint, endTsBigint, cancelledAtBigint, nowTs)
    : 0n;
  const claimable = vested > totalClaimed ? vested - totalClaimed : 0n;
  const progress = progressPercent(vested, totalSupply);

  async function handleWithdraw() {
    if (!program || !publicKey || !treeState) return;

    setTxStatus({ type: "loading" });

    try {
      const treePubkey = new PublicKey(treeAddress);
      const [vaultAuthority] = derivePda(["vault_authority", treePubkey.toBuffer()]);
      const [claimRecord] = derivePda([
        "claim",
        treePubkey.toBuffer(),
        publicKey.toBuffer(),
      ]);

      const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
      const beneficiaryAta = getAssociatedTokenAddressSync(treeState.mint, publicKey);

      const startTs = startTime ? new BN(Math.floor(new Date(startTime).getTime() / 1000)) : new BN(0);
      const cliffTs = new BN(Math.floor(new Date(cliffTime).getTime() / 1000));
      const endTs = new BN(Math.floor(new Date(endTime).getTime() / 1000));

      const sig = await program.methods
        .withdraw({
          releaseType,
          startTime: startTs,
          cliffTime: cliffTs,
          endTime: endTs,
          milestoneIdx: Number(milestoneIdx),
        })
        .accounts({
          beneficiary: publicKey,
          vestingTree: treePubkey,
          claimRecord,
          vaultAuthority,
          vault: treeState.vault,
          beneficiaryAta,
          mint: treeState.mint,
        })
        .rpc();

      setTxStatus({ type: "success", sig });
      fetchTree();
    } catch (err: unknown) {
      const msg = parseAnchorError(err);
      setTxStatus({ type: "error", msg });
    }
  }

  function parseAnchorError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);

    if (raw.includes("NothingToClaim") || raw.includes("0x1779")) {
      return "Nothing to claim yet. Tokens haven't vested past your last claim.";
    }
    if (raw.includes("CampaignPaused") || raw.includes("0x1776")) {
      return "Campaign is paused. Contact the campaign creator.";
    }
    if (raw.includes("InvalidProof") || raw.includes("0x1773")) {
      return "Invalid vesting parameters. Check your release type, cliff, and end times match the original stream.";
    }
    if (raw.includes("UnauthorizedClaimer") || raw.includes("0x1778")) {
      return "You are not the beneficiary of this stream.";
    }
    if (raw.includes("InsufficientVault") || raw.includes("0x177a")) {
      return "Vault has insufficient tokens. Contact the campaign creator.";
    }
    if (raw.includes("AccountNotInitialized")) {
      return "Required account not found on-chain. The stream may not exist or hasn't been funded.";
    }
    if (raw.includes("User rejected")) {
      return "Transaction cancelled by user.";
    }

    return raw;
  }

  return (
    <main className="max-w-2xl mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Vesting Stream</h1>
        <WalletMultiButton />
      </div>

      {!publicKey ? (
        <p className="text-gray-400">Connect wallet to view and claim tokens.</p>
      ) : loading ? (
        <p className="text-gray-400">Loading campaign...</p>
      ) : error ? (
        <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg">
          <p className="text-red-400">{error}</p>
        </div>
      ) : treeState ? (
        <div className="space-y-6">
          {/* Campaign Info */}
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 space-y-3">
            <h2 className="text-lg font-medium mb-4">Campaign Details</h2>
            <InfoRow label="Tree Address" value={treeAddress} mono />
            <InfoRow label="Creator" value={treeState.creator.toBase58()} mono />
            <InfoRow label="Mint" value={treeState.mint.toBase58()} mono />
            <InfoRow label="Total Supply" value={treeState.totalSupply.toString()} />
            <InfoRow label="Total Claimed" value={treeState.totalClaimed.toString()} />
            <InfoRow label="Created" value={formatDate(treeState.createdAt.toNumber())} />
            <InfoRow label="Status" value={
              treeState.paused ? "Paused" :
              treeState.cancelledAt ? "Cancelled" : "Active"
            } />
          </div>

          {/* Vesting Schedule Input */}
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 space-y-4">
            <h2 className="text-lg font-medium">Your Vesting Schedule</h2>
            <p className="text-xs text-gray-500">
              Enter your vesting parameters to compute claimable amount.
            </p>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Release Type</label>
              <select
                value={releaseType}
                onChange={(e) => setReleaseType(Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 outline-none"
              >
                <option value={0}>Cliff</option>
                <option value={1}>Linear</option>
                <option value={2}>Milestone</option>
              </select>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Start</label>
                <input
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Cliff</label>
                <input
                  type="datetime-local"
                  value={cliffTime}
                  onChange={(e) => setCliffTime(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 outline-none text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">End</label>
                <input
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 outline-none text-sm"
                  required
                />
              </div>
            </div>

            {releaseType === 2 && (
              <div>
                <label className="block text-sm text-gray-400 mb-1">Milestone Index</label>
                <input
                  type="number"
                  min="0"
                  max="255"
                  value={milestoneIdx}
                  onChange={(e) => setMilestoneIdx(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 outline-none"
                />
              </div>
            )}
          </div>

          {/* Vesting Progress */}
          {cliffTime && endTime && (
            <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 space-y-4">
              <h2 className="text-lg font-medium">Vesting Progress</h2>
              <div className="w-full bg-gray-800 rounded-full h-4 overflow-hidden">
                <div
                  className="bg-purple-600 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(progress, 100)}%` }}
                />
              </div>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold">{progress}%</div>
                  <div className="text-xs text-gray-400">Vested</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-purple-400">{claimable.toString()}</div>
                  <div className="text-xs text-gray-400">Claimable</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">{totalClaimed.toString()}</div>
                  <div className="text-xs text-gray-400">Claimed</div>
                </div>
              </div>

              <button
                onClick={handleWithdraw}
                disabled={txStatus.type === "loading" || claimable === 0n || treeState.paused}
                className="w-full py-3 bg-purple-600 rounded-lg font-medium hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {txStatus.type === "loading"
                  ? "Claiming..."
                  : claimable === 0n
                    ? "Nothing to claim"
                    : treeState.paused
                      ? "Campaign paused"
                      : `Claim ${claimable.toString()} tokens`}
              </button>

              {txStatus.type === "success" && (
                <div className="p-4 bg-green-900/30 border border-green-700 rounded-lg">
                  <p className="text-green-400 font-medium">Claimed successfully!</p>
                  <p className="text-xs text-gray-400 mt-1 font-mono break-all">
                    tx: {txStatus.sig}
                  </p>
                </div>
              )}

              {txStatus.type === "error" && (
                <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg">
                  <p className="text-red-400 font-medium">Error</p>
                  <p className="text-xs text-gray-400 mt-1">{txStatus.msg}</p>
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
    </main>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-sm text-gray-400 shrink-0">{label}</span>
      <span className={`text-sm text-right break-all ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
