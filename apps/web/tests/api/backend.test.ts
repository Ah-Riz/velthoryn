import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Mock declarations — vi.hoisted ensures these are available inside vi.mock
// ---------------------------------------------------------------------------

const {
  mockSelect,
  mockFrom,
  mockWhere,
  mockOrderBy,
  mockLimit,
  mockOffset,
  mockInsert,
  mockValues,
  mockUpdate,
  mockSet,
  mockReturning,
  mockExecute,
  mockTransaction,
} = vi.hoisted(() => {
  const fns = [
    "mockSelect",
    "mockFrom",
    "mockWhere",
    "mockOrderBy",
    "mockLimit",
    "mockOffset",
    "mockInsert",
    "mockValues",
    "mockUpdate",
    "mockSet",
    "mockReturning",
    "mockExecute",
    "mockTransaction",
  ] as const;
  const result: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of fns) {
    result[name] = vi.fn();
  }
  return result;
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  db: {
    select: mockSelect,
    from: mockFrom,
    where: mockWhere,
    limit: mockLimit,
    offset: mockOffset,
    orderBy: mockOrderBy,
    insert: mockInsert,
    values: mockValues,
    returning: mockReturning,
    update: mockUpdate,
    set: mockSet,
    execute: mockExecute,
    transaction: mockTransaction,
  },
}));

