import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { Keypair } from "@solana/web3.js";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/campaigns/[treeAddress]/timeline/route";
import { resetDb } from "../helpers/db";
import {
  seedClaimEvent,
  seedCancelEvent,
  seedPauseEvent,
  seedMilestoneEvent,
  seedWithdrawEvent,
  seedRootUpdateEvent,
  seedStreamCancelEvent,
} from "../helpers/fixtures";
import { makeUrl } from "../helpers/requests";
import { resetRateLimitForTests } from "@/lib/api/rate-limit";
import { resetRedisForTests } from "@/lib/api/redis";
import { ensureEventTables } from "../helpers/ensure-tables";
import { db } from "@/lib/db";
import { campaigns, rootVersions, leaves } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a unique signature to avoid collisions when resetDb is skipped. */
let sigCounter = 0;
function uniqueSig(prefix: string): string {
  return `${prefix}_${Date.now()}_${sigCounter++}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Directly insert a campaign + root_version + leaf into the DB.
 * This avoids the Supabase pooler FK visibility issue that occurs when
 * the POST route handler and subsequent inserts go through different connections.
 */
async function seedCampaign(overrides: Record<string, unknown> = {}): Promise<{
  treeAddress: string;
  campaignId: number;
}> {
  const treeAddress = (overrides.treeAddress as string) ?? Keypair.generate().publicKey.toBase58();
  const now = BigInt(Math.floor(Date.now() / 1000));

  const [insertedCampaign] = await db.insert(campaigns).values({
    treeAddress,
    creator: "11111111111111111111111111111112",
    mint: "11111111111111111111111111111114",
    campaignId: BigInt(Math.floor(Math.random() * 9_000_000_000_000) + 1_000_000_000_000),
    merkleRoot: "a".repeat(64),
    leafCount: 1,
    totalSupply: BigInt(1000000),
    totalClaimed: BigInt(0),
    cancellable: false,
    paused: false,
    createdAt: now,
  }).returning({ id: campaigns.id });

  const campaignId = insertedCampaign!.id;

  const [insertedRoot] = await db.insert(rootVersions).values({
    campaignId,
    merkleRoot: "a".repeat(64),
    leafCount: 1,
    version: 1,
    createdAt: now,
  }).returning({ id: rootVersions.id });

  await db.insert(leaves).values({
    rootVersionId: insertedRoot!.id,
    leafIndex: 0,
    beneficiary: "11111111111111111111111111111111",
    amount: BigInt(1000000),
    releaseType: 1,
    startTime: BigInt(1700000000),
    cliffTime: BigInt(1700000000),
    endTime: BigInt(1731536000),
    milestoneIdx: 0,
    proof: [[]],
  });

  return { treeAddress, campaignId };
}

function makeTimelineRequest(
  treeAddress: string,
  params?: Record<string, string>,
): NextRequest {
  return new NextRequest(makeUrl(`/api/campaigns/${treeAddress}/timeline`, params));
}

function makeContext(treeAddress: string) {
  return { params: Promise.resolve({ treeAddress }) };
}

// ---------------------------------------------------------------------------
// Setup: ensure tables exist + reset between tests
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await ensureEventTables();
});

beforeEach(async () => {
  resetRedisForTests();
  resetRateLimitForTests();
  await resetDb();
});

// ===========================================================================
// GET /api/campaigns/:treeAddress/timeline
// ===========================================================================

describe("GET /api/campaigns/:treeAddress/timeline", () => {
  it("returns empty events array for valid campaign with no events (200)", async () => {
    const { treeAddress } = await seedCampaign();

    const req = makeTimelineRequest(treeAddress);
    const res = await GET(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as {
      events: unknown[];
      total: number;
      campaign: string;
    };

    expect(res.status).toBe(200);
    expect(json.events).toEqual([]);
    expect(json.total).toBe(0);
    expect(json.campaign).toBe(treeAddress);
  });

  it("returns events from claim_events table ordered by block_time DESC (200)", async () => {
    const { treeAddress, campaignId } = await seedCampaign();

    // Seed two claim events with different block times
    await seedClaimEvent(campaignId, {
      beneficiary: "11111111111111111111111111111111",
      amount: 100000,
      blockTime: 1700010000,
      signature: uniqueSig("claim"),
    });
    await seedClaimEvent(campaignId, {
      beneficiary: "11111111111111111111111111111111",
      amount: 200000,
      blockTime: 1700030000,
      signature: uniqueSig("claim"),
    });

    const req = makeTimelineRequest(treeAddress);
    const res = await GET(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as {
      events: Array<{ type: string; blockTime: string; signature: string }>;
      total: number;
    };

    expect(res.status).toBe(200);
    expect(json.total).toBe(2);
    expect(json.events).toHaveLength(2);
    // Ordered DESC by block_time
    expect(json.events[0]!.blockTime).toBe("1700030000");
    expect(json.events[1]!.blockTime).toBe("1700010000");
    expect(json.events[0]!.type).toBe("claimed");
    expect(json.events[1]!.type).toBe("claimed");
  });

  it("returns events from multiple event tables in correct order (200)", async () => {
    const { treeAddress, campaignId } = await seedCampaign();

    // Seed events from different tables with distinct block times
    await seedClaimEvent(campaignId, { blockTime: 1700010000, signature: uniqueSig("claim") });
    await seedPauseEvent(campaignId, { blockTime: 1700020000, signature: uniqueSig("pause") });
    await seedRootUpdateEvent(campaignId, { blockTime: 1700030000, signature: uniqueSig("root") });
    await seedWithdrawEvent(campaignId, { blockTime: 1700040000, signature: uniqueSig("withdraw") });
    await seedCancelEvent(campaignId, { blockTime: 1700050000, signature: uniqueSig("cancel") });
    await seedMilestoneEvent(campaignId, { blockTime: 1700060000, signature: uniqueSig("milestone") });
    await seedStreamCancelEvent(campaignId, { blockTime: 1700070000, signature: uniqueSig("stream") });

    const req = makeTimelineRequest(treeAddress);
    const res = await GET(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as {
      events: Array<{ type: string; blockTime: string }>;
      total: number;
    };

    expect(res.status).toBe(200);
    expect(json.total).toBe(7);
    expect(json.events).toHaveLength(7);

    // Verify DESC order by block_time
    const types = json.events.map((e) => e.type);
    expect(types).toEqual([
      "stream_cancelled",
      "milestone_released",
      "cancelled",
      "withdrawn",
      "root_updated",
      "paused",
      "claimed",
    ]);
  });

  it("fromBlockTime query param filters correctly (200)", async () => {
    const { treeAddress, campaignId } = await seedCampaign();

    await seedClaimEvent(campaignId, { blockTime: 1700010000, signature: uniqueSig("early") });
    await seedClaimEvent(campaignId, { blockTime: 1700020000, signature: uniqueSig("mid") });
    await seedClaimEvent(campaignId, { blockTime: 1700030000, signature: uniqueSig("late") });

    // Only events with block_time >= 1700020000
    const req = makeTimelineRequest(treeAddress, { fromBlockTime: "1700020000" });
    const res = await GET(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as {
      events: Array<{ blockTime: string }>;
      total: number;
    };

    expect(res.status).toBe(200);
    expect(json.events).toHaveLength(2);
    for (const e of json.events) {
      expect(Number(e.blockTime)).toBeGreaterThanOrEqual(1700020000);
    }
  });

  it("toBlockTime query param filters correctly (200)", async () => {
    const { treeAddress, campaignId } = await seedCampaign();

    await seedClaimEvent(campaignId, { blockTime: 1700010000, signature: uniqueSig("early") });
    await seedClaimEvent(campaignId, { blockTime: 1700020000, signature: uniqueSig("mid") });
    await seedClaimEvent(campaignId, { blockTime: 1700030000, signature: uniqueSig("late") });

    // Only events with block_time <= 1700020000
    const req = makeTimelineRequest(treeAddress, { toBlockTime: "1700020000" });
    const res = await GET(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as {
      events: Array<{ blockTime: string }>;
      total: number;
    };

    expect(res.status).toBe(200);
    expect(json.events).toHaveLength(2);
    for (const e of json.events) {
      expect(Number(e.blockTime)).toBeLessThanOrEqual(1700020000);
    }
  });

  it("returns 400 VALIDATION_ERROR when fromBlockTime is non-numeric string", async () => {
    const { treeAddress } = await seedCampaign();

    const req = makeTimelineRequest(treeAddress, { fromBlockTime: "not-a-number" });
    const res = await GET(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as { code: string };

    expect(res.status).toBe(400);
    expect(json.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for nonexistent campaign treeAddress", async () => {
    const fakeAddress = "NonExistent1111111111111111111111111111111";

    const req = makeTimelineRequest(fakeAddress);
    const res = await GET(req, makeContext(fakeAddress) as never);
    const json = (await res.json()) as { code: string };

    expect(res.status).toBe(404);
    expect(json.code).toBe("NOT_FOUND");
  });

  it("respects limit query param for pagination", async () => {
    const { treeAddress, campaignId } = await seedCampaign();

    // Seed 5 claim events
    for (let i = 0; i < 5; i++) {
      await seedClaimEvent(campaignId, {
        blockTime: 1700010000 + i * 1000,
        signature: uniqueSig(`lim${i}`),
      });
    }

    // Request with limit=2
    const req = makeTimelineRequest(treeAddress, { limit: "2" });
    const res = await GET(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as {
      events: Array<{ blockTime: string }>;
      total: number;
    };

    expect(res.status).toBe(200);
    // total reflects ALL matching events, events is capped by limit
    expect(json.total).toBe(5);
    expect(json.events).toHaveLength(2);
    // Should be the two latest events (DESC order): 1700014000 and 1700013000
    expect(json.events[0]!.blockTime).toBe("1700014000");
    expect(json.events[1]!.blockTime).toBe("1700013000");
  });
});
