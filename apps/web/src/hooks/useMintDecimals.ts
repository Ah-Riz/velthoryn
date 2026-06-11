"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { NATIVE_SOL_MINT_ADDRESS } from "@/lib/sol/auto-wrap";

/**
 * Fetches decimals for multiple mint addresses.
 * Returns a Map<mintAddress, decimals>.
 * Deduplicates internally — safe to pass overlapping addresses.
 */
export function useMintDecimals(mintAddresses: string[]): {
  decimalsMap: Map<string, number>;
  isLoading: boolean;
} {
  const { connection } = useConnection();
  const [decimalsMap, setDecimalsMap] = useState<Map<string, number>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const unique = [...new Set(mintAddresses.filter(Boolean))];
    if (unique.length === 0) {
      setDecimalsMap(new Map());
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    Promise.all(
      unique.map(async (mint) => {
        if (mint === NATIVE_SOL_MINT_ADDRESS) {
          return [mint, 9] as [string, number];
        }
        try {
          const pubkey = new PublicKey(mint);
          const info = await connection.getParsedAccountInfo(pubkey);
          const parsed = (info.value?.data as { parsed?: { type?: string; info?: { decimals?: number } } })?.parsed;
          if (parsed?.type === "mint") {
            return [mint, parsed.info!.decimals!] as [string, number];
          }
        } catch {
          // ignore — will not appear in map
        }
        return null;
      })
    ).then((results) => {
      if (cancelled) return;
      const map = new Map<string, number>();
      for (const r of results) {
        if (r) map.set(r[0], r[1]);
      }
      setDecimalsMap(map);
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [connection, mintAddresses.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  return { decimalsMap, isLoading };
}
