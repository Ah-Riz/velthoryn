import { describe, it, expect, vi, beforeEach } from "vitest";
import { Keypair } from "@solana/web3.js";
import { NextRequest } from "next/server";

vi.mock("@/lib/api/tx-builder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/tx-builder")>();
  return {
    ...actual,
    buildInstantRefundCampaignTx: vi.fn().mockResolvedValue({
      transaction: "FakeInstantRefundTx",
      signers: ["creator"],
      instruction: "instant_refund_campaign",
      accounts: { vestingTree: "fake" },
    }),
  };
});

import { POST as instantRefund } from "@/app/api/campaigns/[treeAddress]/instant-refund/route";
import { buildInstantRefundCampaignTx } from "@/lib/api/tx-builder";
import { resetDb } from "../helpers/db";
import {
  createCampaignViaPost,
  seedMilestoneEvent,
  setCampaignStatus,
} from "../helpers/fixtures";
import {
  makeMultiLeafCampaignBody,
  makeUrl,
  makeAuthenticatedPostRequest,
} from "../helpers/requests";
import { TEST_CREATOR_KEYPAIR, createAuthHeader } from "../helpers/wallet-auth";
import { resetRateLimitForTests } from "@/lib/api/rate-limit";
import { resetRedisForTests } from "@/lib/api/redis";

const CREATOR_ADDRESS = TEST_CREATOR_KEYPAIR.publicKey.toBase58();
const FAKE_ATA = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const STRANGER = Keypair.generate();

function makeContext(treeAddress: string) {
  return { params: Promise.resolve({ treeAddress }) };
}

beforeEach(async () => {
  resetRedisForTests();
  resetRateLimitForTests();
  await resetDb();
  vi.clearAllMocks();
});

describe("POST /api/campaigns/:treeAddress/instant-refund", () => {
  it("returns prepared tx when campaign is eligible", async () => {
    const futureCliff = String(Math.floor(Date.now() / 1000) + 86_400);
    const { treeAddress } = await createCampaignViaPost({
      creator: CREATOR_ADDRESS,
      cancellable: true,
      cancelAuthority: CREATOR_ADDRESS,
      ...makeMultiLeafCampaignBody(2),
    });
    await setCampaignStatus(treeAddress, {
      leafCount: 2,
      minCliffTime: futureCliff,
      instantRefunded: false,
    });

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/instant-refund`,
      { creator: CREATOR_ADDRESS, creatorAta: FAKE_ATA },
    );
    const res = await instantRefund(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as { transaction: string; instruction: string };

    expect(res.status).toBe(200);
    expect(json.instruction).toBe("instant_refund_campaign");
    expect(buildInstantRefundCampaignTx).toHaveBeenCalledOnce();
  });

  it("rejects single-leaf campaigns with NOT_ELIGIBLE_FOR_INSTANT_REFUND", async () => {
    const futureCliff = String(Math.floor(Date.now() / 1000) + 86_400);
    const { treeAddress } = await createCampaignViaPost({
      creator: CREATOR_ADDRESS,
      cancellable: true,
      cancelAuthority: CREATOR_ADDRESS,
      leafCount: 1,
    });
    await setCampaignStatus(treeAddress, { minCliffTime: futureCliff });

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/instant-refund`,
      { creator: CREATOR_ADDRESS, creatorAta: FAKE_ATA },
    );
    const res = await instantRefund(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as { code: string };

    expect(res.status).toBe(400);
    expect(json.code).toBe("NOT_ELIGIBLE_FOR_INSTANT_REFUND");
    expect(buildInstantRefundCampaignTx).not.toHaveBeenCalled();
  });

  it("rejects when campaign has already started", async () => {
    const pastCliff = String(Math.floor(Date.now() / 1000) - 60);
    const { treeAddress } = await createCampaignViaPost({
      creator: CREATOR_ADDRESS,
      cancellable: true,
      cancelAuthority: CREATOR_ADDRESS,
      ...makeMultiLeafCampaignBody(2),
    });
    await setCampaignStatus(treeAddress, { leafCount: 2, minCliffTime: pastCliff });

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/instant-refund`,
      { creator: CREATOR_ADDRESS, creatorAta: FAKE_ATA },
    );
    const res = await instantRefund(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as { code: string };

    expect(res.status).toBe(400);
    expect(json.code).toBe("NOT_ELIGIBLE_FOR_INSTANT_REFUND");
  });

  it("rejects when campaign was already instant-refunded", async () => {
    const futureCliff = String(Math.floor(Date.now() / 1000) + 86_400);
    const { treeAddress } = await createCampaignViaPost({
      creator: CREATOR_ADDRESS,
      cancellable: true,
      cancelAuthority: CREATOR_ADDRESS,
      ...makeMultiLeafCampaignBody(2),
    });
    await setCampaignStatus(treeAddress, {
      leafCount: 2,
      minCliffTime: futureCliff,
      instantRefunded: true,
    });

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/instant-refund`,
      { creator: CREATOR_ADDRESS, creatorAta: FAKE_ATA },
    );
    const res = await instantRefund(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as { code: string };

    expect(res.status).toBe(400);
    expect(json.code).toBe("NOT_ELIGIBLE_FOR_INSTANT_REFUND");
  });

  it("rejects when a milestone has been released", async () => {
    const futureCliff = String(Math.floor(Date.now() / 1000) + 86_400);
    const { treeAddress, campaignId } = await createCampaignViaPost({
      creator: CREATOR_ADDRESS,
      cancellable: true,
      cancelAuthority: CREATOR_ADDRESS,
      ...makeMultiLeafCampaignBody(2),
    });
    await setCampaignStatus(treeAddress, { leafCount: 2, minCliffTime: futureCliff });
    await seedMilestoneEvent(campaignId);

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/instant-refund`,
      { creator: CREATOR_ADDRESS, creatorAta: FAKE_ATA },
    );
    const res = await instantRefund(req, makeContext(treeAddress) as never);
    const json = (await res.json()) as { code: string };

    expect(res.status).toBe(400);
    expect(json.code).toBe("NOT_ELIGIBLE_FOR_INSTANT_REFUND");
  });

  it("returns 403 when signer is not the creator", async () => {
    const futureCliff = String(Math.floor(Date.now() / 1000) + 86_400);
    const { treeAddress } = await createCampaignViaPost({
      creator: CREATOR_ADDRESS,
      cancellable: true,
      cancelAuthority: CREATOR_ADDRESS,
      ...makeMultiLeafCampaignBody(2),
    });
    await setCampaignStatus(treeAddress, { leafCount: 2, minCliffTime: futureCliff });

    resetRedisForTests();
    const authorization = await createAuthHeader(STRANGER);
    const req = new NextRequest(makeUrl(`/api/campaigns/${treeAddress}/instant-refund`), {
      method: "POST",
      body: JSON.stringify({ creator: CREATOR_ADDRESS, creatorAta: FAKE_ATA }),
      headers: { authorization, "content-type": "application/json" },
    });
    const res = await instantRefund(req, makeContext(treeAddress) as never);

    expect(res.status).toBe(403);
  });
});
