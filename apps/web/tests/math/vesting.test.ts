import { describe, it, expect } from "vitest";

// Client-side vesting math — must produce identical results to
// programs/vesting/src/math/schedule.rs::vested()
// Test values taken directly from Rust unit tests in schedule.rs

type VestingLeaf = {
  amount: bigint;
  releaseType: 0 | 1 | 2;
  cliffTs: bigint;
  endTs: bigint;
};

function vested(leaf: VestingLeaf, now: bigint): bigint {
  switch (leaf.releaseType) {
    case 0: // Cliff
      return now >= leaf.cliffTs ? leaf.amount : 0n;
    case 1: { // Linear
      if (now >= leaf.endTs) return leaf.amount;
      if (now <= leaf.cliffTs) return 0n;
      const elapsed = now - leaf.cliffTs;
      const duration = leaf.endTs - leaf.cliffTs;
      return (leaf.amount * elapsed) / duration;
    }
    case 2: // Milestone
      return now >= leaf.cliffTs ? leaf.amount : 0n;
    default:
      return 0n;
  }
}

function getVestedAmount(
  leaf: VestingLeaf,
  cancelledAt: bigint | null,
  now: bigint,
): bigint {
  const effectiveNow = cancelledAt !== null && cancelledAt < now ? cancelledAt : now;
  return vested(leaf, effectiveNow);
}

function claimable(vestedAmount: bigint, alreadyClaimed: bigint): bigint {
  const diff = vestedAmount - alreadyClaimed;
  return diff > 0n ? diff : 0n;
}

function makeLeaf(amount: bigint, cliff: bigint, end: bigint, typ: 0 | 1 | 2): VestingLeaf {
  return { amount, releaseType: typ, cliffTs: cliff, endTs: end };
}

describe("vesting math — cliff", () => {
  const leaf = makeLeaf(1_000n, 100n, 200n, 0);

  it("returns 0 before cliff", () => {
    expect(vested(leaf, 99n)).toBe(0n);
  });

  it("returns full amount at cliff", () => {
    expect(vested(leaf, 100n)).toBe(1_000n);
  });

  it("returns full amount after cliff", () => {
    expect(vested(leaf, 999n)).toBe(1_000n);
  });
});

describe("vesting math — linear", () => {
  const leaf = makeLeaf(1_000n, 100n, 200n, 1);

  it("returns 0 before cliff", () => {
    expect(vested(leaf, 50n)).toBe(0n);
  });

  it("returns 0 at cliff", () => {
    expect(vested(leaf, 100n)).toBe(0n);
  });

  it("returns 50% at midpoint", () => {
    expect(vested(leaf, 150n)).toBe(500n);
  });

  it("returns 100% at end", () => {
    expect(vested(leaf, 200n)).toBe(1_000n);
  });

  it("returns 100% past end", () => {
    expect(vested(leaf, 999n)).toBe(1_000n);
  });
});

describe("vesting math — linear quarter steps (matches Rust linear_quarter)", () => {
  const leaf = makeLeaf(10_000n, 1_000n, 2_000n, 1);

  it("25% elapsed", () => {
    expect(vested(leaf, 1_250n)).toBe(2_500n);
  });

  it("50% elapsed", () => {
    expect(vested(leaf, 1_500n)).toBe(5_000n);
  });

  it("75% elapsed", () => {
    expect(vested(leaf, 1_750n)).toBe(7_500n);
  });
});

describe("vesting math — linear edge cases", () => {
  it("no overflow at u64 max amount", () => {
    const maxU64 = 18_446_744_073_709_551_615n;
    const leaf = makeLeaf(maxU64, 0n, 1_000_000n, 1);
    const half = vested(leaf, 500_000n);
    expect(half).toBeGreaterThanOrEqual(maxU64 / 2n - 1n);
  });

  it("degenerate case: cliff == end returns full at cliff", () => {
    const leaf = makeLeaf(1_000n, 100n, 100n, 1);
    expect(vested(leaf, 99n)).toBe(0n);
    expect(vested(leaf, 100n)).toBe(1_000n);
  });
});

describe("vesting math — milestone", () => {
  const leaf = makeLeaf(500n, 200n, 300n, 2);

  it("returns 0 before cliff", () => {
    expect(vested(leaf, 199n)).toBe(0n);
  });

  it("returns full amount at cliff", () => {
    expect(vested(leaf, 200n)).toBe(500n);
  });
});

describe("getVestedAmount — cancel clamp", () => {
  const leaf = makeLeaf(1_000n, 100n, 200n, 1);

  it("clamps vested at cancel time", () => {
    expect(getVestedAmount(leaf, 150n, 999n)).toBe(500n);
  });

  it("no clamp when not cancelled", () => {
    expect(getVestedAmount(leaf, null, 999n)).toBe(1_000n);
  });

  it("cancel in future has no effect on current time", () => {
    expect(getVestedAmount(leaf, 999n, 150n)).toBe(500n);
  });
});

describe("claimable calculation", () => {
  it("full amount when nothing claimed", () => {
    expect(claimable(1_000n, 0n)).toBe(1_000n);
  });

  it("partial when some claimed", () => {
    expect(claimable(750n, 250n)).toBe(500n);
  });

  it("zero when fully claimed", () => {
    expect(claimable(1_000n, 1_000n)).toBe(0n);
  });

  it("zero when claimed exceeds vested (no negative)", () => {
    expect(claimable(500n, 1_000n)).toBe(0n);
  });
});

describe("invalid release type", () => {
  it("returns 0 for unknown type", () => {
    const leaf = makeLeaf(1_000n, 100n, 200n, 3 as 0);
    expect(vested(leaf, 150n)).toBe(0n);
  });
});
