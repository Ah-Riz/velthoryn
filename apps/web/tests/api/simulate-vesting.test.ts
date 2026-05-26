import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as postSimulateVesting } from "@/app/api/simulate-vesting/route";
import { GET as getScheduleTemplates } from "@/app/api/schedule-templates/route";
import { makeUrl } from "../helpers/requests";
import { resetRateLimitForTests } from "@/lib/api/rate-limit";
import { resetRedisForTests } from "@/lib/api/redis";

// ---------------------------------------------------------------------------
// Constants
// Timestamps in seconds (Unix epoch):
//   START = 2023-11-15T00:00:00Z  → 1700006400
//   CLIFF = 2023-11-15T00:00:00Z  (same as start for cliff/milestone, or same)
//   END   = 2024-11-15T00:00:00Z  → 1731628800  (~366 days)
//
// For linear tests the cliff equals start so vesting begins immediately.
// ---------------------------------------------------------------------------

const START = "1700006400";
const END = "1731628800";
const AMOUNT = "1000000000";

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest(makeUrl("/api/simulate-vesting"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function makeGetRequest(path: string): NextRequest {
  return new NextRequest(makeUrl(path));
}

beforeEach(() => {
  resetRedisForTests();
  resetRateLimitForTests();
});

// ---------------------------------------------------------------------------
// Simulate-vesting — Linear schedule
// ---------------------------------------------------------------------------

describe("POST /api/simulate-vesting — linear", () => {
  it("returns 200 with breakdown array", async () => {
    const req = makePostRequest({
      amount: AMOUNT,
      releaseType: 1,
      startTime: START,
      cliffTime: START,
      endTime: END,
    });
    const res = await postSimulateVesting(req);
    expect(res.status).toBe(200);

    const body = await res.json() as {
      schedule: string;
      totalAmount: string;
      durationDays: number;
      breakdown: Array<{ date: string; vested: string; cumulative: string; percent: number }>;
    };
    expect(body.schedule).toBe("linear");
    expect(body.totalAmount).toBe(AMOUNT);
    expect(body.breakdown).toBeInstanceOf(Array);
    expect(body.breakdown.length).toBeGreaterThan(0);
  });

  it("first monthly entry has non-zero vested (cliff == start)", async () => {
    const req = makePostRequest({
      amount: AMOUNT,
      releaseType: 1,
      startTime: START,
      cliffTime: START,
      endTime: END,
    });
    const res = await postSimulateVesting(req);
    const body = await res.json() as {
      breakdown: Array<{ vested: string; cumulative: string }>;
    };
    // After one month, some amount should be vested (cliff == start)
    const firstEntry = body.breakdown[0];
    const secondEntry = body.breakdown[1];
    // First entry is at startTime — cumulative is 0 (at cliff, linear returns 0 at cliff)
    expect(firstEntry.cumulative).toBe("0");
    // Second entry (one month later) should have non-zero vested
    expect(BigInt(secondEntry.vested)).toBeGreaterThan(0n);
  });

  it("last entry cumulative equals totalAmount", async () => {
    const req = makePostRequest({
      amount: AMOUNT,
      releaseType: 1,
      startTime: START,
      cliffTime: START,
      endTime: END,
    });
    const res = await postSimulateVesting(req);
    const body = await res.json() as {
      breakdown: Array<{ cumulative: string }>;
    };
    const last = body.breakdown[body.breakdown.length - 1];
    expect(last.cumulative).toBe(AMOUNT);
  });

  it("cumulative values are monotonically non-decreasing", async () => {
    const req = makePostRequest({
      amount: AMOUNT,
      releaseType: 1,
      startTime: START,
      cliffTime: START,
      endTime: END,
    });
    const res = await postSimulateVesting(req);
    const body = await res.json() as {
      breakdown: Array<{ cumulative: string }>;
    };
    for (let i = 1; i < body.breakdown.length; i++) {
      expect(BigInt(body.breakdown[i].cumulative)).toBeGreaterThanOrEqual(
        BigInt(body.breakdown[i - 1].cumulative),
      );
    }
  });

  it("percent of last entry is 100", async () => {
    const req = makePostRequest({
      amount: AMOUNT,
      releaseType: 1,
      startTime: START,
      cliffTime: START,
      endTime: END,
    });
    const res = await postSimulateVesting(req);
    const body = await res.json() as {
      breakdown: Array<{ percent: number }>;
    };
    const last = body.breakdown[body.breakdown.length - 1];
    expect(last.percent).toBe(100);
  });

  it("percent is accurate within 0.01% of expected", async () => {
    const req = makePostRequest({
      amount: "10000",
      releaseType: 1,
      startTime: START,
      cliffTime: START,
      endTime: END,
    });
    const res = await postSimulateVesting(req);
    const body = await res.json() as {
      breakdown: Array<{ cumulative: string; percent: number }>;
    };
    for (const entry of body.breakdown) {
      const cumBig = BigInt(entry.cumulative);
      const expected = Number(cumBig) / 10000 * 100;
      expect(Math.abs(entry.percent - expected)).toBeLessThan(0.01);
    }
  });

  it("all vested and cumulative values are strings (BigInt-safe)", async () => {
    const req = makePostRequest({
      amount: AMOUNT,
      releaseType: 1,
      startTime: START,
      cliffTime: START,
      endTime: END,
    });
    const res = await postSimulateVesting(req);
    const body = await res.json() as {
      totalAmount: unknown;
      breakdown: Array<{ vested: unknown; cumulative: unknown }>;
    };
    expect(typeof body.totalAmount).toBe("string");
    for (const entry of body.breakdown) {
      expect(typeof entry.vested).toBe("string");
      expect(typeof entry.cumulative).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// Simulate-vesting — Cliff schedule (releaseType 0)
// ---------------------------------------------------------------------------

describe("POST /api/simulate-vesting — cliff", () => {
  // CLIFF_TS: ~6 months after start
  const CLIFF_TS = "1715817600"; // 2024-05-16T00:00:00Z

  it("all entries before cliff date have zero cumulative", async () => {
    const req = makePostRequest({
      amount: AMOUNT,
      releaseType: 0,
      startTime: START,
      cliffTime: CLIFF_TS,
      endTime: END,
    });
    const res = await postSimulateVesting(req);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      breakdown: Array<{ date: string; cumulative: string }>;
    };
    const cliffDate = new Date(Number(CLIFF_TS) * 1000).toISOString().split("T")[0];
    const beforeCliff = body.breakdown.filter((e) => e.date < cliffDate);
    for (const entry of beforeCliff) {
      expect(entry.cumulative).toBe("0");
    }
  });

  it("entry at or after cliff date shows full amount as cumulative", async () => {
    const req = makePostRequest({
      amount: AMOUNT,
      releaseType: 0,
      startTime: START,
      cliffTime: CLIFF_TS,
      endTime: END,
    });
    const res = await postSimulateVesting(req);
    const body = await res.json() as {
      breakdown: Array<{ date: string; cumulative: string }>;
    };
    const cliffDate = new Date(Number(CLIFF_TS) * 1000).toISOString().split("T")[0];
    const atOrAfterCliff = body.breakdown.filter((e) => e.date >= cliffDate);
    expect(atOrAfterCliff.length).toBeGreaterThan(0);
    for (const entry of atOrAfterCliff) {
      expect(entry.cumulative).toBe(AMOUNT);
    }
  });
});

// ---------------------------------------------------------------------------
// Simulate-vesting — Milestone schedule (releaseType 2)
// ---------------------------------------------------------------------------

describe("POST /api/simulate-vesting — milestone", () => {
  const CLIFF_TS = "1715817600"; // 2024-05-16T00:00:00Z

  it("all entries before cliff date have zero cumulative", async () => {
    const req = makePostRequest({
      amount: AMOUNT,
      releaseType: 2,
      startTime: START,
      cliffTime: CLIFF_TS,
      endTime: END,
    });
    const res = await postSimulateVesting(req);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      breakdown: Array<{ date: string; cumulative: string }>;
    };
    const cliffDate = new Date(Number(CLIFF_TS) * 1000).toISOString().split("T")[0];
    const beforeCliff = body.breakdown.filter((e) => e.date < cliffDate);
    for (const entry of beforeCliff) {
      expect(entry.cumulative).toBe("0");
    }
  });

  it("entries at or after cliff date show full amount (time-based; release is off-chain)", async () => {
    const req = makePostRequest({
      amount: AMOUNT,
      releaseType: 2,
      startTime: START,
      cliffTime: CLIFF_TS,
      endTime: END,
    });
    const res = await postSimulateVesting(req);
    const body = await res.json() as {
      breakdown: Array<{ date: string; cumulative: string }>;
    };
    const cliffDate = new Date(Number(CLIFF_TS) * 1000).toISOString().split("T")[0];
    const atOrAfterCliff = body.breakdown.filter((e) => e.date >= cliffDate);
    expect(atOrAfterCliff.length).toBeGreaterThan(0);
    for (const entry of atOrAfterCliff) {
      expect(entry.cumulative).toBe(AMOUNT);
    }
  });
});

// ---------------------------------------------------------------------------
// Simulate-vesting — validation errors
// ---------------------------------------------------------------------------

describe("POST /api/simulate-vesting — validation", () => {
  it("returns 400 when startTime > endTime", async () => {
    const req = makePostRequest({
      amount: AMOUNT,
      releaseType: 1,
      startTime: END,   // swapped
      cliffTime: END,
      endTime: START,   // swapped
    });
    const res = await postSimulateVesting(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when amount is zero", async () => {
    const req = makePostRequest({
      amount: "0",
      releaseType: 1,
      startTime: START,
      cliffTime: START,
      endTime: END,
    });
    const res = await postSimulateVesting(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when amount is missing", async () => {
    const req = makePostRequest({
      releaseType: 1,
      startTime: START,
      cliffTime: START,
      endTime: END,
    });
    const res = await postSimulateVesting(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when releaseType is out of range", async () => {
    const req = makePostRequest({
      amount: AMOUNT,
      releaseType: 5,
      startTime: START,
      cliffTime: START,
      endTime: END,
    });
    const res = await postSimulateVesting(req);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/schedule-templates
// ---------------------------------------------------------------------------

describe("GET /api/schedule-templates", () => {
  it("returns 200 with templates array", async () => {
    const req = makeGetRequest("/api/schedule-templates");
    const res = await getScheduleTemplates(req);
    expect(res.status).toBe(200);

    const body = await res.json() as { templates: unknown[] };
    expect(body.templates).toBeInstanceOf(Array);
  });

  it("returns at least 5 templates (all required presets)", async () => {
    const req = makeGetRequest("/api/schedule-templates");
    const res = await getScheduleTemplates(req);
    const body = await res.json() as { templates: Array<{ id: string }> };
    expect(body.templates.length).toBeGreaterThanOrEqual(5);
  });

  it("includes all required template IDs", async () => {
    const req = makeGetRequest("/api/schedule-templates");
    const res = await getScheduleTemplates(req);
    const body = await res.json() as { templates: Array<{ id: string }> };
    const ids = body.templates.map((t) => t.id);
    expect(ids).toContain("4yr-linear-1yr-cliff");
    expect(ids).toContain("2yr-linear");
    expect(ids).toContain("1yr-cliff");
    expect(ids).toContain("milestone-4");
    expect(ids).toContain("6mo-cliff");
  });

  it("each template has required fields", async () => {
    const req = makeGetRequest("/api/schedule-templates");
    const res = await getScheduleTemplates(req);
    const body = await res.json() as {
      templates: Array<{
        id: unknown;
        name: unknown;
        description: unknown;
        releaseType: unknown;
        params: unknown;
      }>;
    };
    for (const t of body.templates) {
      expect(typeof t.id).toBe("string");
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(typeof t.releaseType).toBe("number");
      expect(t.params).toBeTruthy();
    }
  });

  it("4yr-linear-1yr-cliff description mentions 25% after 1 year", async () => {
    const req = makeGetRequest("/api/schedule-templates");
    const res = await getScheduleTemplates(req);
    const body = await res.json() as {
      templates: Array<{ id: string; description: string }>;
    };
    const t = body.templates.find((x) => x.id === "4yr-linear-1yr-cliff");
    expect(t).toBeDefined();
    expect(t!.description.toLowerCase()).toMatch(/25%/);
    expect(t!.description.toLowerCase()).toMatch(/1 year|one year|12 month/);
  });

  it("templates include the correct release types", async () => {
    const req = makeGetRequest("/api/schedule-templates");
    const res = await getScheduleTemplates(req);
    const body = await res.json() as {
      templates: Array<{ id: string; releaseType: number }>;
    };
    const byId = Object.fromEntries(body.templates.map((t) => [t.id, t.releaseType]));
    expect(byId["4yr-linear-1yr-cliff"]).toBe(1); // linear
    expect(byId["2yr-linear"]).toBe(1);            // linear
    expect(byId["1yr-cliff"]).toBe(0);             // cliff
    expect(byId["milestone-4"]).toBe(2);           // milestone
    expect(byId["6mo-cliff"]).toBe(0);             // cliff
  });
});
