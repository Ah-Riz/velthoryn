"use client";

import { useState } from "react";

type Props = {
  isOpen: boolean;
  onConfirm: () => void;
  onConfirmStream?: () => void;
  onConfirmInstantRefund?: () => void;
  onClose: () => void;
  isLoading: boolean;
  isStreamLoading?: boolean;
  isInstantRefundLoading?: boolean;
  isSingleStream?: boolean;
  isInstantRefundEligible?: boolean;
  scheduleLoaded?: boolean;
  beneficiaryUnknown?: boolean;
  manualBeneficiary?: string;
  onManualBeneficiaryChange?: (value: string) => void;
  totalSupply: bigint;
  totalClaimed: bigint;
  vestedAmount: bigint;
  mintDecimals?: number | null;
};

export function CancelConfirmDialog({
  isOpen,
  onConfirm,
  onConfirmStream,
  onConfirmInstantRefund,
  onClose,
  isLoading,
  isStreamLoading,
  isInstantRefundLoading,
  isSingleStream,
  isInstantRefundEligible,
  scheduleLoaded = true,
  beneficiaryUnknown,
  manualBeneficiary,
  onManualBeneficiaryChange,
  totalSupply,
  totalClaimed,
  vestedAmount,
  mintDecimals,
}: Props) {
  const [mode, setMode] = useState<"instant" | "grace" | "refund">(
    isInstantRefundEligible ? "refund" : "instant",
  );

  if (!isOpen) return null;

  function fmt(raw: bigint): string {
    const dec = mintDecimals ?? (raw > 1_000_000_000n ? 9 : raw > 1_000_000n ? 6 : 0);
    if (dec === 0) return raw.toLocaleString();
    const divisor = 10n ** BigInt(dec);
    const whole = raw / divisor;
    const frac = raw % divisor;
    const fracStr = frac.toString().padStart(dec, "0").slice(0, 4).replace(/0+$/, "");
    return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
  }

  const unclaimedVested = vestedAmount > totalClaimed ? vestedAmount - totalClaimed : 0n;
  const returnedToCreator = totalSupply > vestedAmount ? totalSupply - vestedAmount : 0n;
  const showSingleToggle = isSingleStream && onConfirmStream;
  const showRefundToggle = isInstantRefundEligible && onConfirmInstantRefund;
  const instantDisabled = !scheduleLoaded;
  const effectiveMode = showRefundToggle
    ? mode
    : showSingleToggle
      ? (instantDisabled ? "grace" : mode)
      : "grace";

  const activeLoading =
    effectiveMode === "refund"
      ? isInstantRefundLoading
      : effectiveMode === "instant" && showSingleToggle
        ? isStreamLoading
        : isLoading;
  const beneficiaryValid = !beneficiaryUnknown || (manualBeneficiary && manualBeneficiary.length >= 32);
  const confirmDisabled =
    !!activeLoading ||
    (showSingleToggle && effectiveMode === "instant" && !beneficiaryValid);

  function handleConfirmClick() {
    if (effectiveMode === "refund" && onConfirmInstantRefund) {
      onConfirmInstantRefund();
    } else if (effectiveMode === "instant" && showSingleToggle && onConfirmStream) {
      onConfirmStream();
    } else {
      onConfirm();
    }
  }

  const confirmLabel = activeLoading
    ? effectiveMode === "refund"
      ? "Refunding..."
      : "Cancelling..."
    : effectiveMode === "refund"
      ? "Instant Refund"
      : effectiveMode === "instant" && showSingleToggle
        ? "Cancel & Settle"
        : "Cancel Stream";

  const confirmButtonClass =
    effectiveMode === "refund"
      ? "flex-1 rounded-xl bg-amber-600 py-2.5 text-[13px] font-medium text-white transition hover:bg-amber-500 disabled:opacity-50"
      : "flex-1 rounded-xl bg-red-600 py-2.5 text-[13px] font-medium text-white transition hover:bg-red-500 disabled:opacity-50";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md space-y-5 rounded-2xl border border-white/[0.08] bg-[#0d1017] p-6">
        <h3 className="text-[15px] font-semibold text-red-400">
          {effectiveMode === "refund"
            ? "Instant refund this campaign?"
            : "Cancel this vesting stream?"}
        </h3>

        {/* Toggle tabs — show when multiple modes available */}
        {showRefundToggle && (
          <div className="flex gap-1 rounded-lg border border-white/[0.08] bg-white/[0.02] p-1">
            <button
              type="button"
              onClick={() => setMode("refund")}
              className={`flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium transition ${
                effectiveMode === "refund"
                  ? "bg-amber-500/20 text-amber-300"
                  : "text-[#8b92a5] hover:text-white"
              }`}
            >
              Instant Refund
            </button>
            <button
              type="button"
              onClick={() => setMode("grace")}
              className={`flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium transition ${
                effectiveMode === "grace"
                  ? "bg-white/[0.08] text-white"
                  : "text-[#8b92a5] hover:text-white"
              }`}
            >
              Grace Period
            </button>
          </div>
        )}

        {showSingleToggle && !showRefundToggle && (
          <div className="flex gap-1 rounded-lg border border-white/[0.08] bg-white/[0.02] p-1">
            <button
              type="button"
              onClick={() => setMode("instant")}
              disabled={instantDisabled}
              className={`flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium transition ${
                effectiveMode === "instant"
                  ? "bg-white/[0.08] text-white"
                  : "text-[#8b92a5] hover:text-white"
              } ${instantDisabled ? "cursor-not-allowed opacity-40" : ""}`}
            >
              Instant Settle
            </button>
            <button
              type="button"
              onClick={() => setMode("grace")}
              className={`flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium transition ${
                effectiveMode === "grace"
                  ? "bg-white/[0.08] text-white"
                  : "text-[#8b92a5] hover:text-white"
              }`}
            >
              Grace Period
            </button>
          </div>
        )}

        {showSingleToggle && !showRefundToggle && instantDisabled && (
          <p className="text-[11px] text-amber-400">
            Instant Settle unavailable — schedule parameters not loaded. Load from URL or enter manually first.
          </p>
        )}

        {/* Instant Refund content */}
        {effectiveMode === "refund" && (
          <>
            <p className="text-[13px] text-[#8b92a5]">
              This campaign has not started yet. All funds will be returned to you
              instantly in a single transaction. No grace period needed.
            </p>

            <div className="space-y-3 text-[13px]">
              <div className="flex justify-between">
                <span className="text-[#8b92a5]">Campaign total supply</span>
                <span className="font-medium text-white">{fmt(totalSupply)} tokens</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8b92a5]">Returned to you</span>
                <span className="font-medium text-emerald-400">{fmt(totalSupply)} tokens</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8b92a5]">To recipients</span>
                <span className="font-medium text-[#555d73]">0 tokens</span>
              </div>
            </div>

            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-[12px] leading-6 text-emerald-300">
              No vesting has started — all funds are returned immediately with no grace period.
            </div>

            <p className="text-[11px] text-[#555d73]">
              This is irreversible. The campaign will be marked as refunded and cannot be reactivated.
            </p>
          </>
        )}

        {/* Grace Period content */}
        {effectiveMode === "grace" && (
          <>
            <p className="text-[13px] text-[#8b92a5]">
              This action is irreversible. Vesting will freeze at the current moment.
              Recipients can still claim tokens vested up to now.
            </p>

            <div className="space-y-3 text-[13px]">
              <div className="flex justify-between">
                <span className="text-[#8b92a5]">Already claimed</span>
                <span className="font-medium text-white">{fmt(totalClaimed)} tokens</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8b92a5]">Unclaimed vested (claimable by recipient)</span>
                <span className="font-medium text-emerald-400">~{fmt(unclaimedVested)} tokens</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8b92a5]">Unvested (recoverable after 7-day grace)</span>
                <span className="font-medium text-amber-400">~{fmt(returnedToCreator)} tokens</span>
              </div>
            </div>

            <p className="text-[11px] text-[#555d73]">
              Unvested tokens are NOT returned immediately. Use &quot;Withdraw Unvested&quot; after the 7-day grace period.
            </p>
          </>
        )}

        {/* Instant Settle content (single-stream only) */}
        {effectiveMode === "instant" && showSingleToggle && (
          <>
            <p className="text-[13px] text-[#8b92a5]">
              Settle immediately in one transaction. Vested tokens go to the beneficiary,
              remaining tokens return to you. No grace period.
            </p>

            <div className="space-y-3 text-[13px]">
              <div className="flex justify-between">
                <span className="text-[#8b92a5]">To beneficiary (vested)</span>
                <span className="font-medium text-emerald-400">~{fmt(unclaimedVested + totalClaimed)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8b92a5]">Returned to you (unvested)</span>
                <span className="font-medium text-amber-400">~{fmt(returnedToCreator)}</span>
              </div>
            </div>

            {beneficiaryUnknown && onManualBeneficiaryChange && (
              <div className="space-y-2">
                <p className="text-[11px] text-amber-400">
                  Beneficiary not found in indexed data. Enter the wallet address:
                </p>
                <input
                  type="text"
                  value={manualBeneficiary ?? ""}
                  onChange={(e) => onManualBeneficiaryChange(e.target.value)}
                  placeholder="Beneficiary wallet address"
                  className="w-full rounded-lg border border-white/[0.08] bg-[#11161f] px-3 py-2 font-mono text-[12px] text-white outline-none placeholder:text-[#555d73] focus:border-white/20"
                />
              </div>
            )}

            <p className="text-[11px] text-[#555d73]">
              This is irreversible. Tokens are distributed atomically in a single transaction.
            </p>
          </>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={!!activeLoading}
            className="flex-1 rounded-xl border border-white/[0.08] py-2.5 text-[13px] text-[#8b92a5] transition hover:bg-white/[0.04] disabled:opacity-50"
          >
            Go Back
          </button>
          <button
            type="button"
            onClick={handleConfirmClick}
            disabled={confirmDisabled}
            className={confirmButtonClass}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
