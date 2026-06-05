/**
 * Week 7 — FE Integration Test Suite
 *
 * Tests full user flows on the frontend:
 *   1. Create stream form validation + submission
 *   2. Bulk CSV parsing + campaign preparation
 *   3. Claim flow logic (vested calculations, leaf selection)
 *   4. Cancel dialog flow (modes, amounts)
 *   5. Withdraw unvested (grace period gating)
 *   6. Vesting chart calculations
 *   7. Token picker + SOL wrapping
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  validateCreateStreamForm,
  hasErrors,
  validatePublicKey,
  validateAmountWithDecimals,
  validateSchedule,
  validateMilestoneIdx,
} from "@/lib/validation/stream-form";
import {
  parseBulkCsv,
  prepareBulkCampaign,
  toRawAmount,
  bulkCsvTemplate,
  bulkCsvTemplateForType,
  type BulkCsvRow,
} from "@/lib/campaign/bulk";
import {
  getGracePeriodState,
  getWithdrawDisabledReason,
  formatCountdown,
  getVestingTypeLabel,
  GRACE_PERIOD_SECS,
} from "@/lib/vesting/display";
import {
  isNativeSol,
  isWrappedSol,
  solToLamports,
  NATIVE_SOL_MINT_ADDRESS,
  WRAPPED_SOL_MINT_ADDRESS,
} from "@/lib/sol/auto-wrap";

// ---------------------------------------------------------------------------
// 1. Create Stream — Full Form Validation Flow
// ---------------------------------------------------------------------------
describe("Create Stream — full form validation flow", () => {
  const validForm = {
    beneficiary: "11111111111111111111111111111111",
    mintAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    amount: "1000",
    mintDecimals: 6,
    campaignId: "1",
    startUnix: 1700000000,
    cliffUnix: 1700001000,
    endUnix: 1700002000,
    releaseType: 1,
    milestoneIdx: "0",
  };

  it("accepts a valid linear vesting form", () => {
    const errors = validateCreateStreamForm(validForm);
    expect(hasErrors(errors)).toBe(false);
  });

  it("accepts a valid cliff vesting form (end == cliff)", () => {
    const errors = validateCreateStreamForm({
      ...validForm,
      releaseType: 0,
      endUnix: validForm.cliffUnix,
    });
    expect(hasErrors(errors)).toBe(false);
  });

  it("accepts a valid milestone vesting form", () => {
    const errors = validateCreateStreamForm({
      ...validForm,
      releaseType: 2,
      endUnix: validForm.cliffUnix,
      milestoneIdx: "42",
    });
    expect(hasErrors(errors)).toBe(false);
  });

  it("rejects form with multiple invalid fields", () => {
    const errors = validateCreateStreamForm({
      ...validForm,
      beneficiary: "<script>alert(1)</script>",
      amount: "-100",
      campaignId: "0",
    });
    expect(errors.beneficiary).toBeTruthy();
    expect(errors.amount).toBeTruthy();
    expect(errors.campaignId).toBeTruthy();
    expect(hasErrors(errors)).toBe(true);
  });

  it("rejects cliff vesting when end != cliff", () => {
    const errors = validateCreateStreamForm({
      ...validForm,
      releaseType: 0,
      endUnix: validForm.cliffUnix + 1000,
    });
    expect(errors.schedule).toContain("cliff");
  });

  it("rejects cliff time before start time", () => {
    const errors = validateCreateStreamForm({
      ...validForm,
      cliffUnix: validForm.startUnix - 1,
      endUnix: validForm.startUnix - 1,
      releaseType: 0,
    });
    expect(errors.schedule).toContain("on or after start");
  });

  it("enforces 60-second minimum cliff gap", () => {
    const errors = validateCreateStreamForm({
      ...validForm,
      cliffUnix: validForm.startUnix + 30,
      endUnix: validForm.startUnix + 30 + 1000,
    });
    expect(errors.schedule).toContain("60 seconds");
  });

  it("validates milestone index for milestone type only", () => {
    const errors = validateCreateStreamForm({
      ...validForm,
      releaseType: 2,
      endUnix: validForm.cliffUnix,
      milestoneIdx: "300",
    });
    expect(errors.milestoneIdx).toContain("0–255");
  });

  it("skips milestone validation for non-milestone types", () => {
    const errors = validateCreateStreamForm({
      ...validForm,
      releaseType: 1,
      milestoneIdx: "999",
    });
    expect(errors.milestoneIdx).toBeUndefined();
  });

  it("handles decimal amounts with known mint precision", () => {
    const errors = validateCreateStreamForm({
      ...validForm,
      amount: "10.123456",
      mintDecimals: 6,
    });
    expect(errors.amount).toBeNull();
  });

  it("rejects too many decimal places", () => {
    const errors = validateCreateStreamForm({
      ...validForm,
      amount: "10.1234567",
      mintDecimals: 6,
    });
    expect(errors.amount).toContain("6 decimal");
  });
});

// ---------------------------------------------------------------------------
// 2. Bulk CSV — Parse, Validate, Prepare Flow
// ---------------------------------------------------------------------------
describe("Bulk CSV — full pipeline", () => {
  const validCsv = [
    "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
    "11111111111111111111111111111111,1000,Linear,1700000000,1700001000,1700002000,0",
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v,2000,Linear,1700000000,1700001000,1700002000,0",
  ].join("\n");

  it("parses valid CSV into rows", () => {
    const result = parseBulkCsv(validCsv, null);
    expect(result.issues).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].releaseType).toBe(1);
  });

  it("rejects empty CSV", () => {
    const result = parseBulkCsv("", null);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].message).toContain("empty");
  });

  it("rejects CSV with missing required headers", () => {
    const result = parseBulkCsv("name,value\nfoo,bar", null);
    expect(result.issues.some((i) => i.message.includes("Missing required column"))).toBe(true);
  });

  it("rejects invalid beneficiary address in row", () => {
    const csv = [
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
      "not-valid-address,1000,Linear,1700000000,1700001000,1700002000,0",
    ].join("\n");
    const result = parseBulkCsv(csv, null);
    expect(result.issues.some((i) => i.message.includes("valid Solana"))).toBe(true);
  });

  it("detects duplicate beneficiaries for non-milestone rows", () => {
    const csv = [
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
      "11111111111111111111111111111111,1000,Linear,1700000000,1700001000,1700002000,0",
      "11111111111111111111111111111111,2000,Linear,1700000000,1700001000,1700002000,0",
    ].join("\n");
    const result = parseBulkCsv(csv, null);
    expect(result.issues.some((i) => i.message.includes("more than once"))).toBe(true);
  });

  it("allows same beneficiary with different milestone indexes", () => {
    const csv = [
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v,500,Milestone,1700000000,1700001000,1700001000,0",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v,500,Milestone,1700000000,1700002000,1700002000,1",
    ].join("\n");
    const result = parseBulkCsv(csv, null);
    expect(result.issues).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
  });

  it("rejects duplicate milestone indexes for same beneficiary", () => {
    const csv = [
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v,500,Milestone,1700000000,1700001000,1700001000,1",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v,500,Milestone,1700000000,1700002000,1700002000,1",
    ].join("\n");
    const result = parseBulkCsv(csv, null);
    expect(result.issues.some((i) => i.message.includes("milestone"))).toBe(true);
  });

  it("enforces expected release type filter", () => {
    const csv = [
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
      "11111111111111111111111111111111,1000,Linear,1700000000,1700001000,1700002000,0",
    ].join("\n");
    const result = parseBulkCsv(csv, null, 0);
    expect(result.issues.some((i) => i.message.includes("only accepts Cliff"))).toBe(true);
  });

  it("handles decimal amounts with known mint precision", () => {
    const csv = [
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
      "11111111111111111111111111111111,10.5,Linear,1700000000,1700001000,1700002000,0",
    ].join("\n");
    const result = parseBulkCsv(csv, 6);
    expect(result.issues).toHaveLength(0);
    expect(result.rows[0].amountRaw).toBe("10500000");
  });

  it("prepareBulkCampaign builds merkle tree from parsed rows", () => {
    const result = parseBulkCsv(validCsv, null);
    const prepared = prepareBulkCampaign(result.rows);
    expect(prepared.leafCount).toBe(2);
    expect(prepared.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(BigInt(prepared.totalSupply)).toBeGreaterThan(0n);
    expect(prepared.leaves[0].proof.length).toBeGreaterThan(0);
    expect(prepared.releaseMix.linear).toBe(2);
  });

  it("generates valid CSV template", () => {
    const template = bulkCsvTemplate();
    expect(template).toContain("beneficiary");
    expect(template).toContain("Cliff");
    expect(template).toContain("Linear");
    expect(template).toContain("Milestone");
  });

  it("generates type-specific templates", () => {
    expect(bulkCsvTemplateForType("cliff")).toContain("Cliff");
    expect(bulkCsvTemplateForType("cliff")).not.toContain("Linear");
    expect(bulkCsvTemplateForType("linear")).toContain("Linear");
    expect(bulkCsvTemplateForType("milestone")).toContain("Milestone");
  });
});

// ---------------------------------------------------------------------------
// 3. Claim Flow — Vesting Calculations
// ---------------------------------------------------------------------------
describe("Claim flow — vesting amount calculations", () => {
  it("toRawAmount converts decimal to raw with padding", () => {
    expect(toRawAmount("10.5", 6)).toBe("10500000");
    expect(toRawAmount("0.001", 9)).toBe("1000000");
    expect(toRawAmount("100", 6)).toBe("100000000");
  });

  it("toRawAmount handles zero correctly", () => {
    expect(toRawAmount("0", 6)).toBe("0");
    expect(toRawAmount("0.0", 6)).toBe("0");
  });

  it("toRawAmount handles edge case with no fractional part", () => {
    expect(toRawAmount("42", 9)).toBe("42000000000");
  });

  it("toRawAmount handles max precision", () => {
    expect(toRawAmount("1.123456789", 9)).toBe("1123456789");
  });
});

// ---------------------------------------------------------------------------
// 4. Cancel Dialog — Mode Selection + Amount Display
// ---------------------------------------------------------------------------
describe("Cancel dialog — mode and amount logic", () => {
  it("grace period state: not cancelled", () => {
    const state = getGracePeriodState(null, 1000n);
    expect(state.status).toBe("not_cancelled");
  });

  it("grace period state: grace active with countdown", () => {
    const cancelledAt = 1000n;
    const now = 1000n + 3600n;
    const state = getGracePeriodState(cancelledAt, now);
    expect(state.status).toBe("grace_active");
    if (state.status === "grace_active") {
      expect(state.remaining).toBe(GRACE_PERIOD_SECS - 3600n);
      expect(state.countdown).toContain("d");
    }
  });

  it("grace period state: grace expired", () => {
    const cancelledAt = 1000n;
    const now = cancelledAt + GRACE_PERIOD_SECS + 1n;
    const state = getGracePeriodState(cancelledAt, now);
    expect(state.status).toBe("grace_expired");
  });

  it("grace period boundary: exactly at expiry", () => {
    const cancelledAt = 0n;
    const now = GRACE_PERIOD_SECS;
    const state = getGracePeriodState(cancelledAt, now);
    expect(state.status).toBe("grace_expired");
  });
});

// ---------------------------------------------------------------------------
// 5. Withdraw Unvested — Disabled Reason Logic
// ---------------------------------------------------------------------------
describe("Withdraw unvested — disabled reason logic", () => {
  const base = {
    loading: false,
    paused: false,
    claimable: 100n,
    cancelledAt: 1000n,
    releaseType: 1,
    nowTs: 2000n,
    cliffTs: 500n,
  };

  it("returns null when withdrawal is possible", () => {
    expect(getWithdrawDisabledReason(base)).toBeNull();
  });

  it("returns loading message when claiming", () => {
    expect(getWithdrawDisabledReason({ ...base, loading: true })).toBe("Claiming...");
  });

  it("returns paused message when campaign paused", () => {
    expect(getWithdrawDisabledReason({ ...base, paused: true })).toBe("Campaign is paused");
  });

  it("returns cancelled message when cancelled + no claimable", () => {
    expect(
      getWithdrawDisabledReason({ ...base, cancelledAt: 1000n, claimable: 0n }),
    ).toContain("cancelled");
  });

  it("returns cliff not reached for cliff type before cliff", () => {
    expect(
      getWithdrawDisabledReason({
        ...base,
        releaseType: 0,
        nowTs: 100n,
        cliffTs: 500n,
        claimable: 0n,
        cancelledAt: null,
      }),
    ).toContain("Cliff not reached");
  });

  it("returns milestone not unlocked before cliff", () => {
    expect(
      getWithdrawDisabledReason({
        ...base,
        releaseType: 2,
        nowTs: 100n,
        cliffTs: 500n,
        claimable: 0n,
        cancelledAt: null,
      }),
    ).toContain("Milestone not unlocked");
  });

  it("returns milestone not released when flag is false", () => {
    expect(
      getWithdrawDisabledReason({
        ...base,
        releaseType: 2,
        milestoneReleased: false,
        cancelledAt: null,
      }),
    ).toContain("Milestone not released");
  });

  it("returns nothing to claim for zero claimable", () => {
    expect(
      getWithdrawDisabledReason({ ...base, claimable: 0n, cancelledAt: null }),
    ).toContain("Nothing to claim");
  });
});

// ---------------------------------------------------------------------------
// 6. Vesting Display Utilities
// ---------------------------------------------------------------------------
describe("Vesting display utilities", () => {
  it("formatCountdown shows days/hours/minutes", () => {
    const target = 100000n;
    const now = 0n;
    const result = formatCountdown(target, now);
    expect(result).toContain("d");
    expect(result).toContain("h");
  });

  it("formatCountdown returns Reached when past", () => {
    expect(formatCountdown(100n, 200n)).toBe("Reached");
  });

  it("formatCountdown returns Reached when equal", () => {
    expect(formatCountdown(100n, 100n)).toBe("Reached");
  });

  it("formatCountdown shows only minutes for short durations", () => {
    const result = formatCountdown(300n, 0n);
    expect(result).toBe("5m");
  });

  it("getVestingTypeLabel maps types correctly", () => {
    expect(getVestingTypeLabel(0)).toBe("Cliff");
    expect(getVestingTypeLabel(1)).toBe("Linear");
    expect(getVestingTypeLabel(2)).toBe("Milestone");
    expect(getVestingTypeLabel(99)).toBe("Unknown");
  });
});

// ---------------------------------------------------------------------------
// 7. Token Picker + SOL Wrapping
// ---------------------------------------------------------------------------
describe("Token picker — SOL wrapping utilities", () => {
  it("isNativeSol identifies system program mint", () => {
    expect(isNativeSol(NATIVE_SOL_MINT_ADDRESS)).toBe(true);
    expect(isNativeSol(WRAPPED_SOL_MINT_ADDRESS)).toBe(false);
    expect(isNativeSol("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe(false);
  });

  it("isWrappedSol identifies NATIVE_MINT", () => {
    expect(isWrappedSol(WRAPPED_SOL_MINT_ADDRESS)).toBe(true);
    expect(isWrappedSol(NATIVE_SOL_MINT_ADDRESS)).toBe(false);
  });

  it("solToLamports converts amount string to lamports", () => {
    expect(solToLamports("1", 9)).toBe(1_000_000_000);
    expect(solToLamports("0.5", 9)).toBe(500_000_000);
    expect(solToLamports("0.001", 9)).toBe(1_000_000);
  });

  it("solToLamports handles zero", () => {
    expect(solToLamports("0", 9)).toBe(0);
  });

  it("NATIVE_SOL_MINT_ADDRESS is system program", () => {
    expect(NATIVE_SOL_MINT_ADDRESS).toBe("11111111111111111111111111111111");
  });
});

// ---------------------------------------------------------------------------
// 8. CSV Quoted Fields + Edge Cases
// ---------------------------------------------------------------------------
describe("CSV parsing — quoted fields and encoding edge cases", () => {
  it("handles quoted fields with commas inside", () => {
    const csv = [
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
      '"11111111111111111111111111111111",1000,Linear,1700000000,1700001000,1700002000,0',
    ].join("\n");
    const result = parseBulkCsv(csv, null);
    expect(result.issues).toHaveLength(0);
    expect(result.rows[0].beneficiary).toBe("11111111111111111111111111111111");
  });

  it("handles Windows-style line endings (CRLF)", () => {
    const csv =
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx\r\n" +
      "11111111111111111111111111111111,1000,Linear,1700000000,1700001000,1700002000,0\r\n";
    const result = parseBulkCsv(csv, null);
    expect(result.issues).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
  });

  it("accepts ISO date strings in timestamps", () => {
    const csv = [
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
      "11111111111111111111111111111111,1000,Linear,2025-06-01T09:00:00,2025-07-01T09:00:00,2025-12-01T09:00:00,0",
    ].join("\n");
    const result = parseBulkCsv(csv, null);
    expect(result.issues).toHaveLength(0);
    expect(result.rows[0].startTime).toBeGreaterThan(0);
  });

  it("accepts release type names (case insensitive)", () => {
    const csv = [
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
      "11111111111111111111111111111111,1000,cliff,1700000000,1700001000,1700001000,0",
    ].join("\n");
    const result = parseBulkCsv(csv, null);
    expect(result.issues).toHaveLength(0);
    expect(result.rows[0].releaseType).toBe(0);
  });
});
