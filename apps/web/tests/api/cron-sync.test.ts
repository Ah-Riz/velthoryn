import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/cron/sync/route";
import { makeUrl } from "../helpers/requests";
import { resetRateLimitForTests } from "@/lib/api/rate-limit";
import { resetRedisForTests } from "@/lib/api/redis";

// ---------------------------------------------------------------------------
// Mock the indexer module so tests don't need a real Solana RPC.
// ---------------------------------------------------------------------------

vi.mock("@/lib/indexer/event-indexer", () => ({
  indexAllEvents: vi.fn().mockResolvedValue({
    processed: 5,
    lastSlot: 12345,
    byType: { claimed: 3, cancelled: 1, paused: 1 },
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CRON_SECRET = "test-cron-secret-12345";

function makeCronRequest(token?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (token !== undefined) {
    headers["authorization"] = `Bearer ${token}`;
  }
  return new NextRequest(makeUrl("/api/cron/sync"), { headers });
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

let originalCronSecret: string | undefined;

beforeEach(() => {
  resetRedisForTests();
  resetRateLimitForTests();
  vi.clearAllMocks();
  originalCronSecret = process.env.CRON_SECRET;
});

afterEach(() => {
  // Restore original CRON_SECRET
  if (originalCronSecret === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = originalCronSecret;
  }
});

// ===========================================================================
// GET /api/cron/sync
// ===========================================================================

describe("GET /api/cron/sync", () => {
  it("returns 500 INTERNAL_ERROR when CRON_SECRET env var is missing", async () => {
    delete process.env.CRON_SECRET;

    const req = makeCronRequest("anything");
    const res = await GET(req);
    const json = (await res.json()) as { code: string };

    expect(res.status).toBe(500);
    expect(json.code).toBe("INTERNAL_ERROR");
  });

  it("returns 401 UNAUTHORIZED when bearer token does not match CRON_SECRET", async () => {
    process.env.CRON_SECRET = CRON_SECRET;

    const req = makeCronRequest("wrong-secret");
    const res = await GET(req);
    const json = (await res.json()) as { code: string };

    expect(res.status).toBe(401);
    expect(json.code).toBe("UNAUTHORIZED");
  });

  it("returns 200 with sync results when CRON_SECRET matches", async () => {
    process.env.CRON_SECRET = CRON_SECRET;

    const req = makeCronRequest(CRON_SECRET);
    const res = await GET(req);
    const json = (await res.json()) as {
      ok: boolean;
      processed: number;
      lastSlot: number;
      byType: Record<string, number>;
    };

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.processed).toBe(5);
    expect(json.lastSlot).toBe(12345);
    expect(json.byType).toEqual({ claimed: 3, cancelled: 1, paused: 1 });
  });

  it("returns 401 when Authorization header is missing entirely", async () => {
    process.env.CRON_SECRET = CRON_SECRET;

    const req = makeCronRequest(); // no token
    const res = await GET(req);
    const json = (await res.json()) as { code: string };

    expect(res.status).toBe(401);
    expect(json.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when Authorization header uses non-Bearer scheme", async () => {
    process.env.CRON_SECRET = CRON_SECRET;

    const req = new NextRequest(makeUrl("/api/cron/sync"), {
      headers: { authorization: `Basic ${CRON_SECRET}` },
    });
    const res = await GET(req);
    const json = (await res.json()) as { code: string };

    expect(res.status).toBe(401);
    expect(json.code).toBe("UNAUTHORIZED");
  });
});
