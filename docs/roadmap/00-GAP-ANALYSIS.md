# Gap Analysis & BE-DB-SC-Merkle Roadmap

**Author:** Lana (SC/BE lead)
**Date:** 2026-05-22
**Branch:** `dev_lana`
**Scope:** BE-DB-SC-Merkle (Lana's responsibility only)

---

## Current State Summary

### Smart Contract (SC) — 86/86 tests pass

| Component | Status | Files |
|-----------|--------|-------|
| `create_campaign` (batch Merkle) | Done | `instructions/create_campaign.rs` |
| `create_stream` (single-recipient atomic) | Done | `instructions/create_stream.rs` |
| `fund_campaign` | Done | `instructions/fund_campaign.rs` |
| `claim` (Merkle proof + schedule math) | Done | `instructions/claim.rs` |
| `withdraw` (proof-less single-stream) | Done | `instructions/withdraw.rs` |
| `cancel_campaign` (campaign-wide) | Done | `instructions/cancel_campaign.rs` |
| `cancel_stream` (single-stream split) | Done | `instructions/cancel_stream.rs` |
| `withdraw_unvested` (post-grace sweep) | Done | `instructions/withdraw_unvested.rs` |
| `update_root` (per-recipient clawback) | Done | `instructions/update_root.rs` |
| `pause_campaign` / `unpause_campaign` | Done | `instructions/pause_campaign.rs` |
| `set_milestone_released` (creator flag) | Done | `instructions/set_milestone_released.rs` |
| `close_claim_record` | Done | `instructions/close_claim_record.rs` |
| `get_vested_amount` (read-only CPI) | Done | `instructions/get_vested_amount.rs` |
| Schedule math (Cliff/Linear/Milestone) | Done | `math/schedule.rs` |
| Merkle verifier | Done | `math/merkle.rs` |
| 9 event types | Done | `events.rs` |
| Grace period (7 days) | Done | `constants.rs` |
| VestingTree / ClaimRecord / VestingLeaf | Done | `state/` |

### Backend (BE) — 8 API routes live on Vercel

| Route | Status | Files |
|-------|--------|-------|
| `POST /api/campaigns` | Done — idempotent, leaf verification | `app/api/campaigns/route.ts` |
| `GET /api/campaigns` | Done — filtered/paginated list | `app/api/campaigns/route.ts` |
| `GET /api/campaigns/:treeAddress` | Done — detail + analytics | `app/api/campaigns/[treeAddress]/route.ts` |
| `GET /api/campaigns/:treeAddress/proof` | Done — leaf + proof for beneficiary | `app/api/campaigns/[treeAddress]/proof/route.ts` |
| `POST /api/campaigns/:treeAddress/root-versions` | Done — root rotation | `app/api/campaigns/[treeAddress]/root-versions/route.ts` |
| `GET /api/campaigns/:treeAddress/claims` | Done — claim history | `app/api/campaigns/[treeAddress]/claims/route.ts` |
| `GET /api/beneficiary/:address/campaigns` | Done — beneficiary's campaigns | `app/api/beneficiary/[address]/campaigns/route.ts` |
| `POST /api/admin/sync` | Done — claim event indexer | `app/api/admin/sync/route.ts` |

### Database (DB) — 4 tables on Supabase

| Table | Status | Columns |
|-------|--------|---------|
| `campaigns` | Done | tree_address, creator, mint, campaign_id, merkle_root, leaf_count, total_supply, total_claimed, cancellable, cancel_authority, pause_authority, cancelled_at, paused, created_at, metadata |
| `root_versions` | Done | campaign_id FK, merkle_root, leaf_count, ipfs_cid, version, created_at |
| `leaves` | Done | root_version_id FK, leaf_index, beneficiary, amount, release_type, start_time, cliff_time, end_time, milestone_idx, proof |
| `claim_events` | Done | campaign_id FK, beneficiary, leaf_index, amount, total_claimed_by_user, total_claimed_overall, milestone_idx, signature, slot, block_time |

### Merkle Pipeline (TS SDK)

| Component | Status | Files |
|-----------|--------|-------|
| Leaf encoder (`encodeLeaf`, `leafHash`) | Done | `clients/ts/src/leaf.ts` |
| Tree builder (`VestingMerkleTree`) | Done | `clients/ts/src/merkle.ts` |
| Campaign preparer (`prepareCampaign`) | Done | `clients/ts/src/prepare.ts` |
| Proof verification (`verifyProof`) | Done | `clients/ts/src/merkle.ts` |
| Web builder parity | Done | `apps/web/src/lib/merkle/builder.ts` |
| Server-side leaf verification | Done | `apps/web/src/lib/merkle/verify.ts` |

---

## Feature Gap Analysis

### Feature 1: Automation (Bulk Send) — Top Priority

**User need:** Project sets up campaign once → recipients pull tokens themselves → program enforces schedule. 1-to-many scalability.

#### What's already done

- SC: `create_campaign` accepts Merkle root with unlimited leaves in one tx. Fixed cost ~0.005 SOL.
- SC: `fund_campaign` transfers tokens into vault.
- SC: `claim` lets each recipient pull their tokens with Merkle proof.
- BE: `POST /api/campaigns` accepts full leaf array + root, verifies all proofs, persists to DB.
- BE: `GET /api/campaigns/:treeAddress/proof` returns leaf + proof for a beneficiary.
- Merkle: `prepareCampaign` builds tree + generates all proofs in one call.
- TS SDK: `VestingMerkleTree` supports up to 2^20 leaves (1M recipients).

#### What's missing / needs improvement

| Gap | Priority | Layer | Details |
|-----|----------|-------|---------|
| **CSV/bulk recipient import** | High | BE | No endpoint to upload a CSV of recipients and auto-generate the Merkle tree. Currently the FE must call `prepareCampaign` client-side and POST the full payload. Add `POST /api/campaigns/prepare` that accepts recipient list, builds tree, returns prepared campaign. |
| **Batch proof generation API** | High | BE | Proof generation is only in TS SDK. Add server-side endpoint that builds tree and stores proofs. The current flow requires the caller to run `prepareCampaign` before calling `POST /api/campaigns`. |
| **Campaign status webhook** | Medium | BE | No webhook/notification when campaign is fully funded, or when all recipients have claimed. Add a `POST /api/admin/notify` or cron-based check. |
| **CSV validation** | Medium | BE | No validation endpoint for CSV data (duplicate wallets, invalid amounts, schedule conflicts) before tree building. |
| **Bulk fund campaign** | Low | SC | `fund_campaign` is single-call. For very large campaigns, could add a "fund in chunks" approach. Not needed now since one SPL transfer handles any amount. |

#### Implementation path

```
1. BE: Add POST /api/campaigns/prepare
   File: apps/web/src/app/api/campaigns/prepare/route.ts
   - Accepts: { recipients: CampaignRecipient[], mint, creator, campaignId, cancellable, cancelAuthority, pauseAuthority, metadata }
   - Calls prepareCampaign() from clients/ts
   - Returns: { treeAddress, merkleRoot, leafCount, totalSupply, leaves (with proofs) }
   - FE can then POST /api/campaigns with the prepared data + call create_campaign on-chain

2. BE: Add POST /api/campaigns/import
   File: apps/web/src/app/api/campaigns/import/route.ts
   - Accepts: multipart CSV upload
   - Validates: duplicate wallets, positive amounts, valid schedule (start <= cliff <= end), release_type 0-2
   - Returns: validated recipients array or error details
   - Then chains into /prepare logic

3. BE: Add validators for bulk operations
   File: apps/web/src/lib/api/validators.ts
   - Add `bulkRecipientSchema` for CSV row validation
   - Add `prepareCampaignRequestSchema`

4. Tests: Add BE bulk flow test
   File: apps/web/tests/api/bulk-campaign.test.ts
   - Test: 100-recipient CSV → prepare → POST → GET proof for each
   - Test: invalid CSV (duplicate wallet, negative amount, invalid schedule)
```

---

### Feature 2: Transparency / Real-Time Dashboard — Second Priority

**User need:** 4/8 users lack visibility into distribution timelines and vesting terms. Every state change emits an event, every account field is publicly readable.

#### What's already done

- SC: 9 event types emitted for every state change (`CampaignCreated`, `CampaignFunded`, `Claimed`, `CampaignCancelled`, `RootUpdated`, `UnvestedWithdrawn`, `CampaignPaused`, `CampaignUnpaused`, `ClaimRecordClosed`, `MilestoneReleased`, `StreamCancelled`).
- BE: `POST /api/admin/sync` indexes `Claimed` events from on-chain.
- BE: `GET /api/campaigns/:treeAddress` returns analytics (unique claimers, claim count, percent claimed).
- BE: `GET /api/campaigns/:treeAddress/claims` returns full claim history.
- BE: `GET /api/beneficiary/:address/campaigns` returns all campaigns for a beneficiary.
- DB: `claim_events` table with full event data.

#### What's missing / needs improvement

| Gap | Priority | Layer | Details |
|-----|----------|-------|---------|
| **Index all event types, not just Claimed** | High | BE | `syncClaimEvents` only parses `Claimed` events. Need to also index: `CampaignCancelled`, `RootUpdated`, `UnvestedWithdrawn`, `CampaignPaused`, `CampaignUnpaused`, `MilestoneReleased`, `StreamCancelled`. These drive the dashboard's timeline view. |
| **Event tables for non-claim events** | High | DB | Only `claim_events` table exists. Need tables for: `cancel_events`, `pause_events`, `root_update_events`, `withdraw_events`, `milestone_events`. |
| **Campaign state sync** | High | BE | `campaigns` table only updates `totalClaimed` on sync. Need to also sync: `cancelledAt`, `paused`, `merkleRoot` (after root rotation), `milestone_released_flags`. |
| **Beneficiary vesting progress endpoint** | Medium | BE | No endpoint that calculates real-time vesting progress for a beneficiary. Need `GET /api/beneficiary/:address/vesting-progress` that returns: total entitled, total claimed, vested but unclaimed, next unlock date/time. |
| **Scheduled auto-sync** | Medium | BE | No cron/scheduled job for `POST /api/admin/sync`. Currently manual. Add Vercel cron or Supabase pg_cron. |
| **Event timeline endpoint** | Medium | BE | No unified timeline endpoint. Need `GET /api/campaigns/:treeAddress/timeline` that returns all events (claims, cancels, pauses, root updates, milestones) sorted by block_time. |
| **Dashboard summary endpoint** | Low | BE | No aggregated dashboard endpoint. Need `GET /api/dashboard/:creator` returning: total campaigns, total distributed, total recipients, active/paused/cancelled counts. |

#### Implementation path

```
1. DB: Add event tables
   File: apps/web/src/lib/db/schema.ts
   New tables:
   - cancel_events: campaign_id FK, cancelled_at, claimed_at_cancel, signature, slot, block_time
   - pause_events: campaign_id FK, paused (bool), signature, slot, block_time
   - root_update_events: campaign_id FK, old_root, new_root, new_leaf_count, signature, slot, block_time
   - withdraw_events: campaign_id FK, amount, signature, slot, block_time
   - milestone_events: campaign_id FK, milestone_idx, released_by, signature, slot, block_time

2. DB: Add migration
   File: apps/web/src/lib/db/migrations/0002_event_tables.sql
   - Create above tables with indexes
   - Add indexes on (campaign_id, block_time) for timeline queries

3. BE: Expand event indexer
   File: apps/web/src/lib/indexer/claim-events.ts → rename to event-indexer.ts
   - Add parsers for all event discriminators (CampaignCancelled, CampaignPaused, etc.)
   - Each parser writes to its respective event table
   - Also update campaigns table fields: cancelledAt, paused, merkleRoot

4. BE: Add campaign state sync
   File: apps/web/src/lib/indexer/state-sync.ts
   - After event sync, read on-chain VestingTree account
   - Update campaigns table: cancelledAt, paused, merkleRoot, totalClaimed, leafCount
   - Idempotent (check slot before update)

5. BE: Add vesting progress endpoint
   File: apps/web/src/app/api/beneficiary/[address]/vesting-progress/route.ts
   - Accepts: beneficiary address
   - Fetches all campaigns for beneficiary from leaves table
   - For each campaign: calculates vested amount using schedule math (cliff/linear/milestone)
   - Returns: { campaigns: [{ treeAddress, totalEntitled, vestedSoFar, claimedSoFar, claimable, nextUnlock, progressPercent }] }

6. BE: Add timeline endpoint
   File: apps/web/src/app/api/campaigns/[treeAddress]/timeline/route.ts
   - UNION query across all event tables
   - Returns: [{ type, blockTime, data }] sorted by blockTime DESC

7. BE: Add scheduled sync (Vercel cron)
   File: apps/web/vercel.json (or api/cron route)
   - Add cron job calling /api/admin/sync every 5 minutes
   - Alternative: Supabase pg_cron + pg_net

8. Tests: Add event indexer tests
   File: apps/web/tests/indexer/event-indexer.test.ts
   - Test each event parser with fixture data
   - Test idempotency (same signature processed twice)
```

---

### Feature 3: Standard Vesting Mechanisms — Cliff, Linear, Milestone

**User need:** Campaign-level options applied uniformly across all recipients.

#### What's already done

- SC: All three release types fully implemented in `schedule.rs`:
  - `release_type 0` (Cliff): zero until `cliff_time`, full `amount` after
  - `release_type 1` (Linear): zero until `cliff_time`, proportional accrual until `end_time` (u128 intermediate for overflow safety)
  - `release_type 2` (Milestone): full `amount` when `now >= cliff_time` AND creator releases via `set_milestone_released`
- SC: Per-leaf mixing — one campaign can have different release types per leaf
- SC: `milestone_released_flags` — 256-bit bitmap for creator-controlled milestone release
- SC: `cancel_stream` milestone-aware (released → full to beneficiary, unreleased → 0)
- SC: Tests T6, T17, T18, T41 (cliff), T10, T11, T46, T63, T65 (milestone), T64b-d (cancel milestone)
- BE: `leaves` table stores `release_type`, `start_time`, `cliff_time`, `end_time`, `milestone_idx`
- Merkle: `prepareCampaign` accepts `releaseType` per recipient

#### What's missing / needs improvement

| Gap | Priority | Layer | Details |
|-----|----------|-------|---------|
| **Schedule template presets** | Medium | BE | No "preset" system for common schedules (e.g., "4-year linear with 1-year cliff"). Add `POST /api/schedule-templates` or embed in campaign creation. |
| **Vesting schedule simulation** | Medium | BE | No endpoint to simulate a vesting schedule — "show me what happens month by month". Useful for dashboard transparency. Add `POST /api/simulate-vesting`. |
| **Campaign-level vesting type enforcement** | Low | BE | Currently nothing prevents mixing release types in one campaign (which SC supports). If BD confirms "campaign-level uniform" is required, add BE validation to reject mixed release types. |
| **Milestone release via API** | Medium | BE | No endpoint to trigger `set_milestone_released` on-chain. Need `POST /api/campaigns/:treeAddress/milestones/:idx/release` that constructs + sends the tx (or returns the tx for wallet signing). |

#### Implementation path

```
1. BE: Add schedule templates (if needed by FE)
   File: apps/web/src/app/api/schedule-templates/route.ts
   - GET: returns predefined templates (4yr-linear-1yr-cliff, 2yr-linear, 1yr-cliff, etc.)
   - Not a DB table — static JSON config is sufficient

2. BE: Add vesting simulation endpoint
   File: apps/web/src/app/api/simulate-vesting/route.ts
   - POST: accepts { releaseType, amount, startTime, cliffTime, endTime, milestones[] }
   - Returns: monthly breakdown of vested amounts [{ date, vested, cumulative }]
   - Pure computation — no DB needed

3. BE: Add milestone release endpoint
   File: apps/web/src/app/api/campaigns/[treeAddress]/milestones/[idx]/route.ts
   - POST: returns unsigned transaction for `set_milestone_released`
   - Caller signs and sends via wallet
   - Requires: connection to Solana RPC + Anchor IDL

4. BE: Campaign-level release type enforcement (if BD confirms)
   File: apps/web/src/app/api/campaigns/route.ts (POST handler)
   - Add validation: if all leaves have same releaseType → store as campaign-level type
   - Reject if mixed and BD says "uniform only"
   - NOTE: SC already supports mixed — this is BE-level policy only

5. Tests: Add simulation tests
   File: apps/web/tests/api/simulate-vesting.test.ts
   - Test cliff schedule: 0 until cliff, full after
   - Test linear schedule: progressive unlock
   - Test milestone: full unlock on release
```

---

### Feature 4: Automatic Clawback — Safety Net

**User need:** If campaign is canceled, recipients retain already vested tokens. Remainder returns to project after 7-day grace period.

#### What's already done

- SC: `cancel_campaign` — sets `cancelled_at`, freezes vesting curve (`effective_now = min(now, cancelled_at)`)
- SC: `cancel_stream` — single-recipient atomic split (vested → beneficiary, remainder → creator)
- SC: `withdraw_unvested` — creator sweeps vault after 7-day grace period (`GRACE_PERIOD_SECS = 604800`)
- SC: `GracePeriodActive` error if grace period hasn't expired
- SC: `NotCancellable` error for non-cancellable campaigns
- SC: `FullyVested` error if trying to cancel fully claimed campaign
- SC: `CampaignCancelled` error prevents pausing/unpausing/root-rotation after cancel
- SC: Tests T4, T12, T34, T35, T55, T60, T62, T64
- BE: `campaigns` table stores `cancellable`, `cancel_authority`, `cancelled_at`
- BE: `GET /api/campaigns?status=cancelled` filters cancelled campaigns

#### What's missing / needs improvement

| Gap | Priority | Layer | Details |
|-----|----------|-------|---------|
| **Grace period countdown endpoint** | High | BE | No endpoint showing time remaining in grace period for a cancelled campaign. Add to campaign detail response: `gracePeriodEnd`, `gracePeriodRemaining`. |
| **Auto-withdraw trigger** | Medium | BE | No automatic notification/trigger when grace period expires. Add cron check + notification (email/webhook) that unvested tokens are withdrawable. |
| **Cancel via API** | Medium | BE | No endpoint to build `cancel_campaign` transaction. Need `POST /api/campaigns/:treeAddress/cancel` that returns unsigned tx. |
| **Withdraw unvested via API** | Medium | BE | No endpoint to build `withdraw_unvested` transaction. Need `POST /api/campaigns/:treeAddress/withdraw-unvested`. |
| **Clawback history** | Medium | DB | No tracking of withdraw_unvested events. Need `withdraw_events` table (covered in Feature 2 event tables). |
| **Cancel stream via API** | Medium | BE | No endpoint to build `cancel_stream` transaction for single-recipient streams. |
| **Grace period notification** | Low | BE | No webhook/email when grace period starts or ends. Add to notification system. |

#### Implementation path

```
1. BE: Add grace period info to campaign detail
   File: apps/web/src/app/api/campaigns/[treeAddress]/route.ts
   - If cancelled_at is set:
     - gracePeriodEnd = cancelled_at + 604800
     - gracePeriodRemaining = gracePeriodEnd - now (0 if expired)
     - isGracePeriodExpired = now >= gracePeriodEnd
   - Add to GET response

2. BE: Add cancel campaign endpoint
   File: apps/web/src/app/api/campaigns/[treeAddress]/cancel/route.ts
   - POST: returns unsigned transaction for cancel_campaign
   - Validates: campaign exists, is cancellable, not already cancelled
   - Caller signs + sends via wallet

3. BE: Add withdraw unvested endpoint
   File: apps/web/src/app/api/campaigns/[treeAddress]/withdraw-unvested/route.ts
   - POST: returns unsigned transaction for withdraw_unvested
   - Validates: campaign is cancelled, grace period has expired
   - Caller signs + sends via wallet

4. BE: Add cancel stream endpoint
   File: apps/web/src/app/api/campaigns/[treeAddress]/cancel-stream/route.ts
   - POST: returns unsigned transaction for cancel_stream
   - Validates: leaf_count == 1, campaign is cancellable, not already cancelled

5. BE: Add grace period expiry check (cron)
   File: apps/web/src/app/api/cron/grace-check/route.ts
   - Finds campaigns where cancelled_at + 7 days < now AND no withdraw event yet
   - Could trigger email/webhook notification
   - Called by Vercel cron or Supabase pg_cron

6. Tests: Add clawback API tests
   File: apps/web/tests/api/clawback.test.ts
   - Test: cancel endpoint returns valid unsigned tx
   - Test: withdraw endpoint rejects if grace period not expired
   - Test: grace period countdown calculation
```

---

## Implementation Priority Order

Based on the user priorities (5/8 ranked Bulk Send first, 4/8 need transparency):

### Phase 1 — Bulk Send Enablers (Week 6)
1. `POST /api/campaigns/prepare` — server-side tree builder
2. `POST /api/campaigns/import` — CSV import + validation
3. Bulk flow tests

### Phase 2 — Dashboard Transparency (Week 6-7)
4. DB: Event tables for all event types
5. BE: Expand event indexer to all events
6. BE: Campaign state sync (cancelledAt, paused, merkleRoot)
7. `GET /api/beneficiary/:address/vesting-progress`
8. `GET /api/campaigns/:treeAddress/timeline`
9. Vercel cron for auto-sync

### Phase 3 — Clawback API (Week 7)
10. Grace period info in campaign detail response
11. `POST /api/campaigns/:treeAddress/cancel` (unsigned tx)
12. `POST /api/campaigns/:treeAddress/withdraw-unvested` (unsigned tx)
13. `POST /api/campaigns/:treeAddress/cancel-stream` (unsigned tx)
14. Grace period expiry cron check

### Phase 4 — Vesting UX (Week 7-8)
15. Vesting simulation endpoint
16. Schedule template presets
17. Milestone release via API

---

## Detailed File Change Map

### New Files to Create

| # | File Path | Purpose |
|---|-----------|---------|
| 1 | `apps/web/src/app/api/campaigns/prepare/route.ts` | Server-side Merkle tree builder |
| 2 | `apps/web/src/app/api/campaigns/import/route.ts` | CSV recipient import + validation |
| 3 | `apps/web/src/app/api/campaigns/[treeAddress]/cancel/route.ts` | Build cancel_campaign unsigned tx |
| 4 | `apps/web/src/app/api/campaigns/[treeAddress]/withdraw-unvested/route.ts` | Build withdraw_unvested unsigned tx |
| 5 | `apps/web/src/app/api/campaigns/[treeAddress]/cancel-stream/route.ts` | Build cancel_stream unsigned tx |
| 6 | `apps/web/src/app/api/campaigns/[treeAddress]/milestones/[idx]/route.ts` | Build set_milestone_released unsigned tx |
| 7 | `apps/web/src/app/api/campaigns/[treeAddress]/timeline/route.ts` | Unified event timeline |
| 8 | `apps/web/src/app/api/beneficiary/[address]/vesting-progress/route.ts` | Real-time vesting calculation |
| 9 | `apps/web/src/app/api/simulate-vesting/route.ts` | Schedule simulation |
| 10 | `apps/web/src/lib/indexer/event-indexer.ts` | Full event indexer (rename from claim-events.ts) |
| 11 | `apps/web/src/lib/indexer/state-sync.ts` | On-chain state sync to DB |
| 12 | `apps/web/src/lib/vesting/schedule.ts` | TS schedule math (mirrors Rust `schedule.rs`) |
| 13 | `apps/web/src/lib/api/tx-builder.ts` | Utility to build unsigned Anchor transactions |
| 14 | `apps/web/tests/api/bulk-campaign.test.ts` | Bulk flow tests |
| 15 | `apps/web/tests/api/clawback.test.ts` | Clawback API tests |
| 16 | `apps/web/tests/indexer/event-indexer.test.ts` | Event indexer tests |

### Files to Modify

| # | File Path | Change |
|---|-----------|--------|
| 1 | `apps/web/src/lib/db/schema.ts` | Add 5 event tables + update type exports |
| 2 | `apps/web/src/lib/db/migrations/` | New migration 0002 for event tables |
| 3 | `apps/web/src/lib/api/validators.ts` | Add bulkRecipientSchema, prepareCampaignRequestSchema |
| 4 | `apps/web/src/app/api/campaigns/[treeAddress]/route.ts` | Add grace period fields to GET response |
| 5 | `apps/web/src/app/api/admin/sync/route.ts` | Call expanded event indexer |
| 6 | `apps/web/src/lib/indexer/claim-events.ts` | Expand to index all event types |
| 7 | `apps/web/vercel.json` | Add cron config for auto-sync |

---

## Key Design Decisions

### D1: Unsigned Transaction Pattern
All mutation endpoints (`cancel`, `withdraw-unvested`, `cancel-stream`, `set-milestone`) return **unsigned transactions**, not execute them. The FE/wallet signs and submits. This keeps private keys off the server.

### D2: Server-Side Merkle Building
`POST /api/campaigns/prepare` moves tree building from FE to BE. Rationale:
- FE doesn't need the `clients/ts` SDK dependency
- CSV import is a server-side operation
- Proofs are stored server-side anyway

### D3: Event Tables vs JSONB
Separate typed tables (not JSONB) for each event type. Rationale:
- Indexed queries per event type
- Type safety in Drizzle schema
- No need for JSON path queries

### D4: Vesting Schedule Math in TS
`apps/web/src/lib/vesting/schedule.ts` mirrors Rust `schedule.rs` exactly. Needed for:
- Vesting progress endpoint (calculates claimable amount off-chain)
- Simulation endpoint
- Dashboard display

### D5: Campaign-Level Release Type (Policy, Not Protocol)
SC supports mixed release types per leaf. If BD confirms "campaign-level uniform only", enforce at BE validation layer — reject POST if leaves have mixed release types. SC stays flexible.

---

## Production Readiness Audit

Full audit of BE-DB-SC-Merkle against production standards. Rated by severity: **P0** = blocks launch, **P1** = must fix within first week live, **P2** = harden in weeks 2-4.

---

### P0 — Security Hardening (Blocks Launch)

| # | Gap | Layer | Details | Fix |
|---|-----|-------|---------|-----|
| S1 | **No rate limiting** | BE | All 8 API routes accept unlimited requests. `POST /api/campaigns` with a 10K-leaf payload can be called thousands of times per second. | Add `@upstash/ratelimit` (Redis-backed, Vercel-native). Apply: 10 req/min on POST routes, 60 req/min on GET routes. File: `apps/web/src/lib/api/rate-limit.ts` + middleware. |
| S2 | **No auth on campaign creation** | BE | `POST /api/campaigns` has zero auth. Anyone can insert campaigns. `POST /api/campaigns/:treeAddress/root-versions` same. | Add wallet-signature auth: `POST` routes require `Authorization: Bearer <signed-message>` header. Verify signature + message server-side. File: `apps/web/src/lib/api/auth-middleware.ts`. |
| S3 | **No CORS configuration** | BE | No CORS headers on any route. Browser cross-origin requests fail or are uncontrolled. | Add `next.config.ts` headers or Next.js middleware. Restrict to production domain. File: `apps/web/src/middleware.ts`. |
| S4 | **No HTTP security headers** | BE | Missing `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Content-Security-Policy`. | Add via `next.config.ts` `headers()` function or `helmet`-equivalent middleware. |
| S5 | **No request body size limit** | BE | Next.js server actions limited to 10MB (configurable), but API routes have no explicit limit. A malicious 100MB CSV payload OOMs the serverless function. | Add `export const config = { api: { bodyParser: { sizeLimit: '1mb' } } }` or check `Content-Length` header. For `/api/campaigns/import` allow up to 10MB. |
| S6 | **RLS on Supabase tables** | DB | Drizzle connects via `DATABASE_URL` with a single role. If that role is the Supabase `postgres` role, RLS is bypassed. If it's an anon/service role, RLS policies must exist. Current status: RLS policies exist per `BE-SC-MERKLE-ACCEPTANCE-STATUS.md` but need verification after new tables are added. | Verify RLS on all 4 existing tables. Add RLS on all new event tables. Use `service_role` for admin sync, `anon` for public reads. File: migration `0003_rls_policies.sql`. |

**Implementation path:**
```
S1. apps/web/src/lib/api/rate-limit.ts
    - Upstash Redis rate limiter
    - 10/min for POST, 60/min for GET, 3/min for admin/sync

S2. apps/web/src/lib/api/auth-middleware.ts
    - Wallet signature verification (ed25519)
    - Nonce-based replay protection (store last 100 nonces in Redis)
    - Admin routes keep API key auth (existing)

S3. apps/web/src/middleware.ts
    - CORS: Allow-Origin = production domain
    - CORS: Allow-Methods = GET, POST, OPTIONS
    - CORS: Allow-Headers = Content-Type, Authorization
    - Preflight handling

S4. apps/web/next.config.ts
    - X-Frame-Options: DENY
    - X-Content-Type-Options: nosniff
    - Strict-Transport-Security: max-age=63072000
    - Referrer-Policy: strict-origin-when-cross-origin

S5. Per-route body size config
    - POST /api/campaigns: 2MB (JSON with up to ~5K leaves)
    - POST /api/campaigns/import: 10MB (CSV)
    - All others: 1MB

S6. Migration 0003_rls_policies.sql
    - ENABLE ROW LEVEL SECURITY on all tables
    - Public SELECT on campaigns, leaves, claim_events, root_versions
    - Authenticated INSERT/UPDATE on campaigns, leaves, root_versions
    - Admin-only INSERT on claim_events
```

---

### P1 — Operational Readiness (First Week Live)

| # | Gap | Layer | Details | Fix |
|---|-----|-------|---------|-----|
| O1 | **No structured logging** | BE | All routes use `console.error`. No request IDs, no log levels, no structured fields. In Vercel, logs are ephemeral — need structured output for observability. | Add `pino` or `@vercel/otel`. Log: `{ requestId, method, path, status, durationMs, error? }`. File: `apps/web/src/lib/api/logger.ts`. |
| O2 | **No health check endpoint** | BE | No `/api/health` to verify DB connection + RPC connectivity. Vercel/monitoring can't distinguish "deploy succeeded" from "service is functional". | Add `GET /api/health` that pings DB (`SELECT 1`) + Solana RPC (`getHealth`). File: `apps/web/src/app/api/health/route.ts`. |
| O3 | **DB connection pool under-configured** | DB | `postgres` pool: `max: 3`, `idle_timeout: 20`, `connect_timeout: 30`. No min connections, no keepalive on Supabase (which kills idle conns after 60s). | Increase to `max: 10` for production. Add `keepalive: 30`. Detect stale connections. File: `apps/web/src/lib/db/index.ts`. |
| O4 | **No graceful error responses** | BE | All catch blocks return generic `{ error: "Internal server error" }`. No error codes, no request IDs, no correlation for debugging. | Add error classification: validation errors (400), not-found (404), auth errors (401/403), rate-limit (429), internal (500 with request ID). File: `apps/web/src/lib/api/errors.ts`. |
| O5 | **Event indexer has no checkpointing** | BE | `syncClaimEvents` accepts `fromSlot` but doesn't persist the last processed slot. If sync crashes mid-batch, re-processing duplicates. | Store `last_synced_slot` in a `sync_state` table. Read on start, write after each successful batch. File: `apps/web/src/lib/db/schema.ts` (add `sync_state` table) + update indexer. |
| O6 | **Event indexer doesn't handle chain reorgs** | BE | If Solana reorgs a finalized slot, indexed events may reference a slot that no longer exists. Currently no cleanup. | Mark events with confirmation status. Re-verify on next sync. Add `confirmation_status` column or re-check signatures periodically. |
| O7 | **No idempotency on event indexing** | DB | `onConflictDoNothing` on `signature` handles duplicates, but the `campaigns.totalClaimed` update uses `GREATEST()` — safe but should be in a transaction with the insert. | Wrap insert + update in explicit transaction. Currently implicit via sequential calls. File: `apps/web/src/lib/indexer/claim-events.ts:127-145`. |

**Implementation path:**
```
O1. apps/web/src/lib/api/logger.ts
    - Structured JSON logger with request ID (from Vercel's x-vercel-id or generate UUID)
    - Levels: debug, info, warn, error
    - Attach to request context

O2. apps/web/src/app/api/health/route.ts
    - GET: { status: "ok", db: true/false, rpc: true/false, version: "0.1.0" }
    - DB check: SELECT 1
    - RPC check: connection.getHealth()

O3. apps/web/src/lib/db/index.ts
    - Production: max=10, keepalive=30, idle_timeout=20, connect_timeout=10
    - Development: max=3, keepalive=0, idle_timeout=1

O4. apps/web/src/lib/api/errors.ts
    - AppError class with { code, message, statusCode, details }
    - errorHandler middleware wrapping all routes
    - Standard error response: { error: string, code: string, requestId: string }

O5. apps/web/src/lib/db/schema.ts
    - Add sync_state table: { key (PK), value (text), updated_at (bigint) }
    - Store: last_synced_slot, last_sync_timestamp

O6-O7. apps/web/src/lib/indexer/claim-events.ts
    - Transactional: insert event + update campaigns + update sync_state in one tx
    - Add confirmation_status column to claim_events (default 'confirmed')
```

---

### P2 — Hardening (Weeks 2-4)

| # | Gap | Layer | Details | Fix |
|---|-----|-------|---------|-----|
| H1 | **No monitoring/alerting** | BE | No uptime monitoring, no error rate alerting, no DB connection pool metrics. | Add Vercel Speed Insights + custom `/api/metrics` endpoint. Or integrate Sentry for error tracking. |
| H2 | **No API versioning** | BE | Routes have no version prefix. Breaking changes to response shape break FE with no migration path. | Add `/api/v1/` prefix or `Accept-Version` header. Current routes become v1. |
| H3 | **BigInt serialization inconsistency** | DB | Schema uses `{ mode: "bigint" }` for u64 columns. Drizzle returns `BigInt` objects. JSON serialization of `BigInt` throws in strict mode. API responses must convert to string. | Audit all API responses — ensure every `BigInt` column is `.toString()` before `JSON.stringify`. Add serialization helper. |
| H4 | **No database migration strategy** | DB | Using `drizzle-kit push` (schema diff push, not migration files). Production needs explicit migrations with rollback. | Switch to `drizzle-kit generate` + `drizzle-kit migrate`. Document rollback procedure. |
| H5 | **No backup/restore** | DB | No documented backup strategy for Supabase. If data is lost, event history is gone. | Enable Supabase Point-in-Time Recovery (PITR). Document restore procedure. Add daily backup check. |
| H6 | **Missing index for common queries** | DB | No index on `campaigns.created_at` for ORDER BY. No index on `claim_events.block_time`. Timeline query will be slow with millions of rows. | Add indexes: `idx_campaigns_created_at`, `idx_claim_events_block_time`, `idx_leaves_release_type`. |
| H7 | **No integration test coverage for new routes** | Test | All new API routes need tests. Currently BE tests are in `apps/web/tests/api/backend.test.ts` but only cover existing routes. | Add test file per new route group. Use Vitest + local Postgres (CI pattern from `web-ci.yml`). |
| H8 | **No load testing** | Test | No load/stress tests. Unknown how the BE handles 100 concurrent campaign creates or 1000 proof lookups. | Add k6 or Artillery load test scripts. Target: 100 RPS on GET routes, 10 RPS on POST routes. |
| H9 | **No .env.example documentation** | Config | `.env.example` exists but lacks descriptions. Developers don't know which vars are required vs optional. | Add comments to `.env.example` with descriptions, defaults, and required status. |

---

### SC Production Readiness

The SC is production-grade for Phase 1. No P0 gaps found.

| Area | Status | Notes |
|------|--------|-------|
| CEI pattern | **Pass** | All handlers mutate state before CPI |
| Overflow safety | **Pass** | All arithmetic uses `checked_add`/`saturating_sub`/`u128` intermediates |
| Account validation | **Pass** | All accounts have PDA seeds, `has_one`, `constraint` checks |
| Reentrancy | **Pass** | No CPI callbacks to program; Anchor `init_if_needed` is safe |
| Merkle proof limit | **Pass** | `MAX_MERKLE_PROOF_LEN = 32` + `max_proof_len_for_leaf_count()` |
| Events coverage | **Pass** | 11 event types, emitted after every state mutation |
| No TODOs/FIXMEs | **Pass** | Zero `TODO`/`FIXME`/`HACK`/`unwrap()` in production code |
| Dependencies | **Pass** | `anchor-lang 1.0.0`, `anchor-spl 1.0.0`, `solana-keccak-hasher 2.2` — all latest stable |
| Devnet deployed | **Pass** | `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` — 86/86 tests pass |
| CI pipeline | **Pass** | `ci.yml`: build + IDL drift check + 86 tests. `web-ci.yml`: merkle parity + E2E + Vitest |

#### SC P1 Items (Pre-Audit)

| # | Item | Details |
|---|------|---------|
| SC1 | **Token-2022 guard** | PRD requires `UnsupportedMint` error if mint belongs to Token-2022 program. Currently not implemented. Add `constraint = mint.owner == token_program::id()` to `create_campaign` and `create_stream`. Add `VestingError::UnsupportedMint`. |
| SC2 | **Withdraw on paused campaign** | `withdraw.rs` checks `!tree.paused` but `cancel_stream.rs` also checks. Verify all instruction handlers have pause check (skip `get_vested_amount` since read-only). |
| SC3 | **Anchor `init-if-needed` risk** | Anchor docs warn about `init_if_needed` — two concurrent first-claim txs may race. Document that frontend must retry on `AccountAlreadyInitialized`. |
| SC4 | **Milestone idx bounds** | `milestone_idx` is `u8` (0-255). `set_milestone_released` accepts any `u8`. `milestone_released_flags` is `[u8; 32]` = 256 bits. Maximum milestone index = 255. No overflow. **Pass.** |
| SC5 | **`withdraw_unvested` sweeps ALL vault tokens** | After grace period, creator gets entire vault balance. If a recipient claimed partially, their remaining vested-but-unclaimed tokens are also swept. This is by design (PRD says "remainder returns to project") but should be documented clearly. |

---

### Merkle Pipeline Production Readiness

The Merkle pipeline is production-grade. No P0 or P1 gaps.

| Area | Status | Notes |
|------|--------|-------|
| TS-Rust parity | **Pass** | 13/13 golden vector tests pass. `leafHash` byte-identical. |
| Tree depth limit | **Pass** | `MAX_TREE_DEPTH = 20` (1M leaves). Proof size = 640 bytes max, within Solana 1232-byte tx limit. |
| Leaf encoding | **Pass** | 70-byte Borsh-compatible LE buffer. Field order matches Rust exactly. |
| Proof verification | **Pass** | Server-side `verifyAllLeaves` called on every `POST /api/campaigns` and `POST .../root-versions`. |
| Anti second-preimage | **Pass** | `LEAF_PREFIX = 0x00`, `NODE_PREFIX = 0x01` — domain separation prevents cross-level attacks. |
| Builder parity | **Pass** | `apps/web/src/lib/merkle/builder.ts` matches `clients/ts/src/` output. |

---

## Production Phase Plan

### Phase P0 — Security Gate (Before Any Public Endpoint)
**Timeline: 3-4 days**
**Blocks: Everything else**

| Step | File(s) | Est. |
|------|---------|------|
| P0.1 Rate limiting | `lib/api/rate-limit.ts` + middleware | 4h |
| P0.2 Wallet auth on POST routes | `lib/api/auth-middleware.ts` | 6h |
| P0.3 CORS + security headers | `middleware.ts` + `next.config.ts` | 2h |
| P0.4 Request body size limits | Per-route config | 1h |
| P0.5 RLS verification + new table policies | Migration `0003_rls_policies.sql` | 2h |
| P0.6 Tests for all security controls | `tests/api/security.test.ts` | 3h |

### Phase P1 — Operational Baseline (First Week Live)
**Timeline: 4-5 days**
**Depends on: P0**

| Step | File(s) | Est. |
|------|---------|------|
| P1.1 Structured logging | `lib/api/logger.ts` | 3h |
| P1.2 Health check endpoint | `api/health/route.ts` | 1h |
| P1.3 DB connection pool tuning | `lib/db/index.ts` | 1h |
| P1.4 Error classification + standard responses | `lib/api/errors.ts` | 3h |
| P1.5 Sync state checkpointing | `lib/db/schema.ts` + indexer update | 2h |
| P1.6 Transactional event indexing | `lib/indexer/claim-events.ts` | 2h |
| P1.7 BigInt serialization audit | All route files | 2h |
| P1.8 Tests for operational endpoints | `tests/api/health.test.ts` | 2h |

### Phase F1 — Bulk Send Features (Week 6)
**Timeline: 5 days**
**Depends on: P0**

| Step | File(s) | Est. |
|------|---------|------|
| F1.1 Server-side tree builder | `api/campaigns/prepare/route.ts` | 4h |
| F1.2 CSV import + validation | `api/campaigns/import/route.ts` | 6h |
| F1.3 Bulk validators | `lib/api/validators.ts` | 2h |
| F1.4 TS schedule math mirror | `lib/vesting/schedule.ts` | 3h |
| F1.5 Bulk flow tests | `tests/api/bulk-campaign.test.ts` | 3h |

### Phase F2 — Dashboard Transparency (Week 6-7)
**Timeline: 6 days**
**Depends on: P0, P1**

| Step | File(s) | Est. |
|------|---------|------|
| F2.1 Event tables (5 new tables) | `lib/db/schema.ts` + migration | 3h |
| F2.2 Full event indexer | `lib/indexer/event-indexer.ts` | 6h |
| F2.3 Campaign state sync | `lib/indexer/state-sync.ts` | 4h |
| F2.4 Vesting progress endpoint | `api/beneficiary/[address]/vesting-progress/route.ts` | 4h |
| F2.5 Timeline endpoint | `api/campaigns/[treeAddress]/timeline/route.ts` | 3h |
| F2.6 Vercel cron for auto-sync | `vercel.json` or cron route | 2h |
| F2.7 Event indexer tests | `tests/indexer/event-indexer.test.ts` | 3h |
| F2.8 Missing indexes for timeline queries | Migration `0004_timeline_indexes.sql` | 1h |

### Phase F3 — Clawback API (Week 7)
**Timeline: 4 days**
**Depends on: P0, F2.1 (needs withdraw_events table)**

| Step | File(s) | Est. |
|------|---------|------|
| F3.1 Grace period in campaign detail | `api/campaigns/[treeAddress]/route.ts` | 1h |
| F3.2 TX builder utility | `lib/api/tx-builder.ts` | 4h |
| F3.3 Cancel campaign endpoint | `api/campaigns/[treeAddress]/cancel/route.ts` | 3h |
| F3.4 Withdraw unvested endpoint | `api/campaigns/[treeAddress]/withdraw-unvested/route.ts` | 3h |
| F3.5 Cancel stream endpoint | `api/campaigns/[treeAddress]/cancel-stream/route.ts` | 3h |
| F3.6 Milestone release endpoint | `api/campaigns/[treeAddress]/milestones/[idx]/route.ts` | 3h |
| F3.7 Grace period expiry cron | `api/cron/grace-check/route.ts` | 2h |
| F3.8 Clawback API tests | `tests/api/clawback.test.ts` | 3h |

### Phase F4 — Vesting UX (Week 7-8)
**Timeline: 3 days**
**Depends on: F1.4 (needs TS schedule math)**

| Step | File(s) | Est. |
|------|---------|------|
| F4.1 Vesting simulation endpoint | `api/simulate-vesting/route.ts` | 3h |
| F4.2 Schedule template presets | `api/schedule-templates/route.ts` | 2h |
| F4.3 Simulation tests | `tests/api/simulate-vesting.test.ts` | 2h |

### Phase P2 — Hardening (Weeks 8-10)
**Timeline: 5 days**
**Depends on: F1-F4 complete**

| Step | File(s) | Est. |
|------|---------|------|
| P2.1 Error monitoring (Sentry or equivalent) | Integration | 3h |
| P2.2 API versioning (`/api/v1/`) | All route files | 4h |
| P2.3 Migration strategy (generate + migrate) | `drizzle.config.ts` + docs | 2h |
| P2.4 Supabase PITR + backup verification | Supabase dashboard | 2h |
| P2.5 Load testing scripts | `tests/load/` | 4h |
| P2.6 .env.example documentation | `.env.example` | 1h |
| P2.7 SC Token-2022 guard | `instructions/create_campaign.rs`, `errors.rs` | 2h |

---

## Total Effort Estimate

| Phase | Days | Blocking? |
|-------|------|-----------|
| **P0 — Security Gate** | 3-4 | **Yes — blocks all** |
| **P1 — Operational Baseline** | 4-5 | Blocks F2 (indexer) |
| **F1 — Bulk Send** | 5 | No |
| **F2 — Dashboard** | 6 | Depends on P1 |
| **F3 — Clawback API** | 4 | Depends on F2.1 |
| **F4 — Vesting UX** | 3 | Depends on F1.4 |
| **P2 — Hardening** | 5 | No |
| **Total** | **30-32 days** | |

Critical path: **P0 → P1 → F2 → F3** (17-19 days)

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Event indexer falls behind on high-traffic campaigns | Medium | High | Paginated batch processing; slot checkpointing; configurable batch size |
| Unsigned tx endpoint needs Anchor IDL + program metadata | Low | Medium | Cache IDL + program ID in env; build tx-builder utility once |
| Vercel cron 10s timeout (Hobby plan) | High | Medium | Upgrade to Pro ($20/mo); or use Supabase pg_cron + pg_net |
| CSV import for 10K+ recipients hits body size limit | Medium | Low | Stream parser; chunk processing; reject payloads > 10MB |
| TS-Rust schedule math divergence | Low | Critical | Golden vector tests in CI; test same inputs produce same outputs |
| Race condition on first claim (`init_if_needed`) | Low | Medium | Frontend retries on `AccountAlreadyInitialized`; document in README |
| BigInt JSON serialization throws in strict mode | Medium | Medium | Audit all API responses; convert BigInt to string before serialization |
| DB connection pool exhaustion under load | Medium | High | Pool max=10; keepalive=30s; monitoring on pool utilization |
| Supabase free tier limits (500MB DB, 500K rows) | Medium | Medium | Monitor table sizes; archive old events; upgrade to Pro if needed |
| Rate limit bypass via distributed requests | Low | Medium | Use IP + wallet fingerprint; consider Cloudflare rate limiting as edge layer |

---

## No-Code Observations

### What doesn't need SC changes
All four user features are achievable with the current SC instruction set (86/86 tests pass). The SC is feature-complete for Phase 1. All gaps are in the BE/DB/Merkle layer.

### What doesn't need Merkle changes
The `clients/ts` Merkle library is complete and tested (13/13 parity). No changes needed to `leaf.ts`, `merkle.ts`, or `prepare.ts`. The Merkle pipeline is production-grade.

### What's genuinely Phase 2 (SC changes required)
- Token-2022 support (SC change: `UnsupportedMint` error, mint owner program check in `create_campaign` + `create_stream`)
- Squads multisig for `cancel_authority` (no code change — just use multisig address as `cancel_authority`)
- Pinocchio rewrite for CU optimization
- proptest / cargo-fuzz for audit preparation
- DeFi composability (lending protocols, vesting vouchers)
- DAO governance integration (Realms VSR)

### What can ship without security hardening (internal/dev only)
The current codebase is safe for internal testing and development. P0 security measures are only required when:
- The API is publicly accessible (not localhost)
- Real tokens are at risk (not devnet/test tokens)
- External users are creating campaigns

---

## Updated File Change Map (Complete)

### New Files to Create

| # | File Path | Phase | Purpose |
|---|-----------|-------|---------|
| 1 | `apps/web/src/lib/api/rate-limit.ts` | P0 | Upstash Redis rate limiter |
| 2 | `apps/web/src/lib/api/auth-middleware.ts` | P0 | Wallet signature auth for POST routes |
| 3 | `apps/web/src/lib/api/errors.ts` | P1 | Error classification + standard responses |
| 4 | `apps/web/src/lib/api/logger.ts` | P1 | Structured JSON logger |
| 5 | `apps/web/src/lib/api/tx-builder.ts` | F3 | Utility to build unsigned Anchor transactions |
| 6 | `apps/web/src/lib/vesting/schedule.ts` | F1 | TS schedule math (mirrors Rust `schedule.rs`) |
| 7 | `apps/web/src/lib/indexer/event-indexer.ts` | F2 | Full event indexer (all event types) |
| 8 | `apps/web/src/lib/indexer/state-sync.ts` | F2 | On-chain state sync to DB |
| 9 | `apps/web/src/app/api/health/route.ts` | P1 | Health check (DB + RPC) |
| 10 | `apps/web/src/app/api/campaigns/prepare/route.ts` | F1 | Server-side Merkle tree builder |
| 11 | `apps/web/src/app/api/campaigns/import/route.ts` | F1 | CSV recipient import + validation |
| 12 | `apps/web/src/app/api/simulate-vesting/route.ts` | F4 | Schedule simulation |
| 13 | `apps/web/src/app/api/campaigns/[treeAddress]/cancel/route.ts` | F3 | Build cancel_campaign unsigned tx |
| 14 | `apps/web/src/app/api/campaigns/[treeAddress]/withdraw-unvested/route.ts` | F3 | Build withdraw_unvested unsigned tx |
| 15 | `apps/web/src/app/api/campaigns/[treeAddress]/cancel-stream/route.ts` | F3 | Build cancel_stream unsigned tx |
| 16 | `apps/web/src/app/api/campaigns/[treeAddress]/milestones/[idx]/route.ts` | F3 | Build set_milestone_released unsigned tx |
| 17 | `apps/web/src/app/api/campaigns/[treeAddress]/timeline/route.ts` | F2 | Unified event timeline |
| 18 | `apps/web/src/app/api/beneficiary/[address]/vesting-progress/route.ts` | F2 | Real-time vesting calculation |
| 19 | `apps/web/src/middleware.ts` | P0 | CORS + security headers |
| 20 | `apps/web/tests/api/security.test.ts` | P0 | Security control tests |
| 21 | `apps/web/tests/api/health.test.ts` | P1 | Health endpoint tests |
| 22 | `apps/web/tests/api/bulk-campaign.test.ts` | F1 | Bulk flow tests |
| 23 | `apps/web/tests/indexer/event-indexer.test.ts` | F2 | Event indexer tests |
| 24 | `apps/web/tests/api/clawback.test.ts` | F3 | Clawback API tests |
| 25 | `apps/web/tests/api/simulate-vesting.test.ts` | F4 | Simulation tests |
| 26 | `apps/web/tests/load/` | P2 | Load testing scripts |

### Files to Modify

| # | File Path | Phase | Change |
|---|-----------|-------|--------|
| 1 | `apps/web/next.config.ts` | P0 | Security headers config |
| 2 | `apps/web/src/lib/db/schema.ts` | P1+F2 | Add `sync_state` table + 5 event tables + type exports |
| 3 | `apps/web/src/lib/db/index.ts` | P1 | Pool tuning (max=10, keepalive=30) |
| 4 | `apps/web/src/lib/api/validators.ts` | F1 | Add `bulkRecipientSchema`, `prepareCampaignRequestSchema` |
| 5 | `apps/web/src/app/api/campaigns/[treeAddress]/route.ts` | F3 | Add grace period fields to GET response |
| 6 | `apps/web/src/app/api/admin/sync/route.ts` | F2 | Call expanded event indexer |
| 7 | `apps/web/src/lib/indexer/claim-events.ts` | P1+F2 | Transactional indexing + all event types |
| 8 | `apps/web/src/app/api/campaigns/route.ts` | P0 | Add auth middleware + rate limiting |
| 9 | `apps/web/vercel.json` | F2 | Cron config for auto-sync |
| 10 | `apps/web/.env.example` | P2 | Document all env vars |

### Database Migrations

| # | File | Phase | Contents |
|---|------|-------|----------|
| 1 | `0003_rls_policies.sql` | P0 | RLS policies on all tables (existing + new) |
| 2 | `0004_event_tables.sql` | F2 | 5 event tables + `sync_state` + indexes |
| 3 | `0005_timeline_indexes.sql` | F2 | Indexes for timeline + vesting progress queries |

### SC Changes (Phase 2 only)

| # | File | Change |
|---|------|--------|
| 1 | `programs/vesting/src/errors.rs` | Add `UnsupportedMint` variant |
| 2 | `programs/vesting/src/instructions/create_campaign.rs` | Add mint owner program check |
| 3 | `programs/vesting/src/instructions/create_stream.rs` | Add mint owner program check |
