# SC Remediation & Pre-Launch Fixes — Requirements

**Phase:** 00 (Pre-requisite to P0)
**Blocks:** All other phases (P0, F1-F4, P2)
**Owner:** Lana (SC/BE lead)
**Estimate:** 2-3 days
**Source:** `docs/REMEDIATION_PLAN.md` — Lana's items only

---

## Overview

A pause+cancel exploit exists in the smart contract: `cancel_campaign` does not reset `paused` to `false`, so beneficiaries are locked out of claiming vested tokens during the grace period. Additionally, 4 mutating API routes have zero authentication, and on-chain documentation must be synchronized with actual repo state before any feature work proceeds.

---

## User Stories

### Theme 1: Pause+Cancel Exploit Fix

#### US-1.1 — Cancel resets paused state

**As a** Beneficiary, **I want** campaign cancellation to reset the paused flag, **so that** I can claim my vested tokens during the grace period even if the campaign was paused before cancellation.

- **GIVEN** a campaign is paused (`tree.paused == true`)
- **WHEN** the cancel authority calls `cancel_campaign`
- **THEN** the campaign's `paused` field is reset to `false`
- **AND** `cancelled_at` is set to the current timestamp

#### US-1.2 — Beneficiary can claim during grace after pause+cancel

**As a** Beneficiary, **I want** to claim my vested tokens during the grace period even if the campaign was paused before it was cancelled, **so that** the pause authority cannot use pause+cancel to lock me out of my vested portion.

- **GIVEN** a campaign was paused, then cancelled
- **WHEN** I submit a valid claim during the 7-day grace period
- **THEN** my claim succeeds and I receive my vested amount
- **AND** the vesting math uses `min(now, cancelled_at)` as the effective time

#### US-1.3 — Cancel after pause does not bypass cancel restrictions

**As a** Creator, **I want** the cancel flow to work the same regardless of whether the campaign is paused or not, **so that** all existing cancel validations (cancellable, not fully vested, correct authority) still apply.

- **GIVEN** a campaign is paused and cancellable
- **WHEN** the cancel authority calls `cancel_campaign`
- **THEN** all existing cancel constraints are enforced (cancellable, not already cancelled, not fully vested, correct authority)
- **AND** the paused state is cleared as a side effect

#### US-1.4 — Unpause after cancel is rejected

**As an** Admin, **I want** unpause attempts on a cancelled campaign to be rejected, **so that** the cancelled state is final.

- **GIVEN** a campaign has been cancelled (cancelled_at is set)
- **WHEN** someone attempts to unpause the campaign
- **THEN** the transaction is rejected with `CampaignCancelled`
- **AND** this is already enforced by the existing `cancelled_at.is_none()` constraint on `pause_campaign`

#### US-1.5 — withdraw.rs also handles pause+cancel correctly

**As a** Beneficiary, **I want** the single-stream `withdraw` instruction to also allow operations on cancelled campaigns regardless of pause state, **so that** the same exploit cannot be used against single-stream withdrawal.

- **GIVEN** a single-recipient campaign is paused then cancelled
- **WHEN** the beneficiary calls `withdraw` during the grace period
- **THEN** the withdraw succeeds with the vested amount
- **AND** the paused check does not block the operation when cancelled

---

### Theme 2: Regression Tests for Exploit Fix

#### US-2.1 — Pause then cancel then claim during grace

**As a** Developer, **I want** a test that exercises the exact exploit sequence (pause→cancel→claim), **so that** the fix is verified and cannot regress.

- **GIVEN** a campaign is paused
- **WHEN** the campaign is then cancelled and a beneficiary attempts to claim during grace
- **THEN** the claim succeeds and the beneficiary receives the correct vested amount
- **AND** the test passes with the fix applied

#### US-2.2 — Cancel resets paused field

**As a** Developer, **I want** a test that verifies `cancelled_at` and `paused` are set correctly after cancel on a paused campaign.

- **GIVEN** a campaign with `paused == true`
- **WHEN** `cancel_campaign` is called
- **THEN** the `VestingTree` account shows `cancelled_at == Some(now)` and `paused == false`

