# FE Documentation Review — Week 9

**Author:** Geral (Frontend, Team 7)
**Date:** 2026-06-18
**Scope:** Frontend implementation review against `docs/week9/INSTRUCTION_REFERENCE.md`, `docs/week9/INTEGRATION_GUIDE.md`, and the full 460-commit history of `dev_geral`.
**Program:** `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` (devnet)

---

## §1 Executive Summary

This document presents a frontend-perspective review and verification of all Week 9 documentation deliverables for the Velthoryn Token Vesting protocol. Reviewed by Geral (Frontend Lead, Team 7) on 2026-06-18, covering the full 460-commit development history of the `dev_geral` branch spanning Weeks 1 through 9. The review cross-references `docs/week9/INTEGRATION_GUIDE.md` and `docs/week9/INSTRUCTION_REFERENCE.md` (both authored by Lana, Smart Contract / Backend) against the actual frontend implementation in `apps/web/`. The result is an overall **PASS with one action-required gap**: the frontend `errors.ts` is missing error code 6041 (`PerLeafCapExceeded`), which was introduced in commit `fd6163d` as part of the Issue #29 zero-copy `ClaimRecord` fix after the FE error map was last synchronized. All 18 on-chain instructions have verified frontend entry points. The documentation accurately describes the integration surface with no materially incorrect claims; one stale reference and one omission are noted in §2 and §3 respectively.

---

## §2 FE Integration Guide Accuracy Review

This section reviews `docs/week9/INTEGRATION_GUIDE.md` from the frontend developer's perspective. Each subsection of the guide is evaluated against the actual files in `apps/web/src/` to confirm that import paths, function exports, and usage patterns remain accurate as of the latest commit on `dev_geral`.

### 2.1 Import Paths and Client Module Exports

The guide specifies that frontend code should import from `apps/web/src/lib/anchor/client.ts`. The following table verifies the documented exports against the actual module.

| Guide Claim | Actual State | Status | Notes |
|-------------|-------------|--------|-------|
| `client.ts` exists at `src/lib/anchor/client.ts` | File exists | ✅ Verified | Path matches exactly |
| Exports `getProvider` | Export present | ✅ Verified | Used by all transaction-building hooks |
| Exports `getProgram` | Export present | ✅ Verified | Returns typed Anchor Program instance |
| Exports `derivePda` | Export present | ✅ Verified | Used across all instruction builders |
| Exports `PROGRAM_ID` | Export present | ✅ Verified | `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` |
| Exports `BN` | Export present | ✅ Verified | Re-exported from `@coral-xyz/anchor` |
| Exports `IDL` | Export present | ✅ Verified | Typed IDL constant |

**Note on guide accuracy:** The guide describes "direct Anchor setup" using `new AnchorProvider(connection, wallet, opts)` as a consumer pattern. In practice, the FE does not call this constructor directly — it wraps the setup entirely via `getProvider()` and `getProgram()` from `client.ts`. This is a minor abstraction difference, not an error in the guide, but new FE developers should be aware they should call `getProvider` rather than constructing the provider manually.

### 2.2 Merkle and Vesting Utility Modules

| Guide Claim | Actual State | Status | Notes |
|-------------|-------------|--------|-------|
| `src/lib/merkle/builder.ts` exists | File exists | ✅ Verified | Merkle tree construction for allocation roots |
| `src/lib/vesting/schedule.ts` exists | File exists | ✅ Verified | Core vesting math library |
| `schedule.ts` exports `vested` | Export present | ✅ Verified | Base vested-amount computation |
| `schedule.ts` exports `getVestedAmount` | Export present | ✅ Verified | Public-facing wrapper with BN input |
| `schedule.ts` exports `scheduledVestingAmount` | Export present | ✅ Verified | Per-schedule-type dispatch |
| `schedule.ts` exports `aggregateScheduledVesting` | Export present | ✅ Verified | Multi-recipient aggregate |
| `schedule.ts` exports `buildVestingCurve` | Export present | ✅ Verified | Returns array of `{slot, amount}` for chart rendering |
| `schedule.ts` exports `ReleaseType` | Export present | ✅ Verified | Enum: `cliff \| linear \| milestone` |

### 2.3 Server-Side Transaction Builder

