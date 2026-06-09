"use client";

import { useQuery } from "@tanstack/react-query";
import type { TimelineEvent } from "@/hooks/useCampaignTimeline";

export interface ActivityEvent extends TimelineEvent {
  treeAddress: string;
  campaignName: string | null;
}

export interface ActivityResponse {
  address: string;
  events: ActivityEvent[];
  total: number;
}

export function useRecentActivity(address: string | undefined, limit = 20) {
  return useQuery<ActivityResponse>({
    queryKey: ["recentActivity", address, limit],
    queryFn: async () => {
      const res = await fetch(`/api/activity/${address}?limit=${limit}`);
      if (!res.ok) {
        if (res.status === 404) {
          return { address: address!, events: [], total: 0 };
        }
        throw new Error(`Activity feed fetch failed (${res.status})`);
      }
      return res.json();
    },
    enabled: !!address,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}
