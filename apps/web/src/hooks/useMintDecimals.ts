"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { NATIVE_SOL_MINT_ADDRESS } from "@/lib/sol/auto-wrap";

const decimalsCache = new Map<string, number>();

function getCachedMap(mints: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const m of mints) {
    const cached = decimalsCache.get(m);
    if (cached !== undefined) map.set(m, cached);
  }
  return map;
}

/**
 * Fetches decimals for multiple mint addresses.
 * Returns a Map<mintAddress, decimals>.
 * Deduplicates internally — safe to pass overlapping addresses.
 * Uses a module-level cache to avoid raw-amount flash on page navigation.
 */
export function useMintDecimals(mintAddresses: string[]): {
  decimalsMap: Map<string, number>;
  isLoading: boolean;
} {
  const { connection } = useConnection();
  const key = mintAddresses.filter(Boolean).join(",");

  const [decimalsMap, setDecimalsMap] = useState<Map<string, number>>(
    () => getCachedMap(mintAddresses),
  );
  const [isLoading, setIsLoading] = useState(() => {
    const unique = [...new Set(mintAddresses.filter(Boolean))];
    if (unique.length === 0) return false;
    return unique.some((m) => !decimalsCache.has(m));
  });

  useEffect(() => {
    const unique = [...new Set(mintAddresses.filter(Boolean))];
    if (unique.length === 0) {
      setDecimalsMap(new Map());
      setIsLoading(false);
      return;
    }

    const uncached = unique.filter((m) => !decimalsCache.has(m));
    if (uncached.length === 0) {
      setDecimalsMap(getCachedMap(unique));
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    Promise.all(
      uncached.map(async (mint) => {
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
      for (const r of results) {
        if (r) decimalsCache.set(r[0], r[1]);
      }
      setDecimalsMap(getCachedMap(unique));
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [connection, key]); // eslint-disable-line react-hooks/exhaustive-deps

  return { decimalsMap, isLoading };
}
