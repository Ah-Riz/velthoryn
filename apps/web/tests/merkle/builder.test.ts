import { describe, it, expect } from "vitest";
import { hashLeaf, buildTree, getRoot, getProof, type VestingLeaf } from "../../src/lib/merkle/builder";

// Day 1 Week 3 test gate: TS keccak256(LEAF_PREFIX || encodedLeaf) must equal Rust golden hex.
// Ref: research-week2.md §6.3 + §10.2
//
// HOW TO OBTAIN GOLDEN HEX:
//   1. In programs/vesting/src/lib.rs, add a #[test] that prints:
//      println!("{}", hex::encode(leaf_hash(&leaf_data)));
//   2. Run `cargo test -- --nocapture`
//   3. Paste hex output below as RUST_GOLDEN_HEX

const RUST_GOLDEN_HEX: string | null = null; // TODO: fill in from `cargo test`

const FIXTURE: VestingLeaf = {
  beneficiary: "11111111111111111111111111111111",
  amount: 1_000_000n,
  releaseType: 1, // Linear
  cliffTs: 0n,
  startTs: 1_700_000_000n,
  endTs: 1_731_536_000n,
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

  it("getProof verifies against root (JS-only round-trip)", () => {
    const { MerkleTree } = require("merkletreejs");
    const keccak256 = require("keccak256").default ?? require("keccak256");
    const tree = buildTree([FIXTURE]);
    const proof = getProof(tree, FIXTURE);
    const root = getRoot(tree);
    const leafHash = hashLeaf(FIXTURE);
    const valid = MerkleTree.verify(proof, leafHash, root, keccak256);
    expect(valid).toBe(true);
  });

  // Unblocks once Lana provides golden hex from Rust unit test
  it.skipIf(RUST_GOLDEN_HEX === null)(
    "byte-equal with Rust keccak output (GATE)",
    () => {
      const tsHex = hashLeaf(FIXTURE).toString("hex");
      expect(tsHex).toBe(RUST_GOLDEN_HEX);
    },
  );
});
