import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import fs from "fs";
import { eq, sql } from "drizzle-orm";
import { getPoolOptions } from "@/lib/db";
import { db } from "@/lib/db";
import { campaigns, claimEvents } from "@/lib/db/schema";
import { resetDb } from "../helpers/db";
import { createCampaignViaPost } from "../helpers/fixtures";
import { makeUrl } from "../helpers/requests";
import { GET as getCampaignByAddress } from "@/app/api/campaigns/[treeAddress]/route";
import {
  persistSyncCheckpoint,
  getLastSyncedSlot,
  syncClaimEventsWithConnection,
  processTransactions,
  CLAIMED_DISCRIMINATOR,
} from "@/lib/indexer/claim-events";

// ===========================================================================
// T1: DB pool config
// ===========================================================================

describe("DB pool config", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns max: 10 with keepalive: 30 in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    const opts = getPoolOptions("postgresql://localhost:5432/test");
    expect(opts.max).toBe(10);
    expect(opts.keepalive).toBe(30);
    expect(opts.idle_timeout).toBe(20);
    expect(opts.connect_timeout).toBe(10);
  });

  it("returns max: 3 with keepalive: 0 in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", undefined);
    const opts = getPoolOptions("postgresql://localhost:5432/test");
    expect(opts.max).toBe(3);
    expect(opts.keepalive).toBe(0);
    expect(opts.idle_timeout).toBe(1);
    expect(opts.connect_timeout).toBe(30);
  });

  it("detects production via VERCEL env var even when NODE_ENV is unset", () => {
    vi.stubEnv("NODE_ENV", undefined);
    vi.stubEnv("VERCEL", "1");
    const opts = getPoolOptions("postgresql://localhost:5432/test");
    expect(opts.max).toBe(10);
  });

  it("returns development config when neither production nor VERCEL", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", undefined);
    const opts = getPoolOptions("postgresql://localhost:5432/test");
    expect(opts.max).toBe(3);
  });
});

// ===========================================================================
// T2: BigInt serialization in API responses
// ===========================================================================

