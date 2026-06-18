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

class ProofLookupError extends Error {
  status: number;

  constructor(status: number) {
    super(`Failed to fetch proof: ${status}`);
    this.status = status;
  }
}

/**
 * Fetches the Merkle proof for a beneficiary in a campaign. Returns null if
 * the beneficiary is not in the tree (404). Used by ClaimWithProofButton.
 */
export function useProofLookup(
  treeAddress: string | undefined,
  beneficiary: string | undefined,
) {
  return useQuery<ProofResponse | null>({
    queryKey: ["proof", treeAddress, beneficiary],
    queryFn: async () => {
      const params = new URLSearchParams({ beneficiary: beneficiary! });
      const res = await fetch(
        `/api/campaigns/${treeAddress}/proof?${params}`,
      );
      if (!res.ok) {
        if (res.status === 404) {
          return null;
        }
        throw new ProofLookupError(res.status);
      }
      return res.json();
    },
    enabled: !!treeAddress && !!beneficiary,
    staleTime: 30_000,
    retry: (_failureCount, error) =>
      !(error instanceof ProofLookupError && error.status === 404),
  });
}
