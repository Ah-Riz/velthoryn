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
  const { sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [loading, setLoading] = useState(false);

  if (!canRelease) return null;

  if (alreadyReleased) return null;

  async function handleRelease() {
    setLoading(true);
    try {
      const ix = await program.methods
        .setMilestoneReleased(milestoneIdx)
        .accounts({
          creator: publicKey,
          vestingTree: treePubkey,
        })
        .instruction();
      const tx = new Transaction().add(ix);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");

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