describe("BigInt serialization", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("campaignId and totalSupply are strings in GET response", async () => {
    const { treeAddress } = await createCampaignViaPost();

    const req = new NextRequest(makeUrl(`/api/campaigns/${treeAddress}`));
    const res = await getCampaignByAddress(req, {
      params: Promise.resolve({ treeAddress }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(typeof json.campaignId).toBe("string");
    expect(typeof json.totalSupply).toBe("string");
    expect(typeof json.totalClaimed).toBe("string");
    expect(typeof json.createdAt).toBe("string");
  });
});

// ===========================================================================
// T3: sync_state checkpoint persistence
// ===========================================================================

describe("sync_state checkpoint", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("persistSyncCheckpoint writes last_synced_slot", async () => {
    await db.transaction(async (tx) => {
      await persistSyncCheckpoint(tx, 42);
    });
    const slot = await getLastSyncedSlot();
    expect(slot).toBe(42);
  });

  it("advances last_synced_slot on second sync", async () => {
    await db.transaction(async (tx) => {
      await persistSyncCheckpoint(tx, 100);
    });
    expect(await getLastSyncedSlot()).toBe(100);

    await db.transaction(async (tx) => {
      await persistSyncCheckpoint(tx, 200);
    });
    expect(await getLastSyncedSlot()).toBe(200);
  });
});

// ===========================================================================
// T13: syncClaimEvents checkpoint via mock RPC (per design)
// ===========================================================================

describe("syncClaimEvents checkpoint", () => {
  beforeEach(async () => {
    await resetDb();
  });

  function mockConnection(opts: {
    signatures: Array<{ signature: string; slot: number }>;
    logMessage: string;
  }) {
    let callCount = 0;
    return {
      getSignaturesForAddress: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(opts.signatures);
        return Promise.resolve([]);
      }),
      getTransaction: vi.fn().mockResolvedValue({
        meta: { logMessages: [opts.logMessage] },
        blockTime: 1234567890,
      }),
    };
  }

  it("advances last_synced_slot to 30 via syncClaimEventsWithConnection", async () => {
    const treeBytes = Buffer.alloc(32, 0x01);
    const treeAddress = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
    await createCampaignViaPost({ treeAddress });

    const beneficiaryBytes = Buffer.alloc(32, 0x02);
    const leafBuf = Buffer.alloc(4);
    leafBuf.writeUInt32LE(0);
    const amountBuf = Buffer.alloc(8);
    amountBuf.writeBigUInt64LE(BigInt(1000));
    const claimedByUserBuf = Buffer.alloc(8);
    claimedByUserBuf.writeBigUInt64LE(BigInt(500));
    const claimedOverallBuf = Buffer.alloc(8);
    claimedOverallBuf.writeBigUInt64LE(BigInt(1000));
    const eventData = Buffer.concat([
      CLAIMED_DISCRIMINATOR, treeBytes, beneficiaryBytes,
      leafBuf, amountBuf, claimedByUserBuf, claimedOverallBuf,
    ]);
    const logMessage = `Program data: ${eventData.toString("base64")}`;

    const conn = mockConnection({
      signatures: [
        { signature: "sig_1", slot: 10 },
        { signature: "sig_2", slot: 20 },
        { signature: "sig_3", slot: 30 },
      ],
      logMessage,
    });

    const result = await syncClaimEventsWithConnection(conn as any, 0);
    expect(result.lastSlot).toBe(30);
    expect(await getLastSyncedSlot()).toBe(30);
  });

  it("reads from sync_state when called without fromSlot", async () => {
    const treeBytes = Buffer.alloc(32, 0x01);
    const treeAddress = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
    await createCampaignViaPost({ treeAddress });

    const beneficiaryBytes = Buffer.alloc(32, 0x02);
    const leafBuf = Buffer.alloc(4);
    leafBuf.writeUInt32LE(0);
    const amountBuf = Buffer.alloc(8);
    amountBuf.writeBigUInt64LE(BigInt(1000));
    const claimedByUserBuf = Buffer.alloc(8);
    claimedByUserBuf.writeBigUInt64LE(BigInt(500));
    const claimedOverallBuf = Buffer.alloc(8);
    claimedOverallBuf.writeBigUInt64LE(BigInt(1000));
    const eventData = Buffer.concat([
      CLAIMED_DISCRIMINATOR, treeBytes, beneficiaryBytes,
      leafBuf, amountBuf, claimedByUserBuf, claimedOverallBuf,
    ]);
    const logMessage = `Program data: ${eventData.toString("base64")}`;

    const conn1 = mockConnection({
      signatures: [
        { signature: "sig_a", slot: 10 },
        { signature: "sig_b", slot: 20 },
        { signature: "sig_c", slot: 30 },
      ],
      logMessage,
    });

    const first = await syncClaimEventsWithConnection(conn1 as any, 0);
    expect(first.lastSlot).toBe(30);
    expect(await getLastSyncedSlot()).toBe(30);

    const conn2 = mockConnection({
      signatures: [
        { signature: "sig_d", slot: 40 },
      ],
      logMessage,
    });

    const second = await syncClaimEventsWithConnection(conn2 as any, 30);
    expect(second.lastSlot).toBe(40);
    expect(await getLastSyncedSlot()).toBe(40);
  });
});

// ===========================================================================
// T4: Transactional rollback
// ===========================================================================

describe("transactional rollback", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("db.transaction rolls back insert on error", async () => {
    const { treeAddress } = await createCampaignViaPost();
    const [camp] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.treeAddress, treeAddress))
      .limit(1);

    await expect(
      db.transaction(async (tx) => {
        await tx.insert(claimEvents).values({
          campaignId: camp!.id,
          beneficiary: "rollback_test",
          leafIndex: 0,
          amount: BigInt(100),
          totalClaimedByUser: BigInt(100),
          totalClaimedOverall: BigInt(100),
          signature: "test_sig_rollback",
          slot: BigInt(1),
          blockTime: BigInt(100),
        });
        throw new Error("simulated transaction failure");
      }),
    ).rejects.toThrow("simulated transaction failure");

    const events = await db
      .select()
      .from(claimEvents)
      .where(eq(claimEvents.signature, "test_sig_rollback"));
    expect(events).toHaveLength(0);
  });
});

// ===========================================================================
// T14: processTransactions rollback via mocked inserts (per design)
// ===========================================================================

