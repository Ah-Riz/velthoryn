"use client";

import dynamic from "next/dynamic";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);

function NetworkBadge() {
  const { connection } = useConnection();
  const [slot, setSlot] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    connection.getSlot().then((s) => {
      if (!cancelled) setSlot(s);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [connection]);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 text-[11px] sm:px-3 sm:text-[12px] text-[#8b92a5]">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
      </span>
      <span className="hidden sm:inline">Devnet</span>
      {slot !== null && (
        <span className="hidden md:inline text-[#555d73]">#{slot.toLocaleString()}</span>
      )}
    </div>
  );
}

export function AppHeader({ onMenuToggle }: { onMenuToggle?: () => void }) {
  const { connected, publicKey } = useWallet();
  const isE2e =
    typeof window !== "undefined" &&
    window.localStorage.getItem("velthoryn:e2e-wallet") === "1";
  const showE2eWallet = isE2e && connected && !!publicKey;

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-white/[0.06] bg-[#0b0d12]/80 px-4 backdrop-blur-xl sm:h-16 sm:px-6">
      <div className="flex items-center gap-3">
        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={onMenuToggle}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-[#8b92a5] transition hover:bg-white/[0.06] hover:text-white lg:hidden"
          aria-label="Toggle menu"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        {/* Mobile logo */}
        <div className="flex items-center gap-2 lg:hidden">
          <img src="/brand/velthoryn-logo-sm.svg" alt="Velthoryn" className="h-7 w-7" />
          <span className="hidden text-[14px] font-semibold text-white sm:inline">Velthoryn</span>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <NetworkBadge />
        {showE2eWallet ? (
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 font-mono text-[11px] text-white sm:px-3 sm:py-2 sm:text-[12px]">
            {publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}
          </div>
        ) : (
          <WalletMultiButton />
        )}
      </div>
    </header>
  );
}
