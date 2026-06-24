"use client";

import { CARD } from "./shared";

const BASE_FEE_SOL = 0.000005;

export type BulkReviewData = {
  recipients: number;
  tokenSymbol: string;
  tokenName?: string;
  totalSupply: string;
  releaseType: string;
  earliestStart: string;
  latestEnd: string;
  duration: string;
};

type FormSummaryProps = {
  amount: string;
  tokenSymbol: string;
  tokenBalance: string | null;
  streamCount?: number;
  mode?: "single" | "bulk";
  submitLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  onSubmit?: () => void;
  bulkReview?: BulkReviewData | null;
};

function ReviewRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-right text-[12px] font-medium ${highlight ? "text-foreground" : "text-foreground/80"}`}>
        {value}
      </p>
    </div>
  );
}

export function FormSummary({
  amount,
  tokenSymbol,
  tokenBalance,
  streamCount = 1,
  mode = "single",
  submitLabel = "Create Stream",
  loading,
  disabled,
  onSubmit,
  bulkReview,
}: FormSummaryProps) {
  const gasFee = mode === "bulk" ? BASE_FEE_SOL * 2 : BASE_FEE_SOL * streamCount;
  const numAmount = Number(amount || 0);
  const totalDeposit = mode === "single" && streamCount > 1
    ? numAmount * streamCount
    : numAmount;
  const totalDepositStr = totalDeposit > 0 ? String(totalDeposit) : "0";
  const showMultiplier = mode === "single" && streamCount > 1 && numAmount > 0;

  const numBalance = tokenBalance !== null ? Number(tokenBalance) : null;
  const insufficientBalance = numBalance !== null && totalDeposit > 0 && totalDeposit > numBalance;

  const isBulk = mode === "bulk";

  return (
    <aside className={`${CARD} sticky top-6 h-fit space-y-5 p-5`}>
      {/* Chain badge */}
      <div className="flex items-center gap-2">
        <svg width="18" height="18" viewBox="0 0 397 312" aria-label="Solana">
          <defs>
            <linearGradient id="sol-g" x1="0" y1="312" x2="397" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#9945FF" />
              <stop offset="50%" stopColor="#00C3FF" />
              <stop offset="100%" stopColor="#19FB9B" />
            </linearGradient>
          </defs>
          <path fill="url(#sol-g)" d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 237.9z" />
          <path fill="url(#sol-g)" d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1L333.1 73.8c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" />
          <path fill="url(#sol-g)" d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1L64.6 189c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1L333.1 120.1z" />
        </svg>
        <span className="text-[13px] font-medium text-foreground">Solana</span>
        <span className="ml-auto rounded-full border border-foreground/[0.08] px-2 py-0.5 text-[10px] text-muted-foreground">Solana</span>
      </div>

      {/* Bulk campaign review — shown when in bulk mode with parsed data */}
      {isBulk && bulkReview && (
        <div className="space-y-3 border-t border-foreground/[0.06] pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Campaign Preview
          </p>
          <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-3 space-y-2.5">
            <ReviewRow label="Recipients" value={String(bulkReview.recipients)} highlight />
            <ReviewRow label="Token" value={bulkReview.tokenName ? `${bulkReview.tokenSymbol} — ${bulkReview.tokenName}` : bulkReview.tokenSymbol} highlight />
            <ReviewRow label="Total Supply" value={bulkReview.totalSupply} highlight />
            <ReviewRow label="Release Type" value={bulkReview.releaseType} />
            <div className="my-0.5 h-px bg-foreground/[0.06]" />
            <ReviewRow label="Earliest Start" value={bulkReview.earliestStart} />
            <ReviewRow label="Latest End" value={bulkReview.latestEnd} />
            <ReviewRow label="Duration" value={bulkReview.duration} highlight />
          </div>
        </div>
      )}

      {/* No token selected state in bulk mode */}
      {isBulk && !bulkReview && !tokenSymbol && (
        <div className="space-y-2 border-t border-foreground/[0.06] pt-4">
          <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-amber-400">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <p className="text-[11px] font-medium text-amber-400">
              Select a token to preview campaign
            </p>
          </div>
        </div>
      )}

      <div className="space-y-3 border-t border-foreground/[0.06] pt-4">
        {/* Total Deposit */}
        <div className="flex items-center justify-between">
          <p className="text-[12px] text-muted-foreground">Total Deposit</p>
          <div className="text-right">
            <p className="text-[13px] font-medium text-foreground">
              {isBulk && bulkReview ? bulkReview.totalSupply : `${totalDepositStr} ${tokenSymbol || "—"}`}
            </p>
            {showMultiplier && (
              <p className="text-[11px] text-muted-foreground">
                ({amount} × {streamCount} recipients)
              </p>
            )}
          </div>
        </div>

        {/* Your Balance */}
        <div className="flex items-center justify-between">
          <p className="text-[12px] text-muted-foreground">Your Balance</p>
          <p className="text-[13px] text-foreground">
            {tokenBalance !== null ? `${tokenBalance} ${tokenSymbol}` : "—"}
          </p>
        </div>

        {/* Gas Estimate */}
        <div className="flex items-center justify-between">
          <p className="text-[12px] text-muted-foreground">Network Fee (est.)</p>
          <p className="font-mono text-[12px] text-muted-foreground">
            ~{gasFee.toFixed(6)} SOL
            {streamCount > 1 && mode === "single" ? ` (${streamCount} tx)` : ""}
          </p>
        </div>
      </div>

      {insufficientBalance && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-700 dark:text-red-400">
          Insufficient balance. Need {totalDepositStr} {tokenSymbol}, have {tokenBalance}.
        </div>
      )}

      {onSubmit && (
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || loading || insufficientBalance}
          className="w-full rounded-xl bg-violet-700 dark:bg-violet-600 px-4 py-3 text-[14px] font-semibold text-foreground transition hover:bg-violet-600 dark:hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
              </svg>
              Processing...
            </span>
          ) : (
            submitLabel
          )}
        </button>
      )}
    </aside>
  );
}
