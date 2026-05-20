"use client";

import dynamic from "next/dynamic";
import { useConnection } from "@solana/wallet-adapter-react";
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
    <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[12px] text-[#8b92a5]">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
      </span>
      Devnet
      {slot !== null && (
        <span className="text-[#555d73]">#{slot.toLocaleString()}</span>
      )}
    </div>
  );
}

export function AppHeader() {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/[0.06] bg-[#0b0d12]/80 px-6 backdrop-blur-xl">
      <div />
      <div className="flex items-center gap-3">
        <NetworkBadge />
        <WalletMultiButton />
      </div>
    </header>
  );
}
