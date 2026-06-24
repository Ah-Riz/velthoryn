"use client";

import { useState } from "react";
import { isMilestoneTriggered } from "@/lib/vesting/milestone";
import { formatCountdown } from "@/lib/vesting/display";

type MilestoneEntry = {
  index: number;
  amount: bigint;
  cliffTime: bigint;
};

type Props = {
  milestones: MilestoneEntry[];
  milestoneReleasedFlags: Uint8Array;
  milestoneBitmap: Uint8Array;
  nowTs: bigint;
  cancelledAt: bigint | null;
  formatAmount: (raw: bigint) => string;
  isCreator?: boolean;
  milestoneUi?: {
    name: string | null;
    owner: string | null;
    mode: string | null;
    evidence: string | null;
  };
};

function getModeLabel(mode: string | null): string {
  if (!mode) return "Time-gated";
  const map: Record<string, string> = {
    manual_review: "Manual Review",
    ops_signoff: "Ops Signoff",
    dao_vote: "DAO Vote",
  };
  return map[mode] ?? mode;
}

export function MilestoneCarouselCard({
  milestones,
  milestoneReleasedFlags,
  milestoneBitmap,
  nowTs,
  cancelledAt,
  isCreator,
  formatAmount,
  milestoneUi,
}: Props) {
  const [activeIdx, setActiveIdx] = useState(0);

  if (milestones.length === 0) return null;

  const sorted = [...milestones].sort((a, b) => a.index - b.index);
  const current = sorted[activeIdx] ?? sorted[0];
  const total = sorted.length;

  const effectiveNow =
    cancelledAt !== null && cancelledAt < nowTs ? cancelledAt : nowTs;
  const released = isMilestoneTriggered(milestoneReleasedFlags, current.index);
  const claimed = isMilestoneTriggered(milestoneBitmap, current.index);
  const unlocked = effectiveNow >= current.cliffTime;

  const statusColor = claimed
    ? "text-emerald-700 dark:text-emerald-400"
    : released && unlocked && !isCreator
      ? "text-violet-700 dark:text-violet-400"
      : released
        ? "text-emerald-700 dark:text-emerald-400"
        : "text-muted-foreground";

  const statusLabel = claimed
    ? "Claimed"
    : released && unlocked && !isCreator
      ? "Ready To Claim"
      : released
        ? "Released"
        : "Awaiting Release";

  const statusBorderColor = claimed
    ? "border-emerald-500/20"
    : released && unlocked && !isCreator
      ? "border-violet-500/20"
      : released
        ? "border-emerald-500/20"
        : "border-foreground/[0.06]";

  const statusBgColor = claimed
    ? "bg-emerald-500/5"
    : released && unlocked && !isCreator
      ? "bg-violet-500/5"
      : released
        ? "bg-emerald-500/5"
        : "bg-foreground/[0.02]";

  const prev = () => setActiveIdx((i) => (i > 0 ? i - 1 : total - 1));
  const next = () => setActiveIdx((i) => (i < total - 1 ? i + 1 : 0));

  return (
    <div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-5">
      {/* Header with navigation */}
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-foreground">
            {milestoneUi?.name ?? `Milestone #${current.index}`}
          </h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {total > 1
              ? `${activeIdx + 1} of ${total} milestones`
              : "Milestone release details"}
          </p>
        </div>

        {total > 1 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={prev}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-foreground/[0.08] bg-foreground/[0.03] text-muted-foreground transition hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={next}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-foreground/[0.08] bg-foreground/[0.03] text-muted-foreground transition hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 6 15 12 9 18" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Navigation indicators */}
      {total > 1 && total <= 12 && (
        <div className="mt-3 flex items-center justify-center gap-1.5">
          {sorted.map((m, i) => {
            const dotClaimed = isMilestoneTriggered(milestoneBitmap, m.index);
            const dotReleased = isMilestoneTriggered(milestoneReleasedFlags, m.index);
            const dotColor = dotClaimed
              ? "bg-emerald-400"
              : dotReleased
                ? "bg-violet-400"
                : "bg-foreground/20";
            return (
              <button
                key={m.index}
                type="button"
                onClick={() => setActiveIdx(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === activeIdx ? `w-5 ${dotColor}` : `w-1.5 ${dotColor} opacity-60`
                }`}
              />
            );
          })}
        </div>
      )}
      {total > 12 && (
        <div className="mt-3 flex items-center justify-center gap-3">
          <input
            type="range"
            min={0}
            max={total - 1}
            value={activeIdx}
            onChange={(e) => setActiveIdx(Number(e.target.value))}
            className="h-1 w-32 cursor-pointer appearance-none rounded-full bg-foreground/10 accent-violet-700 dark:accent-violet-400 sm:w-48"
          />
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {activeIdx + 1}/{total}
          </span>
        </div>
      )}

      {/* Status banner */}
      <div className={`mt-4 flex items-center gap-2.5 rounded-xl border ${statusBorderColor} ${statusBgColor} px-4 py-2.5`}>
        {claimed ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={statusColor}>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : released ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={statusColor}>
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={statusColor}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        )}
        <span className={`text-[13px] font-medium ${statusColor}`}>{statusLabel}</span>
      </div>

      {/* Info grid */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <InfoCell label="Milestone Index" value={`#${current.index}`} />
        <InfoCell label="Trigger Style" value={getModeLabel(milestoneUi?.mode ?? null)} />
        <InfoCell
          label="Unlock Time"
          value={
            unlocked
              ? "Reached"
              : `In ${formatCountdown(current.cliffTime, nowTs)}`
          }
          accent={unlocked}
        />
        <InfoCell
          label="Allocation"
          value={current.amount > 0n ? formatAmount(current.amount) : "—"}
        />
      </div>

      {/* Workflow details */}
      <div className={`mt-4 grid gap-3 ${isCreator ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
        <WorkflowCell
          label="Evidence"
          value={milestoneUi?.evidence ?? null}
          fallback="Not provided"
        />
        <WorkflowCell
          label="Approval"
          value={milestoneUi?.owner ?? null}
          fallback="Not specified"
        />
        {!isCreator && (
          <WorkflowCell
            label="Claim"
            value={
              claimed
                ? "Completed"
                : released && unlocked
                  ? "Available now"
                  : released
                    ? `Opens in ${formatCountdown(current.cliffTime, nowTs)}`
                    : "Awaiting release"
            }
            fallback=""
          />
        )}
      </div>
    </div>
  );
}

function InfoCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-foreground/[0.04] bg-black/20 px-3.5 py-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className={`mt-1.5 text-[14px] font-semibold ${accent ? "text-emerald-700 dark:text-emerald-400" : "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}

function WorkflowCell({
  label,
  value,
  fallback,
}: {
  label: string;
  value: string | null;
  fallback: string;
}) {
  return (
    <div className="rounded-xl border border-foreground/[0.04] bg-black/20 px-3.5 py-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-[13px] font-medium text-foreground">
        {value ?? fallback}
      </p>
    </div>
  );
}
