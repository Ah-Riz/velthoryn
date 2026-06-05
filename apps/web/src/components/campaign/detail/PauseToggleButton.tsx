"use client";

import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { type Program } from "@coral-xyz/anchor";
import { useQueryClient } from "@tanstack/react-query";

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

function waitForLoadingPaint() {
  return new Promise<void>((resolve) => setTimeout(resolve, 250));
}

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
  const queryClient = useQueryClient();

  if (!isPauseAuthority || cancelledAt !== null) return null;

  async function handleToggle() {
    setLoading(true);
    await waitForLoadingPaint();
    try {
      const method = paused
        ? program.methods.unpauseCampaign()
        : program.methods.pauseCampaign();

      const sig = await method
        .accounts({
          pauseAuthority: publicKey,
          vestingTree: treePubkey,
        })
        .rpc({ commitment: "confirmed" });

      fetch("/api/events/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature: sig }),
      })
        .then(() => queryClient.invalidateQueries({ queryKey: ["timeline", treePubkey.toBase58()] }))
        .catch(() => {});

      toast(paused ? "Campaign resumed." : "Campaign paused.", "success");
      onSuccess();
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        /User rejected|Connection rejected/i.test(err.message)
      ) {
        return;
      }
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
        className="w-full rounded-xl border border-emerald-500/20 py-2.5 text-[13px] font-medium text-emerald-400 transition hover:border-emerald-500/40 hover:bg-emerald-500/5 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Resuming..." : "Unpause Campaign"}
      </button>
    );
  }

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      className="w-full rounded-xl border border-amber-500/20 py-2.5 text-[13px] font-medium text-amber-400 transition hover:border-amber-500/40 hover:bg-amber-500/5 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? "Pausing..." : "Pause Campaign"}
    </button>
  );
}
