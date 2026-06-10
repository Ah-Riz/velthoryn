import {
  NATIVE_SOL_MINT_ADDRESS,
  WRAPPED_SOL_MINT_ADDRESS,
} from "@/lib/sol/auto-wrap";
import { CLUSTER } from "@/lib/sol/cluster";

export type PopularToken = {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  isNativeSol?: boolean;
  isWrappedSol?: boolean;
};

const MAINNET_TOKENS: PopularToken[] = [
  {
    mint: NATIVE_SOL_MINT_ADDRESS,
    symbol: "SOL",
    name: "Solana · Native",
    decimals: 9,
    logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
    isNativeSol: true,
  },
  {
    mint: WRAPPED_SOL_MINT_ADDRESS,
    symbol: "wSOL",
    name: "Wrapped SOL",
    decimals: 9,
    logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
    isWrappedSol: true,
  },
  {
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
  },
  {
    mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png",
  },
];

const DEVNET_TOKENS: PopularToken[] = [
  {
    mint: NATIVE_SOL_MINT_ADDRESS,
    symbol: "SOL",
    name: "Solana · Native",
    decimals: 9,
    logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
    isNativeSol: true,
  },
  {
    mint: WRAPPED_SOL_MINT_ADDRESS,
    symbol: "wSOL",
    name: "Wrapped SOL",
    decimals: 9,
    logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
    isWrappedSol: true,
  },
  {
    mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    symbol: "USDC",
    name: "USDC (Devnet)",
    decimals: 6,
  },
];

export const POPULAR_TOKENS: PopularToken[] = CLUSTER === "devnet" ? DEVNET_TOKENS : MAINNET_TOKENS;
