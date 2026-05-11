import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { keccak_256 } from "js-sha3";

// ---------------------------------------------------------------------------
// Anti second-preimage attack: same byte tags as Jito's distributor
// Ref: programs/vesting/src/math/merkle.rs
// ---------------------------------------------------------------------------
export const LEAF_PREFIX = Buffer.from([0x00]);
export const NODE_PREFIX = Buffer.from([0x01]);

// ---------------------------------------------------------------------------
// Release type — matches programs/vesting/src/state/leaf.rs
// ---------------------------------------------------------------------------
export const ReleaseType = {
  Cliff: 0,
  Linear: 1,
  Milestone: 2,
} as const;

export type ReleaseType = (typeof ReleaseType)[keyof typeof ReleaseType];

// ---------------------------------------------------------------------------
// VestingLeaf — mirrors Rust VestingLeaf struct field order exactly
// programs/vesting/src/state/leaf.rs:
//   pub leaf_index:    u32,        offset 0,  4 bytes
//   pub beneficiary:   Pubkey,     offset 4,  32 bytes
//   pub amount:        u64,        offset 36, 8 bytes
//   pub release_type:  u8,         offset 44, 1 byte
//   pub start_time:    i64,        offset 45, 8 bytes
//   pub cliff_time:    i64,        offset 53, 8 bytes
//   pub end_time:      i64,        offset 61, 8 bytes
//   pub milestone_idx: u8,         offset 69, 1 byte
// Total: 70 bytes
// ---------------------------------------------------------------------------
export interface VestingLeaf {
  leafIndex: number;
  beneficiary: PublicKey;
  amount: BN;
  releaseType: ReleaseType;
  startTime: BN;
  cliffTime: BN;
  endTime: BN;
  milestoneIdx: number;
}

// ---------------------------------------------------------------------------
// encodeLeaf — 70-byte Borsh-compatible LE buffer matching Rust struct layout
// Field order MUST match programs/vesting/src/state/leaf.rs exactly.
// ---------------------------------------------------------------------------
export function encodeLeaf(leaf: VestingLeaf): Buffer {
  const buf = Buffer.alloc(70);

  buf.writeUInt32LE(leaf.leafIndex, 0);
  leaf.beneficiary.toBuffer().copy(buf, 4);
  buf.writeBigUInt64LE(BigInt(leaf.amount.toString()), 36);
  buf.writeUInt8(leaf.releaseType, 44);
  buf.writeBigInt64LE(BigInt(leaf.startTime.toString()), 45);
  buf.writeBigInt64LE(BigInt(leaf.cliffTime.toString()), 53);
  buf.writeBigInt64LE(BigInt(leaf.endTime.toString()), 61);
  buf.writeUInt8(leaf.milestoneIdx, 69);

  return buf;
}

// ---------------------------------------------------------------------------
// leafHash — keccak256(0x00 || borsh(leaf))
// Must be byte-identical to Rust leaf_hash() in math/merkle.rs
// ---------------------------------------------------------------------------
export function leafHash(leaf: VestingLeaf): Buffer {
  const encoded = encodeLeaf(leaf);
  const data = Buffer.concat([LEAF_PREFIX, encoded]);
  return Buffer.from(keccak_256(data), "hex");
}

// ---------------------------------------------------------------------------
// nodeHash — keccak256(0x01 || left || right)
// Must be byte-identical to Rust node_hash() in math/merkle.rs
// ---------------------------------------------------------------------------
export function nodeHash(left: Buffer, right: Buffer): Buffer {
  const data = Buffer.concat([NODE_PREFIX, left, right]);
  return Buffer.from(keccak_256(data), "hex");
}
