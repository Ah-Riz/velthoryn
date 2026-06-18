"use client";

import { useEffect, useRef, useState } from "react";

interface CacheEntry {
  price: number | null;
  expiresAt: number;
}

// Module-level cache — survives re-renders and page navigation within the session.
const priceCache = new Map<string, CacheEntry>();
const PRICE_TTL_MS = 60_000;

function getCached(mints: string[]): Map<string, number | null> | null {
  const now = Date.now();
  const result = new Map<string, number | null>();
  for (const mint of mints) {
    const entry = priceCache.get(mint);
    if (!entry || entry.expiresAt < now) return null; // any stale → refetch all
    result.set(mint, entry.price);
  }
  return result;
}

/**
 * Fetches USD prices for a list of Solana mint addresses via our internal
 * /api/prices proxy (which calls CoinGecko server-side with the API key).
 *
 * Returns null for tokens CoinGecko does not recognise (custom / unlisted tokens).
 * The dashboard handles those gracefully by showing token amounts instead of USD.
 */
export function useMintPrices(mints: string[]): {
  pricesMap: Map<string, number | null>;
  isLoading: boolean;
} {
  const unique = [...new Set(mints.filter(Boolean))];
  const key = [...unique].sort().join(",");

  const [pricesMap, setPricesMap] = useState<Map<string, number | null>>(
    () => (unique.length > 0 ? (getCached(unique) ?? new Map()) : new Map()),
  );
  const [isLoading, setIsLoading] = useState(
    () => unique.length > 0 && getCached(unique) === null,
  );
  const lastFetchedKeyRef = useRef("");

  useEffect(() => {
    if (unique.length === 0) {
      setPricesMap(new Map());
      setIsLoading(false);
      return;
    }

    const cached = getCached(unique);
    if (cached) {
      setPricesMap(cached);
      setIsLoading(false);
      return;
    }

    if (lastFetchedKeyRef.current === key) return;
    lastFetchedKeyRef.current = key;

    let cancelled = false;
    setIsLoading(true);

    (async () => {
      const now = Date.now();
      const result = new Map<string, number | null>();
      try {
        const res = await fetch(`/api/prices?mints=${unique.join(",")}`);
        const body: { prices?: Record<string, number | null> } = res.ok
          ? await res.json()
          : {};
        for (const mint of unique) {
          const price = body.prices?.[mint] ?? null;
          result.set(mint, price);
          priceCache.set(mint, { price, expiresAt: now + PRICE_TTL_MS });
        }
      } catch {
        for (const mint of unique) {
          result.set(mint, null);
          priceCache.set(mint, { price: null, expiresAt: now + PRICE_TTL_MS });
        }
      }
      if (!cancelled) {
        setPricesMap(result);
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { pricesMap, isLoading };
}
