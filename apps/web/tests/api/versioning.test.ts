import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as getHealth } from "@/app/api/health/route";
import { POST as postSimulateVesting } from "@/app/api/simulate-vesting/route";
import { GET as getScheduleTemplates } from "@/app/api/schedule-templates/route";
import { makeUrl } from "../helpers/requests";
import { resetRateLimitForTests } from "@/lib/api/rate-limit";
import { resetRedisForTests } from "@/lib/api/redis";
import { API_VERSION } from "@/lib/api/version";

const HEADER = "x-api-version";

beforeEach(() => {
  resetRedisForTests();
  resetRateLimitForTests();
});

describe("X-API-Version header", () => {
  it("GET /api/health includes X-API-Version header", async () => {
    const req = new NextRequest(makeUrl("/api/health"));
    const res = await getHealth(req);
    expect(res.headers.get(HEADER)).toBe(API_VERSION);
  });

  it("GET /api/schedule-templates includes X-API-Version header", async () => {
    const req = new NextRequest(makeUrl("/api/schedule-templates"));
    const res = await getScheduleTemplates(req);
    expect(res.headers.get(HEADER)).toBe(API_VERSION);
  });

  it("POST /api/simulate-vesting (success) includes X-API-Version header", async () => {
    const req = new NextRequest(makeUrl("/api/simulate-vesting"), {
      method: "POST",
      body: JSON.stringify({
        amount: "1000000",
        releaseType: 0,
        startTime: "1700000000",
        cliffTime: "1715000000",
        endTime: "1731536000",
      }),
      headers: { "content-type": "application/json" },
    });
    const res = await postSimulateVesting(req);
    expect(res.headers.get(HEADER)).toBe(API_VERSION);
  });

  it("POST /api/simulate-vesting (validation error) includes X-API-Version header", async () => {
    const req = new NextRequest(makeUrl("/api/simulate-vesting"), {
      method: "POST",
      body: JSON.stringify({ amount: "0", releaseType: 1, startTime: "100", cliffTime: "100", endTime: "200" }),
      headers: { "content-type": "application/json" },
    });
    const res = await postSimulateVesting(req);
    expect(res.status).toBe(400);
    expect(res.headers.get(HEADER)).toBe(API_VERSION);
  });

  it("API_VERSION constant is '1'", () => {
    expect(API_VERSION).toBe("1");
  });
});
