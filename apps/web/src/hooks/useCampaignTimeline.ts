"use client";

import { useQuery } from "@tanstack/react-query";

export interface TimelineEvent {
  type:
    | "claimed"
    | "cancelled"
    | "paused"
    | "root_updated"
    | "withdrawn"
    | "milestone_released"
    | "stream_cancelled";
  blockTime: string;
  signature: string;
  data: Record<string, unknown>;
}

interface TimelineResponse {
  events: TimelineEvent[];
  total: number;
  campaign: string;
}

export function useCampaignTimeline(
  treeAddress: string | undefined,
  limit = 20,
) {
  return useQuery<TimelineResponse>({
    queryKey: ["timeline", treeAddress, limit],
    queryFn: async () => {
      const res = await fetch(
        `/api/campaigns/${treeAddress}/timeline?limit=${limit}`,
      );
      if (!res.ok) {
        if (res.status === 404) return { events: [], total: 0, campaign: treeAddress! };
        throw new Error(`Timeline fetch failed (${res.status})`);
      }
      return res.json();
    },
    enabled: !!treeAddress,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