vi.mock("@/lib/indexer/claim-events", async (importOriginal) => {
  // Import the real module so we can re-export parseClaimedEvent and CLAIMED_DISCRIMINATOR
  // while still mocking syncClaimEvents.
  const actual = await importOriginal<typeof import("@/lib/indexer/claim-events")>();
  return {
    ...actual,
    syncClaimEvents: vi.fn(),
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
import {
  POST as postRootVersion,
} from "@/app/api/campaigns/[treeAddress]/root-versions/route";
import { GET as getClaims } from "@/app/api/campaigns/[treeAddress]/claims/route";
import { GET as getBeneficiaryCampaigns } from "@/app/api/beneficiary/[address]/campaigns/route";
import { POST as postAdminSync } from "@/app/api/admin/sync/route";

import {
  createCampaignRequestSchema,
  createRootVersionRequestSchema,
} from "@/lib/api/validators";
import { hashLeaf } from "@/lib/merkle/builder";
import { syncClaimEvents, parseClaimedEvent, CLAIMED_DISCRIMINATOR } from "@/lib/indexer/claim-events";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TREE_ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const CREATOR = "11111111111111111111111111111112";
const MINT = "11111111111111111111111111111114";
const BENEFICIARY = "11111111111111111111111111111111";
const OTHER_BENEFICIARY = "22222222222222222222222222222222";

// 32-byte array of zeros for proof siblings
const EMPTY_SIBLING = new Array(32).fill(0) as number[];

function makeLeaf(overrides: Record<string, unknown> = {}) {
  return {
    leafIndex: 0,
    beneficiary: BENEFICIARY,
    amount: "1000000",
    releaseType: 1,
    startTime: "1700000000",
    cliffTime: "0",
    endTime: "1731536000",
    milestoneIdx: 0,
    proof: [EMPTY_SIBLING] as number[][],
    ...overrides,
  };
}

function makeCampaignBody(overrides: Record<string, unknown> = {}) {
  return {
    treeAddress: TREE_ADDRESS,
    creator: CREATOR,
    mint: MINT,
    campaignId: 1,
    merkleRoot: "a".repeat(64),
    leafCount: 1,
    totalSupply: "1000000",
    cancellable: false,
    cancelAuthority: null,
    pauseAuthority: null,
    createdAt: 1700000000,
    metadata: undefined as { name?: string; description?: string; logoUri?: string } | undefined,
    ipfsCid: undefined as string | undefined,
    leaves: [makeLeaf()],
    ...overrides,
  };
}

/** Build a valid single-leaf merkleRoot for the given leaf data */
function computeSingleLeafRoot(leaf: ReturnType<typeof makeLeaf>): string {
  const leafForHash = {
    leafIndex: leaf.leafIndex,
    beneficiary: leaf.beneficiary,
    amount: BigInt(leaf.amount),
    releaseType: leaf.releaseType as 0 | 1 | 2,
    startTs: BigInt(leaf.startTime),
    cliffTs: BigInt(leaf.cliffTime),
    endTs: BigInt(leaf.endTime),
    milestoneIdx: leaf.milestoneIdx,
  };
  return hashLeaf(leafForHash).toString("hex");
}

function makeUrl(path: string, params?: Record<string, string>): string {
  const base = `http://localhost${path}`;
  if (!params) return base;
  const qs = new URLSearchParams(params).toString();
  return `${base}?${qs}`;
}

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
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
      const { metadata, ...rest } = validBody;
      const result = createCampaignRequestSchema.safeParse(rest);
      expect(result.success).toBe(true);
    });

    it("accepts body without ipfsCid", () => {
      const { ipfsCid, ...rest } = validBody;
      const result = createCampaignRequestSchema.safeParse(rest);
      expect(result.success).toBe(true);
    });

    it("rejects missing treeAddress", () => {
      const { treeAddress, ...rest } = validBody;
      const result = createCampaignRequestSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects missing creator", () => {
      const { creator, ...rest } = validBody;
      const result = createCampaignRequestSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects missing mint", () => {
      const { mint, ...rest } = validBody;
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
      const { cancellable, ...rest } = validBody;
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
    const body = makeCampaignBody({ merkleRoot, leaves: [leaf] });

    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      // First insert (campaigns): returns { id: 42 }
      const insertCampaignChain = {
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 42 }]),
        }),
      };
      // Second insert (rootVersions): returns { id: 1 }
      const insertRootVersionChain = {
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 1 }]),
        }),
      };
      // Third insert (leaves): resolves undefined
      const insertLeavesChain = {
        values: vi.fn().mockResolvedValue(undefined),
      };

      const tx = {
        insert: vi.fn()
          .mockReturnValueOnce(insertCampaignChain)
          .mockReturnValueOnce(insertRootVersionChain)
          .mockReturnValueOnce(insertLeavesChain),
      };
      return callback(tx);
    });

    const req = new NextRequest(makeUrl("/api/campaigns"), {
      method: "POST",
      body: JSON.stringify(body),
    });

    const res = await postCampaigns(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.campaignId).toBe(42);
  });

  it("returns 200 with existing campaignId for idempotent request (same treeAddress)", async () => {
    const leaf = makeLeaf();
    const merkleRoot = computeSingleLeafRoot(leaf);
    const body = makeCampaignBody({ merkleRoot, leaves: [leaf] });

    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      // insert throws unique constraint violation
      const insertChain = {
        values: vi.fn().mockImplementation(() => {
          const err = new Error("duplicate key") as Error & { code: string };
          err.code = "23505";
          throw err;
        }),
      };
      // select fallback finds existing campaign
      const selectChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 99 }]),
          }),
        }),
      };
      const tx = {
        insert: vi.fn().mockReturnValue(insertChain),
        select: vi.fn().mockReturnValue(selectChain),
      };
      return callback(tx);
    });

    const req = new NextRequest(makeUrl("/api/campaigns"), {
      method: "POST",
      body: JSON.stringify(body),
    });

    const res = await postCampaigns(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.campaignId).toBe(99);
  });

  it("returns 400 for validation failure", async () => {
    const body = { invalid: "data" };

    const req = new NextRequest(makeUrl("/api/campaigns"), {
      method: "POST",
      body: JSON.stringify(body),
    });

    const res = await postCampaigns(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Validation failed");
    expect(json.details).toBeDefined();
  });

  it("returns 400 when single-leaf root does not match leaf hash", async () => {
    const leaf = makeLeaf();
    const body = makeCampaignBody({
      merkleRoot: "b".repeat(64), // Wrong root
      leaves: [leaf],
    });

    const req = new NextRequest(makeUrl("/api/campaigns"), {
      method: "POST",
      body: JSON.stringify(body),
    });

    const res = await postCampaigns(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("root does not match leaf hash");
  });

  it("returns 400 when multi-leaf proof verification fails", async () => {
    const leaf0 = makeLeaf({ leafIndex: 0, proof: [EMPTY_SIBLING] });
    const leaf1 = makeLeaf({ leafIndex: 1, beneficiary: OTHER_BENEFICIARY, proof: [EMPTY_SIBLING] });

    const body = makeCampaignBody({
      merkleRoot: "c".repeat(64), // Arbitrary root that won't match
      leafCount: 2,
      leaves: [leaf0, leaf1],
    });

    const req = new NextRequest(makeUrl("/api/campaigns"), {
      method: "POST",
      body: JSON.stringify(body),
    });

    const res = await postCampaigns(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Proof verification failed");
  });

  it("returns 500 on DB error", async () => {
    const leaf = makeLeaf();
    const merkleRoot = computeSingleLeafRoot(leaf);
    const body = makeCampaignBody({ merkleRoot, leaves: [leaf] });

    mockTransaction.mockRejectedValue(new Error("DB connection failed"));

    const req = new NextRequest(makeUrl("/api/campaigns"), {
      method: "POST",
      body: JSON.stringify(body),
    });

    const res = await postCampaigns(req);
    expect(res.status).toBe(500);
  });

  it("passes through non-unique-constraint DB errors (not idempotent)", async () => {
    const leaf = makeLeaf();
    const merkleRoot = computeSingleLeafRoot(leaf);
    const body = makeCampaignBody({ merkleRoot, leaves: [leaf] });

    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const insertChain = {
        values: vi.fn().mockImplementation(() => {
          const err = new Error("connection lost") as Error & { code: string };
          err.code = "08001";
          throw err;
        }),
      };
      const tx = {
        insert: vi.fn().mockReturnValue(insertChain),
      };
      return callback(tx);
    });

    const req = new NextRequest(makeUrl("/api/campaigns"), {
      method: "POST",
      body: JSON.stringify(body),
    });

    const res = await postCampaigns(req);
    expect(res.status).toBe(500);
  });
});