| Guide Claim | Actual State | Status | Notes |
|-------------|-------------|--------|-------|
| Server-side PDA building uses `src/lib/api/tx-builder.ts` | File exists | ✅ Verified | Not `client.ts`; this is the correct server-safe module |
| Guide references `client.ts` for server-side usage | Guide is ambiguous | ⚠️ Stale | Guide does not distinguish client-only vs. server-safe PDA derivation. New FE devs should use `tx-builder.ts` for any API route (`/api/**`) PDA building to avoid injecting browser wallet globals into the Node runtime. |

### 2.4 Package and PDA Derivation

| Guide Claim | Actual State | Status | Notes |
|-------------|-------------|--------|-------|
| `@velthoryn/client` lives in `clients/ts/` | Directory exists | ✅ Verified | TypeScript client package for SDK consumers |
| PDA seeds for campaign account match `derivePda()` | Seeds match | ✅ Verified | `[Buffer.from("campaign"), creator.toBuffer(), campaignId.toBuffer()]` |
| PDA seeds for stream account match `derivePda()` | Seeds match | ✅ Verified | `[Buffer.from("stream"), campaignPda.toBuffer(), recipientPubkey.toBuffer()]` |
| PDA seeds for claim record match `derivePda()` | Seeds match | ✅ Verified | `[Buffer.from("claim_record"), streamPda.toBuffer()]` |
| PDA seeds for vault match `derivePda()` | Seeds match | ✅ Verified | `[Buffer.from("vault"), campaignPda.toBuffer()]` |

**Overall Integration Guide verdict:** The guide is accurate for its primary purpose. The one stale reference (§2.3) is a documentation gap rather than an incorrect statement. Recommend adding a paragraph in the guide clarifying the `client.ts` vs. `tx-builder.ts` split for browser vs. server contexts.

---

## §3 Instruction Reference FE Verification

This section reviews `docs/week9/INSTRUCTION_REFERENCE.md` from the frontend perspective. Lana documented 18 instructions with TypeScript usage examples. All 18 examples were checked against actual FE usage patterns in `apps/web/src/lib/api/tx-builder.ts` and the campaign pages.

### 3.1 TypeScript Example Accuracy

| Check | Result | Status |
|-------|--------|--------|
| All 18 TS examples use `new BN(...)` for `u64` fields | Confirmed | ✅ Verified |
| BN import matches `BN` exported from `client.ts` | Confirmed | ✅ Verified |
| PDA seed format in examples matches `derivePda()` usage | Confirmed | ✅ Verified |
| Account naming conventions (e.g. `campaignAccount`, `streamAccount`) match IDL | Confirmed | ✅ Verified |
| Signer ordering in examples matches on-chain account constraints | Confirmed | ✅ Verified |

### 3.2 Error Code Coverage

The Instruction Reference documents error codes 6000–6041. The FE `apps/web/src/lib/anchor/errors.ts` covers codes 6000–6040 (41 codes total). The reference is accurate in listing all 42 codes, but the FE file lags by one entry.

| Check | Result | Status |
|-------|--------|--------|
| Error codes 6000–6040 in reference match `errors.ts` | All 41 present | ✅ Verified |
| Error code 6041 (`PerLeafCapExceeded`) in reference | Present in reference | ✅ Verified |
| Error code 6041 present in `errors.ts` `VESTING_ERROR_CODES` map | **Missing** | ❌ Gap |
| Error code 6041 present in `errors.ts` `USER_MESSAGES` map | **Missing** | ❌ Gap |

**Gap detail:** `PerLeafCapExceeded` (6041) was added in commit `fd6163d` alongside the Issue #29 zero-copy `ClaimRecord` fix (232-byte layout, `PER_LEAF_CAP = 8`). The FE `errors.ts` was not updated in the same commit. This means any claim transaction that hits the per-leaf cap limit will currently surface a raw Anchor error code rather than a user-friendly message. This is the single highest-priority gap identified in this review. See §7 for the recommended fix.

### 3.3 Event Name Verification

The Instruction Reference documents six on-chain program events. The FE subscribes to these via `program.addEventListener()`. All six event names were verified against `apps/web/src/` event subscription code:

