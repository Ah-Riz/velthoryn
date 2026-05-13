import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { derivePda, PROGRAM_ID } from "../../src/lib/anchor/client";

describe("derivePda", () => {
  it("returns a deterministic result for the same seeds", () => {
    const seeds = ["campaign", "test-seed"];
    const [pda1, bump1] = derivePda(seeds);
    const [pda2, bump2] = derivePda(seeds);

    expect(pda1.toBase58()).toBe(pda2.toBase58());
    expect(bump1).toBe(bump2);
  });

  it("returns different results for different seeds", () => {
    const seedsA = ["campaign", "alpha"];
    const seedsB = ["campaign", "beta"];

    const [pdaA] = derivePda(seedsA);
    const [pdaB] = derivePda(seedsB);

    expect(pdaA.toBase58()).not.toBe(pdaB.toBase58());
  });

  it("returns different results when seed order changes", () => {
    const [pdaAB] = derivePda(["a", "b"]);
    const [pdaBA] = derivePda(["b", "a"]);

    expect(pdaAB.toBase58()).not.toBe(pdaBA.toBase58());
  });

  it("works with Buffer seeds", () => {
    const seeds = [Buffer.from("campaign")];
    const [pda1, bump1] = derivePda(seeds);
    const [pda2, bump2] = derivePda(["campaign"]);

    expect(pda1.toBase58()).toBe(pda2.toBase58());
    expect(bump1).toBe(bump2);
  });

  it("works with Uint8Array seeds", () => {
    const seeds = [new TextEncoder().encode("campaign")];
    const [pda1, bump1] = derivePda(seeds);
    const [pda2, bump2] = derivePda(["campaign"]);

    expect(pda1.toBase58()).toBe(pda2.toBase58());
    expect(bump1).toBe(bump2);
  });

  it("returns a valid PublicKey", () => {
    const [pda] = derivePda(["test"]);
    expect(pda).toBeInstanceOf(PublicKey);
  });

  it("returns a bump (nonce) as a number", () => {
    const [, bump] = derivePda(["test"]);
    expect(typeof bump).toBe("number");
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });
});

describe("PROGRAM_ID", () => {
  it("matches the expected program ID", () => {
    const expected = "G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu";
    expect(PROGRAM_ID.toBase58()).toBe(expected);
  });

  it("is a PublicKey instance", () => {
    expect(PROGRAM_ID).toBeInstanceOf(PublicKey);
  });
});
