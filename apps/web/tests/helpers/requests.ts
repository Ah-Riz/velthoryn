import { hashLeaf } from "@/lib/merkle/builder";

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

export function computeSingleLeafRoot(leaf: ReturnType<typeof makeLeaf>): string {
  const leafForHash = {
    leafIndex: leaf.leafIndex,
    beneficiary: leaf.beneficiary,
    amount: BigInt(leaf.amount),
    releaseType: leaf.releaseType as 0 | 1 | 2,
    startTs: BigInt(leaf.startTime),
    cliffTs: BigInt(leaf.cliffTime),
    endTs: BigInt(leaf.endTime),
    milestoneIdx: leaf.milestoneIdx,
  };
  return hashLeaf(leafForHash).toString("hex");
}

export function makeUrl(path: string, params?: Record<string, string>): string {
  const base = `http://localhost${path}`;
  if (!params) return base;
  const qs = new URLSearchParams(params).toString();
  return `${base}?${qs}`;
}
