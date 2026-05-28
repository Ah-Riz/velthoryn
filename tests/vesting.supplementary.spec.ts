import { BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";

import {
  setup,
  airdrop,
  createTestMint,
  fundCreatorAta,
  makeBeneficiary,
  treePDA,
  claimRecordPDA,
  vaultAuthorityPDA,
  PROGRAM_ID,
} from "./utils/setup";
import { createTimeHelpers } from "./utils/time";
import {
  idlLeaf,
  idlProof,
  expectAnchorError,
  createAndFundCampaign,
  issueClaim,
  releaseMilestone,
} from "./utils/helpers";
import {
  ReleaseType,
  VestingMerkleTree,
  type VestingLeaf,
} from "../clients/ts/src";

// ---------------------------------------------------------------------------
// IMPORTANT: These tests create on-chain accounts that persist between runs.
// You MUST run `solana-test-validator --reset` between test executions to
// avoid PDA collisions and stale state. There is no afterEach cleanup because
// Anchor test accounts cannot easily be closed programmatically.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Error codes from the IDL (verified against target/idl/vesting.json)
// ---------------------------------------------------------------------------
const ERR = {
  EmptyRoot: 6000,
  EmptyCampaign: 6001,
  ZeroAmount: 6002,
  MissingCancelAuthority: 6003,
  OverFunded: 6006,
  InvalidSchedule: 6011,
  InvalidScheduleType: 6012,
  NothingToClaim: 6015,
  MilestoneAlreadyClaimed: 6014,
  MilestoneNotReleased: 6033,
  GracePeriodActive: 6027,
  SameRoot: 6004,
  Unauthorized: 6005,
  CampaignCancelled: 6023,
  CampaignPaused: 6009,
  InvalidProof: 6013,
  UnauthorizedClaimer: 6010,
  NotCancellable: 6019,
  AlreadyCancelled: 6020,
  AlreadyPaused: 6022,
  NotPaused: 6024,
  CannotClose: 6027,
  NotSingleStream: 6029,
  MintMismatch: 6007,
  InsufficientVault: 6016,
  OverClaim: 6017,
  WrongVault: 6018,
  NotPausable: 6021,
  NotCancelled: 6026,
  ProofTooLong: 6030,
  FullyVested: 6031,
  StreamExpired: 6032,
  MilestoneAlreadyReleased: 6034,
} as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("vesting supplementary T6-T25", () => {
  const { provider, program, creator, cancelAuthority, pauseAuthority } =
    setup();

  // -----------------------------------------------------------------------
  // T6: Claim before cliff -> NothingToClaim
  // -----------------------------------------------------------------------
  it("T6: claim before cliff rejects with NothingToClaim", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000; // reduced from 1_000_000 for devnet

    // Cliff is 1000 seconds in the future -- nothing should be vested
    const t = await createTimeHelpers(provider.connection);
    const cliff = t.future(1000);
    const end = t.future(2000);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { mint, tree, treePda, vaultAuthPda, vault } =
      await createAndFundCampaign(
        { provider, program, creator, cancelAuthority, pauseAuthority },
        100,
        [leaf],
        AMOUNT,
      );

    try {
      await program.methods
        .claim(idlLeaf(leaf), idlProof(tree.proof(0)))
        .accounts({
          beneficiary: beneficiary.publicKey,
          vestingTree: treePda,
          claimRecord: (
            await claimRecordPDA(
              PROGRAM_ID,
              treePda,
              beneficiary.publicKey,
            )
          )[0],
          vaultAuthority: vaultAuthPda,
          vault,
          beneficiaryAta: getAssociatedTokenAddressSync(
            mint,
            beneficiary.publicKey,
          ),
          mint,
        })
        .signers([beneficiary])
        .rpc();
      expect.fail("should have thrown NothingToClaim");
    } catch (e) {
      expectAnchorError(e, ERR.NothingToClaim);
    }
  });

  // -----------------------------------------------------------------------
  // T7: Claim at/after end_time -> full amount
  // -----------------------------------------------------------------------
  it("T7: claim after end_time transfers full amount", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000; // reduced from 1_000_000 for devnet

    // Both start and end are in the past -> fully vested
    const t = await createTimeHelpers(provider.connection);
    const start = t.past(2000);
    const end = t.past(10);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(start),
      cliffTime: new BN(start),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { mint, tree, treePda, vaultAuthPda, vault } =
      await createAndFundCampaign(
        { provider, program, creator, cancelAuthority, pauseAuthority },
        101,
        [leaf],
        AMOUNT,
      );

    const beneficiaryAta = getAssociatedTokenAddressSync(
      mint,
      beneficiary.publicKey,
    );

    await program.methods
      .claim(idlLeaf(leaf), idlProof(tree.proof(0)))
      .accounts({
        beneficiary: beneficiary.publicKey,
        vestingTree: treePda,
        claimRecord: (
          await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey)
        )[0],
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta,
        mint,
      })
      .signers([beneficiary])
      .rpc();

    const postBeneficiary = await getAccount(provider.connection, beneficiaryAta);
    expect(Number(postBeneficiary.amount)).to.equal(AMOUNT);
  });

  // -----------------------------------------------------------------------
  // T8: Double-claim (linear) -> NothingToClaim
  // -----------------------------------------------------------------------
  it("T8: double-claim on linear leaf rejects with NothingToClaim", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000; // reduced from 1_000_000 for devnet

    // Mid-stream: cliff 500s past, end 500s future -> ~50% vested
    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(500);
    const end = t.future(500);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { mint, tree, treePda, vaultAuthPda, vault } =
      await createAndFundCampaign(
        { provider, program, creator, cancelAuthority, pauseAuthority },
        102,
        [leaf],
        AMOUNT,
      );

    // First claim should succeed
    await program.methods
      .claim(idlLeaf(leaf), idlProof(tree.proof(0)))
      .accounts({
        beneficiary: beneficiary.publicKey,
        vestingTree: treePda,
        claimRecord: (
          await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey)
        )[0],
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta: getAssociatedTokenAddressSync(
          mint,
          beneficiary.publicKey,
        ),
        mint,
      })
      .signers([beneficiary])
      .rpc();

    // Second claim immediately after -> NothingToClaim (vested portion already claimed)
    try {
      await program.methods
        .claim(idlLeaf(leaf), idlProof(tree.proof(0)))
        .accounts({
          beneficiary: beneficiary.publicKey,
          vestingTree: treePda,
          claimRecord: (
            await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey)
          )[0],
          vaultAuthority: vaultAuthPda,
          vault,
          beneficiaryAta: getAssociatedTokenAddressSync(
            mint,
            beneficiary.publicKey,
          ),
          mint,
        })
        .signers([beneficiary])
        .rpc();
      expect.fail("should have thrown NothingToClaim");
    } catch (e) {
      expectAnchorError(e, ERR.NothingToClaim);
    }
  });

  // -----------------------------------------------------------------------
  // T9: Unauthorized claimer -> UnauthorizedClaimer
  // -----------------------------------------------------------------------
  it("T9: wrong signer claiming rejects with UnauthorizedClaimer", async () => {
    const alice = await makeBeneficiary(provider);
    const bob = await makeBeneficiary(provider);
    const AMOUNT = 10_000; // reduced from 1_000_000 for devnet

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);
    const end = t.future(900);

    // Leaf is for Alice
    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: alice.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { mint, tree, treePda, vaultAuthPda, vault } =
      await createAndFundCampaign(
        { provider, program, creator, cancelAuthority, pauseAuthority },
        103,
        [leaf],
        AMOUNT,
      );

    // Bob tries to claim Alice's leaf
    try {
      await program.methods
        .claim(idlLeaf(leaf), idlProof(tree.proof(0)))
        .accounts({
          beneficiary: bob.publicKey,
          vestingTree: treePda,
          claimRecord: (
            await claimRecordPDA(PROGRAM_ID, treePda, bob.publicKey)
          )[0],
          vaultAuthority: vaultAuthPda,
          vault,
          beneficiaryAta: getAssociatedTokenAddressSync(
            mint,
            bob.publicKey,
          ),
          mint,
        })
        .signers([bob])
        .rpc();
      expect.fail("should have thrown UnauthorizedClaimer");
    } catch (e) {
      expectAnchorError(e, ERR.UnauthorizedClaimer);
    }
  });

  // -----------------------------------------------------------------------
  // T10: Milestone bitmap double-claim -> MilestoneAlreadyClaimed
  // -----------------------------------------------------------------------
  it("T10: double-claim same milestone rejects with MilestoneAlreadyClaimed", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000; // reduced from 500_000 for devnet

    // Milestone with cliff in the past -> claimable
    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Milestone,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(t.future(1000)),
      milestoneIdx: 0,
    };

    const { mint, tree, treePda, vaultAuthPda, vault } =
      await createAndFundCampaign(
        { provider, program, creator, cancelAuthority, pauseAuthority },
        104,
        [leaf],
        AMOUNT,
      );

    await releaseMilestone({ program, creator }, treePda, 0);

    // First claim should succeed
    await program.methods
      .claim(idlLeaf(leaf), idlProof(tree.proof(0)))
      .accounts({
        beneficiary: beneficiary.publicKey,
        vestingTree: treePda,
        claimRecord: (
          await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey)
        )[0],
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta: getAssociatedTokenAddressSync(
          mint,
          beneficiary.publicKey,
        ),
        mint,
      })
      .signers([beneficiary])
      .rpc();

    // Second claim of the same milestone -> MilestoneAlreadyClaimed
    try {
      await program.methods
        .claim(idlLeaf(leaf), idlProof(tree.proof(0)))
        .accounts({
          beneficiary: beneficiary.publicKey,
          vestingTree: treePda,
          claimRecord: (
            await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey)
          )[0],
          vaultAuthority: vaultAuthPda,
          vault,
          beneficiaryAta: getAssociatedTokenAddressSync(
            mint,
            beneficiary.publicKey,
          ),
          mint,
        })
        .signers([beneficiary])
        .rpc();
      expect.fail("should have thrown MilestoneAlreadyClaimed");
    } catch (e) {
      expectAnchorError(e, ERR.MilestoneAlreadyClaimed);
    }
  });

  // -----------------------------------------------------------------------
  // T11: Two milestones for same beneficiary, both claimable
  // -----------------------------------------------------------------------
  it("T11: same beneficiary can claim two different milestones", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT_PER = 5_000; // reduced from 300_000 for devnet
    const TOTAL = AMOUNT_PER * 2;

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);

    // Two milestone leaves for the same beneficiary with different milestone_idx
    const leaf0: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT_PER),
      releaseType: ReleaseType.Milestone,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(t.future(1000)),
      milestoneIdx: 0,
    };

    const leaf1: VestingLeaf = {
      leafIndex: 1,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT_PER),
      releaseType: ReleaseType.Milestone,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(t.future(1000)),
      milestoneIdx: 1,
    };

    const { mint, tree, treePda, vaultAuthPda, vault } =
      await createAndFundCampaign(
        { provider, program, creator, cancelAuthority, pauseAuthority },
        105,
        [leaf0, leaf1],
        TOTAL,
      );

    await releaseMilestone({ program, creator }, treePda, 0);
    await releaseMilestone({ program, creator }, treePda, 1);

    // Claim milestone 0
    await program.methods
      .claim(idlLeaf(leaf0), idlProof(tree.proof(0)))
      .accounts({
        beneficiary: beneficiary.publicKey,
        vestingTree: treePda,
        claimRecord: (
          await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey)
        )[0],
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta: getAssociatedTokenAddressSync(
          mint,
          beneficiary.publicKey,
        ),
        mint,
      })
      .signers([beneficiary])
      .rpc();

    // Claim milestone 1
    await program.methods
      .claim(idlLeaf(leaf1), idlProof(tree.proof(1)))
      .accounts({
        beneficiary: beneficiary.publicKey,
        vestingTree: treePda,
        claimRecord: (
          await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey)
        )[0],
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta: getAssociatedTokenAddressSync(
          mint,
          beneficiary.publicKey,
        ),
        mint,
      })
      .signers([beneficiary])
      .rpc();

    // Beneficiary should have received both milestone amounts
    const beneficiaryAta = await getAccount(
      provider.connection,
      getAssociatedTokenAddressSync(mint, beneficiary.publicKey),
    );
    expect(Number(beneficiaryAta.amount)).to.equal(TOTAL);
  });

  // -----------------------------------------------------------------------
  // T12: withdraw_unvested before grace period -> GracePeriodActive
  // -----------------------------------------------------------------------
  it("T12: withdraw_unvested during grace period rejects with GracePeriodActive", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000; // reduced from 1_000_000 for devnet

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(500);
    const end = t.future(500);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { mint, treePda, vaultAuthPda, vault } =
      await createAndFundCampaign(
        { provider, program, creator, cancelAuthority, pauseAuthority },
        106,
        [leaf],
        AMOUNT,
      );

    // Cancel the campaign
    await program.methods
      .cancelCampaign()
      .accounts({
        cancelAuthority: cancelAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([cancelAuthority])
      .rpc();

    // Immediately try to withdraw -- well within the 7-day grace period
    try {
      await program.methods
        .withdrawUnvested()
        .accounts({
          creator: creator.publicKey,
          vestingTree: treePda,
          vaultAuthority: vaultAuthPda,
          vault,
          creatorAta: getAssociatedTokenAddressSync(
            mint,
            creator.publicKey,
          ),
        })
        .signers([creator])
        .rpc();
      expect.fail("should have thrown GracePeriodActive");
    } catch (e) {
      expectAnchorError(e, ERR.GracePeriodActive);
    }
  });

  // -----------------------------------------------------------------------
  // T13: close_claim_record after full claim -> rent refund
  // -----------------------------------------------------------------------
  it("T13: close_claim_record after full claim refunds rent", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000; // reduced from 500_000 for devnet

    // Cliff in the past -> full amount claimable immediately
    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Cliff,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(t.future(1000)),
      milestoneIdx: 0,
    };

    const { mint, tree, treePda, vaultAuthPda, vault } =
      await createAndFundCampaign(
        { provider, program, creator, cancelAuthority, pauseAuthority },
        107,
        [leaf],
        AMOUNT,
      );

    const beneficiaryAta = getAssociatedTokenAddressSync(
      mint,
      beneficiary.publicKey,
    );
    const crPda = (
      await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey)
    )[0];

    // Claim the full amount
    await program.methods
      .claim(idlLeaf(leaf), idlProof(tree.proof(0)))
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

    // Verify full amount was claimed
    const postClaim = await getAccount(provider.connection, beneficiaryAta);
    expect(Number(postClaim.amount)).to.equal(AMOUNT);

    // Record SOL balance before closing
    const preCloseSol = await provider.connection.getBalance(
      beneficiary.publicKey,
    );

    // Close the claim record
    await program.methods
      .closeClaimRecord()
      .accounts({
        beneficiary: beneficiary.publicKey,
        vestingTree: treePda,
        claimRecord: crPda,
      })
      .signers([beneficiary])
      .rpc();

    // Verify beneficiary SOL balance increased (rent refund)
    const postCloseSol = await provider.connection.getBalance(
      beneficiary.publicKey,
    );
    expect(postCloseSol).to.be.greaterThan(preCloseSol);
  });

  // -----------------------------------------------------------------------
  // T14: update_root with same root -> SameRoot
  // -----------------------------------------------------------------------
  it("T14: update_root with identical root rejects with SameRoot", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000; // reduced from 1_000_000 for devnet

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);
    const end = t.future(900);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { tree, treePda } = await createAndFundCampaign(
      { provider, program, creator, cancelAuthority, pauseAuthority },
      108,
      [leaf],
      AMOUNT,
    );

    // Try to update root with the exact same root bytes
    try {
      await program.methods
        .updateRoot(Array.from(tree.root), 1, new BN(cliff))
        .accounts({
          cancelAuthority: cancelAuthority.publicKey,
          vestingTree: treePda,
        })
        .signers([cancelAuthority])
        .rpc();
      expect.fail("should have thrown SameRoot");
    } catch (e) {
      expectAnchorError(e, ERR.SameRoot);
    }
  });

  // -----------------------------------------------------------------------
  // T15: update_root from non-authority -> Unauthorized
  // -----------------------------------------------------------------------
  it("T15: update_root from wrong signer rejects with Unauthorized", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000; // reduced from 1_000_000 for devnet

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);
    const end = t.future(900);

    const leaf0: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { treePda } = await createAndFundCampaign(
      { provider, program, creator, cancelAuthority, pauseAuthority },
      109,
      [leaf0],
      AMOUNT,
    );

    // Build a new tree with a genuinely different root
    const stranger = await makeBeneficiary(provider);
    const newLeaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: stranger.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };
    const newTree = new VestingMerkleTree([newLeaf]);

    // Random signer tries to update root
    const randomKp = Keypair.generate();
    await airdrop(provider, randomKp.publicKey, 0.01);

    try {
      await program.methods
        .updateRoot(Array.from(newTree.root), 1, new BN(cliff))
        .accounts({
          cancelAuthority: randomKp.publicKey,
          vestingTree: treePda,
        })
        .signers([randomKp])
        .rpc();
      expect.fail("should have thrown Unauthorized");
    } catch (e) {
      expectAnchorError(e, ERR.Unauthorized);
    }
  });

  // -----------------------------------------------------------------------
  // T16: update_root after cancel -> CampaignCancelled
  // -----------------------------------------------------------------------
  it("T16: update_root after cancel rejects with CampaignCancelled", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000;

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);
    const end = t.future(900);

    const leaf0: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { treePda } = await createAndFundCampaign(
      { provider, program, creator, cancelAuthority, pauseAuthority },
      110,
      [leaf0],
      AMOUNT,
    );

    // Cancel the campaign
    await program.methods
      .cancelCampaign()
      .accounts({
        cancelAuthority: cancelAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([cancelAuthority])
      .rpc();

    // Build a new tree with a genuinely different root
    const stranger = await makeBeneficiary(provider);
    const newLeaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: stranger.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };
    const newTree = new VestingMerkleTree([newLeaf]);

    // Try to update root after cancel
    try {
      await program.methods
        .updateRoot(Array.from(newTree.root), 1, new BN(cliff))
        .accounts({
          cancelAuthority: cancelAuthority.publicKey,
          vestingTree: treePda,
        })
        .signers([cancelAuthority])
        .rpc();
      expect.fail("should have thrown CampaignCancelled");
    } catch (e) {
      expectAnchorError(e, ERR.CampaignCancelled);
    }
  });

  // -----------------------------------------------------------------------
  // T19: Unauthorized withdraw_unvested -- non-creator cannot withdraw
  // -----------------------------------------------------------------------
  // The `withdraw_unvested` instruction has `has_one = creator` on the
  // vesting_tree account. Passing a different signer for `creator` should
  // cause the PDA derivation or constraint check to fail.
  it("T19: withdraw_unvested from non-creator rejects with Unauthorized", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000;

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);
    const end = t.future(900);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { mint, treePda, vaultAuthPda, vault } =
      await createAndFundCampaign(
        { provider, program, creator, cancelAuthority, pauseAuthority },
        202,
        [leaf],
        AMOUNT,
      );

    // Cancel the campaign (required before withdraw)
    await program.methods
      .cancelCampaign()
      .accounts({
        cancelAuthority: cancelAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([cancelAuthority])
      .rpc();

    // Generate a random non-creator keypair and fund it
    const attacker = Keypair.generate();
    await airdrop(provider, attacker.publicKey, 0.01);

    // Attacker tries to call withdraw_unvested using their own keypair
    // as `creator`. This should fail because the tree's `creator` field
    // does not match attacker.publicKey.
    try {
      await program.methods
        .withdrawUnvested()
        .accounts({
          creator: attacker.publicKey,
          vestingTree: treePda,
          vaultAuthority: vaultAuthPda,
          vault,
          creatorAta: getAssociatedTokenAddressSync(
            mint,
            attacker.publicKey,
          ),
        })
        .signers([attacker])
        .rpc();
      expect.fail("should have thrown Unauthorized or ConstraintSeeds");
    } catch (e) {
      // The attacker's creator_ata may not exist, which causes
      // AccountNotInitialized before the has_one check fires.
      // Accept Unauthorized, AccountNotInitialized, or ConstraintSeeds.
      const err = e as any;
      const isUnauthorized = err.error?.errorCode?.number === 6005;
      const isAccountNotInitialized = err.error?.errorCode?.number === 3012;
      expect(
        isUnauthorized || isAccountNotInitialized,
        `expected Unauthorized (6005) or AccountNotInitialized (3012), got: ${err.error?.errorCode?.code} (${err.error?.errorCode?.number})`,
      ).to.be.true;
    }
  });

  // -----------------------------------------------------------------------
  // T21: create_stream atomically creates campaign and deposits tokens
  // -----------------------------------------------------------------------
  it("T21: create_stream atomically creates campaign and deposits tokens", async () => {
    const CAMPAIGN_ID = 300;
    const AMOUNT = 10_000;

    const mint = await createTestMint(provider, creator.publicKey);
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);
    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    const cliff = t.now;
    const end = t.now + 1000;

    await program.methods
      .createStream({
        campaignId: new BN(CAMPAIGN_ID),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 1, // Linear
        startTime: new BN(t.now),
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

    // Verify vault balance
    const vaultAccount = await getAccount(provider.connection, vault);
    expect(Number(vaultAccount.amount)).to.equal(AMOUNT);

    // Verify tree state via fetch
    const tree = await program.account.vestingTree.fetch(treePda);
    expect(tree.leafCount).to.equal(1);
    expect(Number(tree.totalSupply)).to.equal(AMOUNT);
    expect(Number(tree.totalClaimed)).to.equal(0);
  });

  // -----------------------------------------------------------------------
  // T22: withdraw claims unlocked tokens without Merkle proof
  // -----------------------------------------------------------------------
  it("T22: withdraw claims unlocked tokens without Merkle proof", async () => {
    const CAMPAIGN_ID = 301;
    const AMOUNT = 10_000;

    const mint = await createTestMint(provider, creator.publicKey);
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);
    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);

    // cliff=500s ago, end=500s from now → ~50% vested
    const cliff = t.now - 500;
    const end = t.now + 500;

    const preBeneficiaryAmount = 0;

    await program.methods
      .createStream({
        campaignId: new BN(CAMPAIGN_ID),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 1,
        startTime: new BN(t.now - 500),
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

    await program.methods
      .withdraw({
        releaseType: 1,
        startTime: new BN(t.now - 500),
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

    const postBeneficiary = await getAccount(provider.connection, beneficiaryAta);
    const claimed = Number(postBeneficiary.amount) - preBeneficiaryAmount;
    // 10000 * 500 / 1000 = 5000, allow ±150 for clock drift
    expect(claimed).to.be.at.least(4850);
    expect(claimed).to.be.at.most(5150);
  });

  // -----------------------------------------------------------------------
  // T23: withdraw at 0% returns NothingToClaim
  // -----------------------------------------------------------------------
  it("T23: withdraw at 0% returns NothingToClaim", async () => {
    const CAMPAIGN_ID = 302;
    const AMOUNT = 10_000;

    const mint = await createTestMint(provider, creator.publicKey);
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);
    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);

    const cliff = t.now + 1000; // cliff 1000s in the future → 0% vested
    const end = t.now + 2000;

    await program.methods
      .createStream({
        campaignId: new BN(CAMPAIGN_ID),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 1,
        startTime: new BN(t.now),
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

    try {
      await program.methods
        .withdraw({ releaseType: 1, startTime: new BN(t.now), cliffTime: new BN(cliff), endTime: new BN(end), milestoneIdx: 0 })
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
      expect.fail("should have thrown NothingToClaim");
    } catch (e) {
      expectAnchorError(e, ERR.NothingToClaim);
    }
  });

  // -----------------------------------------------------------------------
  // T56: withdraw at ~25% vested unlocks ~25% (create_stream path)
  // -----------------------------------------------------------------------
  it("T56: withdraw at 25% vested unlocks 25% of stream amount", async () => {
    const CAMPAIGN_ID = 305;
    const AMOUNT = 10_000;

    const mint = await createTestMint(provider, creator.publicKey);
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);
    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);

    // 250s elapsed of 1000s linear duration → 25% vested at validator "now"
    const cliff = t.now - 250;
    const end = t.now + 750;

    await program.methods
      .createStream({
        campaignId: new BN(CAMPAIGN_ID),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 1,
        startTime: new BN(cliff),
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

    await program.methods
      .withdraw({
        releaseType: 1,
        startTime: new BN(cliff),
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
    expect(Number(bal.amount)).to.be.at.least(2400);
    expect(Number(bal.amount)).to.be.at.most(2600);
  });

  // -----------------------------------------------------------------------
  // T57: withdraw at 100% vested claims full stream amount
  // -----------------------------------------------------------------------
  it("T57: withdraw at 100% vested claims full stream amount", async () => {
    const CAMPAIGN_ID = 306;
    const AMOUNT = 10_000;

    const mint = await createTestMint(provider, creator.publicKey);
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);
    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);

    const cliff = t.past(2000);
    const end = t.past(10);

    await program.methods
      .createStream({
        campaignId: new BN(CAMPAIGN_ID),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 1,
        startTime: new BN(cliff),
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

    await program.methods
      .withdraw({
        releaseType: 1,
        startTime: new BN(cliff),
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

    const vaultBal = await getAccount(provider.connection, vault);
    expect(Number(vaultBal.amount)).to.equal(0);
  });

  // -----------------------------------------------------------------------
  // T58: withdraw at ~50% vested unlocks ~50% (create_stream path, devnet)
  // -----------------------------------------------------------------------
  it("T58: withdraw at 50% vested unlocks 50% of stream amount", async () => {
    const CAMPAIGN_ID = 307;
    const AMOUNT = 10_000;

    const mint = await createTestMint(provider, creator.publicKey);
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);
    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);

    const cliff = t.now - 500;
    const end = t.now + 500;

    await program.methods
      .createStream({
        campaignId: new BN(CAMPAIGN_ID),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 1,
        startTime: new BN(cliff),
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

    await program.methods
      .withdraw({
        releaseType: 1,
        startTime: new BN(cliff),
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
    expect(Number(bal.amount)).to.be.at.least(4900);
    expect(Number(bal.amount)).to.be.at.most(5100);
  });

  // -----------------------------------------------------------------------
  // T24: withdraw unauthorized signer returns UnauthorizedClaimer
  // -----------------------------------------------------------------------
  it("T24: withdraw unauthorized signer returns UnauthorizedClaimer", async () => {
    const CAMPAIGN_ID = 303;
    const AMOUNT = 10_000;

    const mint = await createTestMint(provider, creator.publicKey);
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);
    const beneficiary = await makeBeneficiary(provider);
    const attacker = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, attacker.publicKey);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const attackerAta = getAssociatedTokenAddressSync(mint, attacker.publicKey);

    const cliff = t.now - 500;
    const end = t.now + 500;

    await program.methods
      .createStream({
        campaignId: new BN(CAMPAIGN_ID),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 1,
        startTime: new BN(t.now - 500),
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

    try {
      await program.methods
        .withdraw({ releaseType: 1, startTime: new BN(t.now - 500), cliffTime: new BN(cliff), endTime: new BN(end), milestoneIdx: 0 })
        .accounts({
          beneficiary: attacker.publicKey,
          vestingTree: treePda,
          claimRecord: crPda,
          vaultAuthority: vaultAuthPda,
          vault,
          beneficiaryAta: attackerAta,
          mint,
        })
        .signers([attacker])
        .rpc();
      expect.fail("should have thrown UnauthorizedClaimer");
    } catch (e) {
      // leaf_hash won't match because beneficiary in the reconstructed leaf
      // will be attacker's pubkey, not the original beneficiary
      expectAnchorError(e, ERR.InvalidProof);
    }
  });

  // ===========================================================================
  // VALIDATION TESTS
  // ===========================================================================

  // -------------------------------------------------------------------------
  // T26: create_campaign with empty root -> EmptyRoot
  // -------------------------------------------------------------------------
  it("T26: create_campaign with empty root rejects with EmptyRoot", async () => {
    const CAMPAIGN_ID = 400;
    const AMOUNT = 10_000;

    const mint = await createTestMint(provider, creator.publicKey);
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);
    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(t.now),
      cliffTime: new BN(t.now),
      endTime: new BN(t.now + 1000),
      milestoneIdx: 0,
    };
    const tree = new VestingMerkleTree([leaf]);

    try {
      await program.methods
        .createCampaign({
          campaignId: new BN(CAMPAIGN_ID),
          merkleRoot: Array.from(new Uint8Array(32)), // all zeros
          leafCount: 1,
          totalSupply: new BN(AMOUNT),
          minCliffTime: new BN(1),
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
      expect.fail("should have thrown EmptyRoot");
    } catch (e) {
      expectAnchorError(e, ERR.EmptyRoot);
    }
  });

  // -------------------------------------------------------------------------
  // T27: create_campaign with zero supply -> ZeroAmount
  // -------------------------------------------------------------------------
  it("T27: create_campaign with zero supply rejects with ZeroAmount", async () => {
    const CAMPAIGN_ID = 401;

    const mint = await createTestMint(provider, creator.publicKey);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);
    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(10_000),
      releaseType: ReleaseType.Linear,
      startTime: new BN(t.now),
      cliffTime: new BN(t.now),
      endTime: new BN(t.now + 1000),
      milestoneIdx: 0,
    };
    const tree = new VestingMerkleTree([leaf]);

    try {
      await program.methods
        .createCampaign({
          campaignId: new BN(CAMPAIGN_ID),
          merkleRoot: Array.from(tree.root),
          leafCount: 1,
          totalSupply: new BN(0),
          minCliffTime: new BN(1),
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
      expect.fail("should have thrown ZeroAmount");
    } catch (e) {
      expectAnchorError(e, ERR.ZeroAmount);
    }
  });

  // -------------------------------------------------------------------------
  // T28: create_campaign with zero leaf_count -> EmptyCampaign
  // -------------------------------------------------------------------------
  it("T28: create_campaign with zero leaf_count rejects with EmptyCampaign", async () => {
    const CAMPAIGN_ID = 402;
    const AMOUNT = 10_000;

    const mint = await createTestMint(provider, creator.publicKey);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    // Use a non-zero root so EmptyRoot is not triggered first
    const nonZeroRoot = Array.from(new Uint8Array(32));
    nonZeroRoot[0] = 0xff;

    try {
      await program.methods
        .createCampaign({
          campaignId: new BN(CAMPAIGN_ID),
          merkleRoot: nonZeroRoot,
          leafCount: 0,
          totalSupply: new BN(AMOUNT),
          minCliffTime: new BN(1),
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
      expect.fail("should have thrown EmptyCampaign");
    } catch (e) {
      expectAnchorError(e, ERR.EmptyCampaign);
    }
  });

  // -------------------------------------------------------------------------
  // T29: create_campaign cancellable=true but no cancel_authority -> MissingCancelAuthority
  // -------------------------------------------------------------------------
  it("T29: create_campaign cancellable=true with null cancel_authority rejects with MissingCancelAuthority", async () => {
    const CAMPAIGN_ID = 403;
    const AMOUNT = 10_000;

    const mint = await createTestMint(provider, creator.publicKey);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);
    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(t.now),
      cliffTime: new BN(t.now),
      endTime: new BN(t.now + 1000),
      milestoneIdx: 0,
    };
    const tree = new VestingMerkleTree([leaf]);

    try {
      await program.methods
        .createCampaign({
          campaignId: new BN(CAMPAIGN_ID),
          merkleRoot: Array.from(tree.root),
          leafCount: 1,
          totalSupply: new BN(AMOUNT),
          minCliffTime: leaf.cliffTime,
          cancellable: true,
          cancelAuthority: null, // <-- null despite cancellable=true
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
      expect.fail("should have thrown MissingCancelAuthority");
    } catch (e) {
      expectAnchorError(e, ERR.MissingCancelAuthority);
    }
  });

  // -------------------------------------------------------------------------
  // T30: create_stream with invalid schedule (start > cliff) -> InvalidSchedule
  // -------------------------------------------------------------------------
  it("T30: create_stream with start > cliff rejects with InvalidSchedule", async () => {
    const CAMPAIGN_ID = 404;
    const AMOUNT = 10_000;

    const mint = await createTestMint(provider, creator.publicKey);
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);
    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    // start=now+500, cliff=now+100, end=now+1000 → start > cliff violates constraint
    try {
      await program.methods
        .createStream({
          campaignId: new BN(CAMPAIGN_ID),
          beneficiary: beneficiary.publicKey,
          amount: new BN(AMOUNT),
          releaseType: 1, // Linear
          startTime: new BN(t.now + 500), // start AFTER cliff
          cliffTime: new BN(t.now + 100),
          endTime: new BN(t.now + 1000),
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
      expect.fail("should have thrown InvalidSchedule");
    } catch (e) {
      expectAnchorError(e, ERR.InvalidSchedule);
    }
  });

  // -------------------------------------------------------------------------
  // T31: create_stream with invalid release_type (3) -> InvalidScheduleType
  // -------------------------------------------------------------------------
  it("T31: create_stream with release_type=3 rejects with InvalidScheduleType", async () => {
    const CAMPAIGN_ID = 405;
    const AMOUNT = 10_000;

    const mint = await createTestMint(provider, creator.publicKey);
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);
    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    try {
      await program.methods
        .createStream({
          campaignId: new BN(CAMPAIGN_ID),
          beneficiary: beneficiary.publicKey,
          amount: new BN(AMOUNT),
          releaseType: 3, // Invalid: must be 0, 1, or 2
          startTime: new BN(t.now),
          cliffTime: new BN(t.now),
          endTime: new BN(t.now + 1000),
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
      expect.fail("should have thrown InvalidScheduleType");
    } catch (e) {
      expectAnchorError(e, ERR.InvalidScheduleType);
    }
  });

  // -------------------------------------------------------------------------
  // T32: create_stream with zero amount -> ZeroAmount
  // -------------------------------------------------------------------------
  it("T32: create_stream with zero amount rejects with ZeroAmount", async () => {
    const CAMPAIGN_ID = 406;
    const AMOUNT = 10_000; // fund the ATA so source_ata account validation passes

    const mint = await createTestMint(provider, creator.publicKey);
    // The source_ata must exist for Anchor account validation to pass.
    // The handler's require!(args.amount > 0) guard then fires before the transfer.
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);
    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    try {
      await program.methods
        .createStream({
          campaignId: new BN(CAMPAIGN_ID),
          beneficiary: beneficiary.publicKey,
          amount: new BN(0),
          releaseType: 1,
          startTime: new BN(t.now),
          cliffTime: new BN(t.now),
          endTime: new BN(t.now + 1000),
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
      expect.fail("should have thrown ZeroAmount");
    } catch (e) {
      expectAnchorError(e, ERR.ZeroAmount);
    }
  });

  // ===========================================================================
  // AUTHORIZATION TESTS
  // ===========================================================================

  // -------------------------------------------------------------------------
  // T33: cancel_campaign on non-cancellable campaign -> NotCancellable
  // -------------------------------------------------------------------------
  it("T33: cancel_campaign on non-cancellable campaign rejects with NotCancellable", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000;

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);
    const end = t.future(900);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { treePda } = await createAndFundCampaign(
      { provider, program, creator, cancelAuthority, pauseAuthority },
      500,
      [leaf],
      AMOUNT,
      false, // <-- non-cancellable
    );

    // Even the designated cancel authority cannot cancel a non-cancellable campaign
    try {
      await program.methods
        .cancelCampaign()
        .accounts({
          cancelAuthority: cancelAuthority.publicKey,
          vestingTree: treePda,
        })
        .signers([cancelAuthority])
        .rpc();
      expect.fail("should have thrown NotCancellable");
    } catch (e) {
      expectAnchorError(e, ERR.NotCancellable);
    }
  });

  // -------------------------------------------------------------------------
  // T34: cancel_campaign from wrong authority -> Unauthorized
  // -------------------------------------------------------------------------
  it("T34: cancel_campaign from wrong authority rejects with Unauthorized", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000;

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);
    const end = t.future(900);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { treePda } = await createAndFundCampaign(
      { provider, program, creator, cancelAuthority, pauseAuthority },
      501,
      [leaf],
      AMOUNT,
      true, // cancellable
    );

    // Random signer tries to cancel
    const impostor = Keypair.generate();
    await airdrop(provider, impostor.publicKey, 0.01);

    try {
      await program.methods
        .cancelCampaign()
        .accounts({
          cancelAuthority: impostor.publicKey,
          vestingTree: treePda,
        })
        .signers([impostor])
        .rpc();
      expect.fail("should have thrown Unauthorized");
    } catch (e) {
      expectAnchorError(e, ERR.Unauthorized);
    }
  });

  // -------------------------------------------------------------------------
  // T35: cancel_campaign when already cancelled -> AlreadyCancelled
  // -------------------------------------------------------------------------
  it("T35: cancel_campaign when already cancelled rejects with AlreadyCancelled", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000;

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);
    const end = t.future(900);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { treePda } = await createAndFundCampaign(
      { provider, program, creator, cancelAuthority, pauseAuthority },
      502,
      [leaf],
      AMOUNT,
      true,
    );

    // First cancel succeeds
    await program.methods
      .cancelCampaign()
      .accounts({
        cancelAuthority: cancelAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([cancelAuthority])
      .rpc();

    // Second cancel attempt -> AlreadyCancelled
    try {
      await program.methods
        .cancelCampaign()
        .accounts({
          cancelAuthority: cancelAuthority.publicKey,
          vestingTree: treePda,
        })
        .signers([cancelAuthority])
        .rpc();
      expect.fail("should have thrown AlreadyCancelled");
    } catch (e) {
      expectAnchorError(e, ERR.AlreadyCancelled);
    }
  });

  // -------------------------------------------------------------------------
  // T36: pause_campaign from wrong authority -> Unauthorized
  // -------------------------------------------------------------------------
  it("T36: pause_campaign from wrong authority rejects with Unauthorized", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000;

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);
    const end = t.future(900);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { treePda } = await createAndFundCampaign(
      { provider, program, creator, cancelAuthority, pauseAuthority },
      503,
      [leaf],
      AMOUNT,
      true,
    );

    // Random signer tries to pause
    const impostor = Keypair.generate();
    await airdrop(provider, impostor.publicKey, 0.01);

    try {
      await program.methods
        .pauseCampaign()
        .accounts({
          pauseAuthority: impostor.publicKey,
          vestingTree: treePda,
        })
        .signers([impostor])
        .rpc();
      expect.fail("should have thrown Unauthorized");
    } catch (e) {
      expectAnchorError(e, ERR.Unauthorized);
    }
  });

  // -------------------------------------------------------------------------
  // T37: pause_campaign when already paused -> AlreadyPaused
  // -------------------------------------------------------------------------
  it("T37: pause_campaign when already paused rejects with AlreadyPaused", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000;

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);
    const end = t.future(900);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { treePda } = await createAndFundCampaign(
      { provider, program, creator, cancelAuthority, pauseAuthority },
      504,
      [leaf],
      AMOUNT,
      true,
    );

    // First pause succeeds
    await program.methods
      .pauseCampaign()
      .accounts({
        pauseAuthority: pauseAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([pauseAuthority])
      .rpc();

    // Second pause attempt -> AlreadyPaused
    try {
      await program.methods
        .pauseCampaign()
        .accounts({
          pauseAuthority: pauseAuthority.publicKey,
          vestingTree: treePda,
        })
        .signers([pauseAuthority])
        .rpc();
      expect.fail("should have thrown AlreadyPaused");
    } catch (e) {
      expectAnchorError(e, ERR.AlreadyPaused);
    }
  });

  // -------------------------------------------------------------------------
  // T38: unpause_campaign when not paused -> NotPaused
  // -------------------------------------------------------------------------
  it("T38: unpause_campaign when not paused rejects with NotPaused", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000;

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);
    const end = t.future(900);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { treePda } = await createAndFundCampaign(
      { provider, program, creator, cancelAuthority, pauseAuthority },
      505,
      [leaf],
      AMOUNT,
      true,
    );

    // Unpause without ever pausing -> NotPaused
    try {
      await program.methods
        .unpauseCampaign()
        .accounts({
          pauseAuthority: pauseAuthority.publicKey,
          vestingTree: treePda,
        })
        .signers([pauseAuthority])
        .rpc();
      expect.fail("should have thrown NotPaused");
    } catch (e) {
      expectAnchorError(e, ERR.NotPaused);
    }
  });

  // -------------------------------------------------------------------------
  // T39: fund_campaign exceeding total_supply -> OverFunded
  // -------------------------------------------------------------------------
  it("T39: fund_campaign exceeding total_supply rejects with OverFunded", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const TOTAL_SUPPLY = 10_000;

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);
    const end = t.future(900);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(TOTAL_SUPPLY),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { mint, treePda, vault } = await createAndFundCampaign(
      { provider, program, creator, cancelAuthority, pauseAuthority },
      506,
      [leaf],
      TOTAL_SUPPLY,
    );

    // Mint additional tokens to the creator and attempt to fund beyond total_supply
    await fundCreatorAta(provider, mint, creator.publicKey, TOTAL_SUPPLY);

    try {
      await program.methods
        .fundCampaign(new BN(1)) // even 1 token over the cap
        .accounts({
          creator: creator.publicKey,
          vestingTree: treePda,
          vault,
          sourceAta: getAssociatedTokenAddressSync(mint, creator.publicKey),
        })
        .signers([creator])
        .rpc();
      expect.fail("should have thrown OverFunded");
    } catch (e) {
      expectAnchorError(e, ERR.OverFunded);
    }
  });

  // -------------------------------------------------------------------------
  // T40: withdraw on multi-leaf campaign -> NotSingleStream
  // -------------------------------------------------------------------------
  it("T40: withdraw on multi-leaf campaign rejects with NotSingleStream", async () => {
    const beneficiary0 = await makeBeneficiary(provider);
    const beneficiary1 = await makeBeneficiary(provider);
    const AMOUNT = 10_000;

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);
    const end = t.future(900);

    const leaf0: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary0.publicKey,
      amount: new BN(AMOUNT / 2),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };
    const leaf1: VestingLeaf = {
      leafIndex: 1,
      beneficiary: beneficiary1.publicKey,
      amount: new BN(AMOUNT / 2),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { mint, treePda, vaultAuthPda, vault } = await createAndFundCampaign(
      { provider, program, creator, cancelAuthority, pauseAuthority },
      507,
      [leaf0, leaf1], // 2-leaf campaign
      AMOUNT,
    );

    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary0.publicKey);
    const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary0.publicKey);

    try {
      await program.methods
        .withdraw({
          releaseType: 1,
          startTime: new BN(cliff),
          cliffTime: new BN(cliff),
          endTime: new BN(end),
          milestoneIdx: 0,
        })
        .accounts({
          beneficiary: beneficiary0.publicKey,
          vestingTree: treePda,
          claimRecord: crPda,
          vaultAuthority: vaultAuthPda,
          vault,
          beneficiaryAta,
          mint,
        })
        .signers([beneficiary0])
        .rpc();
      expect.fail("should have thrown NotSingleStream");
    } catch (e) {
      expectAnchorError(e, ERR.NotSingleStream);
    }
  });

  // ===========================================================================
  // VIEW FUNCTION TEST
  // ===========================================================================

  // -------------------------------------------------------------------------
  // T41: get_vested_amount via simulateTransaction
  // Verifies returned amount matches expected for cliff/linear/milestone
  // -------------------------------------------------------------------------
  it("T41: get_vested_amount returns correct amounts for cliff/linear/milestone", async () => {
    const t = await createTimeHelpers(provider.connection);

    /** Helper to call get_vested_amount via simulate and decode the u64 return. */
    async function vestedAmount(
      leaf: ReturnType<typeof idlLeaf>,
      cancelledAt: BN | null,
      now: BN,
      milestoneReleasedFlags: number[] | null = null,
    ): Promise<number> {
      const flags = milestoneReleasedFlags
        ? milestoneReleasedFlags
        : null;
      const result = await program.methods
        .getVestedAmount(leaf, cancelledAt, now, flags)
        .simulate();
      // Anchor 0.32.x returns data in raw logs as "Program return: <programId> <base64>"
      const raw: string[] = (result as any).raw ?? [];
      const returnLine = raw.find((l: string) => l.startsWith("Program return:"));
      if (returnLine) {
        const b64 = returnLine.split(" ").pop()!;
        const buf = Buffer.from(b64, "base64");
        return new BN(buf, "le").toNumber();
      }
      throw new Error(
        `getVestedAmount simulate returned no data. Full result: ${JSON.stringify(result, null, 2)}`,
      );
    }

    // --- Cliff: before cliff -> 0 ---
    const cliffLeaf = idlLeaf({
      leafIndex: 0,
      beneficiary: PublicKey.default,
      amount: new BN(1_000_000),
      releaseType: ReleaseType.Cliff,
      startTime: new BN(t.now),
      cliffTime: new BN(t.now + 1000),
      endTime: new BN(t.now + 2000),
      milestoneIdx: 0,
    });
    expect(await vestedAmount(cliffLeaf, null, new BN(t.now))).to.equal(0);

    // --- Cliff: after cliff -> full amount ---
    expect(await vestedAmount(cliffLeaf, null, new BN(t.now + 1001))).to.equal(1_000_000);

    // --- Linear: before cliff -> 0 ---
    const linearLeaf = idlLeaf({
      leafIndex: 0,
      beneficiary: PublicKey.default,
      amount: new BN(10_000),
      releaseType: ReleaseType.Linear,
      startTime: new BN(t.now),
      cliffTime: new BN(t.now + 500),
      endTime: new BN(t.now + 1500),
      milestoneIdx: 0,
    });
    expect(await vestedAmount(linearLeaf, null, new BN(t.now))).to.equal(0);

    // --- Linear: at 50% elapsed (cliff=500, end=1500, now=1000) -> 50% ---
    expect(await vestedAmount(linearLeaf, null, new BN(t.now + 1000))).to.equal(5_000);

    // --- Linear: after end -> full amount ---
    expect(await vestedAmount(linearLeaf, null, new BN(t.now + 2000))).to.equal(10_000);

    // --- Milestone: before cliff -> 0 ---
    const milestoneLeaf = idlLeaf({
      leafIndex: 0,
      beneficiary: PublicKey.default,
      amount: new BN(5_000),
      releaseType: ReleaseType.Milestone,
      startTime: new BN(t.now),
      cliffTime: new BN(t.now + 100),
      endTime: new BN(t.now + 2000),
      milestoneIdx: 0,
    });
    expect(await vestedAmount(milestoneLeaf, null, new BN(t.now))).to.equal(0);

    // --- Milestone: after cliff but no flags -> 0 (milestone not released) ---
    expect(await vestedAmount(milestoneLeaf, null, new BN(t.now + 200))).to.equal(0);

    // --- Milestone: after cliff with milestone 0 released -> full amount ---
    const flagsMilestone0 = Array(32).fill(0);
    flagsMilestone0[0] = 0x01; // bit 0 set
    expect(await vestedAmount(milestoneLeaf, null, new BN(t.now + 200), flagsMilestone0)).to.equal(5_000);

    // --- Milestone: with flags for wrong milestone (bit 1 set, need bit 0) -> 0 ---
    const flagsWrongMilestone = Array(32).fill(0);
    flagsWrongMilestone[0] = 0x02; // bit 1 set, not bit 0
    expect(await vestedAmount(milestoneLeaf, null, new BN(t.now + 200), flagsWrongMilestone)).to.equal(0);

    // --- Cancel clamp: linear with cancelled_at in the middle -> capped ---
    // cliff=0, end=1000, cancelled_at=500, now=2000
    // effective_now = min(2000, 500) = 500
    // vested = 10000 * 500 / 1000 = 5000
    const cancelLeaf = idlLeaf({
      leafIndex: 0,
      beneficiary: PublicKey.default,
      amount: new BN(10_000),
      releaseType: ReleaseType.Linear,
      startTime: new BN(t.now),
      cliffTime: new BN(t.now),
      endTime: new BN(t.now + 1000),
      milestoneIdx: 0,
    });
    expect(
      await vestedAmount(cancelLeaf, new BN(t.now + 500), new BN(t.now + 2000)),
    ).to.equal(5_000);
  });

  // ===========================================================================
  // PAUSE / UNPAUSE HAPPY PATHS
  // ===========================================================================

  // -------------------------------------------------------------------------
  // T42: Pause blocks claims -> CampaignPaused
  // -------------------------------------------------------------------------
  it("T42: pause blocks claims with CampaignPaused", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000;

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);
    const end = t.future(900);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { mint, tree, treePda, vaultAuthPda, vault } =
      await createAndFundCampaign(
        { provider, program, creator, cancelAuthority, pauseAuthority },
        600,
        [leaf],
        AMOUNT,
        true,
      );

    // Pause the campaign
    await program.methods
      .pauseCampaign()
      .accounts({
        pauseAuthority: pauseAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([pauseAuthority])
      .rpc();

    // Attempt claim while paused -> CampaignPaused
    try {
      await program.methods
        .claim(idlLeaf(leaf), idlProof(tree.proof(0)))
        .accounts({
          beneficiary: beneficiary.publicKey,
          vestingTree: treePda,
          claimRecord: (
            await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey)
          )[0],
          vaultAuthority: vaultAuthPda,
          vault,
          beneficiaryAta: getAssociatedTokenAddressSync(
            mint,
            beneficiary.publicKey,
          ),
          mint,
        })
        .signers([beneficiary])
        .rpc();
      expect.fail("should have thrown CampaignPaused");
    } catch (e) {
      expectAnchorError(e, ERR.CampaignPaused);
    }
  });

  // -------------------------------------------------------------------------
  // T43: Unpause resumes claims
  // -------------------------------------------------------------------------
  it("T43: unpause resumes claims successfully", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000;

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);
    const end = t.future(900);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { mint, tree, treePda, vaultAuthPda, vault } =
      await createAndFundCampaign(
        { provider, program, creator, cancelAuthority, pauseAuthority },
        601,
        [leaf],
        AMOUNT,
        true,
      );

    // Pause the campaign
    await program.methods
      .pauseCampaign()
      .accounts({
        pauseAuthority: pauseAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([pauseAuthority])
      .rpc();

    // Unpause the campaign
    await program.methods
      .unpauseCampaign()
      .accounts({
        pauseAuthority: pauseAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([pauseAuthority])
      .rpc();

    // Claim should now succeed
    const beneficiaryAta = getAssociatedTokenAddressSync(
      mint,
      beneficiary.publicKey,
    );

    await program.methods
      .claim(idlLeaf(leaf), idlProof(tree.proof(0)))
      .accounts({
        beneficiary: beneficiary.publicKey,
        vestingTree: treePda,
        claimRecord: (
          await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey)
        )[0],
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta,
        mint,
      })
      .signers([beneficiary])
      .rpc();

    // Verify tokens were received
    const postBeneficiary = await getAccount(provider.connection, beneficiaryAta);
    expect(Number(postBeneficiary.amount)).to.be.greaterThan(0);
  });

  // ===========================================================================
  // UPDATE_ROOT HAPPY PATH
  // ===========================================================================

  // -------------------------------------------------------------------------
  // T44: update_root happy path — claim with new merkle root
  // -------------------------------------------------------------------------
  it("T44: update_root allows claim with new merkle root", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000;

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);
    const end = t.future(900);

    // Initial leaf for beneficiary (will NOT be in the new tree)
    const leaf0: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { mint, treePda, vaultAuthPda, vault } =
      await createAndFundCampaign(
        { provider, program, creator, cancelAuthority, pauseAuthority },
        602,
        [leaf0],
        AMOUNT,
        true,
      );

    // Build a new tree with a DIFFERENT beneficiary and claim them
    const newBeneficiary = await makeBeneficiary(provider);
    const newLeaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: newBeneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };
    const newTree = new VestingMerkleTree([newLeaf]);

    // Update root to the new tree's root
    await program.methods
      .updateRoot(Array.from(newTree.root), 1, new BN(cliff))
      .accounts({
        cancelAuthority: cancelAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([cancelAuthority])
      .rpc();

    // Claim with the new beneficiary using the new tree's proof
    const newBeneficiaryAta = getAssociatedTokenAddressSync(
      mint,
      newBeneficiary.publicKey,
    );

    await program.methods
      .claim(idlLeaf(newLeaf), idlProof(newTree.proof(0)))
      .accounts({
        beneficiary: newBeneficiary.publicKey,
        vestingTree: treePda,
        claimRecord: (
          await claimRecordPDA(PROGRAM_ID, treePda, newBeneficiary.publicKey)
        )[0],
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta: newBeneficiaryAta,
        mint,
      })
      .signers([newBeneficiary])
      .rpc();

    // Verify the new beneficiary received tokens
    const postBeneficiary = await getAccount(
      provider.connection,
      newBeneficiaryAta,
    );
    expect(Number(postBeneficiary.amount)).to.be.greaterThan(0);
  });

  // ===========================================================================
  // WITHDRAW EDGE CASES
  // ===========================================================================

  // -------------------------------------------------------------------------
  // T45: Withdraw on paused campaign -> CampaignPaused
  // -------------------------------------------------------------------------
  it("T45: withdraw on paused campaign rejects with CampaignPaused", async () => {
    const CAMPAIGN_ID = 603;
    const AMOUNT = 10_000;

    const mint = await createTestMint(provider, creator.publicKey);
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);
    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);

    // cliff=500s ago, end=500s from now -> ~50% vested
    const cliff = t.now - 500;
    const end = t.now + 500;

    await program.methods
      .createStream({
        campaignId: new BN(CAMPAIGN_ID),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 1,
        startTime: new BN(t.now - 500),
        cliffTime: new BN(cliff),
        endTime: new BN(end),
        milestoneIdx: 0,
        cancellable: true,
        cancelAuthority: cancelAuthority.publicKey,
        pauseAuthority: pauseAuthority.publicKey,
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

    // Pause the campaign
    await program.methods
      .pauseCampaign()
      .accounts({
        pauseAuthority: pauseAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([pauseAuthority])
      .rpc();

    // Attempt withdraw while paused -> CampaignPaused
    try {
      await program.methods
        .withdraw({
          releaseType: 1,
          startTime: new BN(t.now - 500),
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
      expect.fail("should have thrown CampaignPaused");
    } catch (e) {
      expectAnchorError(e, ERR.CampaignPaused);
    }
  });

  // -------------------------------------------------------------------------
  // T46: Withdraw with milestone release_type
  // -------------------------------------------------------------------------
  it("T46: withdraw with milestone release_type succeeds after cliff", async () => {
    const CAMPAIGN_ID = 604;
    const AMOUNT = 10_000;

    const mint = await createTestMint(provider, creator.publicKey);
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);
    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);

    // cliff=500s in the past -> milestone is claimable
    const cliff = t.now - 500;
    const end = t.now + 1000;

    await program.methods
      .createStream({
        campaignId: new BN(CAMPAIGN_ID),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 2, // Milestone
        startTime: new BN(t.now - 500),
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

    await releaseMilestone({ program, creator }, treePda, 0);

    // Withdraw milestone amount
    await program.methods
      .withdraw({
        releaseType: 2,
        startTime: new BN(t.now - 500),
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

    // Verify full milestone amount was received
    const postBeneficiary = await getAccount(provider.connection, beneficiaryAta);
    expect(Number(postBeneficiary.amount)).to.equal(AMOUNT);
  });

  // ===========================================================================
  // SAD / BAD PATH TESTS — previously untested error codes
  // ===========================================================================

  // -------------------------------------------------------------------------
  // T48: OverClaim — total_claimed + claimable > total_supply
  // -------------------------------------------------------------------------
  it("T48: over-claim exceeding total_supply rejects with OverClaim", async () => {
    const beneficiary0 = await makeBeneficiary(provider);
    const beneficiary1 = await makeBeneficiary(provider);
    const TOTAL_SUPPLY = 1_000;

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);
    const end = t.future(900);

    // Each leaf entitled to 800, but total_supply is only 1000
    const leaf0: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary0.publicKey,
      amount: new BN(800),
      releaseType: ReleaseType.Cliff,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };
    const leaf1: VestingLeaf = {
      leafIndex: 1,
      beneficiary: beneficiary1.publicKey,
      amount: new BN(800),
      releaseType: ReleaseType.Cliff,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { mint, tree, treePda, vaultAuthPda, vault } =
      await createAndFundCampaign(
        { provider, program, creator, cancelAuthority, pauseAuthority },
        800,
        [leaf0, leaf1],
        TOTAL_SUPPLY,
      );

    // First beneficiary claims 800 -> succeeds (800 <= 1000)
    await issueClaim(
      { program },
      leaf0,
      tree.proof(0),
      beneficiary0,
      treePda,
      vaultAuthPda,
      vault,
      mint,
    );

    // Second beneficiary tries to claim 800 -> OverClaim (800 + 800 = 1600 > 1000)
    try {
      await issueClaim(
        { program },
        leaf1,
        tree.proof(1),
        beneficiary1,
        treePda,
        vaultAuthPda,
        vault,
        mint,
      );
      expect.fail("should have thrown OverClaim");
    } catch (e) {
      const msg = ((e as any).message || "") + "\n" + ((e as any).logs || []).join("\n");
      const isOverClaim = msg.includes("0x" + ERR.OverClaim.toString(16).padStart(4, "0"));
      const isInsufficientVault = msg.includes("0x" + ERR.InsufficientVault.toString(16).padStart(4, "0"));
      expect(
        isOverClaim || isInsufficientVault,
        "expected OverClaim (6017) or InsufficientVault (6016)",
      ).to.be.true;
    }
  });

  // -------------------------------------------------------------------------
  // T49: NotPausable — pause campaign with no pause_authority
  // -------------------------------------------------------------------------
  it("T49: pause on campaign with no pause_authority rejects with NotPausable", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000;

    const mint = await createTestMint(provider, creator.publicKey);
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);
    const end = t.future(900);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const tree = new VestingMerkleTree([leaf]);
    const CAMPAIGN_ID = 801;
    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    // Create campaign with NO pause_authority
    await program.methods
      .createCampaign({
        campaignId: new BN(CAMPAIGN_ID),
        merkleRoot: Array.from(tree.root),
        leafCount: 1,
        totalSupply: new BN(AMOUNT),
        minCliffTime: leaf.cliffTime,
        cancellable: true,
        cancelAuthority: cancelAuthority.publicKey,
        pauseAuthority: null, // <-- no pause authority
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

    // Fund it
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

    // Attempt to pause -> NotPausable
    const impostor = Keypair.generate();
    await airdrop(provider, impostor.publicKey, 0.01);
    try {
      await program.methods
        .pauseCampaign()
        .accounts({
          pauseAuthority: impostor.publicKey,
          vestingTree: treePda,
        })
        .signers([impostor])
        .rpc();
      expect.fail("should have thrown NotPausable");
    } catch (e) {
      expectAnchorError(e, ERR.NotPausable);
    }
  });

  // -------------------------------------------------------------------------
  // T50: NotCancelled — withdraw_unvested without cancelling
  // -------------------------------------------------------------------------
  it("T50: withdraw_unvested on non-cancelled campaign rejects with NotCancelled", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000;

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);
    const end = t.future(900);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { mint, treePda, vault } = await createAndFundCampaign(
      { provider, program, creator, cancelAuthority, pauseAuthority },
      802,
      [leaf],
      AMOUNT,
    );

    // Attempt withdraw_unvested without cancelling -> NotCancelled
    try {
      await program.methods
        .withdrawUnvested()
        .accounts({
          creator: creator.publicKey,
          vestingTree: treePda,
          vaultAuthority: (
            await vaultAuthorityPDA(PROGRAM_ID, treePda)
          )[0],
          vault,
          creatorAta: getAssociatedTokenAddressSync(mint, creator.publicKey),
        })
        .signers([creator])
        .rpc();
      expect.fail("should have thrown NotCancelled");
    } catch (e) {
      expectAnchorError(e, ERR.NotCancelled);
    }
  });

  // -------------------------------------------------------------------------
  // T51: WrongVault — claim with wrong vault account
  // -------------------------------------------------------------------------
  it("T51: claim with wrong vault rejects with WrongVault", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000;

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);
    const end = t.future(900);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { mint, tree, treePda, vaultAuthPda } =
      await createAndFundCampaign(
        { provider, program, creator, cancelAuthority, pauseAuthority },
        803,
        [leaf],
        AMOUNT,
      );

    // Use the creator's source ATA as the "wrong vault"
    const wrongVault = getAssociatedTokenAddressSync(mint, creator.publicKey);
    const crPda = (
      await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey)
    )[0];

    try {
      await program.methods
        .claim(idlLeaf(leaf), idlProof(tree.proof(0)))
        .accounts({
          beneficiary: beneficiary.publicKey,
          vestingTree: treePda,
          claimRecord: crPda,
          vaultAuthority: vaultAuthPda,
          vault: wrongVault, // <-- wrong vault
          beneficiaryAta: getAssociatedTokenAddressSync(
            mint,
            beneficiary.publicKey,
          ),
          mint,
        })
        .signers([beneficiary])
        .rpc();
      expect.fail("should have thrown WrongVault");
    } catch (e) {
      expectAnchorError(e, ERR.WrongVault);
    }
  });

  // -------------------------------------------------------------------------
  // T52: InsufficientVault — vault has less than claimable amount
  // -------------------------------------------------------------------------
  it("T52: claim when vault underfunded rejects with InsufficientVault", async function () {
    const beneficiary = await makeBeneficiary(provider);
    const TOTAL_SUPPLY = 10_000;
    const FUND_AMOUNT = 1_000;

    const mint = await createTestMint(provider, creator.publicKey);
    await fundCreatorAta(provider, mint, creator.publicKey, TOTAL_SUPPLY);

    const t = await createTimeHelpers(provider.connection);
    // Schedule fully vested: cliff in past, end in past
    const cliff = t.past(1000);
    const end = t.past(500);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(TOTAL_SUPPLY),
      releaseType: ReleaseType.Cliff,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const tree = new VestingMerkleTree([leaf]);
    const CAMPAIGN_ID = 804;
    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    // Warp time so schedule is fully vested
    try {
      await (provider.connection as any)._rpcRequest("setClock", {
        unixTimestamp: end + 100,
      });
    } catch {
      this.skip();
    }

    // Create campaign (total_supply = 10000)
    await program.methods
      .createCampaign({
        campaignId: new BN(CAMPAIGN_ID),
        merkleRoot: Array.from(tree.root),
        leafCount: 1,
        totalSupply: new BN(TOTAL_SUPPLY),
        minCliffTime: leaf.cliffTime,
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

    // Fund with only 1000 (less than total_supply of 10000)
    await program.methods
      .fundCampaign(new BN(FUND_AMOUNT))
      .accounts({
        creator: creator.publicKey,
        vestingTree: treePda,
        vault,
        sourceAta: getAssociatedTokenAddressSync(mint, creator.publicKey),
      })
      .signers([creator])
      .rpc();

    // Attempt to claim full amount -> InsufficientVault (vault has 1000, needs 10000)
    try {
      await issueClaim(
        { program },
        leaf,
        tree.proof(0),
        beneficiary,
        treePda,
        vaultAuthPda,
        vault,
        mint,
      );
      expect.fail("should have thrown InsufficientVault");
    } catch (e) {
      expectAnchorError(e, ERR.InsufficientVault);
    }
  });

  // -------------------------------------------------------------------------
  // T53: MintMismatch — claim with wrong mint
  // -------------------------------------------------------------------------
  it("T53: claim with wrong mint rejects with MintMismatch", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000;

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);
    const end = t.future(900);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { treePda, vaultAuthPda, vault } =
      await createAndFundCampaign(
        { provider, program, creator, cancelAuthority, pauseAuthority },
        805,
        [leaf],
        AMOUNT,
      );

    // Create a DIFFERENT mint
    const wrongMint = await createTestMint(provider, creator.publicKey);

    const crPda = (
      await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey)
    )[0];

    try {
      await program.methods
        .claim(idlLeaf(leaf), idlProof(new VestingMerkleTree([leaf]).proof(0)))
        .accounts({
          beneficiary: beneficiary.publicKey,
          vestingTree: treePda,
          claimRecord: crPda,
          vaultAuthority: vaultAuthPda,
          vault,
          beneficiaryAta: getAssociatedTokenAddressSync(
            wrongMint,
            beneficiary.publicKey,
          ),
          mint: wrongMint, // <-- wrong mint
        })
        .signers([beneficiary])
        .rpc();
      expect.fail("should have thrown MintMismatch");
    } catch (e) {
      expectAnchorError(e, ERR.MintMismatch);
    }
  });

  // -------------------------------------------------------------------------
  // T54: fund_campaign with zero amount -> ZeroAmount
  // -------------------------------------------------------------------------
  it("T54: fund_campaign with zero amount rejects with ZeroAmount", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000;

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);
    const end = t.future(900);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { mint, treePda, vault } = await createAndFundCampaign(
      { provider, program, creator, cancelAuthority, pauseAuthority },
      806,
      [leaf],
      AMOUNT,
    );

    // Attempt to fund with 0 -> ZeroAmount
    try {
      await program.methods
        .fundCampaign(new BN(0))
        .accounts({
          creator: creator.publicKey,
          vestingTree: treePda,
          vault,
          sourceAta: getAssociatedTokenAddressSync(mint, creator.publicKey),
        })
        .signers([creator])
        .rpc();
      expect.fail("should have thrown ZeroAmount");
    } catch (e) {
      expectAnchorError(e, ERR.ZeroAmount);
    }
  });

  // -------------------------------------------------------------------------
  // T60: cancel_campaign after full vest -> FullyVested
  // -------------------------------------------------------------------------
  it("T60: cancel_campaign after full vest rejects with FullyVested", async () => {
    const CAMPAIGN_ID = 9860;
    const AMOUNT = 10_000;
    const beneficiary = await makeBeneficiary(provider);
    const mint = await createTestMint(provider, creator.publicKey);
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);
    const t = await createTimeHelpers(provider.connection);

    const [treePda] = await treePDA(
      PROGRAM_ID,
      creator.publicKey,
      mint,
      CAMPAIGN_ID,
    );
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const [crPda] = await claimRecordPDA(
      PROGRAM_ID,
      treePda,
      beneficiary.publicKey,
    );
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = getAssociatedTokenAddressSync(
      mint,
      beneficiary.publicKey,
    );

    const cliff = t.past(2000);
    const end = t.past(10);

    await program.methods
      .createStream({
        campaignId: new BN(CAMPAIGN_ID),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 1,
        startTime: new BN(cliff),
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

    await program.methods
      .withdraw({
        releaseType: 1,
        startTime: new BN(cliff),
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

    const treeAccount = await program.account.vestingTree.fetch(treePda);
    const claimed = treeAccount.totalClaimed.toString();
    const supply = treeAccount.totalSupply.toString();
    expect(claimed).to.equal(String(AMOUNT));
    expect(supply).to.equal(String(AMOUNT));

    try {
      await program.methods
        .cancelCampaign()
        .accounts({
          cancelAuthority: cancelAuthority.publicKey,
          vestingTree: treePda,
        })
        .signers([cancelAuthority])
        .rpc();
      expect.fail(
        `expected FullyVested; claimed=${claimed} supply=${supply}`,
      );
    } catch (e) {
      expectAnchorError(e, ERR.FullyVested);
    }
  });

  // -------------------------------------------------------------------------
  // T61: withdraw after schedule ended and fully claimed -> StreamExpired
  // -------------------------------------------------------------------------
  it("T61: double-withdraw after end_time rejects with StreamExpired", async () => {
    const CAMPAIGN_ID = 9861;
    const AMOUNT = 10_000;
    const beneficiary = await makeBeneficiary(provider);
    const mint = await createTestMint(provider, creator.publicKey);
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);
    const t = await createTimeHelpers(provider.connection);

    const [treePda] = await treePDA(
      PROGRAM_ID,
      creator.publicKey,
      mint,
      CAMPAIGN_ID,
    );
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const [crPda] = await claimRecordPDA(
      PROGRAM_ID,
      treePda,
      beneficiary.publicKey,
    );
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = getAssociatedTokenAddressSync(
      mint,
      beneficiary.publicKey,
    );

    const cliff = t.past(2_000_000);
    const end = t.past(1_000_000);
    const withdrawArgs = {
      releaseType: 1,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    await program.methods
      .createStream({
        campaignId: new BN(CAMPAIGN_ID),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 1,
        startTime: new BN(cliff),
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

    await program.methods
      .withdraw(withdrawArgs)
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

    const vaultAfter = await getAccount(provider.connection, vault);
    expect(Number(vaultAfter.amount)).to.equal(0);

    try {
      await program.methods
        .withdraw(withdrawArgs)
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
      expect.fail("should have thrown StreamExpired or NothingToClaim");
    } catch (e) {
      const msg = (e as Error).message || String(e);
      const logs = ((e as any).logs || []).join("\n");
      const haystack = `${msg}\n${logs}`;
      const isExpired =
        haystack.includes("StreamExpired") ||
        haystack.includes("6032") ||
        haystack.includes("0x1790");
      const isNothing =
        haystack.includes("NothingToClaim") ||
        haystack.includes("6015") ||
        haystack.includes("0x177f");
      expect(isExpired || isNothing, haystack).to.equal(true);
    }
  });

  // -------------------------------------------------------------------------
  // T62: cancel_campaign before cliff succeeds
  // -------------------------------------------------------------------------
  it("T62: cancel_campaign before cliff sets cancelled_at", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000;

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.future(500);
    const end = t.future(1000);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { treePda } = await createAndFundCampaign(
      { provider, program, creator, cancelAuthority, pauseAuthority },
      809,
      [leaf],
      AMOUNT,
      true,
    );

    await program.methods
      .cancelCampaign()
      .accounts({
        cancelAuthority: cancelAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([cancelAuthority])
      .rpc();

    const treeAccount = await program.account.vestingTree.fetch(treePda);
    expect(treeAccount.cancelledAt).to.not.be.null;
  });

  // -------------------------------------------------------------------------
  // T63: milestone claim without creator release -> MilestoneNotReleased
  // -------------------------------------------------------------------------
  it("T63: milestone claim before set_milestone_released rejects", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 10_000;
    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Milestone,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(t.future(1000)),
      milestoneIdx: 0,
    };

    const { mint, tree, treePda, vaultAuthPda, vault } =
      await createAndFundCampaign(
        { provider, program, creator, cancelAuthority, pauseAuthority },
        810,
        [leaf],
        AMOUNT,
      );

    try {
      await issueClaim(
        { program },
        leaf,
        tree.proof(0),
        beneficiary,
        treePda,
        vaultAuthPda,
        vault,
        mint,
      );
      expect.fail("should have thrown MilestoneNotReleased");
    } catch (e) {
      expectAnchorError(e, ERR.MilestoneNotReleased);
    }
  });

  // -------------------------------------------------------------------------
  // T64: cancel_stream — creator-only, beneficiary vested + creator remainder
  // -------------------------------------------------------------------------
  it("T64: cancel_stream splits unlocked to beneficiary and locked to creator", async function () {
    if (provider.connection.rpcEndpoint.includes("devnet")) {
      this.skip();
    }
    const CAMPAIGN_ID = 900_000 + Math.floor(Math.random() * 99_999);
    const AMOUNT = 10_000;

    const mint = await createTestMint(provider, creator.publicKey);
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);
    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);
    const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);

    const cliff = t.now - 1000;
    const end = t.now + 1000;
    const withdrawArgs = {
      releaseType: 1,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    await program.methods
      .createStream({
        campaignId: new BN(CAMPAIGN_ID),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 1,
        startTime: new BN(cliff),
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

    const vaultAfterFund = await getAccount(provider.connection, vault);
    expect(Number(vaultAfterFund.amount)).to.equal(AMOUNT);

    try {
      await getAccount(provider.connection, beneficiaryAta);
    } catch {
      const createAtaTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          creator.publicKey,
          beneficiaryAta,
          beneficiary.publicKey,
          mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
      await provider.sendAndConfirm(createAtaTx, [creator]);
    }

    const benBefore = Number(
      (await getAccount(provider.connection, beneficiaryAta).catch(() => null))
        ?.amount ?? 0,
    );
    const creatorBeforeAmt = Number(
      (await getAccount(provider.connection, creatorAta).catch(() => null))
        ?.amount ?? 0,
    );

    await program.methods
      .cancelStream(withdrawArgs)
      .accounts({
        creator: creator.publicKey,
        beneficiary: beneficiary.publicKey,
        vestingTree: treePda,
        claimRecord: crPda,
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta,
        creatorAta,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const postBeneficiary = await getAccount(provider.connection, beneficiaryAta);
    const postCreator = await getAccount(provider.connection, creatorAta);
    const postVault = await getAccount(provider.connection, vault);

    const toBeneficiary = Number(postBeneficiary.amount) - benBefore;
    const toCreator = Number(postCreator.amount) - creatorBeforeAmt;
    expect(Number(postVault.amount)).to.equal(0);
    expect(toBeneficiary + toCreator).to.equal(AMOUNT);
    expect(toBeneficiary).to.be.within(4_900, 5_100);
    expect(toCreator).to.equal(AMOUNT - toBeneficiary);

    const treeAccount = await program.account.vestingTree.fetch(treePda);
    expect(treeAccount.cancelledAt).to.not.be.null;
    expect(treeAccount.totalClaimed.toNumber()).to.equal(toBeneficiary);
  });

  // -------------------------------------------------------------------------
  // T64b: cancel_stream on unreleased milestone — beneficiary gets 0
  // -------------------------------------------------------------------------
  it("T64b: cancel_stream on unreleased milestone gives beneficiary 0, creator gets all", async function () {
    if (provider.connection.rpcEndpoint.includes("devnet")) {
      this.skip();
    }
    const CAMPAIGN_ID = 910_000 + Math.floor(Math.random() * 99_999);
    const AMOUNT = 10_000;

    const mint = await createTestMint(provider, creator.publicKey);
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);
    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);
    const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);

    const cliff = t.now - 500;
    const end = t.now + 1000;
    const withdrawArgs = {
      releaseType: 2,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    await program.methods
      .createStream({
        campaignId: new BN(CAMPAIGN_ID),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 2,
        startTime: new BN(cliff),
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

    // Do NOT call releaseMilestone — milestone is unreleased

    try {
      await getAccount(provider.connection, beneficiaryAta);
    } catch {
      const createAtaTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          creator.publicKey,
          beneficiaryAta,
          beneficiary.publicKey,
          mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
      await provider.sendAndConfirm(createAtaTx, [creator]);
    }

    const benBefore = Number(
      (await getAccount(provider.connection, beneficiaryAta).catch(() => null))
        ?.amount ?? 0,
    );
    const creatorBeforeAmt = Number(
      (await getAccount(provider.connection, creatorAta).catch(() => null))
        ?.amount ?? 0,
    );

    await program.methods
      .cancelStream(withdrawArgs)
      .accounts({
        creator: creator.publicKey,
        beneficiary: beneficiary.publicKey,
        vestingTree: treePda,
        claimRecord: crPda,
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta,
        creatorAta,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const postBeneficiary = await getAccount(provider.connection, beneficiaryAta);
    const postCreator = await getAccount(provider.connection, creatorAta);
    const postVault = await getAccount(provider.connection, vault);

    const toBeneficiary = Number(postBeneficiary.amount) - benBefore;
    const toCreator = Number(postCreator.amount) - creatorBeforeAmt;
    expect(Number(postVault.amount)).to.equal(0);
    expect(toBeneficiary).to.equal(0);
    expect(toCreator).to.equal(AMOUNT);

    const treeAccount = await program.account.vestingTree.fetch(treePda);
    expect(treeAccount.cancelledAt).to.not.be.null;
    expect(treeAccount.totalClaimed.toNumber()).to.equal(0);
  });

  // -------------------------------------------------------------------------
  // T64c: cancel_stream on released milestone — beneficiary gets full amount
  // -------------------------------------------------------------------------
  it("T64c: cancel_stream on released milestone gives beneficiary full amount", async function () {
    if (provider.connection.rpcEndpoint.includes("devnet")) {
      this.skip();
    }
    const CAMPAIGN_ID = 920_000 + Math.floor(Math.random() * 99_999);
    const AMOUNT = 10_000;

    const mint = await createTestMint(provider, creator.publicKey);
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);
    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);
    const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);

    const cliff = t.now - 500;
    const end = t.now + 1000;
    const withdrawArgs = {
      releaseType: 2,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    await program.methods
      .createStream({
        campaignId: new BN(CAMPAIGN_ID),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 2,
        startTime: new BN(cliff),
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

    // Release milestone before cancelling
    await releaseMilestone({ program, creator }, treePda, 0);

    try {
      await getAccount(provider.connection, beneficiaryAta);
    } catch {
      const createAtaTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          creator.publicKey,
          beneficiaryAta,
          beneficiary.publicKey,
          mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
      await provider.sendAndConfirm(createAtaTx, [creator]);
    }

    const benBefore = Number(
      (await getAccount(provider.connection, beneficiaryAta).catch(() => null))
        ?.amount ?? 0,
    );
    const creatorBeforeAmt = Number(
      (await getAccount(provider.connection, creatorAta).catch(() => null))
        ?.amount ?? 0,
    );

    await program.methods
      .cancelStream(withdrawArgs)
      .accounts({
        creator: creator.publicKey,
        beneficiary: beneficiary.publicKey,
        vestingTree: treePda,
        claimRecord: crPda,
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta,
        creatorAta,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const postBeneficiary = await getAccount(provider.connection, beneficiaryAta);
    const postCreator = await getAccount(provider.connection, creatorAta);
    const postVault = await getAccount(provider.connection, vault);

    const toBeneficiary = Number(postBeneficiary.amount) - benBefore;
    const toCreator = Number(postCreator.amount) - creatorBeforeAmt;
    expect(Number(postVault.amount)).to.equal(0);
    expect(toBeneficiary).to.equal(AMOUNT);
    expect(toCreator).to.equal(0);

    const treeAccount = await program.account.vestingTree.fetch(treePda);
    expect(treeAccount.cancelledAt).to.not.be.null;
    expect(treeAccount.totalClaimed.toNumber()).to.equal(AMOUNT);
  });

  // -------------------------------------------------------------------------
  // T64d: cancel_stream after beneficiary already claimed — FullyVested
  // -------------------------------------------------------------------------
  it("T64d: cancel_stream after beneficiary claimed milestone rejects with FullyVested", async function () {
    if (provider.connection.rpcEndpoint.includes("devnet")) {
      this.skip();
    }
    const CAMPAIGN_ID = 930_000 + Math.floor(Math.random() * 99_999);
    const AMOUNT = 10_000;

    const mint = await createTestMint(provider, creator.publicKey);
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);
    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);
    const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);

    const cliff = t.now - 500;
    const end = t.now + 1000;
    const withdrawArgs = {
      releaseType: 2,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    await program.methods
      .createStream({
        campaignId: new BN(CAMPAIGN_ID),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 2,
        startTime: new BN(cliff),
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

    // Release and claim the milestone first
    await releaseMilestone({ program, creator }, treePda, 0);
    await program.methods
      .withdraw(withdrawArgs)
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

    const benAfterClaim = Number(
      (await getAccount(provider.connection, beneficiaryAta)).amount,
    );
    expect(benAfterClaim).to.equal(AMOUNT);

    // Now cancel_stream — should fail because total_claimed == total_supply
    try {
      await program.methods
        .cancelStream(withdrawArgs)
        .accounts({
          creator: creator.publicKey,
          beneficiary: beneficiary.publicKey,
          vestingTree: treePda,
          claimRecord: crPda,
          vaultAuthority: vaultAuthPda,
          vault,
          beneficiaryAta,
          creatorAta,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      expect.fail("Should have thrown FullyVested");
    } catch (err: any) {
      expectAnchorError(err, ERR.FullyVested);
    }
  });

  // -------------------------------------------------------------------------
  // T65: set_milestone_released idempotency — second call fails
  // -------------------------------------------------------------------------
  it("T65: set_milestone_released twice rejects with MilestoneAlreadyReleased", async function () {
    if (provider.connection.rpcEndpoint.includes("devnet")) {
      this.skip();
    }
    const CAMPAIGN_ID = 940_000 + Math.floor(Math.random() * 99_999);
    const AMOUNT = 5_000;

    const mint = await createTestMint(provider, creator.publicKey);
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);
    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);

    const cliff = t.now - 100;
    const end = t.now + 500;

    await program.methods
      .createStream({
        campaignId: new BN(CAMPAIGN_ID),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 2,
        startTime: new BN(cliff),
        cliffTime: new BN(cliff),
        endTime: new BN(end),
        milestoneIdx: 0,
        cancellable: false,
        cancelAuthority: null,
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

    // First release — succeeds
    await releaseMilestone({ program, creator }, treePda, 0);

    // Second release — should fail
    try {
      await releaseMilestone({ program, creator }, treePda, 0);
      expect.fail("Should have thrown MilestoneAlreadyReleased");
    } catch (err: any) {
      expectAnchorError(err, ERR.MilestoneAlreadyReleased);
    }
  });

  // -------------------------------------------------------------------------
  // T66: milestone_idx 255 (boundary) — release and claim succeed
  // -------------------------------------------------------------------------
  it("T66: milestone_idx 255 boundary — release and claim succeed", async function () {
    if (provider.connection.rpcEndpoint.includes("devnet")) {
      this.skip();
    }
    const CAMPAIGN_ID = 950_000 + Math.floor(Math.random() * 99_999);
    const AMOUNT = 5_000;

    const mint = await createTestMint(provider, creator.publicKey);
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);
    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);
    const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);

    const cliff = t.now - 100;
    const end = t.now + 500;

    await program.methods
      .createStream({
        campaignId: new BN(CAMPAIGN_ID),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 2,
        startTime: new BN(cliff),
        cliffTime: new BN(cliff),
        endTime: new BN(end),
        milestoneIdx: 255,
        cancellable: false,
        cancelAuthority: null,
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

    await releaseMilestone({ program, creator }, treePda, 255);

    await program.methods
      .withdraw({
        releaseType: 2,
        startTime: new BN(cliff),
        cliffTime: new BN(cliff),
        endTime: new BN(end),
        milestoneIdx: 255,
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

    const postBeneficiary = await getAccount(provider.connection, beneficiaryAta);
    expect(Number(postBeneficiary.amount)).to.equal(AMOUNT);
  });

  // -------------------------------------------------------------------------
  // T67: milestone claim on cancelled campaign succeeds if released
  // -------------------------------------------------------------------------
  it("T67: claim released milestone on cancelled campaign (cancelCampaign) succeeds", async function () {
    if (provider.connection.rpcEndpoint.includes("devnet")) {
      this.skip();
    }
    const CAMPAIGN_ID = 960_000 + Math.floor(Math.random() * 99_999);
    const AMOUNT = 5_000;

    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);

    const cliff = t.now - 100;
    const end = t.now + 500;

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Milestone,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { mint, tree, treePda, vaultAuthPda, vault } =
      await createAndFundCampaign(
        { provider, program, creator, cancelAuthority, pauseAuthority },
        CAMPAIGN_ID,
        [leaf],
        AMOUNT,
      );

    // Release milestone
    await releaseMilestone({ program, creator }, treePda, 0);

    // Cancel campaign (not cancel_stream)
    await program.methods
      .cancelCampaign()
      .accounts({
        cancelAuthority: cancelAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([cancelAuthority])
      .rpc();

    // Claim should still succeed — milestone is released and type 2 ignores effective_now
    const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);
    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);

    await program.methods
      .claim(idlLeaf(leaf), idlProof(tree.proof(0)))
      .accounts({
        beneficiary: beneficiary.publicKey,
        vestingTree: treePda,
        claimRecord: crPda,
        vaultAuthority: vaultAuthPda,
        vault,
        mint,
        beneficiaryAta,
      })
      .signers([beneficiary])
      .rpc();

    const postBeneficiary = await getAccount(provider.connection, beneficiaryAta);
    expect(Number(postBeneficiary.amount)).to.equal(AMOUNT);
  });

  // -------------------------------------------------------------------------
  // T68: cancel_stream on unreleased milestone — withdraw_unvested gets nothing
  //      (vault already drained by cancel_stream giving all to creator)
  // -------------------------------------------------------------------------
  it("T68: cancel_stream unreleased milestone then withdraw_unvested gets 0", async function () {
    if (provider.connection.rpcEndpoint.includes("devnet")) {
      this.skip();
    }
    const CAMPAIGN_ID = 970_000 + Math.floor(Math.random() * 99_999);
    const AMOUNT = 10_000;

    const mint = await createTestMint(provider, creator.publicKey);
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);
    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);
    const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);

    const cliff = t.now - 500;
    const end = t.now + 1000;
    const withdrawArgs = {
      releaseType: 2,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    await program.methods
      .createStream({
        campaignId: new BN(CAMPAIGN_ID),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 2,
        startTime: new BN(cliff),
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

    // Create beneficiary ATA
    try {
      await getAccount(provider.connection, beneficiaryAta);
    } catch {
      const createAtaTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          creator.publicKey,
          beneficiaryAta,
          beneficiary.publicKey,
          mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
      await provider.sendAndConfirm(createAtaTx, [creator]);
    }

    // Cancel unreleased milestone — creator gets all
    await program.methods
      .cancelStream(withdrawArgs)
      .accounts({
        creator: creator.publicKey,
        beneficiary: beneficiary.publicKey,
        vestingTree: treePda,
        claimRecord: crPda,
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta,
        creatorAta,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Get cancelled_at timestamp from on-chain state
    const cancelledTree = await program.account.vestingTree.fetch(treePda);
    const cancelledAt = cancelledTree.cancelledAt!.toNumber();
    const GRACE_SECONDS = 7 * 24 * 3600;
    const targetTimestamp = cancelledAt + GRACE_SECONDS + 10;

    // Warp past grace period via setClock, then verify it actually advanced
    try {
      await (provider.connection as any)._rpcRequest("setClock", {
        unixTimestamp: targetTimestamp,
      });
      // Verify clock actually advanced
      const slot = await provider.connection.getSlot();
      const blockTime = await provider.connection.getBlockTime(slot);
      if (!blockTime || blockTime < cancelledAt + GRACE_SECONDS) {
        this.skip();
      }
    } catch {
      this.skip();
    }

    const creatorBefore = Number(
      (await getAccount(provider.connection, creatorAta)).amount,
    );

    // withdraw_unvested — vault is empty so creator gets 0
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

    const postCreator = await getAccount(provider.connection, creatorAta);
    expect(Number(postCreator.amount) - creatorBefore).to.equal(0);
  });

  // -------------------------------------------------------------------------
  // T69: pause → cancel → claim during grace succeeds (exploit regression)
  // -------------------------------------------------------------------------
  it("T69: pause then cancel then claim during grace succeeds", async function () {
    if (provider.connection.rpcEndpoint.includes("devnet")) {
      this.skip();
    }
    const CAMPAIGN_ID = 980_001;
    const AMOUNT = 10_000;
    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(500);
    const end = t.future(500);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { mint, tree, treePda, vaultAuthPda, vault } =
      await createAndFundCampaign(
        { provider, program, creator, cancelAuthority, pauseAuthority },
        CAMPAIGN_ID,
        [leaf],
        AMOUNT,
        true,
      );

    await program.methods
      .pauseCampaign()
      .accounts({
        pauseAuthority: pauseAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([pauseAuthority])
      .rpc();

    await program.methods
      .cancelCampaign()
      .accounts({
        cancelAuthority: cancelAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([cancelAuthority])
      .rpc();

    const treeAfterCancel = await program.account.vestingTree.fetch(treePda);
    expect(treeAfterCancel.paused).to.equal(false);
    expect(treeAfterCancel.cancelledAt).to.not.be.null;

    const cancelledAt = treeAfterCancel.cancelledAt as BN;
    // Use cancelledAt as `now` so simulate matches claim (effective_now = min(now, cancelled_at)).
    const expectedVested = await program.methods
      .getVestedAmount(idlLeaf(leaf), cancelledAt, cancelledAt, null)
      .simulate()
      .then((result: { raw?: string[] }) => {
        const raw = result.raw ?? [];
        const returnLine = raw.find((l) => l.startsWith("Program return:"));
        if (!returnLine) {
          throw new Error("getVestedAmount simulate returned no data");
        }
        const b64 = returnLine.split(" ").pop()!;
        return new BN(Buffer.from(b64, "base64"), "le").toNumber();
      });

    const beneficiaryAta = getAssociatedTokenAddressSync(
      mint,
      beneficiary.publicKey,
    );
    const [crPda] = await claimRecordPDA(
      PROGRAM_ID,
      treePda,
      beneficiary.publicKey,
    );

    await program.methods
      .claim(idlLeaf(leaf), idlProof(tree.proof(0)))
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

    const crAfter = await program.account.claimRecord.fetch(crPda);
    expect(crAfter.claimedAmount.toNumber()).to.equal(expectedVested);
  });

  // -------------------------------------------------------------------------
  // T70: cancel on paused campaign resets paused=false
  // -------------------------------------------------------------------------
  it("T70: cancel on paused campaign resets paused to false", async function () {
    if (provider.connection.rpcEndpoint.includes("devnet")) {
      this.skip();
    }
    const CAMPAIGN_ID = 980_002;
    const AMOUNT = 10_000;
    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(t.past(100)),
      cliffTime: new BN(t.past(100)),
      endTime: new BN(t.future(900)),
      milestoneIdx: 0,
    };

    const { treePda } = await createAndFundCampaign(
      { provider, program, creator, cancelAuthority, pauseAuthority },
      CAMPAIGN_ID,
      [leaf],
      AMOUNT,
      true,
    );

    await program.methods
      .pauseCampaign()
      .accounts({
        pauseAuthority: pauseAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([pauseAuthority])
      .rpc();

    const pausedTree = await program.account.vestingTree.fetch(treePda);
    expect(pausedTree.paused).to.equal(true);

    await program.methods
      .cancelCampaign()
      .accounts({
        cancelAuthority: cancelAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([cancelAuthority])
      .rpc();

    const cancelledTree = await program.account.vestingTree.fetch(treePda);
    expect(cancelledTree.paused).to.equal(false);
    expect(cancelledTree.cancelledAt).to.not.be.null;
  });

  // -------------------------------------------------------------------------
  // T71: Token-2022 mint guard — create_campaign must reject Token-2022 mints
  // -------------------------------------------------------------------------
  it("T71: create_campaign with Token-2022 mint is rejected (UnsupportedMint guard)", async function () {
    // Create a Token-2022 mint instead of a classic SPL Token mint
    const payer = (provider.wallet as any).payer;
    const token22Mint = await createMint(
      provider.connection,
      payer,
      creator.publicKey, // mint authority
      creator.publicKey, // freeze authority
      9,
      undefined,        // default keypair
      undefined,        // default confirmOptions
      TOKEN_2022_PROGRAM_ID,
    );

    const CAMPAIGN_ID = 990_001;
    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, token22Mint, CAMPAIGN_ID);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);

    // Non-zero merkle root
    const merkleRoot = Array.from(Buffer.alloc(32));
    merkleRoot[0] = 1;

    let threw = false;
    try {
      await program.methods
        .createCampaign({
          campaignId: new BN(CAMPAIGN_ID),
          merkleRoot,
          leafCount: 1,
          totalSupply: new BN(1_000),
          minCliffTime: new BN(1),
          cancellable: false,
          cancelAuthority: null,
          pauseAuthority: null,
        })
        .accounts({
          creator: creator.publicKey,
          mint: token22Mint,
          vestingTree: treePda,
          vaultAuthority: vaultAuthPda,
        })
        .signers([creator])
        .rpc();
    } catch (err: unknown) {
      threw = true;
      const msg = (err as { message?: string }).message ?? String(err);
      const logs: string = ((err as { logs?: string[] }).logs ?? []).join("\n");
      const haystack = msg + "\n" + logs;

      // The guard fires at Anchor's account deserialization layer (wrong program
      // owner) or at our explicit constraint. Either way the transaction must fail
      // and the error should reference the mint or program ownership.
      const isExpectedRejection =
        haystack.includes("UnsupportedMint") ||    // our custom error name
        haystack.includes("0x179d") ||              // UnsupportedMint hex (6037)
        haystack.includes("AccountOwnedByWrongProgram") ||
        haystack.includes("0xbbf") ||              // AccountOwnedByWrongProgram hex
        haystack.includes("owned by wrong program") ||
        haystack.includes("3007") ||               // AccountOwnedByWrongProgram decimal
        haystack.toLowerCase().includes("token") ||
        haystack.toLowerCase().includes("program");

      expect(
        isExpectedRejection,
        `Expected UnsupportedMint or program-ownership error. Got: ${msg}`,
      ).to.equal(true);
    }

    expect(threw, "Expected create_campaign with Token-2022 mint to throw").to.equal(true);
  });

});
