# Backend API + Database Architecture — Phase 2 Design

**Status:** Design complete, implementation pending
**Owner:** Lana
**Companion docs:** `PRD_LANA.md`, `INTEGRATION.md`, `PROGRAM.md`

---

## 0. Hosting Architecture

### Recommended Stack (all free tier)

| Service | Role | Free Tier | Why |
|---------|------|-----------|-----|
| **Vercel** | FE + BE hosting (Next.js) | 100GB bandwidth, serverless functions | Made for Next.js. API routes run server-side. One deployment = FE + BE. |
| **Supabase** | PostgreSQL database + Auth + Storage | 500MB DB, unlimited API, 1GB storage, 50K auth MAU | Production-grade Postgres. No migration needed. Free Auth for creator login. Free Storage for campaign assets. |
| **Pinata** | IPFS proof hosting | 1GB, 100 files/month | Already configured in `.env.example`. Redundant backup of proof data. |

### Why not other options

| Service | Why not |
|---------|---------|
| Turso (SQLite) | SQLite is not production-grade. Would need PostgreSQL migration later anyway. |
| Neon (PostgreSQL) | Just a database — no Auth, no Storage. Supabase gives all three. |
| Railway | $5/month credit, burns fast. Not sustainable at $0. |
| Self-hosted VPS | Operational overhead. Not worth it for a scholarship project. |

### FE + BE deployment

Next.js Route Handlers (`src/app/api/`) run server-side on Vercel. The Supabase database connection happens inside those route handlers. FE and BE deploy together as a single unit — whoever deploys `apps/web/` deploys both.

If Geral hosts the FE elsewhere (Cloudflare Pages, Netlify, self-hosted), the API routes must be extracted into a separate backend service. Coordinate with Geral on hosting before implementation.

---

## 1. Tech Stack

| Component | Choice | Justification |
|-----------|--------|---------------|
| Database | **Supabase (PostgreSQL)** | Production-grade, no migration needed. Free Auth + Storage included. 500MB free. |
| API | Next.js Route Handlers (`apps/web/src/app/api/`) | No separate service. `next.config.ts` already has serverActions enabled. |
| ORM | **Drizzle** | TS-native, lightweight, first-class PostgreSQL support. |
| Validation | **Zod** | Already idiomatic in Next.js API routes. |
| Auth | **Supabase Auth** | Free, built-in. For creator dashboard login. Phase 2. |
| Storage | **Supabase Storage** | Free 1GB. For campaign logos, metadata files. |

Dependencies to add to `apps/web/package.json`:
- `drizzle-orm`, `@supabase/supabase-js`, `drizzle-kit` (devDep), `zod`, `postgres` (for Drizzle pg driver)

---

## 2. Database Schema (4 Tables) — PostgreSQL via Supabase

u64/i64 values use PostgreSQL `bigint` (native 64-bit). JSONB for proof storage and metadata.

### `campaigns` — On-chain campaign index

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PRIMARY KEY | Auto-increment |
| `tree_address` | TEXT UNIQUE | VestingTree PDA (base58) |
| `creator` | TEXT NOT NULL | Creator pubkey (base58) |
| `mint` | TEXT NOT NULL | Mint pubkey (base58) |
| `campaign_id` | BIGINT NOT NULL | On-chain campaign_id (u64) |
| `merkle_root` | TEXT NOT NULL | Current root hex (64 chars) |
| `leaf_count` | INTEGER NOT NULL | Current leaf count |
| `total_supply` | BIGINT NOT NULL | u64, native PostgreSQL bigint |
| `total_claimed` | BIGINT NOT NULL DEFAULT 0 | Tracked from Claimed events |
| `cancellable` | BOOLEAN NOT NULL DEFAULT false | |
| `cancel_authority` | TEXT | Cancel authority pubkey (base58) or NULL |
| `pause_authority` | TEXT | Pause authority pubkey (base58) or NULL |
| `cancelled_at` | BIGINT | Unix timestamp or NULL |
| `paused` | BOOLEAN NOT NULL DEFAULT false | |
| `created_at` | BIGINT NOT NULL | Unix timestamp |
| `metadata` | JSONB | {name, description, logoUri} |

UNIQUE(creator, mint, campaign_id). Indexes on creator, mint, merkle_root.

### `root_versions` — Merkle root history

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PRIMARY KEY | Auto-increment |
| `campaign_id` | INTEGER FK → campaigns | ON DELETE CASCADE |
| `merkle_root` | TEXT NOT NULL | Hex, 64 chars |
| `leaf_count` | INTEGER NOT NULL | |
| `ipfs_cid` | TEXT | Pinata CID for full leaf+proof JSON |
| `version` | INTEGER NOT NULL | 1-based, increments per rotation |
| `created_at` | BIGINT NOT NULL | Unix timestamp |

UNIQUE(campaign_id, version). Index on merkle_root.

