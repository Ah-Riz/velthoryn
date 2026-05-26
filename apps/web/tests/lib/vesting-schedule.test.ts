import { describe, it, expect } from "vitest";
import { vested, getVestedAmount } from "@/lib/vesting/schedule";
import type { VestingSchedule } from "@/lib/vesting/schedule";

function makeSchedule(
  amount: bigint,
  cliffTime: bigint,
  endTime: bigint,
  releaseType: 0 | 1 | 2,
): VestingSchedule {
  return { amount, releaseType, startTime: cliffTime, cliffTime, endTime };
}

// ---------------------------------------------------------------------------
// Cliff (type 0) — mirrors Rust cliff_before_after test
// ---------------------------------------------------------------------------

describe("vested — Cliff (type 0)", () => {
  const s = makeSchedule(1000n, 100n, 200n, 0);

  it("returns 0 before cliffTime", () => {
    expect(vested(s, 99n)).toBe(0n);
  });

  it("returns full amount at cliffTime", () => {
    expect(vested(s, 100n)).toBe(1000n);
  });

  it("returns full amount after cliffTime", () => {
    expect(vested(s, 999n)).toBe(1000n);
  });
});

// ---------------------------------------------------------------------------
// Linear (type 1) — mirrors Rust linear_curve test
// ---------------------------------------------------------------------------

describe("vested — Linear (type 1)", () => {
  const s = makeSchedule(1000n, 100n, 200n, 1);

  it("returns 0 before cliffTime", () => {
    expect(vested(s, 50n)).toBe(0n);
  });

  it("returns 0 at cliffTime", () => {
    expect(vested(s, 100n)).toBe(0n);
  });

  it("returns 500 at midpoint (mirrors linear_curve)", () => {
    expect(vested(s, 150n)).toBe(500n);
  });

  it("returns full amount at endTime", () => {
    expect(vested(s, 200n)).toBe(1000n);
  });

  it("returns full amount after endTime", () => {
    expect(vested(s, 999n)).toBe(1000n);
  });
});

// ---------------------------------------------------------------------------
// Linear quarter — mirrors Rust linear_quarter test exactly
// ---------------------------------------------------------------------------

describe("vested — Linear quarter (mirrors Rust linear_quarter)", () => {
  const s = makeSchedule(10000n, 1000n, 2000n, 1);

  it("25% elapsed → 2500", () => {
    expect(vested(s, 1250n)).toBe(2500n);
  });

  it("50% elapsed → 5000", () => {
    expect(vested(s, 1500n)).toBe(5000n);
  });

  it("75% elapsed → 7500", () => {
    expect(vested(s, 1750n)).toBe(7500n);
  });
});

// ---------------------------------------------------------------------------
// Linear no overflow — mirrors Rust linear_no_overflow_at_max_amount
// ---------------------------------------------------------------------------

describe("vested — Linear max u64 amount (no overflow)", () => {
  const MAX_U64 = BigInt("18446744073709551615");
  const s = makeSchedule(MAX_U64, 0n, 1_000_000n, 1);

  it("result at midpoint is approximately MAX_U64 / 2 without overflow", () => {
    const half = vested(s, 500_000n);
    expect(half).toBeGreaterThanOrEqual(MAX_U64 / 2n - 1n);
    expect(half).toBeLessThanOrEqual(MAX_U64);
  });
});

// ---------------------------------------------------------------------------
// Linear degenerate (cliffTime == endTime) — mirrors Rust linear_degenerate_cliff_eq_end
// ---------------------------------------------------------------------------

describe("vested — Linear degenerate cliff == end", () => {
  const s = makeSchedule(1000n, 100n, 100n, 1);

  it("returns 0 before cliff", () => {
    expect(vested(s, 99n)).toBe(0n);
  });

  it("returns full amount at cliff == end", () => {
    expect(vested(s, 100n)).toBe(1000n);
  });
});

// ---------------------------------------------------------------------------
// Cancel clamp — mirrors Rust cancel_clamp test
// ---------------------------------------------------------------------------

describe("getVestedAmount — cancel clamp", () => {
  const s = makeSchedule(1000n, 100n, 200n, 1);

  it("caps at cancelledAt time (mirrors cancel_clamp with cancelledAt=150, now=999)", () => {
    expect(getVestedAmount(s, 150n, 999n)).toBe(500n);
  });

  it("no cancellation: returns full amount at now=999", () => {
    expect(getVestedAmount(s, null, 999n)).toBe(1000n);
  });
});

// ---------------------------------------------------------------------------
// Milestone (type 2)
// ---------------------------------------------------------------------------

describe("vested — Milestone (type 2)", () => {
  const s = makeSchedule(1000n, 100n, 200n, 2);

  it("returns 0 before cliffTime", () => {
    expect(vested(s, 99n)).toBe(0n);
  });

  it("returns full amount at cliffTime", () => {
    expect(vested(s, 100n)).toBe(1000n);
  });

  it("returns full amount after cliffTime", () => {
    expect(vested(s, 999n)).toBe(1000n);
  });
});
