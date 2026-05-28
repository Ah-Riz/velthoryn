import crypto from "crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  claimEvents,
  cancelEvents,
  pauseEvents,
  rootUpdateEvents,
  withdrawEvents,
  milestoneEvents,
  streamCancelEvents,
  instantRefundEvents,
} from "@/lib/db/schema";
import { PROGRAM_ID } from "@/lib/anchor/client";
import {
  parseClaimedEvent,
  extractAnchorEventData,
  CLAIMED_DISCRIMINATOR,
  getLastSyncedSlot,
  persistSyncCheckpoint,
} from "./claim-events";

// ---------------------------------------------------------------------------
// Discriminators — sha256("event:<EventName>")[0..8] (Anchor convention)
// ---------------------------------------------------------------------------

function makeDiscriminator(eventName: string): Buffer {
  return Buffer.from(
    crypto.createHash("sha256").update(`event:${eventName}`).digest().subarray(0, 8),
  );
}

export const DISCRIMINATORS = {
  CLAIMED: CLAIMED_DISCRIMINATOR,
  CAMPAIGN_CANCELLED: makeDiscriminator("CampaignCancelled"),
  INSTANT_REFUNDED: makeDiscriminator("InstantRefunded"),
  CAMPAIGN_PAUSED: makeDiscriminator("CampaignPaused"),
  CAMPAIGN_UNPAUSED: makeDiscriminator("CampaignUnpaused"),
  ROOT_UPDATED: makeDiscriminator("RootUpdated"),
  UNVESTED_WITHDRAWN: makeDiscriminator("UnvestedWithdrawn"),
  MILESTONE_RELEASED: makeDiscriminator("MilestoneReleased"),
  STREAM_CANCELLED: makeDiscriminator("StreamCancelled"),
  CAMPAIGN_CREATED: makeDiscriminator("CampaignCreated"),
  CAMPAIGN_FUNDED: makeDiscriminator("CampaignFunded"),
  CLAIM_RECORD_CLOSED: makeDiscriminator("ClaimRecordClosed"),
} as const;

// ---------------------------------------------------------------------------
// Typed event result types
// ---------------------------------------------------------------------------

export interface ParsedCampaignCancelled {
  type: "cancelled";
  tree: string;
  cancelledAt: bigint;
  claimedAtCancel: bigint;
}

export interface ParsedCampaignPaused {
  type: "paused";
  tree: string;
  paused: boolean;
}

export interface ParsedInstantRefunded {
  type: "instant_refunded";
  tree: string;
  cancelledAt: bigint;
  refundedTo: string;
  amount: bigint;
}

export interface ParsedRootUpdated {
  type: "root_updated";
  tree: string;
  oldRoot: string;
  newRoot: string;
  newLeafCount: number;
}

export interface ParsedUnvestedWithdrawn {
  type: "withdrawn";
  tree: string;
  amount: bigint;
}

export interface ParsedMilestoneReleased {
  type: "milestone_released";
  tree: string;
  milestoneIdx: number;
  releasedBy: string;
}

export interface ParsedStreamCancelled {
  type: "stream_cancelled";
  tree: string;
  cancelledAt: bigint;
  amountToBeneficiary: bigint;
  amountToCreator: bigint;
}

// ---------------------------------------------------------------------------
// Parser functions
// ---------------------------------------------------------------------------

export function parseCampaignCancelled(data: Buffer): ParsedCampaignCancelled | null {
  // discriminator(8) + tree(32) + cancelled_at(8) + claimed_at_cancel(8) = 56 bytes
  if (data.length < 56) return null;
  if (!data.subarray(0, 8).equals(DISCRIMINATORS.CAMPAIGN_CANCELLED)) return null;

  const tree = new PublicKey(data.subarray(8, 40)).toBase58();
  const cancelledAt = data.readBigInt64LE(40);
  const claimedAtCancel = data.readBigUInt64LE(48);

  return { type: "cancelled", tree, cancelledAt, claimedAtCancel };
}

