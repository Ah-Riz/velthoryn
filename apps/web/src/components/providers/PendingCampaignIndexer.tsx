"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  indexCampaign,
  listPendingCampaignIndexesLocal,
} from "@/lib/stream/persist";
import { createAuthHeader } from "@/lib/api/client-auth";

export function PendingCampaignIndexer() {
  const runningRef = useRef(false);
  const { publicKey, signMessage } = useWallet();

  useEffect(() => {
    let cancelled = false;

    async function flushPendingIndexes() {
      if (runningRef.current || cancelled) return;

      const pending = listPendingCampaignIndexesLocal();
      if (pending.length === 0) return;

      // Build auth headers once per flush (if wallet is connected with signing)
      let authorization: string | undefined;
      if (publicKey && signMessage) {
        try {
          authorization = await createAuthHeader({ publicKey, signMessage });
        } catch {
          // Wallet may not be ready; proceed without auth and retry later
          return;
        }
      }

      runningRef.current = true;
      try {
        for (const payload of pending) {
          if (cancelled) break;
          try {
            await indexCampaign(
              payload,
              authorization ? { authorization } : undefined,
            );
          } catch {
            // keep pending payload for a later retry
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
  }, [publicKey, signMessage]);

  return null;
}
