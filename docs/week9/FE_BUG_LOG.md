# FE Bug Log — Velthoryn Token Vesting

> **Scope**: Frontend-facing bugs discovered across Weeks 3–9. Each entry includes root cause, fix status, and prevention.
> **Owner**: Geral (FE)  
> **Last updated**: 2026-06-18 (Week 9)

---

## Status Legend

| Symbol | Meaning |
|---|---|
| ✅ Fixed | Implemented and verified |
| 🔧 Partial | Fix started, not fully verified |
| ⏳ Pending | Confirmed bug, fix not yet implemented |
| 🔍 Detected | Candidate, needs triage |
| ❌ Wontfix | Not a bug / out of scope |

---

## FE-BUG-01 — Cancelled campaign shows as grace period even when instant-refunded

| Field | Value |
|---|---|
| **ID** | FE-BUG-01 |
| **Severity** | P0 |
| **Status** | 🔧 Partial |
| **Week discovered** | Week 7 |
| **Files** | `apps/web/src/app/(app)/dashboard/page.tsx`, `apps/web/src/app/(app)/campaigns/page.tsx`, `apps/web/src/lib/vesting/list.ts` |

**Root cause**: The FE checked only `cancelledAt !== null` to display the grace-period countdown/action, without checking `instantRefunded` or `streamSettled`. Instant-refunded and settled campaigns would wrongly appear in the "Needs Attention" section.

**Fix**: Add `isGracePeriodVisible({ cancelledAt, instantRefunded, streamSettled })` helper that returns `true` only when `cancelledAt != null && !instantRefunded && !streamSettled`. All grace-period UI branches must use this helper instead of raw `cancelledAt` check.

**Prevention**: Any lifecycle-state check on `cancelledAt` should be reviewed to also check the two other flags.

---

## FE-BUG-02 — Linear cancel: recipient cannot withdraw vested tokens

| Field | Value |
|---|---|
| **ID** | FE-BUG-02 |
| **Severity** | P0 |
| **Status** | 🔧 Partial |
| **Week discovered** | Week 7 |
| **Files** | `apps/web/src/app/(app)/campaign/[id]/page.tsx`, `apps/web/src/app/api/beneficiary/[address]/vesting-progress/route.ts` |

**Root cause**: Campaign detail page hid the claim button when `cancelledAt !== null`. For a linear stream cancelled mid-vesting, the beneficiary still has a positive `claimable` balance. The API's vesting-progress route also stopped computing `claimable` for cancelled streams.

**Fix**: 
1. API: compute `vestedSoFar = getVestedAmount(schedule, cancelledAt, now)` using the cancel timestamp as the vesting cap.
2. FE: show "Claim Vested" button when `claimable > 0n && !instantRefunded`, regardless of `cancelledAt`.

**Prevention**: Test matrix: cancelled-at-cliff, cancelled-mid-vesting, cancelled-after-full-vest.

---

## FE-BUG-03 — Raw token amounts displayed on dashboard/portfolio

| Field | Value |
|---|---|
| **ID** | FE-BUG-03 |
| **Severity** | P1 |
| **Status** | 🔧 Partial |
| **Week discovered** | Week 7 |
| **Files** | `apps/web/src/app/(app)/dashboard/page.tsx`, `apps/web/src/app/(app)/portfolio/page.tsx`, `apps/web/src/hooks/useVestingProgress.ts` |

**Root cause**: Dashboard and portfolio stats show amounts as raw lamports/base units (e.g., `1000000`) instead of human-readable token amounts (e.g., `1.000000` for 6-decimal mint). `useMintDecimals` was not called, or decimals were not used in the formatter.

**Fix**: Each per-campaign amount must call `formatTokenAmount(raw, decimalsMap.get(campaign.mint) ?? null)`. For aggregate multi-mint stats, show "Mixed tokens" rather than a false normalized total.

**Prevention**: Introduce a shared `formatTokenAmount(raw, decimals)` utility in `apps/web/src/lib/vesting/display.ts` and enforce its use via lint rule.