### `leaves` — Per-recipient data + proof

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PRIMARY KEY | Auto-increment |
| `root_version_id` | INTEGER FK → root_versions | ON DELETE CASCADE |
| `leaf_index` | INTEGER NOT NULL | u32, matches on-chain |
| `beneficiary` | TEXT NOT NULL | Base58 pubkey |
| `amount` | BIGINT NOT NULL | u64, native PostgreSQL bigint |
| `release_type` | SMALLINT NOT NULL | 0=Cliff, 1=Linear, 2=Milestone |
| `start_time` | BIGINT NOT NULL | i64 unix timestamp |
| `cliff_time` | BIGINT NOT NULL | i64 unix timestamp |
| `end_time` | BIGINT NOT NULL | i64 unix timestamp |
| `milestone_idx` | SMALLINT NOT NULL DEFAULT 0 | u8 |
| `proof` | JSONB NOT NULL | number[][] (sibling hashes). JSONB enables indexing. |

UNIQUE(root_version_id, leaf_index). Index on (beneficiary, root_version_id).

### `claim_events` — On-chain Claimed event log

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PRIMARY KEY | Auto-increment |
| `campaign_id` | INTEGER FK → campaigns | ON DELETE CASCADE |
| `beneficiary` | TEXT NOT NULL | Base58 |
| `leaf_index` | INTEGER NOT NULL | |
| `amount` | BIGINT NOT NULL | u64 |
| `total_claimed_by_user` | BIGINT NOT NULL | Cumulative per user |
| `total_claimed_overall` | BIGINT NOT NULL | Cumulative per campaign |
| `milestone_idx` | SMALLINT | NULL for non-milestone |
| `signature` | TEXT UNIQUE | Tx signature (idempotency key) |
| `slot` | BIGINT NOT NULL | Solana slot |
| `block_time` | BIGINT NOT NULL | Unix timestamp |

Index on (campaign_id), (beneficiary, campaign_id).

---

## 3. API Endpoints

### Write Path — Campaign Creation

Both `create_campaign` (batch) and `create_stream` (single-recipient) use the same endpoint. The frontend calls `prepareCampaign()` from the SDK, sends the on-chain tx, then POSTs the result.

#### `POST /api/campaigns`

```ts
// Request body
{
  treeAddress: string;           // VestingTree PDA (base58)
  creator: string;
  mint: string;
  campaignId: number;
  merkleRoot: string;            // hex, 64 chars
  leafCount: number;
  totalSupply: string;
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
    proof: number[][];           // from prepareCampaign().proofs[i]
  }>;
  ipfsCid?: string;
}

// Response 201
{ ok: true; campaignId: number; }
```

For `create_stream`: leafCount=1, leaves array has one entry with an empty proof (single-leaf tree, root = leaf hash).

For `create_campaign`: leafCount=N, leaves array has N entries with full proofs.

### Read Path — Proof Lookup

#### `GET /api/campaigns/:treeAddress/proof?beneficiary=<base58>`

```ts
// Response 200
{
  leaf: { leafIndex, beneficiary, amount, releaseType, startTime, cliffTime, endTime, milestoneIdx };
  proof: number[][];
  merkleRoot: string;
  treeAddress: string;
}

// Response 404
{ error: "No proof found for this beneficiary in this campaign" }
```

### Read Path — Campaign Listing

#### `GET /api/campaigns?[creator=<base58>][&mint=<base58>][&status=active|paused|cancelled][&page=1][&limit=20]`

```ts
// Response 200
{
  campaigns: Array<{ treeAddress, creator, mint, campaignId, leafCount, totalSupply, totalClaimed, cancellable, paused, cancelledAt, createdAt, metadata }>;
  total: number;
  page: number;
  limit: number;
}
```

### Read Path — Campaign Detail

#### `GET /api/campaigns/:treeAddress`

```ts
// Response 200
{
  treeAddress, creator, mint, campaignId, merkleRoot, leafCount, totalSupply,
  totalClaimed, cancellable, paused, cancelledAt, createdAt, metadata,
  analytics: { uniqueClaimers, claimCount, percentClaimed, rootVersionCount },
  rootVersions: Array<{ version, merkleRoot, leafCount, createdAt, ipfsCid }>
}
```

### Write Path — Root Rotation

#### `POST /api/campaigns/:treeAddress/root-versions`

```ts
// Request body
{ merkleRoot: string; leafCount: number; leaves: Array<{...}>; ipfsCid?: string }

// Response 201
{ ok: true; version: number; }
```

### Read Path — Analytics

#### `GET /api/campaigns/:treeAddress/claims?[beneficiary=<base58>][&fromSlot=<slot>][&limit=50]`

```ts
// Response 200
{
  claims: Array<{ beneficiary, leafIndex, amount, totalClaimedByUser, totalClaimedOverall, milestoneIdx, signature, slot, blockTime }>;
  total: number;
}
```

### Read Path — Beneficiary Dashboard

#### `GET /api/beneficiary/:address/campaigns`

```ts
// Response 200
{
  campaigns: Array<{
    treeAddress, creator, mint, campaignId, totalSupply, leafCount, paused, cancelledAt, createdAt, metadata,
    myLeaf: { leafIndex, amount, releaseType, startTime, cliffTime, endTime, milestoneIdx }
  }>;
}
```

