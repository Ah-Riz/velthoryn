import crypto from "crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, claimEvents } from "@/lib/db/schema";
import { PROGRAM_ID } from "@/lib/anchor/client";

export const CLAIMED_DISCRIMINATOR = Buffer.from(
  crypto.createHash("sha256").update("global:claimed").digest().subarray(0, 8),
);

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

export async function syncClaimEvents(
  fromSlot?: number,
): Promise<{ processed: number; lastSlot: number }> {
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_ENDPOINT;
  if (!rpcUrl) throw new Error("NEXT_PUBLIC_RPC_ENDPOINT is not set");

  const connection = new Connection(rpcUrl, "confirmed");
  let processed = 0;
  let lastSlot = fromSlot ?? 0;
  let before: string | undefined = undefined;
  const campaignCache = new Map<string, number>();

  let pageSignatures: Awaited<ReturnType<typeof connection.getSignaturesForAddress>>;

  do {
    pageSignatures = await connection.getSignaturesForAddress(PROGRAM_ID, {
      limit: 1000,
      before,
    });

    if (pageSignatures.length === 0) break;

    // Filter out signatures at or before fromSlot
    const validSigs = pageSignatures.filter((s) => !(fromSlot && s.slot <= fromSlot));
    if (validSigs.length === 0) break;

    // Batch-fetch transactions in chunks of 100
    for (let i = 0; i < validSigs.length; i += 100) {
      const batch = validSigs.slice(i, i + 100);
      const txs = await connection.getTransactions(
        batch.map((s) => s.signature),
        { maxSupportedTransactionVersion: 0 },
      );

      for (let j = 0; j < txs.length; j++) {
        const tx = txs[j];
        const { signature, slot } = batch[j];
        if (!tx?.meta?.logMessages) continue;

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

          await db.insert(claimEvents).values({
            campaignId,
            beneficiary: event.beneficiary,
            leafIndex: event.leafIndex,
            amount: BigInt(event.amount),
            totalClaimedByUser: BigInt(event.totalClaimedByUser),
            totalClaimedOverall: BigInt(event.totalClaimedOverall),
            milestoneIdx: event.milestoneIdx,
            signature,
            slot: BigInt(slot),
            blockTime: BigInt(tx.blockTime ?? Math.floor(Date.now() / 1000)),
          }).onConflictDoNothing();

          await db
            .update(campaigns)
            .set({
              totalClaimed: sql`GREATEST(${campaigns.totalClaimed}, ${event.totalClaimedOverall})`,
            })
            .where(eq(campaigns.id, campaignId));

          processed++;
        }

        if (slot > lastSlot) lastSlot = slot;
      }
    }

    // Set before to oldest signature for next page
    before = pageSignatures[pageSignatures.length - 1].signature;
  } while (pageSignatures.length === 1000);

  return { processed, lastSlot };
}