---

## FE-BUG-04 — Linear allocations vest at visually different speeds

| Field | Value |
|---|---|
| **ID** | FE-BUG-04 |
| **Severity** | P0 |
| **Status** | 🔧 Partial |
| **Week discovered** | Week 7 |
| **Files** | `apps/web/src/lib/vesting/schedule.ts`, `apps/web/src/app/api/beneficiary/[address]/vesting-progress/route.ts` |

**Root cause**: Two leaves with amount `1` and `0.5`, same schedule, would show different `progressPercent` after end time. The percentage was computed relative to the campaign `totalSupply` instead of each leaf's individual `amount`.

**Fix**: Compute `vestedSoFar / leafAmount * 100` per-leaf, not per-campaign-total. After `endTime`, both should return `progressPercent = 100`.

**Prevention**: Add regression test: two leaves with different allocations, `now > endTime`, assert both have `progressPercent === 100`.

---

## FE-BUG-05 — Creator can cancel/pause fully-vested campaign

| Field | Value |
|---|---|
| **ID** | FE-BUG-05 |
| **Severity** | P1 |
| **Status** | ⏳ Pending |
| **Week discovered** | Week 7 |
| **Files** | `apps/web/src/app/(app)/campaign/[id]/page.tsx`, `apps/web/src/components/campaign/detail/PauseToggleButton.tsx` |

**Root cause**: The campaign detail page does not check `totalVested >= totalSupply` before rendering Cancel and Pause buttons. The program itself (via `FullyVested` error 6031) will reject these calls, but users should see disabled buttons with an explanation, not a failed transaction.

**Fix**: Compute `isFullyVested = vestedTotal >= campaign.totalSupply` from the campaign detail API, then disable Cancel/Pause buttons with tooltip "All tokens are already vested."

**Prevention**: Always derive UI-level button availability from server-computed lifecycle state, not raw on-chain fields.

---

## FE-BUG-06 — Campaign-level schedule not passed to cliff/linear E2E tests

| Field | Value |
|---|---|
| **ID** | FE-BUG-06 |
| **Severity** | P1 (test infra) |
| **Status** | ✅ Fixed |
| **Week fixed** | Week 9 (commit `546a135`) |
| **Files** | `apps/web/tests/e2e/create-cliff.spec.ts`, `apps/web/tests/e2e/create-linear.spec.ts` |

**Root cause**: E2E tests for cliff and linear create flows did not fill in the campaign-level Start/Cliff/End schedule fields before attempting CSV parse. After Lana's Week 9 commit (`09e49a8`) moved schedule to campaign level (shared across all leaves), the old tests broke.

**Fix**: Fill campaign schedule fields (`startDate`, `cliffDate`, `endDate`) before calling the CSV parse helper.

**Prevention**: When SC/BE changes the create-flow field layout, E2E tests must be updated in the same PR.

---

## FE-BUG-07 — CSV bulk upload silently drops milestone rows

| Field | Value |
|---|---|
| **ID** | FE-BUG-07 |
| **Severity** | P1 |
| **Status** | 🔧 Partial |
| **Week discovered** | Week 5 |
| **Files** | `apps/web/src/lib/campaign/bulk.ts`, `apps/web/src/app/api/campaigns/import/route.ts` |

**Root cause**: CSV import API used `line.split(",")` which fails on quoted values. The FE `parseCsvRows` handled quoting correctly but the API parser did not share the same logic, causing column-shift parsing errors on any cell containing a comma.

**Fix**: Extract a shared `parseCsvRows` utility in `apps/web/src/lib/campaign/csv.ts` that handles RFC 4180 quoted fields, and use it in both the FE preview and the API import route.

**Prevention**: Any CSV parsing should go through a single shared utility. The API must not use its own raw `split(",")`.

---

## FE-BUG-08 — Supabase DB truncated in test globalSetup

