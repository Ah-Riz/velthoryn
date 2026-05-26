import { describe, it, expect } from "vitest";
import { verifyAllLeaves, verifyLeafProof } from "@/lib/merkle/verify";
import {
  computeSingleLeafRoot,
  makeLeaf,
  makeTwoLeafCampaignBody,
  EMPTY_SIBLING,
} from "../helpers/requests";

describe("merkle verify", () => {
  it("accepts valid single-leaf root", () => {
    const leaf = makeLeaf();
    const root = computeSingleLeafRoot(leaf);
    const result = verifyLeafProof(leaf, root, 1);
    expect(result.ok).toBe(true);
  });

  it("rejects invalid single-leaf root", () => {
    const leaf = makeLeaf();
    const result = verifyLeafProof(leaf, "a".repeat(64), 1);
    expect(result.ok).toBe(false);
  });

  it("verifyAllLeaves accepts valid two-leaf tree", () => {
    const body = makeTwoLeafCampaignBody();
    const result = verifyAllLeaves(body.leaves, body.merkleRoot);
    expect(result.ok).toBe(true);
  });

  it("verifyAllLeaves rejects bad proof on second leaf", () => {
    const body = makeTwoLeafCampaignBody();
    const badLeaves = [
      body.leaves[0],
      { ...body.leaves[1], proof: [EMPTY_SIBLING] },
    ];
    const result = verifyAllLeaves(badLeaves, body.merkleRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.leafIndex).toBe(1);
    }
  });
});
