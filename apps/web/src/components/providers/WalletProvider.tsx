"use client";

import {
  ConnectionProvider,
  WalletContext,
  WalletProvider as SolanaWalletProvider,
  type WalletContextState,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

// Phantom, Solflare, Backpack all implement wallet standard — auto-detected.
// No need for @solana/wallet-adapter-wallets (omnibus with many outdated deps).
const RAW_RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_RPC_ENDPOINT ?? "https://api.devnet.solana.com";

function resolveRpcEndpoint() {
  if (
    process.env.NODE_ENV !== "production" &&
    RAW_RPC_ENDPOINT.includes("devnet.helius-rpc.com") &&
    process.env.NEXT_PUBLIC_USE_HELIUS_DEVNET !== "true"
  ) {
    return "https://api.devnet.solana.com";
  }

  return RAW_RPC_ENDPOINT;
}

const RPC_ENDPOINT = resolveRpcEndpoint();
const E2E_MOCK_WALLET_KEY = "velthoryn:e2e-wallet";
const E2E_MOCK_PUBLIC_KEY = "28FQ5wVeihjGnZw93RctyAtUdtBdd6vGXWUkke49mEAw";
const E2E_SIGNING_KEY = "velthoryn:e2e-signing-key";
const E2E_PUBLIC_KEY_OVERRIDE = "velthoryn:e2e-public-key";

function e2eMockWalletEnabled() {
  if (typeof window === "undefined") return false;
  const isLocalhost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  return isLocalhost && window.localStorage.getItem(E2E_MOCK_WALLET_KEY) === "1";
}

function getE2eKeypair(): Keypair | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(E2E_SIGNING_KEY);
  if (!raw) return null;
  try {
    const bytes = Uint8Array.from(atob(raw.length > 88 ? raw : (() => {
      // bs58 decode inline (avoid import)
      const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
      const BASE = 58;
      const decoded: number[] = [];
      for (const char of raw) {
        let carry = ALPHABET.indexOf(char);
        if (carry < 0) throw new Error("invalid");
        for (let j = 0; j < decoded.length; j++) {
          carry += decoded[j] * BASE;
          decoded[j] = carry & 0xff;
          carry >>= 8;
        }
        while (carry > 0) { decoded.push(carry & 0xff); carry >>= 8; }
      }
      for (const char of raw) { if (char === "1") decoded.push(0); else break; }
      return btoa(String.fromCharCode(...decoded.reverse()));
    })()), (c) => c.charCodeAt(0));
    return Keypair.fromSecretKey(bytes);
  } catch {
    return null;
  }
}

function buildMockContext(): WalletContextState {
  const keypair = getE2eKeypair();
  const pubkeyStr = (typeof window !== "undefined" && window.localStorage.getItem(E2E_PUBLIC_KEY_OVERRIDE)) || E2E_MOCK_PUBLIC_KEY;
  const publicKey = keypair?.publicKey ?? new PublicKey(pubkeyStr);

  return {
    autoConnect: false,
    wallets: [],
    wallet: null,
    publicKey,
    connecting: false,
    connected: true,
    disconnecting: false,
    select: () => {},
    connect: async () => {},
    disconnect: async () => {},
    sendTransaction: keypair
      ? async (transaction, connection, options) => {
          if (transaction instanceof VersionedTransaction) {
            transaction.sign([keypair]);
            return connection.sendRawTransaction(transaction.serialize(), options);
          }
          (transaction as Transaction).partialSign(keypair);
          const raw = (transaction as Transaction).serialize();
          return connection.sendRawTransaction(raw, options);
        }
      : async () => { throw new Error("E2E mock wallet cannot send transactions."); },
    signTransaction: keypair
      ? async <T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> => {
          if (transaction instanceof VersionedTransaction) {
            transaction.sign([keypair]);
          } else {
            (transaction as Transaction).partialSign(keypair);
          }
          return transaction;
        }
      : async <T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> => transaction,
    signAllTransactions: keypair
      ? async <T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> => {
          for (const tx of transactions) {
            if (tx instanceof VersionedTransaction) {
              tx.sign([keypair]);
            } else {
              (tx as Transaction).partialSign(keypair);
            }
          }
          return transactions;
        }
      : async <T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> => transactions,
    signMessage: keypair
      ? async (message: Uint8Array) => {
          const { sign } = await import("tweetnacl");
          return sign.detached(message, keypair.secretKey);
        }
      : async () => new Uint8Array(64),
    signIn: undefined,
  };
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  if (e2eMockWalletEnabled()) {
    const mockContext = buildMockContext();
    const endpoint = (typeof window !== "undefined" && window.localStorage.getItem("velthoryn:e2e-rpc")) || RPC_ENDPOINT;

    return (
      <ConnectionProvider
        endpoint={endpoint}
        config={{ commitment: "confirmed", disableRetryOnRateLimit: true }}
      >
        <WalletContext.Provider value={mockContext}>
          {children}
        </WalletContext.Provider>
      </ConnectionProvider>
    );
  }

  return (
    <ConnectionProvider
      endpoint={RPC_ENDPOINT}
      config={{ commitment: "confirmed", disableRetryOnRateLimit: true }}
    >
      <SolanaWalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
