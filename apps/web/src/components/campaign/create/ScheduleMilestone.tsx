"use client";

import { CARD, INPUT_ERR, Input, Field, SectionHeader, formatDuration } from "./shared";

const DT_INPUT_CLS = "h-auto rounded-xl bg-muted px-4 py-3 text-[13px] text-foreground border-foreground/[0.08] focus-visible:border-foreground/20 focus-visible:ring-0";

export function ScheduleMilestone({
  startTime,
  onStartTimeChange,
  unlockTime,
  onUnlockTimeChange,
  milestoneIdx,
  onMilestoneIdxChange,
  scheduleError,
  milestoneError,
}: {
  startTime: string;
  onStartTimeChange: (value: string) => void;
  unlockTime: string;
  onUnlockTimeChange: (value: string) => void;
  milestoneIdx: string;
  onMilestoneIdxChange: (value: string) => void;
  scheduleError?: string | null;
  milestoneError?: string | null;
}) {
  return (
    <div className={`${CARD} space-y-4 p-5`}>
      <SectionHeader title="Schedule" caption="Full release after a time-gated milestone. Tracked by on-chain bitmap." />
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="Start Time"
          inputId="milestone-start-time"
          input={
            <Input
              id="milestone-start-time"
              type="datetime-local"
              value={startTime}
              onChange={(e) => onStartTimeChange(e.target.value)}
              className={DT_INPUT_CLS}
            />
          }
        />
        <Field
          label="Unlock Time"
          inputId="milestone-unlock-time"
          input={
            <Input
              id="milestone-unlock-time"
              type="datetime-local"
              value={unlockTime}
              onChange={(e) => onUnlockTimeChange(e.target.value)}
              className={DT_INPUT_CLS}
            />
          }
        />
      </div>
      {startTime && unlockTime ? (
        <p className="text-[12px] text-muted-foreground">
          Duration until unlock: {formatDuration(startTime, unlockTime) || "—"}
        </p>
      ) : null}
      {scheduleError ? <p className="text-[12px] text-red-700 dark:text-red-400">{scheduleError}</p> : null}
      <Field
        label="Milestone Index"
        inputId="milestone-idx"
        input={
          <Input
            id="milestone-idx"
            type="number"
            min="0"
            max="255"
            value={milestoneIdx}
            onChange={(e) => onMilestoneIdxChange(e.target.value)}
            aria-invalid={!!milestoneError}
            className={`h-auto max-w-[160px] rounded-xl bg-muted px-4 py-3 text-[13px] text-foreground border-foreground/[0.08] focus-visible:border-foreground/20 focus-visible:ring-0 ${milestoneError ? INPUT_ERR : ""}`}
          />
        }
        error={milestoneError}
        hint="Index 0–255 in on-chain bitmap. Default 0 for single milestones."
      />
    </div>
  );
}