export function parseCampaignPaused(data: Buffer): ParsedCampaignPaused | null {
  // discriminator(8) + tree(32) = 40 bytes
  if (data.length < 40) return null;

  const isPaused = data.subarray(0, 8).equals(DISCRIMINATORS.CAMPAIGN_PAUSED);
  const isUnpaused = data.subarray(0, 8).equals(DISCRIMINATORS.CAMPAIGN_UNPAUSED);
  if (!isPaused && !isUnpaused) return null;

  const tree = new PublicKey(data.subarray(8, 40)).toBase58();
  return { type: "paused", tree, paused: isPaused };
}

export function parseInstantRefunded(data: Buffer): ParsedInstantRefunded | null {
  // discriminator(8) + tree(32) + cancelled_at(8) + refunded_to(32) + amount(8) = 88 bytes
  if (data.length < 88) return null;
  if (!data.subarray(0, 8).equals(DISCRIMINATORS.INSTANT_REFUNDED)) return null;

  const tree = new PublicKey(data.subarray(8, 40)).toBase58();
  const cancelledAt = data.readBigInt64LE(40);
  const refundedTo = new PublicKey(data.subarray(48, 80)).toBase58();
  const amount = data.readBigUInt64LE(80);

  return { type: "instant_refunded", tree, cancelledAt, refundedTo, amount };
}

export function parseRootUpdated(data: Buffer): ParsedRootUpdated | null {
  // discriminator(8) + tree(32) + old_root(32) + new_root(32) + new_leaf_count(4) = 108 bytes
  if (data.length < 108) return null;
  if (!data.subarray(0, 8).equals(DISCRIMINATORS.ROOT_UPDATED)) return null;

  const tree = new PublicKey(data.subarray(8, 40)).toBase58();
  const oldRoot = Buffer.from(data.subarray(40, 72)).toString("hex");
  const newRoot = Buffer.from(data.subarray(72, 104)).toString("hex");
  const newLeafCount = data.readUInt32LE(104);

  return { type: "root_updated", tree, oldRoot, newRoot, newLeafCount };
}

export function parseUnvestedWithdrawn(data: Buffer): ParsedUnvestedWithdrawn | null {
  // discriminator(8) + tree(32) + amount(8) = 48 bytes
  if (data.length < 48) return null;
  if (!data.subarray(0, 8).equals(DISCRIMINATORS.UNVESTED_WITHDRAWN)) return null;

  const tree = new PublicKey(data.subarray(8, 40)).toBase58();
  const amount = data.readBigUInt64LE(40);

  return { type: "withdrawn", tree, amount };
}

export function parseMilestoneReleased(data: Buffer): ParsedMilestoneReleased | null {
  // discriminator(8) + tree(32) + milestone_idx(1) + released_by(32) = 73 bytes
  if (data.length < 73) return null;
  if (!data.subarray(0, 8).equals(DISCRIMINATORS.MILESTONE_RELEASED)) return null;

  const tree = new PublicKey(data.subarray(8, 40)).toBase58();
  const milestoneIdx = data.readUInt8(40);
  const releasedBy = new PublicKey(data.subarray(41, 73)).toBase58();

  return { type: "milestone_released", tree, milestoneIdx, releasedBy };
}

export function parseStreamCancelled(data: Buffer): ParsedStreamCancelled | null {
  // discriminator(8) + tree(32) + cancelled_at(8) + amount_to_beneficiary(8) + amount_to_creator(8) = 64 bytes
  if (data.length < 64) return null;
  if (!data.subarray(0, 8).equals(DISCRIMINATORS.STREAM_CANCELLED)) return null;

  const tree = new PublicKey(data.subarray(8, 40)).toBase58();
  const cancelledAt = data.readBigInt64LE(40);
  const amountToBeneficiary = data.readBigUInt64LE(48);
  const amountToCreator = data.readBigUInt64LE(56);

  return { type: "stream_cancelled", tree, cancelledAt, amountToBeneficiary, amountToCreator };
}