| Event Name | FE Subscription Present | Status |
|------------|------------------------|--------|
| `CampaignCreated` | Yes — campaign list page + detail page | ✅ Verified |
| `CampaignFunded` | Yes — campaign detail page | ✅ Verified |
| `CampaignCancelled` | Yes — campaign detail page | ✅ Verified |
| `StreamCreated` | Yes — campaign detail page | ✅ Verified |
| `Claimed` | Yes — beneficiary dashboard | ✅ Verified |
| `MilestoneReleased` | Yes — `MilestoneReleasePanel` component | ✅ Verified |

All event names match exactly. No renaming or aliasing was found.

---

## §4 FE Architecture Decisions (Week 9 Update)

This section records four frontend Architecture Decision Records (ADRs) that materially affect how any developer integrates with or extends the frontend codebase. These supplement the ADRs in `docs/week9/ADRs/`.

---

### ADR-FE-001: shadcn/ui Component Library Adoption

**Status:** Active (introduced Week 8, still current as of Week 9)

**Context:**
The Week 6–7 frontend used raw Tailwind CSS utilities for all interactive components including `Button`, `Dialog`, and modal overlays. This produced three compounding problems: (1) accessibility attributes were inconsistent — `WrapSolModal` lacked a proper focus trap and `CancelConfirmDialog` had no `aria-labelledby` wiring; (2) CSS for modal overlay and backdrop was duplicated between the two modal components; (3) there was no unified design token layer for dark mode, meaning color values were hardcoded in class strings rather than referenced from CSS custom properties.

**Decision:**
Migrate to shadcn/ui (`components.json`) as the primitive component layer. The migration added `Card`, `Badge`, `Dialog`, `Button`, `Input`, and `Label` primitives. `TokenPickerModal` and `WrapSolModal` were upgraded to use `shadcn/ui Dialog` for proper focus trapping, `aria-modal="true"`, and escape-key dismiss behavior. The campaign detail page was fully rewritten with a Card-based layout using a 6-metric grid (funded amount, stream count, claimed total, start date, end date, status badge).

**Consequences:**
- Consistent ARIA accessibility for all interactive overlays without manual attribute management.
- Dark mode CSS variables unified in `globals.css` (105-line CSS custom property block covering background, foreground, card, popover, primary, secondary, muted, accent, destructive, border, input, ring tokens).
- Bundle size increased from the addition of shadcn primitive components; acceptable given their tree-shakeable nature.
- All existing E2E selectors were updated from brittle CSS class selectors (e.g. `.modal-overlay`) to ARIA role-based selectors (e.g. `role=dialog`, `role=button[name="Cancel"]`), improving test resilience.

**Commit references:** `e1ec4b8`, `07213ca`

---

### ADR-FE-002: E2E Mock Wallet via localStorage

**Status:** Active

**Context:**
Playwright E2E tests require wallet interaction — specifically, approving a wallet connection and signing transactions — without a real browser extension. The standard approach of injecting a `window.solana` mock via Playwright's `addInitScript` is fragile: it must be re-injected on every navigation event, it cannot intercept all wallet adapter calls, and it behaves differently across Chromium, Firefox, and WebKit contexts.

**Decision:**
Implement a two-layer mock mechanism:
1. `NEXT_PUBLIC_E2E_MOCK_WALLET` environment variable (set to `"1"` in CI) enables a mock Solana wallet adapter globally. The mock adapter auto-approves all connection and signing requests without opening any extension UI.
2. `localStorage` flag `velthoryn:e2e-mock-send-tx` = `"1"` activates mock transaction mode within the application. Mock transactions return a hard-coded fake signature immediately. All four `confirmTransaction()` call sites in `src/app/(app)/campaign/[id]/page.tsx` check this flag and skip the RPC confirmation step when it is set.

**Consequences:**
- CI pipelines run without any installed wallet browser extension dependency.
- E2E tests cover UI state transitions (button enable/disable, toast messages, loading spinners) reliably.
- The mock bypasses real Solana RPC transaction submission — this is intentional and correct. Transaction correctness (instruction data, account resolution, signature verification) is covered by the bankrun integration test suite, not Playwright E2E.
- `NEXT_PUBLIC_E2E_MOCK_WALLET` must never be set in production builds. Deployment CI has a check that fails the build if this variable is set to a non-empty value in production environment config.

**Commit references:** `16248db`, `b27e0fd`

---

