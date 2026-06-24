import { NextRequest } from "next/server";
import { jsonResponse } from "@/lib/api/json-response";
import { withRoute } from "@/lib/api/route-wrapper";

const CG_BASE = "https://api.coingecko.com/api/v3";

// The protocol uses SystemProgram.programId as the native SOL sentinel.
// CoinGecko identifies SOL by coin ID "solana", not by contract address.
const NATIVE_SOL_SENTINEL = "11111111111111111111111111111111";
// Wrapped SOL shares the same price as native SOL.
const WSOL_MINT = "So11111111111111111111111111111111111111112";

// Devnet uses different mint addresses for test tokens that don't exist on mainnet.
// Map devnet mints → mainnet equivalents so CoinGecko can resolve their prices.
// This only affects the CoinGecko lookup; the price is returned under the ORIGINAL devnet key.
const DEVNET_TO_MAINNET_MINT: Record<string, string> = {
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC devnet → mainnet
};

async function getPricesHandler(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mintsParam = searchParams.get("mints") ?? "";
  const mints = mintsParam
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  if (mints.length === 0) {
    return jsonResponse({ prices: {} });
  }

  // Server-side only — never exposed to the browser.
  const apiKey = process.env.COINGECKO_API_KEY ?? "";
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(apiKey ? { "x-cg-demo-api-key": apiKey } : {}),
  };

  // Initialise all mints as null — only overwrite when a price is found.
  const prices: Record<string, number | null> = {};
  for (const mint of mints) prices[mint] = null;

  const hasNativeSol = mints.includes(NATIVE_SOL_SENTINEL) || mints.includes(WSOL_MINT);
  const splMints = mints.filter((m) => m !== NATIVE_SOL_SENTINEL && m !== WSOL_MINT);

  // --- 1. Native SOL price via coin-ID endpoint ---
  if (hasNativeSol) {
    try {
      const res = await fetch(
        `${CG_BASE}/simple/price?ids=solana&vs_currencies=usd`,
        { headers, next: { revalidate: 60 } },
      );
      if (res.ok) {
        const data = (await res.json()) as { solana?: { usd?: number } };
        const solPrice = data.solana?.usd ?? null;
        if (mints.includes(NATIVE_SOL_SENTINEL)) prices[NATIVE_SOL_SENTINEL] = solPrice;
        if (mints.includes(WSOL_MINT)) prices[WSOL_MINT] = solPrice;
      }
    } catch {
      // Leave null — handled gracefully by the caller
    }
  }

  // --- 2. SPL token prices via contract-address endpoint ---
  // Devnet test tokens are mapped to their mainnet equivalents for price lookup.
  // CoinGecko returns prices only for listed (mainnet) tokens; unlisted tokens
  // are simply absent from the response so their price stays null.
  if (splMints.length > 0) {
    try {
      // Build lookup addresses: use mainnet equivalent when available.
      const lookupMap = new Map<string, string>(); // originalMint → lookupMint
      for (const mint of splMints) {
        lookupMap.set(mint, DEVNET_TO_MAINNET_MINT[mint] ?? mint);
      }
      const addresses = [...new Set(lookupMap.values())].join(",");

      const res = await fetch(
        `${CG_BASE}/simple/token_price/solana?contract_addresses=${addresses}&vs_currencies=usd`,
        { headers, next: { revalidate: 60 } },
      );
      if (res.ok) {
        const data = (await res.json()) as Record<string, { usd?: number }>;
        for (const [originalMint, lookupMint] of lookupMap) {
          // CoinGecko lowercases contract addresses in response keys.
          const row = data[lookupMint] ?? data[lookupMint.toLowerCase()];
          prices[originalMint] = row?.usd ?? null;
        }
      }
    } catch {
      // Leave null
    }
  }

  return jsonResponse({ prices });
}

export const GET = withRoute(
  { rateLimit: { requests: 20, window: 60 } },
  getPricesHandler,
);
