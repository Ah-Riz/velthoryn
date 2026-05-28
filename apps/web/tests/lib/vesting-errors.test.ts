import { describe, expect, it } from "vitest";
import { formatVestingError } from "@/lib/anchor/errors";

describe("formatVestingError", () => {
  it("maps InstantRefundedCampaign (6035 / 0x1793)", () => {
    const msg = formatVestingError(
      new Error("custom program error: 0x1793. Error Code: InstantRefundedCampaign."),
    );
    expect(msg).toContain("instant-refunded");
  });

  it("maps CampaignAlreadyStarted (6036 / 0x1794)", () => {
    const msg = formatVestingError(
      new Error("custom program error: 0x1794. Error Code: CampaignAlreadyStarted."),
    );
    expect(msg).toContain("already started");
  });

  it("maps NotMultiLeafCampaign (6040 / 0x1798)", () => {
    const msg = formatVestingError(
      new Error("custom program error: 0x1798. Error Code: NotMultiLeafCampaign."),
    );
    expect(msg).toContain("multi-leaf");
  });
});
