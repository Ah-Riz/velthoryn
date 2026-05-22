/**
 * Script: Create a multi-recipient milestone campaign on devnet.
 * 
 * This does NOT modify the program — it only calls existing instructions.
 * 
 * Prerequisites:
 *   - Solana CLI configured to devnet: `solana config set --url devnet`
 *   - Wallet with SOL: `solana airdrop 2`
 *   - Run from project root: `npx ts-node scripts/create-multi-milestone.ts`
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program, setProvider, workspace } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createMint,
  getAssociatedTokenAddressSync,
  mintTo,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { VestingMerkleTree, type VestingLeaf } from "../clients/ts/src";

const PROGRAM_ID = new PublicKey("G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu");

async function treePDA(creator: PublicKey, mint: PublicKey, campaignId: number) {
  return PublicKey.findProgramAddress(
    [Buffer.from("tree"), creator.toBuffer(), mint.toBuffer(), new BN(campaignId).toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID,
  );
}

async function vaultAuthorityPDA(tree: PublicKey) {
  return PublicKey.findProgramAddress(
    [Buffer.from("vault_authority"), tree.toBuffer()],
    PROGRAM_ID,
  );
}

async function main() {
  // Setup
  const provider = AnchorProvider.env();
  setProvider(provider);
  const program = workspace.Vesting as Program;
  const creator = (provider.wallet as anchor.Wallet).payer;

  console.log("Creator:", creator.publicKey.toBase58());
  console.log("Program:", PROGRAM_ID.toBase58());

  // 1. Create a test SPL token
  console.log("\n1. Creating test SPL token...");
  const mint = await createMint(
    provider.connection,
    creator,
    creator.publicKey,
    null,
    6, // 6 decimals
  );
  console.log("   Mint:", mint.toBase58());

  // 2. Mint tokens to creator
  const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);
  await getOrCreateAssociatedTokenAccount(provider.connection, creator, mint, creator.publicKey);
  const totalSupply = 3_000_000; // 3 tokens (6 decimals)
  await mintTo(provider.connection, creator, mint, creatorAta, creator, totalSupply);
  console.log("   Minted:", totalSupply / 1_000_000, "tokens to creator");

  // 3. Build 3 milestone leaves (3 recipients, each gets 1 token)
  const beneficiary1 = Keypair.generate().publicKey;
  const beneficiary2 = Keypair.generate().publicKey;
  const beneficiary3 = Keypair.generate().publicKey;

  const now = Math.floor(Date.now() / 1000);
  const leaves: VestingLeaf[] = [
    {
      leafIndex: 0,
      beneficiary: beneficiary1,
      amount: new BN(1_000_000),
      releaseType: 2, // Milestone
      startTime: new BN(now - 60),
      cliffTime: new BN(now + 300), // 5 min from now
      endTime: new BN(now + 300),
      milestoneIdx: 0,
    },
    {
      leafIndex: 1,
      beneficiary: beneficiary2,
      amount: new BN(1_000_000),
      releaseType: 2,
      startTime: new BN(now - 60),
      cliffTime: new BN(now + 600), // 10 min from now
      endTime: new BN(now + 600),
      milestoneIdx: 1,
    },
    {
      leafIndex: 2,
      beneficiary: beneficiary3,
      amount: new BN(1_000_000),
      releaseType: 2,
      startTime: new BN(now - 60),
      cliffTime: new BN(now + 900), // 15 min from now
      endTime: new BN(now + 900),
      milestoneIdx: 2,
    },
  ];

  console.log("\n2. Building Merkle tree (3 milestone leaves)...");
  const tree = new VestingMerkleTree(leaves);
  console.log("   Root:", Buffer.from(tree.root).toString("hex"));
  console.log("   Beneficiary 1:", beneficiary1.toBase58());
  console.log("   Beneficiary 2:", beneficiary2.toBase58());
  console.log("   Beneficiary 3:", beneficiary3.toBase58());

  // 4. Derive PDAs
  const campaignId = Math.floor(Date.now() / 1000) % 1_000_000;
  const [treePda] = await treePDA(creator.publicKey, mint, campaignId);
  const [vaultAuth] = await vaultAuthorityPDA(treePda);
  const vault = getAssociatedTokenAddressSync(mint, vaultAuth, true);

  console.log("\n3. Creating campaign on-chain...");
  console.log("   Campaign ID:", campaignId);
  console.log("   Tree PDA:", treePda.toBase58());

  // 5. Create campaign
  await program.methods
    .createCampaign({
      campaignId: new BN(campaignId),
      merkleRoot: Array.from(tree.root),
      leafCount: leaves.length,
      totalSupply: new BN(totalSupply),
      cancellable: true,
      cancelAuthority: creator.publicKey,
      pauseAuthority: creator.publicKey,
    })
    .accounts({
      creator: creator.publicKey,
      vestingTree: treePda,
      vaultAuthority: vaultAuth,
      vault,
      mint,
    })
    .rpc();
  console.log("   ✅ Campaign created!");

  // 6. Fund campaign
  console.log("\n4. Funding campaign...");
  await program.methods
    .fundCampaign(new BN(totalSupply))
    .accounts({
      creator: creator.publicKey,
      vestingTree: treePda,
      vault,
      sourceAta: creatorAta,
    })
    .rpc();
  console.log("   ✅ Funded with", totalSupply / 1_000_000, "tokens");

  // 7. Summary
  console.log("\n═══════════════════════════════════════════════");
  console.log("✅ Multi-recipient milestone campaign created!");
  console.log("═══════════════════════════════════════════════");
  console.log("Tree Address:", treePda.toBase58());
  console.log("Mint:", mint.toBase58());
  console.log("Leaf Count:", leaves.length);
  console.log("Campaign ID:", campaignId);
  console.log("");
  console.log("Open in browser:");
  console.log(`  http://localhost:3000/campaign/${treePda.toBase58()}`);
  console.log("");
  console.log("The MilestoneReleasePanel will show 3 milestones to release.");
  console.log("Connect with creator wallet to see Release buttons.");
  console.log("═══════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
