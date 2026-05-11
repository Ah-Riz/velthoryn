"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useMemo } from "react";
import { getProvider, getProgram } from "@/lib/anchor/client";

export function useVestingProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();

  return useMemo(() => {
    if (!wallet.connected || !wallet.publicKey) return null;
    const provider = getProvider(connection, wallet);
    return getProgram(provider);
  }, [connection, wallet.connected, wallet.publicKey]);
}
