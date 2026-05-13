import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { derivePda, PROGRAM_ID } from "../../src/lib/anchor/client";

// PDA derivation must match Rust seeds exactly:
//   VestingTree: [b"tree", creator, mint, campaign_id.to_le_bytes()]
//   VaultAuthority: [b"vault_authority", vesting_tree]
//   ClaimRecord: [b"claim", vesting_tree, beneficiary]

function deriveVestingTree(creator: PublicKey, mint: PublicKey, campaignId: number) {
  return derivePda([
    "tree",
    creator.toBuffer(),
    mint.toBuffer(),
    new BN(campaignId).toArrayLike(Buffer, "le", 8),
  ]);
}

function deriveVaultAuthority(vestingTree: PublicKey) {
  return derivePda(["vault_authority", vestingTree.toBuffer()]);
}

function deriveClaimRecord(vestingTree: PublicKey, beneficiary: PublicKey) {
  return derivePda(["claim", vestingTree.toBuffer(), beneficiary.toBuffer()]);
}

const CREATOR = PublicKey.default; // 1111...1111
const MINT = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"); // SPL Token program as stand-in
const BENEFICIARY = new PublicKey("SysvarC1ock11111111111111111111111111111111");

describe("PDA derivation — VestingTree", () => {
  it("deterministic for same inputs", () => {
    const [pda1] = deriveVestingTree(CREATOR, MINT, 1);
    const [pda2] = deriveVestingTree(CREATOR, MINT, 1);
    expect(pda1.equals(pda2)).toBe(true);
  });

  it("different campaign_id produces different PDA", () => {
    const [pda1] = deriveVestingTree(CREATOR, MINT, 1);
    const [pda2] = deriveVestingTree(CREATOR, MINT, 2);
    expect(pda1.equals(pda2)).toBe(false);
  });

  it("different creator produces different PDA", () => {
    const [pda1] = deriveVestingTree(CREATOR, MINT, 1);
    const [pda2] = deriveVestingTree(BENEFICIARY, MINT, 1);
    expect(pda1.equals(pda2)).toBe(false);
  });

  it("returns valid PublicKey (not on curve = PDA)", () => {
    const [pda] = deriveVestingTree(CREATOR, MINT, 1);
    expect(pda).toBeInstanceOf(PublicKey);
    expect(PublicKey.isOnCurve(pda)).toBe(false);
  });

  it("uses correct program ID", () => {
    expect(PROGRAM_ID.toBase58()).toBe("G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu");
  });
});

describe("PDA derivation — VaultAuthority", () => {
  it("deterministic for same tree", () => {
    const [tree] = deriveVestingTree(CREATOR, MINT, 1);
    const [va1] = deriveVaultAuthority(tree);
    const [va2] = deriveVaultAuthority(tree);
    expect(va1.equals(va2)).toBe(true);
  });

  it("different tree produces different vault authority", () => {
    const [tree1] = deriveVestingTree(CREATOR, MINT, 1);
    const [tree2] = deriveVestingTree(CREATOR, MINT, 2);
    const [va1] = deriveVaultAuthority(tree1);
    const [va2] = deriveVaultAuthority(tree2);
    expect(va1.equals(va2)).toBe(false);
  });
});

describe("PDA derivation — ClaimRecord", () => {
  it("deterministic for same (tree, beneficiary)", () => {
    const [tree] = deriveVestingTree(CREATOR, MINT, 1);
    const [cr1] = deriveClaimRecord(tree, BENEFICIARY);
    const [cr2] = deriveClaimRecord(tree, BENEFICIARY);
    expect(cr1.equals(cr2)).toBe(true);
  });

  it("different beneficiary produces different record", () => {
    const [tree] = deriveVestingTree(CREATOR, MINT, 1);
    const [cr1] = deriveClaimRecord(tree, CREATOR);
    const [cr2] = deriveClaimRecord(tree, BENEFICIARY);
    expect(cr1.equals(cr2)).toBe(false);
  });

  it("different tree produces different record", () => {
    const [tree1] = deriveVestingTree(CREATOR, MINT, 1);
    const [tree2] = deriveVestingTree(CREATOR, MINT, 2);
    const [cr1] = deriveClaimRecord(tree1, BENEFICIARY);
    const [cr2] = deriveClaimRecord(tree2, BENEFICIARY);
    expect(cr1.equals(cr2)).toBe(false);
  });
});
