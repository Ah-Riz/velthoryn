# Design: Bulk Send

**Spec:** `bulk-send`
**Phase:** F1 (Feature Phase 1)
**Depends on:** `production-security-ops` (P0 must be done)
**Estimate:** 5 days
**Owner:** Lana (BE lead)

---

## Context

The SC already supports unlimited-recipient campaigns via `create_campaign` + `fund_campaign`. The TS SDK (`clients/ts/src/prepare.ts`) builds Merkle trees and generates proofs. But the FE currently must run tree-building client-side and POST the full payload. This spec adds server-side tree building and CSV import so the BE can handle the full bulk-send workflow.

**User need:** 5/8 users ranked automation first. Projects set up campaign once → recipients pull tokens → program enforces schedule.

**Source:** `docs/GAP-ANALYSIS-ROADMAP.md` — Feature 1: Bulk Send.

---

## Architecture

### Data flow (after this spec)

```
Option A: JSON API
  Client → POST /api/campaigns/prepare { recipients[], config }
    → prepareCampaign() builds tree + proofs
    → Returns { merkleRoot, leaves[], totalSupply }
  Client → POST /api/campaigns { prepared data }
    → Verify proofs, persist to DB
  Client → create_campaign on-chain (SC tx)
  Client → fund_campaign on-chain (SC tx)

Option B: CSV import
  Client → POST /api/campaigns/import (multipart CSV)
    → Parse CSV, validate rows
    → Returns validated recipients (or errors)
  Client → POST /api/campaigns/prepare { validated recipients }
    → Same as Option A step 1
  ... rest same as Option A
```

### Key change: server-side tree building

The `prepareCampaign` function from `clients/ts/src/prepare.ts` will be callable from the BE route handler. This requires importing the `clients/ts` package into `apps/web`.

**Approach:** Add `clients/ts` as a workspace dependency in `apps/web/package.json`:
```json
{
  "dependencies": {
    "@velthoryn/merkle": "workspace:*"
  }
}
```

This gives `apps/web` direct access to `prepareCampaign`, `VestingMerkleTree`, and `VestingLeaf`.

### Schedule math mirror

A TS implementation of `schedule.rs` for off-chain vesting calculations. Needed by:
- Vesting progress endpoint (F2)
- Vesting simulation endpoint (F4)
- Dashboard display (FE)

File: `apps/web/src/lib/vesting/schedule.ts`

```typescript
export type ReleaseType = 0 | 1 | 2; // Cliff | Linear | Milestone

export interface VestingSchedule {
  amount: bigint;
  releaseType: ReleaseType;
  startTime: bigint;
  cliffTime: bigint;
  endTime: bigint;
}

export function vested(schedule: VestingSchedule, now: bigint): bigint;
export function getVestedAmount(schedule: VestingSchedule, cancelledAt: bigint | null, now: bigint): bigint;
```

Mirrors `programs/vesting/src/math/schedule.rs` exactly. Same `u128` intermediate math for linear vesting (using `BigInt` in TS).

---

## API Design

### `POST /api/campaigns/prepare`

**Auth:** Wallet signature (from P0)
**Rate limit:** 10/min

Request:
```json
{
  "recipients": [
    {
      "beneficiary": "base58_address",
      "amount": "1000000",
      "releaseType": 0,
      "startTime": "1700000000",
      "cliffTime": "1731536000",
      "endTime": "1731536000",
      "milestoneIdx": 0
    }
  ],
  "mint": "base58_mint",
  "creator": "base58_creator",
  "campaignId": 1,
  "cancellable": true,
  "cancelAuthority": "base58_or_null",
  "pauseAuthority": "base58_or_null",
  "metadata": { "name": "Campaign Name" }
}
```

Response (200):
```json
{
  "treeAddress": "base58_pda",
  "merkleRoot": "64_char_hex",
  "leafCount": 100,
  "totalSupply": "1000000000",
  "leaves": [
    {
      "leafIndex": 0,
      "beneficiary": "base58",
      "amount": "1000000",
      "releaseType": 0,
      "startTime": "1700000000",
      "cliffTime": "1731536000",
      "endTime": "1731536000",
      "milestoneIdx": 0,
      "proof": [[...32 bytes], [...32 bytes], ...]
    }
  ]
}
```

Validation:
- `recipients` length: 1–1,000,000 (but max 2MB total request body)
- All `beneficiary` addresses valid base58
- All `amount` > 0
- All schedules: `startTime <= cliffTime <= endTime`
- All `releaseType`: 0, 1, or 2
- No duplicate beneficiaries (or allowed if amounts differ)

### `POST /api/campaigns/import`

**Auth:** Wallet signature (from P0)
**Rate limit:** 5/min
**Max body:** 10MB

Request: `multipart/form-data` with `file` field (CSV)

CSV format:
```csv
beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx
7xKXtg2CW87d97... ,1000000,0,1700000000,1731536000,1731536000,0
BxKXtg2CW87d98... ,2000000,1,1700000000,1700000000,1731536000,0
```

Response (200):
```json
{
  "recipients": [
    {
      "beneficiary": "7xKXtg2CW87d97...",
      "amount": "1000000",
      "releaseType": 0,
      "startTime": "1700000000",
      "cliffTime": "1731536000",
      "endTime": "1731536000",
      "milestoneIdx": 0,
      "row": 2
    }
  ],
  "totalRows": 2,
  "validRows": 2,
  "errors": []
}
```

Validation:
- Header row required with exact column names
- Each row validated individually
- Partial success: return valid rows + error details per row
- Duplicates: warn but don't reject (recipient can have multiple leaves)

---

## Key Decisions

### D1: Workspace dependency over code duplication

Import `clients/ts` as a workspace package instead of duplicating the Merkle builder in `apps/web`. This ensures parity by construction — one source of truth for tree building and proof generation.

### D2: Prepare does NOT persist to DB

`POST /api/campaigns/prepare` builds the tree and returns everything needed, but does NOT write to the DB. The caller must then:
1. Call `POST /api/campaigns` (persist to DB)
2. Call `create_campaign` on-chain
3. Call `fund_campaign` on-chain

This separation means the caller can validate the prepared data before committing. If the on-chain tx fails, no DB orphan.

### D3: CSV returns validated data, not prepared tree

`POST /api/campaigns/import` returns a clean recipient array. The caller then passes it to `/api/campaigns/prepare`. This two-step approach lets the user review the CSV data before building the tree.

### D4: Numeric strings for u64 amounts

All amounts in API are strings (not numbers) to avoid JavaScript Number precision loss for values > 2^53. This matches the existing `numericString` validator pattern in `validators.ts`.

---

## File Map

### New files

| File | Purpose |
|------|---------|
| `apps/web/src/app/api/campaigns/prepare/route.ts` | Server-side Merkle tree builder |
| `apps/web/src/app/api/campaigns/import/route.ts` | CSV import + validation |
| `apps/web/src/lib/vesting/schedule.ts` | TS schedule math mirror |
| `apps/web/tests/api/bulk-campaign.test.ts` | Bulk flow tests |
| `apps/web/tests/lib/vesting-schedule.test.ts` | Schedule math parity tests |

### Modified files

| File | Change |
|------|--------|
| `apps/web/src/lib/api/validators.ts` | Add `prepareCampaignRequestSchema`, `csvRowSchema`, `bulkRecipientSchema` |
| `apps/web/package.json` | Add `@velthoryn/merkle: "workspace:*"` dependency |

---

## Out of scope

- On-chain transaction building for `create_campaign` (FE handles via wallet adapter)
- CSV file storage (processed in memory, not persisted)
- Schedule templates (F4)
- Vesting simulation (F4)
