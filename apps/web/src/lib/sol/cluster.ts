/**
 * Central Solana cluster configuration.
 * Single source of truth for cluster identity across the app.
 *
 * Resolution order:
 * 1. NEXT_PUBLIC_SOLANA_CLUSTER env var (explicit override)
 * 2. Inferred from NEXT_PUBLIC_RPC_ENDPOINT (substring matching)
 * 3. Default: "devnet"
 */

export type SolanaCluster = "devnet" | "testnet" | "mainnet-beta";

function resolveCluster(): SolanaCluster {
  const explicit = process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
  if (explicit === "devnet" || explicit === "testnet" || explicit === "mainnet-beta") {
    return explicit;
  }

  const rpc = (process.env.NEXT_PUBLIC_RPC_ENDPOINT ?? "").toLowerCase();
  if (rpc.includes("mainnet")) return "mainnet-beta";
  if (rpc.includes("testnet")) return "testnet";

  return "devnet";
}

/** Singleton cluster — computed once at module load. */
export const CLUSTER: SolanaCluster = resolveCluster();

/** Value for `?cluster=` param in explorer/solscan URLs. */
export function clusterQueryParam(): string {
  return CLUSTER;
}

/** Human-readable label for UI badges. */
export function clusterLabel(): string {
  if (CLUSTER === "mainnet-beta") return "Mainnet";
  if (CLUSTER === "testnet") return "Testnet";
  return "Devnet";
}

/** Full network label for footer/sidebar. */
export function clusterNetworkLabel(): string {
  return `Solana ${clusterLabel()}`;
}

/** CLI `--url` flag value for error messages. */
export function cliUrlFlag(): string {
  return CLUSTER;
}

/** Default public RPC URL for the current cluster. */
export function defaultRpcUrl(): string {
  if (CLUSTER === "mainnet-beta") return "https://api.mainnet-beta.solana.com";
  if (CLUSTER === "testnet") return "https://api.testnet.solana.com";
  return "https://api.devnet.solana.com";
}

/** Solana Explorer transaction URL. */
export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${clusterQueryParam()}`;
}

/** Solscan token URL. */
export function solscanTokenUrl(mint: string): string {
  return `https://solscan.io/token/${mint}?cluster=${clusterQueryParam()}`;
}