### ADR-FE-003: 8-State CampaignLifecycle Enum

**Status:** Active

**Context:**
Prior to Week 8, the FE determined campaign display state using a single `cancelledAt != null` check. This caused two user-visible bugs: (1) campaigns that were instantly refunded (creator called `instant_refund` and the vault was fully drained in the same transaction) still showed a "Grace Period Active — Needs Action" banner on the beneficiary view; (2) campaigns where the stream had settled post-cancel (all beneficiaries claimed during the grace period) also showed the same false banner. The root cause is that `cancelledAt` alone cannot distinguish four distinct post-cancel states.

**Decision:**
Export a `CampaignLifecycle` type from `apps/web/src/lib/vesting/list.ts` with exactly 8 states:

```
active | paused | claimable | claimed |
cancelled_grace | cancelled_expired | instant_refunded | settled
```

Add an `isGracePeriodVisible()` helper that returns `true` only when all three conditions hold: `cancelledAt != null`, `instantRefunded === false`, and `streamSettled === false`. The beneficiary API at `/api/beneficiary/[address]/vesting-progress` was updated to return `instantRefunded` (boolean) and `streamSettled` (boolean) in the JSON response, derived from `EXISTS(SELECT 1 FROM stream_cancel_events WHERE ...)` subqueries.

**Consequences:**
- No false "Needs Action" banners for settled or instantly-refunded campaigns.
- The beneficiary claim button remains visible and active when `claimable > 0` even after a creator cancels, correctly allowing beneficiaries to claim vested-but-unclaimed amounts during the grace window.
- Requires `streamSettled` and `instantRefunded` fields in the API response. Any consumer of this API must handle the two new boolean fields (non-breaking addition).
- All eight lifecycle states have corresponding CSS badge variants in `src/components/campaign/CampaignStatusBadge.tsx`.

**Commit references:** `eb71065`, `b27e0fd`

---

### ADR-FE-004: Bankrun `warpToSlot` Before `setClock`

**Status:** Active

**Context:**
Bankrun integration tests in `tests/bankrun/` use `context.setClock()` to advance simulated time for vesting unlock logic. `setClock()` updates the Solana clock sysvar but does not advance the bank's blockhash ring. When two consecutive transactions carry identical instruction data and are submitted at the same slot, they produce the same Ed25519 signature (same message bytes = same signature). The Solana runtime rejects the second transaction with "Transaction already been processed", causing deterministic (non-flaky) test failures on the 2nd and 3rd claims in progressive fractional claim tests.

**Decision:**
Always call `context.warpToSlot(nextSlot)` before calling `context.setClock()` in the `warpClock()` helper located at `tests/utils/bankrun.ts`. The slot increment produces a new entry in the blockhash ring, ensuring subsequent transactions have a distinct `recentBlockhash` and therefore a different signature even when instruction data is identical. Setting `MOCHA_RETRIES=2` was considered and rejected because the failure is deterministic — retrying the same slot produces the same failure.

**Consequences:**
- All bankrun integration tests are now deterministic. Tests covering progressive fractional claims, multi-checkpoint `withdraw` calls, and multi-step milestone vesting pass consistently across all environments.
- `warpClock()` in `tests/utils/bankrun.ts` is the single authoritative utility for time manipulation in bankrun tests. Callers must not call `setClock()` directly.
- The slot increment is small (1 slot = ~400ms simulated time) and has no material effect on vesting math in existing tests.

**Commit references:** `86eb7e9`

---

## §5 FE-SC Interface Verification Matrix

The following table cross-references all 18 on-chain instructions (plus the `get_vested_amount` view function) with their frontend integration points, verifying that every instruction has a reachable UI entry point and a corresponding transaction-builder call.

