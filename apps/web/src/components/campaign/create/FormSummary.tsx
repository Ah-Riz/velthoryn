"use client";

import { CARD } from "./shared";

const BASE_FEE_SOL = 0.000005;

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
};

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

  return (
    <aside className={`${CARD} sticky top-6 h-fit space-y-5 p-5`}>
      {/* Chain */}
      <div className="flex items-center gap-2">
        <svg width="18" height="18" viewBox="0 0 128 128" className="text-[#14F1D9]">
          <circle cx="64" cy="64" r="64" fill="currentColor" opacity="0.15" />
          <path d="M28 95h72l-12-12H40l-12 12zm0-31h72L88 52H40L28 64zm72-31H28l12 12h48l12-12z" fill="currentColor" />
        </svg>
        <span className="text-[13px] font-medium text-white">Solana</span>
        <span className="ml-auto rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] text-[#8b92a5]">Devnet</span>
      </div>

      <div className="space-y-3 border-t border-white/[0.06] pt-4">
        {/* Total Deposit */}
        <div className="flex items-center justify-between">
          <p className="text-[12px] text-[#8b92a5]">Total Deposit</p>
          <div className="text-right">
            <p className="text-[13px] font-medium text-white">
              {totalDepositStr} {tokenSymbol || "—"}
            </p>
            {showMultiplier && (
              <p className="text-[11px] text-[#6f7c95]">
                ({amount} × {streamCount} recipients)
              </p>
            )}
          </div>
        </div>

        {/* Your Balance */}
        <div className="flex items-center justify-between">
          <p className="text-[12px] text-[#8b92a5]">Your Balance</p>
          <p className="text-[13px] text-white">
            {tokenBalance !== null ? `${tokenBalance} ${tokenSymbol}` : "—"}
          </p>
        </div>

        {/* Gas Estimate */}
        <div className="flex items-center justify-between">
          <p className="text-[12px] text-[#8b92a5]">Network Fee (est.)</p>
          <p className="font-mono text-[12px] text-[#8b92a5]">
            ~{gasFee.toFixed(6)} SOL
            {streamCount > 1 && mode === "single" ? ` (${streamCount} tx)` : ""}
          </p>
        </div>
      </div>

      {/* Insufficient balance warning */}
      {insufficientBalance && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
          Insufficient balance. Need {totalDepositStr} {tokenSymbol}, have {tokenBalance}.
        </div>
      )}

      {/* Submit Button */}
      {onSubmit && (
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || loading || insufficientBalance}
          className="w-full rounded-xl bg-purple-600 px-4 py-3 text-[14px] font-semibold text-white transition hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
