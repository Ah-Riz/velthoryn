import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";

// Anti second-preimage attack: same byte tags as Jito's distributor
// Ref: research-week2.md §6.3
export const LEAF_PREFIX = Buffer.from([0x00]);
export const NODE_PREFIX = Buffer.from([0x01]);

export type VestingLeaf = {
  beneficiary: string; // base58 public key
  amount: bigint;      // total tokens (u64 LE)
  releaseType: 0 | 1 | 2; // 0=Cliff, 1=Linear, 2=Milestone
  cliffTs: bigint;     // i64 unix timestamp
  startTs: bigint;
  endTs: bigint;
};

// Encodes leaf data as Borsh-compatible LE bytes, matching Rust struct layout.
// Field order must match Lana's Rust `LeafData` struct exactly.
export function encodeLeaf(leaf: VestingLeaf): Buffer {
  const buf = Buffer.alloc(
    32 + // beneficiary (Pubkey = 32 bytes)
    8 +  // amount (u64 LE)
    1 +  // release_type (u8)
    8 +  // cliff_ts (i64 LE)
    8 +  // start_ts (i64 LE)
    8,   // end_ts (i64 LE)
  );

  const pkBuf = Buffer.from(
    require("bs58").decode(leaf.beneficiary) as Uint8Array,
  );
  pkBuf.copy(buf, 0);

  buf.writeBigUInt64LE(leaf.amount, 32);
  buf.writeUInt8(leaf.releaseType, 40);
  buf.writeBigInt64LE(leaf.cliffTs, 41);
  buf.writeBigInt64LE(leaf.startTs, 49);
  buf.writeBigInt64LE(leaf.endTs, 57);

  return buf;
}

// Hashes leaf: keccak256(LEAF_PREFIX || encodedLeaf)
// Must be byte-equal to Rust: keccak::hash(&[&[0x00], leaf_bytes].concat())
// This is the Day 1 Week 3 test gate.
export function hashLeaf(leaf: VestingLeaf): Buffer {
  const encoded = encodeLeaf(leaf);
  return keccak256(Buffer.concat([LEAF_PREFIX, encoded]));
}

export function hashNode(left: Buffer, right: Buffer): Buffer {
  return keccak256(Buffer.concat([NODE_PREFIX, left, right]));
}

export function buildTree(leaves: VestingLeaf[]): MerkleTree {
  const leafHashes = leaves.map(hashLeaf);
  return new MerkleTree(leafHashes, keccak256, {
    hashLeaves: false,
    sortPairs: false,
  });
}

export function getRoot(tree: MerkleTree): Buffer {
  return tree.getRoot();
}

export function getProof(tree: MerkleTree, leaf: VestingLeaf): Buffer[] {
  return tree.getProof(hashLeaf(leaf)).map((p) => p.data);
}
