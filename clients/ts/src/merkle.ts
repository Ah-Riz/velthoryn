import { leafHash, nodeHash } from "./leaf";
import type { VestingLeaf } from "./leaf";

// ---------------------------------------------------------------------------
// Max tree depth — per SECURITY.md §2.3
// 20 levels * 32 bytes/sibling = 640 bytes of proof alone, leaving margin
// within Solana's 1232-byte transaction size limit.
// ---------------------------------------------------------------------------
export const MAX_TREE_DEPTH = 20;

// ---------------------------------------------------------------------------
// VestingMerkleTree — hand-rolled binary Merkle tree
// Matches Rust verify_merkle_proof() semantics in math/merkle.rs:
//   - even index: hash(NODE_PREFIX || current || sibling)
//   - odd  index: hash(NODE_PREFIX || sibling || current)
//   - odd-length layer: duplicate last leaf before hashing
// ---------------------------------------------------------------------------
export class VestingMerkleTree {
  private readonly layers: Buffer[][];

  constructor(leaves: VestingLeaf[]) {
    if (leaves.length === 0) {
      throw new Error("Cannot build Merkle tree with zero leaves");
    }

    // Validate leaf indices are sequential from 0
    for (let i = 0; i < leaves.length; i++) {
      if (leaves[i].leafIndex !== i) {
        throw new Error(
          `Leaf at position ${i} has leafIndex=${leaves[i].leafIndex}, expected ${i}`
        );
      }
    }

    // Guard: tree depth must not exceed MAX_TREE_DEPTH
    if (leaves.length > 1) {
      const depth = Math.ceil(Math.log2(leaves.length));
      if (depth > MAX_TREE_DEPTH) {
        throw new Error(
          `Tree depth ${depth} exceeds max ${MAX_TREE_DEPTH} (${leaves.length} leaves would produce ${depth * 32}-byte proofs, risking Solana's 1232-byte tx size limit)`
        );
      }
    }

    // Build leaf layer (hash each leaf)
    this.layers = [leaves.map(leafHash)];

    // Build each subsequent layer up to the root
    let current = this.layers[0];
    while (current.length > 1) {
      const next: Buffer[] = [];

      // If odd number of nodes, duplicate the last one (Rust does the same)
      const working = current.length % 2 === 1
        ? [...current, current[current.length - 1]]
        : current;

      for (let i = 0; i < working.length; i += 2) {
        next.push(nodeHash(working[i], working[i + 1]));
      }

      this.layers.push(next);
      current = next;
    }
  }

  /** 32-byte root hash */
  get root(): Buffer {
    const topLayer = this.layers[this.layers.length - 1];
    return topLayer[0];
  }

  /** Root as hex string */
  get rootHex(): string {
    return this.root.toString("hex");
  }

  /**
   * Generate a Merkle proof for the leaf at the given index.
   * Returns sibling hashes ordered from leaf layer to root layer.
   */
  proof(index: number): Buffer[] {
    if (index < 0 || index >= this.layers[0].length) {
      throw new Error(
        `Index ${index} out of bounds (0..${this.layers[0].length - 1})`
      );
    }

    const siblings: Buffer[] = [];
    let idx = index;

    for (let layer = 0; layer < this.layers.length - 1; layer++) {
      const currentLayer = this.layers[layer];

      // Compute sibling position (odd-length layers duplicate last node)
      let siblingIdx: number;
      if (idx % 2 === 0) {
        siblingIdx = idx + 1;
        // If sibling is beyond the real leaf count, it's a duplicate
        if (siblingIdx >= currentLayer.length) {
          siblingIdx = currentLayer.length - 1;
        }
      } else {
        siblingIdx = idx - 1;
      }

      siblings.push(currentLayer[siblingIdx]);
      idx = Math.floor(idx / 2);
    }

    return siblings;
  }

  /** Same as proof() but returns number[][] for IDL / transaction encoding. */
  proofAsArrays(index: number): number[][] {
    return this.proof(index).map((buf) => Array.from(buf));
  }

  /**
   * Verify a proof for the leaf at the given index against the root.
   * Mirrors Rust verify_merkle_proof() exactly.
   */
  verify(index: number, proof: Buffer[]): boolean {
    if (index < 0 || index >= this.layers[0].length) {
      throw new Error(
        `Index ${index} out of bounds (0..${this.layers[0].length - 1})`
      );
    }
    let hash = this.layers[0][index];
    let idx = index;

    for (const sibling of proof) {
      if ((idx & 1) === 0) {
        hash = nodeHash(hash, sibling);
      } else {
        hash = nodeHash(sibling, hash);
      }
      idx >>= 1;
    }

    return hash.equals(this.root);
  }
}

// ---------------------------------------------------------------------------
// verifyProof — standalone proof verification (no tree instance required)
// Useful for off-chain checks before submitting a transaction.
// ---------------------------------------------------------------------------
export function verifyProof(
  hashLeaf: Buffer,
  proof: Buffer[],
  index: number,
  root: Buffer
): boolean {
  let hash = hashLeaf;
  let idx = index;
  for (const sibling of proof) {
    if ((idx & 1) === 0) {
      hash = nodeHash(hash, sibling);
    } else {
      hash = nodeHash(sibling, hash);
    }
    idx >>= 1;
  }
  return hash.equals(root);
}

export function proofAsArrays(proof: Buffer[]): number[][] {
  return proof.map((buf) => Array.from(buf));
}
