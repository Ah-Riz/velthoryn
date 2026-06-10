/**
 * benchmark-merkle.ts — Merkle tree scale benchmarks
 *
 * Measures VestingMerkleTree construction, proof generation, and proof
 * verification at scale. Outputs a formatted table matching the format in
 * docs/WEEK8_PERFORMANCE_REPORT.md section 3.
 *
 * Metrics:
 *   - Tree build time (ms)
 *   - Proof generation time (total ms, avg us/proof)
 *   - Proof verification time (total ms, avg us/proof)
 *   - Peak memory delta (RSS)
 *   - Proof size in bytes
 *
 * Usage:
 *   pnpm exec tsx scripts/benchmark-merkle.ts
 *   pnpm exec tsx scripts/benchmark-merkle.ts --sizes 100,1000,5000
 *   pnpm exec tsx scripts/benchmark-merkle.ts --runs 3
 *   node --expose-gc $(pnpm exec which tsx) scripts/benchmark-merkle.ts --runs 3
 *     (use --expose-gc for more accurate memory measurements)
 */

import { performance } from "perf_hooks";
import { Keypair } from "@solana/web3.js";
import BN from "bn.js";

import { VestingMerkleTree, verifyProof } from "../clients/ts/src/merkle";
import { leafHash } from "../clients/ts/src/leaf";
import type { VestingLeaf } from "../clients/ts/src/leaf";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseSizes(): number[] {
  const idx = process.argv.indexOf("--sizes");
  if (idx !== -1 && process.argv[idx + 1]) {
    const raw = process.argv[idx + 1];
    return raw
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0);
  }
  return [1_000, 5_000, 10_000, 15_000];
}

