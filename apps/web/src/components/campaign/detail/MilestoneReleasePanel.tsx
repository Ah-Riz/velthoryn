"use client";

import { useState, useMemo } from "react";
import { PublicKey } from "@solana/web3.js";
import { type Program } from "@coral-xyz/anchor";
import { isMilestoneTriggered } from "@/lib/vesting/milestone";
import { formatVestingError } from "@/lib/anchor/errors";

const PAGE_SIZE = 12;

type Props = {
  program: Program;
  publicKey: PublicKey;
  treePubkey: PublicKey;
  milestoneReleasedFlags: Uint8Array;
  leafCount: number;
  canRelease: boolean;
  onSuccess: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
};

export function MilestoneReleasePanel({
  program,
  publicKey,
  treePubkey,
  milestoneReleasedFlags,
  leafCount,
  canRelease,
  onSuccess,
  toast,
}: Props) {
  const [loadingIdx, setLoadingIdx] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const count = Math.min(leafCount, 256);
  const totalPages = Math.ceil(count / PAGE_SIZE);
  const pageStart = page * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, count);
  const pageItems = Array.from({ length: pageEnd - pageStart }, (_, i) => pageStart + i);

  const releasedCount = useMemo(() => {
    let released = 0;
    for (let i = 0; i < count; i++) {
      if (isMilestoneTriggered(milestoneReleasedFlags, i)) released++;
    }
    return released;
  }, [milestoneReleasedFlags, count]);

  const nextUnreleased = useMemo(() => {
    for (let i = 0; i < count; i++) {
      if (!isMilestoneTriggered(milestoneReleasedFlags, i)) return i;
    }
    return null;
  }, [milestoneReleasedFlags, count]);

  async function handleRelease(idx: number) {
    setLoadingIdx(idx);
    try {
      await program.methods
        .setMilestoneReleased(idx)
        .accounts({ creator: publicKey, vestingTree: treePubkey })
        .rpc();
      toast(`Milestone #${idx} released.`, "success");
      onSuccess();
    } catch (err: unknown) {
      if (err instanceof Error && /User rejected|Connection rejected/i.test(err.message)) return;
      toast(formatVestingError(err), "error");
    } finally {
      setLoadingIdx(null);
    }
  }

  if (!canRelease || leafCount <= 1) return null;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      {/* Header with summary */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] font-medium text-white">Milestone Releases</p>
          <p className="mt-0.5 text-[11px] text-[#6f7c95]">
            {releasedCount}/{count} released
          </p>
        </div>
        {nextUnreleased !== null && (
          <button
            onClick={() => handleRelease(nextUnreleased)}
            disabled={loadingIdx !== null}
            className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-1.5 text-[11px] font-medium text-violet-400 transition hover:bg-violet-500/10 disabled:opacity-50"
          >
            {loadingIdx === nextUnreleased ? "..." : `Release #${nextUnreleased}`}
          </button>
        )}
      </div>

      {/* Compact grid */}
      <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
        {pageItems.map((i) => {
          const released = isMilestoneTriggered(milestoneReleasedFlags, i);
          return (
            <button
              key={i}
              onClick={() => !released && handleRelease(i)}
              disabled={released || loadingIdx !== null}
              className={`flex flex-col items-center justify-center rounded-lg border px-1 py-2 text-center transition ${
                released
                  ? "border-emerald-500/20 bg-emerald-500/5 cursor-default"
                  : "border-white/[0.06] bg-white/[0.02] hover:border-violet-500/30 hover:bg-violet-500/5 disabled:opacity-50"
              }`}
              title={released ? `Milestone #${i} released` : `Release milestone #${i}`}
            >
              <span className={`text-[11px] font-semibold ${released ? "text-emerald-400" : "text-white"}`}>
                #{i}
              </span>
              <span className={`mt-0.5 text-[9px] ${released ? "text-emerald-400/60" : "text-[#555d73]"}`}>
                {loadingIdx === i ? "..." : released ? "done" : "pending"}
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
            className="rounded-md border border-white/[0.08] px-2 py-1 text-[11px] text-[#8b92a5] transition hover:bg-white/[0.04] disabled:opacity-30"
          >
            Prev
          </button>
          <span className="text-[11px] text-[#6f7c95]">
            {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="rounded-md border border-white/[0.08] px-2 py-1 text-[11px] text-[#8b92a5] transition hover:bg-white/[0.04] disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