// ===========================================================================
// 3. GET /api/campaigns
// ===========================================================================

describe("GET /api/campaigns", () => {
  it("returns paginated campaigns list", async () => {
    const mockCampaigns = [
      {
        treeAddress: TREE_ADDRESS,
        creator: CREATOR,
        mint: MINT,
        campaignId: 1,
        leafCount: 10,
        totalSupply: 1000000,
        totalClaimed: 0,
        cancellable: false,
        paused: false,
        cancelledAt: null,
        createdAt: 1700000000,
        metadata: null,
      },
    ];

    // First call: count query; second call: data query
    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 1 }]),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue(mockCampaigns),
              }),
            }),
          }),
        }),
      });

    const req = new NextRequest(makeUrl("/api/campaigns"));
    const res = await getCampaigns(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.campaigns).toHaveLength(1);
    expect(json.total).toBe(1);
    expect(json.page).toBe(1);
    expect(json.limit).toBe(20);
  });

  it("filters by creator", async () => {
    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      });

    const req = new NextRequest(
      makeUrl("/api/campaigns", { creator: CREATOR }),
    );
    const res = await getCampaigns(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.total).toBe(0);
  });

  it("filters by mint", async () => {
    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      });

    const req = new NextRequest(
      makeUrl("/api/campaigns", { mint: MINT }),
    );
    const res = await getCampaigns(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.total).toBe(0);
  });

  it("uses default pagination (page=1, limit=20)", async () => {
    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 5 }]),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      });

    const req = new NextRequest(makeUrl("/api/campaigns"));
    const res = await getCampaigns(req);
    const json = await res.json();

    expect(json.page).toBe(1);
    expect(json.limit).toBe(20);
  });

  it("applies custom pagination", async () => {
    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 100 }]),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      });

    const req = new NextRequest(
      makeUrl("/api/campaigns", { page: "3", limit: "10" }),
    );
    const res = await getCampaigns(req);
    const json = await res.json();

    expect(json.page).toBe(3);
    expect(json.limit).toBe(10);
  });

  it("filters by status=active (not paused, not cancelled)", async () => {
    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      });

    const req = new NextRequest(
      makeUrl("/api/campaigns", { status: "active" }),
    );
    const res = await getCampaigns(req);
    expect(res.status).toBe(200);
  });

  it("filters by status=paused", async () => {
    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      });

    const req = new NextRequest(
      makeUrl("/api/campaigns", { status: "paused" }),
    );
    const res = await getCampaigns(req);
    expect(res.status).toBe(200);
  });

  it("filters by status=cancelled", async () => {
    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      });

    const req = new NextRequest(
      makeUrl("/api/campaigns", { status: "cancelled" }),
    );
    const res = await getCampaigns(req);
    expect(res.status).toBe(200);
  });

  it("returns 500 on DB error", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockRejectedValue(new Error("DB error")),
      }),
    });

    const req = new NextRequest(makeUrl("/api/campaigns"));
    const res = await getCampaigns(req);
    expect(res.status).toBe(500);
  });
});

