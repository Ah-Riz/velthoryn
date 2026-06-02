/**
 * BE API HTTP client + DB seeding helpers for integration tests.
 *
 * Uses built-in fetch (Node 20+) to call the Next.js dev server
 * and `postgres` for direct event seeding (the indexer can't observe bankrun).
 */
import postgres from "postgres";
import { PublicKey, Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import { expect } from "chai";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const BE_BASE = process.env.BE_API_URL ?? "http://localhost:3099";

// ---------------------------------------------------------------------------
// Generic HTTP helpers
// ---------------------------------------------------------------------------

export interface BeApiResponse {
  status: number;
  data: unknown;
}

export async function beGet(path: string): Promise<BeApiResponse> {
  const url = `${BE_BASE}${path}`;
  const res = await fetch(url);
  const data = await res.json();
  return { status: res.status, data };
}

export async function bePost(
  path: string,
  body: unknown,
  authHeader?: string,
): Promise<BeApiResponse> {
  const url = `${BE_BASE}${path}`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authHeader) headers.authorization = authHeader;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

// ---------------------------------------------------------------------------
// Auth helper — mirrors scripts/test-be-merkle-pipeline.ts
// ---------------------------------------------------------------------------

/**
 * Requests a nonce and signs it with the given keypair.
 * Returns the full Authorization header value for passing to bePost().
 */
export async function createTestAuthHeader(
  creator: Keypair,
): Promise<string> {
  const nonceRes = await fetch(`${BE_BASE}/api/auth/nonce`);
  if (!nonceRes.ok) {
    throw new Error(`GET /api/auth/nonce failed: HTTP ${nonceRes.status}`);
  }
  const { nonce } = (await nonceRes.json()) as { nonce: string };
  const message = {
    nonce,
    timestamp: Date.now(),
    wallet: creator.publicKey.toBase58(),
  };
  const messageBytes = Buffer.from(JSON.stringify(message), "utf8");
  const signature = nacl.sign.detached(messageBytes, creator.secretKey);
  const token = `${Buffer.from(signature).toString("base64")}.${messageBytes.toString("base64")}`;
  return `Bearer ${token}`;
}

// ---------------------------------------------------------------------------
// Campaign indexing — POST /api/campaigns
// ---------------------------------------------------------------------------

export interface IndexCampaignOpts {
  treePda: PublicKey;
  creator: PublicKey;
  mint: PublicKey;
  campaignId: number;
  merkleRoot: string; // 64-char hex
  leafCount: number;
  totalSupply: string; // stringified BN
  minCliffTime: string;
  cancellable: boolean;
  cancelAuthority: PublicKey | null;
  pauseAuthority: PublicKey | null;
  createdAt: number;
  leaves: Array<{
    leafIndex: number;
    beneficiary: string;
    amount: string;
    releaseType: number;
    startTime: string;
    cliffTime: string;
    endTime: string;
    milestoneIdx: number;
    proof: number[][];
  }>;
}

export async function indexCampaign(
  opts: IndexCampaignOpts,
  authHeader?: string,
): Promise<number> {
  const body = {
    treeAddress: opts.treePda.toBase58(),
    creator: opts.creator.toBase58(),
    mint: opts.mint.toBase58(),
    campaignId: opts.campaignId,
    merkleRoot: opts.merkleRoot,
    leafCount: opts.leafCount,
    totalSupply: opts.totalSupply,
    cancellable: opts.cancellable,
    cancelAuthority: opts.cancelAuthority?.toBase58() ?? null,
    pauseAuthority: opts.pauseAuthority?.toBase58() ?? null,
    createdAt: opts.createdAt,
    leaves: opts.leaves,
  };
  const res = await bePost("/api/campaigns", body, authHeader);
  expect(res.status).to.be.oneOf([200, 201], `indexCampaign failed: ${JSON.stringify(res.data)}`);
  return (res.data as any).campaignId;
}

// ---------------------------------------------------------------------------
// DB helpers (direct postgres for event seeding)
// ---------------------------------------------------------------------------

/** Returns true if DATABASE_URL looks safe to TRUNCATE (local-only). */
function isLocalDatabase(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  return !(
    url.includes("supabase") ||
    url.includes("pooler") ||
    url.includes("neon")
  );
}

/** Lazy postgres singleton — created on first use, reused across calls. */
let _sql: ReturnType<typeof postgres> | null = null;

function getSql() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is required for BE integration tests. " +
          "Set it to a local Postgres, e.g. DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/ci",
      );
    }
    _sql = postgres(process.env.DATABASE_URL, { max: 1 });
  }
  return _sql;
}

/** Close the postgres connection (call in after() hook). */
export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 2 });
    _sql = null;
  }
}

/**
 * TRUNCATE all campaign-related tables (local DB only).
 * Skipped for remote databases (Supabase, Neon, etc.).
 */
export async function cleanBeDatabase(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  if (!isLocalDatabase()) {
    console.warn(
      "[cleanBeDatabase] Skipping TRUNCATE — DATABASE_URL points to a remote database.",
    );
    return;
  }
  const sql = getSql();
  await sql.unsafe(
    `TRUNCATE instant_refund_events, stream_cancel_events, cancel_events, pause_events, root_update_events, withdraw_events, milestone_events, claim_events, leaves, root_versions, campaigns, sync_state RESTART IDENTITY CASCADE`,
  );
}

// ---------------------------------------------------------------------------
// Event seeding — mirrors apps/web/tests/helpers/fixtures.ts pattern
// Uses sql.unsafe() + `as any[]` to bypass postgres.js strict TS types.
// ---------------------------------------------------------------------------

