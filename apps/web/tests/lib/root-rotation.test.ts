import { describe, expect, it } from "vitest";
import {
  formatRootRotationPreview,
  parsePreparedRootRotationPayload,
} from "@/lib/campaign/root-rotation";

describe("root rotation payload helpers", () => {
  const payload = {
    merkleRoot: "a".repeat(64),
    leafCount: 2,
    minCliffTime: 1700003600,
    leaves: [
      {
        leafIndex: 0,
        beneficiary: "11111111111111111111111111111111",
        amount: "1000",
        releaseType: 0,
        startTime: "1700000000",
        cliffTime: "1700003600",
        endTime: "1700003600",
        milestoneIdx: 0,
        proof: [[...new Array(32)].map(() => 0)],
      },
      {
        leafIndex: 1,
        beneficiary: "11111111111111111111111111111112",
        amount: "2000",
        releaseType: 1,
        startTime: "1700000000",
        cliffTime: "1700003600",
        endTime: "1700007200",
        milestoneIdx: 0,
        proof: [[...new Array(32)].map(() => 1)],
      },
    ],
    releaseMix: {
      cliff: 1,
      linear: 1,
    },
  };

  it("parses prepared payload JSON and ignores extra fields", () => {
    const result = parsePreparedRootRotationPayload(JSON.stringify(payload));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.merkleRoot).toBe(payload.merkleRoot);
    expect(result.payload.leafCount).toBe(2);
    expect(result.payload.leaves).toHaveLength(2);
  });

  it("rejects malformed JSON", () => {
    const result = parsePreparedRootRotationPayload("{not-json");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/valid JSON/i);
  });

  it("rejects free-form root-only payloads without leaves", () => {
    const result = parsePreparedRootRotationPayload(
      JSON.stringify({
        merkleRoot: payload.merkleRoot,
        leafCount: 2,
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("formats preview rows from a valid payload", () => {
    const result = parsePreparedRootRotationPayload(JSON.stringify(payload));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(formatRootRotationPreview(result.payload)).toEqual([
      { label: "New Root", value: payload.merkleRoot },
      { label: "Leaf Count", value: "2" },
      { label: "Leaves In Payload", value: "2" },
      { label: "IPFS CID", value: "None" },
    ]);
  });
});
