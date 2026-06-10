import { describe, it, expect, afterEach, vi } from "vitest";

const envBackup = { ...process.env };

async function loadClusterModule() {
  vi.resetModules();
  return import("@/lib/sol/cluster");
}

afterEach(() => {
  process.env = { ...envBackup };
  vi.resetModules();
});

describe("cluster", () => {
  it("defaults to devnet when env is unset", async () => {
    delete process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
    delete process.env.NEXT_PUBLIC_RPC_ENDPOINT;

    const { CLUSTER, defaultRpcUrl, clusterLabel, clusterNetworkLabel } = await loadClusterModule();

    expect(CLUSTER).toBe("devnet");
    expect(defaultRpcUrl()).toBe("https://api.devnet.solana.com");
    expect(clusterLabel()).toBe("Devnet");
    expect(clusterNetworkLabel()).toBe("Solana Devnet");
  });

  it("respects NEXT_PUBLIC_SOLANA_CLUSTER override", async () => {
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "mainnet-beta";

    const { CLUSTER, defaultRpcUrl, cliUrlFlag } = await loadClusterModule();

    expect(CLUSTER).toBe("mainnet-beta");
    expect(defaultRpcUrl()).toBe("https://api.mainnet-beta.solana.com");
    expect(cliUrlFlag()).toBe("mainnet-beta");
  });

  it("infers mainnet from RPC endpoint when cluster env is absent", async () => {
    delete process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
    process.env.NEXT_PUBLIC_RPC_ENDPOINT = "https://api.mainnet-beta.solana.com";

    const { CLUSTER } = await loadClusterModule();

    expect(CLUSTER).toBe("mainnet-beta");
  });

  it("infers testnet from RPC endpoint when cluster env is absent", async () => {
    delete process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
    process.env.NEXT_PUBLIC_RPC_ENDPOINT = "https://api.testnet.solana.com";

    const { CLUSTER, clusterLabel } = await loadClusterModule();

    expect(CLUSTER).toBe("testnet");
    expect(clusterLabel()).toBe("Testnet");
  });

  it("builds cluster-aware explorer and solscan URLs", async () => {
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "devnet";

    const { explorerTxUrl, solscanTokenUrl } = await loadClusterModule();
    const mint = "So11111111111111111111111111111111111111112";
    const sig = "abc123";

    expect(explorerTxUrl(sig)).toBe(
      "https://explorer.solana.com/tx/abc123?cluster=devnet",
    );
    expect(solscanTokenUrl(mint)).toBe(
      `https://solscan.io/token/${mint}?cluster=devnet`,
    );
  });
});
