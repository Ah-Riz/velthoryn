import { Connection, PublicKey } from "@solana/web3.js";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// VestingTree account Borsh layout (offsets from byte 0 of account data,
// which includes the 8-byte Anchor discriminator).
//
// Layout (all values little-endian):
//   [0..8]   discriminator
//   [8..40]  creator (pubkey, 32 bytes)
//   [40..72] mint (pubkey, 32 bytes)
//   [72..104] vault (pubkey, 32 bytes)
//   [104..136] vault_authority (pubkey, 32 bytes)
//   [136..144] campaign_id (u64)
//   [144..176] merkle_root ([u8;32])
//   [176..180] leaf_count (u32)
//   [180..188] total_supply (u64)
//   [188..196] total_claimed (u64)
//   [196]    cancellable (bool, 1 byte)
//   [197]    cancel_authority option flag (1 byte)
//   [198..230] cancel_authority pubkey (32 bytes, present if flag=1)
//   [230]    cancelled_at option flag (1 byte)
//   [231..239] cancelled_at i64 (8 bytes, present if flag=1)
//   [239]    paused (bool, 1 byte)
//   [240]    pause_authority option flag (1 byte)
//   [241..273] pause_authority pubkey (32 bytes, present if flag=1)
//   [273..281] created_at (i64)
//   [281..313] milestone_released_flags ([u8;32])
//   [313]    bump (u8)
// ---------------------------------------------------------------------------

interface VestingTreeState {
  merkleRoot: string;
  leafCount: number;
  totalClaimed: bigint;
  paused: boolean;
  cancelledAt: bigint | null;
}

function parseVestingTree(data: Buffer): VestingTreeState | null {
  if (data.length < 314) return null;

  const merkleRootBytes = data.subarray(144, 176);
  const merkleRoot = Buffer.from(merkleRootBytes).toString("hex");
  const leafCount = data.readUInt32LE(176);
  const totalClaimed = data.readBigUInt64LE(188);
  const paused = data.readUInt8(239) !== 0;

  const cancelledAtFlag = data.readUInt8(230);
  const cancelledAt =
    cancelledAtFlag === 1 ? data.readBigInt64LE(231) : null;

  return { merkleRoot, leafCount, totalClaimed, paused, cancelledAt };
}

export async function syncCampaignState(treeAddress: string): Promise<void> {
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_ENDPOINT;
  if (!rpcUrl) throw new Error("NEXT_PUBLIC_RPC_ENDPOINT is not set");

  const connection = new Connection(rpcUrl, "confirmed");

  const treePubkey = new PublicKey(treeAddress);

  const accountInfo = await connection.getAccountInfo(treePubkey);
  if (!accountInfo?.data) return;

  const data = Buffer.from(accountInfo.data);
  const state = parseVestingTree(data);
  if (!state) return;

  await db.transaction(async (tx) => {
    await tx
      .update(campaigns)
      .set({
        merkleRoot: state.merkleRoot,
        leafCount: state.leafCount,
        totalClaimed: state.totalClaimed,
        paused: state.paused,
        cancelledAt: state.cancelledAt,
      })
      .where(eq(campaigns.treeAddress, treeAddress));
  });
}
