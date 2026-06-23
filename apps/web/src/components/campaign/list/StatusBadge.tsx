"use client";

import type { StreamStatus } from "@/lib/vesting/list";

const STATUS_CONFIG: Record<
  StreamStatus,
  { label: string; classes: string; dot?: string }
> = {
  Claimable: {
    label: "Claimable",
    classes: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    dot: "bg-emerald-400",
  },
  Claimed: {
    label: "Completed",
    classes: "border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-500",
  },
  Active: {
    label: "Active",
    classes: "border-blue-500/25 bg-blue-500/[0.08] text-blue-400",
    dot: "bg-blue-400",
  },
  Scheduled: {
    label: "Locked",
    classes: "border-violet-500/25 bg-violet-500/[0.08] text-violet-400",
  },
  Paused: {
    label: "Paused",
    classes: "border-amber-500/25 bg-amber-500/10 text-amber-400",
  },
  "Grace Period": {
    label: "Cancelling",
    classes: "border-orange-500/25 bg-orange-500/10 text-orange-400",
    dot: "bg-orange-400",
  },
  Cancelled: {
    label: "Cancelled",
    classes: "border-red-500/20 bg-red-500/[0.07] text-red-400",
  },
  Settled: {
    label: "Settled",
    classes: "border-slate-500/20 bg-slate-500/[0.07] text-slate-400",
  },
  Refunded: {
    label: "Refunded",
    classes: "border-rose-500/20 bg-rose-500/[0.07] text-rose-400",
  },
};

const TYPE_CONFIG: Record<
  string,
  { label: string; classes: string }
> = {
  Cliff: {
    label: "Cliff",
    classes: "border-amber-500/20 bg-amber-500/[0.06] text-amber-500/80",
  },
  Linear: {
    label: "Linear",
    classes: "border-violet-500/20 bg-violet-500/[0.06] text-violet-400/80",
  },
  Milestone: {
    label: "Milestone",
    classes: "border-blue-500/20 bg-blue-500/[0.06] text-blue-400/80",
  },
  "Single Stream": {
    label: "Stream",
    classes: "border-line bg-surface-hover text-muted-foreground",
  },
  Campaign: {
    label: "Campaign",
    classes: "border-line bg-surface-hover text-muted-foreground",
  },
};

export function StatusBadge({ status }: { status: StreamStatus }) {
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    classes: "border-line bg-surface-hover text-muted-foreground",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] font-medium tracking-[0.06em] ${config.classes}`}
    >
      {config.dot && (
        <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      )}
      {config.label}
    </span>
  );
}

export function TypeBadge({ typeLabel }: { typeLabel: string }) {
  const config = TYPE_CONFIG[typeLabel];
  if (!config) return null;

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[10px] font-medium tracking-[0.06em] ${config.classes}`}
    >
      {config.label}
    </span>
  );
}
