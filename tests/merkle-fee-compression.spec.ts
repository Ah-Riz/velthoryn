/**
 * merkle-fee-compression.spec.ts
 *
 * REAL, empirical measurement of how much a Merkle-tree distribution compresses
 * the on-chain cost of sending to N recipients — answering BD/Marketing's
 * "does Merkle really compress transaction fees?" with measured numbers, not
 * estimates.
 *
 * What it does (per N in SIZES):
 *   1. Builds a Merkle tree over N REAL, freshly-generated wallets (1 lamport each).
 *   2. OUR PATH (numerator): createCampaignNative + fundCampaignNative (O(1), paid by
 *      distributor) + N claims (each beneficiary is the FEE PAYER, matching real
 *      claimant cost). Measures real rent, real base fee, real compute units.
 *   3. NAIVE PATH (denominator): a Streamflow/Zebec-style "1 escrow record per
 *      recipient" model — actually creates N rent-exempt accounts (one per wallet,
 *      sized like a vesting record) + funds each, all paid by the distributor.
 *   4. Emits a console table + tests/results/merkle-compression-results.json, plus a
 *      projected 1M-recipient row (transparent arithmetic from measured per-unit costs).
 *
 * Bonus: this is the FIRST test to exercise the real `claim` path against a real
 * validator (Mollusk cannot, due to init_if_needed), so it produces the first
 * REAL measured `claim` compute-unit figure — replacing the CU_BUDGET.md estimate.
 *
 * Run on localnet (full table):   pnpm test:compression
 * Run on devnet (smallest footprint, N=5, 1 lamport each):
 *                                 pnpm test:compression:devnet
 *
 * Gated on COMPRESSION_RUN=1 so it does NOT bloat the normal `pnpm test` suite.
 *
 * Reuses: tests/utils/setup.ts, tests/utils/helpers.ts (idlLeaf/idlProof),
 *         clients/ts/src (VestingMerkleTree, ReleaseType, VestingLeaf).
 */

import { BN } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

import { PROGRAM_ID, claimRecordPDA, setup, treePDA } from "./utils/setup";
import { idlLeaf, idlProof } from "./utils/helpers";
import { ReleaseType, VestingMerkleTree, type VestingLeaf } from "../clients/ts/src";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Native SOL mint = all-zeros pubkey (matches on-chain NATIVE_SOL_MINT). */
const NATIVE_SOL_MINT = PublicKey.default;
/** Sentinel for the Optional SPL accounts when claiming native SOL (= PROGRAM_ID). */
const SENTINEL = PROGRAM_ID;

/**
 * Representative per-recipient vesting-record size for the naive baseline.
 * Equals our own ClaimRecord size (232 B) — a fair "one record per recipient"
 * comparison. Rent scales linearly with size; this is reported in the output so
 * the denominator is fully transparent.
 */
const VESTING_RECORD_SIZE = 232;

/** Token allocation per recipient — 1 base unit (1 lamport), the absolute minimum. */
const LEAF_AMOUNT_LAMPORTS = 1;

/** Measure fee/CU/rent on the first SAMPLE recipients of each category, then scale
 *  by N (per-unit costs are protocol-level constants). Bounds getTransaction calls. */
const SAMPLE = 8;

/** Solana base fee per signature, lamports (for sanity assertions). */
const BASE_FEE_LAMPORTS = 5000;

/** Concurrency for firing the N claims / N naive-account creations. */
const CONCURRENCY = 8;

/** USD price assumed for the optional USD column (clearly labelled in output). */
const SOL_PRICE_USD = 150;

// ---------------------------------------------------------------------------
// Cluster detection + size selection
// ---------------------------------------------------------------------------

function detectCluster(rpcEndpoint: string): "localnet" | "devnet" {
  return /127\.0\.0\.1|localhost/i.test(rpcEndpoint) ? "localnet" : "devnet";
}

const SIZES_ENV = process.env.COMPRESSION_SIZES;
const DEFAULT_SIZES: Record<string, number[]> = {
  localnet: [5, 10, 100, 1000],
  devnet: [5], // smallest footprint per user instruction
};
// ---------------------------------------------------------------------------
// Small async helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Read fee + compute units for a confirmed signature (retries — tx may lag). */
async function txMeta(
  connection: any,
  sig: string,
): Promise<{ fee: number; cu: number }> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const tx = await connection.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (tx?.meta) {
      return {
        fee: tx.meta.fee ?? 0,
        cu: tx.meta.computeUnitsConsumed ?? 0,
      };
    }
    await sleep(300);
  }
  return { fee: 0, cu: 0 };
}

