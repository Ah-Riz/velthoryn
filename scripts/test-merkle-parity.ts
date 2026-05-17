/**
 * test-merkle-parity.ts
 *
 * Standalone parity test that verifies both Merkle tree implementations
 * produce byte-identical roots and proofs:
 *
 *   1. clients/ts/src/merkle.ts  — VestingMerkleTree (reference)
 *   2. apps/web/src/lib/merkle/builder.ts — VestingMerkleTree (ported)
 *
 * Usage:  npx tsx scripts/test-merkle-parity.ts
 */

import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

// clients/ts imports (reference implementation)
import { VestingMerkleTree as ClientMerkleTree } from "../clients/ts/src/merkle";
import { leafHash as clientLeafHash } from "../clients/ts/src/leaf";
import type { VestingLeaf as ClientVestingLeaf } from "../clients/ts/src/leaf";

// apps/web imports (ported implementation)
import {
  hashLeaf as webHashLeaf,
  buildTree,
  getRoot,
  getProof,
  verifyProof,
  type VestingLeaf as WebVestingLeaf,
} from "../apps/web/src/lib/merkle/builder";

// ---------------------------------------------------------------------------
// Test leaves — one per release type
// ---------------------------------------------------------------------------

const BASE_TS = 1_700_000_000; // realistic Solana slot-aligned timestamp

interface SharedLeaf {
  leafIndex: number;
  beneficiary: string;
  amount: bigint;
  releaseType: 0 | 1 | 2;
  startTs: bigint;
  cliffTs: bigint;
  endTs: bigint;
  milestoneIdx: number;
}

const TEST_LEAVES: SharedLeaf[] = [
  {
    leafIndex: 0,
    beneficiary: PublicKey.default.toBase58(),
    amount: 5_000_000n,
    releaseType: 0, // Cliff
    startTs: BigInt(BASE_TS),
    cliffTs: BigInt(BASE_TS + 31_536_000), // 1 year cliff
    endTs: BigInt(BASE_TS + 31_536_000),
    milestoneIdx: 0,
  },
  {
    leafIndex: 1,
    beneficiary: PublicKey.default.toBase58(),
    amount: 10_000_000n,
    releaseType: 1, // Linear
    startTs: BigInt(BASE_TS),
    cliffTs: 0n,
    endTs: BigInt(BASE_TS + 63_072_000), // 2 years
    milestoneIdx: 0,
  },
  {
    leafIndex: 2,
    beneficiary: PublicKey.default.toBase58(),
    amount: 3_000_000n,
    releaseType: 2, // Milestone
    startTs: BigInt(BASE_TS),
    cliffTs: 0n,
    endTs: BigInt(BASE_TS + 94_608_000), // 3 years
    milestoneIdx: 3, // 4th milestone
  },
];

// ---------------------------------------------------------------------------
// Convert shared leaf → clients/ts VestingLeaf
// ---------------------------------------------------------------------------
function toClientLeaf(leaf: SharedLeaf): ClientVestingLeaf {
  return {
    leafIndex: leaf.leafIndex,
    beneficiary: new PublicKey(leaf.beneficiary),
    amount: new BN(leaf.amount.toString()),
    releaseType: leaf.releaseType,
    startTime: new BN(leaf.startTs.toString()),
    cliffTime: new BN(leaf.cliffTs.toString()),
    endTime: new BN(leaf.endTs.toString()),
    milestoneIdx: leaf.milestoneIdx,
  };
}

// ---------------------------------------------------------------------------
// Convert shared leaf → apps/web VestingLeaf
// ---------------------------------------------------------------------------
function toWebLeaf(leaf: SharedLeaf): WebVestingLeaf {
  return {
    leafIndex: leaf.leafIndex,
    beneficiary: leaf.beneficiary,
    amount: leaf.amount,
    releaseType: leaf.releaseType,
    startTs: leaf.startTs,
    cliffTs: leaf.cliffTs,
    endTs: leaf.endTs,
    milestoneIdx: leaf.milestoneIdx,
  };
}

