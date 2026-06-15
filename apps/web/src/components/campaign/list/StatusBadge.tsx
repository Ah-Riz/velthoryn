"use client";

import type { StreamStatus } from "@/lib/vesting/list";

export function StatusBadge({ status }: { status: StreamStatus }) {
  const classes =
    status === "Claimable"
      ? "border-violet/25 bg-violet/10 text-violet"
      : status === "Claimed"
        ? "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300"
        : status === "Paused"
          ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400"
          : status === "Grace Period"
            ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400"
            : status === "Cancelled" || status === "Settled"
              ? "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400"
              : "border-line bg-surface-hover text-muted-foreground";

  const dot =
    status === "Claimable"
      ? "bg-violet"
      : status === "Active" || status === "Scheduled"
        ? "bg-muted-foreground"
        : null;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] font-medium tracking-[0.06em] ${classes}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
      {status}
    </span>
  );
}
