export type PopularToken = {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
};

const MAINNET_TOKENS: PopularToken[] = [
  {
    mint: "So11111111111111111111111111111111111111112",
    symbol: "SOL",
    name: "Wrapped SOL",
    decimals: 9,
    logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
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
    mint: "So11111111111111111111111111111111111111112",
    symbol: "SOL",
    name: "Wrapped SOL",
    decimals: 9,
    logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
  },
  {
    mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    symbol: "USDC",
    name: "USDC (Devnet)",
    decimals: 6,
  },
];

const isDevnet =
  typeof window !== "undefined"
    ? window.location.hostname.includes("localhost") ||
      (process.env.NEXT_PUBLIC_RPC_ENDPOINT ?? "").includes("devnet")
    : (process.env.NEXT_PUBLIC_RPC_ENDPOINT ?? "").includes("devnet");

export const POPULAR_TOKENS: PopularToken[] = isDevnet ? DEVNET_TOKENS : MAINNET_TOKENS;