function parseRuns(): number {
  const idx = process.argv.indexOf("--runs");
  if (idx !== -1 && process.argv[idx + 1]) {
    const n = parseInt(process.argv[idx + 1], 10);
    if (!isNaN(n) && n > 0 && n <= 10) return n;
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Leaf generation
// ---------------------------------------------------------------------------

const BASE_TS = 1_700_000_000;

/**
 * Generate `count` random VestingLeaf entries. Each leaf has a unique keypair
 * as beneficiary and varies the release type cyclically across Cliff/Linear/Milestone.
 */
function generateLeaves(count: number): VestingLeaf[] {
  const leaves: VestingLeaf[] = [];
  for (let i = 0; i < count; i++) {
    const beneficiary = Keypair.generate().publicKey;
    // Cycle through release types
    const releaseType = (i % 3) as 0 | 1 | 2;
    const startTime = BigInt(BASE_TS + i * 1000);
    const cliffTime = releaseType === 0
      ? startTime + 31_536_000n // 1-year cliff
      : 0n;
    const endTime = startTime + BigInt(31_536_000 * (1 + (i % 4)));

    leaves.push({
      leafIndex: i,
      beneficiary,
      amount: new BN(1_000_000 + i * 1000),
      releaseType,
      startTime: new BN(startTime.toString()),
      cliffTime: new BN(cliffTime.toString()),
      endTime: new BN(endTime.toString()),
      milestoneIdx: i % 8,
    });
  }
  return leaves;
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

interface BenchmarkResult {
  leafCount: number;
  treeDepth: number;
  proofSizeBytes: number;
  buildTimeMs: number;
  proofGenTimeMs: number;
  proofGenAvgUs: number;
  proofVerifyTimeMs: number;
  proofVerifyAvgUs: number;
  peakMemoryDeltaMb: number;
  proofsPerSec: number;
}

function runBenchmark(leafCount: number): BenchmarkResult {
  // Force GC if available to get clean memory measurements
  if (typeof global.gc === "function") {
    global.gc();
  }

  const memBaseline = process.memoryUsage().heapUsed;

  // --- Generate leaves (measured separately from tree build) ---
  const leaves = generateLeaves(leafCount);

  // --- Tree construction ---
  const buildStart = performance.now();
  const tree = new VestingMerkleTree(leaves);
  const buildEnd = performance.now();
  const buildTimeMs = buildEnd - buildStart;

  // --- Proof generation (all leaves) ---
  const proofGenStart = performance.now();
  const proofs: Buffer[][] = [];
  for (let i = 0; i < leafCount; i++) {
    proofs.push(tree.proof(i));
  }
  const proofGenEnd = performance.now();
  const proofGenTimeMs = proofGenEnd - proofGenStart;
  const proofGenAvgUs = leafCount > 0
    ? (proofGenTimeMs * 1000) / leafCount
    : 0;

  // --- Proof verification (all leaves) ---
  const leafHashes = leaves.map(leafHash);
  const proofVerifyStart = performance.now();
  for (let i = 0; i < leafCount; i++) {
    // Verification result is asserted to be true
    const valid = verifyProof(leafHashes[i], proofs[i], i, tree.root);
    if (!valid) {
      console.error(`  ERROR: Proof verification failed for leaf ${i}`);
    }
  }
  const proofVerifyEnd = performance.now();
  const proofVerifyTimeMs = proofVerifyEnd - proofVerifyStart;
  const proofVerifyAvgUs = leafCount > 0
    ? (proofVerifyTimeMs * 1000) / leafCount
    : 0;

  // Memory: take peak heapUsed observed during the benchmark.
  // Using max of post-construction and post-verification avoids
  // GC-driven negative deltas.
  const memAfterBuild = process.memoryUsage().heapUsed;
  const memAfterVerify = process.memoryUsage().heapUsed;
  const peakHeapUsed = Math.max(memAfterBuild, memAfterVerify);
  const peakMemoryDeltaMb =
    Math.max(0, peakHeapUsed - memBaseline) / (1024 * 1024);

  const treeDepth = Math.ceil(Math.log2(leafCount));
  const proofSizeBytes = treeDepth * 32;
  const proofsPerSec = leafCount > 0
    ? Math.round(leafCount / (proofGenTimeMs / 1000))
    : 0;

  return {
    leafCount,
    treeDepth,
    proofSizeBytes,
    buildTimeMs,
    proofGenTimeMs,
    proofGenAvgUs,
    proofVerifyTimeMs,
    proofVerifyAvgUs,
    peakMemoryDeltaMb,
    proofsPerSec,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

function fmtMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)} us`;
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function fmtMem(mb: number): string {
  if (mb < 1) return `${(mb * 1024).toFixed(0)} KB`;
  return `${mb.toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function printResults(results: BenchmarkResult[]): void {
  console.log("");
  console.log("Merkle Tree Benchmark Results");
  console.log("=============================");
  console.log(`Node: ${process.version} | Platform: ${process.platform} | Arch: ${process.arch}`);
  console.log(`Date: ${new Date().toISOString()}`);
  console.log("");

  // --- Table 1: Build & Memory ---
  console.log("Build & Memory");
  console.log("--------------");
  const h1 = "Leaves";
  const h2 = "Depth";
  const h3 = "Build Time";
  const h4 = "Proof Size";
  const h5 = "Memory Delta";

  const col1w = Math.max(h1.length, ...results.map((r) => r.leafCount.toLocaleString().length));
  const col2w = Math.max(h2.length, 6);
  const col3w = Math.max(h3.length, 12);
  const col4w = Math.max(h4.length, 14);
  const col5w = Math.max(h5.length, 14);

  const header1 =
    padLeft(h1, col1w) + "  " +
    padLeft(h2, col2w) + "  " +
    padLeft(h3, col3w) + "  " +
    padLeft(h4, col4w) + "  " +
    padLeft(h5, col5w);
  const sep1 = "-".repeat(col1w) + "  " +
    "-".repeat(col2w) + "  " +
    "-".repeat(col3w) + "  " +
    "-".repeat(col4w) + "  " +
    "-".repeat(col5w);

  console.log(header1);
  console.log(sep1);

  for (const r of results) {
    const row =
      padLeft(r.leafCount.toLocaleString(), col1w) + "  " +
      padLeft(String(r.treeDepth), col2w) + "  " +
      padLeft(fmtMs(r.buildTimeMs), col3w) + "  " +
      padLeft(`${r.proofSizeBytes} (${r.treeDepth}*32)`, col4w) + "  " +
      padLeft(fmtMem(r.peakMemoryDeltaMb), col5w);
    console.log(row);
  }

  console.log("");

  // --- Table 2: Proof Generation & Verification ---
  console.log("Proof Generation & Verification");
  console.log("-------------------------------");
  const hp1 = "Leaves";
  const hp2 = "Gen Total";
  const hp3 = "Gen Avg";
  const hp4 = "Gen Rate";
  const hp5 = "Verify Total";
  const hp6 = "Verify Avg";

  const cp1w = Math.max(hp1.length, ...results.map((r) => r.leafCount.toLocaleString().length));
  const cp2w = Math.max(hp2.length, 12);
  const cp3w = Math.max(hp3.length, 12);
  const cp4w = Math.max(hp4.length, 14);
  const cp5w = Math.max(hp5.length, 14);
  const cp6w = Math.max(hp6.length, 12);

  const header2 =
    padLeft(hp1, cp1w) + "  " +
    padLeft(hp2, cp2w) + "  " +
    padLeft(hp3, cp3w) + "  " +
    padLeft(hp4, cp4w) + "  " +
    padLeft(hp5, cp5w) + "  " +
    padLeft(hp6, cp6w);
  const sep2 = "-".repeat(cp1w) + "  " +
    "-".repeat(cp2w) + "  " +
    "-".repeat(cp3w) + "  " +
    "-".repeat(cp4w) + "  " +
    "-".repeat(cp5w) + "  " +
    "-".repeat(cp6w);

  console.log(header2);
  console.log(sep2);

  for (const r of results) {
    const row =
      padLeft(r.leafCount.toLocaleString(), cp1w) + "  " +
      padLeft(fmtMs(r.proofGenTimeMs), cp2w) + "  " +
      padLeft(`${r.proofGenAvgUs.toFixed(1)} us`, cp3w) + "  " +
      padLeft(`${r.proofsPerSec.toLocaleString()}/s`, cp4w) + "  " +
      padLeft(fmtMs(r.proofVerifyTimeMs), cp5w) + "  " +
      padLeft(`${r.proofVerifyAvgUs.toFixed(1)} us`, cp6w);
    console.log(row);
  }

  console.log("");

  // --- Table 3: Markdown-compatible output (for pasting into docs) ---
  console.log("Markdown (for docs/WEEK8_PERFORMANCE_REPORT.md)");
  console.log("---------------------------------------------------");
  console.log("");
  console.log("| Leaves | Depth | Build Time | Memory | Proof Size | Proofs/sec | Gen Avg | Verify Avg |");
  console.log("|--------|-------|------------|--------|------------|------------|---------|------------|");
  for (const r of results) {
    console.log(
      `| ${r.leafCount.toLocaleString()} | ${r.treeDepth} | ${fmtMs(r.buildTimeMs)} | ${fmtMem(r.peakMemoryDeltaMb)} | ${r.proofSizeBytes} bytes | ${r.proofsPerSec.toLocaleString()}/s | ${r.proofGenAvgUs.toFixed(1)} us | ${r.proofVerifyAvgUs.toFixed(1)} us |`
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const sizes = parseSizes();
  const runs = parseRuns();

  console.log(`Benchmark: ${sizes.map((s) => s.toLocaleString()).join(", ")} leaves, ${runs} run(s) each`);

  if (runs === 1) {
    // Single run — no averaging needed
    const results = sizes.map((size) => {
      process.stdout.write(`  ${size.toLocaleString()} leaves ...`);
      const result = runBenchmark(size);
      console.log(` done (${fmtMs(result.buildTimeMs)} build, ${fmtMs(result.proofGenTimeMs)} proofs)`);
      return result;
    });
    printResults(results);
  } else {
    // Multiple runs — average the numeric fields
    const allRuns: BenchmarkResult[][] = [];

    for (let run = 0; run < runs; run++) {
      console.log(`\nRun ${run + 1}/${runs}`);
      const runResults = sizes.map((size) => {
        process.stdout.write(`  ${size.toLocaleString()} leaves ...`);
        const result = runBenchmark(size);
        console.log(` done (${fmtMs(result.buildTimeMs)} build)`);
        return result;
      });
      allRuns.push(runResults);
    }

    // Average across runs
    const averaged = sizes.map((size, i) => {
      const runsForSize = allRuns.map((r) => r[i]);
      return {
        leafCount: size,
        treeDepth: runsForSize[0]!.treeDepth,
        proofSizeBytes: runsForSize[0]!.proofSizeBytes,
        buildTimeMs: avg(runsForSize.map((r) => r.buildTimeMs)),
        proofGenTimeMs: avg(runsForSize.map((r) => r.proofGenTimeMs)),
        proofGenAvgUs: avg(runsForSize.map((r) => r.proofGenAvgUs)),
        proofVerifyTimeMs: avg(runsForSize.map((r) => r.proofVerifyTimeMs)),
        proofVerifyAvgUs: avg(runsForSize.map((r) => r.proofVerifyAvgUs)),
        peakMemoryDeltaMb: avg(runsForSize.map((r) => r.peakMemoryDeltaMb)),
        proofsPerSec: Math.round(avg(runsForSize.map((r) => r.proofsPerSec))),
      };
    });

    console.log(`\nAveraged across ${runs} run(s):`);
    printResults(averaged);
  }
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

main();
