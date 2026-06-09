import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { expect } from "chai";

import {
  createTestMint,
  fundCreatorAta,
  treePDA,
  claimRecordPDA,
  vaultAuthorityPDA,
  PROGRAM_ID,
} from "./setup";
import { VestingMerkleTree, type VestingLeaf } from "../../clients/ts/src";

// ---------------------------------------------------------------------------
// idlLeaf — Build a leaf object matching the IDL `vestingLeaf` type exactly.
// ---------------------------------------------------------------------------

export function idlLeaf(leaf: VestingLeaf): {
  leafIndex: number;
  beneficiary: PublicKey;
  amount: BN;
  releaseType: number;
  startTime: BN;
  cliffTime: BN;
  endTime: BN;
  milestoneIdx: number;
} {
  return {
    leafIndex: leaf.leafIndex,
    beneficiary: leaf.beneficiary,
    amount: leaf.amount,
    releaseType: leaf.releaseType,
    startTime: leaf.startTime,
    cliffTime: leaf.cliffTime,
    endTime: leaf.endTime,
    milestoneIdx: leaf.milestoneIdx,
  };
}

// ---------------------------------------------------------------------------
// idlProof — Convert a Buffer[] proof into the number[][] format the IDL expects.
// ---------------------------------------------------------------------------

export function idlProof(proof: Buffer[]): number[][] {
  return proof.map((b) => Array.from(b));
}

// ---------------------------------------------------------------------------
// expectAnchorError — Expect an Anchor custom program error with the given code.
// ---------------------------------------------------------------------------

export function expectAnchorError(err: unknown, code: number) {
  const hex = "0x" + code.toString(16).padStart(4, "0");
  const msg = (err as any).message || String(err);
  const logs = ((err as any).logs || []).join("\n");
  const haystack = msg + "\n" + logs;
  const decimal = `Error Number: ${code}`;
  const anchorName = Object.entries({
    FullyVested: 6031,
    StreamExpired: 6032,
    MilestoneNotReleased: 6033,
    MilestoneAlreadyReleased: 6034,
    InstantRefundedCampaign: 6035,
    CampaignAlreadyStarted: 6036,
    NotMultiLeafCampaign: 6040,
    NothingToClaim: 6015,
    AlreadyCancelled: 6020,
  }).find(([, v]) => v === code)?.[0];

  // Some providers redact program logs; fall back to structured Anchor error.
  const anchorNum = (err as any)?.error?.errorCode?.number;

  const matched =
    haystack.includes(hex) ||
    haystack.includes(String(code)) ||
    haystack.includes(decimal) ||
    (anchorName !== undefined && haystack.includes(anchorName)) ||
    anchorNum === code;
  expect(matched, `expected Anchor error ${hex} (${code})`).to.equal(true);
}

// ---------------------------------------------------------------------------
// createAndFundCampaign — Create + fund a campaign and return all derived
// addresses. Uses the provided leaves to build the merkle tree.
// ---------------------------------------------------------------------------

export async function createAndFundCampaign(
  ctx: {
    provider: any;
    program: any;
    creator: Keypair;
    cancelAuthority: Keypair;
    pauseAuthority: Keypair;
  },
  campaignId: number,
  leaves: VestingLeaf[],
  totalSupply: number,
  cancellable: boolean = true,
) {
  const { provider, program, creator, cancelAuthority, pauseAuthority } = ctx;
  const mint = await createTestMint(provider, creator.publicKey);
  await fundCreatorAta(provider, mint, creator.publicKey, totalSupply);

  const tree = new VestingMerkleTree(leaves);
  const minCliffTime = leaves.reduce((min, l) => {
    const v = (l.cliffTime as any) as BN;
    return min.lt(v) ? min : v;
  }, leaves[0]!.cliffTime);
  const [treePda] = await treePDA(
    PROGRAM_ID,
    creator.publicKey,
    mint,
    campaignId,
  );
  const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
  const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

  await program.methods
    .createCampaign({
      campaignId: new BN(campaignId),
      merkleRoot: Array.from(tree.root),
      leafCount: leaves.length,
      totalSupply: new BN(totalSupply),
      minCliffTime,
      cancellable,
      cancelAuthority: cancelAuthority.publicKey,
      pauseAuthority: pauseAuthority.publicKey,
    })
    .accounts({
      creator: creator.publicKey,
      vestingTree: treePda,
      vaultAuthority: vaultAuthPda,
      vault,
      mint,
    })
    .signers([creator])
    .rpc();

  await program.methods
    .fundCampaign(new BN(totalSupply))
    .accounts({
      creator: creator.publicKey,
      vestingTree: treePda,
      vault,
      sourceAta: getAssociatedTokenAddressSync(mint, creator.publicKey),
    })
    .signers([creator])
    .rpc();

  return { mint, tree, treePda, vaultAuthPda, vault };
}

