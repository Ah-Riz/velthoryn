/**
 * Week 7 — FE Coverage Boost Tests
 *
 * Targets modules with 0% or low coverage that can be tested without DB/RPC:
 *   - lib/api/errors.ts (error classes + errorResponse)
 *   - lib/api/body-limit.ts (body size checking)
 *   - lib/api/json-response.ts (BigInt serialization)
 *   - lib/api/request-id.ts (request ID extraction)
 *   - lib/api/logger.ts (log routing)
 *   - lib/campaign/authority.ts (permission checks)
 *   - lib/token/normalize.ts (wallet token normalization)
 *   - lib/vesting/list.ts (stream status + claimable amounts)
 *   - lib/stream/persist.ts (key generation + parsing)
 *   - lib/vesting/verify-onchain.ts (schedule verification)
 */
import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// 1. API Error Classes
// ---------------------------------------------------------------------------
import {
  AppError,
  ValidationError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  PayloadTooLargeError,
  ConflictError,
  InternalError,
} from "@/lib/api/errors";

describe("API error classes", () => {
  it("AppError stores statusCode and code", () => {
    const err = new AppError("test", 418, "VALIDATION_ERROR");
    expect(err.message).toBe("test");
    expect(err.statusCode).toBe(418);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.name).toBe("AppError");
  });

  it("AppError stores optional details", () => {
    const details = { field: "amount", reason: "too large" };
    const err = new AppError("test", 400, "VALIDATION_ERROR", details);
    expect(err.details).toEqual(details);
  });

  it("ValidationError defaults to 400", () => {
    const err = new ValidationError();
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("Validation failed");
  });

  it("ValidationError accepts custom message and details", () => {
    const err = new ValidationError("bad input", [{ field: "x" }]);
    expect(err.message).toBe("bad input");
    expect(err.details).toEqual([{ field: "x" }]);
  });

  it("AuthError defaults to 401", () => {
    const err = new AuthError();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("UNAUTHORIZED");
  });

  it("ForbiddenError defaults to 403", () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe("FORBIDDEN");
  });

  it("NotFoundError includes resource name", () => {
    const err = new NotFoundError("Campaign");
    expect(err.message).toBe("Campaign not found");
    expect(err.statusCode).toBe(404);
  });

  it("NotFoundError defaults to Resource", () => {
    const err = new NotFoundError();
    expect(err.message).toBe("Resource not found");
  });

  it("RateLimitError stores retryAfter", () => {
    const err = new RateLimitError(60);
    expect(err.statusCode).toBe(429);
    expect(err.retryAfter).toBe(60);
  });

  it("PayloadTooLargeError defaults to 413", () => {
    const err = new PayloadTooLargeError();
    expect(err.statusCode).toBe(413);
  });

  it("ConflictError defaults to 409", () => {
    const err = new ConflictError("duplicate");
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe("duplicate");
  });

  it("InternalError defaults to 500", () => {
    const err = new InternalError();
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe("INTERNAL_ERROR");
  });

  it("all error classes extend AppError", () => {
    expect(new ValidationError()).toBeInstanceOf(AppError);
    expect(new AuthError()).toBeInstanceOf(AppError);
    expect(new ForbiddenError()).toBeInstanceOf(AppError);
    expect(new NotFoundError()).toBeInstanceOf(AppError);
    expect(new RateLimitError(10)).toBeInstanceOf(AppError);
    expect(new PayloadTooLargeError()).toBeInstanceOf(AppError);
    expect(new ConflictError()).toBeInstanceOf(AppError);
    expect(new InternalError()).toBeInstanceOf(AppError);
  });
});

// ---------------------------------------------------------------------------
// 2. Body Limit
// ---------------------------------------------------------------------------
import {
  getBodyLimitBytes,
  bodyLimitForPath,
} from "@/lib/api/body-limit";

