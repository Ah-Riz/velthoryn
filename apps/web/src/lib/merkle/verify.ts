import { hashLeaf, hashNode, type VestingLeaf } from "./builder";

export type LeafProofInput = {
  leafIndex: number;
  beneficiary: string;
  amount: string | number | bigint;
  releaseType: number;
  startTime: string | number | bigint;
  cliffTime: string | number | bigint;
  endTime: string | number | bigint;
  milestoneIdx: number;
  proof: number[][];
};

function toLeaf(input: LeafProofInput): VestingLeaf {
  return {
    leafIndex: input.leafIndex,
    beneficiary: input.beneficiary,
    amount: BigInt(input.amount),
    releaseType: input.releaseType as 0 | 1 | 2,
    startTs: BigInt(input.startTime),
    cliffTs: BigInt(input.cliffTime),
    endTs: BigInt(input.endTime),
    milestoneIdx: input.milestoneIdx,
  };
}

function verifyProof(
  hashLeafBuf: Buffer,
  proof: Buffer[],
  index: number,
  root: Buffer,
): boolean {
  let hash = hashLeafBuf;
  let idx = index;
  for (const sibling of proof) {
    if ((idx & 1) === 0) {
      hash = hashNode(hash, sibling);
    } else {
      hash = hashNode(sibling, hash);
    }
    idx >>= 1;
  }
  return hash.equals(root);
}

/** Verify one campaign leaf against the declared merkle root. */
export function verifyLeafProof(
  leaf: LeafProofInput,
  merkleRootHex: string,
  leafCount: number,
): { ok: true } | { ok: false; error: string } {
  const leafForHash = toLeaf(leaf);
  const leafHash = hashLeaf(leafForHash);
  const rootBuf = Buffer.from(merkleRootHex, "hex");

  if (leafCount === 1) {
    if (!leafHash.equals(rootBuf)) {
      return { ok: false, error: "Single-leaf root does not match leaf hash" };
    }
    return { ok: true };
  }

  if (leaf.proof.length === 0) {
    return {
      ok: false,
      error: "Multi-leaf campaign requires proof for each leaf",
    };
  }

  const proofBufs = leaf.proof.map((sibling) => Buffer.from(sibling));
  const valid = verifyProof(leafHash, proofBufs, leaf.leafIndex, rootBuf);
  if (!valid) {
    return { ok: false, error: "Proof verification failed" };
  }
  return { ok: true };
}

/** Verify every leaf in a campaign payload; fails fast on first invalid leaf. */
export function verifyAllLeaves(
  leaves: LeafProofInput[],
  merkleRootHex: string,
): { ok: true } | { ok: false; error: string; leafIndex?: number } {
  for (const leaf of leaves) {
    const result = verifyLeafProof(leaf, merkleRootHex, leaves.length);
    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        leafIndex: leaf.leafIndex,
      };
    }
  }
  return { ok: true };
}