| Field | Value |
|---|---|
| **ID** | FE-BUG-08 |
| **Severity** | P1 (test infra) |
| **Status** | ✅ Fixed |
| **Week fixed** | Week 5 (commit `8611a79`) |
| **Files** | `apps/web/tests/globalSetup.ts`, `apps/web/tests/helpers/db.ts` |

**Root cause**: Test globalSetup unconditionally truncated the Supabase DB, which wiped shared devnet campaign data when tests ran against a shared environment.

**Fix**: Add `ALLOW_DB_TRUNCATE` environment variable guard. DB truncation only runs when explicitly enabled in CI.

**Prevention**: Never allow destructive DB operations from test setups without an explicit `ALLOW_DB_TRUNCATE=1` guard.

---

## FE-BUG-09 — Mobile sidebar drawer overflow on small screens

| Field | Value |
|---|---|
| **ID** | FE-BUG-09 |
| **Severity** | P2 |
| **Status** | ✅ Fixed |
| **Week fixed** | Week 6 (commit `bdd6e9e`) |
| **Files** | `apps/web/src/components/shell/Sidebar.tsx` |

**Root cause**: On mobile, the sidebar was not converted to a drawer/sheet overlay, causing horizontal overflow and obscuring the main content.

**Fix**: Added responsive mobile drawer using shadcn/ui Sheet component. Sidebar becomes a slide-in overlay at `<md` breakpoint.

**Prevention**: Test all shell layout changes at 375px viewport in Playwright.

---

## FE-BUG-10 — WrapSolModal missing `createATA` step

| Field | Value |
|---|---|
| **ID** | FE-BUG-10 |
| **Severity** | P1 |
| **Status** | ✅ Fixed |
| **Week fixed** | Week 5 (commit `0213478`) |
| **Files** | `apps/web/src/hooks/useWrapSol.ts` |

**Root cause**: The initial SOL wrap implementation did not create the associated token account (wSOL ATA) before calling `syncNative`. If the wallet did not already have a wSOL ATA, the transaction would fail with `AccountNotInitialized`.

**Fix**: `useWrapSol` now calls `createAssociatedTokenAccount` idempotently before transfer + `syncNative`.

**Prevention**: Every token operation must check ATA existence and create it if missing.

---

## FE-BUG-11 — StreamEntry missing `leafIndex` in TypeScript type

| Field | Value |
|---|---|
| **ID** | FE-BUG-11 |
| **Severity** | P1 (build) |
| **Status** | ✅ Fixed |
| **Week fixed** | Week 9 (commit `30e1f26`) |
| **Files** | `apps/web/src/types/stream.ts` (or equivalent StreamEntry interface) |

**Root cause**: Lana's Week 9 per-leaf schedule change added `leafIndex` to the on-chain data, but the FE `StreamEntry` TypeScript interface was not updated. The `apps/web` TypeScript build failed with a missing field error.

**Fix**: Added `leafIndex: number` field to `StreamEntry`. Excluded `__tests__/` from `tsconfig.json` `include` to prevent test stubs from polluting the client type-check.

**Prevention**: When BE/SC adds a new field to any shared type, FE must update the TypeScript interface in the same PR.

---

## FE-BUG-12 — Error code 6041 (PerLeafCapExceeded) missing from errors.ts

| Field | Value |
|---|---|
| **ID** | FE-BUG-12 |
| **Severity** | P1 |
| **Status** | ✅ Fixed |
| **Week fixed** | Week 9 (this session) |
| **Files** | `apps/web/src/lib/anchor/errors.ts` |

**Root cause**: Lana's Week 9 commit (`fd6163d`) added the `PerLeafCapExceeded` error (code 6041) to the Anchor program, but the FE `VESTING_ERROR_CODES` and `USER_MESSAGES` maps stopped at 6040.

**Fix**: Added `PerLeafCapExceeded: 6041` to `VESTING_ERROR_CODES` and the corresponding user message to `USER_MESSAGES`. Also added to `docs/FE_INTEGRATION.md` error table.

**Prevention**: When Lana adds a new error to the Anchor program, a matching entry must be added to `errors.ts` in the same PR.

