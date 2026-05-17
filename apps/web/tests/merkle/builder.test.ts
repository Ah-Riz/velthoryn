import { describe, it, expect } from "vitest";
import { hashLeaf, buildTree, getRoot, getProof, verifyProof, type VestingLeaf } from "../../src/lib/merkle/builder";

// Day 1 Week 3 test gate: TS keccak256(LEAF_PREFIX || encodedLeaf) must equal Rust golden hex.
// Ref: research-week2.md §6.3 + §10.2
// Regenerate: cd programs/vesting && cargo test golden_leaf_hex -- --nocapture

const RUST_GOLDEN_HEX = "cf2129259e55d196c624b52834eeca822036914cabe10ce39ebbfbe67270627b";

// Canonical fixture — matches Lana's Rust golden_leaf_hex test exactly.
// leaf_index=0, beneficiary=Pubkey::default(), amount=1_000_000,
// release_type=1 (Linear), start_time=1_700_000_000, cliff_time=0,
// end_time=1_731_536_000, milestone_idx=0
const FIXTURE: VestingLeaf = {
  leafIndex: 0,
  beneficiary: "11111111111111111111111111111111",
  amount: 1_000_000n,
  releaseType: 1,
  startTs: 1_700_000_000n,
  cliffTs: 0n,
  endTs: 1_731_536_000n,
  milestoneIdx: 0,
};

describe("merkle builder", () => {
  it("hashLeaf returns 32 bytes", () => {
    const hash = hashLeaf(FIXTURE);
    expect(hash).toHaveLength(32);
  });

  it("hashLeaf is deterministic", () => {
    expect(hashLeaf(FIXTURE).toString("hex")).toBe(
      hashLeaf(FIXTURE).toString("hex"),
    );
  });

  it("buildTree + getRoot produces non-zero 32-byte root", () => {
    const tree = buildTree([FIXTURE]);
    const root = getRoot(tree);
    expect(root).toHaveLength(32);
    expect(root.every((b) => b === 0)).toBe(false);
  });

  it("getProof verifies against root (using verifyProof)", () => {
    const tree = buildTree([FIXTURE]);
    const proof = getProof(tree, FIXTURE);
    const root = getRoot(tree);
    const leafHashBuf = hashLeaf(FIXTURE);
    const valid = verifyProof(leafHashBuf, proof, 0, root);
    expect(valid).toBe(true);
  });

  it("byte-equal with Rust keccak output (GATE)", () => {
    const tsHex = hashLeaf(FIXTURE).toString("hex");
    expect(tsHex).toBe(RUST_GOLDEN_HEX);
  });
});
