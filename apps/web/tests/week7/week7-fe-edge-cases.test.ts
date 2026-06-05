/**
 * Week 7 — FE Edge Case Test Suite
 *
 * Boundary conditions, zero/overflow amounts, wallet states,
 * malformed inputs, and runtime corner cases.
 */
import { describe, it, expect } from "vitest";
import {
  validatePublicKey,
  validateAmountWithDecimals,
  validateAmount,
  validateSchedule,
  validateCampaignId,
  validateMilestoneIdx,
  validateCreateStreamForm,
  hasErrors,
} from "@/lib/validation/stream-form";
import {
  parseBulkCsv,
  prepareBulkCampaign,
  toRawAmount,
} from "@/lib/campaign/bulk";
import {
  getGracePeriodState,
  getWithdrawDisabledReason,
  formatCountdown,
  GRACE_PERIOD_SECS,
} from "@/lib/vesting/display";
import { solToLamports } from "@/lib/sol/auto-wrap";
import { isMilestoneTriggered } from "@/lib/vesting/milestone";

// ---------------------------------------------------------------------------
// 1. Zero Amount Edge Cases
// ---------------------------------------------------------------------------
describe("Edge case — zero and boundary amounts", () => {
  it("rejects zero amount (raw integer)", () => {
    expect(validateAmount("0")).toContain("greater than zero");
  });

  it("rejects zero amount with decimals", () => {
    expect(validateAmountWithDecimals("0.000000", 6)).toContain("greater than zero");
  });

  it("accepts minimum non-zero amount", () => {
    expect(validateAmountWithDecimals("0.000001", 6)).toBeNull();
  });

  it("accepts u64-max-range amount (raw)", () => {
    expect(validateAmount("18446744073709551615")).toBeNull();
  });

  it("rejects negative amount", () => {
    expect(validateAmount("-1")).toContain("positive integer");
  });

  it("rejects amount with leading minus and decimals", () => {
    expect(validateAmountWithDecimals("-10.5", 6)).toContain("positive number");
  });

  it("handles very large decimal amounts", () => {
    expect(validateAmountWithDecimals("999999999.999999", 6)).toBeNull();
  });

  it("toRawAmount converts minimum fraction correctly", () => {
    expect(toRawAmount("0.000001", 6)).toBe("1");
  });

  it("toRawAmount with 0 decimals", () => {
    expect(toRawAmount("42", 0)).toBe("42");
  });

  it("solToLamports precision edge case", () => {
    expect(solToLamports("0.000000001", 9)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Invalid Address Edge Cases
// ---------------------------------------------------------------------------
describe("Edge case — invalid Solana addresses", () => {
  it("rejects empty string", () => {
    expect(validatePublicKey("")).toBe("Required.");
  });

  it("rejects whitespace only", () => {
    expect(validatePublicKey("   ")).toBe("Required.");
  });

  it("rejects HTML in address field", () => {
    expect(validatePublicKey("<div>attack</div>")).toBe("Invalid Solana address.");
  });

  it("rejects script tag in address field", () => {
    expect(validatePublicKey("<script>alert(1)</script>")).toBe("Invalid Solana address.");
  });

  it("rejects SQL injection in address field", () => {
    expect(validatePublicKey("'; DROP TABLE users; --")).toBe("Invalid Solana address.");
  });

  it("rejects URL in address field", () => {
    expect(validatePublicKey("https://malicious.site")).toBe("Invalid Solana address.");
  });

  it("accepts valid base58 address", () => {
    expect(validatePublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBeNull();
  });

  it("rejects base58 with invalid chars (0, O, I, l)", () => {
    expect(validatePublicKey("0OIl1111111111111111111111111111")).toBe("Invalid Solana address.");
  });

  it("rejects excessively long string", () => {
    expect(validatePublicKey("A".repeat(1000))).toBe("Invalid Solana address.");
  });
});

// ---------------------------------------------------------------------------
// 3. Schedule Boundary Conditions
// ---------------------------------------------------------------------------
describe("Edge case — schedule boundary conditions", () => {
  it("accepts cliff == start == end (instant cliff)", () => {
    expect(validateSchedule(1000, 1000, 1000, 0)).toBeNull();
  });

  it("accepts start == cliff for linear (no cliff delay)", () => {
    expect(validateSchedule(1000, 1000, 2000, 1)).toBeNull();
  });

  it("rejects end < cliff", () => {
    expect(validateSchedule(100, 300, 200, 1)).toContain("on or after cliff");
  });

  it("rejects cliff exactly 1s after start (below 60s minimum)", () => {
    expect(validateSchedule(100, 101, 200, 1)).toContain("60 seconds");
  });

  it("accepts cliff exactly 60s after start", () => {
    expect(validateSchedule(100, 160, 300, 1)).toBeNull();
  });

  it("rejects NaN in any position", () => {
    expect(validateSchedule(NaN, 200, 300, 1)).toContain("required");
    expect(validateSchedule(100, NaN, 300, 1)).toContain("required");
    expect(validateSchedule(100, 200, NaN, 1)).toContain("required");
  });

  it("handles Unix timestamp at epoch boundary", () => {
    expect(validateSchedule(0, 0, 0, 0)).toBeNull();
  });

  it("handles far-future timestamps (year 2100)", () => {
    const y2100 = 4102444800;
    expect(validateSchedule(y2100, y2100 + 86400, y2100 + 86400, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Campaign ID Edge Cases
// ---------------------------------------------------------------------------
describe("Edge case — campaign ID validation", () => {
  it("rejects zero", () => {
    expect(validateCampaignId("0")).toContain("positive integer");
  });

  it("rejects negative", () => {
    expect(validateCampaignId("-5")).toContain("positive integer");
  });

  it("rejects float", () => {
    expect(validateCampaignId("1.5")).toContain("positive integer");
  });

  it("rejects non-numeric", () => {
    expect(validateCampaignId("abc")).toContain("positive integer");
  });

  it("accepts large integer", () => {
    expect(validateCampaignId("999999")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Milestone Index Boundaries
// ---------------------------------------------------------------------------
describe("Edge case — milestone index boundaries", () => {
  it("accepts 0 (minimum)", () => {
    expect(validateMilestoneIdx("0")).toBeNull();
  });

  it("accepts 255 (maximum u8)", () => {
    expect(validateMilestoneIdx("255")).toBeNull();
  });

  it("rejects 256 (overflow u8)", () => {
    expect(validateMilestoneIdx("256")).toContain("0–255");
  });

  it("rejects -1", () => {
    expect(validateMilestoneIdx("-1")).toContain("0–255");
  });

  it("rejects float", () => {
    expect(validateMilestoneIdx("1.5")).toContain("0–255");
  });
});

// ---------------------------------------------------------------------------
// 6. Milestone Bitmap Edge Cases
// ---------------------------------------------------------------------------
describe("Edge case — milestone bitmap operations", () => {
  it("milestone 0 triggered when first bit set", () => {
    const bitmap = new Uint8Array([0b00000001]);
    expect(isMilestoneTriggered(bitmap, 0)).toBe(true);
  });

  it("milestone 7 triggered when last bit of first byte set", () => {
    const bitmap = new Uint8Array([0b10000000]);
    expect(isMilestoneTriggered(bitmap, 7)).toBe(true);
  });

  it("milestone 8 triggered when first bit of second byte set", () => {
    const bitmap = new Uint8Array([0, 0b00000001]);
    expect(isMilestoneTriggered(bitmap, 8)).toBe(true);
  });

  it("milestone not triggered when bit not set", () => {
    const bitmap = new Uint8Array([0b11111110]);
    expect(isMilestoneTriggered(bitmap, 0)).toBe(false);
  });

  it("milestone beyond bitmap length returns false", () => {
    const bitmap = new Uint8Array([0xFF]);
    expect(isMilestoneTriggered(bitmap, 16)).toBe(false);
  });

  it("empty bitmap returns false for any index", () => {
    const bitmap = new Uint8Array([]);
    expect(isMilestoneTriggered(bitmap, 0)).toBe(false);
  });

  it("all milestones triggered with 0xFF bytes", () => {
    const bitmap = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]);
    for (let i = 0; i < 32; i++) {
      expect(isMilestoneTriggered(bitmap, i)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Grace Period Boundary Conditions
// ---------------------------------------------------------------------------
describe("Edge case — grace period boundaries", () => {
  it("1 second before expiry is still active", () => {
    const cancelledAt = 0n;
    const now = GRACE_PERIOD_SECS - 1n;
    const state = getGracePeriodState(cancelledAt, now);
    expect(state.status).toBe("grace_active");
    if (state.status === "grace_active") {
      expect(state.remaining).toBe(1n);
    }
  });

  it("exactly at expiry is expired", () => {
    const cancelledAt = 0n;
    const now = GRACE_PERIOD_SECS;
    const state = getGracePeriodState(cancelledAt, now);
    expect(state.status).toBe("grace_expired");
  });

  it("1 second after expiry is expired", () => {
    const state = getGracePeriodState(0n, GRACE_PERIOD_SECS + 1n);
    expect(state.status).toBe("grace_expired");
  });

  it("cancelled at future time, now is before cancel", () => {
    const state = getGracePeriodState(1000n, 500n);
    expect(state.status).toBe("grace_active");
    if (state.status === "grace_active") {
      expect(state.remaining).toBe(1000n + GRACE_PERIOD_SECS - 500n);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Bulk CSV Malformed Input
// ---------------------------------------------------------------------------
describe("Edge case — malformed CSV inputs", () => {
  it("CSV with only headers, no data rows", () => {
    const csv = "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx";
    const result = parseBulkCsv(csv, null);
    expect(result.issues.some((i) => i.message.includes("at least one data row"))).toBe(true);
  });

  it("CSV with extra empty rows at end", () => {
    const csv = [
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
      "11111111111111111111111111111111,1000,Linear,1700000000,1700001000,1700002000,0",
      "",
      "",
    ].join("\n");
    const result = parseBulkCsv(csv, null);
    expect(result.issues).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
  });

  it("CSV with zero amount in row", () => {
    const csv = [
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
      "11111111111111111111111111111111,0,Linear,1700000000,1700001000,1700002000,0",
    ].join("\n");
    const result = parseBulkCsv(csv, null);
    expect(result.issues.some((i) => i.message.includes("greater than 0"))).toBe(true);
  });

  it("CSV with invalid release type", () => {
    const csv = [
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
      "11111111111111111111111111111111,1000,Exponential,1700000000,1700001000,1700002000,0",
    ].join("\n");
    const result = parseBulkCsv(csv, null);
    expect(result.issues.some((i) => i.message.includes("Unknown vesting type"))).toBe(true);
  });

  it("CSV with cliff before start (negative relative schedule)", () => {
    const csv = [
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
      "11111111111111111111111111111111,1000,Linear,1700001000,1700000000,1700002000,0",
    ].join("\n");
    const result = parseBulkCsv(csv, null);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.message.includes("earlier than the start"))).toBe(true);
  });

  it("CSV with milestone idx > 255", () => {
    const csv = [
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
      "11111111111111111111111111111111,1000,Milestone,1700000000,1700001000,1700001000,300",
    ].join("\n");
    const result = parseBulkCsv(csv, null);
    expect(result.issues.some((i) => i.message.includes("255"))).toBe(true);
  });

  it("single row with all valid fields produces one parsed row", () => {
    const csv = [
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
      "11111111111111111111111111111111,500,Cliff,1700000000,1700001000,1700001000,0",
    ].join("\n");
    const result = parseBulkCsv(csv, null);
    expect(result.issues).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 9. Countdown Display Edge Cases
// ---------------------------------------------------------------------------
describe("Edge case — countdown display", () => {
  it("exactly 1 day shows 1d 0m", () => {
    const result = formatCountdown(86400n, 0n);
    expect(result).toBe("1d 0m");
  });

  it("exactly 1 hour shows 1h 0m", () => {
    const result = formatCountdown(3600n, 0n);
    expect(result).toBe("1h 0m");
  });

  it("59 seconds shows 0m", () => {
    const result = formatCountdown(59n, 0n);
    expect(result).toBe("0m");
  });

  it("large duration shows days", () => {
    const result = formatCountdown(BigInt(365 * 86400), 0n);
    expect(result).toContain("365d");
  });
});

// ---------------------------------------------------------------------------
// 10. Full Form — Compound Edge Cases
// ---------------------------------------------------------------------------
describe("Edge case — compound form validation scenarios", () => {
  const baseForm = {
    beneficiary: "11111111111111111111111111111111",
    mintAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    amount: "1000",
    mintDecimals: null as number | null,
    campaignId: "1",
    startUnix: 1700000000,
    cliffUnix: 1700001000,
    endUnix: 1700002000,
    releaseType: 1,
    milestoneIdx: "0",
  };

  it("all fields empty produces errors for required fields", () => {
    const errors = validateCreateStreamForm({
      beneficiary: "",
      mintAddress: "",
      amount: "",
      mintDecimals: null,
      campaignId: "",
      startUnix: NaN,
      cliffUnix: NaN,
      endUnix: NaN,
      releaseType: 1,
      milestoneIdx: "0",
    });
    expect(errors.beneficiary).toBeTruthy();
    expect(errors.mintAddress).toBeTruthy();
    expect(errors.amount).toBeTruthy();
    expect(errors.campaignId).toBeTruthy();
    expect(errors.schedule).toBeTruthy();
    expect(hasErrors(errors)).toBe(true);
  });

  it("valid form with 0 decimals mint (no fractional)", () => {
    const errors = validateCreateStreamForm({
      ...baseForm,
      amount: "1000000",
      mintDecimals: 0,
    });
    expect(hasErrors(errors)).toBe(false);
  });

  it("beneficiary == mintAddress is valid (unusual but not disallowed)", () => {
    const errors = validateCreateStreamForm({
      ...baseForm,
      beneficiary: baseForm.mintAddress,
    });
    expect(errors.beneficiary).toBeNull();
  });

  it("milestone type with milestoneIdx 0 is valid", () => {
    const errors = validateCreateStreamForm({
      ...baseForm,
      releaseType: 2,
      endUnix: baseForm.cliffUnix,
      milestoneIdx: "0",
    });
    expect(errors.milestoneIdx).toBeNull();
  });
});
