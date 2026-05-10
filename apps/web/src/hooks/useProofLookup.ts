"use client";

import { useQuery } from "@tanstack/react-query";

interface ProofLeaf {
  leafIndex: number;
  beneficiary: string;
  amount: number;
  releaseType: number;
  startTime: number;
  cliffTime: number;
  endTime: number;
  milestoneIdx: number;
}

interface ProofResponse {
  leaf: ProofLeaf;
  proof: number[][];
  merkleRoot: string;
  treeAddress: string;
}

export function useProofLookup(
  treeAddress: string | undefined,
  beneficiary: string | undefined,
) {
  return useQuery<ProofResponse>({
    queryKey: ["proof", treeAddress, beneficiary],
    queryFn: async () => {
      const params = new URLSearchParams({ beneficiary: beneficiary! });
      const res = await fetch(
        `/api/campaigns/${treeAddress}/proof?${params}`,
      );
      if (!res.ok) {
        throw new Error(`Failed to fetch proof: ${res.status}`);
      }
      return res.json();
    },
    enabled: !!treeAddress && !!beneficiary,
    staleTime: 30_000,
  });
}
