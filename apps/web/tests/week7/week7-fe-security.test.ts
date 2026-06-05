/**
 * Week 7 — FE Security Test Suite
 *
 * Tests FE-side security properties:
 *   1. Input sanitization — XSS, HTML injection, script tags
 *   2. Public key validation — prevents arbitrary data injection
 *   3. Amount overflow protection — BigInt safe math
 *   4. Error message sanitization — no internal leak
 *   5. Merkle proof integrity — tamper detection
 *   6. Milestone bitmap bounds — no out-of-range access
 *   7. CSV injection — formula injection prevention
 *   8. SOL wrap — amount safety
 */
import { describe, it, expect } from "vitest";
import {
  validatePublicKey,
  validateAmountWithDecimals,
  validateAmount,
  validateCampaignId,
  validateMilestoneIdx,
  validateCreateStreamForm,
  hasErrors,
} from "@/lib/validation/stream-form";
import {
  parseBulkCsv,
  toRawAmount,
} from "@/lib/campaign/bulk";
import {
  formatVestingError,
  isRetryableError,
  VESTING_ERROR_CODES,
} from "@/lib/anchor/errors";
import { verifyLeafProof, verifyAllLeaves } from "@/lib/merkle/verify";
import { isMilestoneTriggered } from "@/lib/vesting/milestone";
import { solToLamports } from "@/lib/sol/auto-wrap";

