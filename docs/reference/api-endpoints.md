# API Endpoints

The Velora backend API is built as Next.js Route Handlers running on Vercel serverless functions. All routes live under `apps/web/src/app/api/` and deploy alongside the frontend as a single unit.

---

## Tech Stack

| Component | Choice | Purpose |
|-----------|--------|---------|
| Hosting | Vercel (serverless) | Next.js API routes, 100GB bandwidth free tier |
| Database | Supabase (PostgreSQL) | 500MB free, production-grade Postgres with RLS |
| ORM | Drizzle | TypeScript-native, lightweight PostgreSQL ORM |
| Validation | Zod | Request body and query parameter validation |
| Auth | Supabase Auth + ed25519 wallet signatures | Creator dashboard login and wallet-based authentication |
| Storage | Supabase Storage + Pinata (IPFS) | Campaign assets and redundant proof backup |

---

## Database Schema

The backend uses four PostgreSQL tables managed by Drizzle ORM.

### `campaigns`

On-chain campaign index. Primary record for each `VestingTree` PDA.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `SERIAL PK` | Auto-increment primary key |
| `tree_address` | `TEXT UNIQUE` | VestingTree PDA (base58) |
| `creator` | `TEXT NOT NULL` | Creator pubkey (base58) |
| `mint` | `TEXT NOT NULL` | Mint pubkey (base58) |
| `campaign_id` | `BIGINT NOT NULL` | On-chain `campaign_id` (u64) |
| `merkle_root` | `TEXT NOT NULL` | Current root hex (64 chars) |
| `leaf_count` | `INTEGER NOT NULL` | Current leaf count |
| `total_supply` | `BIGINT NOT NULL` | u64 as PostgreSQL bigint |
| `total_claimed` | `BIGINT NOT NULL DEFAULT 0` | Tracked from `Claimed` events |
| `cancellable` | `BOOLEAN NOT NULL DEFAULT false` | Whether campaign is cancellable |
| `cancel_authority` | `TEXT` | Cancel authority pubkey or NULL |
| `pause_authority` | `TEXT` | Pause authority pubkey or NULL |
| `cancelled_at` | `BIGINT` | Unix timestamp or NULL |
| `min_cliff_time` | `BIGINT` | Minimum leaf `cliff_time`; synced from chain |
| `instant_refunded` | `BOOLEAN NOT NULL DEFAULT false` | True after `instant_refund_campaign` |
| `paused` | `BOOLEAN NOT NULL DEFAULT false` | Current pause state |
| `created_at` | `BIGINT NOT NULL` | Unix timestamp |
| `metadata` | `JSONB` | `{name, description, logoUri}` |

**Unique constraint:** `(creator, mint, campaign_id)`. Indexes on `creator`, `mint`, `merkle_root`.

### `root_versions`

Merkle root history for tracking root rotations.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `SERIAL PK` | Auto-increment primary key |
| `campaign_id` | `INTEGER FK` | References `campaigns`, `ON DELETE CASCADE` |
| `merkle_root` | `TEXT NOT NULL` | Hex, 64 chars |
| `leaf_count` | `INTEGER NOT NULL` | Leaf count for this version |
| `ipfs_cid` | `TEXT` | Pinata CID for full leaf+proof JSON |
| `version` | `INTEGER NOT NULL` | 1-based, increments per rotation |
| `created_at` | `BIGINT NOT NULL` | Unix timestamp |

**Unique constraint:** `(campaign_id, version)`. Index on `merkle_root`.

### `leaves`

