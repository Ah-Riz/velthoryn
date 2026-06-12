"use client";

import { CARD, Input, Field, SectionHeader, formatDuration } from "./shared";

const DT_INPUT_CLS = "h-auto rounded-xl bg-[#11161f] px-4 py-3 text-[13px] text-white border-white/[0.08] focus-visible:border-white/20 focus-visible:ring-0";

export function ScheduleLinear({
  startTime,
  onStartTimeChange,
  cliffTime,
  onCliffTimeChange,
  endTime,
  onEndTimeChange,
  scheduleError,
}: {
  startTime: string;
  onStartTimeChange: (value: string) => void;
  cliffTime: string;
  onCliffTimeChange: (value: string) => void;
  endTime: string;
  onEndTimeChange: (value: string) => void;
  scheduleError?: string | null;
}) {
  return (
    <div className={`${CARD} space-y-4 p-5`}>
      <SectionHeader title="Schedule" caption="Tokens unlock gradually from cliff to end. Proportional, smooth release." />
      <div className="grid gap-4 md:grid-cols-3">
        <Field
          label="Start Time"
          inputId="linear-start-time"
          input={
            <Input
              id="linear-start-time"
              type="datetime-local"
              value={startTime}
              onChange={(e) => onStartTimeChange(e.target.value)}
              className={DT_INPUT_CLS}
            />
          }
        />
        <Field
          label="Cliff Time"
          inputId="linear-cliff-time"
          input={
            <Input
              id="linear-cliff-time"
              type="datetime-local"
              value={cliffTime}
              onChange={(e) => onCliffTimeChange(e.target.value)}
              className={DT_INPUT_CLS}
            />
          }
        />
        <Field
          label="End Time"
          inputId="linear-end-time"
          input={
            <Input
              id="linear-end-time"
              type="datetime-local"
              value={endTime}
              onChange={(e) => onEndTimeChange(e.target.value)}
              className={DT_INPUT_CLS}
            />
          }
        />
      </div>
      {startTime && endTime ? (
        <p className="text-[12px] text-[#6f7c95]">
          Total vesting duration: {formatDuration(startTime, endTime) || "—"}
          {cliffTime && startTime ? ` · Cliff after ${formatDuration(startTime, cliffTime) || "—"}` : ""}
        </p>
      ) : null}
      {scheduleError ? <p className="text-[12px] text-red-400">{scheduleError}</p> : null}
    </div>
  );
}