/** Rent-exempt minimum for an account of `size` data bytes. */
async function rentFor(connection: any, size: number): Promise<number> {
  return connection.getMinimumBalanceForRentExemption(size);
}

/** Build + send a tx with a chosen fee payer and extra signers; returns signature. */
async function sendTx(
  connection: any,
  feePayer: Keypair,
  ixs: TransactionInstruction[],
  extraSigners: Keypair[] = [],
): Promise<string> {
  // getLatestBlockhash() may return { value: {...} } or flat {...} across web3.js versions.
  const raw: any = await connection.getLatestBlockhash();
  const bh: any = raw?.value ?? raw;
  const recentBlockhash: string = bh.blockhash;
  const lastValidBlockHeight: number = bh.lastValidBlockHeight;
  const tx = new Transaction({
    feePayer: feePayer.publicKey,
    recentBlockhash,
  }).add(...ixs);
  tx.sign(feePayer, ...extraSigners);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });
  await connection.confirmTransaction(
    { signature: sig, blockhash: recentBlockhash, lastValidBlockHeight },
    "confirmed",
  );
  return sig;
}

/** Fund many recipients from the payer in batched txs (K transfers per tx). */
async function batchFund(
  connection: any,
  payer: Keypair,
  recipients: { pubkey: PublicKey; lamports: number }[],
  perTx: number,
): Promise<void> {
  for (let i = 0; i < recipients.length; i += perTx) {
    const chunk = recipients.slice(i, i + perTx);
    const ixs = chunk.map((r) =>
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: r.pubkey,
        lamports: r.lamports,
      }),
    );
    await sendTx(connection, payer, ixs);
  }
}

/** Run an async fn over items with bounded concurrency. */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

const fmtSol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(6);
const fmtUsd = (lamports: number) =>
  ((lamports / LAMPORTS_PER_SOL) * SOL_PRICE_USD).toFixed(4);

// ---------------------------------------------------------------------------
// Per-N measurement
// ---------------------------------------------------------------------------

interface SizeResult {
  N: number;
  our: {
    setupRentLamports: number;
    setupFeeLamports: number;
    setupCu: number;
    perClaimRentLamports: number;
    perClaimFeeLamports: number;
    perClaimCu: number;
    senderOverheadLamports: number; // setup rent + setup fees (distributor-only, O(1))
    totalOverheadLamports: number; // sender + N claims (end-to-end)
    totalCu: number;
  };
  naive: {
    perRecipientRentLamports: number;
    perRecipientFeeLamports: number;
    perRecipientCu: number;
    totalOverheadLamports: number; // N escrow accounts + N create txs (distributor)
    totalCu: number;
  };
  ratios: {
    distributor: number; // naive distributor cost / our distributor cost (O(1) vs O(N)) — headline
    totalSystem: number; // naive end-to-end / our end-to-end (incl. claimant records)
  };
}

/**
 * Measure one N. Returns the SizeResult. Throws on unexpected on-chain failure so
 * the test surfaces real errors (this is a measurement of a real flow).
 */