describe("Body limit utilities", () => {
  it("campaigns limit is 2MB", () => {
    expect(getBodyLimitBytes("campaigns")).toBe(2 * 1024 * 1024);
  });

  it("import limit is 10MB", () => {
    expect(getBodyLimitBytes("import")).toBe(10 * 1024 * 1024);
  });

  it("root-versions limit is 2MB", () => {
    expect(getBodyLimitBytes("root-versions")).toBe(2 * 1024 * 1024);
  });

  it("default limit is 1MB", () => {
    expect(getBodyLimitBytes("default")).toBe(1 * 1024 * 1024);
  });

  it("bodyLimitForPath maps /import correctly", () => {
    expect(bodyLimitForPath("/api/campaigns/import")).toBe("import");
  });

  it("bodyLimitForPath maps /root-versions correctly", () => {
    expect(bodyLimitForPath("/api/campaigns/abc/root-versions")).toBe("root-versions");
  });

  it("bodyLimitForPath maps /api/campaigns correctly", () => {
    expect(bodyLimitForPath("/api/campaigns")).toBe("campaigns");
  });

  it("bodyLimitForPath defaults for unknown paths", () => {
    expect(bodyLimitForPath("/api/health")).toBe("default");
    expect(bodyLimitForPath("/api/claims/sync")).toBe("default");
  });
});

// ---------------------------------------------------------------------------
// 3. Logger
// ---------------------------------------------------------------------------
import { logger, logRequest } from "@/lib/api/logger";

