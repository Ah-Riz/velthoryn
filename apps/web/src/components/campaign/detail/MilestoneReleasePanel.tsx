"use client";

import { useState, useMemo } from "react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { type Program } from "@coral-xyz/anchor";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import { isMilestoneTriggered } from "@/lib/vesting/milestone";
import { formatVestingError } from "@/lib/anchor/errors";

const PAGE_SIZE = 12;

type Props = {
  program: Program;
  publicKey: PublicKey;
  treePubkey: PublicKey;
  milestoneReleasedFlags: Uint8Array;
  milestoneIndices: number[];
  canRelease: boolean;
  onSuccess: (idx: number) => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
};

export function MilestoneReleasePanel({
  program,
  publicKey,
  treePubkey,
  milestoneReleasedFlags,
  milestoneIndices,
  canRelease,
  onSuccess,
  toast,
}: Props) {
  const { sendTransaction } = useWallet();
  const { connection } = useConnection();
  const queryClient = useQueryClient();
  const [loadingIdx, setLoadingIdx] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const indices = milestoneIndices;
  const totalPages = Math.ceil(indices.length / PAGE_SIZE);
  const pageStart = page * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, indices.length);
  const pageItems = indices.slice(pageStart, pageEnd);

  const releasedCount = useMemo(() => {
    let released = 0;
    for (const idx of indices) {
      if (isMilestoneTriggered(milestoneReleasedFlags, idx)) released++;
    }
    return released;
  }, [milestoneReleasedFlags, indices]);

  const nextUnreleased = useMemo(() => {
    for (const idx of indices) {
      if (!isMilestoneTriggered(milestoneReleasedFlags, idx)) return idx;
    }
    return null;
  }, [milestoneReleasedFlags, indices]);

  async function handleRelease(idx: number) {
    setLoadingIdx(idx);
    try {
      const ix = await program.methods
        .setMilestoneReleased(idx)
        .accounts({ creator: publicKey, vestingTree: treePubkey })
        .instruction();
      const tx = new Transaction().add(ix);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");

      const treeKey = treePubkey.toBase58();
      void queryClient.invalidateQueries({ queryKey: ["campaign"] });
      void queryClient.invalidateQueries({ queryKey: ["beneficiaryCampaigns"] });
      void queryClient.invalidateQueries({ queryKey: ["timeline", treeKey] });

      void fetch("/api/events/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature: sig }),
      }).catch(() => {});

      toast(`Milestone #${idx} released.`, "success");
      onSuccess(idx);
    } catch (err: unknown) {
      if (err instanceof Error && /User rejected|Connection rejected/i.test(err.message)) return;
      toast(formatVestingError(err), "error");
    } finally {
      setLoadingIdx(null);
    }
  }

  if (!canRelease || indices.length === 0) return null;

  return (
    <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-4">
      {/* Header with summary */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] font-medium text-foreground">Milestone Releases</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {releasedCount}/{indices.length} released
          </p>
        </div>
        {nextUnreleased !== null && (
          <button
            onClick={() => handleRelease(nextUnreleased)}
            disabled={loadingIdx !== null}
            className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-1.5 text-[11px] font-medium text-violet-700 dark:text-violet-400 transition hover:bg-violet-500/10 disabled:opacity-50"
          >
            {loadingIdx === nextUnreleased ? "..." : `Release #${nextUnreleased}`}
          </button>
        )}
      </div>

      {/* Compact grid */}
      <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
        {pageItems.map((idx) => {
          const released = isMilestoneTriggered(milestoneReleasedFlags, idx);
          return (
            <button
              key={idx}
              onClick={() => !released && handleRelease(idx)}
              disabled={released || loadingIdx !== null}
              className={`flex flex-col items-center justify-center rounded-lg border px-1 py-2 text-center transition ${
                released
                  ? "border-emerald-500/20 bg-emerald-500/5 cursor-default"
                  : "border-foreground/[0.06] bg-foreground/[0.02] hover:border-violet-500/30 hover:bg-violet-500/5 disabled:opacity-50"
              }`}
              title={released ? `Milestone #${idx} released` : `Release milestone #${idx}`}
            >
              <span className={`text-[11px] font-semibold ${released ? "text-emerald-700 dark:text-emerald-400" : "text-foreground"}`}>
                #{idx}
              </span>
              <span className={`mt-0.5 text-[9px] ${released ? "text-emerald-700/60 dark:text-emerald-400/60" : "text-muted-foreground"}`}>
                {loadingIdx === idx ? "..." : released ? "done" : "pending"}
              </span>
            </button>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded-md border border-foreground/[0.08] px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-foreground/[0.04] disabled:opacity-30"
          >
            Prev
          </button>
          <span className="text-[11px] text-muted-foreground">
            {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="rounded-md border border-foreground/[0.08] px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-foreground/[0.04] disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
