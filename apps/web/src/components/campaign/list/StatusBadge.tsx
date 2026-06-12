"use client";

import type { StreamStatus } from "@/lib/vesting/list";

export function StatusBadge({ status }: { status: StreamStatus }) {
  const classes =
    status === "Claimable"
      ? "border-[#14f1d9]/25 bg-[#14f1d9]/10 text-[#14f1d9]"
      : status === "Claimed"
        ? "border-sky-500/20 bg-sky-500/10 text-sky-300"
        : status === "Paused"
          ? "border-amber-500/20 bg-amber-500/10 text-amber-400"
          : status === "Cancelled"
            ? "border-red-500/20 bg-red-500/10 text-red-400"
            : status === "Settled"
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
              : "border-[#222838] bg-[#161a25] text-[#64748b]";

  const dot =
    status === "Claimable"
      ? "bg-[#14f1d9]"
      : status === "Active" || status === "Scheduled"
        ? "bg-[#64748b]"
        : null;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] font-medium tracking-[0.06em] ${classes}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
      {status}
    </span>
  );
}
