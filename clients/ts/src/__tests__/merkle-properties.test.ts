/**
 * merkle-properties.test.ts — fast-check property tests for the TS Merkle client.
 *
 * Mirrors the Rust proptests in programs/vesting/src/math/merkle.rs (proptest_tests
 * module) so any divergence between the off-chain client and the on-chain verifier
 * is caught here. Run with:  node --import tsx --test src/__tests__/*.test.ts
 *
 * (node:test is used instead of jest — clients/ts ships no jest config; node:test is
 * built into the Node 20 runtime we already standardise on, so this adds zero runner
 * deps beyond fast-check itself.)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { VestingMerkleTree } from "../merkle";
import { verifyProof } from "../merkle";
import { leafHash } from "../leaf";
import type { VestingLeaf } from "../leaf";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Random linear leaf (releaseType=1) with cliff < end. Index is assigned sequentially. */
function makeLeaf(
  i: number,
  seed: { ben: Uint8Array; amount: bigint; cliff: number; duration: number }
): VestingLeaf {
  return {
    leafIndex: i,
    beneficiary: new PublicKey(seed.ben),
    amount: new BN(seed.amount.toString()),
    releaseType: 1, // Linear — exercises the schedule path most routers share
    startTime: new BN(0),
    cliffTime: new BN(seed.cliff),
    endTime: new BN(seed.cliff + seed.duration),
    milestoneIdx: 0,
  };
}

/** fast-check arbitrary: 1..24 sequential-index linear leaves (within MAX_TREE_DEPTH). */
const arbLeafSet = fc
  .array(
    fc.record({
      ben: fc.uint8Array({ minLength: 32, maxLength: 32 }),
      amount: fc.bigInt({ min: 1n, max: 1_000_000_000n }),
      cliff: fc.integer({ min: 1, max: 1_000_000 }),
      duration: fc.integer({ min: 1, max: 1_000_000 }),
    }),
    { minLength: 1, maxLength: 24 }
  )
  .map((rs) => rs.map((r, i) => makeLeaf(i, r)));

function flipBit(buf: Buffer, byteIdx: number, bitIdx: number): Buffer {
  const out = Buffer.from(buf); // copy
  out[byteIdx] ^= 1 << bitIdx;
  return out;
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("VestingMerkleTree property tests", () => {
  it("a valid proof for any leaf always verifies against the root", () => {
    fc.assert(
      fc.property(arbLeafSet, fc.nat(), (leaves, rawIdx) => {
        const tree = new VestingMerkleTree(leaves);
        const idx = rawIdx % leaves.length;
        const proof = tree.proof(idx);
        assert.ok(tree.verify(idx, proof), `leaf ${idx} failed self-verify`);
        // Standalone verifyProof must agree with the instance method.
        assert.ok(
          verifyProof(leafHash(leaves[idx]), proof, idx, tree.root),
          `standalone verifyProof disagreed for leaf ${idx}`
        );
      }),
      { numRuns: 200 }
    );
  });

  it("any single-bit tamper of the root fails verification", () => {
    fc.assert(
      fc.property(
        arbLeafSet,
        fc.nat(),
        fc.integer({ min: 0, max: 31 }),
        fc.integer({ min: 0, max: 7 }),
        (leaves, rawIdx, byteIdx, bitIdx) => {
          const tree = new VestingMerkleTree(leaves);
          const idx = rawIdx % leaves.length;
          const proof = tree.proof(idx);
          const badRoot = flipBit(tree.root, byteIdx, bitIdx);
          assert.ok(
            !verifyProof(leafHash(leaves[idx]), proof, idx, badRoot),
            "tampered root unexpectedly verified"
          );
        }
      ),
      { numRuns: 200 }
    );
  });

  it("any single-bit tamper of a proof sibling fails verification", () => {
    fc.assert(
      fc.property(
        arbLeafSet,
        fc.nat(),
        fc.nat(),
        fc.integer({ min: 0, max: 31 }),
        fc.integer({ min: 0, max: 7 }),
        (leaves, rawIdx, sibPick, byteIdx, bitIdx) => {
          const tree = new VestingMerkleTree(leaves);
          const idx = rawIdx % leaves.length;
          const proof = tree.proof(idx);
          if (proof.length === 0) return; // single-leaf tree: no sibling to tamper
          const sibIdx = sibPick % proof.length;
          const tampered = proof.map((b, j) =>
            j === sibIdx ? flipBit(b, byteIdx, bitIdx) : b
          );
          assert.ok(
            !verifyProof(leafHash(leaves[idx]), tampered, idx, tree.root),
            "tampered sibling unexpectedly verified"
          );
        }
      ),
      { numRuns: 200 }
    );
  });

  it("a shortened proof (last sibling dropped) fails verification", () => {
    fc.assert(
      fc.property(arbLeafSet, fc.nat(), (leaves, rawIdx) => {
        const tree = new VestingMerkleTree(leaves);
        const idx = rawIdx % leaves.length;
        const proof = tree.proof(idx);
        if (proof.length < 2) return; // need >=1 real level to shorten meaningfully
        const shortened = proof.slice(0, proof.length - 1);
        assert.ok(
          !verifyProof(leafHash(leaves[idx]), shortened, idx, tree.root),
          "shortened proof unexpectedly verified"
        );
      }),
      { numRuns: 200 }
    );
  });

  it("an over-long proof (extra trailing sibling) fails verification", () => {
    fc.assert(
      fc.property(arbLeafSet, fc.nat(), fc.uint8Array({ minLength: 32, maxLength: 32 }), (leaves, rawIdx, extra) => {
        const tree = new VestingMerkleTree(leaves);
        const idx = rawIdx % leaves.length;
        const proof = tree.proof(idx);
        const padded = [...proof, Buffer.from(extra)];
        assert.ok(
          !verifyProof(leafHash(leaves[idx]), padded, idx, tree.root),
          "padded/over-long proof unexpectedly verified"
        );
      }),
      { numRuns: 200 }
    );
  });

  it("verifying a leaf at the wrong index fails", () => {
    fc.assert(
      fc.property(arbLeafSet, fc.nat(), fc.nat(), (leaves, rawIdxA, rawIdxB) => {
        if (leaves.length < 2) return;
        const tree = new VestingMerkleTree(leaves);
        const a = rawIdxA % leaves.length;
        let b = rawIdxB % leaves.length;
        if (b === a) b = (b + 1) % leaves.length;
        const proofA = tree.proof(a);
        // Leaf A's hash with leaf A's proof but at index B must fail.
        assert.ok(
          !verifyProof(leafHash(leaves[a]), proofA, b, tree.root),
          "wrong-index verification unexpectedly succeeded"
        );
      }),
      { numRuns: 200 }
    );
  });

  it("non-power-of-two trees verify every leaf", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 17 }), fc.nat(), (n, rawIdx) => {
        const leaves: VestingLeaf[] = Array.from({ length: n }, (_, i) =>
          makeLeaf(i, {
            ben: new Uint8Array(32).fill(i + 1),
            amount: BigInt(1_000 * (i + 1)),
            cliff: 100,
            duration: 1_000,
          })
        );
        const tree = new VestingMerkleTree(leaves);
        const idx = rawIdx % n;
        const proof = tree.proof(idx);
        assert.ok(tree.verify(idx, proof), `n=${n} leaf ${idx} failed`);
      }),
      { numRuns: 50 }
    );
  });
});
