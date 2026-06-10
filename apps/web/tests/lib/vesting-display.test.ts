import { describe, it, expect } from "vitest";
import {
  getVestingTypeLabel,
  getVestingTypeBadgeColor,
  formatCountdown,
  formatTokenAmount,
  getWithdrawDisabledReason,
  GRACE_PERIOD_SECS,
  mixedMintAggregateSub,
} from "@/lib/vesting/display";

describe("getVestingTypeLabel", () => {
  it("returns Cliff for type 0", () => {
    expect(getVestingTypeLabel(0)).toBe("Cliff");
  });

  it("returns Linear for type 1", () => {
    expect(getVestingTypeLabel(1)).toBe("Linear");
  });

  it("returns Milestone for type 2", () => {
    expect(getVestingTypeLabel(2)).toBe("Milestone");
  });

  it("returns Unknown for unrecognized type", () => {
    expect(getVestingTypeLabel(99)).toBe("Unknown");
  });
});

describe("getVestingTypeBadgeColor", () => {
  it("returns amber classes for cliff", () => {
    expect(getVestingTypeBadgeColor(0)).toContain("amber");
  });

  it("returns purple classes for linear", () => {
    expect(getVestingTypeBadgeColor(1)).toContain("purple");
  });

  it("returns blue classes for milestone", () => {
    expect(getVestingTypeBadgeColor(2)).toContain("blue");
  });

  it("returns gray classes for unknown type", () => {
    expect(getVestingTypeBadgeColor(99)).toContain("gray");
  });
});

describe("formatCountdown", () => {
  it("returns 'Reached' when target is in the past", () => {
    expect(formatCountdown(1000n, 2000n)).toBe("Reached");
  });

  it("returns 'Reached' when target equals now", () => {
    expect(formatCountdown(1000n, 1000n)).toBe("Reached");
  });

  it("formats days, hours, minutes correctly", () => {
    const now = 0n;
    const target = BigInt(2 * 86400 + 5 * 3600 + 30 * 60);
    expect(formatCountdown(target, now)).toBe("2d 5h 30m");
  });

  it("omits days when zero", () => {
    const now = 0n;
    const target = BigInt(3 * 3600 + 15 * 60);
    expect(formatCountdown(target, now)).toBe("3h 15m");
  });

  it("omits hours when zero but days present", () => {
    const now = 0n;
    const target = BigInt(1 * 86400 + 10 * 60);
    expect(formatCountdown(target, now)).toBe("1d 10m");
  });

  it("shows 0m for less than a minute remaining", () => {
    expect(formatCountdown(1030n, 1000n)).toBe("0m");
  });

  it("handles exactly one day", () => {
    expect(formatCountdown(86400n, 0n)).toBe("1d 0m");
  });
});

describe("getWithdrawDisabledReason", () => {
  const base = {
    loading: false,
    paused: false,
    claimable: 1000n,
    cancelledAt: null,
    releaseType: 1,
    nowTs: 5000n,
    cliffTs: 1000n,
  };

  it("returns null when withdraw should be enabled", () => {
    expect(getWithdrawDisabledReason(base)).toBeNull();
  });

  it("returns loading message when loading", () => {
    expect(getWithdrawDisabledReason({ ...base, loading: true })).toBe("Claiming...");
  });

  it("returns paused message when campaign paused", () => {
    expect(getWithdrawDisabledReason({ ...base, paused: true })).toBe("Campaign is paused");
  });

  it("returns cancelled message when cancelled with nothing to claim", () => {
    const reason = getWithdrawDisabledReason({
      ...base,
      cancelledAt: 3000n,
      claimable: 0n,
    });
    expect(reason).toBe("Stream cancelled — nothing to claim");
  });

  it("returns cliff not reached for cliff type before cliff", () => {
    const reason = getWithdrawDisabledReason({
      ...base,
      releaseType: 0,
      nowTs: 500n,
      cliffTs: 1000n,
      claimable: 0n,
    });
    expect(reason).toBe("Cliff not reached yet");
  });

  it("returns milestone not unlocked before milestone cliff", () => {
    const reason = getWithdrawDisabledReason({
      ...base,
      releaseType: 2,
      nowTs: 500n,
      cliffTs: 1000n,
      claimable: 0n,
    });
    expect(reason).toBe("Milestone not unlocked yet");
  });

  it("returns milestone already claimed when bitmap bit is set", () => {
    const bitmap = new Uint8Array(32);
    bitmap[0] = 1 << 3;

    const reason = getWithdrawDisabledReason({
      ...base,
      releaseType: 2,
      claimable: 0n,
      nowTs: 2000n,
      cliffTs: 1000n,
      milestoneIdx: 3,
      milestoneBitmap: bitmap,
    });

    expect(reason).toBe("Milestone already claimed");
  });

  it("returns null for claimable milestone stream", () => {
    const reason = getWithdrawDisabledReason({
      ...base,
      releaseType: 2,
      claimable: 1000n,
      nowTs: 2000n,
      cliffTs: 1000n,
      milestoneIdx: 0,
      milestoneBitmap: new Uint8Array(32),
    });
    expect(reason).toBeNull();
  });

  it("returns generic nothing to claim when claimable is zero", () => {
    expect(getWithdrawDisabledReason({ ...base, claimable: 0n })).toBe("Nothing to claim");
  });

  it("prioritizes loading over paused", () => {
    expect(getWithdrawDisabledReason({ ...base, loading: true, paused: true })).toBe("Claiming...");
  });

  it("prioritizes paused over cancelled", () => {
    const reason = getWithdrawDisabledReason({
      ...base,
      paused: true,
      cancelledAt: 3000n,
      claimable: 0n,
    });
    expect(reason).toBe("Campaign is paused");
  });
});

describe("GRACE_PERIOD_SECS", () => {
  it("equals 7 days in seconds", () => {
    expect(GRACE_PERIOD_SECS).toBe(604800n);
  });
});

describe("formatTokenAmount", () => {
  it("formats 9-decimal amounts correctly", () => {
    expect(formatTokenAmount(500_000_000n, 9)).toBe("0.5");
  });

  it("returns raw string when decimals are null or undefined", () => {
    expect(formatTokenAmount(12345n, null)).toBe("12345");
    expect(formatTokenAmount(12345n, undefined)).toBe("12345");
  });

  it("locale-formats zero-decimal amounts", () => {
    expect(formatTokenAmount(1000n, 0)).toBe((1000).toLocaleString());
  });

  it("trims trailing fractional zeros", () => {
    expect(formatTokenAmount(1_500_000_000n, 9)).toBe("1.5");
    expect(formatTokenAmount(1_000_000_000n, 9)).toBe("1");
  });

  it("shows up to four fractional digits", () => {
    expect(formatTokenAmount(1_234_567n, 6)).toBe("1.2345");
  });
});

describe("mixedMintAggregateSub", () => {
  it("returns base sub when only one mint", () => {
    expect(mixedMintAggregateSub(1, "Locked value")).toBe("Locked value");
    expect(mixedMintAggregateSub(0, "across 2 campaigns")).toBe("across 2 campaigns");
  });

  it("appends raw-units note for multiple mints", () => {
    expect(mixedMintAggregateSub(3)).toBe("raw units across 3 tokens");
    expect(mixedMintAggregateSub(2, "50.0%")).toBe("50.0% · raw units across 2 tokens");
  });
});