/** Run a parameterised unsafe query, bypassing postgres.js strict TS overloads. */
function rawInsert(sql: ReturnType<typeof postgres>, query: string, params: unknown[]) {
  return (sql.unsafe as (q: string, p: unknown[]) => Promise<unknown[]>)(query, params);
}

export async function seedClaimEvent(
  internalCampaignId: number,
  opts: {
    beneficiary: string;
    leafIndex: number;
    amount: number;
    totalClaimedByUser: number;
    totalClaimedOverall: number;
    milestoneIdx?: number | null;
    signature?: string;
    slot?: number;
    blockTime?: number;
  },
): Promise<void> {
  const sql = getSql();
  const sig =
    opts.signature ??
    `claim_${internalCampaignId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await rawInsert(sql,
    `INSERT INTO claim_events (campaign_id, beneficiary, leaf_index, amount, total_claimed_by_user, total_claimed_overall, milestone_idx, signature, slot, block_time)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      internalCampaignId,
      opts.beneficiary,
      opts.leafIndex,
      opts.amount,
      opts.totalClaimedByUser,
      opts.totalClaimedOverall,
      opts.milestoneIdx ?? null,
      sig,
      opts.slot ?? 1000,
      opts.blockTime ?? Math.floor(Date.now() / 1000),
    ],
  );
}

export async function seedCancelEvent(
  internalCampaignId: number,
  opts: {
    cancelledAt: number;
    claimedAtCancel: number;
    signature?: string;
    slot?: number;
    blockTime?: number;
  },
): Promise<void> {
  const sql = getSql();
  const sig =
    opts.signature ??
    `cancel_${internalCampaignId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await rawInsert(sql,
    `INSERT INTO cancel_events (campaign_id, cancelled_at, claimed_at_cancel, signature, slot, block_time)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      internalCampaignId,
      opts.cancelledAt,
      opts.claimedAtCancel,
      sig,
      opts.slot ?? 1000,
      opts.blockTime ?? Math.floor(Date.now() / 1000),
    ],
  );
}

export async function seedPauseEvent(
  internalCampaignId: number,
  opts: {
    paused: boolean;
    signature?: string;
    slot?: number;
    blockTime?: number;
  },
): Promise<void> {
  const sql = getSql();
  const sig =
    opts.signature ??
    `pause_${internalCampaignId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await rawInsert(sql,
    `INSERT INTO pause_events (campaign_id, paused, signature, slot, block_time)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      internalCampaignId,
      opts.paused,
      sig,
      opts.slot ?? 1000,
      opts.blockTime ?? Math.floor(Date.now() / 1000),
    ],
  );
}

export async function seedWithdrawEvent(
  internalCampaignId: number,
  opts: {
    amount: number;
    signature?: string;
    slot?: number;
    blockTime?: number;
  },
): Promise<void> {
  const sql = getSql();
  const sig =
    opts.signature ??
    `withdraw_${internalCampaignId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await rawInsert(sql,
    `INSERT INTO withdraw_events (campaign_id, amount, signature, slot, block_time)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      internalCampaignId,
      opts.amount,
      sig,
      opts.slot ?? 1000,
      opts.blockTime ?? Math.floor(Date.now() / 1000),
    ],
  );
}

export async function seedMilestoneEvent(
  internalCampaignId: number,
  opts: {
    milestoneIdx: number;
    releasedBy: string;
    signature?: string;
    slot?: number;
    blockTime?: number;
  },
): Promise<void> {
  const sql = getSql();
  const sig =
    opts.signature ??
    `milestone_${internalCampaignId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await rawInsert(sql,
    `INSERT INTO milestone_events (campaign_id, milestone_idx, released_by, signature, slot, block_time)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      internalCampaignId,
      opts.milestoneIdx,
      opts.releasedBy,
      sig,
      opts.slot ?? 1000,
      opts.blockTime ?? Math.floor(Date.now() / 1000),
    ],
  );
}

export async function seedStreamCancelEvent(
  internalCampaignId: number,
  opts: {
    cancelledAt: number;
    amountToBeneficiary: number;
    amountToCreator: number;
    signature?: string;
    slot?: number;
    blockTime?: number;
  },
): Promise<void> {
  const sql = getSql();
  const sig =
    opts.signature ??
    `stream_cancel_${internalCampaignId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await rawInsert(sql,
    `INSERT INTO stream_cancel_events (campaign_id, cancelled_at, amount_to_beneficiary, amount_to_creator, signature, slot, block_time)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      internalCampaignId,
      opts.cancelledAt,
      opts.amountToBeneficiary,
      opts.amountToCreator,
      sig,
      opts.slot ?? 1000,
      opts.blockTime ?? Math.floor(Date.now() / 1000),
    ],
  );
}

/**
 * Update the campaigns.total_claimed column (the indexer normally does this).
 */
export async function updateCampaignTotalClaimed(
  treeAddress: string,
  totalClaimed: number,
): Promise<void> {
  const sql = getSql();
  await rawInsert(sql,
    `UPDATE campaigns SET total_claimed = $1 WHERE tree_address = $2`,
    [totalClaimed, treeAddress],
  );
}

/**
 * Update campaign cancelled_at column.
 */
export async function updateCampaignCancelledAt(
  treeAddress: string,
  cancelledAt: number,
): Promise<void> {
  const sql = getSql();
  await rawInsert(sql,
    `UPDATE campaigns SET cancelled_at = $1 WHERE tree_address = $2`,
    [cancelledAt, treeAddress],
  );
}

/**
 * Update campaign paused column.
 */
export async function updateCampaignPaused(
  treeAddress: string,
  paused: boolean,
): Promise<void> {
  const sql = getSql();
  await rawInsert(sql,
    `UPDATE campaigns SET paused = $1 WHERE tree_address = $2`,
    [paused, treeAddress],
  );
}
