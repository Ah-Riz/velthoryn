import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";
import bs58 from "bs58";

// Anti second-preimage attack: same byte tags as Jito's distributor
// Ref: research-week2.md §6.3
export const LEAF_PREFIX = Buffer.from([0x00]);
export const NODE_PREFIX = Buffer.from([0x01]);

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
