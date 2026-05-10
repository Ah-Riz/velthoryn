"use client";

import { useQuery } from "@tanstack/react-query";

interface MyLeaf {
  leafIndex: number;
  amount: number;
  releaseType: number;
  startTime: number;
  cliffTime: number;
  endTime: number;
  milestoneIdx: number;
}

interface BeneficiaryCampaign {
  treeAddress: string;
  creator: string;
  mint: string;
  campaignId: number;
  totalSupply: number;
  leafCount: number;
  paused: boolean;
  cancelledAt: number | null;
  createdAt: number;
  metadata: { name?: string; description?: string; logoUri?: string } | null;
  myLeaf: MyLeaf;
}

interface BeneficiaryCampaignsResponse {
  campaigns: BeneficiaryCampaign[];
}

export function useBeneficiaryCampaigns(address: string | undefined) {
  return useQuery<BeneficiaryCampaignsResponse>({
    queryKey: ["beneficiaryCampaigns", address],
    queryFn: async () => {
      const res = await fetch(`/api/beneficiary/${address}/campaigns`);
      if (!res.ok) {
        throw new Error(`Failed to fetch beneficiary campaigns: ${res.status}`);
      }
      return res.json();
    },
    enabled: !!address,
    staleTime: 10_000,
  });
}
