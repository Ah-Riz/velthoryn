import { describe, it, expect } from "vitest";
import { Keypair } from "@solana/web3.js";
import {
  DISCRIMINATORS,
  parseCampaignCancelled,
  parseCampaignPaused,
  parseInstantRefunded,
  parseRootUpdated,
  parseUnvestedWithdrawn,
  parseMilestoneReleased,
  parseStreamCancelled,
} from "../../src/lib/indexer/event-indexer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomPubkeyBytes(): Buffer {
  return Buffer.from(Keypair.generate().publicKey.toBytes());
}

function buildCampaignCancelledBuffer(
  tree: Buffer,
  cancelledAt: bigint,
  claimedAtCancel: bigint,
): Buffer {
  const buf = Buffer.alloc(56);
  DISCRIMINATORS.CAMPAIGN_CANCELLED.copy(buf, 0);
  tree.copy(buf, 8);
  buf.writeBigInt64LE(cancelledAt, 40);
  buf.writeBigUInt64LE(claimedAtCancel, 48);
  return buf;
}

function buildCampaignPausedBuffer(tree: Buffer, paused: boolean): Buffer {
  const buf = Buffer.alloc(40);
  (paused ? DISCRIMINATORS.CAMPAIGN_PAUSED : DISCRIMINATORS.CAMPAIGN_UNPAUSED).copy(buf, 0);
  tree.copy(buf, 8);
  return buf;
}

function buildRootUpdatedBuffer(
  tree: Buffer,
  oldRoot: Buffer,
  newRoot: Buffer,
  newLeafCount: number,
): Buffer {
  const buf = Buffer.alloc(108);
  DISCRIMINATORS.ROOT_UPDATED.copy(buf, 0);
  tree.copy(buf, 8);
  oldRoot.copy(buf, 40);
  newRoot.copy(buf, 72);
  buf.writeUInt32LE(newLeafCount, 104);
  return buf;
}

function buildUnvestedWithdrawnBuffer(tree: Buffer, amount: bigint): Buffer {
  const buf = Buffer.alloc(48);
  DISCRIMINATORS.UNVESTED_WITHDRAWN.copy(buf, 0);
  tree.copy(buf, 8);
  buf.writeBigUInt64LE(amount, 40);
  return buf;
}

function buildMilestoneReleasedBuffer(
  tree: Buffer,
  milestoneIdx: number,
  releasedBy: Buffer,
): Buffer {
  const buf = Buffer.alloc(73);
  DISCRIMINATORS.MILESTONE_RELEASED.copy(buf, 0);
  tree.copy(buf, 8);
  buf.writeUInt8(milestoneIdx, 40);
  releasedBy.copy(buf, 41);
  return buf;
}

function buildStreamCancelledBuffer(
  tree: Buffer,
  cancelledAt: bigint,
  amountToBeneficiary: bigint,
  amountToCreator: bigint,
): Buffer {
  const buf = Buffer.alloc(64);
  DISCRIMINATORS.STREAM_CANCELLED.copy(buf, 0);
  tree.copy(buf, 8);
  buf.writeBigInt64LE(cancelledAt, 40);
  buf.writeBigUInt64LE(amountToBeneficiary, 48);
  buf.writeBigUInt64LE(amountToCreator, 56);
  return buf;
}

function buildInstantRefundedBuffer(
  tree: Buffer,
  cancelledAt: bigint,
  refundedTo: Buffer,
  amount: bigint,
): Buffer {
  const buf = Buffer.alloc(88);
  DISCRIMINATORS.INSTANT_REFUNDED.copy(buf, 0);
  tree.copy(buf, 8);
  buf.writeBigInt64LE(cancelledAt, 40);
  refundedTo.copy(buf, 48);
  buf.writeBigUInt64LE(amount, 80);
  return buf;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseCampaignCancelled", () => {
  it("parses correct fields from a valid buffer", () => {
    const tree = randomPubkeyBytes();
    const cancelledAt = 1700001000n;
    const claimedAtCancel = 5000000n;

    const buf = buildCampaignCancelledBuffer(tree, cancelledAt, claimedAtCancel);
    const result = parseCampaignCancelled(buf);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("cancelled");
    expect(result!.cancelledAt).toBe(cancelledAt);
    expect(result!.claimedAtCancel).toBe(claimedAtCancel);
  });

  it("returns null for buffer too short", () => {
    expect(parseCampaignCancelled(Buffer.alloc(55))).toBeNull();
  });

  it("returns null for wrong discriminator", () => {
    const buf = Buffer.alloc(56);
    // All zeros — no matching discriminator
    expect(parseCampaignCancelled(buf)).toBeNull();
  });
});

describe("parseCampaignPaused", () => {
  it("parses a pause event (paused=true)", () => {
    const tree = randomPubkeyBytes();
    const buf = buildCampaignPausedBuffer(tree, true);
    const result = parseCampaignPaused(buf);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("paused");
    expect(result!.paused).toBe(true);
  });

  it("parses an unpause event (paused=false)", () => {
    const tree = randomPubkeyBytes();
    const buf = buildCampaignPausedBuffer(tree, false);
    const result = parseCampaignPaused(buf);

    expect(result).not.toBeNull();
    expect(result!.paused).toBe(false);
  });

  it("returns null for buffer too short", () => {
    expect(parseCampaignPaused(Buffer.alloc(39))).toBeNull();
  });

  it("returns null for unknown discriminator", () => {
    const buf = Buffer.alloc(40);
    expect(parseCampaignPaused(buf)).toBeNull();
  });
});