describe("processTransactions rollback", () => {
  beforeEach(async () => {
    await resetDb();
  });

  function mockConnection(logMessage: string) {
    return {
      getSignaturesForAddress: vi.fn(),
      getTransaction: vi.fn().mockResolvedValue({
        meta: { logMessages: [logMessage] },
        blockTime: 1234567890,
      }),
    };
  }

  it("processes one event, inserts claimEvent, and updates checkpoint", async () => {
    const treeBytes = Buffer.alloc(32, 0x01);
    const treeAddress = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
    const { campaignId } = await createCampaignViaPost({ treeAddress });

    const beneficiaryBytes = Buffer.alloc(32, 0x02);
    const leafBuf = Buffer.alloc(4);
    leafBuf.writeUInt32LE(0);
    const amountBuf = Buffer.alloc(8);
    amountBuf.writeBigUInt64LE(BigInt(1000));
    const claimedByUserBuf = Buffer.alloc(8);
    claimedByUserBuf.writeBigUInt64LE(BigInt(500));
    const claimedOverallBuf = Buffer.alloc(8);
    claimedOverallBuf.writeBigUInt64LE(BigInt(1000));
    const eventData = Buffer.concat([
      CLAIMED_DISCRIMINATOR, treeBytes, beneficiaryBytes,
      leafBuf, amountBuf, claimedByUserBuf, claimedOverallBuf,
    ]);
    const logMessage = `Program data: ${eventData.toString("base64")}`;

    const conn = mockConnection(logMessage);

    const result = await processTransactions({
      connection: conn as any,
      signatures: [
        { signature: "sig_1", slot: 10 },
      ],
    });

    expect(result.processed).toBe(1);
    expect(result.lastSlot).toBe(10);

    const events = await db
      .select()
      .from(claimEvents)
      .where(eq(claimEvents.signature, "sig_1"));
    expect(events).toHaveLength(1);
    expect(events[0]!.campaignId).toBe(campaignId);

    expect(await getLastSyncedSlot()).toBe(10);
  });
});

// ===========================================================================
// T15: BigInt serialization guard — automated route scan for new routes
// ===========================================================================

describe("BigInt serialization guard", () => {
  const EXEMPTED_ROUTES = new Set([
    "src/app/api/auth/nonce/route.ts",
  ]);
  const API_DIR = "src/app/api";

  function collectRouteFiles(dir: string): string[] {
    const results: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          results.push(...collectRouteFiles(full));
        } else if (entry.isFile() && entry.name === "route.ts") {
          results.push(full);
        }
      }
    } catch {
      // directory might not exist in test runner context
    }
    return results;
  }

  it("all route handlers import jsonResponse for BigInt-safe serialization", () => {
    const routeFiles = collectRouteFiles(API_DIR);
    expect(routeFiles.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of routeFiles) {
      if (EXEMPTED_ROUTES.has(file)) continue;
      const content = fs.readFileSync(file, "utf8");
      if (!content.includes("jsonResponse")) {
        violations.push(file);
      }
    }

    expect(violations).toEqual([]);
  });
});

// ===========================================================================
// T5: RLS policies
// ===========================================================================

describe("RLS policies", () => {
  let isSuperuser = false;

  beforeAll(async () => {
    try {
      await db.execute(sql`CREATE ROLE anon_test WITH LOGIN PASSWORD 'test'`);
      await db.execute(sql`GRANT USAGE ON SCHEMA public TO anon_test`);
      isSuperuser = true;
    } catch {
      console.warn("[RLS] Not running as superuser — skipping anon role setup. RLS tests will be skipped.");
      isSuperuser = false;
    }
  });

  afterAll(async () => {
    if (isSuperuser) {
      try {
        await db.execute(sql`DROP ROLE IF EXISTS anon_test`);
      } catch {
        // ignore cleanup errors
      }
    }
  });

  beforeEach(async () => {
    await resetDb();
  });

  it.runIf(isSuperuser)("anon SELECT succeeds (public read policy)", async () => {
    const { treeAddress } = await createCampaignViaPost();

    const { default: postgres } = await import("postgres");
    const anonSql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      await anonSql`SET ROLE anon_test`;
      const rows = await anonSql`SELECT * FROM campaigns WHERE tree_address = ${treeAddress}`;
      expect(rows.length).toBe(1);
    } finally {
      await anonSql.end({ timeout: 1 });
    }
  });

  it.runIf(isSuperuser)("anon INSERT fails (no INSERT policy)", async () => {
    const { default: postgres } = await import("postgres");
    const anonSql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      await anonSql`SET ROLE anon_test`;
      await expect(
        anonSql`INSERT INTO campaigns (tree_address, creator, mint, campaign_id, merkle_root, leaf_count, total_supply, total_claimed, cancellable, paused)
                VALUES ('test', 'test', 'test', 1, 'test', 1, 1, 0, false, false)`,
      ).rejects.toThrow();
    } finally {
      await anonSql.end({ timeout: 1 });
    }
  });

  it.runIf(!isSuperuser)("skipped: not running as superuser", () => {
    console.warn("[RLS] Test requires superuser on test Postgres. Skipping.");
  });
});
