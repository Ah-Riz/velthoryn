"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
    ? effectiveMode === "refund" ? "Refunding..." : "Cancelling..."
    : effectiveMode === "refund"
      ? "Instant Refund"
      : effectiveMode === "instant" && showSingleToggle
        ? "Cancel & Settle"
        : "Cancel Stream";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md border-foreground/[0.08] bg-background" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className={effectiveMode === "refund" ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400"}>
            {effectiveMode === "refund"
              ? "Instant refund this campaign?"
              : "Cancel this vesting stream?"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Mode toggle: refund vs grace */}
          {showRefundToggle && (
            <div className="flex gap-1 rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] p-1">
              <button
                type="button"
                onClick={() => setMode("refund")}
                className={`flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium transition ${
                  effectiveMode === "refund"
                    ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Instant Refund
              </button>
              <button
                type="button"
                onClick={() => setMode("grace")}
                className={`flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium transition ${
                  effectiveMode === "grace"
                    ? "bg-foreground/[0.08] text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Grace Period
              </button>
            </div>
          )}

          {/* Mode toggle: instant settle vs grace */}
          {showSingleToggle && !showRefundToggle && (
            <div className="flex gap-1 rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] p-1">
              <button
                type="button"
                onClick={() => setMode("instant")}
                disabled={instantDisabled}
                className={`flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium transition ${
                  effectiveMode === "instant" ? "bg-foreground/[0.08] text-foreground" : "text-muted-foreground hover:text-foreground"
                } ${instantDisabled ? "cursor-not-allowed opacity-40" : ""}`}
              >
                Instant Settle
              </button>
              <button
                type="button"
                onClick={() => setMode("grace")}
                className={`flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium transition ${
                  effectiveMode === "grace" ? "bg-foreground/[0.08] text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Grace Period
              </button>
            </div>
          )}

          {showSingleToggle && !showRefundToggle && instantDisabled && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              Instant Settle unavailable — schedule parameters not loaded. Load from URL or enter manually first.
            </p>
          )}

          {/* Refund content */}
          {effectiveMode === "refund" && (
            <>
              <p className="text-[13px] text-muted-foreground">
                This campaign has not started yet. All funds will be returned to you
                instantly in a single transaction. No grace period needed.
              </p>
              <div className="space-y-3 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Campaign total supply</span>
                  <span className="font-medium text-foreground">{fmt(totalSupply)} tokens</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Returned to you</span>
                  <span className="font-medium text-emerald-700 dark:text-emerald-400">{fmt(totalSupply)} tokens</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">To recipients</span>
                  <span className="font-medium text-muted-foreground">0 tokens</span>
                </div>
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-[12px] leading-6 text-emerald-700 dark:text-emerald-300">
                No vesting has started — all funds are returned immediately with no grace period.
              </div>
              <p className="text-[11px] text-muted-foreground">
                This is irreversible. The campaign will be marked as refunded and cannot be reactivated.
              </p>
            </>
          )}

          {/* Grace period content */}
          {effectiveMode === "grace" && (
            <>
              <p className="text-[13px] text-muted-foreground">
                This action is irreversible. Vesting will freeze at the current moment.
                Recipients can still claim tokens vested up to now.
              </p>
              <div className="space-y-3 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Already claimed</span>
                  <span className="font-medium text-foreground">{fmt(totalClaimed)} tokens</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Unclaimed vested (claimable by recipient)</span>
                  <span className="font-medium text-emerald-700 dark:text-emerald-400">~{fmt(unclaimedVested)} tokens</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Unvested (recoverable after 7-day grace)</span>
                  <span className="font-medium text-amber-700 dark:text-amber-400">~{fmt(returnedToCreator)} tokens</span>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Unvested tokens are NOT returned immediately. Use &quot;Withdraw Unvested&quot; after the 7-day grace period.
              </p>
            </>
          )}

          {/* Instant settle content */}
          {effectiveMode === "instant" && showSingleToggle && (
            <>
              <p className="text-[13px] text-muted-foreground">
                Settle immediately in one transaction. Vested tokens go to the beneficiary,
                remaining tokens return to you. No grace period.
              </p>
              <div className="space-y-3 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">To beneficiary (vested)</span>
                  <span className="font-medium text-emerald-700 dark:text-emerald-400">~{fmt(unclaimedVested + totalClaimed)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Returned to you (unvested)</span>
                  <span className="font-medium text-amber-700 dark:text-amber-400">~{fmt(returnedToCreator)}</span>
                </div>
              </div>
              {beneficiaryUnknown && onManualBeneficiaryChange && (
                <div className="space-y-2">
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    Beneficiary not found in indexed data. Enter the wallet address:
                  </p>
                  <Input
                    type="text"
                    value={manualBeneficiary ?? ""}
                    onChange={(e) => onManualBeneficiaryChange(e.target.value)}
                    placeholder="Beneficiary wallet address"
                    className="font-mono text-[12px]"
                  />
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                This is irreversible. Tokens are distributed atomically in a single transaction.
              </p>
            </>
          )}
        </div>

        <DialogFooter className="border-none bg-transparent p-0 pt-2" showCloseButton={false}>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={!!activeLoading}
            className="flex-1"
          >
            Go Back
          </Button>
          <Button
            type="button"
            onClick={handleConfirmClick}
            disabled={confirmDisabled}
            className={`flex-1 ${
              effectiveMode === "refund"
                ? "bg-amber-600 text-white hover:bg-amber-500"
                : "bg-red-600 text-white hover:bg-red-500"
            }`}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
