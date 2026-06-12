import { describe, it, expect } from "vitest";
import { serializeBigInt } from "../../src/lib/api/serialize";

describe("serializeBigInt", () => {
  it("converts a plain BigInt to string", () => {
    expect(serializeBigInt(42n)).toBe("42");
  });

  it("converts BigInt values in an object to strings", () => {
    const input = {
      total_supply: 1_000_000n,
      claimed_amount: 250_000n,
      name: "campaign",
    };
    expect(serializeBigInt(input)).toEqual({
      total_supply: "1000000",
      claimed_amount: "250000",
      name: "campaign",
    });
  });

  it("handles nested objects and arrays", () => {
    const input = {
      items: [{ amount: 10n }, { amount: 20n }],
      meta: { slot: 99n },
    };
    expect(serializeBigInt(input)).toEqual({
      items: [{ amount: "10" }, { amount: "20" }],
      meta: { slot: "99" },
    });
  });

  it("passes through null, undefined, and non-BigInt primitives unchanged", () => {
    expect(serializeBigInt(null)).toBe(null);
    expect(serializeBigInt(undefined)).toBe(undefined);
    expect(serializeBigInt(42)).toBe(42);
    expect(serializeBigInt("hello")).toBe("hello");
    expect(serializeBigInt(true)).toBe(true);
  });

  it("allows JSON.stringify without throwing on BigInt-containing objects", () => {
    const serialized = serializeBigInt({ total: 999n });
    expect(() => JSON.stringify(serialized)).not.toThrow();
    expect(JSON.stringify(serialized)).toBe('{"total":"999"}');
  });
});
