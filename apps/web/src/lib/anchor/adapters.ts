import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

/**
 * Converts the API's camelCase ProofLeaf into Anchor's snake_case VestingLeaf
 * for use with `program.methods.claim(leaf, proof)`.
 */
export function toAnchorLeaf(apiLeaf: {
  leafIndex: number;
  beneficiary: string;
  amount: string;
  releaseType: number;
  startTime: string | number;
  cliffTime: string | number;
  endTime: string | number;
  milestoneIdx: number;
}) {
  return {
    leafIndex: apiLeaf.leafIndex,
    beneficiary: new PublicKey(apiLeaf.beneficiary),
    amount: new BN(apiLeaf.amount),
    releaseType: apiLeaf.releaseType,
    startTime: new BN(apiLeaf.startTime),
    cliffTime: new BN(apiLeaf.cliffTime),
    endTime: new BN(apiLeaf.endTime),
    milestoneIdx: apiLeaf.milestoneIdx,
  };
}

export type AnchorVestingLeaf = ReturnType<typeof toAnchorLeaf>;
