/**
 * test-be-merkle-pipeline.ts — Phase 3 E2E Merkle Pipeline Test
 *
 * Verifies multi-leaf campaign flows through the BE API:
 *   prepare → POST → GET proof → verify
 *
 * Usage:
 *   npx tsx scripts/test-be-merkle-pipeline.ts
 *   npx tsx scripts/test-be-merkle-pipeline.ts --url https://your-app.vercel.app
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
const BASE_TS = 1_700_000_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseBaseUrl(): string {
  const idx = process.argv.indexOf("--url");
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1].replace(/\/$/, "");
  }
  return "http://localhost:3000";
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

  const res = await fetch(`${BASE_URL}/api/campaigns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as { ok: boolean; campaignId?: number; error?: string };
  return { ...json, status: res.status, treeAddress };
}

// ---------------------------------------------------------------------------
// Step 3: GET /api/campaigns/:treeAddress/proof
// ---------------------------------------------------------------------------

interface ProofResponse {
  leaf: {
    leafIndex: number;
    beneficiary: string;
    amount: number;
    releaseType: number;
    startTime: number;
    cliffTime: number;
    endTime: number;
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
  const res = await fetch(
    `${BASE_URL}/api/campaigns/${treeAddress}/proof?beneficiary=${beneficiary}`
  );
  if (res.ok) {
    return { data: (await res.json()) as ProofResponse, status: res.status };
  }
  const text = await res.text();
  return { data: null, status: res.status, error: text };
}

// ---------------------------------------------------------------------------
// Step 4: Verify proof + leaf data
// ---------------------------------------------------------------------------

// Note: uses toNumber() which is safe for test amounts (< MAX_SAFE_INTEGER).
// Real token amounts may need string comparison if the DB switches to string mode.
function verifyLeafData(
  inputLeaf: VestingLeaf,
  returnedLeaf: ProofResponse["leaf"]
): boolean {
  return (
    inputLeaf.leafIndex === returnedLeaf.leafIndex &&
    inputLeaf.beneficiary.toBase58() === returnedLeaf.beneficiary &&
    inputLeaf.amount.toNumber() === returnedLeaf.amount &&
    inputLeaf.releaseType === returnedLeaf.releaseType &&
    inputLeaf.startTime.toNumber() === returnedLeaf.startTime &&
    inputLeaf.cliffTime.toNumber() === returnedLeaf.cliffTime &&
    inputLeaf.endTime.toNumber() === returnedLeaf.endTime &&
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
  console.log(`E2E Merkle Pipeline Test — ${BASE_URL}\n`);

  // --- Step 1: prepareCampaign ---
  console.log("[1/4] prepareCampaign");
  const recipients = buildRecipients();
  const prepared = prepareCampaign(recipients);

  assert(prepared.leafCount === 3, "3 leaves created", `got ${prepared.leafCount}`);
  assert(prepared.root.length === 32, "root is 32 bytes", `got ${prepared.root.length}`);
  console.log(`        root=0x${prepared.rootHex.slice(0, 16)}...\n`);

  // --- Step 2: POST /api/campaigns ---
  console.log("[2/4] POST /api/campaigns");
  let postRes: PostResponse;
  try {
    postRes = await postCampaign(prepared, recipients);
  } catch (err) {
    fail(
      "POST /api/campaigns",
      `Connection failed — is the dev server running at ${BASE_URL}? (cd apps/web && pnpm dev)`
    );
    process.exit(1);
  }
  const treeAddress = postRes.treeAddress;

  assert(
    postRes.status === 201 || postRes.status === 200,
    `HTTP ${postRes.status}`,
    `expected 201 or 200, got ${postRes.status}${postRes.error ? `: ${postRes.error}` : ""}`
  );
  console.log(`        campaignId=${postRes.campaignId}, treeAddress=${treeAddress}\n`);

  if (!treeAddress) {
    fail("POST", "No treeAddress returned — cannot continue");
    process.exit(1);
  }

  // --- Step 3: GET proof for each recipient ---
  console.log("[3/4] GET proof x3");
  const proofResults: ProofResponse[] = [];

  for (let i = 0; i < recipients.length; i++) {
    const beneficiary = recipients[i].beneficiary.toBase58();
    const { data, status, error } = await getProof(treeAddress, beneficiary);

    assert(
      status === 200 && data !== null,
      `leaf ${i} (${["Cliff", "Linear", "Milestone"][prepared.leaves[i].releaseType]})`,
      `HTTP ${status}${error ? `: ${error}` : ""}`
    );

    if (data) {
      proofResults.push(data);
    }
  }
  console.log("");

  // --- Step 4: Verify proofs + leaf data ---
  console.log("[4/4] verifyProof + leaf data");

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
  }

  // --- Summary ---
  console.log("");
  if (anyFailed) {
    console.log("FAILED — some checks did not pass.");
    process.exit(1);
  } else {
    console.log("ALL PASS");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
