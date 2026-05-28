import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { VestingMerkleTree } from "./merkle";
import type { ReleaseType, VestingLeaf } from "./leaf";

// ---------------------------------------------------------------------------
// CampaignRecipient — input shape for prepareCampaign()
// ---------------------------------------------------------------------------
export interface CampaignRecipient {
  beneficiary: PublicKey;
  amount: BN;
  releaseType: ReleaseType;
  startTime: BN;
  cliffTime: BN;
  endTime: BN;
  milestoneIdx: number;
}

// ---------------------------------------------------------------------------
// PreparedCampaign — output of prepareCampaign()
// Contains everything needed to create and fund a campaign on-chain.
// ---------------------------------------------------------------------------
export interface PreparedCampaign {
  tree: VestingMerkleTree;
  root: Buffer;
  rootHex: string;
  leafCount: number;
  totalSupply: BN;
  /** Minimum cliff_time across all leaves (required for on-chain create_campaign / update_root). */
  minCliffTime: BN;
  leaves: VestingLeaf[];
  proofs: number[][][];
  proofsRaw: Buffer[][];
}

/** Minimum cliff_time across leaves — matches on-chain min_cliff_time semantics. */
export function computeMinCliffTime(leaves: VestingLeaf[]): BN {
  if (leaves.length === 0) {
    throw new Error("Cannot compute min cliff time for zero leaves");
  }
  return leaves.reduce((min, leaf) => (min.lt(leaf.cliffTime) ? min : leaf.cliffTime), leaves[0]!.cliffTime);
}

// ---------------------------------------------------------------------------
// prepareCampaign — one-shot helper that builds a Merkle tree and pre-computes
// all proofs. Returns a PreparedCampaign with everything needed for on-chain
// operations.
// ---------------------------------------------------------------------------
export function prepareCampaign(recipients: CampaignRecipient[]): PreparedCampaign {
  if (recipients.length === 0) {
    throw new Error("Cannot prepare campaign with zero recipients");
  }

  const leaves: VestingLeaf[] = recipients.map((r, i) => ({
    leafIndex: i,
    beneficiary: r.beneficiary,
    amount: r.amount,
    releaseType: r.releaseType,
    startTime: r.startTime,
    cliffTime: r.cliffTime,
    endTime: r.endTime,
    milestoneIdx: r.milestoneIdx,
  }));

  const tree = new VestingMerkleTree(leaves);

  let totalSupply = new BN(0);
  for (const leaf of leaves) {
    totalSupply = totalSupply.add(leaf.amount);
  }

  const proofsRaw: Buffer[][] = [];
  const proofs: number[][][] = [];
  for (let i = 0; i < leaves.length; i++) {
    proofsRaw.push(tree.proof(i));
    proofs.push(tree.proofAsArrays(i));
  }

  return {
    tree,
    root: tree.root,
    rootHex: tree.rootHex,
    leafCount: leaves.length,
    totalSupply,
    minCliffTime: computeMinCliffTime(leaves),
    leaves,
    proofs,
    proofsRaw,
  };
}