---

## FE-BUG-13 — TokenPickerModal showed duplicate popular tokens on devnet

| Field | Value |
|---|---|
| **ID** | FE-BUG-13 |
| **Severity** | P2 |
| **Status** | ✅ Fixed |
| **Week fixed** | Week 5 (commit `8611a79`) |
| **Files** | `apps/web/src/lib/constants/popular-tokens.ts` |

**Root cause**: The popular tokens list contained both mainnet and devnet addresses without filtering by cluster. On devnet, mainnet-only mints appeared in the list and would fail ATA creation.

**Fix**: Added devnet-aware popular tokens list that returns cluster-specific mints from `NEXT_PUBLIC_SOLANA_CLUSTER`.

**Prevention**: Any hardcoded token list must be cluster-aware.

---

## FE-BUG-14 — CSP blocked Helius WebSocket connections

| Field | Value |
|---|---|
| **ID** | FE-BUG-14 |
| **Severity** | P1 |
| **Status** | ✅ Fixed |
| **Week fixed** | Week 5 (commit `8611a79`) |
| **Files** | `apps/web/next.config.ts` |

**Root cause**: Adding CSP headers in `next.config.ts` blocked WebSocket connections from `@solana/web3.js` to `wss://helius-rpc.com`.

**Fix**: Added `connect-src` CSP directive allowing `wss://helius-rpc.com`.

**Prevention**: When adding CSP headers, test with all RPC endpoints used in dev and prod.

---

## FE-BUG-15 — Node 26 breaks TypeScript Anchor test runner

| Field | Value |
|---|---|
| **ID** | FE-BUG-15 |
| **Severity** | P1 (test infra) |
| **Status** | ✅ Fixed |
| **Week fixed** | Week 9 |
| **Files** | CI scripts / developer local setup |

**Root cause**: Node 26 (installed via Homebrew on macOS) breaks the `ts-mocha` / `yargs` CJS/ESM resolver used by the Anchor test runner. Tests would fail to start.

**Fix**: Force `PATH=~/.nvm/versions/node/v20.20.2/bin:$PATH` before invoking the test runner. `anchor test` wraps in `bash -lc` which re-sources profile and resets PATH, so `ts-mocha` must be invoked directly with the PATH env set.

**Prevention**: Pin Node version in `.nvmrc` to 20.x. CI always uses Node 20.

---

## Summary Table

| ID | Severity | Status | Area | Week |
|---|---|---|---|---|
| FE-BUG-01 | P0 | 🔧 Partial | Cancel lifecycle state | Week 7 |
| FE-BUG-02 | P0 | 🔧 Partial | Linear cancel claim | Week 7 |
| FE-BUG-03 | P1 | 🔧 Partial | Token amount display | Week 7 |
| FE-BUG-04 | P0 | 🔧 Partial | Linear vesting math | Week 7 |
| FE-BUG-05 | P1 | ⏳ Pending | Fully vested UI guard | Week 7 |
| FE-BUG-06 | P1 | ✅ Fixed | E2E schedule fields | Week 9 |
| FE-BUG-07 | P1 | 🔧 Partial | CSV quoted fields | Week 5 |
| FE-BUG-08 | P1 | ✅ Fixed | Test DB truncation | Week 5 |
| FE-BUG-09 | P2 | ✅ Fixed | Mobile sidebar | Week 6 |
| FE-BUG-10 | P1 | ✅ Fixed | SOL wrap ATA | Week 5 |
| FE-BUG-11 | P1 | ✅ Fixed | StreamEntry type | Week 9 |
| FE-BUG-12 | P1 | ✅ Fixed | Error code 6041 | Week 9 |
| FE-BUG-13 | P2 | ✅ Fixed | Devnet token list | Week 5 |
| FE-BUG-14 | P1 | ✅ Fixed | CSP WebSocket | Week 5 |
| FE-BUG-15 | P1 | ✅ Fixed | Node 26 test runner | Week 9 |