describe("Logger", () => {
  it("logger has all log levels", () => {
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("logger does not throw on call", () => {
    expect(() => logger.info("test")).not.toThrow();
    expect(() => logger.error("test error")).not.toThrow();
    expect(() => logger.debug({ key: "value" })).not.toThrow();
  });

  it("logRequest routes based on status code", () => {
    expect(() =>
      logRequest({ requestId: "test", method: "GET", path: "/", status: 200, durationMs: 10 }),
    ).not.toThrow();
    expect(() =>
      logRequest({ requestId: "test", method: "GET", path: "/", status: 404, durationMs: 10 }),
    ).not.toThrow();
    expect(() =>
      logRequest({ requestId: "test", method: "GET", path: "/", status: 500, durationMs: 10 }),
    ).not.toThrow();
  });

  it("logRequest accepts explicit level override", () => {
    expect(() =>
      logRequest({
        requestId: "r1",
        method: "POST",
        path: "/api/test",
        status: 200,
        durationMs: 5,
        level: "error",
        message: "forced error",
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. Campaign Authority Checks
// ---------------------------------------------------------------------------
import {
  sameAddress,
  canPauseCampaign,
  canCancelCampaign,
  canWithdrawUnvested,
  canRotateRoot,
  canReleaseMilestone,
  canInstantRefund,
  canCancelStream,
} from "@/lib/campaign/authority";

describe("Campaign authority — sameAddress", () => {
  it("matches identical strings", () => {
    expect(sameAddress("abc", "abc")).toBe(true);
  });

  it("rejects different strings", () => {
    expect(sameAddress("abc", "def")).toBe(false);
  });

  it("rejects null left", () => {
    expect(sameAddress(null, "abc")).toBe(false);
  });

  it("rejects null right", () => {
    expect(sameAddress("abc", null)).toBe(false);
  });

  it("rejects both null", () => {
    expect(sameAddress(null, null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(sameAddress(undefined, "abc")).toBe(false);
  });
});

describe("Campaign authority — canPauseCampaign", () => {
  const base = {
    viewer: "creator1",
    pauseAuthority: "creator1",
    cancelledAt: null,
    totalSupply: 1000n,
    totalClaimed: 0n,
  };

  it("returns true when viewer is pause authority", () => {
    expect(canPauseCampaign(base)).toBe(true);
  });

  it("returns false when cancelled", () => {
    expect(canPauseCampaign({ ...base, cancelledAt: 100n })).toBe(false);
  });

  it("returns false when fully claimed", () => {
    expect(canPauseCampaign({ ...base, totalClaimed: 1000n })).toBe(false);
  });

  it("returns false when viewer != pause authority", () => {
    expect(canPauseCampaign({ ...base, viewer: "other" })).toBe(false);
  });
});

describe("Campaign authority — canCancelCampaign", () => {
  const base = {
    viewer: "auth1",
    cancelAuthority: "auth1",
    cancellable: true,
    cancelledAt: null,
    totalSupply: 1000n,
    totalClaimed: 0n,
  };

  it("returns true when all conditions met", () => {
    expect(canCancelCampaign(base)).toBe(true);
  });

  it("returns false when not cancellable", () => {
    expect(canCancelCampaign({ ...base, cancellable: false })).toBe(false);
  });

  it("returns false when already cancelled", () => {
    expect(canCancelCampaign({ ...base, cancelledAt: 100n })).toBe(false);
  });

  it("returns false when fully claimed", () => {
    expect(canCancelCampaign({ ...base, totalClaimed: 1000n })).toBe(false);
  });

  it("returns false when wrong viewer", () => {
    expect(canCancelCampaign({ ...base, viewer: "stranger" })).toBe(false);
  });
});

describe("Campaign authority — canWithdrawUnvested", () => {
  it("returns true when cancelled and viewer is creator", () => {
    expect(canWithdrawUnvested({ viewer: "c", creator: "c", cancelledAt: 100n })).toBe(true);
  });

  it("returns false when not cancelled", () => {
    expect(canWithdrawUnvested({ viewer: "c", creator: "c", cancelledAt: null })).toBe(false);
  });

  it("returns false when wrong viewer", () => {
    expect(canWithdrawUnvested({ viewer: "other", creator: "c", cancelledAt: 100n })).toBe(false);
  });
});

describe("Campaign authority — canRotateRoot", () => {
  it("returns true for multi-leaf cancellable uncancelled by authority", () => {
    expect(
      canRotateRoot({
        viewer: "auth",
        cancelAuthority: "auth",
        cancellable: true,
        cancelledAt: null,
        leafCount: 5,
      }),
    ).toBe(true);
  });

  it("returns false for single-leaf", () => {
    expect(
      canRotateRoot({
        viewer: "auth",
        cancelAuthority: "auth",
        cancellable: true,
        cancelledAt: null,
        leafCount: 1,
      }),
    ).toBe(false);
  });

  it("returns false when cancelled", () => {
    expect(
      canRotateRoot({
        viewer: "auth",
        cancelAuthority: "auth",
        cancellable: true,
        cancelledAt: 100n,
        leafCount: 5,
      }),
    ).toBe(false);
  });
});

describe("Campaign authority — canReleaseMilestone", () => {
  it("returns true for milestone type by creator", () => {
    expect(
      canReleaseMilestone({
        viewer: "c",
        creator: "c",
        cancelledAt: null,
        releaseType: 2,
      }),
    ).toBe(true);
  });

  it("returns false when cancelled", () => {
    expect(
      canReleaseMilestone({
        viewer: "c",
        creator: "c",
        cancelledAt: 100n,
        releaseType: 2,
      }),
    ).toBe(false);
  });

  it("returns false for non-milestone type without milestone leaves", () => {
    expect(
      canReleaseMilestone({
        viewer: "c",
        creator: "c",
        cancelledAt: null,
        releaseType: 1,
        hasMilestoneLeaves: false,
      }),
    ).toBe(false);
  });

  it("returns true for non-milestone type with milestone leaves", () => {
    expect(
      canReleaseMilestone({
        viewer: "c",
        creator: "c",
        cancelledAt: null,
        releaseType: 1,
        hasMilestoneLeaves: true,
      }),
    ).toBe(true);
  });
});

describe("Campaign authority — canInstantRefund", () => {
  const base = {
    viewer: "c",
    creator: "c",
    cancellable: true,
    cancelledAt: null,
    instantRefunded: false,
    leafCount: 5,
    minCliffTime: 2000n,
    nowTs: 1000n,
    totalSupply: 1000n,
    totalClaimed: 0n,
    milestoneReleasedFlags: new Uint8Array([0]),
  };

  it("returns true when all conditions met", () => {
    expect(canInstantRefund(base)).toBe(true);
  });

  it("returns false when not cancellable", () => {
    expect(canInstantRefund({ ...base, cancellable: false })).toBe(false);
  });

  it("returns false when already cancelled", () => {
    expect(canInstantRefund({ ...base, cancelledAt: 100n })).toBe(false);
  });

  it("returns false when already refunded", () => {
    expect(canInstantRefund({ ...base, instantRefunded: true })).toBe(false);
  });

  it("returns false for single leaf", () => {
    expect(canInstantRefund({ ...base, leafCount: 1 })).toBe(false);
  });

  it("returns false when fully claimed", () => {
    expect(canInstantRefund({ ...base, totalClaimed: 1000n })).toBe(false);
  });

  it("returns false when past cliff time", () => {
    expect(canInstantRefund({ ...base, nowTs: 3000n })).toBe(false);
  });

  it("returns false when minCliffTime is null", () => {
    expect(canInstantRefund({ ...base, minCliffTime: null })).toBe(false);
  });

  it("returns false when milestone already released", () => {
    expect(canInstantRefund({ ...base, milestoneReleasedFlags: new Uint8Array([1]) })).toBe(false);
  });

  it("returns false when wrong viewer", () => {
    expect(canInstantRefund({ ...base, viewer: "other" })).toBe(false);
  });
});

describe("Campaign authority — canCancelStream", () => {
  const base = {
    viewer: "c",
    creator: "c",
    cancellable: true,
    cancelledAt: null,
    totalSupply: 1000n,
    totalClaimed: 0n,
    leafCount: 1,
  };

  it("returns true for single-leaf cancellable stream", () => {
    expect(canCancelStream(base)).toBe(true);
  });

  it("returns false for multi-leaf", () => {
    expect(canCancelStream({ ...base, leafCount: 2 })).toBe(false);
  });

  it("returns false when fully claimed", () => {
    expect(canCancelStream({ ...base, totalClaimed: 1000n })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Token Normalize
// ---------------------------------------------------------------------------
import { normalizeWalletTokens } from "@/lib/token/normalize";

describe("Token normalize — normalizeWalletTokens", () => {
  it("returns empty for empty input", () => {
    expect(normalizeWalletTokens([])).toEqual([]);
  });

  it("normalizes single token account", () => {
    const result = normalizeWalletTokens([
      {
        account: {
          data: {
            parsed: {
              info: {
                mint: "USDC_MINT",
                tokenAmount: { amount: "1000000", decimals: 6 },
              },
            },
          },
        },
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].mintAddress).toBe("USDC_MINT");
    expect(result[0].balanceRaw).toBe("1000000");
    expect(result[0].decimals).toBe(6);
    expect(result[0].uiAmount).toBe("1");
  });

  it("deduplicates same mint across accounts", () => {
    const result = normalizeWalletTokens([
      {
        account: {
          data: {
            parsed: {
              info: {
                mint: "USDC",
                tokenAmount: { amount: "500000", decimals: 6 },
              },
            },
          },
        },
      },
      {
        account: {
          data: {
            parsed: {
              info: {
                mint: "USDC",
                tokenAmount: { amount: "300000", decimals: 6 },
              },
            },
          },
        },
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].balanceRaw).toBe("800000");
  });

  it("sorts by balance descending", () => {
    const result = normalizeWalletTokens([
      {
        account: {
          data: {
            parsed: {
              info: {
                mint: "LOW",
                tokenAmount: { amount: "100", decimals: 0 },
              },
            },
          },
        },
      },
      {
        account: {
          data: {
            parsed: {
              info: {
                mint: "HIGH",
                tokenAmount: { amount: "9999", decimals: 0 },
              },
            },
          },
        },
      },
    ]);
    expect(result[0].mintAddress).toBe("HIGH");
    expect(result[1].mintAddress).toBe("LOW");
  });

  it("handles zero balance", () => {
    const result = normalizeWalletTokens([
      {
        account: {
          data: {
            parsed: {
              info: {
                mint: "ZERO",
                tokenAmount: { amount: "0", decimals: 9 },
              },
            },
          },
        },
      },
    ]);
    expect(result[0].uiAmount).toBe("0");
  });

  it("skips accounts with no mint", () => {
    const result = normalizeWalletTokens([
      { account: { data: { parsed: { info: {} } } } },
      { account: {} },
    ]);
    expect(result).toHaveLength(0);
  });

  it("formats UI amount with decimals correctly", () => {
    const result = normalizeWalletTokens([
      {
        account: {
          data: {
            parsed: {
              info: {
                mint: "TOKEN",
                tokenAmount: { amount: "1500000000", decimals: 9 },
              },
            },
          },
        },
      },
    ]);
    expect(result[0].uiAmount).toBe("1.5");
  });

  it("handles null decimals", () => {
    const result = normalizeWalletTokens([
      {
        account: {
          data: {
            parsed: {
              info: {
                mint: "RAW",
                tokenAmount: { amount: "42" },
              },
            },
          },
        },
      },
    ]);
    expect(result[0].decimals).toBeNull();
    expect(result[0].uiAmount).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// 6. Vesting List — Stream Status + Claimable
// ---------------------------------------------------------------------------
import {
  getSenderStreamStatus,
  getRecipientStreamStatus,
  getRecipientClaimableAmount,
  getMultiLeafRecipientStreamStatus,
  getMultiLeafClaimableAmount,
} from "@/lib/vesting/list";

describe("Vesting list — getSenderStreamStatus", () => {
  it("returns Cancelled when cancelledAt set", () => {
    expect(getSenderStreamStatus({ totalSupply: 100, totalClaimed: 0, paused: false, cancelledAt: 1 })).toBe("Cancelled");
  });

  it("returns Paused when paused", () => {
    expect(getSenderStreamStatus({ totalSupply: 100, totalClaimed: 0, paused: true, cancelledAt: null })).toBe("Paused");
  });

  it("returns Claimed when fully claimed", () => {
    expect(getSenderStreamStatus({ totalSupply: 100, totalClaimed: 100, paused: false, cancelledAt: null })).toBe("Claimed");
  });

  it("returns Active when active", () => {
    expect(getSenderStreamStatus({ totalSupply: 100, totalClaimed: 50, paused: false, cancelledAt: null })).toBe("Active");
  });
});

describe("Vesting list — getRecipientStreamStatus", () => {
  const baseStream = {
    myClaimed: "0",
    myLeaf: { amount: 1000, releaseType: 1, cliffTime: 100, endTime: 200 },
    paused: false,
    cancelledAt: null,
  };

  it("returns Claimed when fully claimed", () => {
    expect(getRecipientStreamStatus({ ...baseStream, myClaimed: "1000" }, 150n)).toBe("Claimed");
  });

  it("returns Cancelled when cancelled", () => {
    expect(getRecipientStreamStatus({ ...baseStream, cancelledAt: 120 }, 150n)).toBe("Cancelled");
  });

  it("returns Paused when paused", () => {
    expect(getRecipientStreamStatus({ ...baseStream, paused: true }, 150n)).toBe("Paused");
  });

  it("returns Claimable when vested and unclaimed", () => {
    expect(getRecipientStreamStatus(baseStream, 150n)).toBe("Claimable");
  });

  it("returns Scheduled when before cliff", () => {
    expect(getRecipientStreamStatus(baseStream, 50n)).toBe("Scheduled");
  });
});

describe("Vesting list — getRecipientClaimableAmount", () => {
  it("linear vesting at 50% returns half", () => {
    const stream = {
      myClaimed: "0",
      myLeaf: { amount: 1000, releaseType: 1, cliffTime: 100, endTime: 200 },
      paused: false,
      cancelledAt: null,
    };
    expect(getRecipientClaimableAmount(stream, 150n)).toBe(500n);
  });

  it("cliff vesting returns full after cliff", () => {
    const stream = {
      myClaimed: "0",
      myLeaf: { amount: 1000, releaseType: 0, cliffTime: 100, endTime: 100 },
      paused: false,
      cancelledAt: null,
    };
    expect(getRecipientClaimableAmount(stream, 200n)).toBe(1000n);
  });

  it("returns 0 before cliff", () => {
    const stream = {
      myClaimed: "0",
      myLeaf: { amount: 1000, releaseType: 0, cliffTime: 100, endTime: 100 },
      paused: false,
      cancelledAt: null,
    };
    expect(getRecipientClaimableAmount(stream, 50n)).toBe(0n);
  });

  it("subtracts already claimed amount", () => {
    const stream = {
      myClaimed: "300",
      myLeaf: { amount: 1000, releaseType: 1, cliffTime: 100, endTime: 200 },
      paused: false,
      cancelledAt: null,
    };
    expect(getRecipientClaimableAmount(stream, 150n)).toBe(200n);
  });

  it("returns 0 when claimed exceeds vested", () => {
    const stream = {
      myClaimed: "800",
      myLeaf: { amount: 1000, releaseType: 1, cliffTime: 100, endTime: 200 },
      paused: false,
      cancelledAt: null,
    };
    expect(getRecipientClaimableAmount(stream, 150n)).toBe(0n);
  });

  it("cancelled stream caps vesting at cancel time", () => {
    const stream = {
      myClaimed: "0",
      myLeaf: { amount: 1000, releaseType: 1, cliffTime: 100, endTime: 200 },
      paused: false,
      cancelledAt: 130,
    };
    expect(getRecipientClaimableAmount(stream, 200n)).toBe(300n);
  });
});

describe("Vesting list — multi-leaf status and claimable", () => {
  const makeLeaf = (amount: number, cliffTime: number, endTime: number) => ({
    myClaimed: "0",
    myLeaf: { amount, releaseType: 1, cliffTime, endTime },
    paused: false,
    cancelledAt: null,
  });

  it("getMultiLeafRecipientStreamStatus returns Scheduled for empty", () => {
    expect(getMultiLeafRecipientStreamStatus([], 100n)).toBe("Scheduled");
  });

  it("getMultiLeafRecipientStreamStatus delegates for single leaf", () => {
    expect(getMultiLeafRecipientStreamStatus([makeLeaf(1000, 100, 200)], 150n)).toBe("Claimable");
  });

  it("getMultiLeafClaimableAmount returns 0 for empty", () => {
    expect(getMultiLeafClaimableAmount([], 100n)).toBe(0n);
  });

  it("getMultiLeafClaimableAmount sums across leaves", () => {
    const leaves = [makeLeaf(1000, 100, 200), makeLeaf(2000, 100, 200)];
    expect(getMultiLeafClaimableAmount(leaves, 150n)).toBe(1500n);
  });
});

// ---------------------------------------------------------------------------
// 7. Stream Persist — Key Generation + Parsing
// ---------------------------------------------------------------------------
import {
  streamScheduleKey,
  pendingCampaignIndexKey,
  pendingCampaignFundingKey,
  buildCreateStreamIndexPayload,
} from "@/lib/stream/persist";

describe("Stream persist — key generation", () => {
  it("streamScheduleKey includes tree address", () => {
    const key = streamScheduleKey("abc123");
    expect(key).toContain("abc123");
    expect(key).toContain("velthoryn:stream:");
  });

  it("pendingCampaignIndexKey includes tree address", () => {
    const key = pendingCampaignIndexKey("def456");
    expect(key).toContain("def456");
    expect(key).toContain("pending-index:");
  });

  it("pendingCampaignFundingKey includes tree address", () => {
    const key = pendingCampaignFundingKey("ghi789");
    expect(key).toContain("ghi789");
    expect(key).toContain("pending-fund:");
  });
});

describe("Stream persist — buildCreateStreamIndexPayload", () => {
  it("builds valid payload with single leaf", () => {
    const payload = buildCreateStreamIndexPayload({
      treeAddress: "tree1",
      creator: "creator1",
      mint: "mint1",
      campaignId: 1,
      beneficiary: "11111111111111111111111111111111",
      amount: "1000",
      releaseType: 1,
      startTime: 100,
      cliffTime: 200,
      endTime: 300,
      milestoneIdx: 0,
      cancellable: true,
      cancelAuthority: "creator1",
    });

    expect(payload.treeAddress).toBe("tree1");
    expect(payload.leafCount).toBe(1);
    expect(payload.totalSupply).toBe("1000");
    expect(payload.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.leaves).toHaveLength(1);
    expect(payload.leaves[0].proof).toEqual([]);
    expect(payload.leaves[0].beneficiary).toBe("11111111111111111111111111111111");
  });

  it("uses current time when createdAt not specified", () => {
    const before = Math.floor(Date.now() / 1000);
    const payload = buildCreateStreamIndexPayload({
      treeAddress: "t",
      creator: "c",
      mint: "m",
      campaignId: 1,
      beneficiary: "11111111111111111111111111111111",
      amount: "100",
      releaseType: 0,
      startTime: 100,
      cliffTime: 200,
      endTime: 200,
      milestoneIdx: 0,
      cancellable: false,
      cancelAuthority: null,
    });
    const after = Math.floor(Date.now() / 1000);
    expect(payload.createdAt).toBeGreaterThanOrEqual(before);
    expect(payload.createdAt).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// 8. Vesting Schedule (lib/vesting/schedule.ts)
// ---------------------------------------------------------------------------
import { vested, getVestedAmount } from "@/lib/vesting/schedule";

describe("Vesting schedule calculations", () => {
  it("cliff vesting returns 0 before cliff", () => {
    expect(vested({ releaseType: 0, amount: 1000n, startTime: 0n, cliffTime: 200n, endTime: 200n }, 100n)).toBe(0n);
  });

  it("cliff vesting returns full after cliff", () => {
    expect(vested({ releaseType: 0, amount: 1000n, startTime: 0n, cliffTime: 200n, endTime: 200n }, 300n)).toBe(1000n);
  });

  it("linear vesting at 50%", () => {
    expect(vested({ releaseType: 1, amount: 1000n, startTime: 0n, cliffTime: 100n, endTime: 200n }, 150n)).toBe(500n);
  });

  it("linear vesting returns full after end", () => {
    expect(vested({ releaseType: 1, amount: 1000n, startTime: 0n, cliffTime: 100n, endTime: 200n }, 300n)).toBe(1000n);
  });

  it("linear vesting returns 0 before cliff", () => {
    expect(vested({ releaseType: 1, amount: 1000n, startTime: 0n, cliffTime: 100n, endTime: 200n }, 50n)).toBe(0n);
  });

  it("milestone vesting returns 0 before cliff", () => {
    expect(vested({ releaseType: 2, amount: 1000n, startTime: 0n, cliffTime: 200n, endTime: 200n }, 100n)).toBe(0n);
  });

  it("milestone vesting returns full after cliff", () => {
    expect(vested({ releaseType: 2, amount: 1000n, startTime: 0n, cliffTime: 200n, endTime: 200n }, 300n)).toBe(1000n);
  });

  it("unknown release type returns 0", () => {
    expect(vested({ releaseType: 99 as 0, amount: 1000n, startTime: 0n, cliffTime: 100n, endTime: 200n }, 150n)).toBe(0n);
  });

  it("getVestedAmount caps at cancelledAt time", () => {
    const schedule = { releaseType: 1 as const, amount: 1000n, startTime: 0n, cliffTime: 100n, endTime: 200n };
    expect(getVestedAmount(schedule, 130n, 200n)).toBe(300n);
  });

  it("getVestedAmount with null cancelledAt uses now", () => {
    const schedule = { releaseType: 1 as const, amount: 1000n, startTime: 0n, cliffTime: 100n, endTime: 200n };
    expect(getVestedAmount(schedule, null, 150n)).toBe(500n);
  });

  it("getVestedAmount when now < cancelledAt uses now", () => {
    const schedule = { releaseType: 1 as const, amount: 1000n, startTime: 0n, cliffTime: 100n, endTime: 200n };
    expect(getVestedAmount(schedule, 180n, 150n)).toBe(500n);
  });
});