// ---------------------------------------------------------------------------
// Per-transaction event processing
// ---------------------------------------------------------------------------

interface EventCounts {
  claimed: number;
  cancelled: number;
  instant_refunded: number;
  paused: number;
  root_updated: number;
  withdrawn: number;
  milestone_released: number;
  stream_cancelled: number;
}

export async function indexEventBuffers(params: {
  eventBuffers: Buffer[];
  signature: string;
  slot: number;
  blockTime: bigint;
  campaignCache?: Map<string, number>;
  counts?: EventCounts;
}): Promise<void> {
  const {
    eventBuffers,
    signature,
    slot,
    blockTime,
    campaignCache = new Map<string, number>(),
    counts,
  } = params;

  for (const buf of eventBuffers) {
    if (buf.length < 8) continue;

    // --- Claimed ---
    if (buf.subarray(0, 8).equals(DISCRIMINATORS.CLAIMED)) {
      const event = parseClaimedEvent(buf);
      if (!event) continue;

      const campaignId = await resolveCampaignId(event.tree, campaignCache);
      if (campaignId === null) continue;

      await db.transaction(async (txDb) => {
        await txDb
          .insert(claimEvents)
          .values({
            campaignId,
            beneficiary: event.beneficiary,
            leafIndex: event.leafIndex,
            amount: BigInt(event.amount),
            totalClaimedByUser: BigInt(event.totalClaimedByUser),
            totalClaimedOverall: BigInt(event.totalClaimedOverall),
            milestoneIdx: event.milestoneIdx,
            signature,
            slot: BigInt(slot),
            blockTime,
          })
          .onConflictDoNothing();

        await txDb
          .update(campaigns)
          .set({
            totalClaimed: sql`GREATEST(${campaigns.totalClaimed}, ${event.totalClaimedOverall})`,
          })
          .where(eq(campaigns.id, campaignId));

        await persistSyncCheckpoint(txDb, slot);
      });
      counts && counts.claimed++;
      continue;
    }

    // --- CampaignCancelled ---
    if (buf.subarray(0, 8).equals(DISCRIMINATORS.CAMPAIGN_CANCELLED)) {
      const event = parseCampaignCancelled(buf);
      if (!event) continue;

      const campaignId = await resolveCampaignId(event.tree, campaignCache);
      if (campaignId === null) continue;

      await db.transaction(async (txDb) => {
        await txDb
          .insert(cancelEvents)
          .values({
            campaignId,
            cancelledAt: event.cancelledAt,
            claimedAtCancel: event.claimedAtCancel,
            signature,
            slot: BigInt(slot),
            blockTime,
          })
          .onConflictDoNothing();

        await txDb
          .update(campaigns)
          .set({ cancelledAt: event.cancelledAt })
          .where(eq(campaigns.id, campaignId));

        await persistSyncCheckpoint(txDb, slot);
      });
      counts && counts.cancelled++;
      continue;
    }

    // --- InstantRefunded ---
    if (buf.subarray(0, 8).equals(DISCRIMINATORS.INSTANT_REFUNDED)) {
      const event = parseInstantRefunded(buf);
      if (!event) continue;

      const campaignId = await resolveCampaignId(event.tree, campaignCache);
      if (campaignId === null) continue;

      await db.transaction(async (txDb) => {
        await txDb
          .insert(instantRefundEvents)
          .values({
            campaignId,
            cancelledAt: event.cancelledAt,
            refundedTo: event.refundedTo,
            amount: event.amount,
            signature,
            slot: BigInt(slot),
            blockTime,
          })
          .onConflictDoNothing();

        await txDb
          .update(campaigns)
          .set({ cancelledAt: event.cancelledAt, instantRefunded: true })
          .where(eq(campaigns.id, campaignId));

        await persistSyncCheckpoint(txDb, slot);
      });
      counts && counts.instant_refunded++;
      continue;
    }

    // --- CampaignPaused / CampaignUnpaused ---
    if (
      buf.subarray(0, 8).equals(DISCRIMINATORS.CAMPAIGN_PAUSED) ||
      buf.subarray(0, 8).equals(DISCRIMINATORS.CAMPAIGN_UNPAUSED)
    ) {
      const event = parseCampaignPaused(buf);
      if (!event) continue;

      const campaignId = await resolveCampaignId(event.tree, campaignCache);
      if (campaignId === null) continue;

      await db.transaction(async (txDb) => {
        await txDb
          .insert(pauseEvents)
          .values({
            campaignId,
            paused: event.paused,
            signature,
            slot: BigInt(slot),
            blockTime,
          })
          .onConflictDoNothing();

        await txDb
          .update(campaigns)
          .set({ paused: event.paused })
          .where(eq(campaigns.id, campaignId));

        await persistSyncCheckpoint(txDb, slot);
      });
      counts && counts.paused++;
      continue;
    }

    // --- RootUpdated ---
    if (buf.subarray(0, 8).equals(DISCRIMINATORS.ROOT_UPDATED)) {
      const event = parseRootUpdated(buf);
      if (!event) continue;

      const campaignId = await resolveCampaignId(event.tree, campaignCache);
      if (campaignId === null) continue;

      await db.transaction(async (txDb) => {
        await txDb
          .insert(rootUpdateEvents)
          .values({
            campaignId,
            oldRoot: event.oldRoot,
            newRoot: event.newRoot,
            newLeafCount: event.newLeafCount,
            signature,
            slot: BigInt(slot),
            blockTime,
          })
          .onConflictDoNothing();

        await txDb
          .update(campaigns)
          .set({ merkleRoot: event.newRoot, leafCount: event.newLeafCount })
          .where(eq(campaigns.id, campaignId));

        await persistSyncCheckpoint(txDb, slot);
      });
      counts && counts.root_updated++;
      continue;
    }

    // --- UnvestedWithdrawn ---
    if (buf.subarray(0, 8).equals(DISCRIMINATORS.UNVESTED_WITHDRAWN)) {
      const event = parseUnvestedWithdrawn(buf);
      if (!event) continue;

      const campaignId = await resolveCampaignId(event.tree, campaignCache);
      if (campaignId === null) continue;

      await db.transaction(async (txDb) => {
        await txDb
          .insert(withdrawEvents)
          .values({
            campaignId,
            amount: event.amount,
            signature,
            slot: BigInt(slot),
            blockTime,
          })
          .onConflictDoNothing();

        await persistSyncCheckpoint(txDb, slot);
      });
      counts && counts.withdrawn++;
      continue;
    }

    // --- MilestoneReleased ---
    if (buf.subarray(0, 8).equals(DISCRIMINATORS.MILESTONE_RELEASED)) {
      const event = parseMilestoneReleased(buf);
      if (!event) continue;

      const campaignId = await resolveCampaignId(event.tree, campaignCache);
      if (campaignId === null) continue;

      await db.transaction(async (txDb) => {
        await txDb
          .insert(milestoneEvents)
          .values({
            campaignId,
            milestoneIdx: event.milestoneIdx,
            releasedBy: event.releasedBy,
            signature,
            slot: BigInt(slot),
            blockTime,
          })
          .onConflictDoNothing();

        await persistSyncCheckpoint(txDb, slot);
      });
      counts && counts.milestone_released++;
      continue;
    }

    // --- StreamCancelled ---
    if (buf.subarray(0, 8).equals(DISCRIMINATORS.STREAM_CANCELLED)) {
      const event = parseStreamCancelled(buf);
      if (!event) continue;

      const campaignId = await resolveCampaignId(event.tree, campaignCache);
      if (campaignId === null) continue;

      await db.transaction(async (txDb) => {
        await txDb
          .insert(streamCancelEvents)
          .values({
            campaignId,
            cancelledAt: event.cancelledAt,
            amountToBeneficiary: event.amountToBeneficiary,
            amountToCreator: event.amountToCreator,
            signature,
            slot: BigInt(slot),
            blockTime,
          })
          .onConflictDoNothing();

        await persistSyncCheckpoint(txDb, slot);
      });
      counts && counts.stream_cancelled++;
      continue;
    }
    // Unknown discriminators are silently skipped
  }
}