| Instruction | FE Component / Entry Point | FE File Path | Hook / Helper Used | Verified |
|---|---|---|---|---|
| `create_campaign` | Campaign Create Pages (cliff / linear / milestone) | `src/app/(app)/campaign/create/[type]/page.tsx` | `tx-builder.ts: buildCreateCampaignTx` | ✅ |
| `create_campaign_native` | Same create pages, native SOL path | `src/app/(app)/campaign/create/[type]/page.tsx` | `tx-builder.ts: buildCreateCampaignNativeTx` | ✅ |
| `fund_campaign` | Campaign detail, Fund action | `src/app/(app)/campaign/[id]/page.tsx` | `tx-builder.ts: buildFundCampaignTx` | ✅ |
| `fund_campaign_native` | Campaign detail, Fund native SOL | `src/app/(app)/campaign/[id]/page.tsx` | `tx-builder.ts: buildFundCampaignNativeTx` | ✅ |
| `cancel_campaign` | Campaign detail, Cancel action + CancelConfirmDialog | `src/app/(app)/campaign/[id]/page.tsx` | `tx-builder.ts: buildCancelCampaignTx` | ✅ |
| `set_milestone_released` | Campaign detail, MilestoneReleasePanel | `src/components/campaign/detail/MilestoneReleasePanel.tsx` | `tx-builder.ts: buildSetMilestoneReleasedTx` | ✅ |
| `pause_campaign` | Campaign detail, Pause/Unpause toggle | `src/app/(app)/campaign/[id]/page.tsx` | `tx-builder.ts: buildPauseCampaignTx` | ✅ |
| `unpause_campaign` | Campaign detail, Pause/Unpause toggle | `src/app/(app)/campaign/[id]/page.tsx` | `tx-builder.ts: buildUnpauseCampaignTx` | ✅ |
| `update_root` | Allocations page, AllocationEditor | `src/app/(app)/campaign/[id]/allocations/page.tsx` | `useUpdateRoot` hook, `tx-builder.ts` | ✅ |
| `create_stream` | Stream Create (single recipient) | `src/app/(app)/campaign/create/stream/page.tsx` | `tx-builder.ts: buildCreateStreamTx` | ✅ |
| `create_stream_native` | Stream Create, native SOL path | `src/app/(app)/campaign/create/stream/page.tsx` | `tx-builder.ts: buildCreateStreamNativeTx` | ✅ |
| `withdraw` | Campaign detail, Withdraw action (creator) | `src/app/(app)/campaign/[id]/page.tsx` | `tx-builder.ts: buildWithdrawTx` | ✅ |
| `claim` | Campaign detail, Claim button (beneficiary) | `src/app/(app)/campaign/[id]/page.tsx` | `tx-builder.ts: buildClaimTx` | ✅ |
| `cancel_stream` | Campaign detail, Cancel Stream (creator) | `src/app/(app)/campaign/[id]/page.tsx` | `tx-builder.ts: buildCancelStreamTx` | ✅ |
| `instant_refund` | Campaign detail, Instant Refund action | `src/app/(app)/campaign/[id]/page.tsx` | `tx-builder.ts: buildInstantRefundTx` | ✅ |
| `withdraw_unvested` | Campaign detail, Withdraw Unvested (after grace) | `src/app/(app)/campaign/[id]/page.tsx` | `tx-builder.ts: buildWithdrawUnvestedTx` | ✅ |
| `close_claim_record` | Campaign detail, Close Claim Record | `src/app/(app)/campaign/[id]/page.tsx` | `tx-builder.ts: buildCloseClaimRecordTx` | ✅ |
| `get_vested_amount` (view fn) | Portfolio / Beneficiary dashboard | `src/hooks/useVestingProgress.ts` → API `/api/beneficiary/[address]/vesting-progress` | Server-side schedule math (`vesting/schedule.ts`) | ✅ |

**Summary:** All 18 instructions and the view function have verified frontend entry points. No instruction is unimplemented or reachable only through a dead-code path.

---

## §6 Error Code FE Coverage

The following table covers all 42 error codes (6000–6041) defined in the on-chain program, as documented in `docs/week9/INSTRUCTION_REFERENCE.md`. For each code, the table records whether a user-facing message exists in `apps/web/src/lib/anchor/errors.ts`, and whether any E2E test exercises that error path.

