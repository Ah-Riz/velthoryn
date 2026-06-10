"use client";

import { CARD, Input, Field, SectionHeader, formatDuration } from "./shared";

const DT_INPUT_CLS = "h-auto rounded-xl bg-[#11161f] px-4 py-3 text-[13px] text-white border-white/[0.08] focus-visible:border-white/20 focus-visible:ring-0";

export function ScheduleCliff({
  startTime,
  onStartTimeChange,
  cliffTime,
  onCliffTimeChange,
  scheduleError,
}: {
  startTime: string;
  onStartTimeChange: (value: string) => void;
  cliffTime: string;
  onCliffTimeChange: (value: string) => void;
  scheduleError?: string | null;
}) {
  return (
    <div className={`${CARD} space-y-4 p-5`}>
      <SectionHeader title="Schedule" caption="All tokens unlock at the cliff date. Nothing before, everything after." />
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="Start Time"
          inputId="cliff-start-time"
          input={
            <Input
              id="cliff-start-time"
              type="datetime-local"
              value={startTime}
              onChange={(e) => onStartTimeChange(e.target.value)}
              className={DT_INPUT_CLS}
            />
          }
        />
        <Field
          label="Unlock Time (Cliff)"
          inputId="cliff-time"
          input={
            <Input
              id="cliff-time"
              type="datetime-local"
              value={cliffTime}
              onChange={(e) => onCliffTimeChange(e.target.value)}
              className={DT_INPUT_CLS}
            />
          }
        />
      </div>
      {startTime && cliffTime ? (
        <p className="text-[12px] text-[#6f7c95]">
          Duration until unlock: {formatDuration(startTime, cliffTime) || "—"}
        </p>
      ) : null}
      {scheduleError ? <p className="text-[12px] text-red-400">{scheduleError}</p> : null}
    </div>
  );
}
