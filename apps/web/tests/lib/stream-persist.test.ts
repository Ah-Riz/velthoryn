import { describe, it, expect } from "vitest";
import { buildCreateStreamIndexPayload } from "../../src/lib/stream/persist";
import { hashLeaf } from "../../src/lib/merkle/builder";

describe("buildCreateStreamIndexPayload", () => {
  it("sets merkleRoot to single-leaf hash with empty proof", () => {
    const beneficiary = "GPfHeZtBna1rJmwam1yCcREhYnLcxWhBmUdDoVuL5Es6";
    const payload = buildCreateStreamIndexPayload({
      treeAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      creator: beneficiary,
      mint: beneficiary,
      campaignId: 1,
      beneficiary,
      amount: "10000",
      releaseType: 1,
      startTime: 1000,
      cliffTime: 1000,
      endTime: 2000,
      milestoneIdx: 0,
      cancellable: false,
      cancelAuthority: null,
      createdAt: 1700000000,
    });

    expect(payload.leafCount).toBe(1);
    expect(payload.leaves[0].proof).toEqual([]);

    const leafHash = hashLeaf({
      leafIndex: 0,
      beneficiary,
      amount: 10000n,
      releaseType: 1,
      startTs: 1000n,
      cliffTs: 1000n,
      endTs: 2000n,
      milestoneIdx: 0,
    });
    expect(payload.merkleRoot).toBe(leafHash.toString("hex"));
  });
});
