import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { Keypair } from "@solana/web3.js";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { campaigns, instantRefundEvents } from "@/lib/db/schema";
import { ensureEventTables } from "../helpers/ensure-tables";
import { resetDb } from "../helpers/db";
import { DISCRIMINATORS, indexEventBuffers } from "@/lib/indexer/event-indexer";

function randPk58(): string {
  return Keypair.generate().publicKey.toBase58();
}

function buildInstantRefundedBuffer(params: {
  tree: Buffer;
  cancelledAt: bigint;
  refundedTo: Buffer;
  amount: bigint;
}): Buffer {
  const { tree, cancelledAt, refundedTo, amount } = params;
  const buf = Buffer.alloc(88);
  DISCRIMINATORS.INSTANT_REFUNDED.copy(buf, 0);
  tree.copy(buf, 8);
  buf.writeBigInt64LE(cancelledAt, 40);
  refundedTo.copy(buf, 48);
  buf.writeBigUInt64LE(amount, 80);
  return buf;
}

describe("event-indexer: InstantRefunded ingestion", () => {
  beforeAll(async () => {
    await ensureEventTables();
  });

  beforeEach(async () => {
    await resetDb();
  });

  it("persists instant_refund_events row and updates campaigns.instant_refunded + cancelled_at", async () => {
    // Most dangerous bug: event parses but is silently dropped (no persistence),
    // or campaign cancellation mode is not updated deterministically.
    const treeKp = Keypair.generate();
    const treeAddress = treeKp.publicKey.toBase58();
    const campaignRow = await db
      .insert(campaigns)
      .values({
        treeAddress,
        creator: randPk58(),
        mint: randPk58(),
        campaignId: 123n,
        merkleRoot: "00".repeat(32),
        leafCount: 2,
        totalSupply: 999n,
        totalClaimed: 0n,
        cancellable: true,
        createdAt: 1690000000n,
      })
      .returning({ id: campaigns.id });

    const campaignId = campaignRow[0]!.id;
    const cancelledAt = 1700005001n;
    const refundedTo = Buffer.from(Keypair.generate().publicKey.toBytes());
    const amount = 123456789n;

    const buf = buildInstantRefundedBuffer({
      tree: Buffer.from(treeKp.publicKey.toBytes()),
      cancelledAt,
      refundedTo,
      amount,
    });

    await indexEventBuffers({
      eventBuffers: [buf],
      signature: "sig_instant_refund_1",
      slot: 42,
      blockTime: 1700006000n,
    });

    const [updated] = await db
      .select({
        cancelledAt: campaigns.cancelledAt,
        instantRefunded: campaigns.instantRefunded,
      })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    expect(updated).toBeTruthy();
    expect(updated!.instantRefunded).toBe(true);
    expect(updated!.cancelledAt).toBe(cancelledAt);

    const rows = await db
      .select({
        campaignId: instantRefundEvents.campaignId,
        cancelledAt: instantRefundEvents.cancelledAt,
        refundedTo: instantRefundEvents.refundedTo,
        amount: instantRefundEvents.amount,
      })
      .from(instantRefundEvents)
      .where(eq(instantRefundEvents.campaignId, campaignId));

    expect(rows.length).toBe(1);
    expect(rows[0]!.cancelledAt).toBe(cancelledAt);
    expect(rows[0]!.amount).toBe(amount);
  });
});

