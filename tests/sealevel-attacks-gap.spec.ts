/**
 * sealevel-attacks-gap.spec.ts
 *
 * Targeted security tests inspired by coral-xyz/sealevel-attacks, covering gaps
 * not exercised by the existing security/audit test suites.
 *
 * Tests address three attack categories from sealevel-attacks that are already
 * mitigated by Anchor's built-in safety features but had no explicit proof:
 *
 *   SA-1  Duplicate Mutable Accounts (#6) — same ATA passed as both
 *         beneficiary_ata and creator_ata in cancel_stream
 *   SA-2  PDA Sharing (#8) — cross-tree VaultAuthority misuse
 *   SA-3  Closing Accounts (#9) — reinitialize a closed ClaimRecord
 *
 * Uses solana-bankrun for deterministic execution.
 */
import { BN, Wallet, Idl } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";

import {
  startTest,
  treePDA,
  claimRecordPDA,
  vaultAuthorityPDA,
} from "./utils/bankrun";
import {
  idlLeaf,
  idlProof,
  expectAnchorError,
} from "./utils/helpers";
import {
  ReleaseType,
  VestingMerkleTree,
  type VestingLeaf,
} from "../clients/ts/src";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AMOUNT = 10_000;
const CAMPAIGN_ID = 900;

// Resolve program ID from the built IDL at runtime
let _PID: PublicKey | null = null;
function pid(): PublicKey {
  if (!_PID) {
    const idl: Idl = require("../target/idl/vesting.json");
    _PID = new PublicKey((idl as any).address);
  }
  return _PID;
}

const ERR = {
  Unauthorized: 6005,
  UnauthorizedClaimer: 6006,
  MintMismatch: 6007,
  WrongVault: 6018,
  CannotClose: 6029,
  InvalidProof: 6013,
};

// ---------------------------------------------------------------------------
// Helpers — bankrun-compatible SPL token operations
// ---------------------------------------------------------------------------

async function createTestMintTx(
  provider: any,
  authority: PublicKey,
): Promise<PublicKey> {
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
  return mintKp.publicKey;
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
  try {
    await getAccount(provider.connection, ata);
  } catch {
    tx.add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey, ata, owner, mint,
        TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }
  tx.add(
    createMintToInstruction(mint, ata, payer.publicKey, amount, [], TOKEN_PROGRAM_ID),
  );
  await provider.sendAndConfirm(tx, [payer]);
  return ata;
}

async function createBeneficiaryAta(
  provider: any,
  creator: Keypair,
  beneficiary: PublicKey,
  mint: PublicKey,
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, beneficiary);
  const payer = (provider.wallet as Wallet).payer;
  try {
    await getAccount(provider.connection, ata);
  } catch {
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey, ata, beneficiary, mint,
        TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
    await provider.sendAndConfirm(tx, [payer]);
  }
  return ata;
}

