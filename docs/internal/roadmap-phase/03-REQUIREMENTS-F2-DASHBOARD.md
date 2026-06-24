# Dashboard Transparency — Requirements

**Phase:** F2 (Feature Phase 2)
**Depends on:** `production-security-ops` (P0+P1 complete), `bulk-send` (F1.2 schedule math)
**Estimate:** 6 days
**Owner:** Lana (BE lead)

---

## Overview

The smart contract emits 11 event types for every state change, and every account field is publicly readable on-chain. However, the backend currently only indexes `Claimed` events, leaving 4 of 8 users without visibility into distribution timelines, campaign lifecycle changes, or vesting progress. This phase expands the indexer to capture all event types, mirrors on-chain state to the database, calculates real-time vesting progress, and provides a unified event timeline — all kept fresh via an automatic sync cron.

---

## User Stories

### Theme 1: Full Event Indexing

#### US-1.1: Index all on-chain event types, not just claims

**As a** beneficiary, **I want** the backend to index every event the smart contract emits (cancellations, pauses, root updates, withdrawals, milestone releases, stream cancellations), **so that** the dashboard can show me the complete history of what has happened to a campaign, not just claims.

- **GIVEN** a campaign has had a mix of on-chain events (claims, a cancellation, a root update, a pause/unpause, a milestone release, and a stream cancellation)
- **WHEN** the event sync runs
- **THEN** every event type is parsed from the on-chain transaction logs and stored in its corresponding database table
- **AND** no event type is silently dropped or ignored

#### US-1.2: Correctly parse each event type's data fields

**As a** public user, **I want** each event to store its type-specific data fields accurately, **so that** I can see not just that something happened, but the details of what happened (amounts withdrawn, milestone indices, root hashes, pause state, split amounts on stream cancel).

- **GIVEN** an on-chain `CampaignCancelled` event with `cancelled_at` and `claimed_at_cancel` values
- **WHEN** the indexer parses this event
- **THEN** the cancel event record contains the correct `cancelled_at` timestamp and `claimed_at_cancel` amount
- **AND** the same correctness holds for `RootUpdated` (old root, new root, new leaf count), `UnvestedWithdrawn` (amount), `MilestoneReleased` (milestone index, released by), `CampaignPaused`/`CampaignUnpaused` (pause boolean), and `StreamCancelled` (cancelled at, amount to beneficiary, amount to creator)

#### US-1.3: Handle duplicate events without errors

**As a** admin, **I want** the indexer to skip already-indexed events on re-sync, **so that** running sync multiple times does not create duplicate records or crash.

- **GIVEN** a set of on-chain events has already been indexed in a previous sync run
- **WHEN** the sync runs again over the same slot range
- **THEN** existing event records are not duplicated
- **AND** no error is raised
- **AND** the sync continues processing new events normally

#### US-1.4: Persist sync checkpoint across runs

**As a** admin, **I want** the indexer to remember where it left off, **so that** each sync run picks up from the last processed slot instead of re-scanning from the beginning.

- **GIVEN** the indexer has processed events up to slot N and stored this in the sync state
- **WHEN** the next sync run starts
- **THEN** it begins scanning from slot N (or N+1), not from slot 0
- **AND** only new events are fetched from the RPC

---

### Theme 2: Campaign State Sync

#### US-2.1: Database mirrors on-chain campaign state

**As a** creator, **I want** the campaign record in the database to reflect the current on-chain state of the vesting tree, **so that** I can see accurate cancelled/paused/root/leaf-count status without querying the blockchain directly.

- **GIVEN** a campaign has been cancelled on-chain
- **WHEN** the state sync runs for that campaign
- **THEN** the database campaign record shows the correct `cancelled_at` timestamp
- **AND** the same applies to `paused` (updated on pause/unpause), `merkle_root` and `leaf_count` (updated on root rotation), and `total_claimed` (updated after claims)

#### US-2.2: State sync is idempotent

**As a** admin, **I want** the state sync to be safe to run repeatedly, **so that** I can trigger sync at any time without corrupting data.

- **GIVEN** the campaign state in the database already matches the on-chain state
- **WHEN** state sync runs again for the same campaign
- **THEN** the database record is unchanged
- **AND** no error is raised

---

### Theme 3: Vesting Progress Calculation

#### US-3.1: See real-time vesting progress for my campaigns

