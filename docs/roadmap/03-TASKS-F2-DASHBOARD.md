# Tasks: Dashboard Transparency

**Spec:** `dashboard-transparency`
**Phase:** F2
**Depends on:** `production-security-ops` (P0+P1), `bulk-send` (F1.2 schedule math)
**Prerequisite:** P1.5 sync_state table, F1.2 schedule.ts

---

## F2.1 — Event table Drizzle schema

- [ ] Update `apps/web/src/lib/db/schema.ts`:
  - Add `cancelEvents` table: `id, campaignId FK, cancelledAt, claimedAtCancel, signature UNIQUE, slot, blockTime`
  - Add `pauseEvents` table: `id, campaignId FK, paused (bool), signature UNIQUE, slot, blockTime`
  - Add `rootUpdateEvents` table: `id, campaignId FK, oldRoot, newRoot, newLeafCount, signature UNIQUE, slot, blockTime`
  - Add `withdrawEvents` table: `id, campaignId FK, amount, signature UNIQUE, slot, blockTime`
  - Add `milestoneEvents` table: `id, campaignId FK, milestoneIdx, releasedBy, signature UNIQUE, slot, blockTime`
  - Add `streamCancelEvents` table: `id, campaignId FK, cancelledAt, amountToBeneficiary, amountToCreator, signature UNIQUE, slot, blockTime`
  - All `campaignId` columns: `integer("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" })`
  - All `bigint` columns: `{ mode: "bigint" }`
  - Add indexes on `(campaignId)` and `(blockTime)` for each table
  - Export types for each table
- [ ] **Verify:** `pnpm db:push` creates all tables without error

## F2.2 — Event table migrations

- [ ] Create `apps/web/src/lib/db/migrations/0004_event_tables.sql`
  - `CREATE TABLE` for all 6 event tables with indexes
  - FK constraints to campaigns(id) with CASCADE delete
  - UNIQUE constraints on signature columns
- [ ] Create `apps/web/src/lib/db/migrations/0005_timeline_indexes.sql`
  - `CREATE INDEX idx_campaigns_created_at ON campaigns(created_at)`
  - `CREATE INDEX idx_claim_events_block_time ON claim_events(block_time)`
  - `CREATE INDEX idx_leaves_release_type ON leaves(release_type)`
- [ ] **Verify:** `psql -f 0004_event_tables.sql` succeeds; all 6 tables created with correct columns

## F2.3 — Event discriminators + parsers

- [ ] Create `apps/web/src/lib/indexer/event-indexer.ts`
  - Export discriminators for all 11 event types:
    ```typescript
    export const DISCRIMINATORS = {
      CAMPAIGN_CREATED: sha256("global:campaign_created").subarray(0, 8),
      CAMPAIGN_FUNDED: sha256("global:campaign_funded").subarray(0, 8),
      CLAIMED: sha256("global:claimed").subarray(0, 8),
      CAMPAIGN_CANCELLED: sha256("global:campaign_cancelled").subarray(0, 8),
      ROOT_UPDATED: sha256("global:root_updated").subarray(0, 8),
      UNVESTED_WITHDRAWN: sha256("global:unvested_withdrawn").subarray(0, 8),
      CAMPAIGN_PAUSED: sha256("global:campaign_paused").subarray(0, 8),
      CAMPAIGN_UNPAUSED: sha256("global:campaign_unpaused").subarray(0, 8),
      CLAIM_RECORD_CLOSED: sha256("global:claim_record_closed").subarray(0, 8),
      MILESTONE_RELEASED: sha256("global:milestone_released").subarray(0, 8),
      STREAM_CANCELLED: sha256("global:stream_cancelled").subarray(0, 8),
    };
    ```
  - Export parser functions for each event (wire layout per design.md):
    - `parseCampaignCancelled(data: Buffer): { tree, cancelledAt, claimedAtCancel } | null`
    - `parseCampaignPaused(data: Buffer): { tree } | null` (used for both pause/unpause)
    - `parseRootUpdated(data: Buffer): { tree, oldRoot, newRoot, newLeafCount } | null`
    - `parseUnvestedWithdrawn(data: Buffer): { tree, amount } | null`
    - `parseMilestoneReleased(data: Buffer): { tree, milestoneIdx, releasedBy } | null`
    - `parseStreamCancelled(data: Buffer): { tree, cancelledAt, amountToBeneficiary, amountToCreator } | null`
  - Each parser: check discriminator, parse fields, return typed object or null
  - Re-export `parseClaimedEvent` from existing `claim-events.ts`
