"use client";

import { useEffect, useRef } from "react";
import {
  indexCampaign,
  listPendingCampaignIndexesLocal,
} from "@/lib/stream/persist";

export function PendingCampaignIndexer() {
  const runningRef = useRef(false);

  useEffect(() => {
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
            await indexCampaign(payload);
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
  }, []);

  return null;
}
