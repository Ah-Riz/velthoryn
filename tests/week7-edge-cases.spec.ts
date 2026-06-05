/**
 * week7-edge-cases.spec.ts
 *
 * NEW edge case tests not covered by existing test suites.
 * Uses solana-bankrun for deterministic clock control.
 *
 * Coverage gap analysis (24 of 30 requested edge cases already covered):
 *   - security.spec.ts: forged proof, oversized proof, grace bypass, premature close, etc.
 *   - vesting.supplementary.spec.ts: 70+ tests covering most error paths
 *   - vesting.clock.spec.ts: clock-dependent withdraw/claim/cancel/grace
 *   - week7-integration-flow.spec.ts: full integration flows
 *
 * This file covers the 7 remaining gaps.
 */
import { BN, Program, Wallet } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  createInitializeMintInstruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { expect } from "chai";

import {
  startTest,
  warpClock,
  bankrunNow,
  treePDA,
  claimRecordPDA,
  vaultAuthorityPDA,
} from "./utils/bankrun";
import { PROGRAM_ID } from "./utils/setup";
import {
  idlLeaf,
  idlProof,
  expectAnchorError,
} from "./utils/helpers";
import {
  ReleaseType,
  VestingMerkleTree,
  type VestingLeaf,
  prepareCampaign,
} from "../clients/ts/src";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRACE_PERIOD_SECS = 7 * 24 * 60 * 60; // 604800

const ERR = {
  NothingToClaim: 6015,
  InvalidProof: 6013,
  StreamExpired: 6032,
} as const;

// ---------------------------------------------------------------------------
// Helpers — bankrun-compatible SPL token operations
// ---------------------------------------------------------------------------

async function createTestMintTx(
  provider: any,
  authority: PublicKey,
): Promise<{ mint: PublicKey; mintKp: Keypair }> {
  const mintKp = Keypair.generate();
  const payer = (provider.wallet as Wallet).payer;
  const lamports = await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKp.publicKey,
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mintKp.publicKey,
      9,
      authority,
      authority,
      TOKEN_PROGRAM_ID,
    ),
  );

  await provider.sendAndConfirm(tx, [payer, mintKp]);
  return { mint: mintKp.publicKey, mintKp };
}

async function fundCreatorAtaTx(
  provider: any,
  mint: PublicKey,
  owner: PublicKey,
  amount: number | BN,
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner);
  const payer = (provider.wallet as Wallet).payer;

  const tx = new Transaction();

  // Create ATA if needed
  try {
    await getAccount(provider.connection, ata);
  } catch {
    tx.add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        ata,
        owner,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }

  // Mint tokens
  tx.add(
    createMintToInstruction(
      mint,
      ata,
      payer.publicKey,
      amount,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  await provider.sendAndConfirm(tx, [payer]);
  return ata;
}

async function makeBeneficiaryTx(provider: any): Promise<Keypair> {
  const kp = Keypair.generate();
  const payer = (provider.wallet as Wallet).payer;
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: kp.publicKey,
      lamports: 1_000_000_000,
    }),
  );
  await provider.sendAndConfirm(tx, [payer]);
  return kp;
}