- [ ] **Verify:** Unit test each parser with fixture Buffer → correct parsed output

## F2.4 — Full event indexer

- [ ] Create main `indexAllEvents()` function in `event-indexer.ts`
  - Reuse existing pagination pattern from `syncClaimEvents` (getSignaturesForAddress, batch getTransactions)
  - For each transaction's log messages:
    - Extract all Anchor event buffers via `extractAnchorEventData()`
    - Route each buffer by discriminator to the correct parser
    - Write parsed event to correct table
    - All writes transactional (per-event or per-batch)
  - Also update `campaigns` table state on cancel/pause/root-update events:
    - On `CampaignCancelled`: `UPDATE campaigns SET cancelled_at = ... WHERE tree_address = ...`
    - On `CampaignPaused`: `UPDATE campaigns SET paused = true WHERE tree_address = ...`
    - On `CampaignUnpaused`: `UPDATE campaigns SET paused = false WHERE tree_address = ...`
    - On `RootUpdated`: `UPDATE campaigns SET merkle_root = ..., leaf_count = ... WHERE tree_address = ...`
  - Persist `last_synced_slot` to `sync_state` table after each batch
  - Return `{ processed: number, lastSlot: number, byType: Record<string, number> }`
- [ ] Update `apps/web/src/lib/indexer/claim-events.ts`:
  - `syncClaimEvents` now delegates to `indexAllEvents()` internally
  - Re-export for backward compatibility
  - OR: update `apps/web/src/app/api/admin/sync/route.ts` to call `indexAllEvents` directly
- [ ] **Verify:** Call sync on a campaign with mixed events (create + claim + cancel); all event types appear in correct tables

## F2.5 — Campaign state sync

- [ ] Create `apps/web/src/lib/indexer/state-sync.ts`
  - Export `syncCampaignState(treeAddress: string): Promise<void>`
  - Fetch on-chain `VestingTree` account via `connection.getAccountInfo(pda)`
  - Deserialize using Anchor's `VestingTree` account layout (or manual Borsh parsing)
  - Update DB columns: `cancelled_at`, `paused`, `merkle_root`, `leaf_count`, `total_claimed`
  - Only update if on-chain slot > last known slot (idempotent)
  - Called by `indexAllEvents()` after processing events for a campaign
- [ ] **Verify:** After state sync, DB `campaigns` row matches on-chain `VestingTree` account fields

## F2.6 — Timeline endpoint

- [ ] Create `apps/web/src/app/api/campaigns/[treeAddress]/timeline/route.ts`
  - `GET /api/campaigns/:treeAddress/timeline?[fromBlockTime=X][&toBlockTime=Y][&limit=50]`
  - Validate treeAddress format (base58)
  - Find campaign ID from tree_address
  - UNION ALL query across all event tables:
    ```sql
    SELECT 'claimed' as type, block_time, beneficiary as data_beneficiary, amount as data_amount, NULL as data_extra
    FROM claim_events WHERE campaign_id = $1
    UNION ALL
    SELECT 'cancelled', block_time, NULL, cancelled_at, claimed_at_cancel
    FROM cancel_events WHERE campaign_id = $1
    UNION ALL
    ... (all 6 event types)
    ORDER BY block_time DESC
    LIMIT $2
    ```
  - Or: fetch from each table separately and merge-sort in code (cleaner with typed data)
  - Wrap with `errorHandler(withLogger(rateLimit(handler, { requests: 60, window: 60 })))`
  - Return `{ events: [...], total, campaign }`
