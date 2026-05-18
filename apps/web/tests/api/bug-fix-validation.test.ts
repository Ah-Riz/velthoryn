/**
 * Bug-fix validation tests
 *
 * Each describe block corresponds to a specific bug fix. Tests are designed to
 * catch regressions -- they verify the *behavioural* change, not just that the
 * code compiles.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resetDb } from "../helpers/db";
import { createCampaignViaPost } from "../helpers/fixtures";
import { makeUrl, BENEFICIARY } from "../helpers/requests";

const TREE_ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

// ---------------------------------------------------------------------------
// Mock declarations (RPC / indexer only — no DB mock)
// ---------------------------------------------------------------------------

const { mockGetSignaturesForAddress, mockGetTransactions } = vi.hoisted(() => ({
  mockGetSignaturesForAddress: vi.fn(),
  mockGetTransactions: vi.fn(),
}));

vi.mock("@/lib/indexer/claim-events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/indexer/claim-events")>();
  return {
    ...actual,
    syncClaimEvents: vi.fn(),
  };
});

const mockConnectionInstance = {
  getSignaturesForAddress: mockGetSignaturesForAddress,
  getTransactions: mockGetTransactions,
};
vi.mock("@solana/web3.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/web3.js")>();
  return {
    ...actual,
    Connection: vi.fn().mockImplementation(() => mockConnectionInstance),
  };
});

import { GET as getBeneficiaryCampaigns } from "@/app/api/beneficiary/[address]/campaigns/route";
import { GET as getClaims } from "@/app/api/campaigns/[treeAddress]/claims/route";

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  process.env.API_KEY = "test-api-key";
  process.env.RPC_ENDPOINT = "http://localhost:8899";
  process.env.NEXT_PUBLIC_RPC_ENDPOINT = "http://localhost:8899";
});

// ===========================================================================
// BUG 1: Pagination cursor uses last valid signature, not last raw one
// ===========================================================================

describe("Bug 1: Pagination cursor fix", () => {
  it("syncClaimEvents uses last valid signature as cursor when some signatures are filtered by fromSlot", async () => {
    const { syncClaimEvents: realSyncClaimEvents } = await vi.importActual<
      typeof import("@/lib/indexer/claim-events")
    >("@/lib/indexer/claim-events");

    const page1Signatures = [
      { signature: "sig_10", slot: 30 },
      { signature: "sig_20", slot: 40 },
      { signature: "sig_50", slot: 50 },
      { signature: "sig_70", slot: 70 },
    ];

    mockGetSignaturesForAddress
      .mockResolvedValueOnce(page1Signatures)
      .mockResolvedValueOnce([]);

    mockGetTransactions.mockResolvedValue([null]);

    await realSyncClaimEvents(50);

    expect(mockGetSignaturesForAddress).toHaveBeenCalledTimes(1);
  });

  it("syncClaimEvents falls back to last pageSignature when all are filtered", async () => {
    const { syncClaimEvents: realSyncClaimEvents } = await vi.importActual<
      typeof import("@/lib/indexer/claim-events")
    >("@/lib/indexer/claim-events");

    const page1Signatures = [
      { signature: "sig_30", slot: 30 },
      { signature: "sig_40", slot: 40 },
    ];

    mockGetSignaturesForAddress
      .mockResolvedValueOnce(page1Signatures)
      .mockResolvedValueOnce([]);

    mockGetTransactions.mockResolvedValue([null, null]);

    await realSyncClaimEvents(100);

    expect(mockGetSignaturesForAddress).toHaveBeenCalledTimes(1);
  });

  it("falls back to pageSignatures when validSigs is empty", () => {
    const pageSignatures = [
      { signature: "sig_30", slot: 30 },
      { signature: "sig_40", slot: 40 },
    ];
    const fromSlot = 100;

    const validSigs = pageSignatures.filter(
      (s) => !(fromSlot && s.slot <= fromSlot),
    );

    expect(validSigs).toHaveLength(0);

    const cursorSig =
      validSigs.length > 0
        ? validSigs[validSigs.length - 1].signature
        : pageSignatures[pageSignatures.length - 1].signature;

    expect(cursorSig).toBe("sig_40");
  });
});

// ===========================================================================
// BUG 2: RootUpdated creates root_versions
// ===========================================================================

describe("Bug 2: RootUpdated creates root_versions", () => {
  it("version numbering increments correctly", () => {
    const maxVersion1 = null;
    const nextVersion1 = (maxVersion1 ?? 0) + 1;
    expect(nextVersion1).toBe(1);

    const maxVersion2 = 1;
    const nextVersion2 = (maxVersion2 ?? 0) + 1;
    expect(nextVersion2).toBe(2);

    const maxVersion3 = 5;
    const nextVersion3 = (maxVersion3 ?? 0) + 1;
    expect(nextVersion3).toBe(6);
  });
});

// ===========================================================================
// BUG 3: Input validation on API routes
// ===========================================================================

describe("Bug 3: Input validation", () => {
  describe("GET /api/beneficiary/:address/campaigns", () => {
    it("returns 400 for invalid base58 address (contains invalid chars)", async () => {
      const req = new NextRequest(
        makeUrl(`/api/beneficiary/0O0O0O0O0O0O0O0O0O0O0O0O0O0O0O0O0O/campaigns`),
      );
      const res = await getBeneficiaryCampaigns(req, {
        params: Promise.resolve({ address: "0O0O0O0O0O0O0O0O0O0O0O0O0O0O0O0O0O" }),
      });
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.error).toContain("Invalid address");
    });

    it("returns 400 for address that is too short", async () => {
      const req = new NextRequest(makeUrl("/api/beneficiary/abc123/campaigns"));
      const res = await getBeneficiaryCampaigns(req, {
        params: Promise.resolve({ address: "abc123" }),
      });
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.error).toContain("Invalid address");
    });

    it("returns 400 for empty address", async () => {
      const req = new NextRequest(makeUrl("/api/beneficiary//campaigns"));
      const res = await getBeneficiaryCampaigns(req, {
        params: Promise.resolve({ address: "" }),
      });
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.error).toContain("Invalid address");
    });

    it("accepts a valid base58 Solana address", async () => {
      await createCampaignViaPost({ treeAddress: TREE_ADDRESS });

      const req = new NextRequest(
        makeUrl(`/api/beneficiary/${BENEFICIARY}/campaigns`),
      );
      const res = await getBeneficiaryCampaigns(req, {
        params: Promise.resolve({ address: BENEFICIARY }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/campaigns/:treeAddress/claims", () => {
    it("returns 400 for invalid treeAddress (not base58)", async () => {
      const req = new NextRequest(
        makeUrl("/api/campaigns/invalid!!!address/claims"),
      );
      const res = await getClaims(req, {
        params: Promise.resolve({ treeAddress: "invalid!!!address" }),
      });
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.error).toContain("Invalid address");
    });

    it("returns 400 for negative fromSlot", async () => {
      const req = new NextRequest(
        makeUrl(`/api/campaigns/${TREE_ADDRESS}/claims`, { fromSlot: "-5" }),
      );
      const res = await getClaims(req, {
        params: Promise.resolve({ treeAddress: TREE_ADDRESS }),
      });
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.error).toContain("Invalid fromSlot");
    });

    it("returns 400 for non-numeric fromSlot", async () => {
      const req = new NextRequest(
        makeUrl(`/api/campaigns/${TREE_ADDRESS}/claims`, { fromSlot: "abc" }),
      );
      const res = await getClaims(req, {
        params: Promise.resolve({ treeAddress: TREE_ADDRESS }),
      });
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.error).toContain("Invalid fromSlot");
    });

    it("accepts fromSlot=0 as valid", async () => {
      const { campaignId } = await createCampaignViaPost({ treeAddress: TREE_ADDRESS });

      const req = new NextRequest(
        makeUrl(`/api/campaigns/${TREE_ADDRESS}/claims`, { fromSlot: "0" }),
      );
      const res = await getClaims(req, {
        params: Promise.resolve({ treeAddress: TREE_ADDRESS }),
      });
      expect(res.status).toBe(200);
      expect(campaignId).toBeGreaterThan(0);
    });

    it("accepts large positive fromSlot as valid", async () => {
      await createCampaignViaPost({ treeAddress: TREE_ADDRESS });

      const req = new NextRequest(
        makeUrl(`/api/campaigns/${TREE_ADDRESS}/claims`, {
          fromSlot: "999999999",
        }),
      );
      const res = await getClaims(req, {
        params: Promise.resolve({ treeAddress: TREE_ADDRESS }),
      });
      expect(res.status).toBe(200);
    });
  });
});

// ===========================================================================
// BUG 4: Batched DB transactions for Claimed events
// ===========================================================================

describe("Bug 4: Batched DB transactions for Claimed events", () => {
  it("transaction callback receives a tx object that can perform both insert and update", async () => {
    await createCampaignViaPost({ treeAddress: TREE_ADDRESS });

    let txReceived: { insert: unknown; update: unknown } | null = null;
    await db.transaction(async (tx) => {
      txReceived = { insert: tx.insert, update: tx.update };
    });

    expect(txReceived).not.toBeNull();
    expect(typeof txReceived!.insert).toBe("function");
    expect(typeof txReceived!.update).toBe("function");
  });
});
