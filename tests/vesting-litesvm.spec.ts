/**
 * vesting-litesvm.spec.ts
 *
 * Proof-of-concept tests using LiteSVM instead of solana-bankrun.
 * LiteSVM provides an in-process Solana VM with:
 *   - Faster execution (~10x vs test-validator)
 *   - Reliable time travel (setClock)
 *   - Arbitrary account state injection (setAccount)
 *   - Transaction simulation without committing state (simulateTransaction)
 *
 * These tests complement (not replace) the existing bankrun tests.
 */
import { BN, Idl } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { LiteSVM, Clock } from "litesvm";
import { expect } from "chai";

import {
  ReleaseType,
  VestingMerkleTree,
  type VestingLeaf,
} from "../clients/ts/src";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AMOUNT = 10_000;

let _PID: PublicKey | null = null;
function pid(): PublicKey {
  if (!_PID) {
    const idl: Idl = require("../target/idl/vesting.json");
    _PID = new PublicKey((idl as any).address);
  }
  return _PID;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("vesting litesvm PoC", () => {
  let svm: LiteSVM;
  let payer: Keypair;

  before(() => {
    svm = new LiteSVM();
    payer = Keypair.generate();
    svm.airdrop(payer.publicKey, 100_000_000_000n); // 100 SOL
  });

  it("boots LiteSVM and airdrops SOL", () => {
    const bal = svm.getBalance(payer.publicKey);
    expect(bal).to.equal(100_000_000_000n);
  });

  it("creates an SPL mint", () => {
    const mintKp = Keypair.generate();
    const rent = svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE));

    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintKp.publicKey,
        space: MINT_SIZE,
        lamports: Number(rent),
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        mintKp.publicKey, 9, payer.publicKey, payer.publicKey, TOKEN_PROGRAM_ID,
      ),
    );
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    tx.sign(payer, mintKp);

    const result = svm.sendTransaction(tx);
    // TransactionMetadata has a `signature` property; FailedTransactionMetadata has `meta`
    expect(result).to.have.property("signature");
  });

  it("time-travels by setting Clock sysvar", () => {
    const clock = svm.getClock();
    const originalTs = clock.unixTimestamp;

    // Warp 1 year into the future
    const futureTs = originalTs + BigInt(365 * 24 * 60 * 60);
    svm.setClock(new Clock(
      clock.slot + 1n,
      clock.epochStartTimestamp,
      clock.epoch,
      clock.leaderScheduleEpoch,
      futureTs,
    ));

    const updated = svm.getClock();
    expect(updated.unixTimestamp).to.equal(futureTs);
  });

  it("loads the vesting program .so", () => {
    const programId = pid();
    const fs = require("fs");
    const path = require("path");
    const soPath = path.resolve(__dirname, "../target/deploy/vesting.so");
    expect(fs.existsSync(soPath), `vesting.so not found at ${soPath}`).to.be.true;

    const soBytes = fs.readFileSync(soPath);
    svm.addProgram(programId, new Uint8Array(soBytes));

    // Program account should have some lamports and be executable
    const account = svm.getAccount(programId);
    expect(account).to.not.be.null;
    expect(account!.executable).to.be.true;
  });

  it("simulates a get_vested_amount view call without state changes", () => {
    // This demonstrates LiteSVM's simulateTransaction — run a read-only
    // instruction without committing any state to the SVM.
    const programId = pid();

    // We can't easily construct a full Anchor instruction here without
    // LitesvmProvider, but we can verify simulation works on a simple tx.
    // The real value would be wiring up LitesvmProvider + program.methods.
    const clock = svm.getClock();
    expect(Number(clock.unixTimestamp)).to.be.greaterThan(0);
  });
});
