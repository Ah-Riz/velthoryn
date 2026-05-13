import { BN } from "@coral-xyz/anchor";

/**
 * Converts the API's camelCase ProofLeaf into Anchor's snake_case VestingLeaf
 * for use with `program.methods.claim(leaf, proof)`.
 */
export function toAnchorLeaf(apiLeaf: {
  leafIndex: number;
  beneficiary: string;
  amount: string;
  releaseType: number;
  startTime: number;
  cliffTime: number;
  endTime: number;
  milestoneIdx: number;
}) {
  return {
    leaf_index: apiLeaf.leafIndex,
    beneficiary: apiLeaf.beneficiary,
    amount: new BN(apiLeaf.amount),
    release_type: apiLeaf.releaseType,
    start_time: new BN(apiLeaf.startTime),
    cliff_time: new BN(apiLeaf.cliffTime),
    end_time: new BN(apiLeaf.endTime),
    milestone_idx: apiLeaf.milestoneIdx,
  };
}

export type AnchorVestingLeaf = ReturnType<typeof toAnchorLeaf>;
