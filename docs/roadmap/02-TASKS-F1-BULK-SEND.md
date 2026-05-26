# Tasks: Bulk Send

**Spec:** `bulk-send`
**Phase:** F1
**Depends on:** `production-security-ops` (P0)
**Prerequisite:** P0 middleware (auth + rate limit + errors + logger) available

---

## F1.1 — Add workspace Merkle dependency

- [x] In root `pnpm-workspace.yaml`, add `"clients/*"` to the packages list (currently only `apps/*`)
- [x] In `apps/web/package.json`, add:
  ```json
  "@velthoryn/client": "workspace:*"
  ```
  Note: the actual package name in `clients/ts/package.json` is `@velthoryn/client`, NOT `@velthoryn/merkle`
- [x] Run `pnpm install` from root
- [x] Verify `import { prepareCampaign } from "@velthoryn/client"` resolves in `apps/web`
- [x] **Verify:** `pnpm build` in `apps/web` succeeds with the workspace import

## F1.2 — TS schedule math mirror

- [x] Create `apps/web/src/lib/vesting/schedule.ts`
  - Export `ReleaseType = 0 | 1 | 2` (Cliff, Linear, Milestone)
  - Export `VestingSchedule` interface: `{ amount: bigint, releaseType: ReleaseType, startTime: bigint, cliffTime: bigint, endTime: bigint }`
  - Export `vested(schedule, now: bigint): bigint`
    - Cliff (0): return `amount` if `now >= cliffTime`, else `0n`
    - Linear (1): if `now >= endTime` return `amount`; if `now <= cliffTime` return `0n`; else `(amount * elapsed) / duration` using BigInt
    - Milestone (2): return `amount` if `now >= cliffTime`, else `0n`
  - Export `getVestedAmount(schedule, cancelledAt: bigint | null, now: bigint): bigint`
    - `effectiveNow = cancelledAt !== null ? min(now, cancelledAt) : now`
    - Return `vested(schedule, effectiveNow)`
  - **Must match Rust exactly** — same formulas, same edge cases
- [x] **Verify:** Unit tests with same inputs as Rust `schedule.rs` tests produce identical outputs

## F1.3 — Schedule math parity tests

- [x] Create `apps/web/tests/lib/vesting-schedule.test.ts`
  - Test: cliff before → 0, cliff after → full amount
  - Test: linear at cliff → 0, linear at end → full amount, linear at midpoint → half
  - Test: linear quarter (same as Rust `linear_quarter` test)
  - Test: linear no overflow at max amount (`BigInt("18446744073709551615")`)
  - Test: linear degenerate cliff == end
  - Test: cancel clamp (`getVestedAmount` with `cancelledAt` caps `effectiveNow`)
  - Test: milestone before cliff → 0, after → full
  - All values use `BigInt` / string representation
- [x] **Verify:** All test outputs match Rust `schedule.rs` test outputs exactly

## F1.4 — Validators for bulk operations

- [x] Update `apps/web/src/lib/api/validators.ts`
  - Add `bulkRecipientSchema`:
    ```typescript
    z.object({
      beneficiary: base58String,
      amount: numericString,
      releaseType: z.number().int().min(0).max(2),
      startTime: numericString,
      cliffTime: numericString,
      endTime: numericString,
      milestoneIdx: z.number().int().min(0).default(0),
    }).refine(
      (r) => BigInt(r.startTime) <= BigInt(r.cliffTime) && BigInt(r.cliffTime) <= BigInt(r.endTime),
      "startTime must be <= cliffTime must be <= endTime"
    );
    ```
  - Add `prepareCampaignRequestSchema`:
    ```typescript
    z.object({
      recipients: z.array(bulkRecipientSchema).min(1).max(1000000),
      mint: base58String,
      creator: base58String,
      campaignId: z.number().int().min(0),
      cancellable: z.boolean().default(false),
      cancelAuthority: base58String.nullable().default(null),
      pauseAuthority: base58String.nullable().default(null),
      metadata: campaignMetadataSchema.optional(),
    }).refine(
      (d) => !d.cancellable || d.cancelAuthority !== null,
      "Cancellable campaigns require cancelAuthority"
    );
    ```
  - Add `csvRowSchema` (same as `bulkRecipientSchema` but with `row: z.number()` field for error tracking)
