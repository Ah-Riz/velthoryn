import { describe, expect, it } from "vitest";
import {
  getRecipientClaimableAmount,
  getRecipientStreamStatus,
  getSenderStreamStatus,
} from "@/lib/vesting/list";

describe("getSenderStreamStatus", () => {
  it("returns Active for live sender streams", () => {
    expect(
      getSenderStreamStatus({
        totalSupply: "1000",
        totalClaimed: "250",
        paused: false,
        cancelledAt: null,
      }),
    ).toBe("Active");
  });

  it("returns Paused when paused", () => {
    expect(
      getSenderStreamStatus({
        totalSupply: "1000",
        totalClaimed: "250",
        paused: true,
        cancelledAt: null,
      }),
    ).toBe("Paused");
  });

  it("returns Cancelled when cancelledAt is set but no event table record", () => {
    expect(
      getSenderStreamStatus({
        totalSupply: "1000",
        totalClaimed: "250",
        paused: false,
        cancelledAt: 1700000000,
      }),
    ).toBe("Cancelled");
  });

  it("returns Grace Period when hasCancelEvent is true", () => {
    expect(
      getSenderStreamStatus({
        totalSupply: "1000",
        totalClaimed: "250",
        paused: false,
        cancelledAt: 1700000000,
        hasCancelEvent: true,
      }),
    ).toBe("Grace Period");
  });

  it("returns Settled when streamSettled is true", () => {
    expect(
      getSenderStreamStatus({
        totalSupply: "1000",
        totalClaimed: "250",
        paused: false,
        cancelledAt: 1700000000,
        streamSettled: true,
      }),
    ).toBe("Settled");
  });

  it("returns Refunded when instantRefunded is true", () => {
    expect(
      getSenderStreamStatus({
        totalSupply: "1000",
        totalClaimed: "250",
        paused: false,
        cancelledAt: 1700000000,
        instantRefunded: true,
      }),
    ).toBe("Refunded");
  });

  it("returns Claimed when fully claimed", () => {
    expect(
      getSenderStreamStatus({
        totalSupply: "1000",
        totalClaimed: "1000",
        paused: false,
        cancelledAt: null,
      }),
    ).toBe("Claimed");
  });
});

describe("getRecipientStreamStatus", () => {
  const base = {
    paused: false,
    cancelledAt: null,
    myClaimed: "0",
    myLeaf: {
      amount: "1000",
      releaseType: 0,
      cliffTime: 200,
      endTime: 200,
    },
  };

  it("returns Scheduled before unlock", () => {
    expect(getRecipientStreamStatus(base, 100n)).toBe("Scheduled");
  });

  it("returns Claimable after cliff unlock", () => {
    expect(getRecipientStreamStatus(base, 250n)).toBe("Claimable");
  });

  it("returns Claimed when fully claimed", () => {
    expect(getRecipientStreamStatus({ ...base, myClaimed: "1000" }, 250n)).toBe("Claimed");
  });

  it("returns Paused when paused and not fully claimed", () => {
    expect(getRecipientStreamStatus({ ...base, paused: true }, 250n)).toBe("Paused");
  });

  it("returns Cancelled when cancelled and not fully claimed", () => {
    expect(
      getRecipientStreamStatus({ ...base, cancelledAt: 180 }, 250n),
    ).toBe("Cancelled");
  });

  it("returns Claimable for matured milestone streams", () => {
    expect(
      getRecipientStreamStatus(
        {
          ...base,
          myLeaf: {
            amount: "1000",
            releaseType: 2,
            cliffTime: 200,
            endTime: 200,
          },
        },
        250n,
      ),
    ).toBe("Claimable");
  });

  it("returns claimable amount for partially vested linear streams", () => {
    expect(
      getRecipientClaimableAmount(
        {
          paused: false,
          cancelledAt: null,
          myClaimed: "100",
          myLeaf: {
            amount: "1000",
            releaseType: 1,
            cliffTime: 100,
            endTime: 200,
          },
        },
        150n,
      ),
    ).toBe(400n);
  });
});
