"use client";

import { useQuery } from "@tanstack/react-query";

interface ClaimEvent {
  beneficiary: string;
  leafIndex: number;
  amount: string;
  totalClaimedByUser: string;
  totalClaimedOverall: string;
  milestoneIdx: number | null;
  signature: string;
  slot: number;
  blockTime: number;
}

interface ClaimHistoryResponse {
  claims: ClaimEvent[];
  total: number;
}

interface ClaimHistoryFilters {
  beneficiary?: string;
  fromSlot?: number;
  limit?: number;
}

export function useClaimHistory(
  treeAddress: string | undefined,
  filters?: ClaimHistoryFilters,
) {
  return useQuery<ClaimHistoryResponse>({
    queryKey: ["claimHistory", treeAddress, filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.beneficiary) params.set("beneficiary", filters.beneficiary);
      if (filters?.fromSlot) params.set("fromSlot", String(filters.fromSlot));
      if (filters?.limit) params.set("limit", String(filters.limit));

      const qs = params.toString();
      const res = await fetch(
        `/api/campaigns/${treeAddress}/claims${qs ? `?${qs}` : ""}`,
      );
      if (!res.ok) {
        throw new Error(`Failed to fetch claims: ${res.status}`);
      }
      return res.json();
    },
    enabled: !!treeAddress,
    staleTime: 10_000,
  });
}
