# Requirements: Clawback API

**Phase:** F3 (Feature Phase 3)
**Depends on:** `production-security-ops` (P0+P1), `dashboard-transparency` (F2.1 event tables)
**Estimate:** 4 days
**Status:** Not started

---

## Overview

The Clawback API provides unsigned-transaction endpoints for campaign cancellation, unvested token withdrawal, single-stream cancellation, and milestone release. When a campaign is canceled, already-vested tokens remain accessible to beneficiaries while the remainder returns to the creator after a seven-day grace period. All mutation endpoints return unsigned transactions that the frontend or wallet must sign and submit — the backend never holds private keys.

---

## Theme 1: Grace Period Countdown Visibility

### US-1.1 — Grace period info in campaign detail

**As a** Creator, **I want to** see the grace period countdown for a cancelled campaign, **so that** I know exactly when I can withdraw unvested tokens.

- **GIVEN** a campaign exists with `cancelledAt` set to a unix timestamp
- **WHEN** the campaign detail endpoint is called
- **THEN** the response includes a `gracePeriod` object with three fields: `end` (cancelled_at + 604800 as a string), `remaining` (seconds until grace period expires, floored at zero, as a string), and `isExpired` (boolean, true when current time is at or past `end`)

- **GIVEN** a campaign exists with `cancelledAt` set to a value 3 days ago
- **WHEN** the campaign detail endpoint is called
- **THEN** `gracePeriod.remaining` equals the seconds remaining in the 7-day window (approximately 4 days worth of seconds)
- **AND** `gracePeriod.isExpired` is `false`

- **GIVEN** a campaign exists with `cancelledAt` set to a value 8 days ago
- **WHEN** the campaign detail endpoint is called
- **THEN** `gracePeriod.remaining` equals `"0"`
- **AND** `gracePeriod.isExpired` is `true`

- **GIVEN** a campaign exists that has not been cancelled (`cancelledAt` is null)
- **WHEN** the campaign detail endpoint is called
- **THEN** the response includes `gracePeriod: null`

### US-1.2 — Grace period uses SC-constant duration

**As a** Developer, **I want** the grace period duration to match the smart contract constant, **so that** on-chain and off-chain grace period calculations never diverge.

- **GIVEN** the smart contract defines `GRACE_PERIOD_SECS = 604800` (7 * 24 * 60 * 60)
- **WHEN** the backend calculates grace period end
- **THEN** it uses exactly 604800 seconds as the offset from `cancelledAt`

---

## Theme 2: Cancel Campaign (Unsigned TX Building)

### US-2.1 — Build cancel campaign transaction

**As a** Creator, **I want to** request an unsigned transaction for cancelling a campaign, **so that** I can sign and submit it from my wallet without exposing my private key to the server.

- **GIVEN** a campaign exists that is cancellable, not already cancelled, and not fully vested
- **WHEN** an authenticated POST request is sent to the cancel endpoint with the cancel authority's public key
- **THEN** the response contains a `transaction` field with a base58-encoded serialized transaction
- **AND** the response contains a `signers` array listing the required signer labels (which must include `"cancelAuthority"`)
- **AND** the response contains an `instruction` field set to `"cancel_campaign"`
- **AND** the response contains an `accounts` object with the vesting tree address and cancel authority address

### US-2.2 — Reject cancel for non-cancellable campaign

**As a** Creator, **I want** cancel requests to be rejected for non-cancellable campaigns, **so that** I receive a clear error rather than a transaction that will fail on-chain.

- **GIVEN** a campaign exists with `cancellable` set to `false`
- **WHEN** a POST request is sent to the cancel endpoint
- **THEN** the response has HTTP status 400
- **AND** the response body contains an error code `NOT_CANCELLABLE`

### US-2.3 — Reject cancel for already-cancelled campaign

**As a** Creator, **I want** cancel requests to be rejected if the campaign is already cancelled, **so that** I avoid submitting a transaction that would fail on-chain.

- **GIVEN** a campaign exists with `cancelledAt` set to a non-null value
- **WHEN** a POST request is sent to the cancel endpoint
- **THEN** the response has HTTP status 400
- **AND** the response body contains an error code `ALREADY_CANCELLED`

### US-2.4 — Reject cancel for fully vested campaign