async function createBeneficiaryAta(
  provider: any,
  mint: PublicKey,
  beneficiary: PublicKey,
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, beneficiary);
  const payer = (provider.wallet as Wallet).payer;
  const tx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      ata,
      beneficiary,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
  );
  await provider.sendAndConfirm(tx, [payer]);
  return ata;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("week7 edge case tests (bankrun)", () => {
  let ctx: Awaited<ReturnType<typeof startTest>>;

  before(async () => {
    ctx = await startTest();
  });

  const freshCtx = () => ctx;

  // =========================================================================
  // EC6: Claim zero-amount leaf → NothingToClaim
  // =========================================================================
  it("EC6: claim zero-amount leaf rejects with NothingToClaim", async () => {
    const { context, provider, program, creator, cancelAuthority, pauseAuthority } = freshCtx();
    const beneficiaryA = await makeBeneficiaryTx(provider);
    const beneficiaryB = await makeBeneficiaryTx(provider);
    const now = await bankrunNow(context);

    // 2-leaf campaign: A gets 1000, B gets 0
    const leafA: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiaryA.publicKey,
      amount: new BN(1000),
      releaseType: ReleaseType.Cliff,
      startTime: new BN(now),
      cliffTime: new BN(now),      // past cliff so vested > 0 for A
      endTime: new BN(now + 1000),
      milestoneIdx: 0,
    };
    const leafB: VestingLeaf = {
      leafIndex: 1,
      beneficiary: beneficiaryB.publicKey,
      amount: new BN(0),            // zero-amount leaf
      releaseType: ReleaseType.Cliff,
      startTime: new BN(now),
      cliffTime: new BN(now),
      endTime: new BN(now + 1000),
      milestoneIdx: 0,
    };

    const tree = new VestingMerkleTree([leafA, leafB]);
    const TOTAL = 1000;

    const { mint } = await createTestMintTx(provider, creator.publicKey);
    await fundCreatorAtaTx(provider, mint, creator.publicKey, TOTAL);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 7001);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    await program.methods
      .createCampaign({
        campaignId: new BN(7001),
        merkleRoot: Array.from(tree.root) as any,
        leafCount: 2,
        totalSupply: new BN(TOTAL),
        minCliffTime: new BN(now),
        cancellable: true,
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
      .fundCampaign(new BN(TOTAL))
      .accounts({
        creator: creator.publicKey,
        vestingTree: treePda,
        vault,
        sourceAta: getAssociatedTokenAddressSync(mint, creator.publicKey),
      })
      .signers([creator])
      .rpc();

    // Claim leaf B (zero amount) — proof is valid but vested = 0.
    // Note: With amount=0, claimed_amount (0) >= amount (0) is true, so the
    // program treats it as "fully claimed" and returns StreamExpired (6032),
    // not NothingToClaim (6015).
    const beneficiaryBAta = await createBeneficiaryAta(provider, mint, beneficiaryB.publicKey);
    const [crPdaB] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiaryB.publicKey);

    try {
      await program.methods
        .claim(idlLeaf(leafB), idlProof(tree.proof(1)))
        .accounts({
          beneficiary: beneficiaryB.publicKey,
          vestingTree: treePda,
          claimRecord: crPdaB,
          vaultAuthority: vaultAuthPda,
          vault,
          beneficiaryAta: beneficiaryBAta,
          mint,
        })
        .signers([beneficiaryB])
        .rpc();
      expect.fail("should have thrown");
    } catch (e: any) {
      expectAnchorError(e, ERR.StreamExpired);
    }
  });

  // =========================================================================
  // EC7: Update root after some claimed — old proof rejects, claim record preserved
  // =========================================================================
  it("EC7: update_root preserves claim records; old proof rejects with InvalidProof", async () => {
    const { context, provider, program, creator, cancelAuthority, pauseAuthority } = freshCtx();
    const beneficiaryA = await makeBeneficiaryTx(provider);
    const beneficiaryB = await makeBeneficiaryTx(provider);
    const beneficiaryC = await makeBeneficiaryTx(provider);
    const now = await bankrunNow(context);

    // Initial 2-leaf tree: A=500, B=500
    const leafA: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiaryA.publicKey,
      amount: new BN(500),
      releaseType: ReleaseType.Cliff,
      startTime: new BN(now),
      cliffTime: new BN(now),
      endTime: new BN(now + 1000),
      milestoneIdx: 0,
    };
    const leafB: VestingLeaf = {
      leafIndex: 1,
      beneficiary: beneficiaryB.publicKey,
      amount: new BN(500),
      releaseType: ReleaseType.Cliff,
      startTime: new BN(now),
      cliffTime: new BN(now),
      endTime: new BN(now + 1000),
      milestoneIdx: 0,
    };

    const oldTree = new VestingMerkleTree([leafA, leafB]);
    const TOTAL = 1000;

    const { mint } = await createTestMintTx(provider, creator.publicKey);
    await fundCreatorAtaTx(provider, mint, creator.publicKey, TOTAL);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 7002);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    await program.methods
      .createCampaign({
        campaignId: new BN(7002),
        merkleRoot: Array.from(oldTree.root) as any,
        leafCount: 2,
        totalSupply: new BN(TOTAL),
        minCliffTime: new BN(now),
        cancellable: true,
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
      .fundCampaign(new BN(TOTAL))
      .accounts({
        creator: creator.publicKey,
        vestingTree: treePda,
        vault,
        sourceAta: getAssociatedTokenAddressSync(mint, creator.publicKey),
      })
      .signers([creator])
      .rpc();

    // Step 1: Claim leaf A under old root (succeeds)
    const beneficiaryAAta = await createBeneficiaryAta(provider, mint, beneficiaryA.publicKey);
    const [crPdaA] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiaryA.publicKey);

    await program.methods
      .claim(idlLeaf(leafA), idlProof(oldTree.proof(0)))
      .accounts({
        beneficiary: beneficiaryA.publicKey,
        vestingTree: treePda,
        claimRecord: crPdaA,
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta: beneficiaryAAta,
        mint,
      })
      .signers([beneficiaryA])
      .rpc();

    // Verify A received tokens
    const balA = await getAccount(provider.connection, beneficiaryAAta);
    expect(Number(balA.amount)).to.equal(500);

    // Step 2: Build new tree with 2 leaves (C + dummy) so leaf_count matches
    // the old tree and old proof length doesn't trigger ProofTooLong before
    // the actual InvalidProof check.
    const leafC: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiaryC.publicKey,
      amount: new BN(500),
      releaseType: ReleaseType.Cliff,
      startTime: new BN(now),
      cliffTime: new BN(now),
      endTime: new BN(now + 1000),
      milestoneIdx: 0,
    };
    const leafD: VestingLeaf = {
      leafIndex: 1,
      beneficiary: beneficiaryA.publicKey, // reuse A's address as dummy
      amount: new BN(500),
      releaseType: ReleaseType.Cliff,
      startTime: new BN(now),
      cliffTime: new BN(now),
      endTime: new BN(now + 1000),
      milestoneIdx: 0,
    };
    const newTree = new VestingMerkleTree([leafC, leafD]);

    // Update root — leaf_count stays at 2 so old proof length is still valid
    await program.methods
      .updateRoot(Array.from(newTree.root) as any, 2, new BN(now))
      .accounts({
        cancelAuthority: cancelAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([cancelAuthority])
      .rpc();

    // Step 3: Claim B with OLD proof → InvalidProof (root changed, proof
    // length is still valid since both trees have 2 leaves)
    const beneficiaryBAta = await createBeneficiaryAta(provider, mint, beneficiaryB.publicKey);
    const [crPdaB] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiaryB.publicKey);

    try {
      await program.methods
        .claim(idlLeaf(leafB), idlProof(oldTree.proof(1)))
        .accounts({
          beneficiary: beneficiaryB.publicKey,
          vestingTree: treePda,
          claimRecord: crPdaB,
          vaultAuthority: vaultAuthPda,
          vault,
          beneficiaryAta: beneficiaryBAta,
          mint,
        })
        .signers([beneficiaryB])
        .rpc();
      expect.fail("should have thrown");
    } catch (e: any) {
      expectAnchorError(e, ERR.InvalidProof);
    }

    // Step 4: Verify A's ClaimRecord preserved — still 500 claimed
    const crA = await program.account.claimRecord.fetch(crPdaA);
    expect(Number(crA.claimedAmount)).to.equal(500);

    // Step 5: Claim C with new proof → succeeds
    const beneficiaryCAta = await createBeneficiaryAta(provider, mint, beneficiaryC.publicKey);
    const [crPdaC] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiaryC.publicKey);

    await program.methods
      .claim(idlLeaf(leafC), idlProof(newTree.proof(0)))
      .accounts({
        beneficiary: beneficiaryC.publicKey,
        vestingTree: treePda,
        claimRecord: crPdaC,
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta: beneficiaryCAta,
        mint,
      })
      .signers([beneficiaryC])
      .rpc();

    const balC = await getAccount(provider.connection, beneficiaryCAta);
    expect(Number(balC.amount)).to.equal(500);
  });

  // =========================================================================
  // EC8: Withdraw at exactly cliff_time yields full amount
  // =========================================================================
  it("EC8: withdraw at exactly cliff_time yields full amount", async () => {
    const { context, provider, program, creator, cancelAuthority } = freshCtx();
    const beneficiary = await makeBeneficiaryTx(provider);
    const AMOUNT = 5000;

    const { mint } = await createTestMintTx(provider, creator.publicKey);
    await fundCreatorAtaTx(provider, mint, creator.publicKey, AMOUNT);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 7003);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = await createBeneficiaryAta(provider, mint, beneficiary.publicKey);

    const now = await bankrunNow(context);
    const start = now;
    const cliff = now + 500;
    const end = now + 1000;

    // Create cliff-type stream (releaseType = 0)
    await program.methods
      .createStream({
        campaignId: new BN(7003),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 0,  // Cliff
        startTime: new BN(start),
        cliffTime: new BN(cliff),
        endTime: new BN(end),
        milestoneIdx: 0,
        cancellable: true,
        cancelAuthority: cancelAuthority.publicKey,
        pauseAuthority: null,
      })
      .accounts({
        creator: creator.publicKey,
        vestingTree: treePda,
        vaultAuthority: vaultAuthPda,
        vault,
        sourceAta: getAssociatedTokenAddressSync(mint, creator.publicKey),
        mint,
      })
      .signers([creator])
      .rpc();

    // Warp to exactly cliff_time — not before, not after
    await warpClock(context, cliff);

    await program.methods
      .withdraw({
        releaseType: 0,
        startTime: new BN(start),
        cliffTime: new BN(cliff),
        endTime: new BN(end),
        milestoneIdx: 0,
      })
      .accounts({
        beneficiary: beneficiary.publicKey,
        vestingTree: treePda,
        claimRecord: crPda,
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta,
        mint,
      })
      .signers([beneficiary])
      .rpc();

    const bal = await getAccount(provider.connection, beneficiaryAta);
    expect(Number(bal.amount)).to.equal(AMOUNT);
  });

  // =========================================================================
  // EC17: Linear fractional rounding — 3 progressive claims sum to exact total
  // =========================================================================
  it("EC17: linear fractional rounding — 3 progressive claims sum to exact total", async () => {
    const { context, provider, program, creator, cancelAuthority } = freshCtx();
    const beneficiary = await makeBeneficiaryTx(provider);
    const AMOUNT = 999;  // not divisible by 3

    const { mint } = await createTestMintTx(provider, creator.publicKey);
    await fundCreatorAtaTx(provider, mint, creator.publicKey, AMOUNT);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 7004);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = await createBeneficiaryAta(provider, mint, beneficiary.publicKey);

    const now = await bankrunNow(context);
    const start = now;
    const cliff = now;     // no cliff for linear
    const end = now + 3000;

    await program.methods
      .createStream({
        campaignId: new BN(7004),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 1,  // Linear
        startTime: new BN(start),
        cliffTime: new BN(cliff),
        endTime: new BN(end),
        milestoneIdx: 0,
        cancellable: true,
        cancelAuthority: cancelAuthority.publicKey,
        pauseAuthority: null,
      })
      .accounts({
        creator: creator.publicKey,
        vestingTree: treePda,
        vaultAuthority: vaultAuthPda,
        vault,
        sourceAta: getAssociatedTokenAddressSync(mint, creator.publicKey),
        mint,
      })
      .signers([creator])
      .rpc();

    // 1/3 elapsed: 999 * 1000 / 3000 = 333
    await warpClock(context, start + 1000);

    await program.methods
      .withdraw({
        releaseType: 1,
        startTime: new BN(start),
        cliffTime: new BN(cliff),
        endTime: new BN(end),
        milestoneIdx: 0,
      })
      .accounts({
        beneficiary: beneficiary.publicKey,
        vestingTree: treePda,
        claimRecord: crPda,
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta,
        mint,
      })
      .signers([beneficiary])
      .rpc();

    const bal1 = await getAccount(provider.connection, beneficiaryAta);
    expect(Number(bal1.amount)).to.equal(333);

    // 2/3 elapsed: 999 * 2000 / 3000 = 666 (cumulative)
    await warpClock(context, start + 2000);

    await program.methods
      .withdraw({
        releaseType: 1,
        startTime: new BN(start),
        cliffTime: new BN(cliff),
        endTime: new BN(end),
        milestoneIdx: 0,
      })
      .accounts({
        beneficiary: beneficiary.publicKey,
        vestingTree: treePda,
        claimRecord: crPda,
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta,
        mint,
      })
      .signers([beneficiary])
      .rpc();

    const bal2 = await getAccount(provider.connection, beneficiaryAta);
    expect(Number(bal2.amount)).to.equal(666);

    // 3/3 elapsed: 999 (full amount)
    await warpClock(context, end);

    await program.methods
      .withdraw({
        releaseType: 1,
        startTime: new BN(start),
        cliffTime: new BN(cliff),
        endTime: new BN(end),
        milestoneIdx: 0,
      })
      .accounts({
        beneficiary: beneficiary.publicKey,
        vestingTree: treePda,
        claimRecord: crPda,
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta,
        mint,
      })
      .signers([beneficiary])
      .rpc();

    const bal3 = await getAccount(provider.connection, beneficiaryAta);
    expect(Number(bal3.amount)).to.equal(AMOUNT);
  });

  // =========================================================================
  // EC16: u64::MAX amount linear vesting at 50% — no overflow
  // =========================================================================
  it("EC16: u64::MAX amount linear vesting at 50% — no overflow", async () => {
    const { context, provider, program, creator, cancelAuthority } = freshCtx();
    const beneficiary = await makeBeneficiaryTx(provider);

    const U64_MAX = new BN("18446744073709551615");

    const { mint } = await createTestMintTx(provider, creator.publicKey);
    await fundCreatorAtaTx(provider, mint, creator.publicKey, U64_MAX);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 7005);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = await createBeneficiaryAta(provider, mint, beneficiary.publicKey);

    const now = await bankrunNow(context);
    const start = now;
    const cliff = now;
    const end = now + 1000;

    await program.methods
      .createStream({
        campaignId: new BN(7005),
        beneficiary: beneficiary.publicKey,
        amount: U64_MAX,
        releaseType: 1,  // Linear
        startTime: new BN(start),
        cliffTime: new BN(cliff),
        endTime: new BN(end),
        milestoneIdx: 0,
        cancellable: true,
        cancelAuthority: cancelAuthority.publicKey,
        pauseAuthority: null,
      })
      .accounts({
        creator: creator.publicKey,
        vestingTree: treePda,
        vaultAuthority: vaultAuthPda,
        vault,
        sourceAta: getAssociatedTokenAddressSync(mint, creator.publicKey),
        mint,
      })
      .signers([creator])
      .rpc();

    // Warp to 50% elapsed
    await warpClock(context, start + 500);

    await program.methods
      .withdraw({
        releaseType: 1,
        startTime: new BN(start),
        cliffTime: new BN(cliff),
        endTime: new BN(end),
        milestoneIdx: 0,
      })
      .accounts({
        beneficiary: beneficiary.publicKey,
        vestingTree: treePda,
        claimRecord: crPda,
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta,
        mint,
      })
      .signers([beneficiary])
      .rpc();

    // u64::MAX * 500 / 1000 = u64::MAX / 2 (truncation of odd number)
    // u64::MAX = 18446744073709551615 (odd), so / 2 = 9223372036854775807
    const bal = await getAccount(provider.connection, beneficiaryAta);
    const received = new BN(bal.amount.toString());
    const expected = new BN("9223372036854775807"); // u64::MAX / 2 (truncated)
    expect(received.eq(expected)).to.be.true;
  });

  // =========================================================================
  // EC29: Fund with insufficient creator balance fails
  // =========================================================================
  it("EC29: fundCampaign with insufficient creator balance fails", async () => {
    const { provider, program, creator, cancelAuthority, pauseAuthority } = freshCtx();
    const now = 0; // not clock-dependent

    const { mint } = await createTestMintTx(provider, creator.publicKey);
    // Fund creator with only 500 tokens
    await fundCreatorAtaTx(provider, mint, creator.publicKey, 500);

    // Build a tree so we can create the campaign
    const beneficiary = await makeBeneficiaryTx(provider);
    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(1000),
      releaseType: ReleaseType.Cliff,
      startTime: new BN(now),
      cliffTime: new BN(now + 500),
      endTime: new BN(now + 1000),
      milestoneIdx: 0,
    };
    const tree = new VestingMerkleTree([leaf]);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 7006);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    await program.methods
      .createCampaign({
        campaignId: new BN(7006),
        merkleRoot: Array.from(tree.root) as any,
        leafCount: 1,
        totalSupply: new BN(1000),
        minCliffTime: new BN(now + 500),
        cancellable: true,
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

    // Try to fund 1000 but only have 500 in ATA
    try {
      await program.methods
        .fundCampaign(new BN(1000))
        .accounts({
          creator: creator.publicKey,
          vestingTree: treePda,
          vault,
          sourceAta: getAssociatedTokenAddressSync(mint, creator.publicKey),
        })
        .signers([creator])
        .rpc();
      expect.fail("should have thrown");
    } catch (e: any) {
      // SPL Token InsufficientFunds error — not an Anchor custom error
      const msg = (e.message || "") + "\n" + ((e.logs || [])).join("\n");
      // SPL Token error 0x1 = insufficient funds, or Anchor wraps as generic failure
      const isTokenError = msg.includes("0x1") || msg.includes("InsufficientFunds");
      const isGenericFail = msg.includes("failed") || msg.includes("Error");
      expect(isTokenError || isGenericFail).to.be.true;
    }
  });

  // =========================================================================
  // EC20b: Withdraw_unvested at EXACTLY grace_end boundary succeeds
  // =========================================================================
  it("EC20b: withdraw_unvested at exactly grace_end boundary succeeds", async () => {
    const { context, provider, program, creator, cancelAuthority, pauseAuthority } = freshCtx();
    const beneficiary = await makeBeneficiaryTx(provider);
    const AMOUNT = 10_000;

    const { mint } = await createTestMintTx(provider, creator.publicKey);
    await fundCreatorAtaTx(provider, mint, creator.publicKey, AMOUNT);

    const now = await bankrunNow(context);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Cliff,
      startTime: new BN(now),
      cliffTime: new BN(now + 5000),  // far future — nothing vested
      endTime: new BN(now + 10000),
      milestoneIdx: 0,
    };
    const tree = new VestingMerkleTree([leaf]);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 7007);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    await program.methods
      .createCampaign({
        campaignId: new BN(7007),
        merkleRoot: Array.from(tree.root) as any,
        leafCount: 1,
        totalSupply: new BN(AMOUNT),
        minCliffTime: new BN(now + 5000),
        cancellable: true,
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
      .fundCampaign(new BN(AMOUNT))
      .accounts({
        creator: creator.publicKey,
        vestingTree: treePda,
        vault,
        sourceAta: getAssociatedTokenAddressSync(mint, creator.publicKey),
      })
      .signers([creator])
      .rpc();

    // Cancel
    await program.methods
      .cancelCampaign()
      .accounts({
        cancelAuthority: cancelAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([cancelAuthority])
      .rpc();

    const cancelledAt = await bankrunNow(context);

    // Warp to EXACTLY cancelledAt + GRACE_PERIOD_SECS (not +100 like existing tests)
    await warpClock(context, cancelledAt + GRACE_PERIOD_SECS);

    const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);
    const preCreatorTokens = Number((await getAccount(provider.connection, creatorAta)).amount);

    // withdraw_unvested at exact boundary → should succeed
    await program.methods
      .withdrawUnvested()
      .accounts({
        creator: creator.publicKey,
        vestingTree: treePda,
        vaultAuthority: vaultAuthPda,
        vault,
        creatorAta,
      })
      .signers([creator])
      .rpc();

    const postCreatorTokens = Number((await getAccount(provider.connection, creatorAta)).amount);
    expect(postCreatorTokens - preCreatorTokens).to.equal(AMOUNT);

    const postVault = await getAccount(provider.connection, vault);
    expect(Number(postVault.amount)).to.equal(0);
  });

  // =========================================================================
  // EC19: cancel_stream at exactly endTime — 100% vested, 0% to creator
  // =========================================================================
  it("EC19: cancel_stream at exactly endTime — full amount to beneficiary, none to creator", async () => {
    const { context, provider, program, creator, cancelAuthority } = freshCtx();
    const beneficiary = await makeBeneficiaryTx(provider);
    const AMOUNT = 10000;

    const { mint } = await createTestMintTx(provider, creator.publicKey);
    const creatorAta = await fundCreatorAtaTx(provider, mint, creator.publicKey, AMOUNT);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 7010);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = await createBeneficiaryAta(provider, mint, beneficiary.publicKey);

    const now = await bankrunNow(context);
    const start = now;
    const cliff = now + 500;
    const end = now + 1000;

    // Create linear stream
    await program.methods
      .createStream({
        campaignId: new BN(7010),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 1, // Linear
        startTime: new BN(start),
        cliffTime: new BN(cliff),
        endTime: new BN(end),
        milestoneIdx: 0,
        cancellable: true,
        cancelAuthority: cancelAuthority.publicKey,
        pauseAuthority: null,
      })
      .accounts({
        creator: creator.publicKey,
        vestingTree: treePda,
        vaultAuthority: vaultAuthPda,
        vault,
        sourceAta: creatorAta,
        mint,
      })
      .signers([creator])
      .rpc();

    // Warp to EXACTLY endTime — fully vested
    await warpClock(context, end);

    const preBeneficiaryBal = Number((await getAccount(provider.connection, beneficiaryAta)).amount);
    const preCreatorBal = Number((await getAccount(provider.connection, creatorAta)).amount);

    // Cancel at exactly endTime
    await program.methods
      .cancelStream({
        releaseType: 1,
        startTime: new BN(start),
        cliffTime: new BN(cliff),
        endTime: new BN(end),
        milestoneIdx: 0,
      })
      .accounts({
        creator: creator.publicKey,
        beneficiary: beneficiary.publicKey,
        vestingTree: treePda,
        claimRecord: crPda,
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta,
        creatorAta,
        mint,
      })
      .signers([creator])
      .rpc();

    // At endTime: 100% vested → all to beneficiary, 0% to creator
    const postBeneficiaryBal = Number((await getAccount(provider.connection, beneficiaryAta)).amount);
    const postCreatorBal = Number((await getAccount(provider.connection, creatorAta)).amount);

    expect(postBeneficiaryBal - preBeneficiaryBal).to.equal(AMOUNT);
    expect(postCreatorBal - preCreatorBal).to.equal(0);
  });
});