// ===========================================================================
// 4. GET /api/campaigns/[treeAddress]
// ===========================================================================

describe("GET /api/campaigns/[treeAddress]", () => {
  it("returns campaign detail with analytics", async () => {
    const mockCampaign = {
      id: 1,
      treeAddress: TREE_ADDRESS,
      creator: CREATOR,
      mint: MINT,
      campaignId: 1,
      merkleRoot: "a".repeat(64),
      leafCount: 10,
      totalSupply: 1000000,
      totalClaimed: 250000,
      cancellable: false,
      paused: false,
      cancelledAt: null,
      createdAt: 1700000000,
      metadata: null,
    };

    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockCampaign]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([
              { version: 1, merkleRoot: "a".repeat(64), leafCount: 10, createdAt: 1700000000, ipfsCid: null },
            ]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { uniqueClaimers: 3, claimCount: 5, totalClaimed: 250000 },
          ]),
        }),
      });

    const req = new NextRequest(makeUrl(`/api/campaigns/${TREE_ADDRESS}`));
    const res = await getCampaignByAddress(req, {
      params: Promise.resolve({ treeAddress: TREE_ADDRESS }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.treeAddress).toBe(TREE_ADDRESS);
    expect(json.analytics).toBeDefined();
    expect(json.analytics.uniqueClaimers).toBe(3);
    expect(json.analytics.claimCount).toBe(5);
    expect(json.analytics.percentClaimed).toBeDefined();
    expect(typeof json.analytics.percentClaimed).toBe("number");
    expect(json.rootVersions).toHaveLength(1);
  });

  it("returns 404 for non-existent campaign", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const req = new NextRequest(makeUrl("/api/campaigns/nonexistent"));
    const res = await getCampaignByAddress(req, {
      params: Promise.resolve({ treeAddress: "nonexistent" }),
    });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain("not found");
  });

  it("returns 500 on DB error", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockRejectedValue(new Error("DB error")),
        }),
      }),
    });

    const req = new NextRequest(makeUrl(`/api/campaigns/${TREE_ADDRESS}`));
    const res = await getCampaignByAddress(req, {
      params: Promise.resolve({ treeAddress: TREE_ADDRESS }),
    });
    expect(res.status).toBe(500);
  });
});

// ===========================================================================
// 5. GET /api/campaigns/[treeAddress]/proof
// ===========================================================================

describe("GET /api/campaigns/[treeAddress]/proof", () => {
  it("returns leaf + proof for beneficiary", async () => {
    const mockLeaf = {
      leafIndex: 0,
      beneficiary: BENEFICIARY,
      amount: 1000000,
      releaseType: 1,
      startTime: 1700000000,
      cliffTime: 0,
      endTime: 1731536000,
      milestoneIdx: 0,
      proof: [EMPTY_SIBLING],
    };

    mockSelect
      // Find campaign
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 1, merkleRoot: "a".repeat(64) }]),
          }),
        }),
      })
      // Get latest root version
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: 10, version: 1 }]),
            }),
          }),
        }),
      })
      // Find leaf
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockLeaf]),
          }),
        }),
      });

    const req = new NextRequest(
      makeUrl(`/api/campaigns/${TREE_ADDRESS}/proof`, {
        beneficiary: BENEFICIARY,
      }),
    );
    const res = await getProof(req, {
      params: Promise.resolve({ treeAddress: TREE_ADDRESS }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.leaf).toBeDefined();
    expect(json.leaf.beneficiary).toBe(BENEFICIARY);
    expect(json.proof).toBeDefined();
    expect(json.merkleRoot).toBeDefined();
    expect(json.treeAddress).toBe(TREE_ADDRESS);
  });

  it("returns 400 if beneficiary param missing", async () => {
    const req = new NextRequest(
      makeUrl(`/api/campaigns/${TREE_ADDRESS}/proof`),
    );
    const res = await getProof(req, {
      params: Promise.resolve({ treeAddress: TREE_ADDRESS }),
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("beneficiary");
  });

  it("returns 404 if campaign not found", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const req = new NextRequest(
      makeUrl(`/api/campaigns/nonexistent/proof`, {
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
    mockSelect
      // Find campaign
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 1, merkleRoot: "a".repeat(64) }]),
          }),
        }),
      })
      // Get latest root version
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: 10, version: 1 }]),
            }),
          }),
        }),
      })
      // Find leaf - not found
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

    const req = new NextRequest(
      makeUrl(`/api/campaigns/${TREE_ADDRESS}/proof`, {
        beneficiary: BENEFICIARY,
      }),
    );
    const res = await getProof(req, {
      params: Promise.resolve({ treeAddress: TREE_ADDRESS }),
    });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain("No proof found");
  });

  it("returns 500 on DB error", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockRejectedValue(new Error("DB error")),
        }),
      }),
    });

    const req = new NextRequest(
      makeUrl(`/api/campaigns/${TREE_ADDRESS}/proof`, {
        beneficiary: BENEFICIARY,
      }),
    );
    const res = await getProof(req, {
      params: Promise.resolve({ treeAddress: TREE_ADDRESS }),
    });
    expect(res.status).toBe(500);
  });
});

