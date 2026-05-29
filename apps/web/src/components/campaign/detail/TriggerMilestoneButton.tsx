"use client";

import { useState } from "react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { type Program } from "@coral-xyz/anchor";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { formatVestingError } from "@/lib/anchor/errors";

type Props = {
  program: Program;
  publicKey: PublicKey;
  treePubkey: PublicKey;
  milestoneIdx: number;
  alreadyReleased: boolean;
  canRelease: boolean;
  onSuccess: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
};

export function TriggerMilestoneButton({
  program,
  publicKey,
  treePubkey,
  milestoneIdx,
  alreadyReleased,
  canRelease,
  onSuccess,
  toast,
}: Props) {
  const [loading, setLoading] = useState(false);

  if (!canRelease) return null;

  if (alreadyReleased) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5 text-[13px] text-emerald-400">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Milestone #{milestoneIdx} released
      </div>
    );
  }

  async function handleRelease() {
    setLoading(true);
    try {
      await program.methods
        .setMilestoneReleased(milestoneIdx)
        .accounts({
          creator: publicKey,
          vestingTree: treePubkey,
        })
        .rpc();

      toast(`Milestone #${milestoneIdx} released.`, "success");
      onSuccess();
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        /User rejected|Connection rejected/i.test(err.message)
      ) {
        return;
      }
      toast(formatVestingError(err), "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleRelease}
      disabled={loading}
      className="w-full rounded-xl border border-violet-500/20 py-2.5 text-[13px] font-medium text-violet-400 transition hover:border-violet-500/40 hover:bg-violet-500/5 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? "Releasing..." : `Release Milestone #${milestoneIdx}`}
    </button>
  );
}
