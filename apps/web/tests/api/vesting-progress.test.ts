import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { Keypair } from "@solana/web3.js";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/beneficiary/[address]/vesting-progress/route";
import { resetDb } from "../helpers/db";
import { createCampaignViaPost, seedClaimEvent } from "../helpers/fixtures";
import { makeUrl, CREATOR } from "../helpers/requests";
import { resetRateLimitForTests } from "@/lib/api/rate-limit";
import { resetRedisForTests } from "@/lib/api/redis";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ensureEventTables } from "../helpers/ensure-tables";

let sigCounter = 0;
function uniqueSig(prefix: string): string {
  return `${prefix}_${Date.now()}_${sigCounter++}_${Math.random().toString(36).slice(2)}`;
}

function uniqueBeneficiary(): string {
  return Keypair.generate().publicKey.toBase58();
}

function makeVestingProgressRequest(address: string): NextRequest {
  return new NextRequest(makeUrl(`/api/beneficiary/${address}/vesting-progress`));
}

function makeContext(address: string) {
  return { params: Promise.resolve({ address }) };
}

type ProgressCampaign = {
  treeAddress: string;
  cancelledAt: string | null;
  progress: {
    totalEntitled: string;
    vestedSoFar: string;
    claimedSoFar: string;
    claimable: string;
    progressPercent: number;
  };
};

async function seedLinearCampaign(
  overrides: {
    startTime?: number;
    cliffTime?: number;
    endTime?: number;
    amount?: string;
    cancelledAt?: number | null;
  } = {},
) {
  const beneficiary = uniqueBeneficiary();
  const amount = overrides.amount ?? "1000000";
  const startTime = overrides.startTime ?? 1700000000;
  const cliffTime = overrides.cliffTime ?? 1700000000;
  const endTime = overrides.endTime ?? 1700000000 + 365 * 24 * 3600;

  const { treeAddress, campaignId } = await createCampaignViaPost({
    creator: CREATOR,
    leaf: {
      beneficiary,
      amount,
      releaseType: 1,
      startTime: String(startTime),
      cliffTime: String(cliffTime),
      endTime: String(endTime),
    },
  });

  if (overrides.cancelledAt !== undefined) {
    await db
      .update(campaigns)
      .set({ cancelledAt: BigInt(overrides.cancelledAt ?? 0) })
      .where(eq(campaigns.treeAddress, treeAddress));
  }

  return { treeAddress, campaignId, beneficiary, startTime, cliffTime, endTime, amount };
}

beforeAll(async () => {
  await ensureEventTables();
});

beforeEach(async () => {
  resetRedisForTests();
  resetRateLimitForTests();
  await resetDb();
});

