/**
 * test-be-merkle-pipeline.ts — Phase 6 Post-Deploy E2E Merkle Pipeline Test
 *
 * Verifies multi-leaf campaign flows through the BE API:
 *   prepare → POST → GET campaigns (smoke) → GET proof → verify
 *
 * Usage:
 *   npx tsx scripts/test-be-merkle-pipeline.ts
 *   npx tsx scripts/test-be-merkle-pipeline.ts --url https://your-app.vercel.app
 *   npx tsx scripts/test-be-merkle-pipeline.ts --url https://your-app.vercel.app --timeout 30000
 */

import { PublicKey, Keypair } from "@solana/web3.js";
import BN from "bn.js";

// clients/ts — reference merkle implementation
import { prepareCampaign } from "../clients/ts/src/prepare";
import { verifyProof } from "../clients/ts/src/merkle";
import { leafHash } from "../clients/ts/src/leaf";
import type { CampaignRecipient } from "../clients/ts/src/prepare";
import type { VestingLeaf } from "../clients/ts/src/leaf";
import { ReleaseType } from "../clients/ts/src/leaf";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = parseBaseUrl();
const TIMEOUT_MS = parseTimeout();
const BASE_TS = 1_700_000_000;

// ---------------------------------------------------------------------------
// Summary tracking
// ---------------------------------------------------------------------------

interface SummaryEntry {
  status: "PASS" | "FAIL";
  detail?: string;
}

const summary: Record<string, SummaryEntry> = {};

function recordSummary(
  phase: string,
  status: "PASS" | "FAIL",
  detail?: string
): void {
  summary[phase] = { status, detail };
}

// ---------------------------------------------------------------------------
// CLI flag parsing
// ---------------------------------------------------------------------------

function parseBaseUrl(): string {
  const idx = process.argv.indexOf("--url");
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1].replace(/\/$/, "");
  }
  return "http://localhost:3000";
}

function parseTimeout(): number {
  const idx = process.argv.indexOf("--timeout");
  if (idx !== -1 && process.argv[idx + 1]) {
    const ms = parseInt(process.argv[idx + 1], 10);
    if (!isNaN(ms) && ms > 0) return ms;
  }
  return 15_000;
}

function pass(label: string, detail?: string): void {
  console.log(`  PASS  ${label}${detail ? ` (${detail})` : ""}`);
}

function fail(label: string, detail: string): void {
  console.log(`  FAIL  ${label} — ${detail}`);
}

let anyFailed = false;

function assert(
  condition: boolean,
  label: string,
  detail: string
): void {
  if (condition) {
    pass(label);
  } else {
    fail(label, detail);
    anyFailed = true;
  }
}

// ---------------------------------------------------------------------------
// fetch with timeout
// ---------------------------------------------------------------------------

/**
 * Wrapper around fetch that enforces a timeout via AbortController.
 * Rejects with a DOMException("AbortError") if the server does not respond
 * within TIMEOUT_MS milliseconds.
 */
async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Step 1: Build campaign with 3 recipients
// ---------------------------------------------------------------------------

function buildRecipients(): CampaignRecipient[] {
  const alice = Keypair.generate().publicKey;
  const bob = Keypair.generate().publicKey;
  const carol = Keypair.generate().publicKey;

  return [
    {
      beneficiary: alice,
      amount: new BN(5_000_000),
      releaseType: ReleaseType.Cliff,
      startTime: new BN(BASE_TS),
      cliffTime: new BN(BASE_TS + 31_536_000), // 1-year cliff
      endTime: new BN(BASE_TS + 31_536_000),
      milestoneIdx: 0,
    },
    {
      beneficiary: bob,
      amount: new BN(10_000_000),
      releaseType: ReleaseType.Linear,
      startTime: new BN(BASE_TS),
      cliffTime: new BN(0),
      endTime: new BN(BASE_TS + 63_072_000), // 2-year linear
      milestoneIdx: 0,
    },
    {
      beneficiary: carol,
      amount: new BN(3_000_000),
      releaseType: ReleaseType.Milestone,
      startTime: new BN(BASE_TS),
      cliffTime: new BN(0),
      endTime: new BN(BASE_TS + 94_608_000), // 3-year milestone
      milestoneIdx: 3,
    },
  ];
}