**As a** Creator, **I want** cancel requests to be rejected if the campaign is fully vested, **so that** I am not charged gas for a transaction that would fail.

- **GIVEN** a campaign exists where `totalClaimed` equals `totalSupply`
- **WHEN** a POST request is sent to the cancel endpoint
- **THEN** the response has HTTP status 400
- **AND** the response body contains an error code `FULLY_VESTED`

### US-2.5 — Reject cancel from unauthorized signer

**As an** Admin, **I want** cancel requests to be rejected when the signer is not the campaign's cancel authority, **so that** only the designated authority can cancel a campaign.

- **GIVEN** a campaign exists with a specific `cancelAuthority`
- **WHEN** a POST request is sent with a signer whose public key does not match `cancelAuthority`
- **THEN** the response has HTTP status 403
- **AND** the response body contains an error code indicating authorization failure

### US-2.6 — Reject cancel for nonexistent campaign

**As a** Creator, **I want** cancel requests for a nonexistent campaign to return 404, **so that** I know the campaign address is wrong.

- **GIVEN** no campaign exists for the provided tree address
- **WHEN** a POST request is sent to the cancel endpoint
- **THEN** the response has HTTP status 404

---

## Theme 3: Withdraw Unvested Tokens (After Grace Period)

### US-3.1 — Build withdraw unvested transaction

**As a** Creator, **I want to** request an unsigned transaction for withdrawing unvested tokens from a cancelled campaign's vault, **so that** I can recover remaining tokens after the grace period expires.

- **GIVEN** a campaign exists that is cancelled (`cancelledAt` is set) and the grace period has expired
- **WHEN** an authenticated POST request is sent to the withdraw-unvested endpoint with the creator's public key and creator's associated token account
- **THEN** the response contains a `transaction` field with a base58-encoded serialized transaction
- **AND** the response contains a `signers` array listing `"creator"` as a required signer
- **AND** the response contains an `instruction` field set to `"withdraw_unvested"`
- **AND** the response contains an `accounts` object with the vesting tree, vault, and creator ATA addresses

### US-3.2 — Reject withdraw before grace period expiry

**As a** Beneficiary, **I want** withdraw requests to be rejected during the grace period, **so that** I have 7 days after cancellation to claim any vested tokens before the creator sweeps the remainder.

- **GIVEN** a campaign exists that is cancelled and the grace period has not yet expired
- **WHEN** a POST request is sent to the withdraw-unvested endpoint
- **THEN** the response has HTTP status 400
- **AND** the response body contains an error code `GRACE_PERIOD_ACTIVE`

### US-3.3 — Reject withdraw for non-cancelled campaign

**As a** Creator, **I want** withdraw requests to be rejected if the campaign is not cancelled, **so that** I cannot accidentally sweep tokens from an active campaign.

- **GIVEN** a campaign exists that is not cancelled (`cancelledAt` is null)
- **WHEN** a POST request is sent to the withdraw-unvested endpoint
- **THEN** the response has HTTP status 400
- **AND** the response body contains an error code `NOT_CANCELLED`

### US-3.4 — Reject withdraw from non-creator signer

**As an** Admin, **I want** withdraw requests to be rejected when the signer is not the campaign's creator, **so that** only the creator can sweep unvested tokens.

- **GIVEN** a cancelled campaign with an expired grace period
- **WHEN** a POST request is sent with a signer whose public key does not match the campaign's `creator`
- **THEN** the response has HTTP status 403
- **AND** the response body contains an error code indicating authorization failure

### US-3.5 — Reject withdraw for nonexistent campaign

**As a** Creator, **I want** withdraw requests for a nonexistent campaign to return 404.

- **GIVEN** no campaign exists for the provided tree address
- **WHEN** a POST request is sent to the withdraw-unvested endpoint
- **THEN** the response has HTTP status 404

---

## Theme 4: Cancel Single Stream (Atomic Split)

### US-4.1 — Build cancel stream transaction

**As a** Creator, **I want to** request an unsigned transaction for cancelling a single-recipient stream, **so that** vested tokens go to the beneficiary and the remainder returns to me in one atomic operation.

