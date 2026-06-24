# Database Schema

The backend stores an off-chain index of on-chain state in **PostgreSQL**, managed with the [Drizzle ORM](https://orm.drizzle.team). The schema lives in `apps/web/src/lib/db/schema.ts`; migrations live in `apps/web/src/lib/db/migrations/`.

The database is a **read-optimized mirror** of the on-chain program. On-chain events are the source of truth; the indexer (`POST /api/admin/sync`, `GET /api/cron/sync`) writes rows here as it observes them.

---

## Tables at a Glance

Thirteen tables in three groups:

| Group | Tables | Purpose |
|-------|--------|---------|
| **Core campaign data** | `campaigns`, `root_versions`, `leaves` | The campaign record, its Merkle-root history, and per-recipient leaves + proofs |
| **Event log** | `claim_events`, `cancel_events`, `pause_events`, `root_update_events`, `withdraw_events`, `milestone_events`, `stream_cancel_events`, `instant_refund_events` | One table per on-chain event type (analytics, timeline, idempotent dedup) |
| **Operational** | `waitlist`, `sync_state` | Email waitlist and the indexer checkpoint |

> A condensed view of the four most-referenced tables also appears in [API Endpoints](api-endpoints.md). This page is the complete reference.

---

## Row-Level Security (RLS)

{% hint style="warning" %}
RLS is **enabled on all 13 tables** with **public-read `SELECT` policies only** (migration `0001_rls_policies.sql`). No write policies are defined: application writes go through the Drizzle connection using the database **service role**, which bypasses RLS. RLS is defense-in-depth — if a non-service-role connection is ever used, it can read but cannot write.
{% endhint %}

---

## Conventions

- **BigInt handling.** Every on-chain `u64`/`i64` is a PostgreSQL `BIGINT` and is mapped with Drizzle's `{ mode: "bigint" }`. API responses serialize these as decimal strings via `serializeBigInt()` (see [API Endpoints](api-endpoints.md)).
- **`campaign_id` is the internal serial.** The `campaign_id` foreign-key column on `root_versions` and every event table references `campaigns.id` (the internal auto-increment PK) — **not** the on-chain `VestingTree.campaign_id` u64. That on-chain value is stored separately on `campaigns.campaign_id`.
- **Idempotency via `signature`.** Every event table has a `UNIQUE` constraint on `signature` (the Solana transaction signature). Re-indexing the same transaction is a safe no-op.
- **Cascading deletes.** `root_versions.campaign_id`, `leaves.root_version_id`, and every `*_events.campaign_id` use `ON DELETE CASCADE`. Deleting a campaign row removes its root versions, leaves, and full event history.

---

## Core Campaign Data

### `campaigns`

One row per `VestingTree` PDA. The primary campaign record.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `SERIAL PK` | Internal auto-increment PK |
| `tree_address` | `TEXT UNIQUE` | VestingTree PDA (base58) |
| `creator` | `TEXT NOT NULL` | Creator pubkey (base58) |
| `mint` | `TEXT NOT NULL` | Mint pubkey (base58); all-zeros for native SOL |
| `campaign_id` | `BIGINT NOT NULL` | On-chain `VestingTree.campaign_id` (u64) |
| `merkle_root` | `TEXT NOT NULL` | Current root hex (64 chars) |
| `leaf_count` | `INTEGER NOT NULL` | Current leaf count |
| `total_supply` | `BIGINT NOT NULL` | u64 token amount |
| `total_claimed` | `BIGINT NOT NULL DEFAULT 0` | Running total from `Claimed` events |
| `cancellable` | `BOOLEAN NOT NULL DEFAULT false` | Whether the campaign is cancellable |
| `cancel_authority` | `TEXT` | Cancel authority pubkey or NULL |
| `pause_authority` | `TEXT` | Pause authority pubkey or NULL |
| `min_cliff_time` | `BIGINT` | Minimum leaf `cliff_time`; synced from chain |
| `cancelled_at` | `BIGINT` | Unix timestamp or NULL |
| `paused` | `BOOLEAN NOT NULL DEFAULT false` | Current pause state |
| `instant_refunded` | `BOOLEAN NOT NULL DEFAULT false` | True after `instant_refund_campaign` |
| `created_at` | `BIGINT NOT NULL` | Unix timestamp |
| `metadata` | `JSONB` | `{ name?, description?, logoUri? }` |

**Unique index:** `(creator, mint, campaign_id)`. **Indexes:** `creator`, `mint`, `merkle_root`, `created_at`.

### `root_versions`

Merkle-root history — one row per `update_root` rotation (plus the initial version).

| Column | Type | Description |
|--------|------|-------------|
| `id` | `SERIAL PK` | Internal auto-increment PK |
| `campaign_id` | `INTEGER FK` | References `campaigns.id`, `ON DELETE CASCADE` |
| `merkle_root` | `TEXT NOT NULL` | Hex, 64 chars |
| `leaf_count` | `INTEGER NOT NULL` | Leaf count for this version |
| `min_cliff_time` | `BIGINT NOT NULL` | Minimum leaf `cliff_time` for this version |
| `ipfs_cid` | `TEXT` | Pinata CID for full leaf+proof JSON |
| `version` | `INTEGER NOT NULL` | 1-based, increments per rotation |
| `created_at` | `BIGINT NOT NULL` | Unix timestamp |

**Unique index:** `(campaign_id, version)`. **Indexes:** `campaign_id`, `merkle_root`.

### `leaves`

Per-recipient data including the Merkle proof.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `SERIAL PK` | Internal auto-increment PK |
| `root_version_id` | `INTEGER FK` | References `root_versions.id`, `ON DELETE CASCADE` |
| `leaf_index` | `INTEGER NOT NULL` | u32 leaf index matching on-chain |
| `beneficiary` | `TEXT NOT NULL` | Recipient pubkey (base58) |
| `amount` | `BIGINT NOT NULL` | u64 token amount |
| `release_type` | `SMALLINT NOT NULL` | `0` = Cliff, `1` = Linear, `2` = Milestone |
| `start_time` | `BIGINT NOT NULL` | i64 unix timestamp |
| `cliff_time` | `BIGINT NOT NULL` | i64 unix timestamp |
| `end_time` | `BIGINT NOT NULL` | i64 unix timestamp |
| `milestone_idx` | `SMALLINT NOT NULL DEFAULT 0` | u8 milestone index |
| `proof` | `JSONB NOT NULL` | `number[][]` sibling hashes |

**Unique index:** `(root_version_id, leaf_index)`. **Indexes:** `(beneficiary, root_version_id)`, `release_type`.

---

## Event Log Tables

Each on-chain event type has its own append-only table. They all share a **common shape**; only the event-specific columns differ.

### Common shape (every event table)

| Column | Type | Description |
|--------|------|-------------|
| `id` | `SERIAL PK` | Internal auto-increment PK |
| `campaign_id` | `INTEGER FK` | References `campaigns.id`, `ON DELETE CASCADE` |
| `signature` | `TEXT UNIQUE` | Transaction signature — idempotency key |
| `slot` | `BIGINT NOT NULL` | Solana slot |
| `block_time` | `BIGINT NOT NULL` | Unix timestamp |

**Indexes (every event table):** `campaign_id`, `block_time`. `claim_events` additionally indexes `(campaign_id, beneficiary)` and `(beneficiary, campaign_id)`.

### Event-specific columns

| Table | On-chain event | Extra columns |
|-------|----------------|---------------|
| `claim_events` | `Claimed` | `beneficiary TEXT`, `leaf_index INT`, `amount BIGINT`, `total_claimed_by_user BIGINT`, `total_claimed_overall BIGINT`, `milestone_idx SMALLINT` (NULL for non-milestone) |
| `cancel_events` | `CampaignCancelled` | `cancelled_at BIGINT`, `claimed_at_cancel BIGINT` |
| `pause_events` | `CampaignPaused` / `CampaignUnpaused` | `paused BOOLEAN` (true = paused, false = unpaused) |
| `root_update_events` | `RootUpdated` | `old_root TEXT`, `new_root TEXT`, `new_leaf_count INT` |
| `withdraw_events` | `UnvestedWithdrawn` | `amount BIGINT` |
| `milestone_events` | `MilestoneReleased` | `milestone_idx SMALLINT`, `released_by TEXT` |
| `stream_cancel_events` | `StreamCancelled` | `cancelled_at BIGINT`, `amount_to_beneficiary BIGINT`, `amount_to_creator BIGINT` |
| `instant_refund_events` | `InstantRefunded` | `cancelled_at BIGINT`, `refunded_to TEXT`, `amount BIGINT` |

These tables power the **timeline** (`GET /api/campaigns/:treeAddress/timeline`) and **activity feed** (`GET /api/activity/:address`) endpoints, which `UNION ALL` across them.

---

## Operational Tables

### `waitlist`

Email signup list.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `SERIAL PK` | Auto-increment PK |
| `email` | `TEXT UNIQUE` | Subscriber email |
| `created_at` | `BIGINT NOT NULL` | Unix timestamp (number mode) |

### `sync_state`

Indexer checkpoint / key-value store.

| Column | Type | Description |
|--------|------|-------------|
| `key` | `TEXT PK` | Config key (e.g. `last_synced_slot`, `last_sync_timestamp`) |
| `value` | `TEXT NOT NULL` | Serialized value |
| `updated_at` | `BIGINT NOT NULL` | Unix timestamp |

Seeded by migration `0001_rls_policies.sql` with `last_synced_slot = 0` and `last_sync_timestamp = 0`.

---

## Relationships

```
campaigns (1) ──< root_versions (1) ──< leaves
    │
    └──< claim_events
    └──< cancel_events
    └──< pause_events
    └──< root_update_events
    └──< withdraw_events
    └──< milestone_events
    └──< stream_cancel_events
    └──< instant_refund_events
```

All foreign keys are `ON DELETE CASCADE`: removing a `campaigns` row removes its root versions, leaves, and full event history. `waitlist` and `sync_state` are standalone (no FKs).

---

## Migrations

Located in `apps/web/src/lib/db/migrations/`. Production uses `db:migrate` (never `db:push` — see the [Mainnet Checklist](../operations/mainnet-checklist.md)).

| File | Purpose |
|------|---------|
| `0000_tan_mac_gargan.sql` | Initial unified schema — all 13 tables, FKs, indexes, unique constraints |
| `0001_rls_policies.sql` | Enable RLS + public-read `SELECT` policies on all tables; seed `sync_state` |
| `0002_historical_schema_bootstrap_note.sql` | No-op placeholder (numbering gap for `db:push`-bootstrapped DBs) |
| `0003_reserved_schema_note.sql` | No-op placeholder |
| `0004_event_tables.sql` | Idempotent `CREATE TABLE IF NOT EXISTS` for the 7 non-claim event tables |
| `0005_timeline_indexes.sql` | Idempotent `CREATE INDEX IF NOT EXISTS` for timeline query performance |
| `0006_instant_refund_campaign_fields.sql` | Add `instant_refunded` + `cancelled_at` to `campaigns` |
| `0007_instant_refund_events.sql` | Idempotent `CREATE TABLE IF NOT EXISTS` for `instant_refund_events` |
| `0008_add_min_cliff_time_to_root_versions.sql` | Add `min_cliff_time` to `root_versions` (and ensure it on `campaigns`) |
