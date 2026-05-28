import { BN, Wallet } from "@coral-xyz/anchor";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { expect } from "chai";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { startTest, bankrunNow, treePDA, vaultAuthorityPDA } from "./utils/bankrun";
import { PROGRAM_ID } from "./utils/setup";
import { ReleaseType, VestingMerkleTree, type VestingLeaf } from "../clients/ts/src";

async function createTestMint(provider: any, authority: any) {
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

async function mintToCreator(provider: any, mint: any, amount: number) {
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

  tx.add(createMintToInstruction(mint, ata, payer.publicKey, amount, [], TOKEN_PROGRAM_ID));
  await provider.sendAndConfirm(tx, [payer]);
}

describe("update_root min_cliff_time persistence (bankrun)", () => {
  it("rotating root updates minCliffTime (CEI-safe metadata)", async () => {
    const { context, provider, program, creator, cancelAuthority, pauseAuthority } =
      await startTest();

    const now = await bankrunNow(context);
    const mint = await createTestMint(provider, creator.publicKey);
    await mintToCreator(provider, mint, 1);

    const leaf0: VestingLeaf = {
      leafIndex: 0,
      beneficiary: creator.publicKey,
      amount: new BN(1),
      releaseType: ReleaseType.Cliff,
      startTime: new BN(now + 100),
      cliffTime: new BN(now + 100),
      endTime: new BN(now + 200),
      milestoneIdx: 0,
    };
    const tree0 = new VestingMerkleTree([leaf0]);
    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 6000);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    await program.methods
      .createCampaign({
        campaignId: new BN(6000),
        merkleRoot: Array.from(tree0.root),
        leafCount: 1,
        totalSupply: new BN(1),
        minCliffTime: leaf0.cliffTime,
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

    const before = await program.account.vestingTree.fetch(treePda);
    expect(Number(before.minCliffTime)).to.equal(Number(leaf0.cliffTime));

    const nextMinCliff = now + 9999;
    const leaf1: VestingLeaf = {
      ...leaf0,
      cliffTime: new BN(nextMinCliff),
      startTime: new BN(nextMinCliff),
      endTime: new BN(nextMinCliff + 100),
    };
    const tree1 = new VestingMerkleTree([leaf1]);

    await program.methods
      .updateRoot(Array.from(tree1.root), 1, new BN(nextMinCliff))
      .accounts({
        cancelAuthority: cancelAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([cancelAuthority])
      .rpc();

    const after = await program.account.vestingTree.fetch(treePda);
    expect(after.merkleRoot).to.deep.equal(Array.from(tree1.root));
    expect(after.leafCount).to.equal(1);
    expect(Number(after.minCliffTime)).to.equal(nextMinCliff);
  });
});

