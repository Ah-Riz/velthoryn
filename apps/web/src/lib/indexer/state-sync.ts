import { Connection, PublicKey } from "@solana/web3.js";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// VestingTree account Borsh layout
//
// IMPORTANT: This account has changed over time. We intentionally parse it in a
// cursor-based way (not fixed offsets) so:
// - legacy accounts (old layout) still parse safely
// - optional fields (Anchor Option<T>) don't shift offsets incorrectly
// - new fields default deterministically when absent
// ---------------------------------------------------------------------------

interface VestingTreeState {
  merkleRoot: string;
  leafCount: number;
  totalClaimed: bigint;
  paused: boolean;
  cancelledAt: bigint | null;
  minCliffTime: bigint;
  instantRefunded: boolean;
}

export function campaignStateToDbPatch(state: VestingTreeState): Partial<typeof campaigns.$inferInsert> {
  return {
    merkleRoot: state.merkleRoot,
    leafCount: state.leafCount,
    totalClaimed: state.totalClaimed,
    paused: state.paused,
    cancelledAt: state.cancelledAt,
    minCliffTime: state.minCliffTime,
    instantRefunded: state.instantRefunded,
  };
}

function readPubkeyHex(data: Buffer, offset: number): { value: string; offset: number } | null {
  const end = offset + 32;
  if (end > data.length) return null;
  return { value: data.subarray(offset, end).toString("hex"), offset: end };
}

function readU64(data: Buffer, offset: number): { value: bigint; offset: number } | null {
  const end = offset + 8;
  if (end > data.length) return null;
  return { value: data.readBigUInt64LE(offset), offset: end };
}

function readI64(data: Buffer, offset: number): { value: bigint; offset: number } | null {
  const end = offset + 8;
  if (end > data.length) return null;
  return { value: data.readBigInt64LE(offset), offset: end };
}

function readU32(data: Buffer, offset: number): { value: number; offset: number } | null {
  const end = offset + 4;
  if (end > data.length) return null;
  return { value: data.readUInt32LE(offset), offset: end };
}

function readBool(data: Buffer, offset: number): { value: boolean; offset: number } | null {
  const end = offset + 1;
  if (end > data.length) return null;
  return { value: data.readUInt8(offset) !== 0, offset: end };
}

function readOptionPubkeyHex(
  data: Buffer,
  offset: number,
): { value: string | null; offset: number } | null {
  const flag = readBool(data, offset);
  if (!flag) return null;
  if (!flag.value) return { value: null, offset: flag.offset };
  const pk = readPubkeyHex(data, flag.offset);
  if (!pk) return null;
  return { value: pk.value, offset: pk.offset };
}

function readOptionI64(
  data: Buffer,
  offset: number,
): { value: bigint | null; offset: number } | null {
  const flag = readBool(data, offset);
  if (!flag) return null;
  if (!flag.value) return { value: null, offset: flag.offset };
  const v = readI64(data, flag.offset);
  if (!v) return null;
  return { value: v.value, offset: v.offset };
}

export function parseVestingTree(data: Buffer): VestingTreeState | null {
  // Need at least discriminator + fixed prefix through total_claimed
  // discriminator(8) + creator(32) + mint(32) + vault(32) + vault_auth(32)
  // + campaign_id(8) + merkle_root(32) + leaf_count(4) + total_supply(8)
  // + total_claimed(8) + cancellable(1)
  const MIN_PREFIX = 8 + 32 + 32 + 32 + 32 + 8 + 32 + 4 + 8 + 8 + 1;
  if (data.length < MIN_PREFIX) return null;

  let o = 0;
  o += 8; // discriminator
  const creator = readPubkeyHex(data, o); if (!creator) return null; o = creator.offset;
  const mint = readPubkeyHex(data, o); if (!mint) return null; o = mint.offset;
  const vault = readPubkeyHex(data, o); if (!vault) return null; o = vault.offset;
  const vaultAuth = readPubkeyHex(data, o); if (!vaultAuth) return null; o = vaultAuth.offset;
  const campaignId = readU64(data, o); if (!campaignId) return null; o = campaignId.offset;

  // merkle_root
  const rootEnd = o + 32;
  if (rootEnd > data.length) return null;
  const merkleRoot = data.subarray(o, rootEnd).toString("hex");
  o = rootEnd;

  const leafCountRes = readU32(data, o); if (!leafCountRes) return null; o = leafCountRes.offset;
  const totalSupply = readU64(data, o); if (!totalSupply) return null; o = totalSupply.offset;
  const totalClaimedRes = readU64(data, o); if (!totalClaimedRes) return null; o = totalClaimedRes.offset;
  const cancellable = readBool(data, o); if (!cancellable) return null; o = cancellable.offset;

  const cancelAuth = readOptionPubkeyHex(data, o); if (!cancelAuth) return null; o = cancelAuth.offset;
  const cancelledAtRes = readOptionI64(data, o); if (!cancelledAtRes) return null; o = cancelledAtRes.offset;
  const pausedRes = readBool(data, o); if (!pausedRes) return null; o = pausedRes.offset;
  const pauseAuth = readOptionPubkeyHex(data, o); if (!pauseAuth) return null; o = pauseAuth.offset;
  const createdAt = readI64(data, o); if (!createdAt) return null; o = createdAt.offset;

  // milestone flags
  const flagsEnd = o + 32;
  if (flagsEnd > data.length) return null;
  o = flagsEnd;

  // Legacy layouts ended with bump here. New layouts append:
  // min_cliff_time(i64) + instant_refunded(bool) + bump(u8)
  //
  // Defaults for legacy:
  let minCliffTime = 0n;
  let instantRefunded = false;

  // New layout present?
  if (o + 8 + 1 + 1 <= data.length) {
    const mct = readI64(data, o);
    const ir = readBool(data, mct ? mct.offset : o);
    if (mct && ir) {
      minCliffTime = mct.value;
      instantRefunded = ir.value;
    }
  }

  // bump exists in both layouts; we don't currently need it.

  return {
    merkleRoot,
    leafCount: leafCountRes.value,
    totalClaimed: totalClaimedRes.value,
    paused: pausedRes.value,
    cancelledAt: cancelledAtRes.value,
    minCliffTime,
    instantRefunded,
  };
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
      .set(campaignStateToDbPatch(state))
      .where(eq(campaigns.treeAddress, treeAddress));
  });
}