// ---------------------------------------------------------------------------
// issueClaim — Issue a claim transaction with all boilerplate handled.
// ---------------------------------------------------------------------------

export async function issueClaim(
  ctx: {
    program: any;
  },
  leaf: VestingLeaf,
  proof: Buffer[],
  beneficiary: Keypair,
  treePda: PublicKey,
  vaultAuthPda: PublicKey,
  vault: PublicKey,
  mint: PublicKey,
) {
  const crPda = (
    await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey)
  )[0];

  return ctx.program.methods
    .claim(idlLeaf(leaf), idlProof(proof))
    .accounts({
      beneficiary: beneficiary.publicKey,
      vestingTree: treePda,
      claimRecord: crPda,
      vaultAuthority: vaultAuthPda,
      vault,
      beneficiaryAta: getAssociatedTokenAddressSync(mint, beneficiary.publicKey),
      mint,
    })
    .signers([beneficiary])
    .rpc();
}

// ---------------------------------------------------------------------------
// releaseMilestone — Creator sets on-chain milestone release flag before claim.
// ---------------------------------------------------------------------------

export async function releaseMilestone(
  ctx: { program: any; creator: Keypair },
  treePda: PublicKey,
  milestoneIdx: number,
) {
  const { program, creator } = ctx;
  return program.methods
    .setMilestoneReleased(milestoneIdx)
    .accounts({
      creator: creator.publicKey,
      vestingTree: treePda,
    })
    .signers([creator])
    .rpc();
}

// ---------------------------------------------------------------------------
// validateClockAdvance — Validates that setClock actually advanced the clock.
//
// This function addresses inconsistent threshold validation across tests by:
// 1. Using a consistent 90% threshold with tolerance
// 2. Verifying the clock actually reaches close to the target timestamp
// 3. Maintaining graceful degradation when setClock doesn't work
//
// Parameters:
// - provider: Anchor provider with connection
// - targetTimestamp: The timestamp we tried to set via setClock
// - baselineTimestamp: The original timestamp before setClock (e.g., t.now)
// - minThresholdPercent: Minimum percentage of target that must be reached (default: 90)
//
// Returns: true if validation passed, false if should skip test
//
// The 90% threshold allows for some RPC latency while ensuring the clock
// actually advanced meaningfully toward the target. Tests should skip if
// the clock doesn't advance sufficiently to avoid flaky assertions.
// ---------------------------------------------------------------------------

export async function validateClockAdvance(
  provider: any,
  targetTimestamp: number,
  baselineTimestamp: number,
  minThresholdPercent: number = 90,
): Promise<boolean> {
  try {
    // Request the clock to advance to target timestamp
    await (provider.connection as any)._rpcRequest("setClock", {
      unixTimestamp: targetTimestamp,
    });

    // Verify the clock actually advanced by checking current block time
    const slot = await provider.connection.getSlot();
    const blockTime = await provider.connection.getBlockTime(slot);

    if (!blockTime) {
      return false; // No block time available
    }

    // Calculate expected minimum timestamp (90% of target by default)
    const expectedAdvancement = targetTimestamp - baselineTimestamp;
    const minExpectedTimestamp = baselineTimestamp + Math.floor(expectedAdvancement * minThresholdPercent / 100);

    // Check if clock advanced sufficiently
    if (blockTime < minExpectedTimestamp) {
      return false; // Clock didn't advance enough
    }

    return true; // Validation passed
  } catch {
    // setClock not available or other error
    return false;
  }
}

// ---------------------------------------------------------------------------
// skipIfClockNotAdvanced — Helper to skip test if clock validation fails.
//
// This wraps validateClockAdvance in a Mocha-friendly way that calls
// this.skip() when validation fails, providing consistent error messages.
//
// Usage:
//   await skipIfClockNotAdvanced(provider, targetTimestamp, baselineTimestamp);
// ---------------------------------------------------------------------------

export async function skipIfClockNotAdvanced(
  provider: any,
  targetTimestamp: number,
  baselineTimestamp: number,
  minThresholdPercent: number = 90,
): Promise<void> {
  const success = await validateClockAdvance(
    provider,
    targetTimestamp,
    baselineTimestamp,
    minThresholdPercent,
  );

  if (!success) {
    const expectedAdvancement = targetTimestamp - baselineTimestamp;
    const minExpectedTimestamp = baselineTimestamp + Math.floor(expectedAdvancement * minThresholdPercent / 100);

    // Get current block time for better error message
    const slot = await provider.connection.getSlot();
    const blockTime = await provider.connection.getBlockTime(slot);

    const message = blockTime
      ? `Clock advancement validation failed: current=${blockTime}, needed≥${minExpectedTimestamp} (target=${targetTimestamp}). This test requires setClock RPC support.`
      : `Clock advancement validation failed: no block time available. This test requires setClock RPC support.`;

    throw new Error(message); // This will be caught by the test wrapper
  }
}