// ---------------------------------------------------------------------------
// Step 2: POST /api/campaigns
// ---------------------------------------------------------------------------

interface PostResponse {
  ok: boolean;
  campaignId?: number;
  error?: string;
  status: number;
  treeAddress: string;
  creator: string;
}

async function postCampaign(
  prepared: ReturnType<typeof prepareCampaign>,
  _recipients: CampaignRecipient[]
): Promise<PostResponse> {
  const treeAddress = Keypair.generate().publicKey.toBase58();
  const creator = Keypair.generate().publicKey.toBase58();
  const mint = Keypair.generate().publicKey.toBase58();
  const now = Math.floor(Date.now() / 1000);

  const body = {
    treeAddress,
    creator,
    mint,
    campaignId: Math.floor(Math.random() * 1_000_000),
    merkleRoot: prepared.rootHex,
    leafCount: prepared.leafCount,
    totalSupply: prepared.totalSupply.toString(),
    cancellable: true,
    cancelAuthority: creator,
    pauseAuthority: null,
    createdAt: now,
    metadata: {
      name: "E2E Pipeline Test",
      description: "Automated test campaign",
    },
    leaves: prepared.leaves.map((leaf, i) => ({
      leafIndex: leaf.leafIndex,
      beneficiary: leaf.beneficiary.toBase58(),
      amount: leaf.amount.toString(),
      releaseType: leaf.releaseType,
      startTime: leaf.startTime.toString(),
      cliffTime: leaf.cliffTime.toString(),
      endTime: leaf.endTime.toString(),
      milestoneIdx: leaf.milestoneIdx,
      proof: prepared.proofs[i],
    })),
  };

  const res = await fetchWithTimeout(`${BASE_URL}/api/campaigns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as { ok: boolean; campaignId?: number; error?: string };
  return { ...json, status: res.status, treeAddress, creator };
}

// ---------------------------------------------------------------------------
// Step 3: GET /api/campaigns/:treeAddress/proof
// ---------------------------------------------------------------------------

interface ProofResponse {
  leaf: {
    leafIndex: number;
    beneficiary: string;
    amount: string;
    releaseType: number;
    startTime: string;
    cliffTime: string;
    endTime: string;
    milestoneIdx: number;
  };
  proof: number[][];
  merkleRoot: string;
  treeAddress: string;
}

async function getProof(
  treeAddress: string,
  beneficiary: string
): Promise<{ data: ProofResponse | null; status: number; error?: string }> {
  const res = await fetchWithTimeout(
    `${BASE_URL}/api/campaigns/${treeAddress}/proof?beneficiary=${beneficiary}`
  );
  if (res.ok) {
    return { data: (await res.json()) as ProofResponse, status: res.status };
  }
  const text = await res.text();
  return { data: null, status: res.status, error: text };
}

// ---------------------------------------------------------------------------
// Step 3b: GET /api/campaigns (smoke test — list endpoint)
// ---------------------------------------------------------------------------

interface CampaignListItem {
  treeAddress: string;
  campaignId: number;
  [key: string]: unknown;
}

async function listCampaigns(
  creator: string
): Promise<{ campaigns: CampaignListItem[]; status: number; error?: string }> {
  const res = await fetchWithTimeout(
    `${BASE_URL}/api/campaigns?creator=${encodeURIComponent(creator)}`
  );
  if (res.ok) {
    const json = (await res.json()) as {
      campaigns?: CampaignListItem[];
      data?: CampaignListItem[];
    };
    // Accept either { campaigns: [...] } or { data: [...] }
    const campaigns = json.campaigns ?? json.data ?? [];
    return { campaigns, status: res.status };
  }
  const text = await res.text();
  return { campaigns: [], status: res.status, error: text };
}

// ---------------------------------------------------------------------------
// Step 4: Verify proof + leaf data
// ---------------------------------------------------------------------------

function verifyLeafData(
  inputLeaf: VestingLeaf,
  returnedLeaf: ProofResponse["leaf"]
): boolean {
  return (
    inputLeaf.leafIndex === returnedLeaf.leafIndex &&
    inputLeaf.beneficiary.toBase58() === returnedLeaf.beneficiary &&
    BigInt(inputLeaf.amount.toString()) === BigInt(returnedLeaf.amount) &&
    inputLeaf.releaseType === returnedLeaf.releaseType &&
    BigInt(inputLeaf.startTime.toString()) === BigInt(returnedLeaf.startTime) &&
    BigInt(inputLeaf.cliffTime.toString()) === BigInt(returnedLeaf.cliffTime) &&
    BigInt(inputLeaf.endTime.toString()) === BigInt(returnedLeaf.endTime) &&
    inputLeaf.milestoneIdx === returnedLeaf.milestoneIdx
  );
}

function verifyReturnedProof(
  returnedProof: number[][],
  leafIndex: number,
  leafHashBuf: Buffer,
  rootBuf: Buffer
): boolean {
  const proofBufs = returnedProof.map((arr) => Buffer.from(arr));
  return verifyProof(leafHashBuf, proofBufs, leafIndex, rootBuf);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`E2E Merkle Pipeline Test — ${BASE_URL} (timeout: ${TIMEOUT_MS}ms)\n`);

  // --- Step 1: prepareCampaign ---
  console.log("[1/5] prepareCampaign");
  const recipients = buildRecipients();
  const prepared = prepareCampaign(recipients);

  const prepareOk =
    prepared.leafCount === 3 && prepared.root.length === 32;
  assert(prepared.leafCount === 3, "3 leaves created", `got ${prepared.leafCount}`);
  assert(prepared.root.length === 32, "root is 32 bytes", `got ${prepared.root.length}`);
  recordSummary("prepare", prepareOk ? "PASS" : "FAIL");
  console.log(`        root=0x${prepared.rootHex.slice(0, 16)}...\n`);

  // --- Step 2: POST /api/campaigns ---
  console.log("[2/5] POST /api/campaigns");
  let postRes: PostResponse;
  try {
    postRes = await postCampaign(prepared, recipients);
  } catch (err) {
    const msg =
      err instanceof DOMException && err.name === "AbortError"
        ? `Timed out after ${TIMEOUT_MS}ms — server may be cold-starting. Try --timeout 30000`
        : `Connection failed — is the dev server running at ${BASE_URL}? (cd apps/web && pnpm dev)`;
    fail("POST /api/campaigns", msg);
    recordSummary("POST", "FAIL", msg);
    printSummaryTable();
    process.exit(1);
  }
  const treeAddress = postRes.treeAddress;

  const postOk = postRes.status === 201 || postRes.status === 200;
  assert(
    postOk,
    `HTTP ${postRes.status}`,
    `expected 201 or 200, got ${postRes.status}${postRes.error ? `: ${postRes.error}` : ""}`
  );
  recordSummary("POST", postOk ? "PASS" : "FAIL", postOk ? `${postRes.status}` : undefined);
  console.log(`        campaignId=${postRes.campaignId}, treeAddress=${treeAddress}\n`);

  if (!treeAddress) {
    fail("POST", "No treeAddress returned — cannot continue");
    printSummaryTable();
    process.exit(1);
  }

  // --- Step 2b: GET /api/campaigns (smoke test) ---
  console.log("[2b/5] GET /api/campaigns (smoke test)");
  try {
    const { campaigns, status: listStatus, error: listError } = await listCampaigns(postRes.creator);
    const listOk = listStatus === 200;
    assert(listOk, `GET /api/campaigns returns 200`, `HTTP ${listStatus}${listError ? `: ${listError}` : ""}`);
    if (listOk) {
      assert(campaigns.length >= 1, "returns >= 1 campaign", `got ${campaigns.length}`);
    }
    recordSummary("GET campaigns", listOk ? "PASS" : "FAIL");
  } catch (err) {
    const msg =
      err instanceof DOMException && err.name === "AbortError"
        ? `Timed out after ${TIMEOUT_MS}ms`
        : String(err);
    fail("GET /api/campaigns", msg);
    recordSummary("GET campaigns", "FAIL", msg);
  }
  console.log("");

  // --- Step 3: GET proof for each recipient ---
  console.log("[3/5] GET proof x3");
  const proofResults: ProofResponse[] = [];
  let proofPassCount = 0;

  for (let i = 0; i < recipients.length; i++) {
    const beneficiary = recipients[i].beneficiary.toBase58();
    let data: ProofResponse | null = null;
    let status: number = 0;
    let error: string | undefined;

    try {
      ({ data, status, error } = await getProof(treeAddress, beneficiary));
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "AbortError"
          ? `Timed out after ${TIMEOUT_MS}ms`
          : String(err);
      fail(`leaf ${i} GET proof`, msg);
      error = msg;
      status = 0;
    }

    const ok = status === 200 && data !== null;
    assert(
      ok,
      `leaf ${i} (${["Cliff", "Linear", "Milestone"][prepared.leaves[i].releaseType]})`,
      `HTTP ${status}${error ? `: ${error}` : ""}`
    );

    if (data) {
      proofResults.push(data);
      if (ok) proofPassCount++;
    }
  }
  recordSummary(
    "GET proofs",
    proofPassCount === recipients.length ? "PASS" : "FAIL",
    `${proofPassCount}/${recipients.length}`
  );
  console.log("");

  // --- Step 4: Verify proofs + leaf data ---
  console.log("[4/5] verifyProof + leaf data");
  let verifyPassCount = 0;

  for (let i = 0; i < prepared.leaves.length; i++) {
    if (!proofResults[i]) {
      fail(`leaf ${i} verify`, "No proof data (GET failed)");
      continue;
    }

    const leafHashBuf = leafHash(prepared.leaves[i]);
    const rootBuf = Buffer.from(prepared.rootHex, "hex");

    const proofValid = verifyReturnedProof(
      proofResults[i].proof,
      prepared.leaves[i].leafIndex,
      leafHashBuf,
      rootBuf
    );
    assert(proofValid, `leaf ${i} proof verifies against root`, "proof verification failed");

    const leafDataMatch = verifyLeafData(prepared.leaves[i], proofResults[i].leaf);
    assert(
      leafDataMatch,
      `leaf ${i} data matches`,
      JSON.stringify({
        expected: {
          amount: prepared.leaves[i].amount.toNumber(),
          releaseType: prepared.leaves[i].releaseType,
        },
        got: {
          amount: proofResults[i].leaf.amount,
          releaseType: proofResults[i].leaf.releaseType,
        },
      })
    );

    if (proofValid && leafDataMatch) verifyPassCount++;
  }
  recordSummary(
    "verifyProof",
    verifyPassCount === prepared.leaves.length ? "PASS" : "FAIL",
    `${verifyPassCount}/${prepared.leaves.length}`
  );

  // --- Summary ---
  console.log("");
  printSummaryTable();

  if (anyFailed) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// Summary table
// ---------------------------------------------------------------------------

function printSummaryTable(): void {
  const phases = ["prepare", "POST", "GET campaigns", "GET proofs", "verifyProof"] as const;

  console.log("Phase 6 — Post-Deploy E2E Summary");
  console.log("==================================");
  console.log(`Target:      ${BASE_URL}`);

  for (const phase of phases) {
    const entry = summary[phase];
    if (!entry) continue;
    const detail = entry.detail ? ` (${entry.detail})` : "";
    const line = `${phase}:${" ".repeat(Math.max(1, 14 - phase.length))}${entry.status}${detail}`;
    console.log(line);
  }

  const allPassed = !anyFailed;
  console.log(`Result:      ${allPassed ? "ALL PASS" : "FAILED"}`);
  console.log("");
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