// ---------------------------------------------------------------------------
// Run parity checks
// ---------------------------------------------------------------------------
function main(): void {
  const clientLeaves = TEST_LEAVES.map(toClientLeaf);
  const webLeaves = TEST_LEAVES.map(toWebLeaf);

  // Build both trees
  const clientTree = new ClientMerkleTree(clientLeaves);
  const webTree = buildTree(webLeaves);

  let allPassed = true;

  // --- Check 1: Roots are byte-identical ---
  const clientRoot = clientTree.root;
  const webRoot = getRoot(webTree);

  const rootsMatch = clientRoot.equals(webRoot);
  console.log(
    rootsMatch ? "PASS" : "FAIL",
    "— Roots are byte-identical"
  );
  if (!rootsMatch) {
    console.log("  client root:", clientRoot.toString("hex"));
    console.log("  web root:   ", webRoot.toString("hex"));
    allPassed = false;
  }

  // --- Check 2: All proofs are byte-identical ---
  for (let i = 0; i < TEST_LEAVES.length; i++) {
    const clientProof = clientTree.proof(i);
    const webProof = getProof(webTree, webLeaves[i]);

    const proofsMatch =
      clientProof.length === webProof.length &&
      clientProof.every((buf, j) => buf.equals(webProof[j]));

    console.log(
      proofsMatch ? "PASS" : "FAIL",
      `— Proof for leaf ${i} is byte-identical (${clientProof.length} siblings)`
    );
    if (!proofsMatch) {
      console.log(
        `  client proof (${clientProof.length}):`,
        clientProof.map((b) => b.toString("hex").slice(0, 16) + "...")
      );
      console.log(
        `  web proof (${webProof.length}):   `,
        webProof.map((b) => b.toString("hex").slice(0, 16) + "...")
      );
      allPassed = false;
    }
  }

  // --- Check 3: All proofs verify against both roots ---
  for (let i = 0; i < TEST_LEAVES.length; i++) {
    const clientLeafHashBuf = clientLeafHash(clientLeaves[i]);
    const webLeafHashBuf = webHashLeaf(webLeaves[i]);

    // Leaf hashes should also match
    const leafHashesMatch = clientLeafHashBuf.equals(webLeafHashBuf);
    if (!leafHashesMatch) {
      console.log(
        "FAIL",
        `— Leaf hash mismatch for leaf ${i}`
      );
      console.log("  client:", clientLeafHashBuf.toString("hex"));
      console.log("  web:   ", webLeafHashBuf.toString("hex"));
      allPassed = false;
    }

    const clientProof = clientTree.proof(i);
    const webProof = getProof(webTree, webLeaves[i]);

    // Verify client proof against client root (reference self-check)
    const clientSelfVerify = clientTree.verify(i, clientProof);
    console.log(
      clientSelfVerify ? "PASS" : "FAIL",
      `— Client tree self-verify leaf ${i}`
    );
    if (!clientSelfVerify) allPassed = false;

    // Verify web proof against web root (ported self-check)
    const webSelfVerify = verifyProof(webLeafHashBuf, webProof, i, webRoot);
    console.log(
      webSelfVerify ? "PASS" : "FAIL",
      `— Web verifyProof leaf ${i}`
    );
    if (!webSelfVerify) allPassed = false;

    // Cross-verify: web proof against client root
    const crossVerify = verifyProof(webLeafHashBuf, webProof, i, clientRoot);
    console.log(
      crossVerify ? "PASS" : "FAIL",
      `— Cross-verify (web proof, client root) leaf ${i}`
    );
    if (!crossVerify) allPassed = false;
  }

  // --- Summary ---
  console.log("");
  if (allPassed) {
    console.log("All parity checks PASSED.");
    process.exit(0);
  } else {
    console.log("Some parity checks FAILED.");
    process.exit(1);
  }
}

main();
