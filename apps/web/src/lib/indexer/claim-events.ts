import crypto from "crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, claimEvents, syncState } from "@/lib/db/schema";
import { PROGRAM_ID } from "@/lib/anchor/client";

export const CLAIMED_DISCRIMINATOR = Buffer.from(
  crypto.createHash("sha256").update("event:Claimed").digest().subarray(0, 8),
);

const LAST_SYNCED_SLOT_KEY = "last_synced_slot";
const LAST_SYNC_TIMESTAMP_KEY = "last_sync_timestamp";

interface ParsedClaimedEvent {
  tree: string;
  beneficiary: string;
  leafIndex: number;
  amount: string;
  totalClaimedByUser: string;
  totalClaimedOverall: string;
  milestoneIdx: number | null;
}

export function parseClaimedEvent(data: Buffer): ParsedClaimedEvent | null {
  if (data.length < 100) return null;

  if (!data.subarray(0, 8).equals(CLAIMED_DISCRIMINATOR)) return null;

  const tree = new PublicKey(data.subarray(8, 40)).toBase58();
  const beneficiary = new PublicKey(data.subarray(40, 72)).toBase58();
  const leafIndex = data.readUInt32LE(72);
  const amount = data.readBigUInt64LE(76).toString();
  const totalClaimedByUser = data.readBigUInt64LE(84).toString();
  const totalClaimedOverall = data.readBigUInt64LE(92).toString();

  let milestoneIdx: number | null = null;
  if (data.length >= 101) {
    const optionFlag = data.readUInt8(100);
    if (optionFlag === 1 && data.length >= 102) {
      milestoneIdx = data.readUInt8(101);
    }
  }

  return {
    tree,
    beneficiary,
    leafIndex,
    amount,
    totalClaimedByUser,
    totalClaimedOverall,
    milestoneIdx,
  };
}

export function extractAnchorEventData(logs: string[]): Buffer[] {
  const events: Buffer[] = [];
  for (const line of logs) {
    const prefix = "Program data: ";
    const idx = line.indexOf(prefix);
    if (idx === -1) continue;

    const base64 = line.slice(idx + prefix.length).trim();
    try {
      events.push(Buffer.from(base64, "base64"));
    } catch {
      // skip malformed base64
    }
  }
  return events;
}

