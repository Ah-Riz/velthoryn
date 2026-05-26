import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { Keypair, PublicKey } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Module mocks (claim-events only — DB uses real Postgres)
// ---------------------------------------------------------------------------

vi.mock("@/lib/indexer/claim-events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/indexer/claim-events")>();
  return {
    ...actual,
    syncClaimEvents: vi.fn(),
  };
});

vi.mock("@/lib/indexer/event-indexer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/indexer/event-indexer")>();
  return {
    ...actual,
    indexAllEvents: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Route handler imports (after mocks)
// ---------------------------------------------------------------------------

import {
  POST as postCampaigns,
  GET as getCampaigns,
} from "@/app/api/campaigns/route";
import { GET as getCampaignByAddress } from "@/app/api/campaigns/[treeAddress]/route";
import { GET as getProof } from "@/app/api/campaigns/[treeAddress]/proof/route";
import { POST as postRootVersion } from "@/app/api/campaigns/[treeAddress]/root-versions/route";
import { GET as getClaims } from "@/app/api/campaigns/[treeAddress]/claims/route";
import { GET as getBeneficiaryCampaigns } from "@/app/api/beneficiary/[address]/campaigns/route";
import { POST as postAdminSync } from "@/app/api/admin/sync/route";

import {
  createCampaignRequestSchema,
  createRootVersionRequestSchema,
} from "@/lib/api/validators";
import {
  buildCreateCampaignIndexPayload,
  prepareBulkCampaign,
} from "@/lib/campaign/bulk";
import {
  syncClaimEvents,
  parseClaimedEvent,
  CLAIMED_DISCRIMINATOR,
} from "@/lib/indexer/claim-events";
import { indexAllEvents } from "@/lib/indexer/event-indexer";

import { resetDb } from "../helpers/db";
import {
  CREATOR,
  MINT,
  BENEFICIARY,
  OTHER_BENEFICIARY,
  EMPTY_SIBLING,
  makeLeaf,
  makeCampaignBody,
  makeTwoLeafCampaignBody,
  makeMultiLeafCampaignBody,
  computeSingleLeafRoot,
  makeUrl,
  makeAuthenticatedPostRequest,
} from "../helpers/requests";
import {
  uniqueTreeAddress,
  createCampaignViaPost,
  seedClaimEvent,
  setCampaignStatus,
} from "../helpers/fixtures";
import { resetRateLimitForTests } from "@/lib/api/rate-limit";
import { resetRedisForTests } from "@/lib/api/redis";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TREE_ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

// ---------------------------------------------------------------------------
// Reset DB and mocks between tests
// ---------------------------------------------------------------------------

beforeEach(async () => {
  resetRedisForTests();
  resetRateLimitForTests();
  await resetDb();
  vi.clearAllMocks();
});

// ===========================================================================
// 1. Zod Validators
// ===========================================================================

describe("Zod Validators", () => {
  describe("createCampaignRequestSchema", () => {
    const validBody = makeCampaignBody({
      merkleRoot: computeSingleLeafRoot(makeLeaf()),
    });

    it("accepts a valid full request body", () => {
      const result = createCampaignRequestSchema.safeParse(validBody);
      expect(result.success).toBe(true);
    });

    it("accepts body without metadata", () => {
      const { metadata: _metadata, ...rest } = validBody;
      const result = createCampaignRequestSchema.safeParse(rest);
      expect(result.success).toBe(true);
    });

    it("accepts body without ipfsCid", () => {
      const { ipfsCid: _ipfsCid, ...rest } = validBody;
      const result = createCampaignRequestSchema.safeParse(rest);
      expect(result.success).toBe(true);
    });

    it("rejects missing treeAddress", () => {
      const { treeAddress: _treeAddress, ...rest } = validBody;
      const result = createCampaignRequestSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects missing creator", () => {
      const { creator: _creator, ...rest } = validBody;
      const result = createCampaignRequestSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects missing mint", () => {
      const { mint: _mint, ...rest } = validBody;
      const result = createCampaignRequestSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects invalid merkleRoot (wrong length)", () => {
      const result = createCampaignRequestSchema.safeParse({
        ...validBody,
        merkleRoot: "abc123",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid merkleRoot (non-hex)", () => {
      const result = createCampaignRequestSchema.safeParse({
        ...validBody,
        merkleRoot: "z".repeat(64),
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid base58 beneficiary (too short)", () => {
      const result = createCampaignRequestSchema.safeParse({
        ...validBody,
        leaves: [{ ...validBody.leaves[0], beneficiary: "short" }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid base58 beneficiary (contains invalid chars)", () => {
      const result = createCampaignRequestSchema.safeParse({
        ...validBody,
        leaves: [{ ...validBody.leaves[0], beneficiary: "0".repeat(32) }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-numeric amount string", () => {
      const result = createCampaignRequestSchema.safeParse({
        ...validBody,
        leaves: [{ ...validBody.leaves[0], amount: "not-a-number" }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-numeric startTime string", () => {
      const result = createCampaignRequestSchema.safeParse({
        ...validBody,
        leaves: [{ ...validBody.leaves[0], startTime: "abc" }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects proof that is not an array of 32-element uint8 arrays", () => {
      const result = createCampaignRequestSchema.safeParse({
        ...validBody,
        leaves: [{ ...validBody.leaves[0], proof: [[1, 2, 3]] }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects proof with values > 255", () => {
      const result = createCampaignRequestSchema.safeParse({
        ...validBody,
        leaves: [
          {
            ...validBody.leaves[0],
            proof: [new Array(32).fill(300)],
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it("rejects leafCount < 1", () => {
      const result = createCampaignRequestSchema.safeParse({
        ...validBody,
        leafCount: 0,
      });
      expect(result.success).toBe(false);
    });

    it("rejects leafCount as negative number", () => {
      const result = createCampaignRequestSchema.safeParse({
        ...validBody,
        leafCount: -1,
      });
      expect(result.success).toBe(false);
    });

    it("accepts valid metadata fields", () => {
      const result = createCampaignRequestSchema.safeParse({
        ...validBody,
        metadata: {
          name: "Test Campaign",
          description: "A test",
          logoUri: "https://example.com/logo.png",
        },
      });
      expect(result.success).toBe(true);
    });

    it("defaults cancellable to false when omitted", () => {
      const { cancellable: _cancellable, ...rest } = validBody;
      const result = createCampaignRequestSchema.safeParse(rest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cancellable).toBe(false);
      }
    });

    it("rejects empty leaves array", () => {
      const result = createCampaignRequestSchema.safeParse({
        ...validBody,
        leaves: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("createRootVersionRequestSchema", () => {
    const validBody = {
      merkleRoot: "a".repeat(64),
      leafCount: 2,
      leaves: [makeLeaf(), makeLeaf({ leafIndex: 1 })],
    };

    it("accepts a valid request body", () => {
      const result = createRootVersionRequestSchema.safeParse(validBody);
      expect(result.success).toBe(true);
    });

    it("rejects invalid merkleRoot (wrong length)", () => {
      const result = createRootVersionRequestSchema.safeParse({
        ...validBody,
        merkleRoot: "short",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid merkleRoot (non-hex)", () => {
      const result = createRootVersionRequestSchema.safeParse({
        ...validBody,
        merkleRoot: "g".repeat(64),
      });
      expect(result.success).toBe(false);
    });

    it("rejects leafCount < 1", () => {
      const result = createRootVersionRequestSchema.safeParse({
        ...validBody,
        leafCount: 0,
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty leaves array", () => {
      const result = createRootVersionRequestSchema.safeParse({
        ...validBody,
        leaves: [],
      });
      expect(result.success).toBe(false);
    });

    it("accepts optional ipfsCid", () => {
      const result = createRootVersionRequestSchema.safeParse({
        ...validBody,
        ipfsCid: "QmSomeHash",
      });
      expect(result.success).toBe(true);
    });
  });
});

// ===========================================================================
// 2. POST /api/campaigns
// ===========================================================================

describe("POST /api/campaigns", () => {
  it("returns 201 with { ok: true, campaignId } for valid creation", async () => {
    const leaf = makeLeaf();
    const merkleRoot = computeSingleLeafRoot(leaf);
    const body = makeCampaignBody({ treeAddress: uniqueTreeAddress(), merkleRoot, leaves: [leaf] });

    const req = await makeAuthenticatedPostRequest("/api/campaigns", body);

    const res = await postCampaigns(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.campaignId).toBeGreaterThan(0);
  });

  it("returns 200 with existing campaignId for idempotent request (same treeAddress)", async () => {
    const leaf = makeLeaf();
    const merkleRoot = computeSingleLeafRoot(leaf);
    const treeAddress = uniqueTreeAddress();
    const body = makeCampaignBody({ treeAddress, merkleRoot, leaves: [leaf] });

    const req1 = await makeAuthenticatedPostRequest("/api/campaigns", body);
    const res1 = await postCampaigns(req1);
    const json1 = await res1.json();

    expect([200, 201]).toContain(res1.status);
    expect(json1.campaignId).toBeGreaterThan(0);

    const req2 = await makeAuthenticatedPostRequest("/api/campaigns", body);
    const res2 = await postCampaigns(req2);
    const json2 = await res2.json();

    expect(res2.status).toBe(200);
    expect(json2.ok).toBe(true);
    expect(json2.campaignId).toBe(json1.campaignId);
  });

  it("accepts a valid multi-leaf payload built by the frontend bulk helpers", async () => {
    const prepared = prepareBulkCampaign([
      {
        rowNumber: 2,
        beneficiary: BENEFICIARY,
        amountInput: "1",
        amountRaw: "1000000",
        releaseType: 0,
        startTime: 1700000000,
        cliffTime: 1700003600,
        endTime: 1700003600,
        milestoneIdx: 0,
      },
      {
        rowNumber: 3,
        beneficiary: OTHER_BENEFICIARY,
        amountInput: "2.5",
        amountRaw: "2500000",
        releaseType: 1,
        startTime: 1700000000,
        cliffTime: 1700003600,
        endTime: 1731536000,
        milestoneIdx: 0,
      },
    ]);

    const body = buildCreateCampaignIndexPayload({
      treeAddress: uniqueTreeAddress(),
      creator: CREATOR,
      mint: MINT,
      campaignId: Math.floor(Math.random() * 9_000_000_000_000) + 1_000_000_000_000,
      cancellable: true,
      cancelAuthority: CREATOR,
      pauseAuthority: CREATOR,
      createdAt: Math.floor(Date.now() / 1000),
      prepared,
    });

    const req = await makeAuthenticatedPostRequest("/api/campaigns", body);

    const res = await postCampaigns(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.campaignId).toBeGreaterThan(0);
  });

  it("returns 400 for validation failure", async () => {
    const body = { invalid: "data" };

    const req = await makeAuthenticatedPostRequest("/api/campaigns", body);

    const res = await postCampaigns(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Validation failed");
    expect(json.details).toBeDefined();
  });

  it("returns 400 when leafCount does not match leaves array length", async () => {
    const leaf = makeLeaf();
    const merkleRoot = computeSingleLeafRoot(leaf);
    const body = makeCampaignBody({
      treeAddress: uniqueTreeAddress(),
      merkleRoot,
      leaves: [leaf],
      leafCount: 2,
    });

    const req = await makeAuthenticatedPostRequest("/api/campaigns", body);

    const res = await postCampaigns(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("leafCount");
    expect(json.error).toContain("does not match");
  });

  it("returns 400 when single-leaf root does not match leaf hash", async () => {
    const leaf = makeLeaf();
    const body = makeCampaignBody({
      treeAddress: uniqueTreeAddress(),
      merkleRoot: "b".repeat(64),
      leaves: [leaf],
    });

    const req = await makeAuthenticatedPostRequest("/api/campaigns", body);

    const res = await postCampaigns(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("root does not match leaf hash");
  });

  it("returns 400 when multi-leaf proof verification fails", async () => {
    const leaf0 = makeLeaf({ leafIndex: 0, proof: [EMPTY_SIBLING] });
    const leaf1 = makeLeaf({
      leafIndex: 1,
      beneficiary: OTHER_BENEFICIARY,
      proof: [EMPTY_SIBLING],
    });

    const body = makeCampaignBody({
      treeAddress: uniqueTreeAddress(),
      merkleRoot: "c".repeat(64),
      leafCount: 2,
      leaves: [leaf0, leaf1],
    });

    const req = await makeAuthenticatedPostRequest("/api/campaigns", body);

    const res = await postCampaigns(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Proof verification failed");
  });
});

// ===========================================================================
// 3. GET /api/campaigns
// ===========================================================================

describe("GET /api/campaigns", () => {
  it("returns paginated campaigns list", async () => {
    const { treeAddress } = await createCampaignViaPost();

    const req = new NextRequest(makeUrl("/api/campaigns"));
    const res = await getCampaigns(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.campaigns.length).toBeGreaterThanOrEqual(1);
    expect(json.total).toBeGreaterThanOrEqual(1);
    expect(json.page).toBe(1);
    expect(json.limit).toBe(20);
    expect(json.campaigns.some((c: { treeAddress: string }) => c.treeAddress === treeAddress)).toBe(
      true,
    );
  });

  it("filters by creator", async () => {
    await createCampaignViaPost({ treeAddress: uniqueTreeAddress() });

    const req = new NextRequest(
      makeUrl("/api/campaigns", { creator: CREATOR }),
    );
    const res = await getCampaigns(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.total).toBeGreaterThanOrEqual(1);
    expect(json.campaigns.every((c: { creator: string }) => c.creator === CREATOR)).toBe(true);

    const emptyReq = new NextRequest(
      makeUrl("/api/campaigns", { creator: "33333333333333333333333333333333" }),
    );
    const emptyRes = await getCampaigns(emptyReq);
    const emptyJson = await emptyRes.json();

    expect(emptyJson.total).toBe(0);
  });

  it("filters by mint", async () => {
    await createCampaignViaPost({ treeAddress: uniqueTreeAddress() });

    const req = new NextRequest(makeUrl("/api/campaigns", { mint: MINT }));
    const res = await getCampaigns(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.total).toBeGreaterThanOrEqual(1);
    expect(json.campaigns.every((c: { mint: string }) => c.mint === MINT)).toBe(true);

    const emptyReq = new NextRequest(
      makeUrl("/api/campaigns", { mint: "33333333333333333333333333333335" }),
    );
    const emptyRes = await getCampaigns(emptyReq);
    const emptyJson = await emptyRes.json();

    expect(emptyJson.total).toBe(0);
  });

  it("uses default pagination (page=1, limit=20)", async () => {
    await createCampaignViaPost({ treeAddress: uniqueTreeAddress() });

    const req = new NextRequest(makeUrl("/api/campaigns"));
    const res = await getCampaigns(req);
    const json = await res.json();

    expect(json.page).toBe(1);
    expect(json.limit).toBe(20);
  });

  it("applies custom pagination", async () => {
    await createCampaignViaPost({ treeAddress: uniqueTreeAddress() });
    await createCampaignViaPost({ treeAddress: uniqueTreeAddress() });

    const req = new NextRequest(
      makeUrl("/api/campaigns", { page: "1", limit: "1" }),
    );
    const res = await getCampaigns(req);
    const json = await res.json();

    expect(json.page).toBe(1);
    expect(json.limit).toBe(1);
    expect(json.campaigns).toHaveLength(1);
    expect(json.total).toBeGreaterThanOrEqual(2);
  });

  it("filters by status=active (not paused, not cancelled)", { timeout: 15000 }, async () => {
    const active = await createCampaignViaPost({ treeAddress: uniqueTreeAddress() });
    const paused = await createCampaignViaPost({ treeAddress: uniqueTreeAddress() });
    const cancelled = await createCampaignViaPost({ treeAddress: uniqueTreeAddress() });

    await setCampaignStatus(paused.treeAddress, { paused: true });
    await setCampaignStatus(cancelled.treeAddress, { cancelledAt: 1700000001 });

    const req = new NextRequest(makeUrl("/api/campaigns", { status: "active" }));
    const res = await getCampaigns(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    const addresses = json.campaigns.map((c: { treeAddress: string }) => c.treeAddress);
    expect(addresses).toContain(active.treeAddress);
    expect(addresses).not.toContain(paused.treeAddress);
    expect(addresses).not.toContain(cancelled.treeAddress);
  });

  it("filters by status=paused", async () => {
    const active = await createCampaignViaPost({ treeAddress: uniqueTreeAddress() });
    const paused = await createCampaignViaPost({ treeAddress: uniqueTreeAddress() });

    await setCampaignStatus(paused.treeAddress, { paused: true });

    const req = new NextRequest(makeUrl("/api/campaigns", { status: "paused" }));
    const res = await getCampaigns(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    const addresses = json.campaigns.map((c: { treeAddress: string }) => c.treeAddress);
    expect(addresses).toContain(paused.treeAddress);
    expect(addresses).not.toContain(active.treeAddress);
  });

  it("filters by status=cancelled", async () => {
    const active = await createCampaignViaPost({ treeAddress: uniqueTreeAddress() });
    const cancelled = await createCampaignViaPost({ treeAddress: uniqueTreeAddress() });

    await setCampaignStatus(cancelled.treeAddress, { cancelledAt: 1700000001 });

    const req = new NextRequest(makeUrl("/api/campaigns", { status: "cancelled" }));
    const res = await getCampaigns(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    const addresses = json.campaigns.map((c: { treeAddress: string }) => c.treeAddress);
    expect(addresses).toContain(cancelled.treeAddress);
    expect(addresses).not.toContain(active.treeAddress);
  });
});

// ===========================================================================
// 4. GET /api/campaigns/[treeAddress]
// ===========================================================================

describe("GET /api/campaigns/[treeAddress]", () => {
  it("returns campaign detail with analytics", async () => {
    const treeAddress = uniqueTreeAddress();
    const { campaignId } = await createCampaignViaPost({ treeAddress });

    await seedClaimEvent(campaignId, {
      beneficiary: BENEFICIARY,
      amount: 100000,
      totalClaimedByUser: 100000,
      totalClaimedOverall: 100000,
    });
    await seedClaimEvent(campaignId, {
      beneficiary: BENEFICIARY,
      amount: 150000,
      totalClaimedByUser: 250000,
      totalClaimedOverall: 250000,
    });
    await seedClaimEvent(campaignId, {
      beneficiary: OTHER_BENEFICIARY,
      amount: 50000,
      totalClaimedByUser: 50000,
      totalClaimedOverall: 300000,
    });

    const req = new NextRequest(makeUrl(`/api/campaigns/${treeAddress}`));
    const res = await getCampaignByAddress(req, {
      params: Promise.resolve({ treeAddress }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.treeAddress).toBe(treeAddress);
    expect(json.analytics).toBeDefined();
    expect(json.analytics.uniqueClaimers).toBe(2);
    expect(json.analytics.claimCount).toBe(3);
    expect(json.analytics.percentClaimed).toBeDefined();
    expect(typeof json.analytics.percentClaimed).toBe("number");
    expect(json.rootVersions).toHaveLength(1);
  });

  it("returns 404 for non-existent campaign", async () => {
    const req = new NextRequest(makeUrl("/api/campaigns/nonexistent"));
    const res = await getCampaignByAddress(req, {
      params: Promise.resolve({ treeAddress: "nonexistent" }),
    });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain("not found");
  });
});

// ===========================================================================
// 5. GET /api/campaigns/[treeAddress]/proof
// ===========================================================================

describe("GET /api/campaigns/[treeAddress]/proof", () => {
  it("returns leaf + proof for beneficiary", async () => {
    const treeAddress = uniqueTreeAddress();
    await createCampaignViaPost({ treeAddress });

    const req = new NextRequest(
      makeUrl(`/api/campaigns/${treeAddress}/proof`, {
        beneficiary: BENEFICIARY,
      }),
    );
    const res = await getProof(req, {
      params: Promise.resolve({ treeAddress }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.leaf).toBeDefined();
    expect(json.leaf.beneficiary).toBe(BENEFICIARY);
    expect(json.proof).toBeDefined();
    expect(json.merkleRoot).toBeDefined();
    expect(json.treeAddress).toBe(treeAddress);
  });

  it("returns 400 if beneficiary param missing", async () => {
    const req = new NextRequest(makeUrl(`/api/campaigns/${TREE_ADDRESS}/proof`));
    const res = await getProof(req, {
      params: Promise.resolve({ treeAddress: TREE_ADDRESS }),
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("beneficiary");
  });

  it("returns 404 if campaign not found", async () => {
    const req = new NextRequest(
      makeUrl("/api/campaigns/nonexistent/proof", {
        beneficiary: BENEFICIARY,
      }),
    );
    const res = await getProof(req, {
      params: Promise.resolve({ treeAddress: "nonexistent" }),
    });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain("not found");
  });

  it("returns 404 if no leaf for beneficiary", async () => {
    const { treeAddress } = await createCampaignViaPost({
      treeAddress: uniqueTreeAddress(),
      leaf: { beneficiary: OTHER_BENEFICIARY },
    });

    const req = new NextRequest(
      makeUrl(`/api/campaigns/${treeAddress}/proof`, {
        beneficiary: BENEFICIARY,
      }),
    );
    const res = await getProof(req, {
      params: Promise.resolve({ treeAddress }),
    });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error.toLowerCase()).toContain("proof");
  });
});

// ===========================================================================
// 6. POST /api/campaigns/[treeAddress]/root-versions
// ===========================================================================

describe("POST /api/campaigns/[treeAddress]/root-versions", () => {
  it("creates new root version and returns 201 with version number", async () => {
    const treeAddress = uniqueTreeAddress();
    await createCampaignViaPost({ treeAddress });

    const body = makeMultiLeafCampaignBody(3);

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/root-versions`,
      body,
    );
    const res = await postRootVersion(req, {
      params: Promise.resolve({ treeAddress }),
    });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.version).toBe(2);
  });

  it("returns 404 for non-existent campaign", async () => {
    const leaf = makeLeaf();
    const body = {
      merkleRoot: computeSingleLeafRoot(leaf),
      leafCount: 1,
      leaves: [{ ...leaf, proof: [] }],
    };

    const req = await makeAuthenticatedPostRequest(
      "/api/campaigns/nonexistent/root-versions",
      body,
    );
    const res = await postRootVersion(req, {
      params: Promise.resolve({ treeAddress: "nonexistent" }),
    });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain("not found");
  });

  it("returns 400 for validation failure", async () => {
    const body = { invalid: "data" };

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${TREE_ADDRESS}/root-versions`,
      body,
    );
    const res = await postRootVersion(req, {
      params: Promise.resolve({ treeAddress: TREE_ADDRESS }),
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Validation failed");
  });
});

// ===========================================================================
// 7. GET /api/campaigns/[treeAddress]/claims
// ===========================================================================

describe("GET /api/campaigns/[treeAddress]/claims", () => {
  it("returns paginated claims", async () => {
    const treeAddress = uniqueTreeAddress();
    const { campaignId } = await createCampaignViaPost({ treeAddress });

    await seedClaimEvent(campaignId, {
      beneficiary: BENEFICIARY,
      amount: 100000,
      totalClaimedByUser: 100000,
      totalClaimedOverall: 100000,
    });

    const req = new NextRequest(makeUrl(`/api/campaigns/${treeAddress}/claims`));
    const res = await getClaims(req, {
      params: Promise.resolve({ treeAddress }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.claims).toHaveLength(1);
    expect(json.total).toBe(1);
    expect(json.claims[0].beneficiary).toBe(BENEFICIARY);
  });

  it("filters by beneficiary", async () => {
    const { treeAddress, campaignId } = await createCampaignViaPost({
      treeAddress: uniqueTreeAddress(),
    });

    await seedClaimEvent(campaignId, {
      beneficiary: BENEFICIARY,
    });

    const req = new NextRequest(
      makeUrl(`/api/campaigns/${treeAddress}/claims`, {
        beneficiary: OTHER_BENEFICIARY,
      }),
    );
    const res = await getClaims(req, {
      params: Promise.resolve({ treeAddress }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.total).toBe(0);
    expect(json.claims).toHaveLength(0);
  });

  it("filters by fromSlot", async () => {
    const { treeAddress, campaignId } = await createCampaignViaPost({
      treeAddress: uniqueTreeAddress(),
    });

    await seedClaimEvent(campaignId, { slot: 1000 });

    const req = new NextRequest(
      makeUrl(`/api/campaigns/${treeAddress}/claims`, {
        fromSlot: "5000",
      }),
    );
    const res = await getClaims(req, {
      params: Promise.resolve({ treeAddress }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.total).toBe(0);
    expect(json.claims).toHaveLength(0);
  });

  it("returns 404 for non-existent campaign", async () => {
    const req = new NextRequest(
      makeUrl("/api/campaigns/11111111111111111111111111111111/claims"),
    );
    const res = await getClaims(req, {
      params: Promise.resolve({ treeAddress: "11111111111111111111111111111111" }),
    });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain("not found");
  });
});

// ===========================================================================
// 8. GET /api/beneficiary/[address]/campaigns
// ===========================================================================

describe("GET /api/beneficiary/[address]/campaigns", () => {
  it("returns campaigns where address is beneficiary", { timeout: 15000 }, async () => {
    const treeAddress = uniqueTreeAddress();
    await createCampaignViaPost({ treeAddress });

    const req = new NextRequest(makeUrl(`/api/beneficiary/${BENEFICIARY}/campaigns`));
    const res = await getBeneficiaryCampaigns(req, {
      params: Promise.resolve({ address: BENEFICIARY }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.campaigns.length).toBeGreaterThanOrEqual(1);
    expect(json.campaigns.some((c: { treeAddress: string }) => c.treeAddress === treeAddress)).toBe(
      true,
    );
    expect(json.campaigns[0].myLeaf).toBeDefined();
    expect(json.campaigns[0].myLeaf.amount).toBe("1000000");
  });

  it("returns empty array if no campaigns found", async () => {
    const unknownBeneficiary = Keypair.generate().publicKey.toBase58();
    const req = new NextRequest(
      makeUrl(`/api/beneficiary/${unknownBeneficiary}/campaigns`),
    );
    const res = await getBeneficiaryCampaigns(req, {
      params: Promise.resolve({ address: unknownBeneficiary }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.campaigns).toEqual([]);
  });
});

// ===========================================================================
// 9. POST /api/admin/sync
// ===========================================================================

describe("POST /api/admin/sync", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns 401 without x-admin-key header", async () => {
    process.env.ADMIN_API_KEY = "super-secret-key";

    const req = new NextRequest(makeUrl("/api/admin/sync"), {
      method: "POST",
    });
    const res = await postAdminSync(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 401 with wrong admin key", async () => {
    process.env.ADMIN_API_KEY = "super-secret-key";

    const req = new NextRequest(makeUrl("/api/admin/sync"), {
      method: "POST",
      headers: { "x-admin-key": "wrong-key" },
    });
    const res = await postAdminSync(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 401 when ADMIN_API_KEY env var is not set", async () => {
    delete process.env.ADMIN_API_KEY;

    const req = new NextRequest(makeUrl("/api/admin/sync"), {
      method: "POST",
      headers: { "x-admin-key": "any-key" },
    });
    const res = await postAdminSync(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe("Unauthorized");
  });

  it("returns { ok, processed, lastSlot } with valid key", async () => {
    process.env.ADMIN_API_KEY = "super-secret-key";

    vi.mocked(indexAllEvents).mockResolvedValue({
      processed: 42,
      lastSlot: 12345,
      byType: { claimed: 42, cancelled: 0, paused: 0, root_updated: 0, withdrawn: 0, milestone_released: 0, stream_cancelled: 0 },
    });

    const req = new NextRequest(makeUrl("/api/admin/sync"), {
      method: "POST",
      headers: { "x-admin-key": "super-secret-key" },
      body: JSON.stringify({ fromSlot: 10000 }),
    });
    const res = await postAdminSync(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.processed).toBe(42);
    expect(json.lastSlot).toBe(12345);
    expect(indexAllEvents).toHaveBeenCalledWith(10000);
  });

  it("calls indexAllEvents without fromSlot if body has none", async () => {
    process.env.ADMIN_API_KEY = "super-secret-key";

    vi.mocked(indexAllEvents).mockResolvedValue({
      processed: 0,
      lastSlot: 0,
      byType: { claimed: 0, cancelled: 0, paused: 0, root_updated: 0, withdrawn: 0, milestone_released: 0, stream_cancelled: 0 },
    });

    const req = new NextRequest(makeUrl("/api/admin/sync"), {
      method: "POST",
      headers: { "x-admin-key": "super-secret-key" },
    });
    const res = await postAdminSync(req);

    expect(res.status).toBe(200);
    expect(indexAllEvents).toHaveBeenCalledWith(undefined);
  });

  it("returns 500 when indexAllEvents throws", async () => {
    process.env.ADMIN_API_KEY = "super-secret-key";

    vi.mocked(indexAllEvents).mockRejectedValue(new Error("RPC connection failed"));

    const req = new NextRequest(makeUrl("/api/admin/sync"), {
      method: "POST",
      headers: { "x-admin-key": "super-secret-key" },
    });
    const res = await postAdminSync(req);

    expect(res.status).toBe(500);
  });
});

// ===========================================================================
// 10. Indexer Event Parsing (parseClaimedEvent logic)
// ===========================================================================

describe("parseClaimedEvent logic (unit test of event parsing)", () => {
  const TREE_KEY = new PublicKey(TREE_ADDRESS);
  const BENE_KEY = new PublicKey(BENEFICIARY);

  function makeValidEventBuffer(
    overrides: {
      milestoneFlag?: number;
      milestoneIdx?: number;
      truncateTo?: number;
      wrongDiscriminator?: boolean;
    } = {},
  ): Buffer {
    const buf = Buffer.alloc(102);
    CLAIMED_DISCRIMINATOR.copy(buf, 0);
    TREE_KEY.toBuffer().copy(buf, 8);
    BENE_KEY.toBuffer().copy(buf, 40);
    buf.writeUInt32LE(42, 72);
    buf.writeBigUInt64LE(BigInt(1000000), 76);
    buf.writeBigUInt64LE(BigInt(1000000), 84);
    buf.writeBigUInt64LE(BigInt(5000000), 92);

    const milestoneFlag = overrides.milestoneFlag ?? 0;
    buf.writeUInt8(milestoneFlag, 100);

    if (overrides.milestoneIdx !== undefined) {
      buf.writeUInt8(overrides.milestoneIdx, 101);
    }

    if (overrides.truncateTo !== undefined) {
      return buf.subarray(0, overrides.truncateTo);
    }

    if (overrides.wrongDiscriminator) {
      buf.writeUInt8(0xff, 0);
    }

    return buf;
  }

  it("correctly parses a valid Claimed event buffer", () => {
    const buf = makeValidEventBuffer();
    const result = parseClaimedEvent(buf);

    expect(result).not.toBeNull();
    expect(result!.tree).toBe(TREE_KEY.toBase58());
    expect(result!.beneficiary).toBe(BENE_KEY.toBase58());
    expect(result!.leafIndex).toBe(42);
    expect(result!.amount).toBe("1000000");
    expect(result!.totalClaimedByUser).toBe("1000000");
    expect(result!.totalClaimedOverall).toBe("5000000");
  });

  it("returns null for wrong discriminator", () => {
    const buf = makeValidEventBuffer({ wrongDiscriminator: true });
    const result = parseClaimedEvent(buf);
    expect(result).toBeNull();
  });

  it("returns null for too-short buffer (< 100 bytes)", () => {
    const buf = makeValidEventBuffer({ truncateTo: 50 });
    const result = parseClaimedEvent(buf);
    expect(result).toBeNull();
  });

  it("returns null for exactly 99 bytes (one short)", () => {
    const buf = makeValidEventBuffer({ truncateTo: 99 });
    const result = parseClaimedEvent(buf);
    expect(result).toBeNull();
  });

  it("returns milestoneIdx = null when option flag is 0", () => {
    const buf = makeValidEventBuffer({ milestoneFlag: 0 });
    const result = parseClaimedEvent(buf);
    expect(result!.milestoneIdx).toBeNull();
  });

  it("returns milestoneIdx when option flag is 1", () => {
    const buf = makeValidEventBuffer({ milestoneFlag: 1, milestoneIdx: 3 });
    const result = parseClaimedEvent(buf);
    expect(result!.milestoneIdx).toBe(3);
  });

  it("returns milestoneIdx = null when option flag is 1 but buffer too short for value", () => {
    const buf = makeValidEventBuffer({ milestoneFlag: 1, truncateTo: 101 });
    const result = parseClaimedEvent(buf);
    expect(result!.milestoneIdx).toBeNull();
  });
});

// ===========================================================================
// 11. Merkle Proof Verification (indirect via POST /api/campaigns)
// ===========================================================================

describe("Merkle proof verification (indirect)", () => {
  it("single-leaf tree: accepts correct root that equals leaf hash", async () => {
    const leaf = makeLeaf();
    const correctRoot = computeSingleLeafRoot(leaf);
    const body = makeCampaignBody({
      treeAddress: uniqueTreeAddress(),
      merkleRoot: correctRoot,
      leaves: [leaf],
    });

    const req = await makeAuthenticatedPostRequest("/api/campaigns", body);
    const res = await postCampaigns(req);

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.campaignId).toBeGreaterThan(0);
  });

  it("persists u64 amounts larger than MAX_SAFE_INTEGER as strings", async () => {
    const large = "9007199254740992"; // MAX_SAFE_INTEGER + 1
    const leaf = makeLeaf({ amount: large });
    const body = makeCampaignBody({
      treeAddress: uniqueTreeAddress(),
      merkleRoot: computeSingleLeafRoot(leaf),
      totalSupply: large,
      leaves: [leaf],
    });

    const req = await makeAuthenticatedPostRequest("/api/campaigns", body);
    const res = await postCampaigns(req);
    expect(res.status).toBe(201);

    const detailReq = new NextRequest(
      makeUrl(`/api/campaigns/${body.treeAddress}`),
    );
    const detailRes = await getCampaignByAddress(detailReq, {
      params: Promise.resolve({ treeAddress: body.treeAddress }),
    });
    const detail = await detailRes.json();
    expect(detail.totalSupply).toBe(large);
  });

  it("rejects valid leaf 0 and invalid leaf 1 proof", async () => {
    const body = makeTwoLeafCampaignBody();
    body.leaves[1] = { ...body.leaves[1], proof: [EMPTY_SIBLING] };

    const req = await makeAuthenticatedPostRequest("/api/campaigns", body);
    const res = await postCampaigns(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("leaf index 1");
  });

  it("multi-leaf tree with empty proof rejects with 400", async () => {
    const leaf0 = makeLeaf({ leafIndex: 0, proof: [] });
    const leaf1 = makeLeaf({
      leafIndex: 1,
      beneficiary: OTHER_BENEFICIARY,
      proof: [],
    });

    const body = makeCampaignBody({
      treeAddress: uniqueTreeAddress(),
      merkleRoot: "d".repeat(64),
      leafCount: 2,
      leaves: [leaf0, leaf1],
    });

    const req = await makeAuthenticatedPostRequest("/api/campaigns", body);
    const res = await postCampaigns(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/proof/i);
  });

  it("root-versions POST rejects invalid leaf proof", async () => {
    const { treeAddress } = await createCampaignViaPost();
    const body = makeTwoLeafCampaignBody({ treeAddress });
    body.leaves[1] = { ...body.leaves[1], proof: [EMPTY_SIBLING] };

    const req = await makeAuthenticatedPostRequest(
      `/api/campaigns/${treeAddress}/root-versions`,
      {
        merkleRoot: body.merkleRoot,
        leafCount: 2,
        leaves: body.leaves,
      },
    );
    const res = await postRootVersion(req, {
      params: Promise.resolve({ treeAddress }),
    });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("leaf index 1");
  });
});