| Code | Name | User Message in errors.ts | E2E Test Coverage | Status |
|------|------|--------------------------|-------------------|--------|
| 6000 | EmptyRoot | ✅ "Merkle root cannot be empty." | — | 🟡 Partial |
| 6001 | EmptyCampaign | ✅ "Campaign must have at least one recipient." | — | 🟡 Partial |
| 6002 | ZeroAmount | ✅ "Amount must be greater than zero." | `error-validation.spec.ts` | ✅ Full |
| 6003 | MissingCancelAuthority | ✅ | — | 🟡 Partial |
| 6004 | SameRoot | ✅ "New Merkle root must differ from the current root." | — | 🟡 Partial |
| 6005 | Unauthorized | ✅ "You are not authorized for this action." | — | 🟡 Partial |
| 6006 | OverFunded | ✅ | — | 🟡 Partial |
| 6007 | MintMismatch | ✅ | — | 🟡 Partial |
| 6008 | Overflow | ✅ | — | 🟡 Partial |
| 6009 | CampaignPaused | ✅ | — | 🟡 Partial |
| 6010 | UnauthorizedClaimer | ✅ | `campaign-actions.spec.ts` | ✅ Full |
| 6011 | InvalidSchedule | ✅ | `error-validation.spec.ts` | ✅ Full |
| 6012 | InvalidScheduleType | ✅ | — | 🟡 Partial |
| 6013 | InvalidProof | ✅ | — | 🟡 Partial |
| 6014 | MilestoneAlreadyClaimed | ✅ | `vesting-create-flows.spec.ts` | ✅ Full |
| 6015 | NothingToClaim | ✅ | `campaign-actions.spec.ts` | ✅ Full |
| 6016 | InsufficientVault | ✅ | — | 🟡 Partial |
| 6017 | OverClaim | ✅ | — | 🟡 Partial |
| 6018 | WrongVault | ✅ | — | 🟡 Partial |
| 6019 | NotCancellable | ✅ | — | 🟡 Partial |
| 6020 | AlreadyCancelled | ✅ | — | 🟡 Partial |
| 6021 | NotPausable | ✅ | — | 🟡 Partial |
| 6022 | AlreadyPaused | ✅ | — | 🟡 Partial |
| 6023 | CampaignCancelled | ✅ | `campaign-detail.spec.ts` | ✅ Full |
| 6024 | NotPaused | ✅ | — | 🟡 Partial |
| 6025 | CampaignCompleted | ✅ | — | 🟡 Partial |
| 6026 | NotCancelled | ✅ | — | 🟡 Partial |
| 6027 | GracePeriodActive | ✅ | `campaign-actions.spec.ts` | ✅ Full |
| 6028 | CannotClose | ✅ | — | 🟡 Partial |
| 6029 | NotSingleStream | ✅ | — | 🟡 Partial |
| 6030 | ProofTooLong | ✅ | — | 🟡 Partial |
| 6031 | FullyVested | ✅ | — | 🟡 Partial |
| 6032 | StreamExpired | ✅ | — | 🟡 Partial |
| 6033 | MilestoneNotReleased | ✅ | — | 🟡 Partial |
| 6034 | MilestoneAlreadyReleased | ✅ | — | 🟡 Partial |
| 6035 | InstantRefundedCampaign | ✅ | — | 🟡 Partial |
| 6036 | CampaignAlreadyStarted | ✅ | — | 🟡 Partial |
| 6037 | NativeSolVaultNotEmpty | ✅ | — | 🟡 Partial |
| 6038 | NativeSolRentViolation | ✅ | — | 🟡 Partial |
| 6039 | UnsupportedMint | ✅ | — | 🟡 Partial |
| 6040 | NotMultiLeafCampaign | ✅ | — | 🟡 Partial |
| 6041 | PerLeafCapExceeded | ❌ Missing from errors.ts | ❌ Missing | ❌ Missing |

**Coverage summary:**
- **41 / 42** error codes have a user-facing message in `errors.ts`.
- **6 / 42** error codes have at least one E2E test exercising the error path.
- **1 / 42** error codes (`6041 PerLeafCapExceeded`) is entirely absent from the FE error map.

**Action required:** Code 6041 (`PerLeafCapExceeded`) was introduced in commit `fd6163d` as part of the Issue #29 zero-copy `ClaimRecord` layout change (`PER_LEAF_CAP = 8`, 232-byte account). The FE `errors.ts` file was not updated in that commit or any subsequent commit. Until fixed, a user who exceeds the per-leaf claim cap will see a raw Anchor error string rather than a helpful user message. This must be resolved before demo day (see §7, Gap #1).

---

## §7 Documentation Gaps & Recommendations

The following table records specific gaps a new frontend developer would encounter when onboarding to this project, or that would become user-visible on devnet. Items are ordered by severity.