describe("GET /api/beneficiary/:address/vesting-progress", () => {
  it("returns empty campaigns array for unknown beneficiary address (200)", async () => {
    const unknownAddress = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

    const req = makeVestingProgressRequest(unknownAddress);
    const res = await GET(req, makeContext(unknownAddress) as never);
    const json = (await res.json()) as { address: string; campaigns: unknown[] };

    expect(res.status).toBe(200);
    expect(json.address).toBe(unknownAddress);
    expect(json.campaigns).toEqual([]);
  });

  it("returns correct vesting progress for linear schedule at midpoint", async () => {
    const startTime = 1700000000;
    const endTime = 1700000000 + 10000;
    const amount = "10000";

    const { treeAddress, beneficiary } = await seedLinearCampaign({
      startTime,
      cliffTime: startTime,
      endTime,
      amount,
    });

    const req = makeVestingProgressRequest(beneficiary);
    const res = await GET(req, makeContext(beneficiary) as never);
    const json = (await res.json()) as { campaigns: ProgressCampaign[] };

    expect(res.status).toBe(200);
    expect(json.campaigns).toHaveLength(1);
    expect(json.campaigns[0]!.treeAddress).toBe(treeAddress);

    const progress = json.campaigns[0]!.progress;
    expect(progress.totalEntitled).toBe(amount);
    expect(Number(progress.vestedSoFar)).toBeGreaterThanOrEqual(0);
    expect(Number(progress.claimedSoFar)).toBe(0);
    expect(progress.claimable).toBe(progress.vestedSoFar);
    expect(progress.progressPercent).toBeGreaterThanOrEqual(0);
    expect(progress.progressPercent).toBeLessThanOrEqual(100);
  });

  it("returns correct vestedSoFar, claimedSoFar, claimable, progressPercent", async () => {
    const amount = "1000000";
    const { treeAddress, campaignId, beneficiary } = await seedLinearCampaign({
      startTime: 0,
      cliffTime: 0,
      endTime: 1,
      amount,
    });

    await seedClaimEvent(campaignId, {
      beneficiary,
      amount: 500000,
      totalClaimedByUser: 500000,
      totalClaimedOverall: 500000,
      signature: uniqueSig("halfclaim"),
    });

    const req = makeVestingProgressRequest(beneficiary);
    const res = await GET(req, makeContext(beneficiary) as never);
    const json = (await res.json()) as { campaigns: ProgressCampaign[] };

    expect(res.status).toBe(200);
    expect(json.campaigns).toHaveLength(1);

    const progress = json.campaigns[0]!.progress;
    expect(progress.vestedSoFar).toBe(amount);
    expect(progress.claimedSoFar).toBe("500000");
    expect(progress.claimable).toBe("500000");
    expect(progress.progressPercent).toBe(100);
  });

  it("returns 400 for invalid address format", async () => {
    const invalidAddress = "not-a-valid-address!!!";

    const req = makeVestingProgressRequest(invalidAddress);
    const res = await GET(req, makeContext(invalidAddress) as never);
    const json = (await res.json()) as { code: string };

    expect(res.status).toBe(400);
    expect(json.code).toBe("VALIDATION_ERROR");
  });

  it("cancelled campaign shows frozen vested amount (cancelledAt caps vesting)", async () => {
    const amount = "1000000";
    const startTime = 1700000000;
    const cliffTime = 1700000000;
    const endTime = 1700000000 + 100000;
    const cancelledAt = startTime + 10000;

    const { treeAddress, beneficiary } = await seedLinearCampaign({
      startTime,
      cliffTime,
      endTime,
      amount,
      cancelledAt,
    });

    const req = makeVestingProgressRequest(beneficiary);
    const res = await GET(req, makeContext(beneficiary) as never);
    const json = (await res.json()) as { campaigns: ProgressCampaign[] };

    expect(res.status).toBe(200);
    expect(json.campaigns).toHaveLength(1);
    expect(json.campaigns[0]!.cancelledAt).toBe(String(cancelledAt));

    const expectedVested = BigInt(amount) * BigInt(cancelledAt - cliffTime) / BigInt(endTime - cliffTime);
    expect(json.campaigns[0]!.progress.vestedSoFar).toBe(expectedVested.toString());
    expect(json.campaigns[0]!.progress.progressPercent).toBeLessThan(15);
    expect(json.campaigns[0]!.progress.progressPercent).toBeGreaterThan(5);
  });

  it("fully claimed campaign shows claimable = 0", async () => {
    const amount = "1000000";
    const { treeAddress, campaignId, beneficiary } = await seedLinearCampaign({
      startTime: 0,
      cliffTime: 0,
      endTime: 1,
      amount,
    });

    await seedClaimEvent(campaignId, {
      beneficiary,
      amount: 1000000,
      totalClaimedByUser: 1000000,
      totalClaimedOverall: 1000000,
      signature: uniqueSig("fullclaim"),
    });

    const req = makeVestingProgressRequest(beneficiary);
    const res = await GET(req, makeContext(beneficiary) as never);
    const json = (await res.json()) as { campaigns: ProgressCampaign[] };

    expect(res.status).toBe(200);
    expect(json.campaigns).toHaveLength(1);
    expect(json.campaigns[0]!.progress.claimable).toBe("0");
    expect(json.campaigns[0]!.progress.claimedSoFar).toBe(amount);
    expect(json.campaigns[0]!.progress.vestedSoFar).toBe(amount);
  });
});
