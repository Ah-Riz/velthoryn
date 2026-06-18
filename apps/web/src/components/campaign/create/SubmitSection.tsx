"use client";

import type { AccentTone } from "./shared";
import { getToneStyles } from "./shared";

export function SubmitSection({
  tone,
  idleLabel,
  loadingLabel,
  loading,
  disabled,
  type = "submit",
  onClick,
  children,
}: {
  tone: AccentTone;
  idleLabel: string;
  loadingLabel: string;
  loading: boolean;
  disabled: boolean;
  type?: "submit" | "button";
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  const toneStyles = getToneStyles(tone);

  return (
    <div className="space-y-4">
      <button
        type={type}
        onClick={onClick}
        disabled={disabled || loading}
        className={`w-full rounded-xl py-3 text-[14px] font-medium text-foreground transition disabled:cursor-not-allowed disabled:opacity-50 ${toneStyles.button} ${toneStyles.buttonHover}`}
      >
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {loadingLabel}
          </span>
        ) : (
          idleLabel
        )}
      </button>
      {children}
    </div>
  );
}
