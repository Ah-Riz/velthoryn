"use client";

import { useQuery } from "@tanstack/react-query";

interface CampaignSummary {
  treeAddress: string;
  creator: string;
  mint: string;
  campaignId: number;
  leafCount: number;
  totalSupply: number;
  totalClaimed: number;
  cancellable: boolean;
  paused: boolean;
  cancelledAt: number | null;
  createdAt: number;
  metadata: { name?: string; description?: string; logoUri?: string } | null;
}

interface CampaignListResponse {
  campaigns: CampaignSummary[];
  total: number;
  page: number;
  limit: number;
}

interface CampaignListFilters {
  creator?: string;
  mint?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export function useCampaignList(filters?: CampaignListFilters) {
  return useQuery<CampaignListResponse>({
    queryKey: ["campaigns", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.creator) params.set("creator", filters.creator);
      if (filters?.mint) params.set("mint", filters.mint);
      if (filters?.status) params.set("status", filters.status);
      if (filters?.page) params.set("page", String(filters.page));
      if (filters?.limit) params.set("limit", String(filters.limit));

      const qs = params.toString();
      const url = `/api/campaigns${qs ? `?${qs}` : ""}`;

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch campaigns: ${res.status}`);
      }
      return res.json();
    },
    staleTime: 10_000,
  });
}