async function measureSize(
  ctx: { provider: any; program: any; creator: Keypair },
  N: number,
  campaignId: number,
): Promise<SizeResult> {
  const { provider, program, creator } = ctx;
  const connection = provider.connection as any;

  // --- 1. Generate N real wallets + fund each just enough to claim.
  // The beneficiary must stay rent-exempt AFTER paying the ClaimRecord rent + fee. ---
  const claimRecordRent = await rentFor(connection, VESTING_RECORD_SIZE);
  const accountRent = await rentFor(connection, 0); // rent-exempt floor for a system account
  const claimBudget = claimRecordRent + accountRent + 15_000; // CR rent + own rent + fee/buffer
  const beneficiaries: Keypair[] = [];
  for (let i = 0; i < N; i++) {
    beneficiaries.push(Keypair.generate());
  }
  // Fund from the distributor (batched transfers — cheap bulk setup).
  await batchFund(
    connection,
    creator,
    beneficiaries.map((kp) => ({ pubkey: kp.publicKey, lamports: claimBudget })),
    20,
  );

  // --- 2. Build the Merkle tree over the N wallets (1 lamport each, fully vested). ---
  const pastOffset = 3600; // cliff in the past => 100% vested at creation (no clock warp needed)
  const slot = await connection.getSlot();
  const now = (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
  const cliff = now - pastOffset;

  const leaves: VestingLeaf[] = beneficiaries.map((kp, i) => ({
    leafIndex: i,
    beneficiary: kp.publicKey,
    amount: new BN(LEAF_AMOUNT_LAMPORTS),
    releaseType: ReleaseType.Cliff,
    startTime: new BN(cliff - pastOffset),
    cliffTime: new BN(cliff),
    endTime: new BN(cliff + 60),
    milestoneIdx: 0,
  }));
  const tree = new VestingMerkleTree(leaves);
  const totalSupply = N * LEAF_AMOUNT_LAMPORTS;

  const [treePda] = await treePDA(
    PROGRAM_ID,
    creator.publicKey,
    NATIVE_SOL_MINT,
    campaignId,
  );

  // --- OUR PATH: create + fund (distributor pays; O(1) regardless of N) ---
  const creatorBefore = await connection.getBalance(creator.publicKey, "confirmed");

  const sigCreate = await program.methods
    .createCampaignNative({
      campaignId: new BN(campaignId),
      merkleRoot: Array.from(tree.root),
      leafCount: N,
      totalSupply: new BN(totalSupply),
      minCliffTime: new BN(cliff),
      cancellable: false,
      cancelAuthority: null,
      pauseAuthority: null,
    })
    .accounts({
      creator: creator.publicKey,
      vestingTree: treePda,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .signers([creator])
    .rpc();

  const sigFund = await program.methods
    .fundCampaignNative(new BN(totalSupply))
    .accounts({
      creator: creator.publicKey,
      vestingTree: treePda,
      systemProgram: SystemProgram.programId,
    })
    .signers([creator])
    .rpc();

  const creatorAfter = await connection.getBalance(creator.publicKey, "confirmed");
  const metaCreate = await txMeta(connection, sigCreate);
  const metaFund = await txMeta(connection, sigFund);

  // delta = VestingTree rent + 2 fees + totalSupply (allocation moved into tree PDA).
  const setupDelta = creatorBefore - creatorAfter;
  const setupRent = setupDelta - totalSupply - metaCreate.fee - metaFund.fee;
  const setupFee = metaCreate.fee + metaFund.fee;
  const setupCu = metaCreate.cu + metaFund.cu;

  // --- OUR PATH: N claims, each beneficiary is the FEE PAYER (real claimant cost) ---
  const measuredClaim = { rent: 0, fee: 0, cu: 0, count: 0 };

  await mapWithConcurrency(beneficiaries, CONCURRENCY, async (beneficiary, i) => {
    const [crPda] = await claimRecordPDA(PROGRAM_ID, treePda, beneficiary.publicKey);
    const ix = await program.methods
      .claim(idlLeaf(leaves[i]), idlProof(tree.proof(i)))
      .accounts({
        beneficiary: beneficiary.publicKey,
        vestingTree: treePda,
        claimRecord: crPda,
        vaultAuthority: SENTINEL,
        vault: SENTINEL,
        beneficiaryAta: SENTINEL,
        mint: SENTINEL,
        tokenProgram: SENTINEL,
        associatedTokenProgram: SENTINEL,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const sig = await sendTx(connection, beneficiary, [ix], [beneficiary]);

    if (i < SAMPLE) {
      const m = await txMeta(connection, sig);
      const crInfo = await connection.getAccountInfo(crPda, "confirmed");
      const rent = crInfo?.lamports ?? (await rentFor(connection, VESTING_RECORD_SIZE));
      measuredClaim.rent += rent;
      measuredClaim.fee += m.fee;
      measuredClaim.cu += m.cu;
      measuredClaim.count += 1;
    }
  });

  const perClaimRent = measuredClaim.count ? measuredClaim.rent / measuredClaim.count : 0;
  const perClaimFee = measuredClaim.count ? measuredClaim.fee / measuredClaim.count : 0;
  const perClaimCu = measuredClaim.count ? measuredClaim.cu / measuredClaim.count : 0;

  const ourSenderOverhead = setupRent + setupFee; // distributor's O(1) cost
  const ourTotalOverhead = ourSenderOverhead + N * (perClaimRent + perClaimFee);
  const ourTotalCu = setupCu + N * perClaimCu;

  // --- NAIVE PATH: "1 escrow record per recipient" (Streamflow/Zebec-style). ---
  // Distributor actually creates N rent-exempt accounts (VESTING_RECORD_SIZE bytes),
  // each funded with the allocation, one tx per recipient — same wallets.
  const escrowRent = await rentFor(connection, VESTING_RECORD_SIZE);
  const measuredNaive = { fee: 0, cu: 0, count: 0 };

  await mapWithConcurrency(
    beneficiaries,
    CONCURRENCY,
    async (_ben, i) => {
      const escrow = Keypair.generate();
      const ix = SystemProgram.createAccount({
        fromPubkey: creator.publicKey,
        newAccountPubkey: escrow.publicKey,
        lamports: escrowRent + LEAF_AMOUNT_LAMPORTS, // rent + allocation
        space: VESTING_RECORD_SIZE,
        programId: SystemProgram.programId,
      });
      const sig = await sendTx(connection, creator, [ix], [escrow]);
      if (i < SAMPLE) {
        const m = await txMeta(connection, sig);
        measuredNaive.fee += m.fee;
        measuredNaive.cu += m.cu;
        measuredNaive.count += 1;
      }
    },
  );

  const perNaiveFee = measuredNaive.count ? measuredNaive.fee / measuredNaive.count : 0;
  const perNaiveCu = measuredNaive.count ? measuredNaive.cu / measuredNaive.count : 0;

  const naiveTotalOverhead = N * (escrowRent + perNaiveFee);
  const naiveTotalCu = N * perNaiveCu;

  // --- Ratios ---
  // HEADLINE: distributor upfront cost — O(1) (us) vs O(N) (naive). Fees on both sides.
  const distributorRatio =
    ourSenderOverhead > 0 ? naiveTotalOverhead / ourSenderOverhead : 0;
  // Honest caveat: end-to-end incl. claimant ClaimRecords. Comparable because our
  // per-claimant record ≈ naive escrow size — but ours is claimant-paid + lazy.
  const totalSystemRatio =
    ourTotalOverhead > 0 ? naiveTotalOverhead / ourTotalOverhead : 0;

  return {
    N,
    our: {
      setupRentLamports: Math.round(setupRent),
      setupFeeLamports: setupFee,
      setupCu,
      perClaimRentLamports: Math.round(perClaimRent),
      perClaimFeeLamports: Math.round(perClaimFee),
      perClaimCu: Math.round(perClaimCu),
      senderOverheadLamports: Math.round(ourSenderOverhead),
      totalOverheadLamports: Math.round(ourTotalOverhead),
      totalCu: Math.round(ourTotalCu),
    },
    naive: {
      perRecipientRentLamports: escrowRent,
      perRecipientFeeLamports: Math.round(perNaiveFee),
      perRecipientCu: Math.round(perNaiveCu),
      totalOverheadLamports: Math.round(naiveTotalOverhead),
      totalCu: Math.round(naiveTotalCu),
    },
    ratios: {
      distributor: distributorRatio,
      totalSystem: totalSystemRatio,
    },
  };
}

// ---------------------------------------------------------------------------
// Test suite (gated so the normal suite is unaffected)
// ---------------------------------------------------------------------------

const RUN = process.env.COMPRESSION_RUN === "1";

(RUN ? describe : describe.skip)(
  "merkle-fee-compression (real on-chain measurement)",
  function () {
    this.timeout(1_200_000); // 20 min ceiling for N=1000 on localnet

    const { provider, program, creator } = setup();
    const connection = provider.connection as any;
    const rpc = (provider.connection as any).rpcEndpoint ?? "";
    const cluster = detectCluster(rpc);
    const SIZES = SIZES_ENV
      ? SIZES_ENV.split(",").map((s) => parseInt(s.trim(), 10))
      : DEFAULT_SIZES[cluster];

    const results: SizeResult[] = [];

    before(async function () {
      if (cluster === "localnet") {
        // Top up the distributor freely (local faucet mints SOL). requestAirdrop
        // may cap per call, so loop in 10-SOL increments up to a safe budget for N=1000.
        const TARGET = 60 * LAMPORTS_PER_SOL;
        for (let i = 0; i < 12; i++) {
          const bal = await connection.getBalance(creator.publicKey, "confirmed");
          if (bal >= TARGET) break;
          const sig = await connection.requestAirdrop(
            creator.publicKey,
            10 * LAMPORTS_PER_SOL,
          );
          await connection.confirmTransaction(sig, "confirmed");
        }
      } else {
        // Devnet: do NOT faucet-spam. Proceed only if the wallet already has SOL.
        const bal = await connection.getBalance(creator.publicKey, "confirmed");
        const needed = 0.1 * LAMPORTS_PER_SOL; // tiny smoke (N=5, 1 lamport each)
        if (bal < needed) {
          console.log(
            `\n  ⚠️  Devnet wallet balance ${fmtSol(bal)} SOL < ${fmtSol(needed)} SOL — ` +
              `skipping compression smoke. Fund ~/.config/solana/id.json on devnet to enable.\n`,
          );
          this.skip();
        }
      }
    });

    it("measures Merkle fee compression across N recipients (real create+fund+claim)", async function () {
      // Randomize base so VestingTree PDAs never collide with prior runs on a
      // persistent validator (the PDA is deterministic in creator+mint+campaignId).
      let campaignId = 10_000_000 + Math.floor(Math.random() * 1_000_000);
      for (const N of SIZES) {
        // Fresh campaign id per size so PDAs never collide.
        const res = await measureSize(
          { provider, program, creator },
          N,
          campaignId++,
        );
        results.push(res);
      }

      // --- Projection to 1M recipients (arithmetic from measured per-unit costs) ---
      const basis = results[results.length - 1]!; // largest measured N = most stable per-unit
      const perClaimOverhead =
        basis.our.perClaimRentLamports + basis.our.perClaimFeeLamports;
      const perNaiveOverhead =
        basis.naive.perRecipientRentLamports + basis.naive.perRecipientFeeLamports;
      const N1M = 1_000_000;
      // Distributor cost: ours O(1) (setup only), naive O(N) (N escrow accounts).
      const ourDist1m = basis.our.senderOverheadLamports;
      const naiveDist1m = N1M * perNaiveOverhead;
      // End-to-end (incl. claimant ClaimRecords) — honest caveat.
      const ourTotal1m = basis.our.senderOverheadLamports + N1M * perClaimOverhead;
      const naiveTotal1m = N1M * perNaiveOverhead;

      // --- Console report ---
      console.log("\n");
      console.log("=".repeat(78));
      console.log(
        "MERKLE FEE-COMPRESSION — REAL MEASUREMENT " +
          `(cluster=${cluster}, program=${PROGRAM_ID.toBase58()})`,
      );
      console.log(
        `naive baseline = ${VESTING_RECORD_SIZE}-B escrow account per recipient, created & ` +
          `funded by the distributor (Streamflow/Zebec-style); allocation = ${LEAF_AMOUNT_LAMPORTS} lamport/recipient`,
      );
      console.log(`SOL price assumption (USD column): $${SOL_PRICE_USD}`);
      console.log("=".repeat(78));

      console.log("\nMeasured per-unit costs (real rent / base fee / compute units):");
      console.table({
        "VestingTree rent (our setup, O(1))": {
          lamports: results[0]!.our.setupRentLamports,
          SOL: fmtSol(results[0]!.our.setupRentLamports),
        },
        "ClaimRecord rent (per claimant, lazy)": {
          lamports: results[0]!.our.perClaimRentLamports,
          SOL: fmtSol(results[0]!.our.perClaimRentLamports),
        },
        "Per-claim base fee": {
          lamports: results[0]!.our.perClaimFeeLamports,
          SOL: fmtSol(results[0]!.our.perClaimFeeLamports),
        },
        "Per-claim compute units (REAL first measurement) ⭐": {
          lamports: results[0]!.our.perClaimCu,
          SOL: "CU",
        },
        "Per-recipient escrow rent (naive)": {
          lamports: results[0]!.naive.perRecipientRentLamports,
          SOL: fmtSol(results[0]!.naive.perRecipientRentLamports),
        },
      });

      // HEADLINE: distributor upfront cost (O(1) vs O(N)).
      const distributor = results.map((r) => ({
        N: r.N,
        "our_distributor_SOL (O(1))": fmtSol(r.our.senderOverheadLamports),
        "naive_distributor_SOL (O(N))": fmtSol(r.naive.totalOverheadLamports),
        "compression (headline)": `${Math.round(r.ratios.distributor)}×`,
      }));
      console.log(
        "\nHEADLINE — distributor upfront cost to set up a distribution for N recipients:",
      );
      console.log("(what the DISTRIBUTOR pays; claimant costs excluded — see caveat below)");
      console.table(distributor);

      // Honest caveat: end-to-end incl. claimant ClaimRecords.
      const endToEnd = results.map((r) => ({
        N: r.N,
        "our_total_SOL (setup+N claims)": fmtSol(r.our.totalOverheadLamports),
        "naive_total_SOL (N escrows)": fmtSol(r.naive.totalOverheadLamports),
        "end_to_end_ratio": `${r.ratios.totalSystem.toFixed(2)}×`,
      }));
      console.log("\nHonest caveat — END-TO-END (incl. per-claimant ClaimRecords):");
      console.log(
        "Comparable because our ClaimRecord ≈ naive escrow size; BUT ours is claimant-paid + lazy + recoverable.",
      );
      console.table(endToEnd);

      console.log(
        `\nProjected 1,000,000 recipients (from N=${basis.N} per-unit costs, NOT executed):`,
      );
      console.log("  Distributor cost (the Merkle win):");
      console.table({
        "our distributor (O(1))": { SOL: fmtSol(ourDist1m), USD: fmtUsd(ourDist1m) },
        "naive distributor (O(N))": { SOL: fmtSol(naiveDist1m), USD: fmtUsd(naiveDist1m) },
        "compression": { SOL: `${Math.round(naiveDist1m / ourDist1m)}×`, USD: "" },
      });
      console.log("  End-to-end (incl. claimant records — comparable):");
      console.table({
        "our total": { SOL: fmtSol(ourTotal1m), USD: fmtUsd(ourTotal1m) },
        "naive total": { SOL: fmtSol(naiveTotal1m), USD: fmtUsd(naiveTotal1m) },
        "ratio": { SOL: `${(naiveTotal1m / ourTotal1m).toFixed(1)}×`, USD: "" },
      });

      // --- Sanity assertions (these are real measurements; guard against nonsense) ---
      const r0 = results[0]!;
      expect(r0.our.perClaimFeeLamports, "claim base fee ~5000 lamports").to.be.closeTo(
        BASE_FEE_LAMPORTS,
        2000,
      );
      expect(r0.our.setupRentLamports, "VestingTree rent ~0.00314 SOL (323-byte layout)").to.be.greaterThan(
        2_000_000,
      );
      expect(r0.our.perClaimCu, "claim CU measured (>0)").to.be.greaterThan(5000);
      // Setup cost must be ~constant across N (O(1)); total must grow ~linearly.
      const small = results.find((r) => r.N === Math.min(...SIZES))!;
      const big = results.find((r) => r.N === Math.max(...SIZES))!;
      expect(
        big.our.senderOverheadLamports,
        "distributor setup is O(1) — same at small and large N",
      ).to.be.closeTo(small.our.senderOverheadLamports, 2_000_000);

      // --- Persist JSON artifact for the report ---
      const outDir = path.join(__dirname, "results");
      fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, "merkle-compression-results.json");
      const payload = {
        generatedAt: new Date().toISOString(),
        cluster,
        rpcEndpoint: rpc,
        programId: PROGRAM_ID.toBase58(),
        solPriceUsd: SOL_PRICE_USD,
        naiveModel: {
          kind: "1 rent-exempt escrow account per recipient (Streamflow/Zebec-style)",
          recordSizeBytes: VESTING_RECORD_SIZE,
        },
        allocationLamportsPerRecipient: LEAF_AMOUNT_LAMPORTS,
        tokenType: "native SOL",
        basisN: basis.N,
        sizes: results,
        projected1M: {
          basisN: basis.N,
          distributor: {
            note: "O(1) us vs O(N) naive — the headline Merkle compression",
            ourOverheadLamports: Math.round(ourDist1m),
            naiveOverheadLamports: Math.round(naiveDist1m),
            ratio: naiveDist1m / ourDist1m,
          },
          totalSystem: {
            note: "End-to-end incl. claimant ClaimRecords (comparable; ours claimant-paid+lazy)",
            ourOverheadLamports: Math.round(ourTotal1m),
            naiveOverheadLamports: Math.round(naiveTotal1m),
            ratio: naiveTotal1m / ourTotal1m,
          },
        },
        note:
          "All costs measured on a real Solana validator (localnet = real validator binary; " +
          "same rent/CU/fee math as mainnet). Per-unit fee/CU sampled on the first " +
          SAMPLE + " recipients of each category and scaled by N (protocol-level constants). " +
          "Claim CU is the FIRST real measurement (Mollusk cannot run the claim path).",
      };
      fs.writeFileSync(outFile, JSON.stringify(payload, null, 2) + "\n");
      console.log(`\n✅ Results written to ${outFile}\n`);

      // Non-fatal note: if devnet smoke, the small-N numbers still validate the path.
      expect(results.length, "at least one size measured").to.be.greaterThan(0);
    });
  },
);
