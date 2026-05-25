# Design: Dashboard Transparency

**Spec:** `dashboard-transparency`
**Phase:** F2 (Feature Phase 2)
**Depends on:** `production-security-ops` (P0+P1 complete), `bulk-send` (F1.2 schedule math)
**Estimate:** 6 days
**Owner:** Lana (BE lead)

---

## Context

The SC emits 11 event types. The BE currently only indexes `Claimed` events. This spec expands to all events, adds state sync, vesting progress calculation, timeline endpoint, and auto-sync cron. These power the real-time dashboard.

**User need:** 4/8 users lack visibility into distribution timelines. Every state change emits an event. Every account field is publicly readable.

**Source:** `docs/GAP-ANALYSIS-ROADMAP.md` — Feature 2: Transparency.

---

## Architecture

### Event indexing pipeline

```
Solana RPC
  → getSignaturesForAddress(PROGRAM_ID)
  → getTransactions(batch)
  → extractAnchorEventData(logs)
  → Parse each event buffer by discriminator
    → Claimed → claim_events table
    → CampaignCancelled → cancel_events table
    → CampaignPaused / CampaignUnpaused → pause_events table
    → RootUpdated → root_update_events table
    → UnvestedWithdrawn → withdraw_events table
    → MilestoneReleased → milestone_events table
    → StreamCancelled → stream_cancel_events table
  → Update campaigns table (state sync)
  → Update sync_state (checkpoint)
```

### State sync

After event indexing, read on-chain `VestingTree` accounts for any campaign that had state-changing events (cancel, pause, root update). Update DB columns:
- `cancelled_at`
- `paused`
- `merkle_root`
- `leaf_count`
- `total_claimed`

This keeps the DB as the canonical mirror of on-chain state.

### Vesting progress calculation

```
For each beneficiary campaign:
  1. Get leaf data from latest root version (already in leaves table)
  2. Get claim_events for this beneficiary + campaign (already indexed)
  3. Calculate totalClaimed = sum of claim amounts
  4. Calculate vestedSoFar = schedule.vested(leaf, now) (using TS schedule math from F1.2)
  5. Calculate claimable = vestedSoFar - totalClaimed
  6. Calculate nextUnlock = next date when vested amount increases
  7. Calculate progressPercent = (vestedSoFar / amount) * 100
```

### Auto-sync cron

Vercel cron calls `POST /api/admin/sync` every 5 minutes. This triggers the event indexer + state sync. The sync_state table persists the last synced slot across invocations.

---

## Data Model

### New tables (migration 0004)

```sql
-- Campaign cancellation events
CREATE TABLE cancel_events (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  cancelled_at BIGINT NOT NULL,
  claimed_at_cancel BIGINT NOT NULL,
  signature TEXT NOT NULL UNIQUE,
  slot BIGINT NOT NULL,
  block_time BIGINT NOT NULL
);
CREATE INDEX idx_cancel_events_campaign ON cancel_events(campaign_id);
CREATE INDEX idx_cancel_events_block_time ON cancel_events(block_time);

-- Pause/unpause events
CREATE TABLE pause_events (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  paused BOOLEAN NOT NULL,
  signature TEXT NOT NULL UNIQUE,
  slot BIGINT NOT NULL,
  block_time BIGINT NOT NULL
);
CREATE INDEX idx_pause_events_campaign ON pause_events(campaign_id);
CREATE INDEX idx_pause_events_block_time ON pause_events(block_time);

-- Root rotation events
CREATE TABLE root_update_events (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  old_root TEXT NOT NULL,
  new_root TEXT NOT NULL,
  new_leaf_count INTEGER NOT NULL,
  signature TEXT NOT NULL UNIQUE,
  slot BIGINT NOT NULL,
  block_time BIGINT NOT NULL
);
CREATE INDEX idx_root_update_events_campaign ON root_update_events(campaign_id);
CREATE INDEX idx_root_update_events_block_time ON root_update_events(block_time);

-- Withdrawal events (withdraw_unvested)
CREATE TABLE withdraw_events (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL,
  signature TEXT NOT NULL UNIQUE,
  slot BIGINT NOT NULL,
  block_time BIGINT NOT NULL
);
CREATE INDEX idx_withdraw_events_campaign ON withdraw_events(campaign_id);
CREATE INDEX idx_withdraw_events_block_time ON withdraw_events(block_time);

-- Milestone release events
CREATE TABLE milestone_events (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  milestone_idx SMALLINT NOT NULL,
  released_by TEXT NOT NULL,
  signature TEXT NOT NULL UNIQUE,
  slot BIGINT NOT NULL,
  block_time BIGINT NOT NULL
);
CREATE INDEX idx_milestone_events_campaign ON milestone_events(campaign_id);
CREATE INDEX idx_milestone_events_block_time ON milestone_events(block_time);

-- Stream cancellation events
CREATE TABLE stream_cancel_events (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  cancelled_at BIGINT NOT NULL,
  amount_to_beneficiary BIGINT NOT NULL,
  amount_to_creator BIGINT NOT NULL,
  signature TEXT NOT NULL UNIQUE,
  slot BIGINT NOT NULL,
  block_time BIGINT NOT NULL
);
CREATE INDEX idx_stream_cancel_events_campaign ON stream_cancel_events(campaign_id);
CREATE INDEX idx_stream_cancel_events_block_time ON stream_cancel_events(block_time);
```

