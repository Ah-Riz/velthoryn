import { BN, Program, Wallet, Idl } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  createAccount,
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
} from "../clients/ts/src";

const GRACE_PERIOD_SECS = 7 * 24 * 60 * 60;

const ERR = {
  NothingToClaim: 6015,
  InsufficientVault: 6016,
  GracePeriodActive: 6027,
  CannotClose: 6028,
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
  amount: number,
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

describe("vesting clock-dependent tests (bankrun)", () => {
  let ctx: Awaited<ReturnType<typeof startTest>>;

  before(async () => {
    ctx = await startTest();
  });

  const freshCtx = () => ctx;

  it("T17: linear claim at exactly 25% unlocks exactly 25% of leaf amount", async () => {
    const { context, provider, program, creator, cancelAuthority, pauseAuthority } = freshCtx();
    const beneficiary = await makeBeneficiaryTx(provider);
    const AMOUNT = 10_000;

    const now = await bankrunNow(context);
    const start = now;
    const end = now + 1000;

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

    const tree = new VestingMerkleTree([leaf]);
    const minCliffTime = leaf.cliffTime;
    const { mint } = await createTestMintTx(provider, creator.publicKey);
    await fundCreatorAtaTx(provider, mint, creator.publicKey, AMOUNT);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 900);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    await program.methods
      .createCampaign({
        campaignId: new BN(900),
        merkleRoot: Array.from(tree.root),
        leafCount: 1,
        totalSupply: new BN(AMOUNT),
        minCliffTime,
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

    // Warp to exactly 25% vested (250s after start)
    await warpClock(context, start + 250);

    const beneficiaryAta = await createBeneficiaryAta(provider, mint, beneficiary.publicKey);
    const crPda = (await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey))[0];

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

    const postBal = await getAccount(provider.connection, beneficiaryAta);
    expect(Number(postBal.amount)).to.equal(2500);
  });

  it("T18: progressive claim yields increasing cumulative amounts", async () => {
    const { context, provider, program, creator, cancelAuthority, pauseAuthority } = freshCtx();
    const beneficiary = await makeBeneficiaryTx(provider);
    const AMOUNT = 10_000;

    const now = await bankrunNow(context);
    const start = now;
    const end = now + 1000;

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

    const tree = new VestingMerkleTree([leaf]);
    const minCliffTime = leaf.cliffTime;
    const { mint } = await createTestMintTx(provider, creator.publicKey);
    await fundCreatorAtaTx(provider, mint, creator.publicKey, AMOUNT);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 901);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    await program.methods
      .createCampaign({
        campaignId: new BN(901),
        merkleRoot: Array.from(tree.root),
        leafCount: 1,
        totalSupply: new BN(AMOUNT),
        minCliffTime,
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

    const beneficiaryAta = await createBeneficiaryAta(provider, mint, beneficiary.publicKey);
    const crPda = (await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey))[0];

    // First claim at 30% vested
    await warpClock(context, start + 300);

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

    const firstBal = await getAccount(provider.connection, beneficiaryAta);
    expect(Number(firstBal.amount)).to.equal(3000);

    // Second claim at 80% vested
    await warpClock(context, start + 800);

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

    const secondBal = await getAccount(provider.connection, beneficiaryAta);
    expect(Number(secondBal.amount)).to.equal(8000);
  });

  it("T20: withdraw_unvested succeeds after grace period with full vault recovery", async () => {
    const { context, provider, program, creator, cancelAuthority, pauseAuthority } = freshCtx();
    const beneficiary = await makeBeneficiaryTx(provider);
    const AMOUNT = 10_000;

    const now = await bankrunNow(context);
    const cliff = now - 100;
    const end = now + 900;

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
    const minCliffTime = leaf.cliffTime;
    const { mint } = await createTestMintTx(provider, creator.publicKey);
    await fundCreatorAtaTx(provider, mint, creator.publicKey, AMOUNT);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 902);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    await program.methods
      .createCampaign({
        campaignId: new BN(902),
        merkleRoot: Array.from(tree.root),
        leafCount: 1,
        totalSupply: new BN(AMOUNT),
        minCliffTime,
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

    const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);
    const preCreatorTokens = Number((await getAccount(provider.connection, creatorAta)).amount);

    // Cancel
    await program.methods
      .cancelCampaign()
      .accounts({
        cancelAuthority: cancelAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([cancelAuthority])
      .rpc();

    // Warp past grace period
    const cancelledAt = await bankrunNow(context);
    await warpClock(context, cancelledAt + GRACE_PERIOD_SECS + 100);

    // withdraw_unvested should succeed
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

  it("T25: withdraw partial then full — progressive claims", async () => {
    const { context, provider, program, creator, cancelAuthority, pauseAuthority } = freshCtx();
    const AMOUNT = 10_000;
    const beneficiary = await makeBeneficiaryTx(provider);

    const { mint } = await createTestMintTx(provider, creator.publicKey);
    await fundCreatorAtaTx(provider, mint, creator.publicKey, AMOUNT);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 903);
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
        campaignId: new BN(903),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 1,
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

    // First withdraw at 30%
    await warpClock(context, start + 300);

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

    const midBal = await getAccount(provider.connection, beneficiaryAta);
    expect(Number(midBal.amount)).to.equal(3000);

    // Second withdraw at 80%
    await warpClock(context, start + 800);

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

    const postBal = await getAccount(provider.connection, beneficiaryAta);
    expect(Number(postBal.amount)).to.equal(8000);

    // Third withdraw at 100% vested — claim remaining 2000
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

    const fullBal = await getAccount(provider.connection, beneficiaryAta);
    expect(Number(fullBal.amount)).to.equal(AMOUNT);
  });

  it("T56: withdraw at exactly 25% unlocks 25% of stream amount", async () => {
    const { context, provider, program, creator, cancelAuthority } = freshCtx();
    const AMOUNT = 10_000;
    const beneficiary = await makeBeneficiaryTx(provider);

    const { mint } = await createTestMintTx(provider, creator.publicKey);
    await fundCreatorAtaTx(provider, mint, creator.publicKey, AMOUNT);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 904);
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
        campaignId: new BN(904),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 1,
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

    await warpClock(context, start + 250);

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

    const bal = await getAccount(provider.connection, beneficiaryAta);
    expect(Number(bal.amount)).to.equal(2500);
  });

  it("T57: withdraw at 100% vested claims full stream amount", async () => {
    const { context, provider, program, creator, cancelAuthority } = freshCtx();
    const AMOUNT = 10_000;
    const beneficiary = await makeBeneficiaryTx(provider);

    const { mint } = await createTestMintTx(provider, creator.publicKey);
    await fundCreatorAtaTx(provider, mint, creator.publicKey, AMOUNT);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 905);
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
        campaignId: new BN(905),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 1,
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

    const bal = await getAccount(provider.connection, beneficiaryAta);
    expect(Number(bal.amount)).to.equal(AMOUNT);

    const vaultBal = await getAccount(provider.connection, vault);
    expect(Number(vaultBal.amount)).to.equal(0);
  });

  it("T58: withdraw at exactly 50% unlocks 50% of stream amount", async () => {
    const { context, provider, program, creator, cancelAuthority } = freshCtx();
    const AMOUNT = 10_000;
    const beneficiary = await makeBeneficiaryTx(provider);

    const { mint } = await createTestMintTx(provider, creator.publicKey);
    await fundCreatorAtaTx(provider, mint, creator.publicKey, AMOUNT);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 906);
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
        campaignId: new BN(906),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 1,
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

    const bal = await getAccount(provider.connection, beneficiaryAta);
    expect(Number(bal.amount)).to.equal(5000);
  });

  it("T59: immediate second withdraw rejects with NothingToClaim", async () => {
    const { context, provider, program, creator, cancelAuthority } = freshCtx();
    const AMOUNT = 10_000;
    const beneficiary = await makeBeneficiaryTx(provider);

    const { mint } = await createTestMintTx(provider, creator.publicKey);
    await fundCreatorAtaTx(provider, mint, creator.publicKey, AMOUNT);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 907);
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
        campaignId: new BN(907),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 1,
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

    await warpClock(context, start + 250);

    const withdrawAccounts = {
      beneficiary: beneficiary.publicKey,
      vestingTree: treePda,
      claimRecord: crPda,
      vaultAuthority: vaultAuthPda,
      vault,
      beneficiaryAta,
      mint,
    };
    const withdrawArgs = {
      releaseType: 1,
      startTime: new BN(start),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    await program.methods
      .withdraw(withdrawArgs)
      .accounts(withdrawAccounts)
      .signers([beneficiary])
      .rpc();

    try {
      await program.methods
        .withdraw(withdrawArgs)
        .accounts(withdrawAccounts)
        .signers([beneficiary])
        .rpc();
      expect.fail("should have thrown NothingToClaim");
    } catch (e) {
      expectAnchorError(e, ERR.NothingToClaim);
    }
  });

  it("T47: close_claim_record after grace period succeeds", async () => {
    const { context, provider, program, creator, cancelAuthority, pauseAuthority } = freshCtx();
    const beneficiary = await makeBeneficiaryTx(provider);
    const AMOUNT = 10_000;

    const now = await bankrunNow(context);
    const cliff = now - 500;
    const end = now + 500;

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
    const minCliffTime = leaf.cliffTime;
    const { mint } = await createTestMintTx(provider, creator.publicKey);
    await fundCreatorAtaTx(provider, mint, creator.publicKey, AMOUNT);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 904);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = await createBeneficiaryAta(provider, mint, beneficiary.publicKey);
    const crPda = (await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey))[0];

    await program.methods
      .createCampaign({
        campaignId: new BN(904),
        merkleRoot: Array.from(tree.root),
        leafCount: 1,
        totalSupply: new BN(AMOUNT),
        minCliffTime,
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

    // Claim some tokens (partial, ~50% vested)
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

    // Cancel the campaign
    await program.methods
      .cancelCampaign()
      .accounts({
        cancelAuthority: cancelAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([cancelAuthority])
      .rpc();

    // Warp past grace period
    const cancelledAt = await bankrunNow(context);
    await warpClock(context, cancelledAt + GRACE_PERIOD_SECS + 100);

    const preCloseSol = Number(await context.banksClient.getBalance(beneficiary.publicKey));

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

    const postCloseSol = Number(await context.banksClient.getBalance(beneficiary.publicKey));
    expect(postCloseSol).to.be.greaterThan(preCloseSol);
  });

  it("T55: withdraw after cancel uses cancel-time clamped amount", async () => {
    const { context, provider, program, creator, cancelAuthority, pauseAuthority } = freshCtx();
    const AMOUNT = 10_000;
    const beneficiary = await makeBeneficiaryTx(provider);

    const { mint } = await createTestMintTx(provider, creator.publicKey);
    await fundCreatorAtaTx(provider, mint, creator.publicKey, AMOUNT);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 905);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = await createBeneficiaryAta(provider, mint, beneficiary.publicKey);

    const now = await bankrunNow(context);
    const startTime = now;
    const cliffTime = now;
    const endTime = now + 1000;

    await program.methods
      .createStream({
        campaignId: new BN(905),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 1,
        startTime: new BN(startTime),
        cliffTime: new BN(cliffTime),
        endTime: new BN(endTime),
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

    // Warp to 50% mark
    await warpClock(context, startTime + 500);

    // Cancel at ~50%
    await program.methods
      .cancelCampaign()
      .accounts({
        cancelAuthority: cancelAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([cancelAuthority])
      .rpc();

    // Warp past end
    await warpClock(context, startTime + 2000);

    // Withdraw -> should get ~5000 (50% at cancel time), NOT 10000
    await program.methods
      .withdraw({
        releaseType: 1,
        startTime: new BN(startTime),
        cliffTime: new BN(cliffTime),
        endTime: new BN(endTime),
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

    const postBal = await getAccount(provider.connection, beneficiaryAta);
    const received = Number(postBal.amount);
    expect(received).to.be.at.least(4900);
    expect(received).to.be.at.most(5100);
  });

  it("T64: cancel_stream splits unlocked to beneficiary and locked to creator", async () => {
    const { context, provider, program, creator, cancelAuthority } = freshCtx();
    const AMOUNT = 10_000;
    const beneficiary = await makeBeneficiaryTx(provider);

    const { mint } = await createTestMintTx(provider, creator.publicKey);
    await fundCreatorAtaTx(provider, mint, creator.publicKey, AMOUNT);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 9863);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = await createBeneficiaryAta(provider, mint, beneficiary.publicKey);
    const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);

    const now = await bankrunNow(context);
    const cliff = now - 1000;
    const end = now + 1000;
    const withdrawArgs = {
      releaseType: 1,
      startTime: new BN(cliff),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    await program.methods
      .createStream({
        campaignId: new BN(9863),
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

    await warpClock(context, now);

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
    expect(Number(postBeneficiary.amount)).to.equal(5_000);
    expect(Number(postCreator.amount)).to.equal(5_000);
    expect(Number(postVault.amount)).to.equal(0);
  });

  it("EXPLOIT 4: claim after full vault withdrawal -> InsufficientVault", async () => {
    const { context, provider, program, creator, cancelAuthority, pauseAuthority } = freshCtx();
    const beneficiary = await makeBeneficiaryTx(provider);
    const AMOUNT = 1_000_000;

    const now = await bankrunNow(context);
    const start = now - 2000;
    const end = now - 10;

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

    const tree = new VestingMerkleTree([leaf]);
    const minCliffTime = leaf.cliffTime;
    const { mint } = await createTestMintTx(provider, creator.publicKey);
    await fundCreatorAtaTx(provider, mint, creator.publicKey, AMOUNT);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 906);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = await createBeneficiaryAta(provider, mint, beneficiary.publicKey);
    const crPda = (await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey))[0];

    await program.methods
      .createCampaign({
        campaignId: new BN(906),
        merkleRoot: Array.from(tree.root),
        leafCount: 1,
        totalSupply: new BN(AMOUNT),
        minCliffTime,
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

    // Warp past grace period
    const cancelledAt = await bankrunNow(context);
    await warpClock(context, cancelledAt + GRACE_PERIOD_SECS + 100);

    // Withdraw everything from vault
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

    // Verify vault is empty
    const vaultAccount = await getAccount(provider.connection, vault);
    expect(Number(vaultAccount.amount)).to.equal(0);

    // Try to claim -> should fail with InsufficientVault
    try {
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
      expect.fail("EXPLOIT 4 SUCCEEDED: claim after vault withdrawal should have been rejected");
    } catch (e) {
      expectAnchorError(e, ERR.InsufficientVault);
    }
  });

  it("EXPLOIT 11: partial withdraw then close then withdraw cannot double-pay", async () => {
    const { context, provider, program, creator, cancelAuthority } = freshCtx();
    const AMOUNT = 1_000_000;
    const beneficiary = await makeBeneficiaryTx(provider);

    const { mint } = await createTestMintTx(provider, creator.publicKey);
    await fundCreatorAtaTx(provider, mint, creator.publicKey, AMOUNT);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 907);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = await createBeneficiaryAta(
      provider,
      mint,
      beneficiary.publicKey,
    );

    const now = await bankrunNow(context);
    const start = now - 500;
    const cliff = now - 500;
    const end = now + 500;
    const withdrawArgs = {
      releaseType: 1,
      startTime: new BN(start),
      cliffTime: new BN(cliff),
      endTime: new BN(end),
      milestoneIdx: 0,
    };

    await program.methods
      .createStream({
        campaignId: new BN(907),
        beneficiary: beneficiary.publicKey,
        amount: new BN(AMOUNT),
        releaseType: 1,
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

    const beforeFirst = (await getAccount(provider.connection, beneficiaryAta))
      .amount;

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

    const firstPayout = Number(
      (await getAccount(provider.connection, beneficiaryAta)).amount -
        beforeFirst,
    );
    expect(firstPayout).to.be.greaterThan(0);
    expect(firstPayout).to.be.lessThan(AMOUNT);

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
      expect.fail(
        "EXPLOIT 11 SUCCEEDED: premature close after partial withdraw should be rejected",
      );
    } catch (e) {
      expectAnchorError(e, ERR.CannotClose);
    }

    const beforeSecond = (await getAccount(provider.connection, beneficiaryAta))
      .amount;

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
      const secondPayout = Number(
        (await getAccount(provider.connection, beneficiaryAta)).amount -
          beforeSecond,
      );
      expect(secondPayout).to.equal(0);
    } catch (e) {
      expectAnchorError(e, ERR.NothingToClaim);
    }
  });

  it("pause at T1, cancel at T2, claim mid-grace, creator sweeps unvested after grace", async () => {
    const { context, provider, program, creator, cancelAuthority, pauseAuthority } =
      freshCtx();
    const beneficiary = await makeBeneficiaryTx(provider);
    const AMOUNT = 10_000;

    const t0 = await bankrunNow(context);
    const start = t0;
    const end = t0 + 1000;
    const t1 = t0 + 100;
    const t2 = t0 + 500;

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

    const tree = new VestingMerkleTree([leaf]);
    const minCliffTime = leaf.cliffTime;
    const { mint } = await createTestMintTx(provider, creator.publicKey);
    await fundCreatorAtaTx(provider, mint, creator.publicKey, AMOUNT);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 908);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
    const beneficiaryAta = await createBeneficiaryAta(
      provider,
      mint,
      beneficiary.publicKey,
    );
    const crPda = (await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey))[0];
    const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);

    await program.methods
      .createCampaign({
        campaignId: new BN(908),
        merkleRoot: Array.from(tree.root),
        leafCount: 1,
        totalSupply: new BN(AMOUNT),
        minCliffTime,
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
        sourceAta: creatorAta,
      })
      .signers([creator])
      .rpc();

    await warpClock(context, t1);
    await program.methods
      .pauseCampaign()
      .accounts({
        pauseAuthority: pauseAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([pauseAuthority])
      .rpc();

    await warpClock(context, t2);
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

    await warpClock(context, t2 + 3 * 86400);
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

    const postBeneficiary = await getAccount(provider.connection, beneficiaryAta);
    expect(Number(postBeneficiary.amount)).to.equal(5000);

    const preCreator = Number((await getAccount(provider.connection, creatorAta)).amount);
    await warpClock(context, t2 + GRACE_PERIOD_SECS + 100);
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

    const postCreator = Number((await getAccount(provider.connection, creatorAta)).amount);
    expect(postCreator - preCreator).to.equal(5000);
    const postVault = await getAccount(provider.connection, vault);
    expect(Number(postVault.amount)).to.equal(0);
  });
});
