import { BN, Wallet } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAccount,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { expect } from "chai";

import { startTest, treePDA, bankrunNow, warpClock, vaultAuthorityPDA } from "./utils/bankrun";
import { PROGRAM_ID } from "./utils/setup";
import { ReleaseType, VestingMerkleTree, type VestingLeaf } from "../clients/ts/src";

const NATIVE_SOL_MINT = PublicKey.default;

async function createTestMint(provider: any, authority: PublicKey): Promise<PublicKey> {
  const payer = (provider.wallet as Wallet).payer;
  const mintKp = Keypair.generate();
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

async function mintToCreator(provider: any, mint: PublicKey, amount: number): Promise<void> {
  const payer = (provider.wallet as Wallet).payer;
  const owner = payer.publicKey;
  const ata = getAssociatedTokenAddressSync(mint, owner);

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
}

describe("vesting tree layout (bankrun)", () => {
  it("new VestingTree fields exist and default safely (SPL + native)", async () => {
    const { context, provider, program, creator, cancelAuthority, pauseAuthority } =
      await startTest();

    // --- SPL campaign ---
    const mint = await createTestMint(provider, creator.publicKey);
    await mintToCreator(provider, mint, 1);

    const now = await bankrunNow(context);
    const MIN_CLIFF_TIME = now + 100;
    const leaf: VestingLeaf = {
      leafIndex: 0,
      beneficiary: creator.publicKey,
      amount: new BN(1),
      releaseType: ReleaseType.Cliff,
      startTime: new BN(MIN_CLIFF_TIME),
      cliffTime: new BN(MIN_CLIFF_TIME),
      endTime: new BN(now + 200),
      milestoneIdx: 0,
    };
    const tree = new VestingMerkleTree([leaf]);

    const [splTreePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 5000);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, splTreePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    await program.methods
      .createCampaign({
        campaignId: new BN(5000),
        merkleRoot: Array.from(tree.root),
        leafCount: 1,
        totalSupply: new BN(1),
        minCliffTime: new BN(MIN_CLIFF_TIME),
        cancellable: true,
        cancelAuthority: cancelAuthority.publicKey,
        pauseAuthority: pauseAuthority.publicKey,
      })
      .accounts({
        creator: creator.publicKey,
        vestingTree: splTreePda,
        vaultAuthority: vaultAuthPda,
        vault,
        mint,
      })
      .signers([creator])
      .rpc();

    const splTreeAccount = await program.account.vestingTree.fetch(splTreePda);
    expect(Number(splTreeAccount.minCliffTime)).to.equal(MIN_CLIFF_TIME);
    expect(splTreeAccount.instantRefunded).to.equal(false);

    // --- Native SOL campaign ---
    const beneficiary0 = Keypair.generate();
    const beneficiary1 = Keypair.generate();

    // Ensure clock moves so created_at differs from SPL path (sanity)
    await warpClock(context, now + 1);

    const leaves2: VestingLeaf[] = [
      {
        leafIndex: 0,
        beneficiary: beneficiary0.publicKey,
        amount: new BN(1),
        releaseType: ReleaseType.Cliff,
        startTime: new BN(MIN_CLIFF_TIME),
        cliffTime: new BN(MIN_CLIFF_TIME),
        endTime: new BN(now + 200),
        milestoneIdx: 0,
      },
      {
        leafIndex: 1,
        beneficiary: beneficiary1.publicKey,
        amount: new BN(1),
        releaseType: ReleaseType.Cliff,
        startTime: new BN(MIN_CLIFF_TIME),
        cliffTime: new BN(MIN_CLIFF_TIME),
        endTime: new BN(now + 200),
        milestoneIdx: 0,
      },
    ];
    const tree2 = new VestingMerkleTree(leaves2);

    const [nativeTreePda] = await treePDA(
      PROGRAM_ID,
      creator.publicKey,
      NATIVE_SOL_MINT,
      5001,
    );

    await program.methods
      .createCampaignNative({
        campaignId: new BN(5001),
        merkleRoot: Array.from(tree2.root),
        leafCount: 2,
        totalSupply: new BN(2),
        minCliffTime: new BN(MIN_CLIFF_TIME),
        cancellable: true,
        cancelAuthority: cancelAuthority.publicKey,
        pauseAuthority: pauseAuthority.publicKey,
      })
      .accounts({
        creator: creator.publicKey,
        vestingTree: nativeTreePda,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([creator])
      .rpc();

    const nativeTreeAccount = await program.account.vestingTree.fetch(nativeTreePda);
    expect(Number(nativeTreeAccount.minCliffTime)).to.equal(MIN_CLIFF_TIME);
    expect(nativeTreeAccount.instantRefunded).to.equal(false);
  });
});