describe("parseRootUpdated", () => {
  it("parses old_root, new_root, and new_leaf_count correctly", () => {
    const tree = randomPubkeyBytes();
    const oldRoot = Buffer.alloc(32, 0xaa);
    const newRoot = Buffer.alloc(32, 0xbb);
    const newLeafCount = 42;

    const buf = buildRootUpdatedBuffer(tree, oldRoot, newRoot, newLeafCount);
    const result = parseRootUpdated(buf);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("root_updated");
    expect(result!.oldRoot).toBe(oldRoot.toString("hex"));
    expect(result!.newRoot).toBe(newRoot.toString("hex"));
    expect(result!.newLeafCount).toBe(newLeafCount);
  });

  it("returns null for buffer too short", () => {
    expect(parseRootUpdated(Buffer.alloc(107))).toBeNull();
  });

  it("returns null for wrong discriminator", () => {
    expect(parseRootUpdated(Buffer.alloc(108))).toBeNull();
  });
});

describe("parseUnvestedWithdrawn", () => {
  it("parses the withdrawn amount correctly", () => {
    const tree = randomPubkeyBytes();
    const amount = 9999999999n;

    const buf = buildUnvestedWithdrawnBuffer(tree, amount);
    const result = parseUnvestedWithdrawn(buf);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("withdrawn");
    expect(result!.amount).toBe(amount);
  });

  it("returns null for buffer too short", () => {
    expect(parseUnvestedWithdrawn(Buffer.alloc(47))).toBeNull();
  });

  it("returns null for wrong discriminator", () => {
    expect(parseUnvestedWithdrawn(Buffer.alloc(48))).toBeNull();
  });
});

describe("parseMilestoneReleased", () => {
  it("parses milestone_idx and released_by correctly", () => {
    const tree = randomPubkeyBytes();
    const releasedBy = randomPubkeyBytes();
    const milestoneIdx = 3;

    const buf = buildMilestoneReleasedBuffer(tree, milestoneIdx, releasedBy);
    const result = parseMilestoneReleased(buf);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("milestone_released");
    expect(result!.milestoneIdx).toBe(milestoneIdx);
    // releasedBy should be a valid base58 string of correct length
    expect(result!.releasedBy).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it("returns null for buffer too short", () => {
    expect(parseMilestoneReleased(Buffer.alloc(72))).toBeNull();
  });

  it("returns null for wrong discriminator", () => {
    expect(parseMilestoneReleased(Buffer.alloc(73))).toBeNull();
  });
});

describe("parseStreamCancelled", () => {
  it("parses all three amounts and cancelledAt correctly", () => {
    const tree = randomPubkeyBytes();
    const cancelledAt = 1700005000n;
    const amountToBeneficiary = 800000n;
    const amountToCreator = 200000n;

    const buf = buildStreamCancelledBuffer(tree, cancelledAt, amountToBeneficiary, amountToCreator);
    const result = parseStreamCancelled(buf);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("stream_cancelled");
    expect(result!.cancelledAt).toBe(cancelledAt);
    expect(result!.amountToBeneficiary).toBe(amountToBeneficiary);
    expect(result!.amountToCreator).toBe(amountToCreator);
  });

  it("returns null for buffer too short", () => {
    expect(parseStreamCancelled(Buffer.alloc(63))).toBeNull();
  });

  it("returns null for wrong discriminator", () => {
    expect(parseStreamCancelled(Buffer.alloc(64))).toBeNull();
  });
});

describe("parseInstantRefunded", () => {
  it("parses cancelledAt, refundedTo, and amount correctly", () => {
    const tree = randomPubkeyBytes();
    const refundedTo = randomPubkeyBytes();
    const cancelledAt = 1700005001n;
    const amount = 123456789n;

    const buf = buildInstantRefundedBuffer(tree, cancelledAt, refundedTo, amount);
    const result = parseInstantRefunded(buf);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("instant_refunded");
    expect(result!.cancelledAt).toBe(cancelledAt);
    expect(result!.amount).toBe(amount);
    expect(result!.refundedTo).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it("returns null for buffer too short", () => {
    expect(parseInstantRefunded(Buffer.alloc(87))).toBeNull();
  });

  it("returns null for wrong discriminator", () => {
    expect(parseInstantRefunded(Buffer.alloc(88))).toBeNull();
  });
});

describe("DISCRIMINATORS", () => {
  it("each discriminator is an 8-byte Buffer", () => {
    for (const [key, disc] of Object.entries(DISCRIMINATORS)) {
      expect(disc.length, `${key} should be 8 bytes`).toBe(8);
    }
  });

  it("all discriminators are unique", () => {
    const hexValues = Object.values(DISCRIMINATORS).map((d) => d.toString("hex"));
    const unique = new Set(hexValues);
    expect(unique.size).toBe(hexValues.length);
  });
});
