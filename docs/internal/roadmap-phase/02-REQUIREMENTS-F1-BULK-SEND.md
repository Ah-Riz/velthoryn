# Requirements: Bulk Send

**Phase:** F1 (Feature Phase 1)
**Depends on:** P0 (production-security-ops) -- auth, rate limiting, and error handling middleware must be in place
**Estimate:** 5 days

---

## Overview

The Bulk Send phase enables a Creator to set up vesting campaigns with up to one million recipients in a single operation. Today the Merkle tree must be built client-side before posting the full payload to the backend. This phase moves tree building and CSV-based recipient import to the server, so the Creator can upload a spreadsheet or submit a recipient list and receive verified Merkle proofs without running any client-side cryptography. A TypeScript schedule-math library is also introduced so that off-chain vesting calculations (needed by later phases) produce identical results to the on-chain Rust program.

---

## Theme 1: Server-Side Merkle Tree Building

### US-1.1 -- As a Creator, I want the server to build the Merkle tree from my recipient list, so that I do not need to run tree-building code in the browser.

**Acceptance Criteria:**

- **GIVEN** a valid authenticated request with a recipients array (1 to 1,000,000 entries), a mint address, a creator address, and a campaign ID
- **WHEN** the request is sent to the prepare endpoint
- **THEN** the server returns a response containing: a tree address (PDA), a 64-character hex Merkle root, the leaf count, the total supply (sum of all amounts), and every leaf with its index, beneficiary, amount, release type, schedule timestamps, milestone index, and a Merkle proof

- **GIVEN** a request body exceeding 2 MB
- **WHEN** the request is sent to the prepare endpoint
- **THEN** the server rejects it with a 413 status and a clear error message

- **GIVEN** a request with zero recipients or more than 1,000,000 recipients
- **WHEN** the request is sent to the prepare endpoint
- **THEN** the server rejects it with a 400 status

### US-1.2 -- As a Creator, I want the prepared data to be returned without persisting to the database, so that I can review it before committing on-chain.

**Acceptance Criteria:**

- **GIVEN** a successful prepare call
- **WHEN** the response is returned
- **THEN** no row has been written to the campaigns, root_versions, or leaves tables in the database

- **GIVEN** a successful prepare call
- **WHEN** the Creator reviews the returned leaves and proofs
- **THEN** each proof is a valid Merkle proof from its leaf to the returned root, verifiable by the existing leaf-verification logic

### US-1.3 -- As a Creator, I want numeric amounts returned as strings, so that large token amounts are not corrupted by JavaScript floating-point precision.

**Acceptance Criteria:**

- **GIVEN** a prepare request where one or more recipients have amounts exceeding 2^53
- **WHEN** the response is returned
- **THEN** every amount and the totalSupply field are serialized as decimal strings, not JSON numbers

---

## Theme 2: CSV Import and Validation

### US-2.1 -- As a Creator, I want to upload a CSV file of recipients, so that I can set up a large campaign from a spreadsheet without manually constructing JSON.

**Acceptance Criteria:**

- **GIVEN** a valid authenticated multipart request with a CSV file whose first row is the header `beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx` and subsequent rows contain valid data
- **WHEN** the request is sent to the import endpoint
- **THEN** the server returns a 200 response with the parsed recipients array, totalRows count, validRows count, and an empty errors array

- **GIVEN** a CSV file larger than 10 MB
- **WHEN** the request is sent to the import endpoint
- **THEN** the server rejects it with a 413 status

### US-2.2 -- As a Creator, I want to see per-row validation errors when my CSV contains problems, so that I can fix only the bad rows instead of guessing what went wrong.

**Acceptance Criteria:**

- **GIVEN** a CSV with 10 rows where row 5 has an invalid beneficiary address and row 8 has a negative amount
- **WHEN** the import endpoint processes the file
- **THEN** the response contains 8 valid recipients, an errors array with 2 entries, each error including the row number, the field that failed, and a human-readable message

- **GIVEN** a CSV where every row is invalid
- **WHEN** the import endpoint processes the file
- **THEN** the server returns a 400 status with the full errors array and zero valid recipients

- **GIVEN** a CSV with no header row
- **WHEN** the import endpoint processes the file
- **THEN** the server returns a 400 status with an error indicating the header is missing or malformed

### US-2.3 -- As a Creator, I want to import the validated CSV recipients into the prepare endpoint, so that I can go from spreadsheet to Merkle tree in two steps.

**Acceptance Criteria:**

- **GIVEN** a successful import response with valid recipients
- **WHEN** the Creator posts those recipients to the prepare endpoint
- **THEN** the prepare endpoint accepts the data and returns a full tree with proofs, the same as if the recipients had been submitted via JSON

---

## Theme 3: Bulk Input Validation

### US-3.1 -- As a Creator, I want the server to reject invalid schedule parameters before building the tree, so that I get a clear error instead of a broken on-chain campaign.

**Acceptance Criteria:**

- **GIVEN** a recipient with startTime > cliffTime
- **WHEN** the request is validated
- **THEN** the server rejects it with a 400 status and a message stating "startTime must be less than or equal to cliffTime"

- **GIVEN** a recipient with cliffTime > endTime
- **WHEN** the request is validated
- **THEN** the server rejects it with a 400 status and a message stating "cliffTime must be less than or equal to endTime"

