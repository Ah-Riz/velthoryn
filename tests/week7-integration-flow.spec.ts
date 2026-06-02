/**
 * week7-integration-flow.spec.ts
 *
 * Comprehensive integration tests exercising both the Solana on-chain vesting
 * program AND the Next.js BE API. Uses `solana-bankrun` for on-chain testing
 * and starts a Next.js dev server as a child process for BE API testing.
 *
 * Flow 1: Bulk Send (Merkle 1-to-many) -- multi-leaf claim via proof
 * Flow 2: Transparency (events + dashboard) -- on-chain ops + BE timeline/claims
 * Flow 3: Standard Vesting -- cliff, linear, milestone sub-flows
 * Flow 4: Automatic Clawback -- cancel + grace period + withdraw_unvested
 */
import { BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
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
import { spawn, ChildProcess } from "child_process";
import { resolve } from "path";

import {
  startTest,
  warpClock,
  bankrunNow,
  treePDA,
  claimRecordPDA,
  vaultAuthorityPDA,
} from "./utils/bankrun";
import { PROGRAM_ID } from "./utils/setup";
import { idlLeaf, idlProof, expectAnchorError } from "./utils/helpers";
import {
  ReleaseType,
  VestingMerkleTree,
  type VestingLeaf,
  prepareCampaign,
} from "../clients/ts/src";
import {
  beGet,
  bePost,
  indexCampaign,
  type IndexCampaignOpts,
  cleanBeDatabase,
  closeDb,
  seedClaimEvent,
  seedCancelEvent,
  seedPauseEvent,
  seedWithdrawEvent,
  seedMilestoneEvent,
  seedStreamCancelEvent,
  updateCampaignTotalClaimed,
  updateCampaignCancelledAt,
  updateCampaignPaused,
  BE_BASE,
  createTestAuthHeader,
} from "./utils/be-api";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRACE_PERIOD_SECS = 7 * 24 * 60 * 60; // 604800

const ERR = {
  NothingToClaim: 6015,
  GracePeriodActive: 6027,
  MilestoneNotReleased: 6033,
  InvalidProof: 6013,
  CampaignPaused: 6009,
  CampaignCancelled: 6023,
  OverFunded: 6006,
  AlreadyCancelled: 6020,
  AlreadyPaused: 6022,
  NotCancellable: 6019,
  NotPaused: 6024,
} as const;

// ---------------------------------------------------------------------------
// Bankrun SPL Token helpers (bankrun does not support spl-token convenience fns)
// ---------------------------------------------------------------------------

async function createTestMintTx(
  provider: any,
  authority: PublicKey,
): Promise<{ mint: PublicKey; mintKp: Keypair }> {
  const mintKp = Keypair.generate();
  const payer = (provider.wallet as Wallet).payer;
  const lamports = await provider.connection.getMinimumBalanceForRentExemption(
    MINT_SIZE,
  );
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
  amount: number,
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner);
  const payer = (provider.wallet as Wallet).payer;
  const tx = new Transaction();
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
  tx.add(
    createMintToInstruction(mint, ata, payer.publicKey, amount, [], TOKEN_PROGRAM_ID),
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
// BE server lifecycle
// ---------------------------------------------------------------------------

let beServer: ChildProcess | null = null;

async function startBeServer(): Promise<void> {
  if (process.env.BE_API_URL) return; // external server already running
  // Skip server startup entirely when pnpm or DATABASE_URL are unavailable
  if (!process.env.DATABASE_URL) return;

  return new Promise<void>((resolveFn, reject) => {
    const webDir = resolve(__dirname, "../../apps/web");
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolveFn();
    };

    try {
      beServer = spawn("pnpm", ["dev", "--port", "3099"], {
        cwd: webDir,
        env: { ...process.env, PORT: "3099", NODE_ENV: "test" },
        stdio: "pipe",
      });
    } catch (e) {
      finish(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    let output = "";
    const check = (data: Buffer) => {
      output += data.toString();
      if (
        output.includes("Ready") ||
        output.includes("Local:") ||
        output.includes("http://localhost")
      ) {
        finish();
      }
    };
    beServer.stdout?.on("data", check);
    beServer.stderr?.on("data", check);
    beServer.on("error", (err) => finish(err));
    setTimeout(
      () => finish(new Error("BE server startup timed out after 30s")),
      30_000,
    );
  });
}

async function stopBeServer(): Promise<void> {
  if (beServer) {
    beServer.kill("SIGTERM");
    await new Promise<void>((r) => {
      beServer?.on("exit", () => r());
      setTimeout(() => r(), 5000);
    });
    beServer = null;
  }
}

// ---------------------------------------------------------------------------
// Helper: convert VestingLeaf to BE indexing format
// ---------------------------------------------------------------------------

function leafToBeFormat(
  leaf: VestingLeaf,
  proof: number[][],
): IndexCampaignOpts["leaves"][number] {
  return {
    leafIndex: leaf.leafIndex,
    beneficiary: leaf.beneficiary.toBase58(),
    amount: leaf.amount.toString(),
    releaseType: leaf.releaseType,
    startTime: leaf.startTime.toString(),
    cliffTime: leaf.cliffTime.toString(),
    endTime: leaf.endTime.toString(),
    milestoneIdx: leaf.milestoneIdx,
    proof,
  };
}

// ---------------------------------------------------------------------------
// Helper: claim via Merkle proof (multi-leaf campaigns)
// ---------------------------------------------------------------------------

async function claimViaProof(
  ctx: any,
  beneficiary: Keypair,
  leaf: VestingLeaf,
  proof: Buffer[],
  treePda: PublicKey,
  vaultAuthPda: PublicKey,
  vault: PublicKey,
  mint: PublicKey,
): Promise<void> {
  const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);
  const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);

  try {
    await getAccount(ctx.provider.connection, beneficiaryAta);
  } catch {
    await createBeneficiaryAta(ctx.provider, mint, beneficiary.publicKey);
  }

  await ctx.program.methods
    .claim(idlLeaf(leaf), idlProof(proof))
    .accounts({
      beneficiary: beneficiary.publicKey,
      vestingTree: treePda,
      claimRecord: crPda,
      vaultAuthority: vaultAuthPda,
      vault,
      beneficiaryAta,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([beneficiary])
    .rpc();
}

// ---------------------------------------------------------------------------
// Helper: withdraw from single-leaf stream (no Merkle proof)
// ---------------------------------------------------------------------------

async function withdrawFromStream(
  ctx: any,
  beneficiary: Keypair,
  releaseType: number,
  startTime: BN,
  cliffTime: BN,
  endTime: BN,
  milestoneIdx: number,
  treePda: PublicKey,
  vaultAuthPda: PublicKey,
  vault: PublicKey,
  mint: PublicKey,
): Promise<void> {
  const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);
  const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);

  await ctx.program.methods
    .withdraw({ releaseType, startTime, cliffTime, endTime, milestoneIdx })
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
}

// ---------------------------------------------------------------------------
// Helper: cancel_stream on-chain
// ---------------------------------------------------------------------------

async function cancelStreamOnChain(
  ctx: any,
  creator: Keypair,
  beneficiary: Keypair,
  releaseType: number,
  startTime: BN,
  cliffTime: BN,
  endTime: BN,
  milestoneIdx: number,
  treePda: PublicKey,
  vaultAuthPda: PublicKey,
  vault: PublicKey,
  mint: PublicKey,
): Promise<void> {
  const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);
  const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);
  const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);

  await ctx.program.methods
    .cancelStream({ releaseType, startTime, cliffTime, endTime, milestoneIdx })
    .accounts({
      creator: creator.publicKey,
      beneficiary: beneficiary.publicKey,
      vestingTree: treePda,
      claimRecord: crPda,
      systemProgram: SystemProgram.programId,
      vaultAuthority: vaultAuthPda,
      vault,
      beneficiaryAta,
      creatorAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([creator])
    .rpc();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("week7: BE + on-chain integration flows", function () {
  this.timeout(120_000);

  let ctx: Awaited<ReturnType<typeof startTest>>;
  let beAvailable = false;

  before(async () => {
    ctx = await startTest();

    // Attempt to start BE server for API tests.
    // All BE failures are non-fatal — on-chain tests run independently.
    if (!process.env.DATABASE_URL) {
      console.warn(
        "[week7] DATABASE_URL not set -- BE-dependent assertions will be skipped",
      );
      return;
    }
    try {
      await cleanBeDatabase();
      await startBeServer();
      // Verify server is alive (accept 200 or 503 — RPC may be down in test env)
      const health = await beGet("/api/health");
      beAvailable = health.status === 200 || health.status === 503;
    } catch {
      console.warn(
        "[week7] BE server not available -- BE-dependent assertions will be skipped",
      );
      beAvailable = false;
    }
  });

  after(async () => {
    await stopBeServer();
    await closeDb();
  });

  // =========================================================================
  // Flow 1: Bulk Send (Merkle 1-to-many)
  // =========================================================================
  describe("Flow 1: Bulk Send (Merkle 1-to-many)", () => {
    const CAMPAIGN_ID = 8000;
    let treePda: PublicKey;
    let vaultAuthPda: PublicKey;
    let vault: PublicKey;
    let mint: PublicKey;
    let prepared: ReturnType<typeof prepareCampaign>;
    let b1: Keypair;
    let b2: Keypair;
    let b3: Keypair;
    let internalCampaignId: number;
    let now: number;

    before(async () => {
      const { context, provider, program, creator, cancelAuthority, pauseAuthority } = ctx;
      now = await bankrunNow(context);

      // Generate 3 beneficiaries
      b1 = await makeBeneficiaryTx(provider);
      b2 = await makeBeneficiaryTx(provider);
      b3 = await makeBeneficiaryTx(provider);

      // Build leaves: b1=Cliff 1M, b2=Linear 2M, b3=Linear 3M
      const cliffTime = now + 100;
      const endTime = now + 1000;
      const leaves: VestingLeaf[] = [
        {
          leafIndex: 0,
          beneficiary: b1.publicKey,
          amount: new BN(1_000_000),
          releaseType: ReleaseType.Cliff,
          startTime: new BN(now),
          cliffTime: new BN(cliffTime),
          endTime: new BN(endTime),
          milestoneIdx: 0,
        },
        {
          leafIndex: 1,
          beneficiary: b2.publicKey,
          amount: new BN(2_000_000),
          releaseType: ReleaseType.Linear,
          startTime: new BN(now),
          cliffTime: new BN(cliffTime),
          endTime: new BN(endTime),
          milestoneIdx: 0,
        },
        {
          leafIndex: 2,
          beneficiary: b3.publicKey,
          amount: new BN(3_000_000),
          releaseType: ReleaseType.Linear,
          startTime: new BN(now),
          cliffTime: new BN(cliffTime),
          endTime: new BN(endTime),
          milestoneIdx: 0,
        },
      ];

      prepared = prepareCampaign(leaves);

      // Create mint + fund creator
      const mintResult = await createTestMintTx(provider, creator.publicKey);
      mint = mintResult.mint;
      await fundCreatorAtaTx(
        provider,
        mint,
        creator.publicKey,
        prepared.totalSupply.toNumber(),
      );

      // Derive PDAs
      const [tp] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
      treePda = tp;
      const [vap] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
      vaultAuthPda = vap;
      vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

      // Create campaign on-chain
      await program.methods
        .createCampaign({
          campaignId: new BN(CAMPAIGN_ID),
          merkleRoot: Array.from(prepared.root) as any,
          leafCount: prepared.leafCount,
          totalSupply: new BN(prepared.totalSupply.toString()),
          minCliffTime: new BN(prepared.minCliffTime.toString()),
          cancellable: true,
          cancelAuthority: cancelAuthority.publicKey,
          pauseAuthority: pauseAuthority.publicKey,
        })
        .accounts({
          creator: creator.publicKey,
          mint,
          vestingTree: treePda,
          vaultAuthority: vaultAuthPda,
          vault,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();

      // Fund campaign
      const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);
      await program.methods
        .fundCampaign(new BN(prepared.totalSupply.toString()))
        .accounts({
          creator: creator.publicKey,
          vestingTree: treePda,
          vault,
          sourceAta: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([creator])
        .rpc();

      // Create beneficiary ATAs
      await createBeneficiaryAta(provider, mint, b1.publicKey);
      await createBeneficiaryAta(provider, mint, b2.publicKey);
      await createBeneficiaryAta(provider, mint, b3.publicKey);

      // Index on BE
      if (beAvailable) {
        try {
          const beLeaves = prepared.leaves.map((leaf, i) =>
            leafToBeFormat(leaf, prepared.proofs[i]),
          );
          const authHeader = await createTestAuthHeader(ctx.creator);
          internalCampaignId = await indexCampaign({
            treePda,
            creator: ctx.creator.publicKey,
            mint,
            campaignId: CAMPAIGN_ID,
            merkleRoot: prepared.rootHex,
            leafCount: prepared.leafCount,
            totalSupply: prepared.totalSupply.toString(),
            minCliffTime: prepared.minCliffTime.toString(),
            cancellable: true,
            cancelAuthority: ctx.cancelAuthority.publicKey,
            pauseAuthority: ctx.pauseAuthority.publicKey,
            createdAt: now,
            leaves: beLeaves,
          }, authHeader);
        } catch (e) {
          console.warn("[Flow 1] BE indexing failed, skipping BE assertions:", e);
          beAvailable = false;
        }
      }
    });

    it("3 recipients claim via Merkle proof", async () => {
      const { context, provider, program } = ctx;

      // Warp past cliff so all release types are vested
      await warpClock(context, now + 1000);

      // b1 claims (Cliff, full 1_000_000)
      await claimViaProof(
        ctx, b1, prepared.leaves[0]!, prepared.proofsRaw[0]!,
        treePda, vaultAuthPda, vault, mint,
      );
      const b1Ata = getAssociatedTokenAddressSync(mint, b1.publicKey);
      const b1Bal = await getAccount(provider.connection, b1Ata);
      expect(Number(b1Bal.amount)).to.equal(1_000_000);

      // b2 claims (Linear at 100%, full 2_000_000)
      await claimViaProof(
        ctx, b2, prepared.leaves[1]!, prepared.proofsRaw[1]!,
        treePda, vaultAuthPda, vault, mint,
      );
      const b2Ata = getAssociatedTokenAddressSync(mint, b2.publicKey);
      const b2Bal = await getAccount(provider.connection, b2Ata);
      expect(Number(b2Bal.amount)).to.equal(2_000_000);

      // b3 claims (Linear at 100%, full 3_000_000)
      await claimViaProof(
        ctx, b3, prepared.leaves[2]!, prepared.proofsRaw[2]!,
        treePda, vaultAuthPda, vault, mint,
      );
      const b3Ata = getAssociatedTokenAddressSync(mint, b3.publicKey);
      const b3Bal = await getAccount(provider.connection, b3Ata);
      expect(Number(b3Bal.amount)).to.equal(3_000_000);

      // Verify on-chain totalClaimed
      const treeAccount = await program.account.vestingTree.fetch(treePda);
      expect(Number(treeAccount.totalClaimed)).to.equal(6_000_000);
    });

    it("non-recipient rejected with InvalidProof", async () => {
      const fakeBeneficiary = await makeBeneficiaryTx(ctx.provider);
      // Create a fake leaf pointing to a random beneficiary
      const fakeLeaf: VestingLeaf = {
        leafIndex: 99,
        beneficiary: fakeBeneficiary.publicKey,
        amount: new BN(1_000_000),
        releaseType: ReleaseType.Linear,
        startTime: new BN(now),
        cliffTime: new BN(now + 100),
        endTime: new BN(now + 1000),
        milestoneIdx: 0,
      };

      try {
        await claimViaProof(
          ctx, fakeBeneficiary, fakeLeaf, prepared.proofsRaw[0]!,
          treePda, vaultAuthPda, vault, mint,
        );
        expect.fail("Should have thrown InvalidProof");
      } catch (e) {
        expectAnchorError(e, ERR.InvalidProof);
      }
    });

    it("BE campaign detail returns correct data", async function () {
      if (!beAvailable) return this.skip();

      // Update totalClaimed in DB
      await updateCampaignTotalClaimed(treePda.toBase58(), 6_000_000);

      const res = await beGet(`/api/campaigns/${treePda.toBase58()}`);
      expect(res.status).to.equal(200);
      const data = res.data as any;

      expect(data.leafCount).to.equal(3);
      expect(data.totalSupply).to.equal("6000000");
      expect(data.totalClaimed).to.equal("6000000");
      expect(data.cancellable).to.equal(true);
      expect(data.paused).to.equal(false);
      expect(data.recipients).to.be.an("array");
      expect(data.recipients.length).to.equal(3);

      // Verify analytics
      expect(data.analytics.uniqueClaimers).to.equal(3);
    });
  });

  // =========================================================================
  // Flow 2: Transparency (events + dashboard)
  // =========================================================================
  describe("Flow 2: Transparency (events + dashboard)", () => {
    const CAMPAIGN_ID = 8002;
    let treePda: PublicKey;
    let vaultAuthPda: PublicKey;
    let vault: PublicKey;
    let mint: PublicKey;
    let prepared: ReturnType<typeof prepareCampaign>;
    let beneficiary: Keypair;
    let internalCampaignId: number;
    let now: number;
    let claimSlot = 1000;

    before(async () => {
      const { context, provider, program, creator, cancelAuthority, pauseAuthority } = ctx;
      now = await bankrunNow(context);

      beneficiary = await makeBeneficiaryTx(provider);

      const endTime = now + 10_000;
      // Use Linear schedule so we can claim PARTIAL tokens and keep the
      // campaign active (totalClaimed < totalSupply) for pause/cancel tests.
      const leaf: VestingLeaf = {
        leafIndex: 0,
        beneficiary: beneficiary.publicKey,
        amount: new BN(1_000_000),
        releaseType: ReleaseType.Linear,
        startTime: new BN(now),
        cliffTime: new BN(now),      // no cliff for linear
        endTime: new BN(endTime),
        milestoneIdx: 0,
      };

      prepared = prepareCampaign([leaf]);

      const mintResult = await createTestMintTx(provider, creator.publicKey);
      mint = mintResult.mint;
      await fundCreatorAtaTx(provider, mint, creator.publicKey, 1_000_000);

      const [tp] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
      treePda = tp;
      const [vap] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
      vaultAuthPda = vap;
      vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

      // Create + fund campaign on-chain
      await program.methods
        .createCampaign({
          campaignId: new BN(CAMPAIGN_ID),
          merkleRoot: Array.from(prepared.root) as any,
          leafCount: 1,
          totalSupply: new BN(1_000_000),
          minCliffTime: new BN(prepared.minCliffTime.toString()),
          cancellable: true,
          cancelAuthority: cancelAuthority.publicKey,
          pauseAuthority: pauseAuthority.publicKey,
        })
        .accounts({
          creator: creator.publicKey,
          mint,
          vestingTree: treePda,
          vaultAuthority: vaultAuthPda,
          vault,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();

      const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);
      await program.methods
        .fundCampaign(new BN(1_000_000))
        .accounts({
          creator: creator.publicKey,
          vestingTree: treePda,
          vault,
          sourceAta: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([creator])
        .rpc();

      await createBeneficiaryAta(provider, mint, beneficiary.publicKey);

      // Index on BE
      if (beAvailable) {
        try {
          const beLeaves = prepared.leaves.map((l, i) =>
            leafToBeFormat(l, prepared.proofs[i]),
          );
          const authHeader = await createTestAuthHeader(creator);
          internalCampaignId = await indexCampaign({
            treePda,
            creator: creator.publicKey,
            mint,
            campaignId: CAMPAIGN_ID,
            merkleRoot: prepared.rootHex,
            leafCount: 1,
            totalSupply: "1000000",
            minCliffTime: prepared.minCliffTime.toString(),
            cancellable: true,
            cancelAuthority: cancelAuthority.publicKey,
            pauseAuthority: pauseAuthority.publicKey,
            createdAt: now,
            leaves: beLeaves,
          }, authHeader);
        } catch (e) {
          console.warn("[Flow 2] BE indexing failed:", e);
          beAvailable = false;
        }
      }
    });

    it("create + fund verified on-chain", async () => {
      const treeAccount = await ctx.program.account.vestingTree.fetch(treePda);
      expect(treeAccount.creator.toBase58()).to.equal(
        ctx.creator.publicKey.toBase58(),
      );
      expect(treeAccount.mint.toBase58()).to.equal(mint.toBase58());
      expect(Number(treeAccount.leafCount)).to.equal(1);
      expect(Number(treeAccount.totalSupply)).to.equal(1_000_000);
      expect(treeAccount.cancellable).to.equal(true);
      expect(treeAccount.cancelledAt).to.equal(null);
      expect(treeAccount.paused).to.equal(false);

      // Vault should hold full amount
      const vaultAccount = await getAccount(ctx.provider.connection, vault);
      expect(Number(vaultAccount.amount)).to.equal(1_000_000);
    });

    it("pause/unpause cycle on-chain + BE timeline", async () => {
      const { program } = ctx;

      // Pause
      await program.methods
        .pauseCampaign()
        .accounts({
          pauseAuthority: ctx.pauseAuthority.publicKey,
          vestingTree: treePda,
        })
        .signers([ctx.pauseAuthority])
        .rpc();

      const treePaused = await program.account.vestingTree.fetch(treePda);
      expect(treePaused.paused).to.equal(true);

      // Seed pause event in DB
      if (beAvailable) {
        await seedPauseEvent(internalCampaignId, {
          paused: true,
          signature: `pause_sig_${Date.now()}`,
          slot: ++claimSlot,
          blockTime: now + 300,
        });
        await updateCampaignPaused(treePda.toBase58(), true);

        // Verify BE timeline has pause event
        const timelineRes = await beGet(
          `/api/campaigns/${treePda.toBase58()}/timeline`,
        );
        expect(timelineRes.status).to.equal(200);
        const timelineData = timelineRes.data as any;
        const pauseEvents = timelineData.events.filter(
          (e: any) => e.type === "paused",
        );
        expect(pauseEvents.length).to.be.at.least(1);
        expect(pauseEvents[0].data.paused).to.equal(true);
      }

      // Unpause
      await program.methods
        .unpauseCampaign()
        .accounts({
          pauseAuthority: ctx.pauseAuthority.publicKey,
          vestingTree: treePda,
        })
        .signers([ctx.pauseAuthority])
        .rpc();

      const treeUnpaused = await program.account.vestingTree.fetch(treePda);
      expect(treeUnpaused.paused).to.equal(false);

      // Seed unpause event in DB
      if (beAvailable) {
        await seedPauseEvent(internalCampaignId, {
          paused: false,
          signature: `unpause_sig_${Date.now()}`,
          slot: ++claimSlot,
          blockTime: now + 400,
        });
        await updateCampaignPaused(treePda.toBase58(), false);
      }
    });

    it("claim partial (40%) verified on-chain + BE claims/timeline", async () => {
      const { context, program } = ctx;

      // Warp to 40% of duration (4000/10000) — linear schedule vests 400_000
      await warpClock(context, now + 4000);

      // Claim on-chain
      await claimViaProof(
        ctx, beneficiary, prepared.leaves[0]!, prepared.proofsRaw[0]!,
        treePda, vaultAuthPda, vault, mint,
      );

      // Verify on-chain state — only 40% claimed, campaign still active
      const treeAccount = await program.account.vestingTree.fetch(treePda);
      expect(Number(treeAccount.totalClaimed)).to.equal(400_000);

      const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);
      const bal = await getAccount(ctx.provider.connection, beneficiaryAta);
      expect(Number(bal.amount)).to.equal(400_000);

      // Seed claim event in DB
      if (beAvailable) {
        await seedClaimEvent(internalCampaignId, {
          beneficiary: beneficiary.publicKey.toBase58(),
          leafIndex: 0,
          amount: 400_000,
          totalClaimedByUser: 400_000,
          totalClaimedOverall: 400_000,
          signature: `claim_sig_${Date.now()}`,
          slot: ++claimSlot,
          blockTime: now + 4000,
        });
        await updateCampaignTotalClaimed(treePda.toBase58(), 400_000);

        // Verify BE claims endpoint
        const claimsRes = await beGet(
          `/api/campaigns/${treePda.toBase58()}/claims?beneficiary=${beneficiary.publicKey}`,
        );
        expect(claimsRes.status).to.equal(200);
        const claimsData = claimsRes.data as any;
        expect(claimsData.claims).to.be.an("array");
        expect(claimsData.claims.length).to.be.at.least(1);
        expect(Number(claimsData.claims[0].amount)).to.equal(400_000);

        // Verify BE timeline endpoint
        const timelineRes = await beGet(
          `/api/campaigns/${treePda.toBase58()}/timeline`,
        );
        expect(timelineRes.status).to.equal(200);
        const timelineData = timelineRes.data as any;
        expect(timelineData.events).to.be.an("array");
        const claimEvents = timelineData.events.filter(
          (e: any) => e.type === "claimed",
        );
        expect(claimEvents.length).to.be.at.least(1);
      }
    });

    it("cancel on-chain + BE detail", async () => {
      const { program } = ctx;

      await program.methods
        .cancelCampaign()
        .accounts({
          cancelAuthority: ctx.cancelAuthority.publicKey,
          vestingTree: treePda,
        })
        .signers([ctx.cancelAuthority])
        .rpc();

      const treeAccount = await program.account.vestingTree.fetch(treePda);
      expect(treeAccount.cancelledAt).to.not.equal(null);

      // Seed cancel event in DB
      if (beAvailable) {
        await seedCancelEvent(internalCampaignId, {
          cancelledAt: now + 4000,
          claimedAtCancel: 400_000,
          signature: `cancel_sig_${Date.now()}`,
          slot: ++claimSlot,
          blockTime: now + 4000,
        });
        await updateCampaignCancelledAt(treePda.toBase58(), now + 4000);

        // Verify BE campaign detail shows cancelled state
        const detailRes = await beGet(`/api/campaigns/${treePda.toBase58()}`);
        expect(detailRes.status).to.equal(200);
        const detailData = detailRes.data as any;
        expect(detailData.cancelledAt).to.equal(String(now + 4000));
        expect(detailData.gracePeriod).to.not.equal(null);
      }
    });

    it("vesting progress via BE beneficiary endpoint", async function () {
      if (!beAvailable) return this.skip();

      const progressRes = await beGet(
        `/api/beneficiary/${beneficiary.publicKey}/vesting-progress`,
      );
      expect(progressRes.status).to.equal(200);
      const progressData = progressRes.data as any;
      expect(progressData.address).to.equal(
        beneficiary.publicKey.toBase58(),
      );
      expect(progressData.campaigns).to.be.an("array");
      expect(progressData.campaigns.length).to.be.at.least(1);

      const campaignProgress = progressData.campaigns.find(
        (c: any) => c.treeAddress === treePda.toBase58(),
      );
      expect(campaignProgress).to.not.equal(undefined);
      expect(campaignProgress.leaf.amount).to.equal("1000000");
      expect(campaignProgress.progress.claimedSoFar).to.equal("400000");
      expect(campaignProgress.progress.totalEntitled).to.equal("1000000");
    });
  });

  // =========================================================================
  // Flow 3: Standard Vesting
  // =========================================================================
  describe("Flow 3: Standard Vesting", () => {
    // -------------------------------------------------------------------------
    // Sub-flow: Cliff
    // -------------------------------------------------------------------------
    describe("Cliff", () => {
      const CAMPAIGN_ID = 8010;
      let treePda: PublicKey;
      let vaultAuthPda: PublicKey;
      let vault: PublicKey;
      let mint: PublicKey;
      let prepared: ReturnType<typeof prepareCampaign>;
      let beneficiary: Keypair;
      let now: number;

      before(async () => {
        const { context, provider, program, creator, cancelAuthority, pauseAuthority } = ctx;
        now = await bankrunNow(context);
        beneficiary = await makeBeneficiaryTx(provider);

        const leaf: VestingLeaf = {
          leafIndex: 0,
          beneficiary: beneficiary.publicKey,
          amount: new BN(10_000),
          releaseType: ReleaseType.Cliff,
          startTime: new BN(now),
          cliffTime: new BN(now + 500),
          endTime: new BN(now + 1000),
          milestoneIdx: 0,
        };

        prepared = prepareCampaign([leaf]);

        const mintResult = await createTestMintTx(provider, creator.publicKey);
        mint = mintResult.mint;
        await fundCreatorAtaTx(provider, mint, creator.publicKey, 10_000);

        const [tp] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
        treePda = tp;
        const [vap] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
        vaultAuthPda = vap;
        vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

        await program.methods
          .createCampaign({
            campaignId: new BN(CAMPAIGN_ID),
            merkleRoot: Array.from(prepared.root) as any,
            leafCount: 1,
            totalSupply: new BN(10_000),
            minCliffTime: new BN(prepared.minCliffTime.toString()),
            cancellable: true,
            cancelAuthority: cancelAuthority.publicKey,
            pauseAuthority: pauseAuthority.publicKey,
          })
          .accounts({
            creator: creator.publicKey,
            mint,
            vestingTree: treePda,
            vaultAuthority: vaultAuthPda,
            vault,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([creator])
          .rpc();

        const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);
        await program.methods
          .fundCampaign(new BN(10_000))
          .accounts({
            creator: creator.publicKey,
            vestingTree: treePda,
            vault,
            sourceAta: creatorAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([creator])
          .rpc();

        await createBeneficiaryAta(provider, mint, beneficiary.publicKey);
      });

      it("before cliff: claim -> NothingToClaim", async () => {
        const { context } = ctx;
        // Still before cliff (now + 250 < now + 500)
        await warpClock(context, now + 250);

        try {
          await claimViaProof(
            ctx, beneficiary, prepared.leaves[0]!, prepared.proofsRaw[0]!,
            treePda, vaultAuthPda, vault, mint,
          );
          expect.fail("Should have thrown NothingToClaim");
        } catch (e) {
          expectAnchorError(e, ERR.NothingToClaim);
        }
      });

      it("after cliff: claim -> full 10_000", async () => {
        const { context, provider, program } = ctx;
        // Warp past cliff
        await warpClock(context, now + 600);

        await claimViaProof(
          ctx, beneficiary, prepared.leaves[0]!, prepared.proofsRaw[0]!,
          treePda, vaultAuthPda, vault, mint,
        );

        const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);
        const bal = await getAccount(provider.connection, beneficiaryAta);
        expect(Number(bal.amount)).to.equal(10_000);

        // Verify on-chain state
        const treeAccount = await program.account.vestingTree.fetch(treePda);
        expect(Number(treeAccount.totalClaimed)).to.equal(10_000);
      });
    });

    // -------------------------------------------------------------------------
    // Sub-flow: Linear
    // -------------------------------------------------------------------------
    describe("Linear", () => {
      const CAMPAIGN_ID = 8011;
      let treePda: PublicKey;
      let vaultAuthPda: PublicKey;
      let vault: PublicKey;
      let mint: PublicKey;
      let prepared: ReturnType<typeof prepareCampaign>;
      let beneficiary: Keypair;
      let now: number;

      before(async () => {
        const { context, provider, program, creator, cancelAuthority, pauseAuthority } = ctx;
        now = await bankrunNow(context);
        beneficiary = await makeBeneficiaryTx(provider);

        const leaf: VestingLeaf = {
          leafIndex: 0,
          beneficiary: beneficiary.publicKey,
          amount: new BN(10_000),
          releaseType: ReleaseType.Linear,
          startTime: new BN(now),
          cliffTime: new BN(now),
          endTime: new BN(now + 1000),
          milestoneIdx: 0,
        };

        prepared = prepareCampaign([leaf]);

        const mintResult = await createTestMintTx(provider, creator.publicKey);
        mint = mintResult.mint;
        await fundCreatorAtaTx(provider, mint, creator.publicKey, 10_000);

        const [tp] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
        treePda = tp;
        const [vap] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
        vaultAuthPda = vap;
        vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

        await program.methods
          .createCampaign({
            campaignId: new BN(CAMPAIGN_ID),
            merkleRoot: Array.from(prepared.root) as any,
            leafCount: 1,
            totalSupply: new BN(10_000),
            minCliffTime: new BN(prepared.minCliffTime.toString()),
            cancellable: true,
            cancelAuthority: cancelAuthority.publicKey,
            pauseAuthority: pauseAuthority.publicKey,
          })
          .accounts({
            creator: creator.publicKey,
            mint,
            vestingTree: treePda,
            vaultAuthority: vaultAuthPda,
            vault,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([creator])
          .rpc();

        const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);
        await program.methods
          .fundCampaign(new BN(10_000))
          .accounts({
            creator: creator.publicKey,
            vestingTree: treePda,
            vault,
            sourceAta: creatorAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([creator])
          .rpc();

        await createBeneficiaryAta(provider, mint, beneficiary.publicKey);
      });

      it("at 25%: claim -> 2_500", async () => {
        const { context, provider } = ctx;
        await warpClock(context, now + 250);

        await claimViaProof(
          ctx, beneficiary, prepared.leaves[0]!, prepared.proofsRaw[0]!,
          treePda, vaultAuthPda, vault, mint,
        );

        const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);
        const bal = await getAccount(provider.connection, beneficiaryAta);
        expect(Number(bal.amount)).to.equal(2_500);
      });

      it("at 50%: claim -> 5_000 cumulative", async () => {
        const { context, provider } = ctx;
        await warpClock(context, now + 500);

        await claimViaProof(
          ctx, beneficiary, prepared.leaves[0]!, prepared.proofsRaw[0]!,
          treePda, vaultAuthPda, vault, mint,
        );

        const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);
        const bal = await getAccount(provider.connection, beneficiaryAta);
        expect(Number(bal.amount)).to.equal(5_000);
      });

      it("at 75%: claim -> 7_500 cumulative", async () => {
        const { context, provider } = ctx;
        await warpClock(context, now + 750);

        await claimViaProof(
          ctx, beneficiary, prepared.leaves[0]!, prepared.proofsRaw[0]!,
          treePda, vaultAuthPda, vault, mint,
        );

        const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);
        const bal = await getAccount(provider.connection, beneficiaryAta);
        expect(Number(bal.amount)).to.equal(7_500);
      });

      it("at 100%: claim -> 10_000 cumulative", async () => {
        const { context, provider, program } = ctx;
        await warpClock(context, now + 1000);

        await claimViaProof(
          ctx, beneficiary, prepared.leaves[0]!, prepared.proofsRaw[0]!,
          treePda, vaultAuthPda, vault, mint,
        );

        const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);
        const bal = await getAccount(provider.connection, beneficiaryAta);
        expect(Number(bal.amount)).to.equal(10_000);

        // Verify on-chain totalClaimed
        const treeAccount = await program.account.vestingTree.fetch(treePda);
        expect(Number(treeAccount.totalClaimed)).to.equal(10_000);

        // Vault should be empty
        const vaultBal = await getAccount(provider.connection, vault);
        expect(Number(vaultBal.amount)).to.equal(0);
      });
    });

    // -------------------------------------------------------------------------
    // Sub-flow: Milestone
    // -------------------------------------------------------------------------
    describe("Milestone", () => {
      const CAMPAIGN_ID = 8012;
      let treePda: PublicKey;
      let vaultAuthPda: PublicKey;
      let vault: PublicKey;
      let mint: PublicKey;
      let prepared: ReturnType<typeof prepareCampaign>;
      let beneficiary: Keypair;
      let now: number;

      before(async () => {
        const { context, provider, program, creator, cancelAuthority, pauseAuthority } = ctx;
        now = await bankrunNow(context);
        beneficiary = await makeBeneficiaryTx(provider);

        const leaf: VestingLeaf = {
          leafIndex: 0,
          beneficiary: beneficiary.publicKey,
          amount: new BN(10_000),
          releaseType: ReleaseType.Milestone,
          startTime: new BN(now),
          cliffTime: new BN(now + 100),
          endTime: new BN(now + 1000),
          milestoneIdx: 0,
        };

        prepared = prepareCampaign([leaf]);

        const mintResult = await createTestMintTx(provider, creator.publicKey);
        mint = mintResult.mint;
        await fundCreatorAtaTx(provider, mint, creator.publicKey, 10_000);

        const [tp] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
        treePda = tp;
        const [vap] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
        vaultAuthPda = vap;
        vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

        await program.methods
          .createCampaign({
            campaignId: new BN(CAMPAIGN_ID),
            merkleRoot: Array.from(prepared.root) as any,
            leafCount: 1,
            totalSupply: new BN(10_000),
            minCliffTime: new BN(prepared.minCliffTime.toString()),
            cancellable: true,
            cancelAuthority: cancelAuthority.publicKey,
            pauseAuthority: pauseAuthority.publicKey,
          })
          .accounts({
            creator: creator.publicKey,
            mint,
            vestingTree: treePda,
            vaultAuthority: vaultAuthPda,
            vault,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([creator])
          .rpc();

        const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);
        await program.methods
          .fundCampaign(new BN(10_000))
          .accounts({
            creator: creator.publicKey,
            vestingTree: treePda,
            vault,
            sourceAta: creatorAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([creator])
          .rpc();

        await createBeneficiaryAta(provider, mint, beneficiary.publicKey);
      });

      it("before milestone release: claim -> MilestoneNotReleased", async () => {
        const { context } = ctx;
        // Warp past cliff but milestone 0 is not released yet
        await warpClock(context, now + 200);

        try {
          await claimViaProof(
            ctx, beneficiary, prepared.leaves[0]!, prepared.proofsRaw[0]!,
            treePda, vaultAuthPda, vault, mint,
          );
          expect.fail("Should have thrown MilestoneNotReleased");
        } catch (e) {
          expectAnchorError(e, ERR.MilestoneNotReleased);
        }
      });

      it("after milestone release: claim -> full 10_000", async () => {
        const { context, provider, program } = ctx;

        // Release milestone 0
        await program.methods
          .setMilestoneReleased({ milestoneIdx: 0 })
          .accounts({
            creator: ctx.creator.publicKey,
            vestingTree: treePda,
          })
          .signers([ctx.creator])
          .rpc();

        // Verify on-chain milestone flag
        const treeAccount = await program.account.vestingTree.fetch(treePda);
        // milestoneReleasedFlags is a bit vector; bit 0 should be set
        const flags = treeAccount.milestoneReleasedFlags as number[];
        expect(flags[0]).to.equal(1);

        // Claim
        await claimViaProof(
          ctx, beneficiary, prepared.leaves[0]!, prepared.proofsRaw[0]!,
          treePda, vaultAuthPda, vault, mint,
        );

        const beneficiaryAta = getAssociatedTokenAddressSync(mint, beneficiary.publicKey);
        const bal = await getAccount(provider.connection, beneficiaryAta);
        expect(Number(bal.amount)).to.equal(10_000);
      });
    });
  });

  // =========================================================================
  // Flow 4: Automatic Clawback
  // =========================================================================
  describe("Flow 4: Automatic Clawback", () => {
    // -------------------------------------------------------------------------
    // Multi-leaf campaign cancel + grace period + withdraw_unvested
    // -------------------------------------------------------------------------
    describe("multi-leaf cancel + clawback", () => {
      const CAMPAIGN_ID = 8020;
      let treePda: PublicKey;
      let vaultAuthPda: PublicKey;
      let vault: PublicKey;
      let mint: PublicKey;
      let prepared: ReturnType<typeof prepareCampaign>;
      let b1: Keypair;
      let b2: Keypair;
      let b3: Keypair;
      let internalCampaignId: number;
      let now: number;
      let claimSlot = 2000;

      before(async () => {
        const { context, provider, program, creator, cancelAuthority, pauseAuthority } = ctx;
        now = await bankrunNow(context);

        b1 = await makeBeneficiaryTx(provider);
        b2 = await makeBeneficiaryTx(provider);
        b3 = await makeBeneficiaryTx(provider);

        const endTime = now + 10_000;
        const leaves: VestingLeaf[] = [b1, b2, b3].map((b, i) => ({
          leafIndex: i,
          beneficiary: b.publicKey,
          amount: new BN(1_000_000),
          releaseType: ReleaseType.Linear,
          startTime: new BN(now),
          cliffTime: new BN(now),
          endTime: new BN(endTime),
          milestoneIdx: 0,
        }));

        prepared = prepareCampaign(leaves);

        const mintResult = await createTestMintTx(provider, creator.publicKey);
        mint = mintResult.mint;
        await fundCreatorAtaTx(
          provider,
          mint,
          creator.publicKey,
          prepared.totalSupply.toNumber(),
        );

        const [tp] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
        treePda = tp;
        const [vap] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
        vaultAuthPda = vap;
        vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

        await program.methods
          .createCampaign({
            campaignId: new BN(CAMPAIGN_ID),
            merkleRoot: Array.from(prepared.root) as any,
            leafCount: 3,
            totalSupply: new BN(3_000_000),
            minCliffTime: new BN(prepared.minCliffTime.toString()),
            cancellable: true,
            cancelAuthority: cancelAuthority.publicKey,
            pauseAuthority: pauseAuthority.publicKey,
          })
          .accounts({
            creator: creator.publicKey,
            mint,
            vestingTree: treePda,
            vaultAuthority: vaultAuthPda,
            vault,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([creator])
          .rpc();

        const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);
        await program.methods
          .fundCampaign(new BN(3_000_000))
          .accounts({
            creator: creator.publicKey,
            vestingTree: treePda,
            vault,
            sourceAta: creatorAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([creator])
          .rpc();

        await createBeneficiaryAta(provider, mint, b1.publicKey);
        await createBeneficiaryAta(provider, mint, b2.publicKey);
        await createBeneficiaryAta(provider, mint, b3.publicKey);

        // Index on BE
        if (beAvailable) {
          try {
            const beLeaves = prepared.leaves.map((leaf, i) =>
              leafToBeFormat(leaf, prepared.proofs[i]),
            );
            const authHeader = await createTestAuthHeader(creator);
            internalCampaignId = await indexCampaign({
              treePda,
              creator: creator.publicKey,
              mint,
              campaignId: CAMPAIGN_ID,
              merkleRoot: prepared.rootHex,
              leafCount: 3,
              totalSupply: "3000000",
              minCliffTime: prepared.minCliffTime.toString(),
              cancellable: true,
              cancelAuthority: cancelAuthority.publicKey,
              pauseAuthority: pauseAuthority.publicKey,
              createdAt: now,
              leaves: beLeaves,
            }, authHeader);
          } catch (e) {
            console.warn("[Flow 4 multi-leaf] BE indexing failed:", e);
          }
        }
      });

      it("b1 claims 400_000 at 40% vested", async () => {
        const { context, provider } = ctx;
        // Warp to 40% (4000 / 10000)
        await warpClock(context, now + 4000);

        await claimViaProof(
          ctx, b1, prepared.leaves[0]!, prepared.proofsRaw[0]!,
          treePda, vaultAuthPda, vault, mint,
        );

        const b1Ata = getAssociatedTokenAddressSync(mint, b1.publicKey);
        const bal = await getAccount(provider.connection, b1Ata);
        expect(Number(bal.amount)).to.equal(400_000);

        if (beAvailable) {
          await seedClaimEvent(internalCampaignId, {
            beneficiary: b1.publicKey.toBase58(),
            leafIndex: 0,
            amount: 400_000,
            totalClaimedByUser: 400_000,
            totalClaimedOverall: 400_000,
            slot: ++claimSlot,
            blockTime: now + 4000,
          });
          await updateCampaignTotalClaimed(treePda.toBase58(), 400_000);
        }
      });

      it("cancel campaign", async () => {
        const { program } = ctx;

        await program.methods
          .cancelCampaign()
          .accounts({
            cancelAuthority: ctx.cancelAuthority.publicKey,
            vestingTree: treePda,
          })
          .signers([ctx.cancelAuthority])
          .rpc();

        const treeAccount = await program.account.vestingTree.fetch(treePda);
        expect(treeAccount.cancelledAt).to.not.equal(null);

        if (beAvailable) {
          const cancelTime = now + 4000;
          await seedCancelEvent(internalCampaignId, {
            cancelledAt: cancelTime,
            claimedAtCancel: 400_000,
            slot: ++claimSlot,
            blockTime: cancelTime,
          });
          await updateCampaignCancelledAt(treePda.toBase58(), cancelTime);
        }
      });

      it("withdraw_unvested during grace period -> GracePeriodActive", async () => {
        const { program } = ctx;

        try {
          await program.methods
            .withdrawUnvested()
            .accounts({
              creator: ctx.creator.publicKey,
              vestingTree: treePda,
              vaultAuthority: vaultAuthPda,
              vault,
              creatorAta: getAssociatedTokenAddressSync(mint, ctx.creator.publicKey),
              tokenProgram: TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .signers([ctx.creator])
            .rpc();
          expect.fail("Should have thrown GracePeriodActive");
        } catch (e) {
          expectAnchorError(e, ERR.GracePeriodActive);
        }
      });

      it("after grace period: withdraw_unvested -> creator gets 2_600_000, vault = 0", async () => {
        const { context, provider, program } = ctx;
        const cancelTime = now + 4000;

        // Warp past grace period
        await warpClock(context, cancelTime + GRACE_PERIOD_SECS + 1);

        const creatorAta = getAssociatedTokenAddressSync(mint, ctx.creator.publicKey);
        const preCreatorBal = Number(
          (await getAccount(provider.connection, creatorAta)).amount,
        );

        await program.methods
          .withdrawUnvested()
          .accounts({
            creator: ctx.creator.publicKey,
            vestingTree: treePda,
            vaultAuthority: vaultAuthPda,
            vault,
            creatorAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([ctx.creator])
          .rpc();

        const postCreatorBal = Number(
          (await getAccount(provider.connection, creatorAta)).amount,
        );
        const recovered = postCreatorBal - preCreatorBal;
        // 2_600_000 unvested = 3_000_000 total - 400_000 already claimed
        expect(recovered).to.equal(2_600_000);

        const postVault = await getAccount(provider.connection, vault);
        expect(Number(postVault.amount)).to.equal(0);

        if (beAvailable) {
          await seedWithdrawEvent(internalCampaignId, {
            amount: 2_600_000,
            slot: ++claimSlot,
            blockTime: cancelTime + GRACE_PERIOD_SECS + 1,
          });
        }
      });
    });

    // -------------------------------------------------------------------------
    // Single-leaf stream cancel_stream
    // -------------------------------------------------------------------------
    describe("single-leaf cancel_stream", () => {
      const CAMPAIGN_ID = 8021;
      let treePda: PublicKey;
      let vaultAuthPda: PublicKey;
      let vault: PublicKey;
      let mint: PublicKey;
      let beneficiary: Keypair;
      let now: number;

      before(async () => {
        const { context, provider, program, creator, cancelAuthority } = ctx;
        now = await bankrunNow(context);
        beneficiary = await makeBeneficiaryTx(provider);

        const mintResult = await createTestMintTx(provider, creator.publicKey);
        mint = mintResult.mint;
        await fundCreatorAtaTx(provider, mint, creator.publicKey, 1_000_000);

        const [tp] = await treePDA(PROGRAM_ID, creator.publicKey, mint, CAMPAIGN_ID);
        treePda = tp;
        const [vap] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
        vaultAuthPda = vap;
        vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

        const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);

        // Create stream (single-leaf: createStream combines create + fund)
        await program.methods
          .createStream({
            campaignId: new BN(CAMPAIGN_ID),
            beneficiary: beneficiary.publicKey,
            amount: new BN(1_000_000),
            releaseType: 1, // Linear
            startTime: new BN(now),
            cliffTime: new BN(now),
            endTime: new BN(now + 10_000),
            milestoneIdx: 0,
            cancellable: true,
            cancelAuthority: cancelAuthority.publicKey,
            pauseAuthority: null,
          })
          .accounts({
            creator: creator.publicKey,
            mint,
            vestingTree: treePda,
            vaultAuthority: vaultAuthPda,
            vault,
            sourceAta: creatorAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([creator])
          .rpc();

        await createBeneficiaryAta(provider, mint, beneficiary.publicKey);
      });

      it("cancel_stream at 40%: beneficiary gets 400_000, creator gets 600_000", async () => {
        const { context, provider, program } = ctx;

        // Warp to 40% vested
        await warpClock(context, now + 4000);

        const creatorAta = getAssociatedTokenAddressSync(mint, ctx.creator.publicKey);
        const preCreatorBal = Number(
          (await getAccount(provider.connection, creatorAta)).amount,
        );

        await cancelStreamOnChain(
          ctx,
          ctx.creator,
          beneficiary,
          1, // Linear
          new BN(now),
          new BN(now),
          new BN(now + 10_000),
          0,
          treePda,
          vaultAuthPda,
          vault,
          mint,
        );

        const beneficiaryAta = getAssociatedTokenAddressSync(
          mint,
          beneficiary.publicKey,
        );
        const postBeneficiaryBal = Number(
          (await getAccount(provider.connection, beneficiaryAta)).amount,
        );
        expect(postBeneficiaryBal).to.equal(400_000);

        const postCreatorBal = Number(
          (await getAccount(provider.connection, creatorAta)).amount,
        );
        expect(postCreatorBal - preCreatorBal).to.equal(600_000);

        const postVault = await getAccount(provider.connection, vault);
        expect(Number(postVault.amount)).to.equal(0);

        // Verify on-chain tree state
        const treeAccount = await program.account.vestingTree.fetch(treePda);
        expect(treeAccount.cancelledAt).to.not.equal(null);
      });
    });
  });
});
