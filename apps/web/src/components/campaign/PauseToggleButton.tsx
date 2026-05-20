"use client";

import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { type Program } from "@coral-xyz/anchor";

type Props = {
  program: Program;
  publicKey: PublicKey;
  treePubkey: PublicKey;
  paused: boolean;
  isPauseAuthority: boolean;
  cancelledAt: bigint | null;
  onSuccess: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
};

export function PauseToggleButton({
  program,
  publicKey,
  treePubkey,
  paused,
  isPauseAuthority,
  cancelledAt,
  onSuccess,
  toast,
}: Props) {
  const [loading, setLoading] = useState(false);

  if (!isPauseAuthority || cancelledAt !== null) return null;

  async function handleToggle() {
    setLoading(true);
    try {
      const method = paused
        ? program.methods.unpauseCampaign()
        : program.methods.pauseCampaign();

      await method
        .accounts({
          pauseAuthority: publicKey,
          vestingTree: treePubkey,
        })
        .rpc();

      toast(paused ? "Campaign resumed." : "Campaign paused.", "success");
      onSuccess();
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        /User rejected|Connection rejected/i.test(err.message)
      )
        return;
      toast(
        err instanceof Error ? err.message : "Failed to toggle pause",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }

  if (paused) {
    return (
      <button
        onClick={handleToggle}
        disabled={loading}
        className="w-full rounded-xl border border-emerald-500/20 py-2.5 text-[13px] font-medium text-emerald-400 transition hover:border-emerald-500/40 hover:bg-emerald-500/5 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Resuming..." : "Unpause Campaign"}
      </button>
    );
  }

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      className="w-full rounded-xl border border-amber-500/20 py-2.5 text-[13px] font-medium text-amber-400 transition hover:border-amber-500/40 hover:bg-amber-500/5 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {loading ? "Pausing..." : "Pause Campaign"}
    </button>
  );
}
