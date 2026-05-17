import keccak256 from "keccak256";
import bs58 from "bs58";

// Anti second-preimage attack: same byte tags as Jito's distributor
// Ref: research-week2.md §6.3
export const LEAF_PREFIX = Buffer.from([0x00]);
export const NODE_PREFIX = Buffer.from([0x01]);

// ---------------------------------------------------------------------------
// Max tree depth — per SECURITY.md §2.3
// 20 levels * 32 bytes/sibling = 640 bytes of proof alone, leaving margin
// within Solana's 1232-byte transaction size limit.
// ---------------------------------------------------------------------------
const MAX_TREE_DEPTH = 20;

export type VestingLeaf = {
  leafIndex: number;       // u32 LE  (4 bytes, offset 0)
  beneficiary: string;     // Pubkey  (32 bytes, offset 4)
  amount: bigint;          // u64 LE  (8 bytes, offset 36)
  releaseType: 0 | 1 | 2; // u8      (1 byte,  offset 44) — 0=Cliff 1=Linear 2=Milestone
  startTs: bigint;         // i64 LE  (8 bytes, offset 45)
  cliffTs: bigint;         // i64 LE  (8 bytes, offset 53)
  endTs: bigint;           // i64 LE  (8 bytes, offset 61)
  milestoneIdx: number;    // u8      (1 byte,  offset 69)
};

// Encodes leaf as 70-byte Borsh-compatible LE buffer matching Rust struct layout.
// Field order must match programs/vesting/src/state/leaf.rs exactly.
export function encodeLeaf(leaf: VestingLeaf): Buffer {
  const buf = Buffer.alloc(70);

  buf.writeUInt32LE(leaf.leafIndex, 0);
  Buffer.from(bs58.decode(leaf.beneficiary)).copy(buf, 4);
  buf.writeBigUInt64LE(leaf.amount, 36);
  buf.writeUInt8(leaf.releaseType, 44);
  buf.writeBigInt64LE(leaf.startTs, 45);
  buf.writeBigInt64LE(leaf.cliffTs, 53);
  buf.writeBigInt64LE(leaf.endTs, 61);
  buf.writeUInt8(leaf.milestoneIdx, 69);

  return buf;
}

// keccak256(LEAF_PREFIX || encodedLeaf) — must be byte-equal to Rust leaf_hash()
export function hashLeaf(leaf: VestingLeaf): Buffer {
  return keccak256(Buffer.concat([LEAF_PREFIX, encodeLeaf(leaf)]));
}

// keccak256(NODE_PREFIX || left || right) — must be byte-equal to Rust node_hash()
export function hashNode(left: Buffer, right: Buffer): Buffer {
  return keccak256(Buffer.concat([NODE_PREFIX, left, right]));
}

// ---------------------------------------------------------------------------
// VestingMerkleTree — hand-rolled binary Merkle tree
// Matches Rust verify_merkle_proof() semantics in math/merkle.rs:
//   - even index: hash(NODE_PREFIX || current || sibling)
//   - odd  index: hash(NODE_PREFIX || sibling || current)
//   - odd-length layer: duplicate last leaf before hashing
// Ported from clients/ts/src/merkle.ts but accepts pre-hashed Buffer[] leaves
// to match the apps/web data flow where hashLeaf() is called externally.
// ---------------------------------------------------------------------------
export class VestingMerkleTree {
  private readonly layers: Buffer[][];

  constructor(leafHashes: Buffer[]) {
    if (leafHashes.length === 0) {
      throw new Error("Cannot build Merkle tree with zero leaves");
    }

    // Guard: tree depth must not exceed MAX_TREE_DEPTH
    if (leafHashes.length > 1) {
      const depth = Math.ceil(Math.log2(leafHashes.length));
      if (depth > MAX_TREE_DEPTH) {
        throw new Error(
          `Tree depth ${depth} exceeds max ${MAX_TREE_DEPTH} (${leafHashes.length} leaves would produce ${depth * 32}-byte proofs, risking Solana's 1232-byte tx size limit)`
        );
      }
    }

    // Store leaf layer (already hashed)
    this.layers = [leafHashes];

    // Build each subsequent layer up to the root
    let current = this.layers[0];
    while (current.length > 1) {
      const next: Buffer[] = [];

      // If odd number of nodes, duplicate the last one (Rust does the same)
      const working =
        current.length % 2 === 1
          ? [...current, current[current.length - 1]]
          : current;

      for (let i = 0; i < working.length; i += 2) {
        next.push(hashNode(working[i], working[i + 1]));
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

  /** Number of leaves in the tree */
  get leafCount(): number {
    return this.layers[0].length;
  }

  /** Find the index of a leaf hash in the tree. Returns -1 if not found. */
  findLeafIndex(leafHashBuf: Buffer): number {
    return this.layers[0].findIndex((h) => h.equals(leafHashBuf));
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

      // Compute sibling position
      // even index → sibling is idx+1; odd index → sibling is idx-1
      let siblingIdx: number;
      if (idx % 2 === 0) {
        siblingIdx = idx + 1;
        // If sibling is beyond the real leaf count, it's a duplicate of the last
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
        hash = hashNode(hash, sibling);
      } else {
        hash = hashNode(sibling, hash);
      }
      idx >>= 1;
    }

    return hash.equals(this.root);
  }
}

// ---------------------------------------------------------------------------
// verifyProof — standalone proof verification (no tree instance required)
// Mirrors Rust verify_merkle_proof() exactly.
// ---------------------------------------------------------------------------
export function verifyProof(
  hashLeafBuf: Buffer,
  proof: Buffer[],
  index: number,
  root: Buffer
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

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

/** Build a VestingMerkleTree from an array of VestingLeaf objects. */
export function buildTree(leaves: VestingLeaf[]): VestingMerkleTree {
  const leafHashes = leaves.map(hashLeaf);
  return new VestingMerkleTree(leafHashes);
}

/** Get the 32-byte root hash from a VestingMerkleTree. */
export function getRoot(tree: VestingMerkleTree): Buffer {
  return tree.root;
}

/** Get a Merkle proof (sibling hashes) for a given leaf. */
export function getProof(
  tree: VestingMerkleTree,
  leaf: VestingLeaf
): Buffer[] {
  const index = tree.findLeafIndex(hashLeaf(leaf));
  if (index === -1) {
    throw new Error("Leaf not found in tree");
  }
  return tree.proof(index);
}
