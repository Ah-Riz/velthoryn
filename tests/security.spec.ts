import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddressSync,
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
  NothingToClaim: 6015,
  MilestoneAlreadyClaimed: 6014,
  MilestoneNotReleased: 6032,
  GracePeriodActive: 6026,
  Unauthorized: 6005,
  CampaignCancelled: 6023,
  CampaignPaused: 6009,
  InvalidProof: 6013,
  UnauthorizedClaimer: 6010,
  CannotClose: 6027,
  InsufficientVault: 6016,
} as const;

// ---------------------------------------------------------------------------
// Security Exploit Tests
// ---------------------------------------------------------------------------

describe("security exploit attempts (should all be blocked)", () => {
  const { provider, program, creator, cancelAuthority, pauseAuthority } =
    setup();

  // -------------------------------------------------------------------------
  // EXPLOIT 1: Over-claim
  // Fund campaign with 1M, leaf has 500k. Beneficiary claims twice -- second
  // should fail because the vesting schedule already paid out what was due.
  // -------------------------------------------------------------------------
  it("EXPLOIT 1: over-claim (claim more than leaf amount) -> NothingToClaim", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const TOTAL_FUND = 1_000_000;
    const LEAF_AMOUNT = 500_000;

    // Fully vested: start and end in the past
    const t = await createTimeHelpers(provider.connection);
    const start = t.past(2000);
    const end = t.past(10);

    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary.publicKey,
      amount: new BN(LEAF_AMOUNT),
      releaseType: ReleaseType.Linear,
      startTime: new BN(start),
      cliffTime: new BN(start),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { mint, tree, treePda, vaultAuthPda, vault } =
      await createAndFundCampaign(
        { provider, program, creator, cancelAuthority, pauseAuthority },
        700,
        [leaf],
        TOTAL_FUND,
      );

    // First claim should succeed (full 500k vested)
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

    const beneficiaryAta = getAssociatedTokenAddressSync(
      mint,
      beneficiary.publicKey,
    );
    const afterFirst = await getAccount(provider.connection, beneficiaryAta);
    expect(Number(afterFirst.amount)).to.equal(LEAF_AMOUNT);

    // Second claim attempt -- everything is already claimed -> NothingToClaim
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
      expect.fail("EXPLOIT 1 SUCCEEDED: second claim should have been rejected");
    } catch (e) {
      const msg = (e as Error).message || String(e);
      const logs = ((e as any).logs || []).join("\n");
      const haystack = `${msg}\n${logs}`;
      const isNothing =
        haystack.includes("NothingToClaim") ||
        haystack.includes("6015") ||
        haystack.includes("0x177f");
      const isExpired =
        haystack.includes("StreamExpired") ||
        haystack.includes("6031") ||
        haystack.includes("0x178f");
      expect(isNothing || isExpired, haystack).to.equal(true);
    }
  });

  // -------------------------------------------------------------------------
  // EXPLOIT 2: Wrong beneficiary (Bob claims Alice's leaf)
  // -------------------------------------------------------------------------
  it("EXPLOIT 2: wrong beneficiary claims another's leaf -> UnauthorizedClaimer", async () => {
    const alice = await makeBeneficiary(provider);
    const bob = await makeBeneficiary(provider);
    const AMOUNT = 1_000_000;

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
        701,
        [leaf],
        AMOUNT,
      );

    // Bob tries to claim Alice's leaf with Bob as signer
    try {
      await issueClaim(
        { program },
        leaf,
        tree.proof(0),
        bob, // <-- Bob is the signer, but leaf is for Alice
        treePda,
        vaultAuthPda,
        vault,
        mint,
      );
      expect.fail("EXPLOIT 2 SUCCEEDED: wrong beneficiary should have been rejected");
    } catch (e) {
      expectAnchorError(e, ERR.UnauthorizedClaimer);
    }
  });

  // -------------------------------------------------------------------------
  // EXPLOIT 3: Forged proof (flip a byte in the Merkle proof)
  // Must use a 2-leaf tree so the proof is non-empty.
  // -------------------------------------------------------------------------
  it("EXPLOIT 3: forged Merkle proof -> InvalidProof", async () => {
    const beneficiary0 = await makeBeneficiary(provider);
    const beneficiary1 = await makeBeneficiary(provider);
    const AMOUNT = 2_000_000;

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100);
    const end = t.future(900);

    const leaf0: VestingLeaf = {
      leafIndex: 0,
      beneficiary: beneficiary0.publicKey,
      amount: new BN(1_000_000),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };
    const leaf1: VestingLeaf = {
      leafIndex: 1,
      beneficiary: beneficiary1.publicKey,
      amount: new BN(1_000_000),
      releaseType: ReleaseType.Linear,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    const { mint, tree, treePda, vaultAuthPda, vault } =
      await createAndFundCampaign(
        { provider, program, creator, cancelAuthority, pauseAuthority },
        702,
        [leaf0, leaf1],
        AMOUNT,
      );

    // Corrupt the proof: flip a byte in the first sibling hash
    const validProof = tree.proof(0);
    const forgedProof = validProof.map((buf) => {
      const copy = Buffer.from(buf);
      copy[0] ^= 0xff; // flip first byte
      return copy;
    });

    try {
      await issueClaim(
        { program },
        leaf0,
        forgedProof,
        beneficiary0,
        treePda,
        vaultAuthPda,
        vault,
        mint,
      );
      expect.fail("EXPLOIT 3 SUCCEEDED: forged proof should have been rejected");
    } catch (e) {
      expectAnchorError(e, ERR.InvalidProof);
    }
  });

  // -------------------------------------------------------------------------
  // EXPLOIT 5: Double milestone same index
  // -------------------------------------------------------------------------
  it("EXPLOIT 5: claim same milestone twice -> MilestoneAlreadyClaimed", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 500_000;

    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(100); // cliff already passed

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
        704,
        [leaf],
        AMOUNT,
      );

    await releaseMilestone({ program, creator }, treePda, 0);

    // First claim should succeed
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

    // Second claim of same milestone index -> MilestoneAlreadyClaimed
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
      expect.fail("EXPLOIT 5 SUCCEEDED: double milestone claim should have been rejected");
    } catch (e) {
      expectAnchorError(e, ERR.MilestoneAlreadyClaimed);
    }
  });

  // -------------------------------------------------------------------------
  // EXPLOIT 6: Withdraw before grace period
  // -------------------------------------------------------------------------
  it("EXPLOIT 6: withdraw_unvested before grace period -> GracePeriodActive", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 1_000_000;

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
        705,
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
          creatorAta: getAssociatedTokenAddressSync(mint, creator.publicKey),
        })
        .signers([creator])
        .rpc();
      expect.fail("EXPLOIT 6 SUCCEEDED: withdraw before grace should have been rejected");
    } catch (e) {
      expectAnchorError(e, ERR.GracePeriodActive);
    }
  });

  // -------------------------------------------------------------------------
  // EXPLOIT 7: Fund after cancel
  // -------------------------------------------------------------------------
  it("EXPLOIT 7: fund after campaign cancel -> CampaignCancelled", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 1_000_000;

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

    const { mint, treePda, vault } =
      await createAndFundCampaign(
        { provider, program, creator, cancelAuthority, pauseAuthority },
        706,
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

    // Mint more tokens to creator to attempt a second fund
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);

    // Try to fund after cancel
    try {
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
      expect.fail("EXPLOIT 7 SUCCEEDED: fund after cancel should have been rejected");
    } catch (e) {
      expectAnchorError(e, ERR.CampaignCancelled);
    }
  });

  // -------------------------------------------------------------------------
  // EXPLOIT 8: Non-creator tries to fund
  // The PDA seeds include creator.key(), so a different signer fails the
  // seeds constraint (Anchor error 2006 = 0x7d6) before has_one is checked.
  // -------------------------------------------------------------------------
  it("EXPLOIT 8: non-creator tries to fund -> rejected (ConstraintSeeds)", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 1_000_000;

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

    const { mint, treePda, vault } =
      await createAndFundCampaign(
        { provider, program, creator, cancelAuthority, pauseAuthority },
        707,
        [leaf],
        AMOUNT,
      );

    // Random keypair tries to fund
    const attacker = Keypair.generate();
    await airdrop(provider, attacker.publicKey, 0.01);

    // Mint tokens to attacker so they have tokens to transfer
    await fundCreatorAta(provider, mint, attacker.publicKey, AMOUNT);

    try {
      await program.methods
        .fundCampaign(new BN(AMOUNT))
        .accounts({
          creator: attacker.publicKey,
          vestingTree: treePda,
          vault,
          sourceAta: getAssociatedTokenAddressSync(mint, attacker.publicKey),
        })
        .signers([attacker])
        .rpc();
      expect.fail("EXPLOIT 8 SUCCEEDED: non-creator fund should have been rejected");
    } catch (e) {
      // The PDA seeds include the creator's pubkey, so a different signer
      // causes the seeds constraint to fail (Anchor error 2006 / 0x7d6).
      // This blocks the exploit even before has_one is evaluated.
      const msg = (e as any).message || String(e);
      const logs = ((e as any).logs || []).join("\n");
      const haystack = msg + "\n" + logs;
      // Check for either the hex or decimal form of the error
      const hasError = haystack.includes("2006") || haystack.includes("0x7d6");
      expect(hasError, "expected ConstraintSeeds error (2006 / 0x7d6)").to.be.true;
    }
  });

  // -------------------------------------------------------------------------
  // EXPLOIT 9: Pause after cancel
  // -------------------------------------------------------------------------
  it("EXPLOIT 9: pause after campaign cancel -> CampaignCancelled", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 1_000_000;

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

    const { treePda } =
      await createAndFundCampaign(
        { provider, program, creator, cancelAuthority, pauseAuthority },
        708,
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

    // Try to pause after cancel
    try {
      await program.methods
        .pauseCampaign()
        .accounts({
          pauseAuthority: pauseAuthority.publicKey,
          vestingTree: treePda,
        })
        .signers([pauseAuthority])
        .rpc();
      expect.fail("EXPLOIT 9 SUCCEEDED: pause after cancel should have been rejected");
    } catch (e) {
      expectAnchorError(e, ERR.CampaignCancelled);
    }
  });

  // -------------------------------------------------------------------------
  // EXPLOIT 10: Close claim record prematurely
  // Try to close before fully claimed and before grace period ends
  // -------------------------------------------------------------------------
  it("EXPLOIT 10: close claim record prematurely -> CannotClose", async () => {
    const beneficiary = await makeBeneficiary(provider);
    const AMOUNT = 1_000_000;

    // Mid-stream: ~50% vested. Not fully claimed.
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
        709,
        [leaf],
        AMOUNT,
      );

    // Claim once (gets ~50%, not the full amount)
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

    // Campaign is NOT cancelled, so grace period logic does not apply.
    // The claim record is NOT fully claimed (only ~50% of 1M).
    // Attempting to close should fail with CannotClose.

    const crPda = (
      await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey)
    )[0];

    try {
      await program.methods
        .closeClaimRecord()
        .accounts({
          beneficiary: beneficiary.publicKey,
          vestingTree: treePda,
          claimRecord: crPda,
        })
        .signers([beneficiary])
        .rpc();
      expect.fail("EXPLOIT 10 SUCCEEDED: premature close should have been rejected");
    } catch (e) {
      expectAnchorError(e, ERR.CannotClose);
    }
  });
});
