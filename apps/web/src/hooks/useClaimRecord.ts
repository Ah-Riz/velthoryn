"use client";

import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { useVestingProgram } from "./useVestingProgram";
import { derivePda } from "@/lib/anchor/client";

type ClaimRecordData = {
  beneficiary: PublicKey;
  tree: PublicKey;
  claimedAmount: { toString(): string };
  totalEntitled: { toString(): string };
  milestoneBitmap: number[];
  lastClaimAt: { toString(): string };
  bump: number;
};

/**
 * Reads the on-chain ClaimRecord PDA for a beneficiary in a campaign.
 * Returns null if the account does not exist yet (beneficiary has never claimed).
 * ClaimRecord is zero-copy with a per-leaf ledger (PER_LEAF_CAP=8).
 */
export function useClaimRecord(treeAddress: string | undefined, beneficiary: string | undefined) {
  const program = useVestingProgram();

  return useQuery<ClaimRecordData | null>({
    queryKey: ["claimRecord", treeAddress, beneficiary],
    enabled: !!program && !!treeAddress && !!beneficiary,
    staleTime: 10_000,
    queryFn: async () => {
      if (!program || !treeAddress || !beneficiary) return null;
      try {
        const treePubkey = new PublicKey(treeAddress);
        const beneficiaryPubkey = new PublicKey(beneficiary);
        const [claimRecordPda] = derivePda([
          "claim",
          treePubkey.toBuffer(),
          beneficiaryPubkey.toBuffer(),
        ]);
        const account = await (program.account as any).claimRecord.fetch(claimRecordPda);
        return account as ClaimRecordData;
      } catch {
        return null;
      }
    },
  });
}
