import { describe, it, expect, beforeEach } from "vitest";
import { Keypair } from "@solana/web3.js";
import { NextRequest } from "next/server";
import { POST as postPrepare } from "@/app/api/campaigns/prepare/route";
import { POST as postImport } from "@/app/api/campaigns/import/route";
import { verifyLeafProof } from "@/lib/merkle/verify";
import {
  makeAuthenticatedPostRequest,
  makeUrl,
  CREATOR,
  MINT,
  BENEFICIARY,
  OTHER_BENEFICIARY,
} from "../helpers/requests";
import { resetRateLimitForTests } from "@/lib/api/rate-limit";
import { resetRedisForTests } from "@/lib/api/redis";

// ---------------------------------------------------------------------------
// Constants — all addresses must be valid Solana base58 public keys (32 bytes).
// BENEFICIARY and CREATOR are valid System-Program-adjacent keys.
// SOLANA_BENEFICIARY_2 is a freshly generated valid key.
// ---------------------------------------------------------------------------

// Use a seeded but valid second beneficiary for the prepare route tests
// (OTHER_BENEFICIARY = "22..." is valid base58 but decodes to < 32 bytes)
const SOLANA_BENEFICIARY_2 = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const VALID_RECIPIENT = {
  beneficiary: BENEFICIARY,
  amount: "1000000",
  releaseType: 0,
  startTime: "1700000000",
  cliffTime: "1731536000",
  endTime: "1731536000",
  milestoneIdx: 0,
};

const VALID_LINEAR_RECIPIENT = {
  beneficiary: SOLANA_BENEFICIARY_2,
  amount: "2000000",
  releaseType: 1,
  startTime: "1700000000",
  cliffTime: "1700000000",
  endTime: "1731536000",
  milestoneIdx: 0,
};

function makeBaseBody(overrides: Record<string, unknown> = {}) {
  return {
    recipients: [VALID_RECIPIENT],
    mint: MINT,
    creator: CREATOR,
    campaignId: 42,
    cancellable: false,
    cancelAuthority: null,
    pauseAuthority: null,
    ...overrides,
  };
}

async function makeImportRequest(csvText: string): Promise<NextRequest> {
  resetRedisForTests();
  resetRateLimitForTests();
  const { createAuthHeader } = await import("../helpers/wallet-auth");
  const authorization = await createAuthHeader();

  const formData = new FormData();
  formData.append("file", new Blob([csvText], { type: "text/csv" }), "recipients.csv");

  return new NextRequest(makeUrl("/api/campaigns/import"), {
    method: "POST",
    body: formData,
    headers: { authorization },
  });
}

beforeEach(() => {
  resetRedisForTests();
  resetRateLimitForTests();
});

// ===========================================================================
// 1. POST /api/campaigns/prepare — 10 recipients
// ===========================================================================

