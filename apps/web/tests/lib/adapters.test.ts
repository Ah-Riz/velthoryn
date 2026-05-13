import { describe, it, expect } from "vitest";
import { toAnchorLeaf } from "../../src/lib/anchor/adapters";

describe("toAnchorLeaf", () => {
  const baseLeaf = {
    leafIndex: 0,
    beneficiary: "11111111111111111111111111111111",
    amount: "1000000",
    releaseType: 1,
    startTime: 1700000000,
    cliffTime: 0,
    endTime: 1731536000,
    milestoneIdx: 0,
  };

  it("converts camelCase fields to snake_case Anchor fields", () => {
    const result = toAnchorLeaf(baseLeaf);

    expect(result).toHaveProperty("leaf_index", baseLeaf.leafIndex);
    expect(result).toHaveProperty("beneficiary", baseLeaf.beneficiary);
    expect(result).toHaveProperty("release_type", baseLeaf.releaseType);
    expect(result).toHaveProperty("start_time");
    expect(result).toHaveProperty("cliff_time");
    expect(result).toHaveProperty("end_time");
    expect(result).toHaveProperty("milestone_idx", baseLeaf.milestoneIdx);

    // camelCase keys should NOT be present
    expect(result).not.toHaveProperty("leafIndex");
    expect(result).not.toHaveProperty("releaseType");
    expect(result).not.toHaveProperty("startTime");
    expect(result).not.toHaveProperty("cliffTime");
    expect(result).not.toHaveProperty("endTime");
    expect(result).not.toHaveProperty("milestoneIdx");
  });

  it("converts string amount to BN", () => {
    const result = toAnchorLeaf(baseLeaf);

    expect(result.amount).toBeDefined();
    expect(typeof result.amount.toString).toBe("function");
    expect(result.amount.toString()).toBe("1000000");
  });

  it("converts string timestamps to BN", () => {
    const result = toAnchorLeaf(baseLeaf);

    expect(result.start_time.toString()).toBe("1700000000");
    expect(result.cliff_time.toString()).toBe("0");
    expect(result.end_time.toString()).toBe("1731536000");
  });

  it("handles release_type 0 (Cliff)", () => {
    const result = toAnchorLeaf({ ...baseLeaf, releaseType: 0 });
    expect(result.release_type).toBe(0);
  });

  it("handles release_type 1 (Linear)", () => {
    const result = toAnchorLeaf({ ...baseLeaf, releaseType: 1 });
    expect(result.release_type).toBe(1);
  });

  it("handles release_type 2 (Milestone)", () => {
    const result = toAnchorLeaf({ ...baseLeaf, releaseType: 2 });
    expect(result.release_type).toBe(2);
  });

  it("handles milestoneIdx of 0", () => {
    const result = toAnchorLeaf({ ...baseLeaf, milestoneIdx: 0 });
    expect(result.milestone_idx).toBe(0);
  });

  it("handles milestoneIdx of 5", () => {
    const result = toAnchorLeaf({ ...baseLeaf, milestoneIdx: 5 });
    expect(result.milestone_idx).toBe(5);
  });

  it("handles zero amount string", () => {
    const result = toAnchorLeaf({ ...baseLeaf, amount: "0" });
    expect(result.amount.toString()).toBe("0");
  });

  it("preserves beneficiary string unchanged", () => {
    const pubkey = "G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu";
    const result = toAnchorLeaf({ ...baseLeaf, beneficiary: pubkey });
    expect(result.beneficiary).toBe(pubkey);
  });
});
