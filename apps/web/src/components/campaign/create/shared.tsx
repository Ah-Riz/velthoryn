"use client";

import Link from "next/link";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
export { Input };

// Shared Tailwind class constants
export const CARD = "rounded-2xl border border-foreground/[0.08] bg-card";
export const SECTION = "rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-5";
export const LABEL = "mb-2 block text-[12px] font-medium text-muted-foreground";
export const INPUT =
  "w-full rounded-xl border border-foreground/[0.08] bg-muted px-4 py-3 text-[13px] text-foreground outline-none transition focus:border-foreground/20";
export const INPUT_ERR = "border-red-500/40";

export type AccentTone = "amber" | "purple" | "blue";

const TONE_STYLES: Record<
  AccentTone,
  {
    soft: string;
    border: string;
    text: string;
    button: string;
    buttonHover: string;
    spinner: string;
  }
> = {
  amber: {
    soft: "bg-amber-500/10",
    border: "border-amber-500/30",
    text: "text-amber-700 dark:text-amber-400",
    button: "bg-amber-600",
    buttonHover: "hover:bg-amber-500",
    spinner: "text-amber-700 dark:text-amber-400",
  },
  purple: {
    soft: "bg-violet-500/10",
    border: "border-violet-500/30",
    text: "text-violet-700 dark:text-violet-400",
    button: "bg-violet-700 dark:bg-violet-600",
    buttonHover: "hover:bg-violet-600 dark:hover:bg-violet-500",
    spinner: "text-violet-700 dark:text-violet-400",
  },
  blue: {
    soft: "bg-blue-500/10",
    border: "border-blue-500/30",
    text: "text-blue-400",
    button: "bg-blue-600",
    buttonHover: "hover:bg-blue-500",
    spinner: "text-blue-400",
  },
};

export function getToneStyles(tone: AccentTone) {
  return TONE_STYLES[tone];
}

// Helper functions
export function formatDuration(start: string, end: string): string | null {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return formatDurationSeconds(Math.floor((endMs - startMs) / 1000));
}

export function formatTokenAmount(raw: string, decimals: number | null): string {
  const amount = BigInt(raw);
  if (decimals === null) return amount.toString();
  if (decimals === 0) return amount.toLocaleString();
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const frac = amount % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
}

export function formatIssueLabel(rowNumber: number | "header"): string {
  return rowNumber === "header" ? "Header" : `Row ${rowNumber}`;
}

export function formatUnixToDate(unix: number): string {
  if (!unix) return "—";
  const d = new Date(unix * 1000);
  const date = d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${date} ${hh}:${mm}`;
}

export function formatDurationSeconds(secs: number): string {
  if (secs <= 0) return "—";
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return minutes > 0 ? `${minutes}m` : "< 1m";
}

// Sub-components
export function SectionHeader({ title, caption }: { title: string; caption: string }) {
  return (
    <div>
      <h2 className="text-[16px] font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">{caption}</p>
    </div>
  );
}

export function Field({
  label,
  input,
  error,
  hint,
  hintClassName,
  inputId,
}: {
  label: string;
  input: React.ReactNode;
  error?: string | null;
  hint?: string;
  hintClassName?: string;
  inputId?: string;
}) {
  return (
    <div>
      <Label htmlFor={inputId} className={`${LABEL} mb-2 block`}>{label}</Label>
      {input}
      {error ? (
        <p className="mt-2 text-[12px] text-red-700 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p className={`mt-2 text-[12px] text-muted-foreground ${hintClassName ?? ""}`}>{hint}</p>
      ) : null}
    </div>
  );
}

export function ToggleCard({
  checked,
  onChange,
  title,
  body,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  title: string;
  body: string;
  disabled?: boolean;
}) {
  return (
    <div className={SECTION}>
      <label className="flex cursor-pointer items-start gap-3">
        <div className="relative mt-0.5">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
            className="peer sr-only"
          />
          <div className="h-5 w-9 rounded-full border border-foreground/[0.08] bg-muted transition-colors peer-checked:border-foreground/20 peer-checked:bg-primary peer-disabled:opacity-50" />
          <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-muted-foreground transition-all peer-checked:left-[18px] peer-checked:bg-card" />
        </div>
        <div>
          <p className="text-[13px] font-medium text-foreground">{title}</p>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{body}</p>
        </div>
      </label>
    </div>
  );
}

export function NoticeCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] px-4 py-4">
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{body}</p>
    </div>
  );
}

export function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-foreground/[0.06] pb-3 last:border-b-0 last:pb-0">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className={`max-w-[65%] break-all text-right text-[13px] text-foreground ${mono ? "font-mono" : ""}`}>
        {value}
      </p>
    </div>
  );
}

export function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-5">
      <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-[20px] font-semibold text-foreground">{value}</p>
    </div>
  );
}

export function StepCard({
  step,
  title,
  body,
  state,
}: {
  step: string;
  title: string;
  body: string;
  state: "done" | "current" | "pending";
}) {
  const classes =
    state === "done"
      ? "border-emerald-500/20 bg-emerald-500/5"
      : state === "current"
        ? "border-foreground/[0.1] bg-foreground/[0.03]"
        : "border-foreground/[0.06] bg-foreground/[0.02]";

  return (
    <div className={`rounded-2xl border p-4 ${classes}`}>
      <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{step}</p>
      <p className="mt-2 text-[14px] font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{body}</p>
    </div>
  );
}

export function TxResultCard({
  title,
  sig,
  href,
  linkLabel,
}: {
  title: string;
  sig: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className={`${CARD} p-5`}>
      <p className="text-[13px] font-medium text-emerald-700 dark:text-emerald-400">{title}</p>
      <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">Signature: {sig}</p>
      <Link
        href={href}
        className="mt-4 inline-flex items-center gap-2 text-[12px] font-medium text-foreground underline underline-offset-4"
      >
        {linkLabel}
      </Link>
    </div>
  );
}

export function ErrorCard({ title, body }: { title: string; body: string }) {
  return (
    <div className={`${CARD} p-5`}>
      <p className="text-[13px] font-medium text-red-700 dark:text-red-400">{title}</p>
      <p className="mt-2 text-[12px] leading-6 text-red-600 dark:text-red-300">{body}</p>
    </div>
  );
}