// ===========================================================================
// 6. POST /api/campaigns/[treeAddress]/root-versions
// ===========================================================================

describe("POST /api/campaigns/[treeAddress]/root-versions", () => {
  it("creates new root version and returns 201 with version number", async () => {
    mockSelect
      // Find campaign
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      })
      // Get max version
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ version: 1 }]),
        }),
      });

    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 5 }]),
      }),
    });

    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const body = {
      merkleRoot: "b".repeat(64),
      leafCount: 3,
      leaves: [
        makeLeaf({ leafIndex: 0 }),
        makeLeaf({ leafIndex: 1, beneficiary: OTHER_BENEFICIARY }),
        makeLeaf({ leafIndex: 2, beneficiary: "33333333333333333333333333333333" }),
      ],
    };

    const req = new NextRequest(makeUrl(`/api/campaigns/${TREE_ADDRESS}/root-versions`), {
      method: "POST",
      body: JSON.stringify(body),
    });
    const res = await postRootVersion(req, {
      params: Promise.resolve({ treeAddress: TREE_ADDRESS }),
    });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.version).toBe(2);
  });

  it("returns 404 for non-existent campaign", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const body = {
      merkleRoot: "b".repeat(64),
      leafCount: 1,
      leaves: [makeLeaf()],
    };

    const req = new NextRequest(makeUrl("/api/campaigns/nonexistent/root-versions"), {
      method: "POST",
      body: JSON.stringify(body),
    });
    const res = await postRootVersion(req, {
      params: Promise.resolve({ treeAddress: "nonexistent" }),
    });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain("not found");
  });

  it("returns 400 for validation failure", async () => {
    const body = { invalid: "data" };

    const req = new NextRequest(makeUrl(`/api/campaigns/${TREE_ADDRESS}/root-versions`), {
      method: "POST",
      body: JSON.stringify(body),
    });
    const res = await postRootVersion(req, {
      params: Promise.resolve({ treeAddress: TREE_ADDRESS }),
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Validation failed");
  });

  it("returns 500 on DB error", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockRejectedValue(new Error("DB error")),
        }),
      }),
    });

    const body = {
      merkleRoot: "b".repeat(64),
      leafCount: 1,
      leaves: [makeLeaf()],
    };

    const req = new NextRequest(makeUrl(`/api/campaigns/${TREE_ADDRESS}/root-versions`), {
      method: "POST",
      body: JSON.stringify(body),
    });
    const res = await postRootVersion(req, {
      params: Promise.resolve({ treeAddress: TREE_ADDRESS }),
    });
    expect(res.status).toBe(500);
  });
});

// ===========================================================================
// 7. GET /api/campaigns/[treeAddress]/claims
// ===========================================================================