async function processTransaction(params: {
  connection: Connection;
  signature: string;
  slot: number;
  campaignCache: Map<string, number>;
  counts: EventCounts;
}): Promise<void> {
  const { connection, signature, slot, campaignCache, counts } = params;

  const tx = await connection.getTransaction(signature, {
    maxSupportedTransactionVersion: 0,
  });
  if (!tx?.meta?.logMessages) return;

  const blockTime = BigInt(tx.blockTime ?? Math.floor(Date.now() / 1000));
  const eventBuffers = extractAnchorEventData(tx.meta.logMessages);
  await indexEventBuffers({ eventBuffers, signature, slot, blockTime, campaignCache, counts });
}

async function resolveCampaignId(
  treeAddress: string,
  cache: Map<string, number>,
): Promise<number | null> {
  const cached = cache.get(treeAddress);
  if (cached !== undefined) return cached;

  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.treeAddress, treeAddress))
    .limit(1);

  if (!campaign) return null;
  cache.set(treeAddress, campaign.id);
  return campaign.id;
}

// ---------------------------------------------------------------------------
// Main indexer: indexAllEvents()
// ---------------------------------------------------------------------------

export interface IndexAllEventsResult {
  processed: number;
  lastSlot: number;
  byType: Record<string, number>;
}

export async function indexAllEvents(fromSlot?: number): Promise<IndexAllEventsResult> {
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_ENDPOINT;
  if (!rpcUrl) throw new Error("NEXT_PUBLIC_RPC_ENDPOINT is not set");

  const startSlot = fromSlot !== undefined ? fromSlot : await getLastSyncedSlot();
  const connection = new Connection(rpcUrl, "confirmed");

  const counts: EventCounts = {
    claimed: 0,
    cancelled: 0,
    instant_refunded: 0,
    paused: 0,
    root_updated: 0,
    withdrawn: 0,
    milestone_released: 0,
    stream_cancelled: 0,
  };

  let lastSlot = startSlot;
  let before: string | undefined = undefined;
  const campaignCache = new Map<string, number>();

  let pageSignatures: Awaited<ReturnType<typeof connection.getSignaturesForAddress>>;

  do {
    pageSignatures = await connection.getSignaturesForAddress(PROGRAM_ID, {
      limit: 1000,
      before,
    });

    if (pageSignatures.length === 0) break;

    const validSigs = pageSignatures.filter((s) => !(startSlot && s.slot <= startSlot));
    if (validSigs.length === 0) break;

    for (const sig of validSigs) {
      await processTransaction({
        connection,
        signature: sig.signature,
        slot: sig.slot,
        campaignCache,
        counts,
      });
      if (sig.slot > lastSlot) lastSlot = sig.slot;
    }

    // Track the highest slot seen even for transactions with no indexable events
    if (validSigs[0]?.slot > lastSlot) lastSlot = validSigs[0].slot;
    if (validSigs[validSigs.length - 1]?.slot > lastSlot) {
      lastSlot = validSigs[validSigs.length - 1]!.slot;
    }

    before = pageSignatures[pageSignatures.length - 1]!.signature;
  } while (pageSignatures.length === 1000);

  const processed =
    counts.claimed +
    counts.cancelled +
    counts.instant_refunded +
    counts.paused +
    counts.root_updated +
    counts.withdrawn +
    counts.milestone_released +
    counts.stream_cancelled;

  return {
    processed,
    lastSlot,
    byType: { ...counts },
  };
}
