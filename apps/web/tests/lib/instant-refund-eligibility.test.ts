import { describe, it, expect } from "vitest";
import { computeInstantRefundEligible } from "@/lib/api/instant-refund";

describe("computeInstantRefundEligible", () => {
  it("is eligible only for unstarted, multi-leaf, cancellable campaigns with no milestones released", () => {
    expect(
      computeInstantRefundEligible({
        leafCount: 2,
        cancellable: true,
        cancelledAt: null,
        instantRefunded: false,
        minCliffTime: 200n,
        milestoneReleasedCount: 0,
        nowSecs: 100n,
      }),
    ).toBe(true);

    expect(
      computeInstantRefundEligible({
        leafCount: 1,
        cancellable: true,
        cancelledAt: null,
        instantRefunded: false,
        minCliffTime: 200n,
        milestoneReleasedCount: 0,
        nowSecs: 100n,
      }),
    ).toBe(false);

    expect(
      computeInstantRefundEligible({
        leafCount: 2,
        cancellable: true,
        cancelledAt: null,
        instantRefunded: false,
        minCliffTime: 200n,
        milestoneReleasedCount: 1,
        nowSecs: 100n,
      }),
    ).toBe(false);

    expect(
      computeInstantRefundEligible({
        leafCount: 2,
        cancellable: true,
        cancelledAt: null,
        instantRefunded: false,
        minCliffTime: 100n,
        milestoneReleasedCount: 0,
        nowSecs: 100n,
      }),
    ).toBe(false);

    expect(
      computeInstantRefundEligible({
        leafCount: 2,
        cancellable: true,
        cancelledAt: 50n,
        instantRefunded: false,
        minCliffTime: 200n,
        milestoneReleasedCount: 0,
        nowSecs: 100n,
      }),
    ).toBe(false);

    expect(
      computeInstantRefundEligible({
        leafCount: 2,
        cancellable: true,
        cancelledAt: null,
        instantRefunded: true,
        minCliffTime: 200n,
        milestoneReleasedCount: 0,
        nowSecs: 100n,
      }),
    ).toBe(false);
  });
});