### Additional indexes (migration 0005)

```sql
CREATE INDEX idx_campaigns_created_at ON campaigns(created_at);
CREATE INDEX idx_claim_events_block_time ON claim_events(block_time);
CREATE INDEX idx_leaves_release_type ON leaves(release_type);
```

---

## API Design

### `GET /api/campaigns/:treeAddress/timeline`

**Auth:** None (public)
**Rate limit:** 60/min

Response:
```json
{
  "events": [
    {
      "type": "claimed",
      "blockTime": "1700000000",
      "data": {
        "beneficiary": "base58",
        "leafIndex": 0,
        "amount": "1000000"
      }
    },
    {
      "type": "cancelled",
      "blockTime": "1700001000",
      "data": {
        "cancelledAt": "1700001000",
        "claimedAtCancel": "5000000"
      }
    }
  ],
  "total": 42,
  "campaign": "treeAddress"
}
```

Implementation: UNION ALL across all event tables, ordered by `block_time DESC`, paginated.

### `GET /api/beneficiary/:address/vesting-progress`

**Auth:** None (public)
**Rate limit:** 60/min

Response:
```json
{
  "address": "base58",
  "campaigns": [
    {
      "treeAddress": "base58",
      "metadata": { "name": "Team Vesting" },
      "leaf": {
        "amount": "1000000",
        "releaseType": 1,
        "startTime": "1700000000",
        "cliffTime": "1700000000",
        "endTime": "1731536000"
      },
      "progress": {
        "totalEntitled": "1000000",
        "vestedSoFar": "500000",
        "claimedSoFar": "200000",
        "claimable": "300000",
        "progressPercent": 50.0,
        "nextUnlock": "1700100000"
      },
      "cancelledAt": null,
      "paused": false
    }
  ]
}
```

Calculation uses TS `schedule.ts` from F1.2. For cancelled campaigns, passes `cancelledAt` to `getVestedAmount`.

---

## Event Discriminators

Each Anchor event has a unique 8-byte discriminator = `sha256("global:<EventName>")[0..8]`. The existing `CLAIMED_DISCRIMINATOR` pattern extends to:

| Event | Discriminator prefix | Parsed in |
|-------|---------------------|-----------|
| `Claimed` | `sha256("global:claimed")[0..8]` | `claim_events` |
| `CampaignCancelled` | `sha256("global:campaign_cancelled")[0..8]` | `cancel_events` |
| `CampaignPaused` | `sha256("global:campaign_paused")[0..8]` | `pause_events` |
| `CampaignUnpaused` | `sha256("global:campaign_unpaused")[0..8]` | `pause_events` |
| `RootUpdated` | `sha256("global:root_updated")[0..8]` | `root_update_events` |
| `UnvestedWithdrawn` | `sha256("global:unvested_withdrawn")[0..8]` | `withdraw_events` |
| `MilestoneReleased` | `sha256("global:milestone_released")[0..8]` | `milestone_events` |
| `StreamCancelled` | `sha256("global:stream_cancelled")[0..8]` | `stream_cancel_events` |