export async function getLastSyncedSlot(): Promise<number> {
  const [row] = await db
    .select({ value: syncState.value })
    .from(syncState)
    .where(eq(syncState.key, LAST_SYNCED_SLOT_KEY))
    .limit(1);

  if (!row) return 0;
  const parsed = Number(row.value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function persistSyncCheckpoint(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  slot: number,
): Promise<void> {
  const now = BigInt(Math.floor(Date.now() / 1000));

  await tx
    .insert(syncState)
    .values({
      key: LAST_SYNCED_SLOT_KEY,
      value: String(slot),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: syncState.key,
      set: {
        value: String(slot),
        updatedAt: now,
      },
    });

  await tx
    .insert(syncState)
    .values({
      key: LAST_SYNC_TIMESTAMP_KEY,
      value: String(now),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: syncState.key,
      set: {
        value: String(now),
        updatedAt: now,
      },
    });
}

export async function syncClaimEvents(
  fromSlot?: number,
): Promise<{ processed: number; lastSlot: number }> {
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_ENDPOINT;
  if (!rpcUrl) throw new Error("NEXT_PUBLIC_RPC_ENDPOINT is not set");

  const startSlot =
    fromSlot !== undefined ? fromSlot : await getLastSyncedSlot();

  const connection = new Connection(rpcUrl, "confirmed");
  return syncClaimEventsWithConnection(connection, startSlot);
}

async function processTransactions(params: {
  connection: Connection;
  signatures: Array<{ signature: string; slot: number }>;
}): Promise<{ processed: number; lastSlot: number }> {
  const { connection, signatures } = params;
  let processed = 0;
  let lastSlot = 0;
  const campaignCache = new Map<string, number>();

  for (const { signature, slot } of signatures) {
    const tx = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });
    if (!tx?.meta?.logMessages) continue;
    const txSlot = slot > 0 ? slot : tx.slot;

    const eventBuffers = extractAnchorEventData(tx.meta.logMessages);
    const claimedEvents = eventBuffers
      .map((buf) => parseClaimedEvent(buf))
      .filter((e): e is ParsedClaimedEvent => e !== null);

    for (const event of claimedEvents) {
      let campaignId = campaignCache.get(event.tree);
      if (campaignId === undefined) {
        const [campaign] = await db
          .select({ id: campaigns.id })
          .from(campaigns)
          .where(eq(campaigns.treeAddress, event.tree))
          .limit(1);
        if (!campaign) continue;
        campaignCache.set(event.tree, campaign.id);
        campaignId = campaign.id;
      }

      await db.transaction(async (txDb) => {
        await txDb.insert(claimEvents).values({
          campaignId,
          beneficiary: event.beneficiary,
          leafIndex: event.leafIndex,
          amount: BigInt(event.amount),
          totalClaimedByUser: BigInt(event.totalClaimedByUser),
          totalClaimedOverall: BigInt(event.totalClaimedOverall),
          milestoneIdx: event.milestoneIdx,
          signature,
          slot: BigInt(txSlot),
          blockTime: BigInt(tx.blockTime ?? Math.floor(Date.now() / 1000)),
        }).onConflictDoNothing();

        await txDb
          .update(campaigns)
          .set({
            totalClaimed: sql`GREATEST(${campaigns.totalClaimed}, ${event.totalClaimedOverall})`,
          })
          .where(eq(campaigns.id, campaignId));

        await persistSyncCheckpoint(txDb, txSlot);
      });

      processed++;
      if (txSlot > lastSlot) lastSlot = txSlot;
    }
  }

  return { processed, lastSlot };
}

async function syncClaimEventsWithConnection(
  connection: Connection,
  fromSlot?: number,
): Promise<{ processed: number; lastSlot: number }> {
  let processed = 0;
  let lastSlot = fromSlot ?? 0;
  let before: string | undefined = undefined;

  let pageSignatures: Awaited<ReturnType<typeof connection.getSignaturesForAddress>>;

  do {
    pageSignatures = await connection.getSignaturesForAddress(PROGRAM_ID, {
      limit: 1000,
      before,
    });

    if (pageSignatures.length === 0) break;

    const validSigs = pageSignatures.filter((s) => !(fromSlot && s.slot <= fromSlot));
    if (validSigs.length === 0) break;

    const pageResult = await processTransactions({
      connection,
      signatures: validSigs.map((sig) => ({
        signature: sig.signature,
        slot: sig.slot,
      })),
    });
    processed += pageResult.processed;
    if (pageResult.lastSlot > lastSlot) lastSlot = pageResult.lastSlot;
    if (validSigs[0]?.slot > lastSlot) lastSlot = validSigs[0].slot;
    if (validSigs[validSigs.length - 1]?.slot > lastSlot) {
      lastSlot = validSigs[validSigs.length - 1].slot;
    }

    before = pageSignatures[pageSignatures.length - 1].signature;
  } while (pageSignatures.length === 1000);

  return { processed, lastSlot };
}

export async function syncClaimEventsForSignatures(
  signatures: string[],
): Promise<{ processed: number; lastSlot: number }> {
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_ENDPOINT;
  if (!rpcUrl) throw new Error("NEXT_PUBLIC_RPC_ENDPOINT is not set");

  const uniqueSignatures = [...new Set(signatures.filter(Boolean))];
  if (uniqueSignatures.length === 0) {
    return { processed: 0, lastSlot: 0 };
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const statuses = await connection.getSignatureStatuses(uniqueSignatures, {
    searchTransactionHistory: true,
  });

  const batch = uniqueSignatures
    .map((signature, index) => ({
      signature,
      slot: statuses.value[index]?.slot ?? 0,
    }))

  return processTransactions({ connection, signatures: batch });
}