describe("POST /api/campaigns/prepare", () => {
  it("10-recipient prepare: returns tree with 10 leaves and valid root", async () => {
    const recipients = Array.from({ length: 10 }, (_, i) => ({
      ...VALID_RECIPIENT,
      beneficiary: i === 0 ? BENEFICIARY : SOLANA_BENEFICIARY_2,
      amount: String((i + 1) * 1_000_000),
    }));

    const req = await makeAuthenticatedPostRequest("/api/campaigns/prepare", makeBaseBody({ recipients }));
    const res = await postPrepare(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.merkleRoot).toHaveLength(64);
    expect(json.leafCount).toBe(10);
    expect(json.leaves).toHaveLength(10);
    expect(typeof json.treeAddress).toBe("string");
    expect(json.treeAddress.length).toBeGreaterThan(30);
  });

  it("100-recipient prepare: all proofs valid against returned root", async () => {
    const recipients = Array.from({ length: 100 }, (_, i) => ({
      ...VALID_RECIPIENT,
      amount: String((i + 1) * 1_000),
    }));

    const req = await makeAuthenticatedPostRequest("/api/campaigns/prepare", makeBaseBody({ recipients }));
    const res = await postPrepare(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.leafCount).toBe(100);

    // Verify every proof against the returned root
    for (const leaf of json.leaves) {
      const result = verifyLeafProof(
        {
          leafIndex: leaf.leafIndex,
          beneficiary: leaf.beneficiary,
          amount: leaf.amount,
          releaseType: leaf.releaseType,
          startTime: leaf.startTime,
          cliffTime: leaf.cliffTime,
          endTime: leaf.endTime,
          milestoneIdx: leaf.milestoneIdx,
          proof: leaf.proof,
        },
        json.merkleRoot,
        json.leafCount,
      );
      expect(result.ok).toBe(true);
    }
  });

  it("mixed release types (cliff + linear + milestone) in one campaign", async () => {
    const recipients = [
      { ...VALID_RECIPIENT, releaseType: 0 as const },
      { ...VALID_LINEAR_RECIPIENT, releaseType: 1 as const },
      { ...VALID_RECIPIENT, releaseType: 2 as const, milestoneIdx: 1 },
    ];

    const req = await makeAuthenticatedPostRequest("/api/campaigns/prepare", makeBaseBody({ recipients }));
    const res = await postPrepare(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.leafCount).toBe(3);
    expect(json.leaves[0].releaseType).toBe(0);
    expect(json.leaves[1].releaseType).toBe(1);
    expect(json.leaves[2].releaseType).toBe(2);
  });

  it("returns 400 for invalid schedule (startTime > endTime)", async () => {
    const recipients = [
      {
        ...VALID_RECIPIENT,
        startTime: "9999999999",
        cliffTime: "9999999999",
        endTime: "1000000000",
      },
    ];

    const req = await makeAuthenticatedPostRequest("/api/campaigns/prepare", makeBaseBody({ recipients }));
    const res = await postPrepare(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Validation failed");
  });

  it("duplicate beneficiary: allowed as separate leaves", async () => {
    const recipients = [
      { ...VALID_RECIPIENT, amount: "1000000" },
      { ...VALID_RECIPIENT, amount: "2000000" }, // same beneficiary, different amount
    ];

    const req = await makeAuthenticatedPostRequest("/api/campaigns/prepare", makeBaseBody({ recipients }));
    const res = await postPrepare(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.leafCount).toBe(2);
    expect(json.leaves[0].beneficiary).toBe(BENEFICIARY);
    expect(json.leaves[1].beneficiary).toBe(BENEFICIARY);
  });

  it("returns 400 for zero amount", async () => {
    const recipients = [{ ...VALID_RECIPIENT, amount: "0" }];

    const req = await makeAuthenticatedPostRequest("/api/campaigns/prepare", makeBaseBody({ recipients }));
    const res = await postPrepare(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Validation failed");
  });

  it("returns 400 for cancellable campaign without cancelAuthority", async () => {
    const req = await makeAuthenticatedPostRequest(
      "/api/campaigns/prepare",
      makeBaseBody({ cancellable: true, cancelAuthority: null }),
    );
    const res = await postPrepare(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Validation failed");
  });

  it("totalSupply is sum of all amounts as string", async () => {
    const recipients = [
      { ...VALID_RECIPIENT, amount: "1000000" },
      { ...VALID_LINEAR_RECIPIENT, amount: "2000000" },
    ];

    const req = await makeAuthenticatedPostRequest("/api/campaigns/prepare", makeBaseBody({ recipients }));
    const res = await postPrepare(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.totalSupply).toBe("3000000");
    expect(typeof json.totalSupply).toBe("string");
  });

  it("returns 400 for missing recipients", async () => {
    const req = await makeAuthenticatedPostRequest("/api/campaigns/prepare", makeBaseBody({ recipients: [] }));
    const res = await postPrepare(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Validation failed");
  });
});

// ===========================================================================
// 2. POST /api/campaigns/import — CSV import
// ===========================================================================

describe("POST /api/campaigns/import", () => {
  const VALID_CSV = [
    "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
    `${BENEFICIARY},1000000,0,1700000000,1731536000,1731536000,0`,
    `${OTHER_BENEFICIARY},2000000,1,1700000000,1700000000,1731536000,0`,
  ].join("\n");

  it("valid CSV with 2 rows returns 2 recipients", async () => {
    const req = await makeImportRequest(VALID_CSV);
    const res = await postImport(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.totalRows).toBe(2);
    expect(json.validRows).toBe(2);
    expect(json.recipients).toHaveLength(2);
    expect(json.errors).toHaveLength(0);
    expect(json.recipients[0].beneficiary).toBe(BENEFICIARY);
    expect(json.recipients[0].amount).toBe("1000000");
    expect(json.recipients[0].row).toBe(2);
  });

  it("CSV with one invalid beneficiary: 1 error + rest valid", async () => {
    const csv = [
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
      `${BENEFICIARY},1000000,0,1700000000,1731536000,1731536000,0`,
      `INVALID_ADDRESS,2000000,1,1700000000,1700000000,1731536000,0`,
      `${OTHER_BENEFICIARY},3000000,0,1700000000,1731536000,1731536000,0`,
    ].join("\n");

    const req = await makeImportRequest(csv);
    const res = await postImport(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.totalRows).toBe(3);
    expect(json.validRows).toBe(2);
    expect(json.errors.length).toBeGreaterThanOrEqual(1);
    const rowErrors = json.errors.filter((e: { row: number }) => e.row === 3);
    expect(rowErrors.length).toBeGreaterThanOrEqual(1);
    expect(rowErrors.some((e: { field: string }) => e.field === "beneficiary")).toBe(true);
  });

  it("CSV with missing header returns 400", async () => {
    const csv = [
      `${BENEFICIARY},1000000,0,1700000000,1731536000,1731536000,0`,
    ].join("\n");

    const req = await makeImportRequest(csv);
    const res = await postImport(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/header/i);
  });

  it("empty CSV body returns 400", async () => {
    const req = await makeImportRequest("");
    const res = await postImport(req);
    const json = await res.json();

    expect(res.status).toBe(400);
  });

  it("CSV where every row is invalid returns 400 with full error list", async () => {
    const csv = [
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
      `INVALID1,abc,9,not-a-ts,not-a-ts,not-a-ts,0`,
      `INVALID2,xyz,9,not-a-ts,not-a-ts,not-a-ts,0`,
    ].join("\n");

    const req = await makeImportRequest(csv);
    const res = await postImport(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.details).toBeDefined();
    expect(Array.isArray(json.details)).toBe(true);
  });

  it("returns row numbers in response", async () => {
    const req = await makeImportRequest(VALID_CSV);
    const res = await postImport(req);
    const json = await res.json();

    expect(json.recipients[0].row).toBe(2);
    expect(json.recipients[1].row).toBe(3);
  });

  it("amounts are returned as strings", async () => {
    const req = await makeImportRequest(VALID_CSV);
    const res = await postImport(req);
    const json = await res.json();

    expect(typeof json.recipients[0].amount).toBe("string");
    expect(json.recipients[0].amount).toBe("1000000");
  });
});