- **GIVEN** a campaign exists with `leafCount` equal to 1, is cancellable, and is not already cancelled or fully vested
- **WHEN** an authenticated POST request is sent to the cancel-stream endpoint with the creator's public key, beneficiary's public key, the withdrawal schedule arguments (release type, start time, cliff time, end time, milestone index), and both beneficiary and creator associated token accounts
- **THEN** the response contains a `transaction` field with a base58-encoded serialized transaction
- **AND** the response contains a `signers` array listing `"creator"` as a required signer
- **AND** the response contains an `instruction` field set to `"cancel_stream"`
- **AND** the response contains an `accounts` object with the relevant account addresses

### US-4.2 — Reject cancel stream for multi-recipient campaign

**As a** Creator, **I want** cancel-stream requests to be rejected for campaigns with more than one recipient, **so that** I am forced to use the campaign-wide cancel path instead.

- **GIVEN** a campaign exists with `leafCount` greater than 1
- **WHEN** a POST request is sent to the cancel-stream endpoint
- **THEN** the response has HTTP status 400
- **AND** the response body contains an error code `NOT_SINGLE_STREAM`

### US-4.3 — Reject cancel stream for non-cancellable campaign

**As a** Creator, **I want** cancel-stream requests to be rejected for non-cancellable campaigns.

- **GIVEN** a single-recipient campaign with `cancellable` set to `false`
- **WHEN** a POST request is sent to the cancel-stream endpoint
- **THEN** the response has HTTP status 400
- **AND** the response body contains an error code `NOT_CANCELLABLE`

### US-4.4 — Reject cancel stream for already-cancelled campaign

**As a** Creator, **I want** cancel-stream requests to be rejected if the campaign is already cancelled.

- **GIVEN** a single-recipient campaign with `cancelledAt` set
- **WHEN** a POST request is sent to the cancel-stream endpoint
- **THEN** the response has HTTP status 400
- **AND** the response body contains an error code `ALREADY_CANCELLED`

### US-4.5 — Reject cancel stream from non-creator signer

**As an** Admin, **I want** cancel-stream requests to be rejected when the signer is not the campaign's creator.

- **GIVEN** a single-recipient cancellable campaign
- **WHEN** a POST request is sent with a signer whose public key does not match the campaign's `creator`
- **THEN** the response has HTTP status 403
- **AND** the response body contains an error code indicating authorization failure

### US-4.6 — Validate withdrawal schedule arguments

**As a** Creator, **I want** invalid schedule arguments to be rejected before transaction building, **so that** I get a clear error rather than an on-chain failure.

- **GIVEN** a POST request to the cancel-stream endpoint where `startTime` is greater than `cliffTime`
- **WHEN** the request is processed
- **THEN** the response has HTTP status 400
- **AND** the response body contains an error code indicating an invalid schedule

- **GIVEN** a POST request to the cancel-stream endpoint where `releaseType` is not 0, 1, or 2
- **WHEN** the request is processed
- **THEN** the response has HTTP status 400
- **AND** the response body contains an error code indicating an invalid schedule type

---

## Theme 5: Milestone Release (Creator Flag)

### US-5.1 — Build milestone release transaction

**As a** Creator, **I want to** request an unsigned transaction for releasing a milestone, **so that** milestone-type beneficiaries can claim their tokens after I approve the milestone.

- **GIVEN** a campaign exists and a valid milestone index (0-255) is provided for a milestone that has not yet been released
- **WHEN** an authenticated POST request is sent to the milestone release endpoint with the creator's public key
- **THEN** the response contains a `transaction` field with a base58-encoded serialized transaction
- **AND** the response contains a `signers` array listing `"creator"` as a required signer
- **AND** the response contains an `instruction` field set to `"set_milestone_released"`
- **AND** the response contains an `accounts` object with the vesting tree and creator addresses

### US-5.2 — Reject milestone release for already-released milestone

**As a** Creator, **I want** milestone release requests to be rejected if the milestone is already released, **so that** I do not submit a transaction that would fail on-chain.

- **GIVEN** a campaign where milestone index N has already been released
- **WHEN** a POST request is sent to release milestone N
- **THEN** the response has HTTP status 400
- **AND** the response body contains an error code `MILESTONE_ALREADY_RELEASED`

### US-5.3 — Reject milestone release for invalid index

**As a** Creator, **I want** milestone release requests to be rejected for invalid milestone indices.

