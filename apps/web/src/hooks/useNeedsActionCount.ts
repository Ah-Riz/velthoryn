"use client";

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCampaignList } from "@/hooks/useCampaignList";
import { useBeneficiaryCampaigns } from "@/hooks/useBeneficiaryCampaigns";
import { getRecipientStreamStatus } from "@/lib/vesting/list";

type NeedsActionResult = {
  count: number;
  isLoading: boolean;
};

export function useNeedsActionCount(): NeedsActionResult {
  const { publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58();

  const senderQuery = useCampaignList(
    walletAddress ? { creator: walletAddress, limit: 100 } : undefined,
  );
  const recipientQuery = useBeneficiaryCampaigns(walletAddress);

  const count = useMemo(() => {
    if (!walletAddress) return 0;

    let n = 0;
    const nowTs = BigInt(Math.floor(Date.now() / 1000));

    for (const c of senderQuery.data?.campaigns ?? []) {
      if (c.creator === walletAddress && c.cancelledAt !== null) {
        n++;
      }
    }

    for (const c of recipientQuery.data?.campaigns ?? []) {
      if (getRecipientStreamStatus(c, nowTs) === "Claimable") {
        n++;
      }
    }

    return n;
  }, [senderQuery.data?.campaigns, recipientQuery.data?.campaigns, walletAddress]);

  const isLoading =
    !walletAddress || senderQuery.isLoading || recipientQuery.isLoading;

  return { count, isLoading };
}
