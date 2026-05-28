import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";

import { parseVestingTree } from "@/lib/indexer/state-sync";
import { campaignStateToDbPatch } from "@/lib/indexer/state-sync";

function randPk(): Buffer {
  return Buffer.from(Keypair.generate().publicKey.toBytes());
}

function push(bufs: Buffer[], b: Buffer) {
  bufs.push(b);
}

function u8(n: number) {
  const b = Buffer.alloc(1);
  b.writeUInt8(n);
  return b;
}

function u32(n: number) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

function u64(n: bigint) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

function i64(n: bigint) {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(n);
  return b;
}

function buildVestingTreeBuffer(params: {
  legacy: boolean;
  cancelAuthoritySome: boolean;
  pauseAuthoritySome: boolean;
  cancelledAtSome: boolean;
  minCliffTime?: bigint;
  instantRefunded?: boolean;
}): Buffer {
  const {
    legacy,
    cancelAuthoritySome,
    pauseAuthoritySome,
    cancelledAtSome,
    minCliffTime,
    instantRefunded,
  } = params;

  const b: Buffer[] = [];
  push(b, Buffer.alloc(8, 7)); // discriminator (opaque)
  push(b, randPk()); // creator
  push(b, randPk()); // mint
  push(b, randPk()); // vault
  push(b, randPk()); // vault_authority
  push(b, u64(123n)); // campaign_id
  push(b, Buffer.alloc(32, 0xaa)); // merkle_root
  push(b, u32(2)); // leaf_count
  push(b, u64(999n)); // total_supply
  push(b, u64(111n)); // total_claimed
  push(b, u8(1)); // cancellable = true

  // cancel_authority: Option<Pubkey>
  push(b, u8(cancelAuthoritySome ? 1 : 0));
  if (cancelAuthoritySome) push(b, randPk());

  // cancelled_at: Option<i64>
  push(b, u8(cancelledAtSome ? 1 : 0));
  if (cancelledAtSome) push(b, i64(1700000000n));

  push(b, u8(0)); // paused = false

  // pause_authority: Option<Pubkey>
  push(b, u8(pauseAuthoritySome ? 1 : 0));
  if (pauseAuthoritySome) push(b, randPk());

  push(b, i64(1690000000n)); // created_at
  push(b, Buffer.alloc(32, 0)); // milestone_released_flags

  if (legacy) {
    push(b, u8(255)); // bump
    return Buffer.concat(b);
  }

  push(b, i64(minCliffTime ?? 0n)); // min_cliff_time
  push(b, u8(instantRefunded ? 1 : 0)); // instant_refunded
  push(b, u8(254)); // bump
  return Buffer.concat(b);
}

describe("parseVestingTree legacy/back-compat", () => {
  it("parses legacy layout (missing new fields) and applies deterministic defaults", () => {
    const buf = buildVestingTreeBuffer({
      legacy: true,
      cancelAuthoritySome: true,
      pauseAuthoritySome: true,
      cancelledAtSome: false,
    });

    const parsed = parseVestingTree(buf);
    expect(parsed).not.toBeNull();
    expect(parsed!.leafCount).toBe(2);
    expect(parsed!.minCliffTime).toBe(0n);
    expect(parsed!.instantRefunded).toBe(false);
  });

  it("parses new layout and reads new fields when present", () => {
    const buf = buildVestingTreeBuffer({
      legacy: false,
      cancelAuthoritySome: false,
      pauseAuthoritySome: false,
      cancelledAtSome: true,
      minCliffTime: 1700001234n,
      instantRefunded: true,
    });

    const parsed = parseVestingTree(buf);
    expect(parsed).not.toBeNull();
    expect(parsed!.cancelledAt).toBe(1700000000n);
    expect(parsed!.minCliffTime).toBe(1700001234n);
    expect(parsed!.instantRefunded).toBe(true);
  });
});

describe("state-sync DB patch", () => {
  it("includes new on-chain fields in DB update patch", () => {
    const buf = buildVestingTreeBuffer({
      legacy: false,
      cancelAuthoritySome: false,
      pauseAuthoritySome: false,
      cancelledAtSome: false,
      minCliffTime: 1700001234n,
      instantRefunded: true,
    });
    const parsed = parseVestingTree(buf);
    expect(parsed).not.toBeNull();

    const patch = campaignStateToDbPatch(parsed!);
    expect(patch).toMatchObject({
      minCliffTime: 1700001234n,
      instantRefunded: true,
    });
  });
});