describe("GET /api/campaigns/[treeAddress]/claims", () => {
  it("returns paginated claims", async () => {
    const mockClaims = [
      {
        beneficiary: BENEFICIARY,
        leafIndex: 0,
        amount: 100000,
        totalClaimedByUser: 100000,
        totalClaimedOverall: 100000,
        milestoneIdx: null,
        signature: "sig1",
        slot: 1000,
        blockTime: 1700000000,
      },
    ];

    mockSelect
      // Find campaign
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      })
      // Count claims
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 1 }]),
        }),
      })
      // Fetch claims
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(mockClaims),
            }),
          }),
        }),
      });

    const req = new NextRequest(makeUrl(`/api/campaigns/${TREE_ADDRESS}/claims`));
    const res = await getClaims(req, {
      params: Promise.resolve({ treeAddress: TREE_ADDRESS }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.claims).toHaveLength(1);
    expect(json.total).toBe(1);
  });

  it("filters by beneficiary", async () => {
    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      });

    const req = new NextRequest(
      makeUrl(`/api/campaigns/${TREE_ADDRESS}/claims`, {
        beneficiary: BENEFICIARY,
      }),
    );
    const res = await getClaims(req, {
      params: Promise.resolve({ treeAddress: TREE_ADDRESS }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.total).toBe(0);
  });

  it("filters by fromSlot", async () => {
    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      });

    const req = new NextRequest(
      makeUrl(`/api/campaigns/${TREE_ADDRESS}/claims`, {
        fromSlot: "5000",
      }),
    );
    const res = await getClaims(req, {
      params: Promise.resolve({ treeAddress: TREE_ADDRESS }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.total).toBe(0);
  });

  it("returns 404 for non-existent campaign", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const req = new NextRequest(makeUrl("/api/campaigns/nonexistent/claims"));
    const res = await getClaims(req, {
      params: Promise.resolve({ treeAddress: "nonexistent" }),
    });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain("not found");
  });

  it("returns 500 on DB error", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockRejectedValue(new Error("DB error")),
        }),
      }),
    });

    const req = new NextRequest(makeUrl(`/api/campaigns/${TREE_ADDRESS}/claims`));
    const res = await getClaims(req, {
      params: Promise.resolve({ treeAddress: TREE_ADDRESS }),
    });
    expect(res.status).toBe(500);
  });
});

// ===========================================================================
// 8. GET /api/beneficiary/[address]/campaigns
// ===========================================================================