- **GIVEN** a recipient with amount of zero or a negative number
- **WHEN** the request is validated
- **THEN** the server rejects it with a 400 status

- **GIVEN** a recipient with a releaseType value other than 0, 1, or 2
- **WHEN** the request is validated
- **THEN** the server rejects it with a 400 status

- **GIVEN** a recipient with a beneficiary address that is not valid base58
- **WHEN** the request is validated
- **THEN** the server rejects it with a 400 status

### US-3.2 -- As a Creator, I want to include the same beneficiary more than once in a campaign (with different leaves), so that I can grant multiple vesting schedules to one person.

**Acceptance Criteria:**

- **GIVEN** a prepare request with two recipients sharing the same beneficiary address but different amounts or schedules
- **WHEN** the tree is built
- **THEN** both recipients appear as separate leaves with separate proofs and the request succeeds

### US-3.3 -- As a Creator, I want cancellable campaigns to require a cancel authority, so that I cannot accidentally create a cancellable campaign with no one authorized to cancel it.

**Acceptance Criteria:**

- **GIVEN** a prepare request with cancellable set to true and cancelAuthority omitted or null
- **WHEN** the request is validated
- **THEN** the server rejects it with a 400 status and a message stating that cancellable campaigns require a cancelAuthority

---

## Theme 4: Off-Chain Schedule Math

### US-4.1 -- As a Beneficiary (or frontend displaying my data), I want the server to calculate my vested amount off-chain identically to the on-chain program, so that the dashboard shows accurate progress without requiring a blockchain read.

**Acceptance Criteria:**

- **GIVEN** a cliff schedule (releaseType 0) with amount 1000 and cliffTime 100
- **WHEN** the vested amount is calculated at timestamp 99
- **THEN** the result is 0

- **GIVEN** the same cliff schedule
- **WHEN** the vested amount is calculated at timestamp 100
- **THEN** the result is 1000

- **GIVEN** a linear schedule (releaseType 1) with amount 1000, cliffTime 100, endTime 200
- **WHEN** the vested amount is calculated at timestamp 150 (midpoint)
- **THEN** the result is 500

- **GIVEN** a linear schedule with amount 10000, cliffTime 1000, endTime 2000
- **WHEN** the vested amount is calculated at timestamp 1250 (quarter elapsed)
- **THEN** the result is 2500

- **GIVEN** a linear schedule with the maximum u64 amount (18446744073709551615) and a long duration
- **WHEN** the vested amount is calculated at the midpoint
- **THEN** the result is approximately half without integer overflow

- **GIVEN** a linear schedule where cliffTime equals endTime (degenerate case)
- **WHEN** the vested amount is calculated at cliffTime
- **THEN** the result is the full amount

### US-4.2 -- As a Beneficiary of a cancelled campaign, I want the server to cap vesting calculations at the cancellation time, so that I see only the tokens I was entitled to when the campaign was cancelled.

**Acceptance Criteria:**

- **GIVEN** a linear schedule (amount 1000, cliffTime 100, endTime 200) and a cancellation time of 150
- **WHEN** the vested amount is calculated at current time 999 (long after cancellation)
- **THEN** the result is 500, matching the on-chain get_vested_amount behavior

- **GIVEN** the same schedule with no cancellation
- **WHEN** the vested amount is calculated at current time 999
- **THEN** the result is 1000

---

## Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-1 | Prepare endpoint latency for 100 recipients | Under 2 seconds |
| NFR-2 | CSV import latency for 1,000 rows | Under 5 seconds |
| NFR-3 | Schedule math parity | All test inputs produce identical outputs to the Rust schedule.rs reference implementation |
| NFR-4 | Authentication | Both prepare and import endpoints require wallet-signature authentication from P0 middleware |
| NFR-5 | Rate limiting | Prepare endpoint: 10 requests per minute per wallet; Import endpoint: 5 requests per minute per wallet |
| NFR-6 | BigInt serialization | Every BigInt value in any API response is serialized as a decimal string, never as a JSON number |
| NFR-7 | No regression | All 86 on-chain tests continue to pass; all existing backend tests continue to pass |

---

## Dependencies

| Dependency | Provider | Status |
|------------|----------|--------|
| P0 auth middleware (wallet-signature verification) | P0 Security Gate | Must be complete |
| P0 rate-limit middleware | P0 Security Gate | Must be complete |
| P0 error-handler middleware | P0 Security Gate | Must be complete |
| P0 structured logger | P0 Security Gate | Must be complete |
| Merkle tree builder (`prepareCampaign` in clients/ts) | TS SDK | Already complete |
| Leaf verification (`verifyAllLeaves` in apps/web) | Existing | Already complete |
| Solana web3.js and BN.js | Runtime deps | Already installed |

---

## Out of Scope

- On-chain transaction building for create_campaign or fund_campaign (the frontend handles these via the wallet adapter)
- Persistent storage of imported CSV files (processed in memory, not saved to disk or object storage)
- Schedule template presets (deferred to F4)
- Vesting simulation endpoint (deferred to F4)
- Campaign status webhooks or notifications (deferred to F2)
- Event indexing for non-Claimed event types (deferred to F2)
- Grace period calculations or clawback endpoints (deferred to F3)
- Frontend UI changes (this phase defines API contracts only)