async function airdropSol(
  provider: any,
  from: Keypair,
  to: PublicKey,
  lamports: number,
): Promise<void> {
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports }),
  );
  await provider.sendAndConfirm(tx, [from]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sealevel-attacks gap tests", () => {
  let context: any;
  let provider: any;
  let program: any;
  let creator: Keypair;
  let cancelAuthority: Keypair;
  let pauseAuthority: Keypair;

  before(async () => {
    const ctx = await startTest();
    context = ctx.context;
    provider = ctx.provider;
    program = ctx.program;
    creator = ctx.creator;
    cancelAuthority = ctx.cancelAuthority;
    pauseAuthority = ctx.pauseAuthority;
  });

  // -------------------------------------------------------------------------
  // SA-1: Duplicate Mutable Accounts (sealevel-attacks #6)
  // -------------------------------------------------------------------------
  describe("SA-1: duplicate mutable accounts in cancel_stream", () => {
    it("rejects same ATA as both beneficiary_ata and creator_ata", async () => {
      const mint = await createTestMintTx(provider, creator.publicKey);
      const sourceAta = await fundCreatorAtaTx(provider, mint, creator.publicKey, AMOUNT);

      const beneficiary = Keypair.generate();
      await airdropSol(provider, creator, beneficiary.publicKey, 1_000_000);

      const cid = CAMPAIGN_ID;
      const now = Math.floor(Date.now() / 1000);
      const cliff = now - 2000;
      const end = now + 2000;

      const [treePda] = await treePDA(pid(), creator.publicKey, mint, cid);
      const [vaultAuthPda] = await vaultAuthorityPDA(pid(), treePda);
      const [crPda] = await claimRecordPDA(pid(), treePda, beneficiary.publicKey);
      const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

      // Create stream
      await program.methods
        .createStream({
          campaignId: new BN(cid),
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
          sourceAta,
          mint,
        })
        .signers([creator])
        .rpc();

      // Create beneficiary ATA
      const beneficiaryAta = await createBeneficiaryAta(provider, creator, beneficiary.publicKey, mint);

      // ── ATTACK: pass beneficiary's ATA as BOTH beneficiary_ata and creator_ata ──
      // cancel_stream validates:
      //   creator_ata.owner == creator.key()   ← FAILS (beneficiary ATA owned by beneficiary)
      try {
        await program.methods
          .cancelStream({
            releaseType: 1,
            startTime: new BN(cliff),
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
            creatorAta: beneficiaryAta, // ← ATTACK: same ATA for both
            systemProgram: SystemProgram.programId,
          })
          .signers([creator])
          .rpc();
        expect.fail("SA-1 ATTACK SUCCEEDED: duplicate ATA should be rejected");
      } catch (e: any) {
        const msg = (e.message || String(e)).toLowerCase();
        const logs = ((e.logs || []) as string[]).join("\n").toLowerCase();
        const combined = msg + "\n" + logs;
        const hasError =
          combined.includes("unauthorized") ||
          combined.includes("6005") ||
          combined.includes("0x1771") ||
          combined.includes("mintmismatch") ||
          combined.includes("6007") ||
          combined.includes("0x1777") ||
          e?.error?.errorCode?.number === ERR.Unauthorized ||
          e?.error?.errorCode?.number === ERR.MintMismatch;
        expect(hasError, `expected auth/mint error, got: ${msg}`).to.equal(true);
      }
    });

    it("rejects creator ATA swapped into beneficiary_ata field", async () => {
      const mint = await createTestMintTx(provider, creator.publicKey);
      const sourceAta = await fundCreatorAtaTx(provider, mint, creator.publicKey, AMOUNT);

      const beneficiary = Keypair.generate();
      await airdropSol(provider, creator, beneficiary.publicKey, 1_000_000);

      const cid = CAMPAIGN_ID + 1;
      const now = Math.floor(Date.now() / 1000);
      const cliff = now - 2000;
      const end = now + 2000;

      const [treePda] = await treePDA(pid(), creator.publicKey, mint, cid);
      const [vaultAuthPda] = await vaultAuthorityPDA(pid(), treePda);
      const [crPda] = await claimRecordPDA(pid(), treePda, beneficiary.publicKey);
      const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

      await program.methods
        .createStream({
          campaignId: new BN(cid),
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
          sourceAta,
          mint,
        })
        .signers([creator])
        .rpc();

      await createBeneficiaryAta(provider, creator, beneficiary.publicKey, mint);
      const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);

      // ── ATTACK: pass creator's ATA as beneficiary_ata ──
      // beneficiary_ata.owner must == beneficiary.key() → FAILS (creator ATA owned by creator)
      try {
        await program.methods
          .cancelStream({
            releaseType: 1,
            startTime: new BN(cliff),
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
            beneficiaryAta: creatorAta, // ← ATTACK: creator's ATA in beneficiary slot
            creatorAta,
            systemProgram: SystemProgram.programId,
          })
          .signers([creator])
          .rpc();
        expect.fail("SA-1b ATTACK SUCCEEDED: swapped ATA should be rejected");
      } catch (e: any) {
        const msg = (e.message || String(e)).toLowerCase();
        const logs = ((e.logs || []) as string[]).join("\n").toLowerCase();
        const combined = msg + "\n" + logs;
        const hasError =
          combined.includes("unauthorizedclaimer") ||
          combined.includes("6006") ||
          combined.includes("0x1776") ||
          combined.includes("unauthorized") ||
          combined.includes("6005") ||
          combined.includes("0x1771") ||
          e?.error?.errorCode?.number === ERR.UnauthorizedClaimer ||
          e?.error?.errorCode?.number === ERR.Unauthorized;
        expect(hasError, `expected auth error, got: ${msg}`).to.equal(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // SA-2: PDA Sharing (sealevel-attacks #8)
  // -------------------------------------------------------------------------
  describe("SA-2: cross-tree VaultAuthority misuse (PDA sharing)", () => {
    it("rejects vault from tree B used with tree A's fund_campaign", async () => {
      const mint = await createTestMintTx(provider, creator.publicKey);
      await fundCreatorAtaTx(provider, mint, creator.publicKey, AMOUNT * 2);

      const cidA = CAMPAIGN_ID + 10;
      const cidB = CAMPAIGN_ID + 11;
      const now = Math.floor(Date.now() / 1000);
      const cliff = now + 5_000;

      const dummyLeaf: VestingLeaf = {
        leafIndex: 0,
        beneficiary: Keypair.generate().publicKey,
        amount: new BN(AMOUNT),
        releaseType: ReleaseType.Cliff,
        startTime: new BN(cliff),
        cliffTime: new BN(cliff),
        endTime: new BN(cliff + 10_000),
        milestoneIdx: 0,
      };
      const merkle = new VestingMerkleTree([dummyLeaf]);
      const root = Array.from(merkle.root);

      // ── Tree A ──
      const [treePdaA] = await treePDA(pid(), creator.publicKey, mint, cidA);
      const [vaultAuthPdaA] = await vaultAuthorityPDA(pid(), treePdaA);
      const vaultA = getAssociatedTokenAddressSync(mint, vaultAuthPdaA, true);

      await program.methods
        .createCampaign({
          campaignId: new BN(cidA),
          merkleRoot: root,
          leafCount: 1,
          totalSupply: new BN(AMOUNT),
          minCliffTime: new BN(cliff),
          cancellable: true,
          cancelAuthority: cancelAuthority.publicKey,
          pauseAuthority: pauseAuthority.publicKey,
        })
        .accounts({
          creator: creator.publicKey,
          vestingTree: treePdaA,
          vaultAuthority: vaultAuthPdaA,
          vault: vaultA,
          mint,
        })
        .signers([creator])
        .rpc();

      // ── Tree B (same mint, different campaign ID → different PDA) ──
      const [treePdaB] = await treePDA(pid(), creator.publicKey, mint, cidB);
      const [vaultAuthPdaB] = await vaultAuthorityPDA(pid(), treePdaB);
      const vaultB = getAssociatedTokenAddressSync(mint, vaultAuthPdaB, true);

      await program.methods
        .createCampaign({
          campaignId: new BN(cidB),
          merkleRoot: root,
          leafCount: 1,
          totalSupply: new BN(AMOUNT),
          minCliffTime: new BN(cliff),
          cancellable: true,
          cancelAuthority: cancelAuthority.publicKey,
          pauseAuthority: pauseAuthority.publicKey,
        })
        .accounts({
          creator: creator.publicKey,
          vestingTree: treePdaB,
          vaultAuthority: vaultAuthPdaB,
          vault: vaultB,
          mint,
        })
        .signers([creator])
        .rpc();

      // ── ATTACK: fund tree B using tree A's vault ──
      // fund_campaign has constraint vesting_tree.vault == vault → fails
      const sourceAta = getAssociatedTokenAddressSync(mint, creator.publicKey);
      try {
        await program.methods
          .fundCampaign(new BN(AMOUNT))
          .accounts({
            creator: creator.publicKey,
            vestingTree: treePdaB,
            vault: vaultA, // ← ATTACK: tree A's vault with tree B
            sourceAta,
          })
          .signers([creator])
          .rpc();
        expect.fail("SA-2 ATTACK SUCCEEDED: cross-tree vault should be rejected");
      } catch (e: any) {
        const msg = (e.message || String(e)).toLowerCase();
        const logs = ((e.logs || []) as string[]).join("\n").toLowerCase();
        const combined = msg + "\n" + logs;
        const hasError =
          combined.includes("constraint") ||
          combined.includes("wrongvault") ||
          combined.includes("6018") ||
          combined.includes("0x1782") ||
          combined.includes("has_one") ||
          e?.error?.errorCode?.number === ERR.WrongVault;
        expect(hasError, `expected constraint/vault error, got: ${msg}`).to.equal(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // SA-3: Closing Accounts (sealevel-attacks #9)
  // -------------------------------------------------------------------------
  describe("SA-3: closed ClaimRecord cannot be reinitialized", () => {
    it("rejects claim after close_claim_record (VEL-001 regression guard)", async () => {
      const mint = await createTestMintTx(provider, creator.publicKey);
      await fundCreatorAtaTx(provider, mint, creator.publicKey, AMOUNT);

      const beneficiary = Keypair.generate();
      // Fund with enough SOL for account creation + rent (init_if_needed may try to reinit)
      await airdropSol(provider, creator, beneficiary.publicKey, 5_000_000);

      const cid = CAMPAIGN_ID + 20;
      const now = Math.floor(Date.now() / 1000);
      const cliff = now - 1000; // past → fully vested for Cliff

      const leaf: VestingLeaf = {
        leafIndex: 0,
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: ReleaseType.Cliff,
        startTime: new BN(cliff),
        cliffTime: new BN(cliff),
        endTime: new BN(cliff + 10_000),
        milestoneIdx: 0,
      };
      const merkle = new VestingMerkleTree([leaf]);

      const [treePda] = await treePDA(pid(), creator.publicKey, mint, cid);
      const [vaultAuthPda] = await vaultAuthorityPDA(pid(), treePda);
      const [crPda] = await claimRecordPDA(pid(), treePda, beneficiary.publicKey);
      const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
      const beneficiaryAta = await createBeneficiaryAta(provider, creator, beneficiary.publicKey, mint);
      const sourceAta = getAssociatedTokenAddressSync(mint, creator.publicKey);

      // Create + fund campaign
      await program.methods
        .createCampaign({
          campaignId: new BN(cid),
          merkleRoot: Array.from(merkle.root),
          leafCount: 1,
          totalSupply: new BN(AMOUNT),
          minCliffTime: new BN(cliff),
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
          sourceAta,
        })
        .signers([creator])
        .rpc();

      // Claim full amount
      await program.methods
        .claim(idlLeaf(leaf), idlProof(merkle.proof(0)))
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

      // Close claim record — Anchor's close = beneficiary writes discriminator
      await program.methods
        .closeClaimRecord()
        .accounts({
          beneficiary: beneficiary.publicKey,
          vestingTree: treePda,
          claimRecord: crPda,
        })
        .signers([beneficiary])
        .rpc();

      // ── ATTACK: claim on the closed ClaimRecord ──
      // Anchor's close writes CLOSED_ACCOUNT_DISCRIMINATOR → deserialization of
      // Account<'info, ClaimRecord> will fail (discriminator mismatch).
      try {
        await program.methods
          .claim(idlLeaf(leaf), idlProof(merkle.proof(0)))
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
        expect.fail("SA-3 ATTACK SUCCEEDED: claim after close should be rejected");
      } catch (e: any) {
        // Expected: Anchor discriminator mismatch → account won't deserialize
        const msg = (e.message || String(e)).toLowerCase();
        const logs = ((e.logs || []) as string[]).join("\n").toLowerCase();
        const combined = msg + "\n" + logs;
        const hasError =
          combined.includes("discriminator") ||
          combined.includes("account") ||
          combined.includes("declined") ||
          combined.includes("failed") ||
          combined.includes("invalid") ||
          combined.includes("error");
        expect(hasError, `expected discriminator/account error, got: ${msg}`).to.equal(true);
      }
    });
  });
});
