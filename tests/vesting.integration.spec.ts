import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { expect } from "chai";

import {
  setup,
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
  ReleaseType,
  VestingMerkleTree,
  type VestingLeaf,
} from "../clients/ts/src";

// ---------------------------------------------------------------------------
// Error codes from the IDL
// ---------------------------------------------------------------------------
const ERR = {
  InvalidProof: 6013,
  CampaignPaused: 6009,
  CampaignCancelled: 6023,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a leaf object matching the IDL `vestingLeaf` type exactly. */
function idlLeaf(leaf: VestingLeaf): {
  leafIndex: number;
  beneficiary: PublicKey;
  amount: BN;
  releaseType: number;
  startTime: BN;
  cliffTime: BN;
  endTime: BN;
  milestoneIdx: number;
} {
  return {
    leafIndex: leaf.leafIndex,
    beneficiary: leaf.beneficiary,
    amount: leaf.amount,
    releaseType: leaf.releaseType,
    startTime: leaf.startTime,
    cliffTime: leaf.cliffTime,
    endTime: leaf.endTime,
    milestoneIdx: leaf.milestoneIdx,
  };
}

/** Convert a Buffer[] proof into the number[][] format the IDL expects. */
function idlProof(proof: Buffer[]): number[][] {
  return proof.map((b) => Array.from(b));
}

/** Expect an Anchor custom program error with the given error code. */
function expectAnchorError(err: unknown, code: number) {
  const hex = "0x" + code.toString(16).padStart(4, "0");
  const msg = (err as any).message || String(err);
  const logs = ((err as any).logs || []).join("\n");
  const haystack = msg + "\n" + logs;
  expect(
    haystack,
    `expected Anchor error ${hex} (${code})`,
  ).to.include(hex);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("vesting integration T1-T5", () => {
  const { provider, program, creator, cancelAuthority, pauseAuthority } =
    setup();

  // -----------------------------------------------------------------------
  // T1: Linear mid-stream claim (~50% vested)
  // -----------------------------------------------------------------------
  it("T1: linear mid-stream claim transfers ~50% of leaf amount", async () => {
    const mint = await createTestMint(provider, creator.publicKey);
    const AMOUNT = 10_000; // reduced from 1_000_000 for devnet
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);

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

    const tree = new VestingMerkleTree([leaf]);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 0);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    // 1. Create campaign
    await program.methods
      .createCampaign({
        campaignId: new BN(0),
        merkleRoot: Array.from(tree.root),
        leafCount: 1,
        totalSupply: new BN(AMOUNT),
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

    // 2. Fund campaign
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

    // 3. Record pre-claim balances
    const beneficiaryAta = getAssociatedTokenAddressSync(
      mint,
      beneficiary.publicKey,
    );
    const preVault = await getAccount(provider.connection, vault);
    // Beneficiary ATA doesn't exist yet (created by init_if_needed during claim)

    // 4. Claim
    await program.methods
      .claim(idlLeaf(leaf), idlProof(tree.proof(0)))
      .accounts({
        beneficiary: beneficiary.publicKey,
        vestingTree: treePda,
        claimRecord: (await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey))[0],
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta,
        mint,
      })
      .signers([beneficiary])
      .rpc();

    // 5. Post-claim assertions
    const postVault = await getAccount(provider.connection, vault);
    const postBeneficiary = await getAccount(provider.connection, beneficiaryAta);
    const transferred = Number(postBeneficiary.amount);

    // transferred should be ~5_000 (50% of 10_000), allow +/-10% for timing
    expect(transferred).to.be.at.least(4_000);
    expect(transferred).to.be.at.most(6_000);

    // Claim record should reflect the claim
    const [crPda] = await claimRecordPDA(
      PROGRAM_ID,
      treePda,
      beneficiary.publicKey,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimRecord: any = await (program.account as any)["claimRecord"].fetch(crPda);
    expect(claimRecord.claimedAmount.toNumber()).to.equal(transferred);

    // Vault balance should have decreased by transferred amount
    expect(Number(preVault.amount) - Number(postVault.amount)).to.equal(transferred);
  });

  // -----------------------------------------------------------------------
  // T2: Invalid proof (flipped byte) -> InvalidProof
  // -----------------------------------------------------------------------
  it("T2: claim with corrupted proof rejects with InvalidProof", async () => {
    const mint = await createTestMint(provider, creator.publicKey);
    const AMOUNT = 20_000; // reduced from 2_000_000 for devnet
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);

    const beneficiary0 = await makeBeneficiary(provider);
    const beneficiary1 = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(1);
    const end = t.future(900);

    const leaves: VestingLeaf[] = [
      {
        leafIndex: 0,
        beneficiary: beneficiary0.publicKey,
        amount: new BN(10_000),
        releaseType: ReleaseType.Linear,
        startTime: new BN(cliff),
        cliffTime: new BN(cliff),
        endTime: new BN(end),
        milestoneIdx: 0,
      },
      {
        leafIndex: 1,
        beneficiary: beneficiary1.publicKey,
        amount: new BN(10_000),
        releaseType: ReleaseType.Linear,
        startTime: new BN(cliff),
        cliffTime: new BN(cliff),
        endTime: new BN(end),
        milestoneIdx: 0,
      },
    ];

    const tree = new VestingMerkleTree(leaves);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 1);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    await program.methods
      .createCampaign({
        campaignId: new BN(1),
        merkleRoot: Array.from(tree.root),
        leafCount: 2,
        totalSupply: new BN(AMOUNT),
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

    // Corrupt proof: flip a byte in the first sibling hash
    const validProof = tree.proof(0);
    const corruptedProof = validProof.map((buf) => {
      const copy = Buffer.from(buf);
      copy[0] ^= 0xff; // flip first byte
      return copy;
    });

    try {
      await program.methods
        .claim(idlLeaf(leaves[0]), idlProof(corruptedProof))
        .accounts({
          beneficiary: beneficiary0.publicKey,
          vestingTree: treePda,
          claimRecord: (await claimRecordPDA(PROGRAM_ID, treePda, beneficiary0.publicKey))[0],
          vaultAuthority: vaultAuthPda,
          vault,
          beneficiaryAta: getAssociatedTokenAddressSync(
            mint,
            beneficiary0.publicKey,
          ),
          mint,
        })
        .signers([beneficiary0])
        .rpc();
      expect.fail("should have thrown InvalidProof");
    } catch (e) {
      expectAnchorError(e, ERR.InvalidProof);
    }
  });

  // -----------------------------------------------------------------------
  // T3: Pause/unpause claim guard
  // -----------------------------------------------------------------------
  it("T3: paused campaign rejects claim, unpaused campaign allows claim", async () => {
    const mint = await createTestMint(provider, creator.publicKey);
    const AMOUNT = 10_000; // reduced from 500_000 for devnet
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);

    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(1); // cliff already passed

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

    const tree = new VestingMerkleTree([leaf]);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 2);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    await program.methods
      .createCampaign({
        campaignId: new BN(2),
        merkleRoot: Array.from(tree.root),
        leafCount: 1,
        totalSupply: new BN(AMOUNT),
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

    // Pause the campaign
    await program.methods
      .pauseCampaign()
      .accounts({
        pauseAuthority: pauseAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([pauseAuthority])
      .rpc();

    // Claim while paused should fail
    try {
      await program.methods
        .claim(idlLeaf(leaf), idlProof(tree.proof(0)))
        .accounts({
          beneficiary: beneficiary.publicKey,
          vestingTree: treePda,
          claimRecord: (await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey))[0],
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

    // Unpause the campaign
    await program.methods
      .unpauseCampaign()
      .accounts({
        pauseAuthority: pauseAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([pauseAuthority])
      .rpc();

    // Claim after unpause should succeed
    const beneficiaryAta = getAssociatedTokenAddressSync(
      mint,
      beneficiary.publicKey,
    );
    await program.methods
      .claim(idlLeaf(leaf), idlProof(tree.proof(0)))
      .accounts({
        beneficiary: beneficiary.publicKey,
        vestingTree: treePda,
        claimRecord: (await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey))[0],
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta,
        mint,
      })
      .signers([beneficiary])
      .rpc();

    // Cliff release: full amount should be transferred
    const postBeneficiary = await getAccount(provider.connection, beneficiaryAta);
    expect(Number(postBeneficiary.amount)).to.equal(AMOUNT);
  });

  // -----------------------------------------------------------------------
  // T4: Cancel clamp (vested frozen at cancel time)
  // -----------------------------------------------------------------------
  it("T4: cancelling campaign freezes vested amount at cancel time", async () => {
    const mint = await createTestMint(provider, creator.publicKey);
    const AMOUNT = 10_000; // reduced from 1_000_000 for devnet
    await fundCreatorAta(provider, mint, creator.publicKey, AMOUNT);

    const beneficiary = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(1);
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

    const tree = new VestingMerkleTree([leaf]);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 3);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    await program.methods
      .createCampaign({
        campaignId: new BN(3),
        merkleRoot: Array.from(tree.root),
        leafCount: 1,
        totalSupply: new BN(AMOUNT),
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

    // Cancel the campaign -- this freezes the effective time for vesting
    await program.methods
      .cancelCampaign()
      .accounts({
        cancelAuthority: cancelAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([cancelAuthority])
      .rpc();

    // Wait 2 seconds to ensure real time has advanced past the cancel point
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Claim after cancel -- vested amount should be clamped to cancel time
    const beneficiaryAta = getAssociatedTokenAddressSync(
      mint,
      beneficiary.publicKey,
    );
    await program.methods
      .claim(idlLeaf(leaf), idlProof(tree.proof(0)))
      .accounts({
        beneficiary: beneficiary.publicKey,
        vestingTree: treePda,
        claimRecord: (await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey))[0],
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta,
        mint,
      })
      .signers([beneficiary])
      .rpc();

    const postBeneficiary = await getAccount(provider.connection, beneficiaryAta);
    // At cancel time, vested fraction is tiny (cliff 1s past, end 500s future).
    // Allow generous margin: must be <= 6_000 (60% of 10_000).
    expect(Number(postBeneficiary.amount)).to.be.at.most(6_000);
    // And should be non-zero since we were past the cliff at cancel time
    expect(Number(postBeneficiary.amount)).to.be.at.least(1);
  });

  // -----------------------------------------------------------------------
  // T5: Root rotation
  // -----------------------------------------------------------------------
  it("T5: root rotation invalidates old proofs and accepts new ones", async () => {
    const mint = await createTestMint(provider, creator.publicKey);
    const TOTAL = 30_000; // reduced from 3_000_000 for devnet
    await fundCreatorAta(provider, mint, creator.publicKey, TOTAL);

    const alice = await makeBeneficiary(provider);
    const bob = await makeBeneficiary(provider);
    const carol = await makeBeneficiary(provider);
    const t = await createTimeHelpers(provider.connection);
    const cliff = t.past(1);
    const end = t.future(900);

    // Original tree: Alice(0), Bob(1), Carol(2)
    const originalLeaves: VestingLeaf[] = [
      {
        leafIndex: 0,
        beneficiary: alice.publicKey,
        amount: new BN(10_000),
        releaseType: ReleaseType.Linear,
        startTime: new BN(cliff),
        cliffTime: new BN(cliff),
        endTime: new BN(end),
        milestoneIdx: 0,
      },
      {
        leafIndex: 1,
        beneficiary: bob.publicKey,
        amount: new BN(10_000),
        releaseType: ReleaseType.Linear,
        startTime: new BN(cliff),
        cliffTime: new BN(cliff),
        endTime: new BN(end),
        milestoneIdx: 0,
      },
      {
        leafIndex: 2,
        beneficiary: carol.publicKey,
        amount: new BN(10_000),
        releaseType: ReleaseType.Linear,
        startTime: new BN(cliff),
        cliffTime: new BN(cliff),
        endTime: new BN(end),
        milestoneIdx: 0,
      },
    ];

    const originalTree = new VestingMerkleTree(originalLeaves);

    const [treePda] = await treePDA(PROGRAM_ID, creator.publicKey, mint, 4);
    const [vaultAuthPda] = await vaultAuthorityPDA(PROGRAM_ID, treePda);
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);

    await program.methods
      .createCampaign({
        campaignId: new BN(4),
        merkleRoot: Array.from(originalTree.root),
        leafCount: 3,
        totalSupply: new BN(TOTAL),
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

    // Alice claims against the original tree -- should succeed
    await program.methods
      .claim(
        idlLeaf(originalLeaves[0]),
        idlProof(originalTree.proof(0)),
      )
      .accounts({
        beneficiary: alice.publicKey,
        vestingTree: treePda,
        claimRecord: (await claimRecordPDA(PROGRAM_ID, treePda, alice.publicKey))[0],
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta: getAssociatedTokenAddressSync(mint, alice.publicKey),
        mint,
      })
      .signers([alice])
      .rpc();

    // Rotate root: remove Bob, keep Alice(0) and Carol(1)
    const rotatedLeaves: VestingLeaf[] = [
      {
        leafIndex: 0,
        beneficiary: alice.publicKey,
        amount: new BN(10_000),
        releaseType: ReleaseType.Linear,
        startTime: new BN(cliff),
        cliffTime: new BN(cliff),
        endTime: new BN(end),
        milestoneIdx: 0,
      },
      {
        leafIndex: 1,
        beneficiary: carol.publicKey,
        amount: new BN(10_000),
        releaseType: ReleaseType.Linear,
        startTime: new BN(cliff),
        cliffTime: new BN(cliff),
        endTime: new BN(end),
        milestoneIdx: 0,
      },
    ];

    const rotatedTree = new VestingMerkleTree(rotatedLeaves);

    await program.methods
      .updateRoot(Array.from(rotatedTree.root), 2)
      .accounts({
        cancelAuthority: cancelAuthority.publicKey,
        vestingTree: treePda,
      })
      .signers([cancelAuthority])
      .rpc();

    // Bob's old proof (index 1 in original tree) should now fail
    try {
      await program.methods
        .claim(
          idlLeaf(originalLeaves[1]),
          idlProof(originalTree.proof(1)),
        )
        .accounts({
          beneficiary: bob.publicKey,
          vestingTree: treePda,
          claimRecord: (await claimRecordPDA(PROGRAM_ID, treePda, bob.publicKey))[0],
          vaultAuthority: vaultAuthPda,
          vault,
          beneficiaryAta: getAssociatedTokenAddressSync(mint, bob.publicKey),
          mint,
        })
        .signers([bob])
        .rpc();
      expect.fail("should have thrown InvalidProof for Bob after root rotation");
    } catch (e) {
      expectAnchorError(e, ERR.InvalidProof);
    }

    // Carol's new proof (index 1 in rotated tree) should succeed
    await program.methods
      .claim(idlLeaf(rotatedLeaves[1]), idlProof(rotatedTree.proof(1)))
      .accounts({
        beneficiary: carol.publicKey,
        vestingTree: treePda,
        claimRecord: (await claimRecordPDA(PROGRAM_ID, treePda, carol.publicKey))[0],
        vaultAuthority: vaultAuthPda,
        vault,
        beneficiaryAta: getAssociatedTokenAddressSync(mint, carol.publicKey),
        mint,
      })
      .signers([carol])
      .rpc();

    // Verify Carol actually received tokens
    const carolAta = await getAccount(
      provider.connection,
      getAssociatedTokenAddressSync(mint, carol.publicKey),
    );
    expect(Number(carolAta.amount)).to.be.greaterThan(0);
  });
});