Per-recipient data including the Merkle proof.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `SERIAL PK` | Auto-increment primary key |
| `root_version_id` | `INTEGER FK` | References `root_versions`, `ON DELETE CASCADE` |
| `leaf_index` | `INTEGER NOT NULL` | u32 leaf index matching on-chain |
| `beneficiary` | `TEXT NOT NULL` | Recipient pubkey (base58) |
| `amount` | `BIGINT NOT NULL` | u64 token amount |
| `release_type` | `SMALLINT NOT NULL` | `0` = Cliff, `1` = Linear, `2` = Milestone |
| `start_time` | `BIGINT NOT NULL` | i64 unix timestamp |
| `cliff_time` | `BIGINT NOT NULL` | i64 unix timestamp |
| `end_time` | `BIGINT NOT NULL` | i64 unix timestamp |
| `milestone_idx` | `SMALLINT NOT NULL DEFAULT 0` | u8 milestone index |
| `proof` | `JSONB NOT NULL` | `number[][]` sibling hashes |

**Unique constraint:** `(root_version_id, leaf_index)`. Index on `(beneficiary, root_version_id)`.

### `claim_events`

On-chain `Claimed` event log for analytics and auditing.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `SERIAL PK` | Auto-increment primary key |
| `campaign_id` | `INTEGER FK` | References `campaigns`, `ON DELETE CASCADE` |
| `beneficiary` | `TEXT NOT NULL` | Claimer pubkey (base58) |
| `leaf_index` | `INTEGER NOT NULL` | Leaf position |
| `amount` | `BIGINT NOT NULL` | u64 amount claimed |
| `total_claimed_by_user` | `BIGINT NOT NULL` | Cumulative per user |
| `total_claimed_overall` | `BIGINT NOT NULL` | Cumulative per campaign |
| `milestone_idx` | `SMALLINT` | NULL for non-milestone claims |
| `signature` | `TEXT UNIQUE` | Transaction signature (idempotency key) |
| `slot` | `BIGINT NOT NULL` | Solana slot |
| `block_time` | `BIGINT NOT NULL` | Unix timestamp |

Index on `(campaign_id)` and `(beneficiary, campaign_id)`.

---

## Route Reference

All routes return an `X-API-Version: 1` header. All `u64`/`i64` values are serialized as decimal strings in JSON responses via `serializeBigInt()`.

### Campaign CRUD

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/campaigns` | Public | Paginated campaign list. Filters: `creator`, `mint`, `status`, `page`, `limit`. |
| `POST` | `/api/campaigns` | Wallet | Register campaign + leaves after on-chain creation. Verifies Merkle proofs. |
| `GET` | `/api/campaigns/:treeAddress` | Public | Campaign detail with analytics, grace period info, and root version history. |
| `GET` | `/api/campaigns/:treeAddress/proof` | Public | Merkle proof lookup. Query: `beneficiary=<base58>`. |
| `GET` | `/api/campaigns/:treeAddress/claims` | Public | Claim history. Filters: `beneficiary`, `fromSlot`, `limit`. |
| `GET` | `/api/campaigns/:treeAddress/timeline` | Public | Event timeline (cancel, pause, withdraw, milestone, root-update events). |
| `POST` | `/api/campaigns/:treeAddress/root-versions` | Wallet | Record root rotation after on-chain `update_root`. |

### Campaign Actions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/campaigns/:treeAddress/cancel` | Wallet | Build `cancel_campaign` transaction. Signer must match cancel authority. |
| `POST` | `/api/campaigns/:treeAddress/withdraw-unvested` | Wallet | Build `withdraw_unvested` transaction after grace period. |
| `POST` | `/api/campaigns/:treeAddress/cancel-stream` | Wallet | Build per-stream cancel transaction. |
| `POST` | `/api/campaigns/:treeAddress/milestones/:idx` | Wallet | Build milestone release transaction. |
| `POST` | `/api/campaigns/:treeAddress/instant-refund` | Wallet | Build instant refund transaction for unstarted multi-leaf campaigns. |

### Preparation and Import

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/campaigns/prepare` | Public | Build Merkle tree server-side. Returns `merkleRoot`, `leafCount`, `minCliffTime`, and per-leaf proofs. Rate limit: 60/min. |
| `POST` | `/api/campaigns/import` | Wallet | CSV bulk recipient import. |

### Beneficiary

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/beneficiary/:address/campaigns` | Public | List campaigns where address is a beneficiary, with leaf details. |
| `GET` | `/api/beneficiary/:address/vesting-progress` | Public | Aggregated vesting progress across campaigns. |
| `GET` | `/api/activity/:address` | Public | Cross-campaign activity feed for a wallet. |

