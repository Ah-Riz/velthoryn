"use client";

import { useState, useEffect, useRef } from "react";
import { useWrapSol } from "@/hooks/useWrapSol";
import { solscanTokenUrl } from "@/lib/sol/cluster";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

function formatSol(v: number): string {
  if (v === 0) return "0";
  const s = v.toFixed(4);
  return s.replace(/\.?0+$/, "");
}

export function WrapSolModal({ isOpen, onClose, onSuccess }: Props) {
  const { solBalance, wsolBalance, wrapSol, unwrapSol, isLoading, balancesLoading, error, setError, fetchBalances } = useWrapSol();
  const [mode, setMode] = useState<"wrap" | "unwrap">("wrap");
  const [amount, setAmount] = useState("");
  const [success, setSuccess] = useState<{ amount: string; sig?: string } | null>(null);
  const closedRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      fetchBalances();
      setAmount("");
      setError(null);
      setSuccess(null);
      closedRef.current = false;
    }
  }, [isOpen, fetchBalances, setError]);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => {
      if (!closedRef.current) {
        closedRef.current = true;
        onSuccess();
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [success]); // eslint-disable-line react-hooks/exhaustive-deps

  const numAmount = Number(amount) || 0;
  const canSubmit = mode === "wrap"
    ? numAmount > 0 && numAmount <= solBalance - 0.003
    : numAmount > 0 && numAmount <= wsolBalance;

  async function handleSubmit() {
    if (mode === "wrap") {
      const ok = await wrapSol(numAmount);
      if (ok) setSuccess({ amount: String(numAmount) });
    } else {
      const ok = await unwrapSol(numAmount);
      if (ok) setSuccess({ amount: String(numAmount) });
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md border-line bg-muted" showCloseButton={false}>
        <DialogHeader className="flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 128 128" className="text-violet">
              <circle cx="64" cy="64" r="64" fill="currentColor" opacity="0.2" />
              <path d="M28 95h72l-12-12H40l-12 12zm0-31h72L88 52H40L28 64zm72-31H28l12 12h48l12-12z" fill="currentColor" />
            </svg>
            <DialogTitle className="text-[16px] font-semibold text-foreground">Wrap SOL</DialogTitle>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </Button>
        </DialogHeader>

        <p className="text-[13px] leading-5 text-muted-foreground">
          SOL is automatically wrapped when creating a stream. Use this tool if you want to manually manage your{" "}
          <a href={solscanTokenUrl("So11111111111111111111111111111111111111112")} target="_blank" rel="noopener noreferrer" className="text-violet-700 dark:text-violet-400 underline">wSOL</a>{" "}
          balance.
        </p>

        <div className="border-t border-foreground/[0.08]" />

        {success ? (
          <div className="animate-in fade-in zoom-in-95 duration-300 rounded-lg border border-[rgba(34,197,94,0.25)] bg-[rgba(34,197,94,0.1)] p-5 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(34,197,94,0.2)]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="animate-in zoom-in duration-500">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="mt-3 text-[14px] font-medium text-foreground">
              Successfully {mode === "wrap" ? "wrapped" : "unwrapped"} {success.amount} SOL!
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">Redirecting to token picker...</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Mode Toggle */}
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">{mode === "wrap" ? "Convert SOL → wSOL" : "Convert wSOL → SOL"}</span>
              <div className="flex gap-1 rounded-lg bg-background p-1">
                <button
                  onClick={() => { setMode("wrap"); setAmount(""); setError(null); }}
                  className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition ${mode === "wrap" ? "bg-secondary text-violet-700 dark:text-violet-300" : "text-muted-foreground hover:text-foreground/70"}`}
                >
                  Wrap
                </button>
                <button
                  onClick={() => { setMode("unwrap"); setAmount(""); setError(null); }}
                  className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition ${mode === "unwrap" ? "bg-secondary text-violet-700 dark:text-violet-300" : "text-muted-foreground hover:text-foreground/70"}`}
                >
                  Unwrap
                </button>
              </div>
            </div>

            {/* Amount Input */}
            <div className="space-y-2">
              <label className="text-[12px] font-medium text-muted-foreground">Amount</label>
              <div className="flex items-center gap-2 rounded-lg border border-line bg-background px-3 py-3">
                <Input
                  type="number"
                  placeholder="0.0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={isLoading}
                  className="flex-1 border-none bg-transparent p-0 text-[16px] text-foreground shadow-none outline-none placeholder:text-muted-foreground [appearance:textfield] focus-visible:ring-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <div className="flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 128 128" className="text-violet">
                    <circle cx="64" cy="64" r="64" fill="currentColor" opacity="0.2" />
                    <path d="M28 95h72l-12-12H40l-12 12zm0-31h72L88 52H40L28 64zm72-31H28l12 12h48l12-12z" fill="currentColor" />
                  </svg>
                  <span className="text-[13px] text-foreground">{mode === "wrap" ? "SOL" : "wSOL"}</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (mode === "wrap") {
                        setAmount(formatSol(Math.max(0, solBalance - 0.003)));
                      } else {
                        setAmount(formatSol(wsolBalance));
                      }
                    }}
                    className="text-[11px] text-violet-700 dark:text-violet-400 hover:text-violet-700 dark:text-violet-300 hover:underline"
                  >
                    Max: {mode === "wrap" ? formatSol(solBalance) : formatSol(wsolBalance)}
                  </button>
                </div>
              </div>
            </div>

            {/* Balance Info */}
            <div className="space-y-2 rounded-lg border border-line bg-background p-3">
              <div className="flex justify-between text-[12px]">
                <span className="text-muted-foreground">SOL Balance</span>
                {balancesLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                ) : (
                  <span className="text-foreground">{formatSol(solBalance)} SOL</span>
                )}
              </div>
              <div className="flex justify-between text-[12px]">
                <span className="text-muted-foreground">wSOL Balance</span>
                {balancesLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                ) : (
                  <span className="text-foreground">{formatSol(wsolBalance)} wSOL</span>
                )}
              </div>
              {!balancesLoading && solBalance === 0 && wsolBalance === 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-amber-700 dark:text-amber-400">Could not load balances</span>
                  <button
                    type="button"
                    onClick={() => { setError(null); void fetchBalances(); }}
                    className="text-[11px] text-violet-700 dark:text-violet-400 hover:text-violet-700 dark:text-violet-300 hover:underline"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>

            {solBalance < 0.01 && mode === "wrap" && !error && (
              <div className="flex items-center gap-2 rounded-lg border border-[rgba(251,146,60,0.3)] bg-[rgba(251,146,60,0.15)] px-3 py-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fb923c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span className="text-[12px] text-orange-400">You don&apos;t have enough SOL. Airdrop some first.</span>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-[rgba(239,68,68,0.25)] bg-[rgba(239,68,68,0.1)] px-3 py-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <span className="text-[12px] text-red-700 dark:text-red-400">{error}</span>
              </div>
            )}

            <Button
              onClick={handleSubmit}
              disabled={!canSubmit || isLoading}
              className={`w-full py-3 text-[14px] font-semibold ${
                canSubmit && !isLoading
                  ? "bg-violet-700 dark:bg-violet-600 text-white hover:bg-violet-600 dark:hover:bg-violet-500"
                  : "bg-secondary text-muted-foreground"
              }`}
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing...
                </span>
              ) : mode === "wrap" ? "Wrap" : "Unwrap"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