- **GIVEN** a POST request with a milestone index that is not an integer or is outside the range 0-255
- **WHEN** the request is processed
- **THEN** the response has HTTP status 400

### US-5.4 — Reject milestone release from non-creator signer

**As an** Admin, **I want** milestone release requests to be rejected when the signer is not the campaign's creator.

- **GIVEN** a campaign with a specific creator
- **WHEN** a POST request is sent with a signer whose public key does not match the creator
- **THEN** the response has HTTP status 403
- **AND** the response body contains an error code indicating authorization failure

---

## Theme 6: TX Builder Utility

### US-6.1 — Unsigned transaction construction

**As a** Developer, **I want** a shared utility that constructs unsigned Solana transactions from Anchor instructions, **so that** all clawback endpoints produce consistently formatted, ready-to-sign transactions.

- **GIVEN** one or more Anchor transaction instructions and a list of required signers
- **WHEN** the transaction builder is invoked
- **THEN** it returns a prepared transaction containing a base58-encoded serialized transaction, the list of required signer labels, the instruction name, and the account addresses involved
- **AND** the serialized transaction includes a recent blockhash
- **AND** the transaction is valid for signing (not fully serialized with signatures)

### US-6.2 — Blockhash freshness

**As a** Developer, **I want** the transaction builder to use a fresh blockhash for each request, **so that** transactions do not expire before the user signs them.

- **GIVEN** a request to build a transaction
- **WHEN** the builder fetches a blockhash
- **THEN** it calls the Solana RPC for the latest blockhash at the time of the request
- **AND** the response documentation notes that the transaction should be signed and submitted within 30 seconds

### US-6.3 — PDA derivation helpers

**As a** Developer, **I want** the transaction builder to provide PDA derivation helpers, **so that** all endpoints derive PDAs consistently without duplicating logic.

- **GIVEN** the transaction builder utility
- **WHEN** a PDA derivation helper is called with the appropriate seeds (creator, mint, campaign_id for vesting tree; vesting tree for vault authority; vesting tree + beneficiary for claim record)
- **THEN** it returns the correct PDA address matching the on-chain derivation

---

## Non-Functional Requirements

### NFR-1 — Rate limiting

All mutation endpoints (cancel, withdraw-unvested, cancel-stream, milestone release) enforce a rate limit of 10 requests per minute per identity.

### NFR-2 — Authentication

All mutation endpoints require wallet-signature authentication. Requests without valid authentication receive HTTP 401.

### NFR-3 — BigInt serialization

All numeric values that may exceed JavaScript's safe integer range (specifically `end`, `remaining`, and any on-chain amounts) are returned as strings, not numbers, in JSON responses.

### NFR-4 — Idempotent validation

The backend validates campaign state before building any transaction. If the campaign state does not permit the operation, the backend returns a descriptive error with a specific error code rather than building a transaction that would fail on-chain.

### NFR-5 — No private keys on server

The backend never generates, receives, or stores private keys. All mutation endpoints return unsigned transactions. The wallet on the client side is responsible for signing and broadcasting.

---

## Dependencies

| Dependency | Type | Reason |
|------------|------|--------|
| P0+P1 Security and Ops | Hard block | Auth middleware, rate limiting, structured error responses must exist before new endpoints are added |
| F2.1 Event tables | Hard block | The `withdraw_events` table is needed to track unvested withdrawal events |
| Anchor IDL and program ID | Configuration | The backend must have access to the compiled IDL and program address to build Anchor instructions |
| Solana RPC endpoint | Infrastructure | The backend requires a Solana RPC connection for blockhash fetching and PDA resolution |
| Campaigns DB table | Data | All endpoints read campaign state from the existing `campaigns` table |

---

## Out of Scope

- **Automatic execution of cancel or withdraw operations.** The backend never submits transactions on-chain. All operations require wallet signing.
- **Grace period email or webhook notifications.** Notifications when the grace period starts or expires are deferred to P2.
- **Grace period expiry cron job.** Automated checking for grace period expiry is a separate concern.
- **Frontend UI for clawback flows.** This spec covers the backend API only. Frontend integration is a separate work item.
- **Pause or unpause endpoints.** Campaign pause/unpause transaction building is not part of this phase.
- **Root rotation (update_root) endpoint.** Merkle root rotation is an existing feature, not part of the clawback scope.