### Indexer and Sync

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/events/sync` | Public | Index Anchor events from transaction signatures. Rate limit: 20/min. |
| `POST` | `/api/claims/sync` | Admin | Operator claim-event backfill. Requires `x-admin-key`. Rate limit: 5/min. |
| `POST` | `/api/admin/sync` | Admin | Full indexer run. Requires `x-admin-key`. Rate limit: 3/min. |
| `GET` | `/api/cron/sync` | Admin | Vercel cron entry point. Requires `Authorization: Bearer <CRON_SECRET>`. |

### Utilities

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/auth/nonce` | Public | Issue one-time nonce for wallet auth flow (Redis, 5-min TTL). |
| `GET` | `/api/health` | Public | Liveness check (DB + RPC). Returns 503 when degraded. |
| `POST` | `/api/simulate-vesting` | Public | Pure math vesting curve simulation. Rate limit: 30/min. |
| `GET` | `/api/schedule-templates` | Public | Preset vesting schedule templates for the creation UI. |
| `POST` | `/api/waitlist` | Public | Email signup. Rate limit: 5/min. |
| `GET` | `/api/waitlist` | Admin | Export waitlist (JSON or CSV). Requires `x-admin-key`. |

### Deprecated

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| `PATCH` | `/api/campaigns/:treeAddress/status` | **Removed** | Previously wrote `paused`/`cancelledAt` directly to DB. Status must now come from the on-chain indexer. Do not call this endpoint. |

---

## Key Endpoint Details

### POST /api/campaigns

Registers a campaign after on-chain creation. Handles both `create_campaign` (batch) and `create_stream` (single-recipient) flows.

```typescript
// Request body
{
  treeAddress: string;           // VestingTree PDA (base58)
  creator: string;
  mint: string;
  campaignId: number;
  merkleRoot: string;            // hex, 64 chars
  leafCount: number;
  totalSupply: string;           // u64 as string
  cancellable: boolean;
  cancelAuthority: string | null;
  pauseAuthority: string | null;
  createdAt: number;
  metadata?: { name?: string; description?: string; logoUri?: string };
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
  ipfsCid?: string;
}

// Response 201
{ ok: true, campaignId: number }
```

{% hint style="warning" %}
Every leaf's proof is verified server-side against `merkleRoot`. Invalid proofs return **400** with the failing `leafIndex`.
{% endhint %}

### GET /api/campaigns/:treeAddress/proof

Returns the Merkle proof for a specific beneficiary in a campaign.

```typescript
// Query: ?beneficiary=<base58>

// Response 200
{
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

// Response 404
{ error: "No proof found for this beneficiary in this campaign" }
```

### GET /api/campaigns/:treeAddress

Returns full campaign detail with computed analytics.

```typescript
// Response 200
{
  treeAddress: string;
  creator: string;
  mint: string;
  campaignId: string;
  merkleRoot: string;
  leafCount: number;
  totalSupply: string;
  totalClaimed: string;
  cancellable: boolean;
  paused: boolean;
  cancelledAt: string | null;
  createdAt: string;
  metadata: object | null;
  minCliffTime: string | null;
  instantRefunded: boolean;
  instantRefundEligible: boolean;   // BE-computed; on-chain tx may still fail
  gracePeriod: {
    end: string;
    remaining: number;
    isExpired: boolean;
  } | null;
  analytics: {
    uniqueClaimers: number;
    claimCount: number;
    percentClaimed: number;
    rootVersionCount: number;
  };
  rootVersions: Array<{
    version: number;
    merkleRoot: string;
    leafCount: number;
    createdAt: string;
    ipfsCid: string | null;
  }>;
}
```

---

## Authentication

For details on authentication tiers (Public, Wallet Auth, Admin) and the wallet signature flow, see [Trust Boundaries](trust-boundaries.md).
