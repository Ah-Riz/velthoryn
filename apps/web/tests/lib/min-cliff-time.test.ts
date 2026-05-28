import { describe, expect, it } from "vitest";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { computeMinCliffTime, prepareCampaign, ReleaseType } from "@velthoryn/client";

describe("computeMinCliffTime", () => {
  it("returns the minimum cliff across leaves (not necessarily leaf 0)", () => {
    const beneficiary = PublicKey.default;
    const leaves = prepareCampaign([
      {
        beneficiary,
        amount: new BN(100),
        releaseType: ReleaseType.Linear,
        startTime: new BN(0),
        cliffTime: new BN(500),
        endTime: new BN(1000),
        milestoneIdx: 0,
      },
      {
        beneficiary,
        amount: new BN(200),
        releaseType: ReleaseType.Linear,
        startTime: new BN(0),
        cliffTime: new BN(100),
        endTime: new BN(1000),
        milestoneIdx: 0,
      },
    ]).leaves;

    expect(computeMinCliffTime(leaves).toString()).toBe("100");
  });
});
