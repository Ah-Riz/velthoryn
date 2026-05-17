import { describe, it, expect } from "vitest";
import { formatVestingError, VESTING_ERROR_CODES } from "../../src/lib/anchor/errors";

describe("formatVestingError", () => {
  it("maps UnauthorizedClaimer by name and code", () => {
    expect(
      formatVestingError(new Error("Error: UnauthorizedClaimer")),
    ).toContain("not the beneficiary");
    expect(
      formatVestingError(new Error(`custom program error: 0x${VESTING_ERROR_CODES.UnauthorizedClaimer.toString(16)}`)),
    ).toContain("not the beneficiary");
  });

  it("maps InvalidProof", () => {
    expect(formatVestingError(new Error("InvalidProof"))).toContain(
      "Schedule parameters",
    );
    expect(
      formatVestingError(new Error("0x177d")),
    ).toContain("Schedule parameters");
  });

  it("maps NothingToClaim with correct hex 0x177f", () => {
    expect(formatVestingError(new Error("NothingToClaim"))).toContain(
      "Nothing to claim",
    );
    expect(formatVestingError(new Error("0x177f"))).toContain(
      "Nothing to claim",
    );
  });

  it("maps InsufficientVault (tutorial InsufficientBalance)", () => {
    expect(formatVestingError(new Error("InsufficientVault"))).toContain(
      "Vault has insufficient",
    );
    expect(formatVestingError(new Error("0x1780"))).toContain(
      "Vault has insufficient",
    );
  });

  it("handles wallet rejection", () => {
    expect(formatVestingError(new Error("User rejected the request"))).toContain(
      "cancelled",
    );
  });
});
