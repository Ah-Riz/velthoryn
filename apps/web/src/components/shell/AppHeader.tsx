"use client";

import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);

export function AppHeader({ onMenuToggle }: { onMenuToggle?: () => void }) {
  const { connected, publicKey } = useWallet();
  const isE2e =
    typeof window !== "undefined" &&
    window.localStorage.getItem("velthoryn:e2e-wallet") === "1";
  const showE2eWallet = isE2e && connected && !!publicKey;

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-[#1c2130] bg-[#0b0d12]/85 px-4 backdrop-blur-xl sm:h-16 sm:px-6">
      <div className="flex items-center gap-3">
        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={onMenuToggle}
          className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#1c2130] bg-[#13161f] text-[#64748b] transition hover:border-[#2e3648] hover:text-[#b4b9c5] lg:hidden"
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
      <div className="flex items-center">
        {showE2eWallet ? (
          <div className="rounded-lg border border-[#1c2130] bg-[#13161f] px-2 py-1.5 font-mono text-[11px] text-[#b4b9c5] sm:px-3 sm:py-2 sm:text-[12px]">
            {publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}
          </div>
        ) : (
          <WalletMultiButton />
        )}
      </div>
    </header>
  );
}
