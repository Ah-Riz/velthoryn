"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { normalizeWalletTokens, type WalletTokenOption } from "@/lib/token/normalize";

type WalletTokensCtx = {
  tokens: WalletTokenOption[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
};

const WalletTokensContext = createContext<WalletTokensCtx>({
  tokens: [],
  loading: false,
  error: null,
  refetch: async () => {},
});

function e2eMockTokensEnabled() {
  if (typeof window === "undefined") return false;
  const isLocalhost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  return isLocalhost && window.localStorage.getItem("velthoryn:e2e-wallet") === "1";
}

const e2eTokens: WalletTokenOption[] = [
  {
    mintAddress: NATIVE_MINT.toBase58(),
    balanceRaw: String(10 * LAMPORTS_PER_SOL),
    decimals: 9,
    uiAmount: "10",
    isNativeSol: true,
  },
];

export function WalletTokensProvider({ children }: { children: React.ReactNode }) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [tokens, setTokens] = useState<WalletTokenOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchingRef = useRef(false);

  const refetch = useCallback(async () => {
    if (!publicKey || fetchingRef.current) return;

    if (e2eMockTokensEnabled()) {
      setTokens(e2eTokens);
      setLoading(false);
      setError(null);
      return;
    }

    fetchingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const [response, solBalance] = await Promise.all([
        connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID }),
        connection.getBalance(publicKey),
      ]);
      const splTokens = normalizeWalletTokens(response.value);

      const nativeSolEntry: WalletTokenOption = {
        mintAddress: NATIVE_MINT.toBase58(),
        balanceRaw: String(solBalance),
        decimals: 9,
        uiAmount: (solBalance / LAMPORTS_PER_SOL).toFixed(4),
        isNativeSol: true,
      };

      setTokens([nativeSolEntry, ...splTokens]);
    } catch (err) {
      setTokens([]);
      setError(err instanceof Error ? err.message : "Failed to load wallet tokens.");
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  }, [connection, publicKey]);

  useEffect(() => {
    if (!publicKey) { setTokens([]); return; }
    if (e2eMockTokensEnabled()) {
      setTokens(e2eTokens);
      return;
    }
    void refetch();
  }, [publicKey, refetch]);

  return (
    <WalletTokensContext.Provider value={{ tokens, loading, error, refetch }}>
      {children}
    </WalletTokensContext.Provider>
  );
}

export function useWalletTokens() {
  return useContext(WalletTokensContext);
}