// ---------------------------------------------------------------------------
// 1. XSS Prevention — Input Validation Blocks Injection
// ---------------------------------------------------------------------------
describe("Security — XSS prevention via input validation", () => {
  const xssPayloads = [
    "<script>alert('xss')</script>",
    "<img src=x onerror=alert(1)>",
    "javascript:alert(1)",
    "<svg onload=alert(1)>",
    "'\"><script>alert(1)</script>",
    "<iframe src='evil.com'></iframe>",
    "{{constructor.constructor('return this')()}}",
    "${7*7}",
    "<a href=\"javascript:alert(1)\">click</a>",
    "data:text/html,<script>alert(1)</script>",
  ];

  it("rejects all XSS payloads in beneficiary field", () => {
    for (const payload of xssPayloads) {
      const result = validatePublicKey(payload);
      expect(result).toBe("Invalid Solana address.");
    }
  });

  it("rejects XSS in mint address field", () => {
    for (const payload of xssPayloads) {
      const result = validatePublicKey(payload);
      expect(result).not.toBeNull();
    }
  });

  it("rejects XSS in amount field", () => {
    expect(validateAmount("<script>")).toContain("positive integer");
    expect(validateAmountWithDecimals("<img>", 6)).toContain("positive number");
  });

  it("rejects XSS in campaign ID field", () => {
    expect(validateCampaignId("<script>")).toContain("positive integer");
  });

  it("rejects XSS in milestone index field", () => {
    expect(validateMilestoneIdx("<script>")).toContain("0–255");
  });

  it("XSS in full form produces validation errors before submission", () => {
    const errors = validateCreateStreamForm({
      beneficiary: "<script>alert(1)</script>",
      mintAddress: "<img src=x onerror=alert(1)>",
      amount: "<script>",
      mintDecimals: null,
      campaignId: "javascript:void(0)",
      startUnix: NaN,
      cliffUnix: NaN,
      endUnix: NaN,
      releaseType: 1,
      milestoneIdx: "0",
    });
    expect(hasErrors(errors)).toBe(true);
    expect(errors.beneficiary).toBeTruthy();
    expect(errors.mintAddress).toBeTruthy();
    expect(errors.amount).toBeTruthy();
    expect(errors.campaignId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. SQL Injection Prevention
// ---------------------------------------------------------------------------
describe("Security — SQL injection prevention", () => {
  const sqlPayloads = [
    "'; DROP TABLE campaigns; --",
    "1 OR 1=1",
    "1; DELETE FROM users",
    "' UNION SELECT * FROM users --",
    "1') OR ('1'='1",
  ];

  it("rejects SQL payloads in address fields", () => {
    for (const payload of sqlPayloads) {
      expect(validatePublicKey(payload)).toBe("Invalid Solana address.");
    }
  });

  it("rejects SQL payloads in amount fields", () => {
    for (const payload of sqlPayloads) {
      expect(validateAmount(payload)).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. CSV Injection Prevention
// ---------------------------------------------------------------------------
describe("Security — CSV formula injection prevention", () => {
  it("CSV with formula in beneficiary rejects as invalid address", () => {
    const csv = [
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
      "=CMD('calc'),1000,Linear,1700000000,1700001000,1700002000,0",
    ].join("\n");
    const result = parseBulkCsv(csv, null);
    expect(result.issues.some((i) => i.message.includes("valid Solana"))).toBe(true);
  });

  it("CSV with formula prefix in amount rejects", () => {
    const csv = [
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
      "11111111111111111111111111111111,=1+1,Linear,1700000000,1700001000,1700002000,0",
    ].join("\n");
    const result = parseBulkCsv(csv, null);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("CSV with +cmd formula in release type rejects", () => {
    const csv = [
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
      "11111111111111111111111111111111,1000,+CMD,1700000000,1700001000,1700002000,0",
    ].join("\n");
    const result = parseBulkCsv(csv, null);
    expect(result.issues.some((i) => i.message.includes("Unknown vesting type"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Amount Overflow Protection
// ---------------------------------------------------------------------------
describe("Security — amount overflow protection", () => {
  it("validates u64 max value without overflow", () => {
    const u64Max = "18446744073709551615";
    expect(validateAmount(u64Max)).toBeNull();
  });

  it("toRawAmount handles large decimal conversions safely", () => {
    const result = toRawAmount("999999999.999999999", 9);
    expect(() => BigInt(result)).not.toThrow();
    expect(BigInt(result)).toBe(999999999999999999n);
  });

  it("toRawAmount result fits in u64 for normal amounts", () => {
    const result = toRawAmount("1000000", 9);
    const value = BigInt(result);
    expect(value).toBeLessThanOrEqual(BigInt("18446744073709551615"));
  });

  it("solToLamports returns integer for fractional SOL", () => {
    const result = solToLamports("1.5", 9);
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBe(1_500_000_000);
  });

  it("solToLamports uses floor for precision safety", () => {
    const result = solToLamports("0.1", 9);
    expect(result).toBe(100_000_000);
  });
});

// ---------------------------------------------------------------------------
// 5. Error Message Sanitization — No Internal Leak
// ---------------------------------------------------------------------------
describe("Security — error message sanitization", () => {
  it("sanitizes long error messages to prevent internal leak", () => {
    const longError = new Error("x".repeat(300));
    const result = formatVestingError(longError);
    expect(result).toBe("Transaction failed. Please try again.");
    expect(result.length).toBeLessThan(100);
  });

  it("sanitizes stack traces in error messages", () => {
    const result = formatVestingError(new Error("Error at line 42\n  at Function.handleError"));
    expect(result).toBe("Transaction failed. Please try again.");
  });

  it("sanitizes URLs in error messages", () => {
    const result = formatVestingError(new Error("Failed: https://api.internal.com/secret"));
    expect(result).toBe("Transaction failed. Please try again.");
    expect(result).not.toContain("internal");
  });

  it("maps known Anchor error codes to user-friendly messages", () => {
    expect(formatVestingError({ message: "custom program error: 0x1770" })).toBe(
      "Merkle root cannot be empty.",
    );
    expect(formatVestingError({ message: "Unauthorized" })).toBe(
      "You are not authorized for this action.",
    );
    expect(formatVestingError({ message: "CampaignPaused" })).toBe(
      "Campaign is paused. Contact the creator.",
    );
  });

  it("maps wallet rejection to friendly message", () => {
    expect(formatVestingError(new Error("User rejected the request"))).toBe(
      "Wallet approval did not complete.",
    );
    expect(formatVestingError(new Error("Transaction cancelled in wallet"))).toBe(
      "Wallet approval did not complete.",
    );
  });

  it("maps network errors to friendly message", () => {
    expect(formatVestingError(new Error("Failed to fetch"))).toBe(
      "Network error. Check your connection and try again.",
    );
    expect(formatVestingError(new Error("ECONNREFUSED"))).toBe(
      "Network error. Check your connection and try again.",
    );
  });

  it("maps expired blockhash to friendly message", () => {
    expect(formatVestingError(new Error("BlockhashNotFound"))).toBe(
      "Transaction expired. Please try again.",
    );
  });

  it("handles non-Error inputs safely", () => {
    expect(formatVestingError("plain string")).toBe("plain string");
    expect(formatVestingError(42)).toBe("42");
    expect(formatVestingError(null)).toBe("null");
    expect(formatVestingError(undefined)).toBe("undefined");
  });

  it("isRetryableError identifies transient failures", () => {
    expect(isRetryableError(new Error("BlockhashNotFound"))).toBe(true);
    expect(isRetryableError(new Error("Failed to fetch"))).toBe(true);
    expect(isRetryableError(new Error("ETIMEDOUT"))).toBe(true);
    expect(isRetryableError(new Error("Unauthorized"))).toBe(false);
    expect(isRetryableError(new Error("InvalidProof"))).toBe(false);
  });

  it("all vesting error codes have user-facing messages", () => {
    const codes = Object.keys(VESTING_ERROR_CODES);
    for (const code of codes) {
      const result = formatVestingError({ message: code });
      expect(result).not.toBe("Transaction failed. Please try again.");
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Merkle Proof Integrity — Tamper Detection
// ---------------------------------------------------------------------------
describe("Security — Merkle proof tamper detection", () => {
  it("rejects proof with wrong leaf data", () => {
    const result = verifyLeafProof(
      {
        leafIndex: 0,
        beneficiary: "11111111111111111111111111111111",
        amount: "999",
        releaseType: 1,
        startTime: "1000",
        cliffTime: "2000",
        endTime: "3000",
        milestoneIdx: 0,
        proof: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]],
      },
      "0000000000000000000000000000000000000000000000000000000000000000",
      2,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects multi-leaf without proof", () => {
    const result = verifyLeafProof(
      {
        leafIndex: 0,
        beneficiary: "11111111111111111111111111111111",
        amount: "1000",
        releaseType: 1,
        startTime: "1000",
        cliffTime: "2000",
        endTime: "3000",
        milestoneIdx: 0,
        proof: [],
      },
      "0000000000000000000000000000000000000000000000000000000000000000",
      2,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("requires proof");
    }
  });

  it("verifyAllLeaves fails fast on first invalid leaf", () => {
    const fakeRoot = "0000000000000000000000000000000000000000000000000000000000000000";
    const result = verifyAllLeaves(
      [
        {
          leafIndex: 0,
          beneficiary: "11111111111111111111111111111111",
          amount: "1000",
          releaseType: 1,
          startTime: "1000",
          cliffTime: "2000",
          endTime: "3000",
          milestoneIdx: 0,
          proof: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]],
        },
        {
          leafIndex: 1,
          beneficiary: "22222222222222222222222222222222",
          amount: "2000",
          releaseType: 1,
          startTime: "1000",
          cliffTime: "2000",
          endTime: "3000",
          milestoneIdx: 0,
          proof: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]],
        },
      ],
      fakeRoot,
    );
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Milestone Bitmap Security — Bounds Checking
// ---------------------------------------------------------------------------
describe("Security — milestone bitmap bounds checking", () => {
  it("negative index returns false (no crash)", () => {
    const bitmap = new Uint8Array([0xFF]);
    expect(isMilestoneTriggered(bitmap, -1)).toBe(false);
  });

  it("index 256 (beyond u8 range) returns false", () => {
    const bitmap = new Uint8Array(32).fill(0xFF);
    expect(isMilestoneTriggered(bitmap, 256)).toBe(false);
  });

  it("index beyond bitmap length returns false safely", () => {
    const bitmap = new Uint8Array([0xFF]);
    expect(isMilestoneTriggered(bitmap, 8)).toBe(false);
    expect(isMilestoneTriggered(bitmap, 100)).toBe(false);
  });

  it("empty bitmap handles any index without crash", () => {
    const bitmap = new Uint8Array(0);
    for (let i = 0; i < 300; i++) {
      expect(isMilestoneTriggered(bitmap, i)).toBe(false);
    }
  });

  it("correct bit isolation — only targeted bit is true", () => {
    for (let targetBit = 0; targetBit < 8; targetBit++) {
      const bitmap = new Uint8Array([1 << targetBit]);
      for (let checkBit = 0; checkBit < 8; checkBit++) {
        expect(isMilestoneTriggered(bitmap, checkBit)).toBe(checkBit === targetBit);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Public Key Spoofing Protection
// ---------------------------------------------------------------------------
describe("Security — public key spoofing protection", () => {
  it("rejects null bytes embedded in address", () => {
    expect(validatePublicKey("1111\x001111111111111111111111111")).toBe("Invalid Solana address.");
  });

  it("rejects unicode lookalikes", () => {
    expect(validatePublicKey("ЕPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe(
      "Invalid Solana address.",
    );
  });

  it("trims trailing whitespace/newline before validation (safe: trim strips injection)", () => {
    const addr = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\n";
    const result = validatePublicKey(addr);
    expect(result).toBeNull();
  });

  it("rejects address with embedded tab", () => {
    expect(validatePublicKey("EPjFWdd5\tAufqSSqeM2qN1xzybapC8G4wEGGk")).toBe(
      "Invalid Solana address.",
    );
  });
});

// ---------------------------------------------------------------------------
// 9. Retryable vs Non-Retryable Error Classification
// ---------------------------------------------------------------------------
describe("Security — error classification for retry safety", () => {
  const retryable = [
    "BlockhashNotFound",
    "TransactionExpiredBlockheightExceeded",
    "Failed to fetch",
    "NetworkError",
    "ECONNREFUSED",
    "timeout",
    "ETIMEDOUT",
  ];

  const nonRetryable = [
    "Unauthorized",
    "InvalidProof",
    "OverClaim",
    "AlreadyCancelled",
    "NotCancellable",
    "CampaignPaused",
    "ZeroAmount",
  ];

  it("classifies transient errors as retryable", () => {
    for (const msg of retryable) {
      expect(isRetryableError(new Error(msg))).toBe(true);
    }
  });

  it("classifies permanent errors as non-retryable", () => {
    for (const msg of nonRetryable) {
      expect(isRetryableError(new Error(msg))).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 10. VESTING_ERROR_CODES Exhaustiveness
// ---------------------------------------------------------------------------
describe("Security — error code exhaustiveness", () => {
  it("every error code maps to a unique number", () => {
    const values = Object.values(VESTING_ERROR_CODES);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it("error codes are sequential from 6000", () => {
    const values = Object.values(VESTING_ERROR_CODES).sort((a, b) => a - b);
    expect(values[0]).toBe(6000);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBe(values[i - 1] + 1);
    }
  });

  it("formatVestingError handles every code by name", () => {
    const keys = Object.keys(VESTING_ERROR_CODES);
    for (const key of keys) {
      const result = formatVestingError({ message: key });
      expect(result).not.toBe("Transaction failed. Please try again.");
      expect(result.length).toBeGreaterThan(5);
    }
  });

  it("formatVestingError handles every code by hex", () => {
    const entries = Object.entries(VESTING_ERROR_CODES);
    for (const [, code] of entries) {
      const hex = `custom program error: 0x${code.toString(16)}`;
      const result = formatVestingError({ message: hex });
      expect(result).not.toBe("Transaction failed. Please try again.");
    }
  });
});