---

## 4. Data Flows

### Campaign Creation (create_campaign / create_stream)

```
1. Frontend calls prepareCampaign(recipients) from @velthoryn/client
2. Frontend sends create_campaign OR create_stream tx to Solana
3. On success, frontend POSTs /api/campaigns with full data
4. API validates, inserts into campaigns + root_versions + leaves tables
5. Optionally pins to IPFS via Pinata (background)
```

### Beneficiary Claim

```
1. Beneficiary navigates to /campaign/<treeAddress>
2. Frontend calls GET /api/campaigns/<treeAddress>/proof?beneficiary=<wallet>
3. API returns leaf data + proof (sub-ms indexed query)
4. Frontend builds claim/withdraw instruction with leaf + proof
5. Sends tx to Solana
6. Indexer picks up Claimed event, updates analytics
```

### Root Rotation

```
1. Authority calls prepareCampaign(newRecipients) for new tree
2. Sends update_root tx to Solana
3. POSTs /api/campaigns/<treeAddress>/root-versions with new leaf set
4. API creates new root_version, inserts new leaves
5. Old proofs remain queryable; new lookups use latest version
```

---

## 5. File Structure

```
apps/web/src/
  app/api/
    campaigns/
      route.ts                          # GET (list) + POST (create both campaign/stream)
      [treeAddress]/
        route.ts                        # GET (detail)
        proof/route.ts                  # GET (proof by beneficiary)
        root-versions/route.ts          # POST (root rotation)
        claims/route.ts                 # GET (claim history)
    beneficiary/[address]/campaigns/
      route.ts                          # GET (beneficiary's campaigns)
    admin/sync/
      route.ts                          # POST (trigger indexer)

  lib/
    db/
      schema.ts                         # Drizzle schema (pgTable, 4 tables)
      index.ts                          # Connection + Drizzle instance (postgres driver)
      migrations/                       # Generated by drizzle-kit
    api/
      validators.ts                     # Zod schemas
    indexer/
      claim-events.ts                   # Claimed event parsing

  hooks/
    useProofLookup.ts                   # TanStack Query hook
    useCampaignList.ts
    useCampaignDetail.ts
    useBeneficiaryCampaigns.ts
```

Drizzle config (`apps/web/drizzle.config.ts`):

```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,  // Supabase connection string
  },
});
```

Schema uses `pgTable` from `drizzle-orm/pg-core` instead of `sqliteTable`.

---

## 6. Integration with SDK

`prepareCampaign()` from `clients/ts/src/prepare.ts` returns `PreparedCampaign`:
- `rootHex` → `merkleRoot` in API request
- `leaves[i]` → `leaves[i]` with `PublicKey.toBase58()` and `BN.toString()`
- `proofs[i]` → `leaves[i].proof` (already `number[][]`)

No SDK changes needed. API accepts serialized form of what `prepareCampaign()` produces.

---

## 7. Implementation Sequence

### Prerequisites
1. Create Supabase project at supabase.com (free)
2. Get connection string from Supabase dashboard → Settings → Database
3. Add `DATABASE_URL` to `.env.local`

### Steps
1. Add dependencies to `apps/web/package.json` (`drizzle-orm`, `postgres`, `drizzle-kit`, `zod`)
2. Create `lib/db/schema.ts` (Drizzle `pgTable` schema) + `lib/db/index.ts` (connection)
3. Create `drizzle.config.ts` at `apps/web/drizzle.config.ts`
4. Run `drizzle-kit generate` + `drizzle-kit push` (applies schema to Supabase)
5. Create `lib/api/validators.ts` (Zod schemas)
6. Build `POST /api/campaigns` (handles both create_campaign and create_stream)
7. Build `GET /api/campaigns/:treeAddress/proof` (core hot path)
8. Build `GET /api/campaigns` (listing)
9. Build `GET /api/campaigns/:treeAddress` (detail + analytics)
10. Build `POST /api/campaigns/:treeAddress/root-versions` (rotation)
11. Build `GET /api/campaigns/:treeAddress/claims` (analytics)
12. Build `GET /api/beneficiary/:address/campaigns` (dashboard)
13. Build indexer (`lib/indexer/claim-events.ts` + `admin/sync` route)
14. Build TanStack Query hooks
15. Wire up frontend pages
16. Deploy to Vercel (`vercel deploy`)

---

## 8. Environment Variables

```env
# Solana RPC
NEXT_PUBLIC_RPC_ENDPOINT=https://devnet.helius-rpc.com/?api-key=YOUR_KEY

# IPFS (Pinata)
PINATA_API_KEY=
PINATA_SECRET_API_KEY=
PINATA_GATEWAY_URL=https://gateway.pinata.cloud

# Database (Supabase)
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres

# Supabase (for client-side Auth + Storage, Phase 2)
NEXT_PUBLIC_SUPABASE_URL=https://[PROJECT-REF].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```
