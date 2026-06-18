"use client";

import { useState } from "react";
import { POPULAR_TOKENS } from "@/lib/constants/popular-tokens";
import { TokenPickerModal } from "./TokenPickerModal";

function shortenAddress(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : addr;
}

export function TokenPickerButton({
  mintAddress,
  onSelect,
  autoWrap: _autoWrap,
  error,
}: {
  mintAddress: string;
  onSelect: (mint: string, decimals: number, autoWrap?: boolean) => void;
  autoWrap?: boolean;
  error?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const selected = POPULAR_TOKENS.find((t) => t.mint === mintAddress);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
          error ? "border-red-500/40" : "border-foreground/[0.08] hover:border-foreground/20"
        } bg-muted`}
      >
        {selected ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {selected.logoURI && <img src={selected.logoURI} alt={selected.symbol} className="h-6 w-6 rounded-full" />}
            <span className="flex-1 text-[13px] font-medium text-foreground">
              {selected.symbol}
              {selected.isNativeSol ? " (Native)" : ""}
              {selected.isWrappedSol ? " (Wrapped)" : ""}
            </span>
          </>
        ) : mintAddress ? (
          <>
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground/[0.06] text-[9px] font-bold text-muted-foreground">
              {mintAddress.slice(0, 2)}
            </div>
            <span className="flex-1 font-mono text-[12px] text-foreground">{shortenAddress(mintAddress)}</span>
          </>
        ) : (
          <span className="flex-1 text-[13px] text-muted-foreground">Select Token</span>
        )}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {error && <p className="mt-1 text-[12px] text-red-700 dark:text-red-400">{error}</p>}
      <TokenPickerModal open={open} onClose={() => setOpen(false)} onSelect={onSelect} selectedMint={mintAddress} />
    </>
  );
}
