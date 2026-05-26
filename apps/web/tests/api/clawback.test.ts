import { describe, it, expect, vi, beforeEach } from "vitest";
import { Keypair } from "@solana/web3.js";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mock the tx-builder so tests don't need a real Solana RPC.
// GRACE_PERIOD_SECS is kept from the real module.
// ---------------------------------------------------------------------------

vi.mock("@/lib/api/tx-builder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/tx-builder")>();
  return {
    ...actual,
    buildCancelCampaignTx: vi.fn().mockResolvedValue({
      transaction: "FakeCancelCampaignTx",
      signers: ["cancelAuthority"],
      instruction: "cancel_campaign",
      accounts: { vestingTree: "fake", cancelAuthority: "fake" },
    }),
    buildWithdrawUnvestedTx: vi.fn().mockResolvedValue({
      transaction: "FakeWithdrawUnvestedTx",
      signers: ["creator"],
      instruction: "withdraw_unvested",
      accounts: { vestingTree: "fake", vault: "fake", creatorAta: "fake" },
    }),
    buildCancelStreamTx: vi.fn().mockResolvedValue({
      transaction: "FakeCancelStreamTx",
      signers: ["creator"],
      instruction: "cancel_stream",
      accounts: { vestingTree: "fake", beneficiary: "fake", claimRecord: "fake" },
    }),
    buildMilestoneReleaseTx: vi.fn().mockResolvedValue({
      transaction: "FakeMilestoneReleaseTx",
      signers: ["creator"],
      instruction: "set_milestone_released",
      accounts: { vestingTree: "fake", creator: "fake" },
    }),
  };
});

// ---------------------------------------------------------------------------
// Route handler imports (after mocks)
// ---------------------------------------------------------------------------

import { POST as cancelCampaign } from "@/app/api/campaigns/[treeAddress]/cancel/route";
import { POST as withdrawUnvested } from "@/app/api/campaigns/[treeAddress]/withdraw-unvested/route";
import { POST as cancelStream } from "@/app/api/campaigns/[treeAddress]/cancel-stream/route";
import { POST as milestoneRelease } from "@/app/api/campaigns/[treeAddress]/milestones/[idx]/route";
import { GET as getCampaignByAddress } from "@/app/api/campaigns/[treeAddress]/route";

import { resetDb } from "../helpers/db";
import { createCampaignViaPost, setCampaignStatus, seedMilestoneEvent } from "../helpers/fixtures";
import {
  makeUrl,
  makeAuthenticatedPostRequest,
} from "../helpers/requests";
import { TEST_CREATOR_KEYPAIR, createAuthHeader } from "../helpers/wallet-auth";
import { resetRateLimitForTests } from "@/lib/api/rate-limit";
import { resetRedisForTests } from "@/lib/api/redis";
import { db } from "@/lib/db";
import { milestoneEvents } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const CREATOR_ADDRESS = TEST_CREATOR_KEYPAIR.publicKey.toBase58();
// A second keypair simulating an unauthorized signer
const STRANGER_KEYPAIR = Keypair.generate();

// Valid Solana public keys for ATA fields
const FAKE_ATA = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const BENEFICIARY_ADDRESS = "11111111111111111111111111111111";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(treeAddress: string, idx?: string) {
  return {
    params: Promise.resolve(idx !== undefined ? { treeAddress, idx } : { treeAddress }),
  };
}

