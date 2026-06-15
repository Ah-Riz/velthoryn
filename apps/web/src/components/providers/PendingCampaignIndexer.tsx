"use client";

import { useEffect, useRef, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  indexCampaign,
  listPendingCampaignIndexesLocal,
  removePendingCampaignIndexLocal,
} from "@/lib/stream/persist";
import type { WalletSigner } from "@/lib/api/client-auth";

function isUserRejection(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    error.name === "WalletSignMessageError" ||
    msg.includes("user rejected") ||
    msg.includes("transaction cancelled") ||
    msg.includes("user denied")
  );
}

export function PendingCampaignIndexer() {
  const runningRef = useRef(false);
  const { publicKey, signMessage } = useWallet();

  const wallet: WalletSigner | undefined = useMemo(
    () => (publicKey && signMessage ? { publicKey, signMessage } : undefined),
    [publicKey, signMessage],
  );

  useEffect(() => {
    if (!wallet) return;

    let cancelled = false;

    async function flushPendingIndexes() {
      if (runningRef.current || cancelled) return;

      const pending = listPendingCampaignIndexesLocal();
      if (pending.length === 0) return;

      runningRef.current = true;
      try {
        for (const payload of pending) {
          if (cancelled) break;
          try {
            await indexCampaign(payload, wallet);
          } catch (error) {
            if (isUserRejection(error)) {
              removePendingCampaignIndexLocal(payload.treeAddress);
            }
          }
        }
      } finally {
        runningRef.current = false;
      }
    }

    void flushPendingIndexes();

    const handleOnline = () => {
      void flushPendingIndexes();
    };
    const handleFocus = () => {
      void flushPendingIndexes();
    };
    const intervalId = window.setInterval(() => {
      void flushPendingIndexes();
    }, 15_000);

    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("focus", handleFocus);
    };
  }, [wallet]);

  return null;
}