**As a** beneficiary, **I want** to see how much of my allocated tokens have vested, how much I have already claimed, and how much is currently claimable, **so that** I know exactly what I can withdraw right now.

- **GIVEN** I am a beneficiary in a linear vesting campaign that is 50% through its schedule
- **AND** I have claimed 20% of my total allocation so far
- **WHEN** I request my vesting progress
- **THEN** I see `vestedSoFar` at approximately 50% of my total entitlement
- **AND** `claimedSoFar` at 20% of my total entitlement
- **AND** `claimable` at approximately 30% of my total entitlement
- **AND** `progressPercent` at approximately 50.0

#### US-3.2: See vesting progress for cancelled campaigns

**As a** beneficiary, **I want** the vesting progress to show a frozen vested amount for a cancelled campaign, **so that** I know what I am still entitled to claim even though vesting has stopped.

- **GIVEN** I am a beneficiary in a campaign that was cancelled when it was 40% through its schedule
- **WHEN** I request my vesting progress
- **THEN** `vestedSoFar` reflects the amount vested at the cancellation time (not the current time)
- **AND** `claimable` reflects vested-at-cancel minus what I already claimed
- **AND** the progress calculation does not continue to accrue beyond the cancellation point

#### US-3.3: See vesting progress for different schedule types

**As a** beneficiary, **I want** vesting progress to work correctly regardless of release type (cliff, linear, or milestone), **so that** I get accurate numbers no matter what schedule the creator chose.

- **GIVEN** I am a beneficiary in a cliff vesting campaign and the cliff time has not been reached
- **WHEN** I request my vesting progress
- **THEN** `vestedSoFar` is 0 and `claimable` is 0
- **AND** `nextUnlock` shows the cliff time

- **GIVEN** I am a beneficiary in a cliff vesting campaign and the cliff time has passed
- **WHEN** I request my vesting progress
- **THEN** `vestedSoFar` equals my full entitlement amount

- **GIVEN** I am a beneficiary in a milestone vesting campaign and the milestone has not been released
- **WHEN** I request my vesting progress
- **THEN** `vestedSoFar` is 0

- **GIVEN** I am a beneficiary in a milestone vesting campaign and the milestone has been released
- **WHEN** I request my vesting progress
- **THEN** `vestedSoFar` equals my full entitlement amount

#### US-3.4: See next unlock date

**As a** beneficiary, **I want** to see when my next tokens will unlock, **so that** I know when to check back.

- **GIVEN** I am in a linear vesting campaign that is currently vesting
- **WHEN** I request my vesting progress
- **THEN** `nextUnlock` shows the next timestamp when the vested amount increases

- **GIVEN** I am in a campaign where vesting is fully complete (100% vested)
- **WHEN** I request my vesting progress
- **THEN** `nextUnlock` is null or indicates no further unlocks

---

### Theme 4: Unified Event Timeline

#### US-4.1: View all campaign events in chronological order

**As a** public user, **I want** to see all events for a campaign in a single timeline sorted by time, **so that** I can understand the full lifecycle of the campaign at a glance.

- **GIVEN** a campaign has claims, a root update, a pause, and a cancellation
- **WHEN** I request the timeline for that campaign
- **THEN** I receive a list of events containing entries of every type that occurred
- **AND** the events are sorted by block time in descending (newest first) order
- **AND** each event includes its type, block time, and type-specific data

#### US-4.2: Filter and paginate the timeline

**As a** public user, **I want** to filter the timeline by time range and paginate through results, **so that** I can navigate campaigns with hundreds or thousands of events.

- **GIVEN** a campaign has 200 events
- **WHEN** I request the timeline with a limit of 50
- **THEN** I receive the 50 most recent events
- **AND** the response includes a total count of 200

- **GIVEN** I only want events from a specific time window
- **WHEN** I request the timeline with `fromBlockTime` and `toBlockTime` parameters
- **THEN** only events within that time range are returned

#### US-4.3: Timeline is publicly accessible

**As a** public user, **I want** to access any campaign's timeline without authentication, **so that** I can audit any vesting campaign's history.

- **GIVEN** I have no wallet connected and no API key
- **WHEN** I request the timeline for a valid campaign tree address
- **THEN** I receive the full timeline data with no authentication error

---

### Theme 5: Auto-Sync Cron

#### US-5.1: Events sync automatically without manual intervention

**As a** creator, **I want** the backend to automatically sync new on-chain events every few minutes, **so that** the dashboard stays up to date without me or an admin having to trigger sync manually.

