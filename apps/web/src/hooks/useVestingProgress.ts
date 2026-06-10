"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

export interface VestingProgressCampaign {
  treeAddress: string;
  mint: string;
  metadata: { name?: string; description?: string; logoUri?: string } | null;
  leaf: {
    amount: string;
    releaseType: 0 | 1 | 2;
    startTime: string;
    cliffTime: string;
    endTime: string;
    milestoneIdx: number;
    leafIndex: number;
  };
  progress: {
    totalEntitled: string;
    vestedSoFar: string;
    claimedSoFar: string;
    claimable: string;
    progressPercent: number;
    nextUnlock: string | null;
  };
  cancelledAt: string | null;
  paused: boolean;
  milestoneReleased: boolean;
}

export interface VestingProgressResponse {
  address: string;
  campaigns: VestingProgressCampaign[];
}

export interface VestingProgressSummary {
  totalEntitled: bigint;
  totalVested: bigint;
  totalClaimed: bigint;
  totalClaimable: bigint;
  claimableCampaigns: number;
  campaignCount: number;
}

export function useVestingProgress(address: string | undefined) {
  return useQuery<VestingProgressResponse>({
    queryKey: ["vestingProgress", address],
    queryFn: async () => {
      const res = await fetch(`/api/beneficiary/${address}/vesting-progress`);
      if (!res.ok) {
        throw new Error(`Vesting progress fetch failed (${res.status})`);
      }
      return res.json();
    },
    enabled: !!address,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

export function useVestingProgressSummary(address: string | undefined) {
  const { data, isLoading, error } = useVestingProgress(address);

  const summary = useMemo<VestingProgressSummary | null>(() => {
    if (!data) return null;

    let totalEntitled = 0n;
    let totalVested = 0n;
    let totalClaimed = 0n;
    let totalClaimable = 0n;
    let claimableCampaigns = 0;

    for (const campaign of data.campaigns) {
      totalEntitled += BigInt(campaign.progress.totalEntitled);
      totalVested += BigInt(campaign.progress.vestedSoFar);
      totalClaimed += BigInt(campaign.progress.claimedSoFar);
      const claimable = BigInt(campaign.progress.claimable);
      totalClaimable += claimable;
      if (claimable > 0n) claimableCampaigns += 1;
    }

    return {
      totalEntitled,
      totalVested,
      totalClaimed,
      totalClaimable,
      claimableCampaigns,
      campaignCount: data.campaigns.length,
    };
  }, [data]);

  return {
    summary,
    isLoading,
    error,
    campaigns: data?.campaigns ?? [],
  };
}
