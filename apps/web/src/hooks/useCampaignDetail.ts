"use client";

import { useQuery } from "@tanstack/react-query";

interface CampaignAnalytics {
  uniqueClaimers: number;
  claimCount: number;
  percentClaimed: number;
  rootVersionCount: number;
}

interface RootVersion {
  id: number;
  version: number;
  merkleRoot: string;
  leafCount: number;
  createdAt: number;
  ipfsCid: string | null;
}

interface CampaignRecipient {
  beneficiary: string;
  allocation: string;
  leafCount: number;
  claimedAmount: string;
}

interface GracePeriod {
  end: string;
  remaining: string;
  isExpired: boolean;
}

interface CampaignDetail {
  treeAddress: string;
  creator: string;
  mint: string;
  campaignId: number;
  merkleRoot: string;
  leafCount: number;
  totalSupply: number;
  totalClaimed: number;
  cancellable: boolean;
  paused: boolean;
  cancelledAt: number | null;
  minCliffTime: number | null;
  instantRefunded: boolean;
  instantRefundEligible: boolean;
  createdAt: number;
  metadata: { name?: string; description?: string; logoUri?: string } | null;
  hasMilestoneLeaves?: boolean;
  gracePeriod: GracePeriod | null;
  analytics: CampaignAnalytics;
  rootVersions: RootVersion[];
  recipients: CampaignRecipient[];
}

export function useCampaignDetail(treeAddress: string | undefined) {
  return useQuery<CampaignDetail>({
    queryKey: ["campaign", treeAddress],
    queryFn: async () => {
      const res = await fetch(`/api/campaigns/${treeAddress}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch campaign: ${res.status}`);
      }
      return res.json();
    },
    enabled: !!treeAddress,
    staleTime: 10_000,
  });
}
