"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useMemo } from "react";
import { getProvider, PROGRAM_ID } from "@/lib/anchor/client";

// Returns an Anchor Program instance bound to the connected wallet.
// Replace `{} as Idl` with the generated IDL from `anchor build`.
export function useVestingProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();

  return useMemo(() => {
    if (!wallet.connected || !wallet.publicKey) return null;
    // const provider = getProvider(connection, wallet as never);
    // return new Program(IDL, provider);
    return null;
  }, [connection, wallet.connected, wallet.publicKey]);
}
