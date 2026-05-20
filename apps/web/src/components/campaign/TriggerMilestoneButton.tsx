"use client";

import { formatCountdown } from "@/lib/vesting/display";

type Props = {
  isMilestoneType: boolean;
  alreadyTriggered: boolean;
  milestoneIdx: number;
  cliffTime: bigint;
  nowTs: bigint;
};

export function MilestoneStatusBadge({
  isMilestoneType,
  alreadyTriggered,
  milestoneIdx,
  cliffTime,
  nowTs,
}: Props) {
  if (!isMilestoneType) return null;

  if (alreadyTriggered) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5 text-[13px] text-emerald-400">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Milestone #{milestoneIdx} claimed
      </div>
    );
  }

  if (nowTs >= cliffTime) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-2.5 text-[13px] text-violet-400">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        Milestone #{milestoneIdx} unlocked — ready to claim
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-[13px] text-[#555d73]">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      Milestone #{milestoneIdx} unlocks in {formatCountdown(cliffTime, nowTs)}
    </div>
  );
}