### Wire layout for each event (offsets from discriminator)

**CampaignCancelled** (after 8-byte discriminator):
- `tree`: 32 bytes (Pubkey)
- `cancelled_at`: 8 bytes (i64)
- `claimed_at_cancel`: 8 bytes (u64)

**CampaignPaused / CampaignUnpaused** (after 8-byte discriminator):
- `tree`: 32 bytes (Pubkey)

**RootUpdated** (after 8-byte discriminator):
- `tree`: 32 bytes (Pubkey)
- `old_root`: 32 bytes ([u8; 32])
- `new_root`: 32 bytes ([u8; 32])
- `new_leaf_count`: 4 bytes (u32)

**UnvestedWithdrawn** (after 8-byte discriminator):
- `tree`: 32 bytes (Pubkey)
- `amount`: 8 bytes (u64)

**MilestoneReleased** (after 8-byte discriminator):
- `tree`: 32 bytes (Pubkey)
- `milestone_idx`: 1 byte (u8)
- `released_by`: 32 bytes (Pubkey)

**StreamCancelled** (after 8-byte discriminator):
- `tree`: 32 bytes (Pubkey)
- `cancelled_at`: 8 bytes (i64)
- `amount_to_beneficiary`: 8 bytes (u64)
- `amount_to_creator`: 8 bytes (u64)

---

## Key Decisions

### D1: Separate event tables, not single JSONB table

Typed tables with indexed columns. Enables:
- Efficient filtered queries (`WHERE campaign_id = X AND block_time > Y`)
- Type-safe Drizzle schema
- No JSON path query overhead

### D2: UNION ALL for timeline

No materialized view. The timeline endpoint queries across all event tables with `UNION ALL`. With proper indexes on `(campaign_id, block_time)`, this is fast for up to millions of rows.

### D3: State sync reads on-chain account

After indexing events, the sync reads the `VestingTree` account directly via `connection.getAccountInfo()`. This catches any state the event stream missed (e.g., if event parsing fails on a new event variant).

### D4: Vercel cron for auto-sync

`vercel.json` cron config triggers `POST /api/admin/sync` every 5 minutes. For Hobby plan, falls back to manual sync or external cron (e.g., cron-job.org).

---

## File Map

### New files

| File | Purpose |
|------|---------|
| `apps/web/src/lib/indexer/event-indexer.ts` | Full event indexer (all discriminators + parsers) |
| `apps/web/src/lib/indexer/state-sync.ts` | On-chain VestingTree → DB sync |
| `apps/web/src/app/api/campaigns/[treeAddress]/timeline/route.ts` | Timeline endpoint |
| `apps/web/src/app/api/beneficiary/[address]/vesting-progress/route.ts` | Vesting progress endpoint |
| `apps/web/src/lib/db/migrations/0004_event_tables.sql` | Event tables migration |
| `apps/web/src/lib/db/migrations/0005_timeline_indexes.sql` | Index migration |
| `apps/web/tests/indexer/event-indexer.test.ts` | Event indexer tests |

### Modified files

| File | Change |
|------|--------|
| `apps/web/src/lib/db/schema.ts` | Add 6 event tables + Drizzle definitions |
| `apps/web/src/app/api/admin/sync/route.ts` | Call expanded event indexer + state sync |
| `apps/web/src/lib/indexer/claim-events.ts` | Refactor parsers into event-indexer.ts, keep as re-export |
| `apps/web/vercel.json` | Add cron config for auto-sync |

---

## Out of scope

- WebSocket real-time push (polling via cron is sufficient for MVP)
- Email/webhook notifications (P2)
- Dashboard summary endpoint (low priority, FE can aggregate)
- Event reorg handling (accept small risk for MVP)
