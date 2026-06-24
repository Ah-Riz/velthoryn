"use client";

import { type AccentTone, getToneStyles } from "./shared";

type Mode = "single" | "bulk";

export function CreationModeTabs({
  mode,
  onChange,
  tone,
  allowBulk = true,
}: {
  mode: Mode;
  onChange: (mode: Mode) => void;
  tone: AccentTone;
  allowBulk?: boolean;
}) {
  const toneStyles = getToneStyles(tone);
  const options: Mode[] = allowBulk ? ["single", "bulk"] : ["single"];

  return (
    <div className="flex gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`rounded-xl border px-4 py-2 text-[13px] font-medium transition ${
            mode === option
              ? `${toneStyles.soft} ${toneStyles.text} ${toneStyles.border}`
              : "border-foreground/[0.06] bg-foreground/[0.02] text-muted-foreground hover:border-foreground/[0.12]"
          }`}
        >
          {option === "single" ? "Manual" : "Use CSV"}
        </button>
      ))}
    </div>
  );
}
