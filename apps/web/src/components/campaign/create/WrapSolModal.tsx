"use client";

import { useState, useEffect } from "react";
import { useWrapSol } from "@/hooks/useWrapSol";
import { useToast } from "@/components/shell/Toast";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (mint: string, decimals: number) => void;
};

const WSOL_MINT = "So11111111111111111111111111111111111111112";

export function WrapSolModal({ isOpen, onClose, onSuccess }: Props) {
  const { solBalance, wsolBalance, wrapSol, unwrapSol, isLoading, error, setError, fetchBalances } = useWrapSol();
  const { toast } = useToast();
  const [mode, setMode] = useState<"wrap" | "unwrap">("wrap");
  const [amount, setAmount] = useState("");
  const [success, setSuccess] = useState<{ amount: string; sig?: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchBalances();
      setAmount("");
      setError(null);
      setSuccess(null);
    }
  }, [isOpen, fetchBalances, setError]);

  // Auto-close after success
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => {
      onSuccess(WSOL_MINT, 9);
      onClose();
      toast("wSOL is ready! Your stream will use wSOL.", "success");
    }, 2000);
    return () => clearTimeout(timer);
  }, [success, onSuccess, onClose, toast]);

  if (!isOpen) return null;

  const numAmount = Number(amount) || 0;
  const canSubmit = mode === "wrap" ? numAmount > 0 && numAmount <= solBalance - 0.003 : wsolBalance > 0;

  async function handleSubmit() {
    if (mode === "wrap") {
      const ok = await wrapSol(numAmount);
      if (ok) setSuccess({ amount: String(numAmount) });
    } else {
      const ok = await unwrapSol();
      if (ok) {
        setSuccess({ amount: String(wsolBalance) });
      }
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-xl border border-white/[0.08] bg-[#1a1d26] p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 128 128" className="text-[#14F1D9]">
              <circle cx="64" cy="64" r="64" fill="currentColor" opacity="0.2" />
              <path d="M28 95h72l-12-12H40l-12 12zm0-31h72L88 52H40L28 64zm72-31H28l12 12h48l12-12z" fill="currentColor" />
            </svg>
            <h3 className="text-[16px] font-semibold text-white">Wrap SOL</h3>
          </div>
          <button onClick={onClose} className="text-[#6b7280] hover:text-white">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Description */}
        <p className="mt-3 text-[13px] leading-5 text-[#6b7280]">
          This vesting program only works with SPL tokens, so you have to first wrap SOL to{" "}
          <a href="https://solscan.io/token/So11111111111111111111111111111111111111112?cluster=devnet" target="_blank" rel="noopener noreferrer" className="text-[#f97316] underline">wSOL</a>{" "}
          first.
        </p>

        <div className="my-4 border-t border-white/[0.08]" />

        {/* Success State */}
        {success ? (
          <div className="animate-in fade-in zoom-in-95 duration-300 rounded-lg border border-[rgba(34,197,94,0.25)] bg-[rgba(34,197,94,0.1)] p-5 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(34,197,94,0.2)]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="animate-in zoom-in duration-500">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="mt-3 text-[14px] font-medium text-white">
              Successfully {mode === "wrap" ? "wrapped" : "unwrapped"} {success.amount} SOL!
            </p>
            <p className="mt-1 text-[12px] text-[#6b7280]">Redirecting to token picker...</p>
          </div>
        ) : (
          <>
            {/* Mode Toggle */}
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-[#6b7280]">Convert SOL to wSOL</span>
              <div className="flex gap-1 rounded-lg bg-[#12141c] p-1">
                <button
                  onClick={() => { setMode("wrap"); setError(null); }}
                  className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition ${mode === "wrap" ? "bg-[#2a2d3a] text-white" : "text-[#6b7280]"}`}
                >
                  Wrap ✓
                </button>
                <button
                  onClick={() => { setMode("unwrap"); setError(null); }}
                  className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition ${mode === "unwrap" ? "bg-[#2a2d3a] text-white" : "text-[#6b7280]"}`}
                >
                  Unwrap
                </button>
              </div>
            </div>

            {/* Amount Input (Wrap mode) */}
            {mode === "wrap" && (
              <div className="mt-4">
                <label className="text-[12px] font-medium text-[#6b7280]">Amount</label>
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#12141c] px-3 py-3">
                  <input
                    type="number"
                    placeholder="0.0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={isLoading}
                    className="flex-1 bg-transparent text-[16px] text-white outline-none placeholder:text-[#6b7280] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <div className="flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 128 128" className="text-[#14F1D9]">
                      <circle cx="64" cy="64" r="64" fill="currentColor" opacity="0.2" />
                      <path d="M28 95h72l-12-12H40l-12 12zm0-31h72L88 52H40L28 64zm72-31H28l12 12h48l12-12z" fill="currentColor" />
                    </svg>
                    <span className="text-[13px] text-white">SOL</span>
                    <button
                      type="button"
                      onClick={() => setAmount(String(Math.max(0, solBalance - 0.003).toFixed(4)))}
                      className="text-[11px] text-[#f97316] hover:underline"
                    >
                      Max: {solBalance.toFixed(4)}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Balance Info */}
            <div className="mt-4 space-y-2 rounded-lg border border-white/[0.08] bg-[#12141c] p-3">
              <div className="flex justify-between text-[12px]">
                <span className="text-[#6b7280]">SOL Balance</span>
                <span className="text-white">{solBalance.toFixed(4)} SOL</span>
              </div>
              <div className="flex justify-between text-[12px]">
                <span className="text-[#6b7280]">wSOL Balance</span>
                <span className="text-white">{wsolBalance.toFixed(4)} wSOL</span>
              </div>
            </div>

            {/* Warning: no SOL */}
            {solBalance < 0.01 && mode === "wrap" && !error && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-[rgba(251,146,60,0.3)] bg-[rgba(251,146,60,0.15)] px-3 py-2">
                <span className="text-[14px]">ⓘ</span>
                <span className="text-[12px] text-[#fb923c]">You don&apos;t have enough SOL. Airdrop some first.</span>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-[rgba(239,68,68,0.25)] bg-[rgba(239,68,68,0.1)] px-3 py-2">
                <span className="text-[14px]">⚠</span>
                <span className="text-[12px] text-red-400">{error}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || isLoading}
              className={`mt-5 w-full rounded-lg py-3 text-[14px] font-semibold transition ${
                canSubmit && !isLoading
                  ? "bg-[#f97316] text-white hover:bg-[#ea580c]"
                  : "bg-[#2a2d3a] text-[#6b7280] cursor-not-allowed"
              }`}
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75"/></svg>
                  Processing...
                </span>
              ) : mode === "wrap" ? "Wrap" : "Unwrap"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
