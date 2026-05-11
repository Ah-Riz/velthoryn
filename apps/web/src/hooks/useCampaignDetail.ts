"use client";

import { useQuery } from "@tanstack/react-query";

interface CampaignAnalytics {
  uniqueClaimers: number;
  claimCount: number;
  percentClaimed: number;
  rootVersionCount: number;
}

interface RootVersion {
  version: number;
  merkleRoot: string;
  leafCount: number;
  createdAt: number;
  ipfsCid: string | null;
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
  createdAt: number;
  metadata: { name?: string; description?: string; logoUri?: string } | null;
  analytics: CampaignAnalytics;
  rootVersions: RootVersion[];
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