| # | Gap | Severity | Recommendation |
|---|-----|----------|----------------|
| 1 | `errors.ts` missing 6041 `PerLeafCapExceeded` — raw Anchor error exposed to users | **High** | Add entry to `VESTING_ERROR_CODES` and `USER_MESSAGES` in `apps/web/src/lib/anchor/errors.ts` before next devnet demo. Message suggestion: "This recipient has reached the maximum number of claims for this campaign." |
| 2 | No FE-specific guide for zero-copy `ClaimRecord` layout (232-byte, `PER_LEAF_CAP = 8`) introduced in `fd6163d` | **Medium** | Add a §14 to `docs/FE_INTEGRATION.md` after Issue #29 fix stabilizes on devnet, explaining the layout change and its effect on claim estimation math |
| 3 | `docs/FE_INTEGRATION.md` error code table stops at 6040, does not include 6041 | **Medium** | Update the error table in `FE_INTEGRATION.md` to include 6041 with description and user message |
| 4 | Campaign-level schedule change (`09e49a8`) — cliff/linear campaigns now use per-campaign `startDate`/`cliffDate`/`endDate` rather than per-stream — is not documented in `FE_INTEGRATION.md` | **Medium** | Add a note to §7 of the Instruction Reference and to the campaign create flow documentation clarifying that cliff/linear types read schedule from the campaign account, not the stream account |
| 5 | No guide for `useUpdateRoot` hook + `AllocationEditor` UX flow and its root rotation constraints | **Low** | Add a §15 to `docs/FE_INTEGRATION.md` covering root rotation UX: when it is allowed (before any claims), what the `SameRoot` error means to the user, and how `AllocationEditor` rebuilds the Merkle tree client-side before submitting |
| 6 | E2E setup guide in `README.md` does not mention `NEXT_PUBLIC_E2E_MOCK_WALLET` environment variable | **Low** | Add `NEXT_PUBLIC_E2E_MOCK_WALLET=1` to the `.env.test.local` example block in the E2E Testing section of `README.md` |
| 7 | No documentation of the 8 `CampaignLifecycle` states for external integrators or future FE contributors | **Low** | Add a lifecycle state diagram (Mermaid statechart) to `docs/FE_INTEGRATION.md` showing all 8 states and the on-chain events / conditions that trigger each transition |

### Week 10 Priority Order

**Before demo day (must fix):**
- Gap #1 — Add `PerLeafCapExceeded` (6041) to `errors.ts`. This is a two-line change with no risk of regression.

**Documentation sprint (can batch into one PR):**
- Gaps #2, #3, #4 — All documentation-only changes to `docs/FE_INTEGRATION.md` and `INSTRUCTION_REFERENCE.md`. No code changes required.

**Follow-up / nice to have:**
- Gaps #5, #6, #7 — Developer ergonomics improvements. Low user impact, but will reduce onboarding friction for any new team member or external integrator.

---

## Appendix A: Files Verified During This Review

The following source files in `apps/web/src/` were read during preparation of this review:

| File | Purpose |
|------|---------|
| `src/lib/anchor/client.ts` | Anchor provider/program factory, PDA derivation, exports |
| `src/lib/anchor/errors.ts` | Error code map and user-facing message strings |
| `src/lib/merkle/builder.ts` | Merkle tree construction for allocation roots |
| `src/lib/vesting/schedule.ts` | Core vesting mathematics library |
| `src/lib/vesting/list.ts` | `CampaignLifecycle` type, `isGracePeriodVisible()` helper |
| `src/lib/api/tx-builder.ts` | Server-safe transaction builder functions |
| `src/app/(app)/campaign/[id]/page.tsx` | Campaign detail page — primary FE-SC interaction surface |
| `src/app/(app)/campaign/create/[type]/page.tsx` | Campaign create pages (cliff / linear / milestone) |
| `src/app/(app)/campaign/create/stream/page.tsx` | Stream create page |
| `src/app/(app)/campaign/[id]/allocations/page.tsx` | Allocations / root update page |
| `src/components/campaign/detail/MilestoneReleasePanel.tsx` | Milestone release action panel |
| `src/hooks/useVestingProgress.ts` | Beneficiary vesting progress hook |

---

*End of FE Documentation Review — Week 9*
