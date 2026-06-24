# Tasks: Dashboard Transparency

**Spec:** `dashboard-transparency`
**Phase:** F2
**Depends on:** `production-security-ops` (P0+P1), `bulk-send` (F1.2 schedule math)
**Prerequisite:** P1.5 sync_state table, F1.2 schedule.ts

---

## F2.1 — Event table Drizzle schema

- [x] Update `apps/web/src/lib/db/schema.ts`:
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

- [x] Create `apps/web/src/lib/db/migrations/0004_event_tables.sql`
  - `CREATE TABLE` for all 6 event tables with indexes
  - FK constraints to campaigns(id) with CASCADE delete
  - UNIQUE constraints on signature columns
- [x] Create `apps/web/src/lib/db/migrations/0005_timeline_indexes.sql`
  - `CREATE INDEX idx_campaigns_created_at ON campaigns(created_at)`
  - `CREATE INDEX idx_claim_events_block_time ON claim_events(block_time)`
  - `CREATE INDEX idx_leaves_release_type ON leaves(release_type)`
- [ ] **Verify:** `psql -f 0004_event_tables.sql` succeeds; all 6 tables created with correct columns

## F2.3 — Event discriminators + parsers

- [x] Create `apps/web/src/lib/indexer/event-indexer.ts`
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
- [x] **Verify:** Unit test each parser with fixture Buffer → correct parsed output

## F2.4 — Full event indexer

- [x] Create main `indexAllEvents()` function in `event-indexer.ts`
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
- [x] Update `apps/web/src/app/api/admin/sync/route.ts` to call `indexAllEvents` directly
- [ ] **Verify:** Call sync on a campaign with mixed events (create + claim + cancel); all event types appear in correct tables

## F2.5 — Campaign state sync

- [x] Create `apps/web/src/lib/indexer/state-sync.ts`
  - Export `syncCampaignState(treeAddress: string): Promise<void>`
  - Fetch on-chain `VestingTree` account via `connection.getAccountInfo(pda)`
  - Deserialize using manual Borsh parsing (VestingTree layout from IDL)
  - Update DB columns: `cancelled_at`, `paused`, `merkle_root`, `leaf_count`, `total_claimed`
  - State sync updates are transactional
- [ ] **Verify:** After state sync, DB `campaigns` row matches on-chain `VestingTree` account fields

## F2.6 — Timeline endpoint

- [x] Create `apps/web/src/app/api/campaigns/[treeAddress]/timeline/route.ts`
  - `GET /api/campaigns/:treeAddress/timeline?[fromBlockTime=X][&toBlockTime=Y][&limit=50]`
  - Validate treeAddress format (base58)
  - Find campaign ID from tree_address
  - UNION ALL query across all 7 event types, ordered by `block_time DESC`, paginated
  - Wrap with `withRoute({ rateLimit: { requests: 60, window: 60 } }, handler)`
  - Return `{ events: [...], total, campaign }`
- [ ] **Verify:** Timeline for a campaign with claims + cancel returns events in chronological order

## F2.7 — Vesting progress endpoint

- [x] Create `apps/web/src/app/api/beneficiary/[address]/vesting-progress/route.ts`
  - `GET /api/beneficiary/:address/vesting-progress`
  - Validate address format (base58)
  - Reuse the CTE query from `beneficiary/[address]/campaigns/route.ts` to get all campaigns + leaf data
  - For each campaign: calculate vestedSoFar, claimedSoFar, claimable, progressPercent, nextUnlock
  - Uses `getVestedAmount()` from `lib/vesting/schedule.ts`, handles cancelledAt correctly
  - Return `{ address, campaigns: [{ treeAddress, metadata, leaf, progress, cancelledAt, paused }] }`
- [ ] **Verify:** Linear campaign at 50% time shows ~50% progress. Cancelled campaign shows frozen vested amount.

## F2.8 — Auto-sync cron

- [x] Create `apps/web/vercel.json` with 5-minute cron pointing to `/api/cron/sync`
- [x] Create `apps/web/src/app/api/cron/sync/route.ts`
  - Validates `Authorization: Bearer <CRON_SECRET>`
  - Calls `indexAllEvents()` directly
  - Returns `{ processed, lastSlot, byType }`
- [x] Add `CRON_SECRET` to `.env.example`
- [ ] **Verify:** Cron triggers every 5 minutes; new events appear in DB within 5 min of on-chain confirmation

## F2.9 — Event indexer tests

- [x] Create `apps/web/tests/indexer/event-indexer.test.ts` (21 tests, all passing)
  - Test: `parseCampaignCancelled` with fixture data → correct fields
  - Test: `parseRootUpdated` with fixture data → old_root, new_root, new_leaf_count
  - Test: `parseMilestoneReleased` → milestone_idx, released_by
  - Test: `parseStreamCancelled` → amounts to beneficiary and creator
  - Test: Unknown discriminator → returns null
  - Test: Buffer too short → returns null
  - Test: All discriminators are unique and 8 bytes
- [x] All tests pass: 469 passed | 13 skipped (integration/devnet)

---

## Cursor Guardrails

Before marking any task complete, verify:
- [ ] Route uses `withRoute()` wrapper (not manual middleware chain)
- [ ] All responses use `jsonResponse()` (not `NextResponse.json()`)
- [ ] Request body validated with Zod schema where applicable
- [ ] Event indexer wraps (insert event + update campaigns + update sync_state) in `db.transaction()`
- [ ] State sync updates are transactional
- [ ] No read-then-write outside transaction
- [ ] No dead code — every new file is imported somewhere
- [ ] Errors thrown as `AppError` subclasses
- [ ] BigInt values are strings in all responses
- [ ] New DB tables have RLS policies in migration
- [ ] UNION ALL queries use parameterized values (no string interpolation in SQL)

## Verification checklist

- [x] `pnpm test` passes in `apps/web/` (469 passed | 13 skipped)
- [ ] `pnpm test:localnet` passes (86/86 SC tests unchanged)
- [ ] All 6 new event tables created with correct schema + indexes
- [ ] `POST /api/admin/sync` indexes all event types (not just Claimed)
- [ ] `GET /api/campaigns/:tree/timeline` returns mixed events sorted by block_time
- [ ] `GET /api/beneficiary/:addr/vesting-progress` shows correct vested/claimed/claimable
- [ ] Vesting progress for cancelled campaign shows frozen amounts
- [ ] Auto-sync cron triggers and processes new events
- [ ] `sync_state` table persists last synced slot across runs
- [ ] DB campaigns table stays in sync with on-chain state