- **GIVEN** new events have been emitted on-chain since the last sync
- **WHEN** at least 5 minutes have passed
- **THEN** the auto-sync cron has run and indexed those new events
- **AND** the database is up to date with the on-chain state

#### US-5.2: Auto-sync is authenticated

**As a** admin, **I want** the auto-sync endpoint to require a secret token, **so that** only the scheduled cron (or an authorized admin) can trigger it.

- **GIVEN** the auto-sync endpoint is deployed
- **WHEN** an unauthenticated request is made to the cron sync endpoint
- **THEN** the request is rejected with an authentication error

- **GIVEN** the auto-sync endpoint is deployed
- **WHEN** a request with the correct cron secret is made
- **THEN** the sync runs successfully and returns the sync result

---

### Theme 6: New Event Tables and Indexes

#### US-6.1: Query events efficiently by campaign and time

**As a** admin, **I want** event tables to be indexed on campaign ID and block time, **so that** timeline queries and per-campaign event lookups remain fast even as the dataset grows.

- **GIVEN** a campaign has accumulated thousands of events across all event types
- **WHEN** the timeline endpoint queries all event tables for that campaign
- **THEN** the query completes in under 1 second (indexed lookups, not full table scans)

#### US-6.2: Delete campaign cascades to its events

**As a** admin, **I want** deleting a campaign to automatically delete all its associated events, **so that** orphaned event records do not accumulate.

- **GIVEN** a campaign has events in multiple event tables (claims, cancels, pauses, root updates, etc.)
- **WHEN** the campaign record is deleted from the database
- **THEN** all event records for that campaign across all event tables are also deleted

---

## Non-Functional Requirements

- **Rate limiting:** All new public endpoints (timeline, vesting progress) enforce 60 requests per minute per IP.
- **BigInt serialization:** All numeric values in API responses that exceed JavaScript's safe integer range are serialized as strings, not native numbers.
- **Backward compatibility:** The existing `claim_events` table, the `POST /api/admin/sync` endpoint, and the claim-based API responses (`GET /api/campaigns/:treeAddress/claims`, campaign analytics) continue to work unchanged.
- **Idempotency:** Sync operations (event indexing, state sync) are safe to run multiple times without side effects. Duplicate event signatures are silently skipped.
- **Performance:** Timeline queries for a single campaign return results in under 1 second for datasets up to 100,000 events. Vesting progress queries return in under 2 seconds for a beneficiary with up to 50 campaign memberships.
- **Structured logging:** All new endpoints emit structured logs with request ID, method, path, status, and duration. All errors are logged with context, not swallowed.

---

## Dependencies

- **P0 (Security Gate):** Rate limiting, authentication middleware, CORS, error handling, and structured logging must be in place before these public endpoints ship.
- **P1 (Operational Baseline):** The `sync_state` table (P1.5) must exist for checkpointing. Structured error responses and logging (P1.1, P1.4) must be available as middleware.
- **F1.2 (Schedule Math):** The TypeScript vesting schedule module must be complete, as the vesting progress endpoint depends on it to calculate vested amounts for cliff, linear, and milestone schedules.
- **Existing `claim_events` table and `claim-events.ts` indexer:** The new event tables and indexer extend the existing claim indexing pattern. The existing `claim_events` schema must not be altered.

---

## Out of Scope

- **WebSocket real-time push:** The dashboard will rely on polling via the auto-sync cron. Real-time WebSocket streaming of events is deferred.
- **Email or webhook notifications:** Notifying users when events occur (e.g., "your tokens are now claimable") is a separate feature at lower priority.
- **Dashboard summary endpoint:** An aggregated `GET /api/dashboard/:creator` endpoint returning total campaigns, total distributed, active/paused/cancelled counts is deferred. The frontend can aggregate from existing endpoints.
- **Event reorg handling:** If Solana reorganizes a finalized slot, indexed events may reference a slot that no longer exists on-chain. Cleanup of stale events is deferred.
- **CampaignCreated and CampaignFunded event indexing:** These are emitted at campaign creation time but the campaign record is already created via the API. Indexing them provides no new data and is deferred.
- **ClaimRecordClosed event indexing:** Not needed for dashboard transparency. Deferred.
- **Frontend dashboard UI:** This spec covers backend API and data layer only. Frontend rendering is a separate effort.