- [ ] **Verify:** Timeline for a campaign with claims + cancel returns events in chronological order

## F2.7 — Vesting progress endpoint

- [ ] Create `apps/web/src/app/api/beneficiary/[address]/vesting-progress/route.ts`
  - `GET /api/beneficiary/:address/vesting-progress`
  - Validate address format (base58)
  - Reuse the CTE query from `beneficiary/[address]/campaigns/route.ts` to get all campaigns + leaf data
  - For each campaign:
    - Get `totalClaimed` from `claim_events` sum for this beneficiary + campaign
    - Calculate `vestedSoFar` using `schedule.vested(leaf, now)` from `lib/vesting/schedule.ts`
    - Calculate `claimable = vestedSoFar - totalClaimed`
    - Calculate `progressPercent = (vestedSoFar * 10000n / amount) as number / 100`
    - For linear: calculate `nextUnlock` = next second when vested amount increases
    - For cliff: `nextUnlock` = `cliffTime` if not yet reached
    - For milestone: check if released via `milestone_released_flags` (need on-chain read or indexed event)
    - If cancelled: pass `cancelledAt` to `getVestedAmount`
  - Return `{ address, campaigns: [{ treeAddress, metadata, leaf, progress, cancelledAt, paused }] }`
- [ ] **Verify:** Linear campaign at 50% time shows ~50% progress. Cancelled campaign shows frozen vested amount.

## F2.8 — Auto-sync cron

- [ ] Create or update `apps/web/vercel.json`:
  ```json
  {
    "crons": [{
      "path": "/api/admin/sync",
      "schedule": "*/5 * * * *"
    }]
  }
  ```
  - 5-minute interval for event sync
  - Uses existing `POST /api/admin/sync` endpoint (admin key auth)
  - Alternative: Vercel cron doesn't support auth headers — create a dedicated `GET /api/cron/sync` that uses a `CRON_SECRET` env var
- [ ] Create `apps/web/src/app/api/cron/sync/route.ts` (if needed)
  - Validates `Authorization: Bearer <CRON_SECRET>`
  - Calls `indexAllEvents()` directly
  - Returns `{ processed, lastSlot, byType }`
- [ ] Add `CRON_SECRET` to `.env.example`
- [ ] **Verify:** Cron triggers every 5 minutes; new events appear in DB within 5 min of on-chain confirmation

## F2.9 — Event indexer tests

- [ ] Create `apps/web/tests/indexer/event-indexer.test.ts`
  - Test: `parseCampaignCancelled` with fixture data → correct fields
  - Test: `parseRootUpdated` with fixture data → old_root, new_root, new_leaf_count
  - Test: `parseMilestoneReleased` → milestone_idx, released_by
  - Test: `parseStreamCancelled` → amounts to beneficiary and creator
  - Test: Unknown discriminator → returns null
  - Test: Buffer too short → returns null
  - Test: `indexAllEvents` processes batch of transactions with mixed events
  - Test: Duplicate signature → `onConflictDoNothing`, no error
  - Test: `sync_state` updated after successful batch
- [ ] All tests pass in CI

---

## Verification checklist

- [ ] `pnpm test` passes in `apps/web/` (existing + new tests)
- [ ] `pnpm test:localnet` passes (86/86 SC tests unchanged)
- [ ] All 6 new event tables created with correct schema + indexes
- [ ] `POST /api/admin/sync` indexes all event types (not just Claimed)
- [ ] `GET /api/campaigns/:tree/timeline` returns mixed events sorted by block_time
- [ ] `GET /api/beneficiary/:addr/vesting-progress` shows correct vested/claimed/claimable
- [ ] Vesting progress for cancelled campaign shows frozen amounts
- [ ] Auto-sync cron triggers and processes new events
- [ ] `sync_state` table persists last synced slot across runs
- [ ] DB campaigns table stays in sync with on-chain state