- [x] **Verify:** Invalid recipient (negative amount, bad schedule) fails validation; valid recipient passes

## F1.5 — Server-side tree builder endpoint

- [x] Create `apps/web/src/app/api/campaigns/prepare/route.ts`
  - `POST /api/campaigns/prepare` (auth + rate limit: 10/min)
  - Parse + validate request with `prepareCampaignRequestSchema`
  - Convert recipients to `CampaignRecipient[]` format
  - Call `prepareCampaign(recipients)` from `@velthoryn/client`
  - Compute `treeAddress` PDA: `derivePda(["tree", creator, mint, campaignId.toLeBytes()])`
  - Return response with all leaves + proofs + merkleRoot + leafCount + totalSupply
  - All BigInt values serialized as strings
  - Wrap with `withRoute({ auth: true, rateLimit: { requests: 10, window: 60 }, bodyLimit: "campaigns" }, handler)`
- [x] **Verify:** POST with 10 recipients returns tree with 10 leaves, valid root, and correct proofs for each leaf

## F1.6 — CSV import endpoint

- [x] Create `apps/web/src/app/api/campaigns/import/route.ts`
  - `POST /api/campaigns/import` (auth + rate limit: 5/min, max body: 10MB)
  - Parse `multipart/form-data` using Next.js built-in `request.formData()`
  - Extract `file` field, read as text
  - Parse CSV: header row required, split by comma, trim whitespace
  - Validate each row with `csvRowSchema`
  - Collect valid rows + error details per row
  - Return `{ recipients: validRows[], totalRows, validRows, errors: [{ row, field, message }] }`
  - If zero valid rows, return 400 with all errors
- [x] **Verify:** Valid CSV with 10 rows returns 10 recipients. CSV with 1 invalid row returns 9 valid + 1 error. Empty CSV returns 400.

## F1.7 — Bulk flow integration tests

- [x] Create `apps/web/tests/api/bulk-campaign.test.ts`
  - Test: 10-recipient prepare → verify root + proofs
  - Test: 100-recipient prepare → verify all proofs valid
  - Test: Mixed release types in one campaign (cliff + linear + milestone)
  - Test: Invalid schedule (start > end) → 400
  - Test: Duplicate beneficiary → allowed (different leaves)
  - Test: Zero amount → 400
  - Test: CSV import with valid data → 200
  - Test: CSV import with invalid beneficiary → error on that row, rest valid
  - Test: CSV import with missing header → 400
  - Test: CSV import with empty body → 400
- [x] All tests pass in CI

---

## Cursor Guardrails

Before marking any task complete, verify:
- [x] Route uses `withRoute()` wrapper (not manual middleware chain)
- [x] All responses use `jsonResponse()` (not `NextResponse.json()`)
- [x] Request body validated with Zod schema (not manual `request.json()` + type checks)
- [x] Multi-step DB writes wrapped in `db.transaction()`
- [x] No read-then-write outside transaction (SELECT then INSERT must be same tx)
- [x] No dead code — every new file is imported somewhere
- [x] Errors thrown as `AppError` subclasses (never raw `NextResponse.json()`)
- [x] BigInt values are strings in all responses (automatic with `jsonResponse()`)
- [x] New DB tables have RLS policies in migration

## Verification checklist

- [x] `pnpm test` passes in `apps/web/` (existing + new tests)
- [ ] `pnpm test:localnet` passes (86/86 SC tests unchanged)
- [ ] `POST /api/campaigns/prepare` with 100 recipients completes in < 2 seconds
- [ ] `POST /api/campaigns/import` with 1000-row CSV completes in < 5 seconds
- [x] All BigInt values in responses are strings
- [x] Schedule math tests match Rust `schedule.rs` outputs exactly
- [x] Invalid schedules rejected with clear error messages
- [x] Auth required on both endpoints