describe("GET /api/beneficiary/[address]/campaigns", () => {
  it("returns campaigns where address is beneficiary", async () => {
    mockExecute.mockResolvedValue([
      {
        id: 1,
        tree_address: TREE_ADDRESS,
        creator: CREATOR,
        mint: MINT,
        campaign_id: 1,
        total_supply: 1000000,
        leaf_count: 10,
        paused: false,
        cancelled_at: null,
        created_at: 1700000000,
        metadata: null,
        leaf_index: 0,
        amount: 100000,
        release_type: 1,
        start_time: 1700000000,
        cliff_time: 0,
        end_time: 1731536000,
        milestone_idx: 0,
      },
    ]);

    const req = new NextRequest(
      makeUrl(`/api/beneficiary/${BENEFICIARY}/campaigns`),
    );
    const res = await getBeneficiaryCampaigns(req, {
      params: Promise.resolve({ address: BENEFICIARY }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.campaigns).toHaveLength(1);
    expect(json.campaigns[0].treeAddress).toBe(TREE_ADDRESS);
    expect(json.campaigns[0].myLeaf).toBeDefined();
    expect(json.campaigns[0].myLeaf.amount).toBe(100000);
  });

  it("returns empty array if no campaigns found", async () => {
    mockExecute.mockResolvedValue([]);

    const req = new NextRequest(
      makeUrl(`/api/beneficiary/${BENEFICIARY}/campaigns`),
    );
    const res = await getBeneficiaryCampaigns(req, {
      params: Promise.resolve({ address: BENEFICIARY }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.campaigns).toEqual([]);
  });

  it("returns 500 on DB error", async () => {
    mockExecute.mockRejectedValue(new Error("DB error"));

    const req = new NextRequest(
      makeUrl(`/api/beneficiary/${BENEFICIARY}/campaigns`),
    );
    const res = await getBeneficiaryCampaigns(req, {
      params: Promise.resolve({ address: BENEFICIARY }),
    });
    expect(res.status).toBe(500);
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

    vi.mocked(syncClaimEvents).mockResolvedValue({
      processed: 42,
      lastSlot: 12345,
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
    expect(syncClaimEvents).toHaveBeenCalledWith(10000);
  });

  it("calls syncClaimEvents without fromSlot if body has none", async () => {
    process.env.ADMIN_API_KEY = "super-secret-key";

    vi.mocked(syncClaimEvents).mockResolvedValue({
      processed: 0,
      lastSlot: 0,
    });

    const req = new NextRequest(makeUrl("/api/admin/sync"), {
      method: "POST",
      headers: { "x-admin-key": "super-secret-key" },
    });
    const res = await postAdminSync(req);

    expect(res.status).toBe(200);
    expect(syncClaimEvents).toHaveBeenCalledWith(undefined);
  });

  it("returns 500 when syncClaimEvents throws", async () => {
    process.env.ADMIN_API_KEY = "super-secret-key";

    vi.mocked(syncClaimEvents).mockRejectedValue(
      new Error("RPC connection failed"),
    );

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
  // Use real PublicKeys so the base58 conversion matches what the real
  // parseClaimedEvent returns.
  const TREE_KEY = new PublicKey(TREE_ADDRESS);
  const BENE_KEY = new PublicKey(BENEFICIARY);

  function makeValidEventBuffer(overrides: {
    milestoneFlag?: number;
    milestoneIdx?: number;
    truncateTo?: number;
    wrongDiscriminator?: boolean;
  } = {}): Buffer {
    // 8 (discriminator) + 32 (tree) + 32 (beneficiary) + 4 (leafIndex)
    // + 8 (amount) + 8 (totalClaimedByUser) + 8 (totalClaimedOverall)
    // + 1 (option flag) + 1 (milestoneIdx) = 102 bytes
    const buf = Buffer.alloc(102);
    CLAIMED_DISCRIMINATOR.copy(buf, 0);
    TREE_KEY.toBuffer().copy(buf, 8);
    BENE_KEY.toBuffer().copy(buf, 40);
    buf.writeUInt32LE(42, 72);                // leafIndex = 42
    buf.writeBigUInt64LE(BigInt(1000000), 76); // amount
    buf.writeBigUInt64LE(BigInt(1000000), 84); // totalClaimedByUser
    buf.writeBigUInt64LE(BigInt(5000000), 92); // totalClaimedOverall

    const milestoneFlag = overrides.milestoneFlag ?? 0;
    buf.writeUInt8(milestoneFlag, 100);

    if (overrides.milestoneIdx !== undefined) {
      buf.writeUInt8(overrides.milestoneIdx, 101);
    }

    if (overrides.truncateTo !== undefined) {
      return buf.subarray(0, overrides.truncateTo);
    }

    if (overrides.wrongDiscriminator) {
      buf.writeUInt8(0xFF, 0);
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
    expect(result!.amount).toBe(1000000);
    expect(result!.totalClaimedByUser).toBe(1000000);
    expect(result!.totalClaimedOverall).toBe(5000000);
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
    // Buffer is 101 bytes: option flag is readable at offset 100 but milestoneIdx byte at 101 is not
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
    const body = makeCampaignBody({ merkleRoot: correctRoot, leaves: [leaf] });

    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const insertCampaignChain = {
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 1 }]),
        }),
      };
      const insertRootVersionChain = {
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 1 }]),
        }),
      };
      const insertLeavesChain = {
        values: vi.fn().mockResolvedValue(undefined),
      };
      const tx = {
        insert: vi.fn()
          .mockReturnValueOnce(insertCampaignChain)
          .mockReturnValueOnce(insertRootVersionChain)
          .mockReturnValueOnce(insertLeavesChain),
      };
      return callback(tx);
    });

    const req = new NextRequest(makeUrl("/api/campaigns"), {
      method: "POST",
      body: JSON.stringify(body),
    });
    const res = await postCampaigns(req);

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("multi-leaf tree with empty proof skips verification (leafCount > 1, proof empty)", async () => {
    // When proof is empty for a multi-leaf tree, the code path
    // falls through to DB insert (neither single-leaf check nor proof check triggers)
    const leaf0 = makeLeaf({ leafIndex: 0, proof: [] });
    const leaf1 = makeLeaf({ leafIndex: 1, beneficiary: OTHER_BENEFICIARY, proof: [] });

    const body = makeCampaignBody({
      merkleRoot: "d".repeat(64),
      leafCount: 2,
      leaves: [leaf0, leaf1],
    });

    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const insertCampaignChain = {
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 1 }]),
        }),
      };
      const insertRootVersionChain = {
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 1 }]),
        }),
      };
      const insertLeavesChain = {
        values: vi.fn().mockResolvedValue(undefined),
      };
      const tx = {
        insert: vi.fn()
          .mockReturnValueOnce(insertCampaignChain)
          .mockReturnValueOnce(insertRootVersionChain)
          .mockReturnValueOnce(insertLeavesChain),
      };
      return callback(tx);
    });

    const req = new NextRequest(makeUrl("/api/campaigns"), {
      method: "POST",
      body: JSON.stringify(body),
    });
    const res = await postCampaigns(req);

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });
});
