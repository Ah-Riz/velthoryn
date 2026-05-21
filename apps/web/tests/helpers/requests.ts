import { Keypair } from "@solana/web3.js";
import { hashLeaf, VestingMerkleTree } from "@/lib/merkle/builder";

export const CREATOR = "11111111111111111111111111111112";
export const MINT = "11111111111111111111111111111114";
export const BENEFICIARY = "11111111111111111111111111111111";
export const OTHER_BENEFICIARY = "22222222222222222222222222222222";

export const EMPTY_SIBLING = new Array(32).fill(0) as number[];

export function makeLeaf(overrides: Record<string, unknown> = {}) {
  return {
    leafIndex: 0,
    beneficiary: BENEFICIARY,
    amount: "1000000",
    releaseType: 1,
    startTime: "1700000000",
    cliffTime: "0",
    endTime: "1731536000",
    milestoneIdx: 0,
    proof: [EMPTY_SIBLING] as number[][],
    ...overrides,
  };
}

export function makeCampaignBody(overrides: Record<string, unknown> = {}) {
  const treeAddress =
    (overrides.treeAddress as string | undefined) ?? "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  return {
    treeAddress,
    creator: CREATOR,
    mint: MINT,
    campaignId: 1,
    merkleRoot: "a".repeat(64),
    leafCount: 1,
    totalSupply: "1000000",
    cancellable: false,
    cancelAuthority: null,
    pauseAuthority: null,
    createdAt: 1700000000,
    metadata: undefined as
      | { name?: string; description?: string; logoUri?: string }
      | undefined,
    ipfsCid: undefined as string | undefined,
    leaves: [makeLeaf()],
    ...overrides,
  };
}

function leafToHashInput(leaf: ReturnType<typeof makeLeaf>) {
  return {
    leafIndex: leaf.leafIndex,
    beneficiary: leaf.beneficiary,
    amount: BigInt(leaf.amount),
    releaseType: leaf.releaseType as 0 | 1 | 2,
    startTs: BigInt(leaf.startTime),
    cliffTs: BigInt(leaf.cliffTime),
    endTs: BigInt(leaf.endTime),
    milestoneIdx: leaf.milestoneIdx,
  };
}

/** Build a valid N-leaf campaign body with correct proofs (default 3 leaves). */
export function makeMultiLeafCampaignBody(
  leafCount: number,
  overrides: Record<string, unknown> = {},
) {
  const leaves = Array.from({ length: leafCount }, (_, i) =>
    makeLeaf({
      leafIndex: i,
      beneficiary:
        i === 0
          ? BENEFICIARY
          : i === 1
            ? OTHER_BENEFICIARY
            : "33333333333333333333333333333333",
    }),
  );
  const hashes = leaves.map((leaf) => hashLeaf(leafToHashInput(leaf)));
  const tree = new VestingMerkleTree(hashes);
  const merkleRoot = tree.root.toString("hex");
  const leavesWithProof = leaves.map((leaf, i) => ({
    ...leaf,
    proof: tree.proof(i).map((b) => Array.from(b)),
  }));
  return {
    merkleRoot,
    leafCount,
    leaves: leavesWithProof,
    ...overrides,
  };
}

/** Build a valid 2-leaf campaign body with correct proofs for both leaves. */
export function makeTwoLeafCampaignBody(overrides: Record<string, unknown> = {}) {
  const leaf0 = makeLeaf({ leafIndex: 0, ...(overrides.leaf0 as object) });
  const leaf1 = makeLeaf({
    leafIndex: 1,
    beneficiary: OTHER_BENEFICIARY,
    ...(overrides.leaf1 as object),
  });
  const hashes = [leaf0, leaf1].map((leaf) => hashLeaf(leafToHashInput(leaf)));
  const tree = new VestingMerkleTree(hashes);
  const merkleRoot = tree.root.toString("hex");
  const leaves = [
    {
      ...leaf0,
      proof: tree.proof(0).map((b) => Array.from(b)),
    },
    {
      ...leaf1,
      proof: tree.proof(1).map((b) => Array.from(b)),
    },
  ];
  return makeCampaignBody({
    treeAddress: randomTreeAddress(),
    merkleRoot,
    leafCount: 2,
    totalSupply: "2000000",
    leaves,
    ...overrides,
  });
}

function randomTreeAddress(): string {
  return Keypair.generate().publicKey.toBase58();
}

export function computeSingleLeafRoot(leaf: ReturnType<typeof makeLeaf>): string {
  return hashLeaf(leafToHashInput(leaf)).toString("hex");
}

export function makeUrl(path: string, params?: Record<string, string>): string {
  const base = `http://localhost${path}`;
  if (!params) return base;
  const qs = new URLSearchParams(params).toString();
  return `${base}?${qs}`;
}
