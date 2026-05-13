import { describe, it, expect } from "vitest";
import { extractAnchorEventData } from "../../src/lib/indexer/claim-events";

describe("extractAnchorEventData", () => {
  it("extracts base64 data from log lines with 'Program data:' prefix", () => {
    // "Hello World" in base64
    const validBase64 = Buffer.from("Hello World").toString("base64");
    const logs = [
      "Program 11111111111111111111111111111111 invoke [1]",
      `Program data: ${validBase64}`,
      "Program 11111111111111111111111111111111 success",
    ];

    const result = extractAnchorEventData(logs);
    expect(result).toHaveLength(1);
    expect(Buffer.from(result[0]).toString("utf-8")).toBe("Hello World");
  });

  it("extracts multiple 'Program data:' entries from a single log set", () => {
    const data1 = Buffer.from("first-event").toString("base64");
    const data2 = Buffer.from("second-event").toString("base64");
    const logs = [
      `Program data: ${data1}`,
      "Some other log line",
      `Program data: ${data2}`,
    ];

    const result = extractAnchorEventData(logs);
    expect(result).toHaveLength(2);
    expect(Buffer.from(result[0]).toString("utf-8")).toBe("first-event");
    expect(Buffer.from(result[1]).toString("utf-8")).toBe("second-event");
  });

  it("returns empty array when no 'Program data:' lines exist", () => {
    const logs = [
      "Program 11111111111111111111111111111111 invoke [1]",
      "Program log: Instruction: Claim",
      "Program 11111111111111111111111111111111 success",
    ];

    const result = extractAnchorEventData(logs);
    expect(result).toHaveLength(0);
  });

  it("processes base64 data even with non-standard characters (Node.js best-effort decode)", () => {
    // Node.js Buffer.from with 'base64' encoding does best-effort decoding
    // and does NOT throw on invalid base64. The function's try/catch is a
    // safety net for edge cases, but standard invalid base64 still produces a buffer.
    const logs = [
      "Program data: !!!not-valid-base64!!!",
    ];

    const result = extractAnchorEventData(logs);
    // Node.js will still produce a buffer from best-effort decoding
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(Buffer);
  });

  it("processes all entries including non-standard base64", () => {
    const validBase64 = Buffer.from("valid-event").toString("base64");
    const logs = [
      "Program data: !!!invalid!!!",
      `Program data: ${validBase64}`,
      "Program data: also-not-valid@@@",
    ];

    const result = extractAnchorEventData(logs);
    // All three produce buffers because Node.js base64 decoding is lenient
    expect(result).toHaveLength(3);
    // The middle one should decode to our valid string
    expect(Buffer.from(result[1]).toString("utf-8")).toBe("valid-event");
  });

  it("handles 'Program data:' prefix appearing mid-line", () => {
    const validBase64 = Buffer.from("mid-line").toString("base64");
    const logs = [
      `some prefix Program data: ${validBase64}`,
    ];

    const result = extractAnchorEventData(logs);
    expect(result).toHaveLength(1);
    expect(Buffer.from(result[0]).toString("utf-8")).toBe("mid-line");
  });

  it("handles empty log array", () => {
    const result = extractAnchorEventData([]);
    expect(result).toHaveLength(0);
  });

  it("handles 8-byte discriminator buffer (typical Anchor event)", () => {
    // 8 arbitrary bytes + 32 zero bytes = 40-byte event (e.g. CampaignPaused)
    const eventBuf = Buffer.alloc(40);
    eventBuf[0] = 0xaf; // matches CAMPAIGN_PAUSED_DISCRIMINATOR first byte
    const validBase64 = eventBuf.toString("base64");
    const logs = [`Program data: ${validBase64}`];

    const result = extractAnchorEventData(logs);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(40);
    expect(result[0][0]).toBe(0xaf);
  });
});