#### US-2.3 — Grace period claim for vested tokens preserved

**As a** Developer, **I want** a test that verifies the creator cannot sweep vested tokens during grace.

- **GIVEN** a paused+cancelled campaign where beneficiaries have vested tokens
- **WHEN** grace period expires and `withdraw_unvested` is called
- **THEN** the creator receives only unvested tokens
- **AND** vested tokens remain claimable by beneficiaries

#### US-2.4 — Existing test suite unchanged

**As a** Developer, **I want** all 86 existing tests to continue passing after the fix, **so that** no regression is introduced.

- **GIVEN** the fix is applied to `cancel_campaign.rs`
- **WHEN** `anchor test` runs
- **THEN** all 86 tests pass (87 minus 1 skipped)

---

### Theme 3: SC Test Verification

#### US-3.1 — Verify SC test matrix after fix

**As a** Developer, **I want** to re-run the full SC test suite (localnet + bankrun) after the exploit fix, **so that** I can confirm no regression.

- **GIVEN** the exploit fix is merged
- **WHEN** `pnpm test:localnet` and `anchor test` are run
- **THEN** all tests pass with updated count (87/87 if new tests added, or 86/86 if tests are added to existing count)

#### US-3.2 — Clock tests include pause+cancel scenario

**As a** Developer, **I want** the bankrun clock tests to include the pause+cancel+claim scenario with precise time manipulation, **so that** the grace period vesting math is verified at exact timestamps.

- **GIVEN** the clock test infrastructure exists
- **WHEN** a bankrun test exercises pause at T1, cancel at T2, claim at T2+3days
- **THEN** the vested amount at T2 is correctly calculated using the cancel clamp

---

### Theme 4: API Route Auth Support (Lana contribution)

#### US-4.1 — Define trust boundaries for on-chain-related routes

**As a** Developer (Lana), **I want** to define the correct auth/trust boundary for routes that mirror on-chain state, **so that** Geral can implement the correct protection.

- **GIVEN** the following routes write to DB and relate to on-chain state:
  - `POST /api/campaigns` — campaign creation (leaf verification + DB insert)
  - `POST /api/campaigns/[treeAddress]/root-versions` — root rotation
  - `PATCH /api/campaigns/[treeAddress]/status` — pause/cancel status update
  - `POST /api/claims/sync` — claim event indexing
- **WHEN** defining the trust boundary
- **THEN** each route has a documented auth policy:
  - `POST /api/campaigns`: wallet signature (creator proves ownership)
  - `POST /api/campaigns/[treeAddress]/root-versions`: wallet signature (creator or designated authority)
  - `PATCH /api/campaigns/[treeAddress]/status`: **route should be removed or replaced** — status changes must come from on-chain events via the indexer, not from direct DB writes
  - `POST /api/claims/sync`: admin key (existing pattern, acceptable)

---

## Non-Functional Requirements

- **No breaking changes to existing on-chain behavior.** The fix only changes what happens when cancel is called on a paused campaign. All other instruction paths are unchanged.
- **Backward compatible.** Campaigns created before the fix are unaffected — the fix only applies to future `cancel_campaign` calls.
- **Test count.** The test suite must not lose any existing tests. New tests are additive.
- **Documentation sync.** After code changes are verified, update on-chain documentation to reflect the fix.

---

## Dependencies

- **Anchor toolchain:** Fix requires `anchor build` + redeploy to devnet
- **Bankrun/Clock:** New clock tests use the existing bankrun infrastructure in `vesting.clock.spec.ts`
- **Geral's P0.2:** Lana defines trust boundaries (US-4.1), Geral implements auth enforcement
- **No dependency on P0 Security Gate:** This phase runs before P0

---

## Out of Scope

- Frontend changes (Geral's responsibility)
- Rate limiting, CORS, security headers (P0 Security Gate)
- Event indexing expansion (F2 Dashboard)
- API versioning (P2 Hardening)
- Native SOL cancel_stream known issue (separate fix)
- Token-2022 guard (F4+P2)