async function makeStrangerRequest(path: string, body: unknown): Promise<NextRequest> {
  resetRedisForTests();
  const authorization = await createAuthHeader(STRANGER_KEYPAIR);
  return new NextRequest(makeUrl(path), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { authorization, "content-type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(async () => {
  resetRedisForTests();
  resetRateLimitForTests();
  await resetDb();
  vi.clearAllMocks();
});

// ===========================================================================
// F3.2 — Grace period info in campaign detail
// ===========================================================================

describe("GET /api/campaigns/:treeAddress — grace period", () => {
  it("returns gracePeriod: null for non-cancelled campaign", async () => {
    const { treeAddress } = await createCampaignViaPost({ creator: CREATOR_ADDRESS });

    const req = new NextRequest(makeUrl(`/api/campaigns/${treeAddress}`));
    const res = await getCampaignByAddress(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as { gracePeriod: unknown };

    expect(res.status).toBe(200);
    expect(json.gracePeriod).toBeNull();
  });

  it("returns gracePeriod object for a recently-cancelled campaign", async () => {
    const { treeAddress } = await createCampaignViaPost({ creator: CREATOR_ADDRESS });
    const threeDaysAgo = Math.floor(Date.now() / 1000) - 3 * 24 * 3600;
    await setCampaignStatus(treeAddress, { cancelledAt: threeDaysAgo });

    const req = new NextRequest(makeUrl(`/api/campaigns/${treeAddress}`));
    const res = await getCampaignByAddress(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as {
      gracePeriod: { end: string; remaining: string; isExpired: boolean };
    };

    expect(res.status).toBe(200);
    expect(json.gracePeriod).not.toBeNull();
    expect(json.gracePeriod.isExpired).toBe(false);
    // ~4 days remaining: between 3 and 5 days worth of seconds
    const remaining = BigInt(json.gracePeriod.remaining);
    expect(remaining > 0n).toBe(true);
    expect(remaining < BigInt(5 * 24 * 3600)).toBe(true);
    // end should be a numeric string
    expect(/^\d+$/.test(json.gracePeriod.end)).toBe(true);
  });

  it("returns isExpired: true and remaining: '0' when cancelled 8 days ago", async () => {
    const { treeAddress } = await createCampaignViaPost({ creator: CREATOR_ADDRESS });
    const eightDaysAgo = Math.floor(Date.now() / 1000) - 8 * 24 * 3600;
    await setCampaignStatus(treeAddress, { cancelledAt: eightDaysAgo });

    const req = new NextRequest(makeUrl(`/api/campaigns/${treeAddress}`));
    const res = await getCampaignByAddress(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as {
      gracePeriod: { end: string; remaining: string; isExpired: boolean };
    };

    expect(res.status).toBe(200);
    expect(json.gracePeriod.isExpired).toBe(true);
    expect(json.gracePeriod.remaining).toBe("0");
  });

  it("grace period end and remaining are strings (not numbers)", async () => {
    const { treeAddress } = await createCampaignViaPost({ creator: CREATOR_ADDRESS });
    await setCampaignStatus(treeAddress, { cancelledAt: Math.floor(Date.now() / 1000) - 1 });

    const req = new NextRequest(makeUrl(`/api/campaigns/${treeAddress}`));
    const res = await getCampaignByAddress(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as { gracePeriod: { end: unknown; remaining: unknown } };

    expect(typeof json.gracePeriod.end).toBe("string");
    expect(typeof json.gracePeriod.remaining).toBe("string");
  });
});

// ===========================================================================
// F3.3 — Cancel campaign endpoint
// ===========================================================================

describe("POST /api/campaigns/:treeAddress/cancel", () => {
  it("returns valid serialized transaction for a cancellable campaign", async () => {
    const { treeAddress } = await createCampaignViaPost({
      creator: CREATOR_ADDRESS,
      cancellable: true,
      cancelAuthority: CREATOR_ADDRESS,
    });

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/cancel`,
      { cancelAuthority: CREATOR_ADDRESS },
    );
    const res = await cancelCampaign(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as {
      transaction: string;
      signers: string[];
      instruction: string;
    };

    expect(res.status).toBe(200);
    expect(json.transaction).toBe("FakeCancelCampaignTx");
    expect(json.signers).toContain("cancelAuthority");
    expect(json.instruction).toBe("cancel_campaign");
  });

  it("returns 400 NOT_CANCELLABLE for a non-cancellable campaign", async () => {
    const { treeAddress } = await createCampaignViaPost({
      creator: CREATOR_ADDRESS,
      cancellable: false,
      cancelAuthority: null,
    });

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/cancel`,
      { cancelAuthority: CREATOR_ADDRESS },
    );
    const res = await cancelCampaign(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as { code: string };

    expect(res.status).toBe(400);
    expect(json.code).toBe("NOT_CANCELLABLE");
  });

  it("returns 400 ALREADY_CANCELLED for an already-cancelled campaign", async () => {
    const { treeAddress } = await createCampaignViaPost({
      creator: CREATOR_ADDRESS,
      cancellable: true,
      cancelAuthority: CREATOR_ADDRESS,
    });
    await setCampaignStatus(treeAddress, { cancelledAt: Math.floor(Date.now() / 1000) });

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/cancel`,
      { cancelAuthority: CREATOR_ADDRESS },
    );
    const res = await cancelCampaign(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as { code: string };

    expect(res.status).toBe(400);
    expect(json.code).toBe("ALREADY_CANCELLED");
  });

  it("returns 400 FULLY_VESTED when totalClaimed >= totalSupply", async () => {
    const { treeAddress } = await createCampaignViaPost({
      creator: CREATOR_ADDRESS,
      cancellable: true,
      cancelAuthority: CREATOR_ADDRESS,
      totalSupply: "1000000",
    });
    await setCampaignStatus(treeAddress, {
      totalClaimed: "1000000",
      totalSupply: "1000000",
    });

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/cancel`,
      { cancelAuthority: CREATOR_ADDRESS },
    );
    const res = await cancelCampaign(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as { code: string };

    expect(res.status).toBe(400);
    expect(json.code).toBe("FULLY_VESTED");
  });

  it("returns 403 when signer is not the cancel authority", async () => {
    const { treeAddress } = await createCampaignViaPost({
      creator: CREATOR_ADDRESS,
      cancellable: true,
      cancelAuthority: CREATOR_ADDRESS,
    });

    const req = await makeStrangerRequest(
      `/api/campaigns/${treeAddress}/cancel`,
      { cancelAuthority: CREATOR_ADDRESS },
    );
    const res = await cancelCampaign(req, makeContext(treeAddress) as never);

    expect(res.status).toBe(403);
  });

  it("returns 404 for a nonexistent campaign", async () => {
    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/NonExistentAddress11111111111111111/cancel`,
      { cancelAuthority: CREATOR_ADDRESS },
    );
    const res = await cancelCampaign(
      req,
      makeContext("NonExistentAddress11111111111111111") as never,
    );

    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// F3.4 — Withdraw unvested endpoint
// ===========================================================================

describe("POST /api/campaigns/:treeAddress/withdraw-unvested", () => {
  const expiredCancelledAt = () =>
    Math.floor(Date.now() / 1000) - 8 * 24 * 3600; // 8 days ago

  it("returns valid transaction when grace period has expired", async () => {
    const { treeAddress } = await createCampaignViaPost({ creator: CREATOR_ADDRESS });
    await setCampaignStatus(treeAddress, { cancelledAt: expiredCancelledAt() });

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/withdraw-unvested`,
      { creator: CREATOR_ADDRESS, creatorAta: FAKE_ATA },
    );
    const res = await withdrawUnvested(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as {
      transaction: string;
      signers: string[];
      instruction: string;
    };

    expect(res.status).toBe(200);
    expect(json.transaction).toBe("FakeWithdrawUnvestedTx");
    expect(json.signers).toContain("creator");
    expect(json.instruction).toBe("withdraw_unvested");
  });

  it("returns 400 GRACE_PERIOD_ACTIVE when grace period has not expired", async () => {
    const { treeAddress } = await createCampaignViaPost({ creator: CREATOR_ADDRESS });
    const recentCancelledAt = Math.floor(Date.now() / 1000) - 3 * 24 * 3600; // 3 days ago
    await setCampaignStatus(treeAddress, { cancelledAt: recentCancelledAt });

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/withdraw-unvested`,
      { creator: CREATOR_ADDRESS, creatorAta: FAKE_ATA },
    );
    const res = await withdrawUnvested(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as { code: string };

    expect(res.status).toBe(400);
    expect(json.code).toBe("GRACE_PERIOD_ACTIVE");
  });

  it("returns 400 NOT_CANCELLED for a non-cancelled campaign", async () => {
    const { treeAddress } = await createCampaignViaPost({ creator: CREATOR_ADDRESS });

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/withdraw-unvested`,
      { creator: CREATOR_ADDRESS, creatorAta: FAKE_ATA },
    );
    const res = await withdrawUnvested(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as { code: string };

    expect(res.status).toBe(400);
    expect(json.code).toBe("NOT_CANCELLED");
  });

  it("returns 403 when signer is not the creator", async () => {
    const { treeAddress } = await createCampaignViaPost({ creator: CREATOR_ADDRESS });
    await setCampaignStatus(treeAddress, { cancelledAt: expiredCancelledAt() });

    const req = await makeStrangerRequest(
      `/api/campaigns/${treeAddress}/withdraw-unvested`,
      { creator: CREATOR_ADDRESS, creatorAta: FAKE_ATA },
    );
    const res = await withdrawUnvested(req, makeContext(treeAddress) as never);

    expect(res.status).toBe(403);
  });

  it("returns 404 for a nonexistent campaign", async () => {
    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/NonExistentAddress11111111111111111/withdraw-unvested`,
      { creator: CREATOR_ADDRESS, creatorAta: FAKE_ATA },
    );
    const res = await withdrawUnvested(
      req,
      makeContext("NonExistentAddress11111111111111111") as never,
    );

    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// F3.5 — Cancel stream endpoint
// ===========================================================================

describe("POST /api/campaigns/:treeAddress/cancel-stream", () => {
  const validWithdrawArgs = {
    releaseType: 1,
    startTime: "1700000000",
    cliffTime: "1731536000",
    endTime: "1731536000",
    milestoneIdx: 0,
  };

  it("returns valid transaction for a single-recipient cancellable campaign", async () => {
    const { treeAddress } = await createCampaignViaPost({
      creator: CREATOR_ADDRESS,
      cancellable: true,
      cancelAuthority: CREATOR_ADDRESS,
      leafCount: 1,
    });

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/cancel-stream`,
      {
        creator: CREATOR_ADDRESS,
        beneficiary: BENEFICIARY_ADDRESS,
        withdrawArgs: validWithdrawArgs,
        beneficiaryAta: FAKE_ATA,
        creatorAta: FAKE_ATA,
      },
    );
    const res = await cancelStream(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as {
      transaction: string;
      signers: string[];
      instruction: string;
    };

    expect(res.status).toBe(200);
    expect(json.transaction).toBe("FakeCancelStreamTx");
    expect(json.signers).toContain("creator");
    expect(json.instruction).toBe("cancel_stream");
  });

  it("returns 400 NOT_SINGLE_STREAM for a multi-recipient campaign", async () => {
    const { treeAddress } = await createCampaignViaPost({
      creator: CREATOR_ADDRESS,
      cancellable: true,
      cancelAuthority: CREATOR_ADDRESS,
    });
    // Override leafCount to 2
    await setCampaignStatus(treeAddress, { leafCount: 2 });

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/cancel-stream`,
      {
        creator: CREATOR_ADDRESS,
        beneficiary: BENEFICIARY_ADDRESS,
        withdrawArgs: validWithdrawArgs,
        beneficiaryAta: FAKE_ATA,
        creatorAta: FAKE_ATA,
      },
    );
    const res = await cancelStream(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as { code: string };

    expect(res.status).toBe(400);
    expect(json.code).toBe("NOT_SINGLE_STREAM");
  });

  it("returns 400 NOT_CANCELLABLE for a non-cancellable campaign", async () => {
    const { treeAddress } = await createCampaignViaPost({
      creator: CREATOR_ADDRESS,
      cancellable: false,
      cancelAuthority: null,
      leafCount: 1,
    });

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/cancel-stream`,
      {
        creator: CREATOR_ADDRESS,
        beneficiary: BENEFICIARY_ADDRESS,
        withdrawArgs: validWithdrawArgs,
        beneficiaryAta: FAKE_ATA,
        creatorAta: FAKE_ATA,
      },
    );
    const res = await cancelStream(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as { code: string };

    expect(res.status).toBe(400);
    expect(json.code).toBe("NOT_CANCELLABLE");
  });

  it("returns 400 ALREADY_CANCELLED for an already-cancelled campaign", async () => {
    const { treeAddress } = await createCampaignViaPost({
      creator: CREATOR_ADDRESS,
      cancellable: true,
      cancelAuthority: CREATOR_ADDRESS,
      leafCount: 1,
    });
    await setCampaignStatus(treeAddress, { cancelledAt: Math.floor(Date.now() / 1000) });

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/cancel-stream`,
      {
        creator: CREATOR_ADDRESS,
        beneficiary: BENEFICIARY_ADDRESS,
        withdrawArgs: validWithdrawArgs,
        beneficiaryAta: FAKE_ATA,
        creatorAta: FAKE_ATA,
      },
    );
    const res = await cancelStream(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as { code: string };

    expect(res.status).toBe(400);
    expect(json.code).toBe("ALREADY_CANCELLED");
  });

  it("returns 403 when signer is not the creator", async () => {
    const { treeAddress } = await createCampaignViaPost({
      creator: CREATOR_ADDRESS,
      cancellable: true,
      cancelAuthority: CREATOR_ADDRESS,
      leafCount: 1,
    });

    const req = await makeStrangerRequest(
      `/api/campaigns/${treeAddress}/cancel-stream`,
      {
        creator: CREATOR_ADDRESS,
        beneficiary: BENEFICIARY_ADDRESS,
        withdrawArgs: validWithdrawArgs,
        beneficiaryAta: FAKE_ATA,
        creatorAta: FAKE_ATA,
      },
    );
    const res = await cancelStream(req, makeContext(treeAddress) as never);

    expect(res.status).toBe(403);
  });

  it("returns 400 VALIDATION_ERROR when startTime > cliffTime", async () => {
    const { treeAddress } = await createCampaignViaPost({
      creator: CREATOR_ADDRESS,
      cancellable: true,
      cancelAuthority: CREATOR_ADDRESS,
      leafCount: 1,
    });

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/cancel-stream`,
      {
        creator: CREATOR_ADDRESS,
        beneficiary: BENEFICIARY_ADDRESS,
        withdrawArgs: {
          releaseType: 1,
          startTime: "1800000000",
          cliffTime: "1700000000", // cliffTime < startTime
          endTime: "1900000000",
          milestoneIdx: 0,
        },
        beneficiaryAta: FAKE_ATA,
        creatorAta: FAKE_ATA,
      },
    );
    const res = await cancelStream(req, makeContext(treeAddress) as never);

    expect(res.status).toBe(400);
  });

  it("returns 400 VALIDATION_ERROR when releaseType is out of range", async () => {
    const { treeAddress } = await createCampaignViaPost({
      creator: CREATOR_ADDRESS,
      cancellable: true,
      cancelAuthority: CREATOR_ADDRESS,
      leafCount: 1,
    });

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/cancel-stream`,
      {
        creator: CREATOR_ADDRESS,
        beneficiary: BENEFICIARY_ADDRESS,
        withdrawArgs: { ...validWithdrawArgs, releaseType: 99 },
        beneficiaryAta: FAKE_ATA,
        creatorAta: FAKE_ATA,
      },
    );
    const res = await cancelStream(req, makeContext(treeAddress) as never);

    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// F3.6 — Milestone release endpoint
// ===========================================================================

describe("POST /api/campaigns/:treeAddress/milestones/:idx/release", () => {
  it("returns valid transaction for a valid milestone index", async () => {
    const { treeAddress } = await createCampaignViaPost({ creator: CREATOR_ADDRESS });

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/milestones/0/release`,
      { creator: CREATOR_ADDRESS },
    );
    const res = await milestoneRelease(
      req,
      makeContext(treeAddress, "0") as never,
    );
    const json = (await res.json()) as {
      transaction: string;
      signers: string[];
      instruction: string;
    };

    expect(res.status).toBe(200);
    expect(json.transaction).toBe("FakeMilestoneReleaseTx");
    expect(json.signers).toContain("creator");
    expect(json.instruction).toBe("set_milestone_released");
  });

  it("returns 400 for milestone index > 255", async () => {
    const { treeAddress } = await createCampaignViaPost({ creator: CREATOR_ADDRESS });

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/milestones/256/release`,
      { creator: CREATOR_ADDRESS },
    );
    const res = await milestoneRelease(
      req,
      makeContext(treeAddress, "256") as never,
    );

    expect(res.status).toBe(400);
  });

  it("returns 400 for non-integer milestone index", async () => {
    const { treeAddress } = await createCampaignViaPost({ creator: CREATOR_ADDRESS });

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/milestones/abc/release`,
      { creator: CREATOR_ADDRESS },
    );
    const res = await milestoneRelease(
      req,
      makeContext(treeAddress, "abc") as never,
    );

    expect(res.status).toBe(400);
  });

  it("returns 400 MILESTONE_ALREADY_RELEASED for an already-released milestone", async () => {
    const { treeAddress, campaignId } = await createCampaignViaPost({
      creator: CREATOR_ADDRESS,
    });

    // Seed a milestone event for index 3
    await seedMilestoneEvent(campaignId, { milestoneIdx: 3 });

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/milestones/3/release`,
      { creator: CREATOR_ADDRESS },
    );
    const res = await milestoneRelease(
      req,
      makeContext(treeAddress, "3") as never,
    );
    const json = (await res.json()) as { code: string };

    expect(res.status).toBe(400);
    expect(json.code).toBe("MILESTONE_ALREADY_RELEASED");
  });

  it("returns 403 when signer is not the creator", async () => {
    const { treeAddress } = await createCampaignViaPost({ creator: CREATOR_ADDRESS });

    const req = await makeStrangerRequest(
      `/api/campaigns/${treeAddress}/milestones/0/release`,
      { creator: CREATOR_ADDRESS },
    );
    const res = await milestoneRelease(
      req,
      makeContext(treeAddress, "0") as never,
    );

    expect(res.status).toBe(403);
  });

  it("returns 404 for a nonexistent campaign", async () => {
    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/NonExistentAddress11111111111111111/milestones/0/release`,
      { creator: CREATOR_ADDRESS },
    );
    const res = await milestoneRelease(
      req,
      makeContext("NonExistentAddress11111111111111111", "0") as never,
    );

    expect(res.status).toBe(404);
  });
});
