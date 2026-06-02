import { describe, expect, it, beforeAll } from "vitest";
import { Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import { VESTING_ERROR_CODES } from "@/lib/anchor/errors";
import {
  cancelSingleStream,
  cancelStream,
  claimSingleStream,
  claimWithProof,
  closeClaimRecord,
  createBulkCampaignFixture,
  createSingleStreamFixture,
  currentUnix,
  ensureSol,
  expectErrorCode,
  fetchClaimRecord,
  fetchTree,
  fundCampaign,
  getDevnetConnection,
  loadKeypairFromEnv,
  makeProgram,
  pauseStream,
  setMilestoneReleased,
  tokenBalance,
  uiAmountToRaw,
  unpauseStream,
  updateRoot,
  withdrawUnvested,
} from "./devnet-helpers";

const hasDevnetKeypair = Boolean(process.env.DEVNET_KEYPAIR);
const describeDevnet = hasDevnetKeypair ? describe : describe.skip;
const TEST_TIMEOUT = 180_000;

describeDevnet("extended vesting flows", () => {
  const connection = getDevnetConnection();
  let creator!: Keypair;

  beforeAll(async () => {
    creator = loadKeypairFromEnv();
    await ensureSol(connection, creator);
  }, TEST_TIMEOUT);

  // =========================================================================
  // Unpause flows
  // =========================================================================

  describe("unpause", () => {
    it("unpause then claim succeeds", async () => {
      const now = currentUnix();
      const beneficiary = Keypair.generate();
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary,
        amountRaw: uiAmountToRaw(500),
        releaseType: 0,
        startTime: now - 300,
        cliffTime: now - 60,
        endTime: now - 60,
        milestoneIdx: 0,
      });

      await pauseStream(connection, creator, fixture.treePubkey);
      const treePaused = await fetchTree(connection, fixture.treePubkey);
      expect(treePaused.paused).toBe(true);

      await unpauseStream(connection, creator, fixture.treePubkey);
      const treeUnpaused = await fetchTree(connection, fixture.treePubkey);
      expect(treeUnpaused.paused).toBe(false);

      const { beneficiaryAta } = await claimSingleStream(connection, fixture);
      const bal = await tokenBalance(connection, beneficiaryAta);
      expect(bal).toBe(Number(fixture.amountRaw));
    }, TEST_TIMEOUT);

    it("unpause non-paused fails with NotPaused", async () => {
      const now = currentUnix();
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary: creator,
        amountRaw: uiAmountToRaw(100),
        releaseType: 0,
        startTime: now - 60,
        cliffTime: now + 3600,
        endTime: now + 3600,
        milestoneIdx: 0,
      });

      try {
        await unpauseStream(connection, creator, fixture.treePubkey);
        throw new Error("Expected unpause on non-paused to fail");
      } catch (error) {
        expectErrorCode(error, VESTING_ERROR_CODES.NotPaused);
      }
    }, TEST_TIMEOUT);

    it("outsider unpause fails with Unauthorized", async () => {
      const now = currentUnix();
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary: creator,
        amountRaw: uiAmountToRaw(100),
        releaseType: 0,
        startTime: now - 60,
        cliffTime: now + 3600,
        endTime: now + 3600,
        milestoneIdx: 0,
      });

      await pauseStream(connection, creator, fixture.treePubkey);

      try {
        await unpauseStream(connection, fixture.outsider, fixture.treePubkey);
        throw new Error("Expected outsider unpause to fail");
      } catch (error) {
        expectErrorCode(error, VESTING_ERROR_CODES.Unauthorized);
      }
    }, TEST_TIMEOUT);

    it("double pause fails with AlreadyPaused", async () => {
      const now = currentUnix();
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary: creator,
        amountRaw: uiAmountToRaw(100),
        releaseType: 0,
        startTime: now - 60,
        cliffTime: now + 3600,
        endTime: now + 3600,
        milestoneIdx: 0,
      });

      await pauseStream(connection, creator, fixture.treePubkey);

      try {
        await pauseStream(connection, creator, fixture.treePubkey);
        throw new Error("Expected double pause to fail");
      } catch (error) {
        expectErrorCode(error, VESTING_ERROR_CODES.AlreadyPaused);
      }
    }, TEST_TIMEOUT);
  });

  // =========================================================================
  // Linear full claim
  // =========================================================================

  describe("linear: full claim", () => {
    it("claim after end time yields full amount", async () => {
      const now = currentUnix();
      const beneficiary = Keypair.generate();
      const amountRaw = uiAmountToRaw(2000);
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary,
        amountRaw,
        releaseType: 1,
        startTime: now - 7200,
        cliffTime: now - 3600,
        endTime: now - 120,
        milestoneIdx: 0,
      });

      const { beneficiaryAta } = await claimSingleStream(connection, fixture);
      const claimRecord = await fetchClaimRecord(
        connection,
        beneficiary.publicKey,
        fixture.treePubkey,
      );

      expect(claimRecord.claimedAmount.toString()).toBe(amountRaw);
      expect(await tokenBalance(connection, beneficiaryAta)).toBe(Number(amountRaw));
    }, TEST_TIMEOUT);
  });

  // =========================================================================
  // Cancel + claim vested portion
  // =========================================================================

  describe("cancel + claim vested", () => {
    it("beneficiary claims vested portion after cancel", async () => {
      const now = currentUnix();
      const beneficiary = Keypair.generate();
      const amountRaw = uiAmountToRaw(1000);
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary,
        amountRaw,
        releaseType: 1,
        startTime: now - 3600,
        cliffTime: now - 1800,
        endTime: now + 3600,
        milestoneIdx: 0,
      });

      await cancelStream(connection, creator, fixture.treePubkey);

      const { beneficiaryAta } = await claimSingleStream(connection, fixture);
      const claimRecord = await fetchClaimRecord(
        connection,
        beneficiary.publicKey,
        fixture.treePubkey,
      );
      const claimed = Number(claimRecord.claimedAmount.toString());

      expect(claimed).toBeGreaterThan(0);
      expect(claimed).toBeLessThan(Number(amountRaw));
    }, TEST_TIMEOUT);
  });

  // =========================================================================
  // Withdraw unvested
  // =========================================================================

  describe("withdraw unvested", () => {
    it("withdraw before cancel fails with NotCancelled", async () => {
      const now = currentUnix();
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary: creator,
        amountRaw: uiAmountToRaw(500),
        releaseType: 0,
        startTime: now - 60,
        cliffTime: now + 3600,
        endTime: now + 3600,
        milestoneIdx: 0,
      });

      try {
        await withdrawUnvested(connection, creator, fixture);
        throw new Error("Expected withdraw before cancel to fail");
      } catch (error) {
        expectErrorCode(error, VESTING_ERROR_CODES.NotCancelled);
      }
    }, TEST_TIMEOUT);

    it("withdraw right after cancel fails with GracePeriodActive", async () => {
      const now = currentUnix();
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary: creator,
        amountRaw: uiAmountToRaw(500),
        releaseType: 0,
        startTime: now - 60,
        cliffTime: now + 3600,
        endTime: now + 3600,
        milestoneIdx: 0,
      });

      await cancelStream(connection, creator, fixture.treePubkey);

      try {
        await withdrawUnvested(connection, creator, fixture);
        throw new Error("Expected withdraw during grace period to fail");
      } catch (error) {
        expectErrorCode(error, VESTING_ERROR_CODES.GracePeriodActive);
      }
    }, TEST_TIMEOUT);
  });

  // =========================================================================
  // Non-cancellable stream
  // =========================================================================

  describe("non-cancellable stream", () => {
    it("cancel non-cancellable fails with NotCancellable", async () => {
      const now = currentUnix();
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary: creator,
        amountRaw: uiAmountToRaw(300),
        releaseType: 0,
        startTime: now - 60,
        cliffTime: now + 3600,
        endTime: now + 3600,
        milestoneIdx: 0,
        cancellable: false,
      });

      try {
        await cancelStream(connection, creator, fixture.treePubkey);
        throw new Error("Expected cancel on non-cancellable to fail");
      } catch (error) {
        expectErrorCode(error, VESTING_ERROR_CODES.NotCancellable);
      }
    }, TEST_TIMEOUT);
  });

  // =========================================================================
  // Fully vested cancel
  // =========================================================================

  describe("fully claimed cancel", () => {
    it("cancel after full claim fails with FullyVested", async () => {
      const now = currentUnix();
      const beneficiary = Keypair.generate();
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary,
        amountRaw: uiAmountToRaw(200),
        releaseType: 0,
        startTime: now - 300,
        cliffTime: now - 60,
        endTime: now - 60,
        milestoneIdx: 0,
      });

      await claimSingleStream(connection, fixture);

      try {
        await cancelStream(connection, creator, fixture.treePubkey);
        throw new Error("Expected cancel after full claim to fail");
      } catch (error) {
        expectErrorCode(error, VESTING_ERROR_CODES.FullyVested);
      }
    }, TEST_TIMEOUT);
  });

  // =========================================================================
  // Milestone advanced flows
  // =========================================================================

  describe("milestone: advanced", () => {
    it("double release same milestone fails with MilestoneAlreadyReleased", async () => {
      const now = currentUnix();
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary: creator,
        amountRaw: uiAmountToRaw(100),
        releaseType: 2,
        startTime: now - 300,
        cliffTime: now - 60,
        endTime: now - 60,
        milestoneIdx: 0,
      });

      await setMilestoneReleased(connection, fixture, 0);

      try {
        await setMilestoneReleased(connection, fixture, 0);
        throw new Error("Expected double release to fail");
      } catch (error) {
        expectErrorCode(error, VESTING_ERROR_CODES.MilestoneAlreadyReleased);
      }
    }, TEST_TIMEOUT);

    it("outsider cannot release milestone", async () => {
      const now = currentUnix();
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary: creator,
        amountRaw: uiAmountToRaw(100),
        releaseType: 2,
        startTime: now - 300,
        cliffTime: now - 60,
        endTime: now - 60,
        milestoneIdx: 0,
      });

      const outsiderProgram = makeProgram(connection, fixture.outsider);
      try {
        await outsiderProgram.methods
          .setMilestoneReleased(0)
          .accounts({
            creator: fixture.outsider.publicKey,
            vestingTree: fixture.treePubkey,
          })
          .rpc();
        throw new Error("Expected outsider release to fail");
      } catch (error) {
        expectErrorCode(error, VESTING_ERROR_CODES.Unauthorized);
      }
    }, TEST_TIMEOUT);

    it("milestone released flags persist across multiple releases", async () => {
      const now = currentUnix();
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary: creator,
        amountRaw: uiAmountToRaw(100),
        releaseType: 2,
        startTime: now - 300,
        cliffTime: now - 60,
        endTime: now - 60,
        milestoneIdx: 0,
      });

      await setMilestoneReleased(connection, fixture, 0);
      await setMilestoneReleased(connection, fixture, 1);
      await setMilestoneReleased(connection, fixture, 2);

      const tree = await fetchTree(connection, fixture.treePubkey);
      expect(tree.milestoneReleasedFlags[0] & 0b111).toBe(0b111);
    }, TEST_TIMEOUT);
  });

  // =========================================================================
  // Close claim record
  // =========================================================================

  describe("close claim record", () => {
    it("close after full cliff claim succeeds", async () => {
      const now = currentUnix();
      const beneficiary = Keypair.generate();
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary,
        amountRaw: uiAmountToRaw(400),
        releaseType: 0,
        startTime: now - 300,
        cliffTime: now - 60,
        endTime: now - 60,
        milestoneIdx: 0,
      });

      await claimSingleStream(connection, fixture);
      await closeClaimRecord(connection, beneficiary, fixture.treePubkey);

      try {
        await fetchClaimRecord(connection, beneficiary.publicKey, fixture.treePubkey);
        throw new Error("Claim record should be closed");
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        expect(msg).toMatch(/does not exist|Account does not exist/);
      }
    }, TEST_TIMEOUT);

    it("close before full claim fails with CannotClose", async () => {
      const now = currentUnix();
      const beneficiary = Keypair.generate();
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary,
        amountRaw: uiAmountToRaw(1000),
        releaseType: 1,
        startTime: now - 3600,
        cliffTime: now - 600,
        endTime: now + 3600,
        milestoneIdx: 0,
      });

      await claimSingleStream(connection, fixture);

      try {
        await closeClaimRecord(connection, beneficiary, fixture.treePubkey);
        throw new Error("Expected close on partial claim to fail");
      } catch (error) {
        expectErrorCode(error, VESTING_ERROR_CODES.CannotClose);
      }
    }, TEST_TIMEOUT);
  });

  // =========================================================================
  // Token balance verification
  // =========================================================================

  describe("token balance tracking", () => {
    it("vault decreases and beneficiary increases on claim", async () => {
      const now = currentUnix();
      const beneficiary = Keypair.generate();
      const amountRaw = uiAmountToRaw(800);
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary,
        amountRaw,
        releaseType: 0,
        startTime: now - 300,
        cliffTime: now - 60,
        endTime: now - 60,
        milestoneIdx: 0,
      });

      const vaultBefore = await tokenBalance(connection, fixture.vault);
      expect(vaultBefore).toBe(Number(amountRaw));

      const { beneficiaryAta } = await claimSingleStream(connection, fixture);
      const vaultAfter = await tokenBalance(connection, fixture.vault);
      const beneficiaryBal = await tokenBalance(connection, beneficiaryAta);

      expect(vaultAfter).toBe(0);
      expect(beneficiaryBal).toBe(Number(amountRaw));
    }, TEST_TIMEOUT);

    it("partial linear claim: vault + beneficiary = total supply", async () => {
      const now = currentUnix();
      const beneficiary = Keypair.generate();
      const amountRaw = uiAmountToRaw(1000);
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary,
        amountRaw,
        releaseType: 1,
        startTime: now - 3600,
        cliffTime: now - 1800,
        endTime: now + 3600,
        milestoneIdx: 0,
      });

      const { beneficiaryAta } = await claimSingleStream(connection, fixture);
      const vaultAfter = await tokenBalance(connection, fixture.vault);
      const beneficiaryBal = await tokenBalance(connection, beneficiaryAta);

      expect(vaultAfter + beneficiaryBal).toBe(Number(amountRaw));
      expect(beneficiaryBal).toBeGreaterThan(0);
      expect(vaultAfter).toBeGreaterThan(0);
    }, TEST_TIMEOUT);
  });

  // =========================================================================
  // Pause authority validation
  // =========================================================================

  describe("pause authority", () => {
    it("outsider pause fails with Unauthorized", async () => {
      const now = currentUnix();
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary: creator,
        amountRaw: uiAmountToRaw(100),
        releaseType: 0,
        startTime: now - 60,
        cliffTime: now + 3600,
        endTime: now + 3600,
        milestoneIdx: 0,
      });

      try {
        await pauseStream(connection, fixture.outsider, fixture.treePubkey);
        throw new Error("Expected outsider pause to fail");
      } catch (error) {
        expectErrorCode(error, VESTING_ERROR_CODES.Unauthorized);
      }
    }, TEST_TIMEOUT);
  });

  // =========================================================================
  // Cancel stream (single-stream instant settle)
  // =========================================================================

  describe("cancel stream (instant settle)", () => {
    it("cancel single stream before cliff refunds to creator", async () => {
      const now = currentUnix();
      const beneficiary = Keypair.generate();
      const amountRaw = uiAmountToRaw(600);
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary,
        amountRaw,
        releaseType: 0,
        startTime: now - 60,
        cliffTime: now + 7200,
        endTime: now + 7200,
        milestoneIdx: 0,
      });

      const creatorBalBefore = await tokenBalance(connection, fixture.creatorAta);
      await cancelSingleStream(connection, creator, fixture);

      const tree = await fetchTree(connection, fixture.treePubkey);
      expect(tree.cancelledAt).not.toBeNull();

      const creatorBalAfter = await tokenBalance(connection, fixture.creatorAta);
      expect(creatorBalAfter).toBeGreaterThan(creatorBalBefore);
    }, TEST_TIMEOUT);

    it("cancel single stream mid-linear splits between beneficiary and creator", async () => {
      const now = currentUnix();
      const beneficiary = Keypair.generate();
      const amountRaw = uiAmountToRaw(1000);
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary,
        amountRaw,
        releaseType: 1,
        startTime: now - 3600,
        cliffTime: now - 1800,
        endTime: now + 3600,
        milestoneIdx: 0,
      });

      const creatorBalBefore = await tokenBalance(connection, fixture.creatorAta);
      await cancelSingleStream(connection, creator, fixture);

      const beneficiaryAta = getAssociatedTokenAddressSync(
        fixture.mint,
        fixture.beneficiary.publicKey,
      );

      const beneficiaryBal = await tokenBalance(connection, beneficiaryAta);
      const creatorBalAfter = await tokenBalance(connection, fixture.creatorAta);
      const creatorGot = creatorBalAfter - creatorBalBefore;

      expect(beneficiaryBal).toBeGreaterThan(0);
      expect(creatorGot).toBeGreaterThan(0);
      expect(beneficiaryBal + creatorGot).toBe(Number(amountRaw));
    }, TEST_TIMEOUT);
  });

  // =========================================================================
  // Bulk campaign (Merkle tree) flows
  // =========================================================================

  describe("bulk campaign (merkle)", () => {
    it("create bulk campaign with 3 beneficiaries", async () => {
      const now = currentUnix();
      const beneficiaries = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
      const amounts = [uiAmountToRaw(100), uiAmountToRaw(200), uiAmountToRaw(300)];

      const fixture = await createBulkCampaignFixture(connection, {
        creator,
        beneficiaries,
        amounts,
        releaseType: 0,
        startTime: now - 300,
        cliffTime: now - 60,
        endTime: now - 60,
      });

      const tree = await fetchTree(connection, fixture.treePubkey);
      expect(tree.leafCount).toBe(3);
      expect(tree.totalSupply.toString()).toBe(fixture.totalSupplyRaw);
    }, TEST_TIMEOUT);

    it("claim with valid proof succeeds", async () => {
      const now = currentUnix();
      const beneficiaries = [Keypair.generate(), Keypair.generate()];
      const amounts = [uiAmountToRaw(500), uiAmountToRaw(700)];

      const fixture = await createBulkCampaignFixture(connection, {
        creator,
        beneficiaries,
        amounts,
        releaseType: 0,
        startTime: now - 300,
        cliffTime: now - 60,
        endTime: now - 60,
      });

      const { beneficiaryAta } = await claimWithProof(
        connection,
        beneficiaries[0],
        fixture,
        0,
      );

      const bal = await tokenBalance(connection, beneficiaryAta);
      expect(bal).toBe(Number(amounts[0]));
    }, TEST_TIMEOUT);

    it("claim with wrong beneficiary fails", async () => {
      const now = currentUnix();
      const beneficiaries = [Keypair.generate(), Keypair.generate()];
      const amounts = [uiAmountToRaw(100), uiAmountToRaw(200)];

      const fixture = await createBulkCampaignFixture(connection, {
        creator,
        beneficiaries,
        amounts,
        releaseType: 0,
        startTime: now - 300,
        cliffTime: now - 60,
        endTime: now - 60,
      });

      try {
        await claimWithProof(connection, beneficiaries[1], fixture, 0);
        throw new Error("Expected wrong beneficiary claim to fail");
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        expect(msg).not.toBe("Expected wrong beneficiary claim to fail");
      }
    }, TEST_TIMEOUT);

    it("all beneficiaries can claim independently", async () => {
      const now = currentUnix();
      const beneficiaries = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
      const amounts = [uiAmountToRaw(111), uiAmountToRaw(222), uiAmountToRaw(333)];

      const fixture = await createBulkCampaignFixture(connection, {
        creator,
        beneficiaries,
        amounts,
        releaseType: 0,
        startTime: now - 300,
        cliffTime: now - 60,
        endTime: now - 60,
      });

      for (let i = 0; i < beneficiaries.length; i++) {
        const { beneficiaryAta } = await claimWithProof(
          connection,
          beneficiaries[i],
          fixture,
          i,
        );
        const bal = await tokenBalance(connection, beneficiaryAta);
        expect(bal).toBe(Number(amounts[i]));
      }

      const vaultBal = await tokenBalance(connection, fixture.vault);
      expect(vaultBal).toBe(0);
    }, TEST_TIMEOUT);

    it("bulk milestone campaign: release then claim", async () => {
      const now = currentUnix();
      const beneficiaries = [Keypair.generate(), Keypair.generate()];
      const amounts = [uiAmountToRaw(400), uiAmountToRaw(600)];

      const fixture = await createBulkCampaignFixture(connection, {
        creator,
        beneficiaries,
        amounts,
        releaseType: 2,
        startTime: now - 300,
        cliffTime: now - 60,
        endTime: now - 60,
        milestoneIdxs: [0, 0],
      });

      const creatorProgram = makeProgram(connection, creator);
      await creatorProgram.methods
        .setMilestoneReleased(0)
        .accounts({
          creator: creator.publicKey,
          vestingTree: fixture.treePubkey,
        })
        .rpc();

      const { beneficiaryAta } = await claimWithProof(
        connection,
        beneficiaries[0],
        fixture,
        0,
      );
      const bal = await tokenBalance(connection, beneficiaryAta);
      expect(bal).toBe(Number(amounts[0]));
    }, TEST_TIMEOUT);

    it("bulk campaign: claim before milestone release fails", async () => {
      const now = currentUnix();
      const beneficiaries = [Keypair.generate()];
      const amounts = [uiAmountToRaw(100)];

      const fixture = await createBulkCampaignFixture(connection, {
        creator,
        beneficiaries,
        amounts,
        releaseType: 2,
        startTime: now - 300,
        cliffTime: now - 60,
        endTime: now - 60,
        milestoneIdxs: [0],
      });

      try {
        await claimWithProof(connection, beneficiaries[0], fixture, 0);
        throw new Error("Expected claim before release to fail");
      } catch (error) {
        expectErrorCode(error, VESTING_ERROR_CODES.MilestoneNotReleased);
      }
    }, TEST_TIMEOUT);
  });

  // =========================================================================
  // Cancelled campaign claim behavior
  // =========================================================================

  describe("cancelled campaign", () => {
    it("claim on cancelled campaign still works (for vested portion)", async () => {
      const now = currentUnix();
      const beneficiary = Keypair.generate();
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary,
        amountRaw: uiAmountToRaw(500),
        releaseType: 0,
        startTime: now - 300,
        cliffTime: now - 60,
        endTime: now - 60,
        milestoneIdx: 0,
      });

      await cancelStream(connection, creator, fixture.treePubkey);

      const { beneficiaryAta } = await claimSingleStream(connection, fixture);
      const bal = await tokenBalance(connection, beneficiaryAta);
      expect(bal).toBe(Number(fixture.amountRaw));
    }, TEST_TIMEOUT);
  });

  // =========================================================================
  // Multiple sequential claims (linear)
  // =========================================================================

  describe("sequential claims", () => {
    it("two sequential partial claims accumulate correctly", async () => {
      const now = currentUnix();
      const beneficiary = Keypair.generate();
      const amountRaw = uiAmountToRaw(10000);
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary,
        amountRaw,
        releaseType: 1,
        startTime: now - 7200,
        cliffTime: now - 3600,
        endTime: now + 7200,
        milestoneIdx: 0,
      });

      await claimSingleStream(connection, fixture);
      const record1 = await fetchClaimRecord(
        connection,
        beneficiary.publicKey,
        fixture.treePubkey,
      );
      const claimed1 = Number(record1.claimedAmount.toString());
      expect(claimed1).toBeGreaterThan(0);

      // Wait a bit for more tokens to vest
      await new Promise((r) => setTimeout(r, 3000));

      await claimSingleStream(connection, fixture);
      const record2 = await fetchClaimRecord(
        connection,
        beneficiary.publicKey,
        fixture.treePubkey,
      );
      const claimed2 = Number(record2.claimedAmount.toString());
      expect(claimed2).toBeGreaterThan(claimed1);
      expect(claimed2).toBeLessThan(Number(amountRaw));
    }, TEST_TIMEOUT);
  });

  // =========================================================================
  // Cliff claim before start time
  // =========================================================================

  describe("edge cases", () => {
    it("cliff with same start/cliff/end in past = full claim", async () => {
      const now = currentUnix();
      const beneficiary = Keypair.generate();
      const amountRaw = uiAmountToRaw(999);
      const past = now - 300;
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary,
        amountRaw,
        releaseType: 0,
        startTime: past,
        cliffTime: past,
        endTime: past,
        milestoneIdx: 0,
      });

      const { beneficiaryAta } = await claimSingleStream(connection, fixture);
      expect(await tokenBalance(connection, beneficiaryAta)).toBe(Number(amountRaw));
    }, TEST_TIMEOUT);

    it("linear claim with cliff = start time works", async () => {
      const now = currentUnix();
      const beneficiary = Keypair.generate();
      const amountRaw = uiAmountToRaw(500);
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary,
        amountRaw,
        releaseType: 1,
        startTime: now - 3600,
        cliffTime: now - 3600,
        endTime: now - 60,
        milestoneIdx: 0,
      });

      const { beneficiaryAta } = await claimSingleStream(connection, fixture);
      expect(await tokenBalance(connection, beneficiaryAta)).toBe(Number(amountRaw));
    }, TEST_TIMEOUT);

    it("zero amount stream fails during creation", async () => {
      const now = currentUnix();
      try {
        await createSingleStreamFixture(connection, {
          creator,
          beneficiary: creator,
          amountRaw: "0",
          releaseType: 0,
          startTime: now - 60,
          cliffTime: now + 3600,
          endTime: now + 3600,
          milestoneIdx: 0,
        });
        throw new Error("Expected zero amount to fail");
      } catch (error) {
        expectErrorCode(error, VESTING_ERROR_CODES.ZeroAmount);
      }
    }, TEST_TIMEOUT);
  });

  // =========================================================================
  // Fund campaign (additional funding)
  // =========================================================================

  describe("fund campaign", () => {
    it("overfunding fails with OverFunded", async () => {
      const now = currentUnix();
      const fixture = await createSingleStreamFixture(connection, {
        creator,
        beneficiary: creator,
        amountRaw: uiAmountToRaw(500),
        releaseType: 0,
        startTime: now - 60,
        cliffTime: now + 3600,
        endTime: now + 3600,
        milestoneIdx: 0,
      });

      try {
        await fundCampaign(
          connection,
          creator,
          fixture.treePubkey,
          fixture.vault,
          fixture.creatorAta,
          new BN(uiAmountToRaw(1)),
        );
        throw new Error("Expected overfund to fail");
      } catch (error) {
        expectErrorCode(error, VESTING_ERROR_CODES.OverFunded);
      }
    }, TEST_TIMEOUT);
  });

  // =========================================================================
  // Update root (root rotation)
  // =========================================================================

  describe("update root", () => {
    it("outsider cannot update root", async () => {
      const now = currentUnix();
      const beneficiaries = [Keypair.generate()];
      const amounts = [uiAmountToRaw(100)];

      const fixture = await createBulkCampaignFixture(connection, {
        creator,
        beneficiaries,
        amounts,
        releaseType: 0,
        startTime: now - 300,
        cliffTime: now - 60,
        endTime: now - 60,
      });

      const fakeRoot = Array.from(Buffer.alloc(32, 0xab));

      try {
        await updateRoot(
          connection,
          fixture.outsider,
          fixture.treePubkey,
          fakeRoot,
          2,
        );
        throw new Error("Expected outsider root update to fail");
      } catch (error) {
        expectErrorCode(error, VESTING_ERROR_CODES.Unauthorized);
      }
    }, TEST_TIMEOUT);

    it("same root fails with SameRoot", async () => {
      const now = currentUnix();
      const beneficiaries = [Keypair.generate()];
      const amounts = [uiAmountToRaw(100)];

      const fixture = await createBulkCampaignFixture(connection, {
        creator,
        beneficiaries,
        amounts,
        releaseType: 0,
        startTime: now - 300,
        cliffTime: now - 60,
        endTime: now - 60,
      });

      try {
        await updateRoot(
          connection,
          creator,
          fixture.treePubkey,
          fixture.merkleRoot,
          1,
        );
        throw new Error("Expected same root to fail");
      } catch (error) {
        expectErrorCode(error, VESTING_ERROR_CODES.SameRoot);
      }
    }, TEST_TIMEOUT);
  });
});
