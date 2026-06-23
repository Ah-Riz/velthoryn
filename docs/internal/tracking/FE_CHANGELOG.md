# FE Changelog — Velthoryn Token Vesting

> **Scope**: Frontend-only changes by Geral (Week 3–9).
> Based on actual commit diffs (`git show`), not commit messages alone.
> Lana's SC/BE/DB commits are excluded. Shared commits are noted.
> **Last updated**: 2026-06-18 (Week 9)

---

## Week 3 — Scaffold (2026-05-05 to 2026-05-11)

**Key commits**: `e8174fd` (scaffold)

### What was built

- **Project skeleton**: Next.js 15 App Router, TypeScript, Tailwind CSS v4, Biome linter.
- **Wallet integration**: `WalletProvider` with Phantom/Solflare adapters via `@solana/wallet-adapter-react`. Wallet connect modal on `/`.
- **TanStack Query**: `QueryProvider` wrapping the app. Default `staleTime` = 10s.
- **Anchor client** (`lib/anchor/client.ts`): `getProvider()`, `getProgram()`, `derivePda()`, `PROGRAM_ID`, `BN`, `IDL` exports.
- **Merkle builder** (`lib/merkle/builder.ts`): `VestingLeaf` type, `encodeLeaf()`, `LEAF_PREFIX`, `NODE_PREFIX`, keccak-256 hash.
- **`useVestingProgram` hook**: returns `Program<Vesting>` or `null` when wallet not connected.
- **Root layout**: `Space Grotesk` + `JetBrains Mono` fonts, dark `<html>` class.

**Stats**: 18 files changed, 454 insertions

---

## Week 4 — Campaign Create + Detail Pages (2026-05-12 to 2026-05-18)

**Key commits**: `fabff9e` (campaign pages + 38 tests + docs)

### What was built

- **Campaign create pages**: `/campaign/create/cliff`, `/campaign/create/linear`, `/campaign/create/milestone` with form fields, manual beneficiary entry, and schedule inputs.
- **Campaign detail page** (`/campaign/[id]`): full campaign info display, recipient list, analytics stats.
- **`useCreateCampaign` hook**: builds `initializeCampaign` + `depositTokens` Anchor transactions, submits via wallet.
- **`useCampaignDetail` hook**: fetches `/api/campaigns/[treeAddress]` with stale: 10s.
- **`useCampaignList` hook**: fetches `/api/campaigns` filtered by connected wallet.
- **38 Vitest unit tests** for merkle builder, schedule math, and bulk CSV parsing.
- **Documentation**: `docs/PRD_GERAL.md`, `docs/PDD_GERAL.md`, `docs/TDD_GERAL.md`, `docs/SECURITY_GERAL.md` (first versions).

**Stats**: ~378 insertions in campaign/create, ~300 in campaign/[id], 38 new tests

---

## Week 5 — Token Picker, Milestone, Security Hardening (2026-05-19 to 2026-05-25)

**Key commits**: `e7cd08b`, `e899115`, `3d27cbc`, `8611a79`, `0213478`

### `e7cd08b` — Cancel, Milestone, 304 tests

- **`CancelConfirmDialog`**: two-mode cancel confirmation (cancel_settle / instant_refund) with estimated split amounts.
- **`TriggerMilestoneButton`**: creator releases individual milestones via `releaseMilestone` Anchor instruction.
- **304 Vitest tests**: new test files for `bulk.ts`, `schedule.ts`, `errors.ts`, `builder.ts`.

### `e899115` — Token Picker + Root Rotation (1167 insertions)

- **`TokenPickerModal`** (Sablier-style): dark modal, search, popular/wallet token sections.
- **`RootRotationCard`**: shows Merkle root history and opens `AllocationEditor`.
- **`useUpdateRoot` hook**: builds `updateRoot` Anchor tx + saves new root version to API.
- **`useWalletTokens` hook**: fetches SPL token accounts for connected wallet via `connection.getParsedTokenAccountsByOwner`.

### `3d27cbc` — Milestone + Close Claim Record

- **`MilestoneReleasePanel`**: creator-facing panel to release individual milestones.
- **`CloseClaimRecordButton`**: beneficiary can close `ClaimRecord` PDA after full claim to recover rent.
- **`verify-onchain.ts`**: utility script to verify on-chain state matches indexed DB.

### `8611a79` — Security Hardening + VestingChart

- **CSP headers** in `next.config.ts`: `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, WebSocket allowlist for `wss://helius-rpc.com`.
- **`VestingChart`** (135 lines SVG): plots vesting curve as step chart (cliff), ramp (linear), stepped ramp (milestone) from `vestingCurve.samples`.
- **Bulk CSV milestones**: `BulkCsvSection` now supports milestone rows in upload.
- **`globalSetup.ts`**: added `ALLOW_DB_TRUNCATE` guard to prevent accidental Supabase wipe.
- **Devnet popular tokens**: cluster-aware list in `lib/constants/popular-tokens.ts`.
- **Next.js 15.5.18** upgrade (security patches).

### `0213478` — Sablier-style Token Picker + SOL Wrap/Unwrap (525 insertions)

- **`TokenPickerModal` redesign**: dark theme, search, popular/wallet sections, Solscan links per token row.
- **`WrapSolModal`**: wrap/unwrap toggle, amount input, balance display, green checkmark success state (auto-close after 2s), error banner with retry.
- **`useWrapSol` hook** (144 lines): `createATA + transfer + syncNative` for wrap; `closeAccount` for unwrap.

**Week 5 total stats**: ~1800+ new lines across components, hooks, lib, tests

---

## Week 6 — E2E Tests + Hardened Claim Flows (2026-05-26 to 2026-06-01)

**Key commits**: `ceff96f`, `0385bf1`, `bdd6e9e`

### `ceff96f` — Harden Vesting UI and Claim Flows (757 insertions)

- **`ClaimWithProofButton` hardening**: validates proof before sending, shows clearer error messages.
- **`VestingChart` updates**: handles cancelled state, shows grace period expiry marker.
- **`MilestoneReleasePanel` hardening**: disables release buttons when campaign is cancelled or paused.
- **`BulkCsvSection`**: improved error messages, highlights invalid rows inline.
- **Dashboard hardening**: better handling of multi-role (creator + recipient) wallet.
- **`END_USER_VESTING_GUIDE.md`**: 410-line guide for end users (Week 6 deliverable).
- **39 new Vitest tests** in `bulk-campaign.test.ts`.

### `0385bf1` — 47 Devnet E2E Integration Tests (1433 insertions)

- **`devnet-vesting-extended.test.ts`** (999 lines): 34 new integration tests covering:
  - `unpauseStream`, `withdrawUnvested`, `closeClaimRecord`, `cancelSingleStream`
  - `createBulkCampaignFixture`, `claimWithProof`, `updateRoot`, `fundCampaign`
  - Multi-leaf bulk campaigns (create / claim / proof)
  - Sequential claims, edge cases, non-cancellable streams
- **`devnet-helpers.ts`** (332 insertions): 8 new helper functions for devnet ops.
- 18 of 41 error codes now covered by integration tests.

### `bdd6e9e` — Mobile Sidebar Drawer

- **`Sidebar.tsx`** responsive: converts to Sheet/drawer on mobile (`<md`), full-screen overlay.
- Sidebar collapse state persisted to `localStorage` (`velthoryn:sidebar-collapsed`).

**Week 6 total stats**: ~2200+ new lines across tests, components, docs

---

## Week 7 — Security Testing + Coverage Boost (2026-06-02 to 2026-06-08)

**Key commits**: `550bcf4`, `db86fa1`, `98fec1c`

### `550bcf4` — Security Tests + WEEK7_FE_SECURITY_CHECKLIST (2280 insertions)

- **`WEEK7_FE_SECURITY_CHECKLIST.md`**: 56-check security review across XSS, auth, CORS, CSP, input validation, error handling.
- **160 new tests**: security-focused Vitest tests for `errors.ts`, `bulk.ts`, `builder.ts`, schedule math.
- **`lib/anchor/errors.ts`** hardening: filter internal state from error messages, `isWalletCancellation`, `extractSimulationDetails`, `getRelevantProgramLog`, `formatVestingErrorWithLogs`.
- **`isRetryableError`** utility: distinguishes network timeouts from hard transaction failures.

### `db86fa1` — 540 Tests + 81% Coverage

- **540 total Vitest tests** across 32 files.
- Coverage boost to 81% on `lib/` utilities.
- New test files: `vesting-list.test.ts`, `errors.test.ts`, `schedule.test.ts` (extended), `client.test.ts`.

### `98fec1c` — Cancel Flow + Instant Refund + Timeline Events (Week 7)

- **Cancel settle flow**: `CancelConfirmDialog` toggle for `cancel_settle` vs `instant_refund` modes.
- **Instant refund flow**: multi-leaf pre-cliff campaigns can be instantly refunded.
- **Timeline events**: `stream_cancelled` and `instant_refunded` event types with descriptions in `CampaignTimeline`.
- **`markStreamSettledLocal` / `isStreamSettledLocal`**: post-cancel UI state helpers in `persist.ts`.
- **`/api/events/sync`** route: indexes on-chain events by signature.
- **`minCliffTime`** field propagated through all indexing/API payloads.

**Week 7 total stats**: ~2400+ new lines across tests, docs, components

---

## Week 8 — shadcn/ui Migration + UI/UX Polish + Lifecycle Model (2026-06-09 to 2026-06-15)

**Key commits**: `e1ec4b8`, `42f57df`, `eb71065`

### `e1ec4b8` — shadcn/ui Migration (5941 insertions, 1470 deletions)

Full migration from custom UI components to shadcn/ui primitives. 32 files changed.

**Added shadcn/ui components** in `apps/web/src/components/ui/`:
- `badge.tsx`, `button.tsx`, `card.tsx`, `dialog.tsx`, `input.tsx`, `label.tsx`
- `progress.tsx`, `scroll-area.tsx`, `select.tsx`, `skeleton.tsx`, `sonner.tsx`, `tooltip.tsx`

All form inputs, buttons, dialogs, and cards across the app now use shadcn/ui. Custom CSS replaced with Tailwind design tokens from `globals.css`.

### `42f57df` — UI/UX Polish Pass (238 insertions, 181 deletions)

- **Dark shell redesign**: sidebar, header, campaign list with consistent dark design tokens.
- **`StatusBadge`** updated: gradient-colored lifecycle badges (green/yellow/red/gray/orange).
- **`ActivityFeed`** redesign: timeline-style with icons per event type.
- **Dashboard redesign**: skeleton loaders, motion improvements, stat cards.
- **`globals.css`**: new CSS custom properties for dark mode design tokens.

### `eb71065` — Lifecycle State Model Task 1 (127 insertions)

- **`CampaignLifecycle` type** in `lib/vesting/list.ts`: 8-state enum.
- **`isGracePeriodVisible()` helper**: returns `true` only when `cancelledAt != null && !instantRefunded && !streamSettled`.
- **`getSenderStreamStatus()` fix**: checks `streamSettled` and `instantRefunded` before falling through to generic "Cancelled".
- **`getRecipientStreamStatus()` fix**: checks `claimable > 0` before `cancelledAt`.
- **`vesting-progress` API**: selects `instant_refunded` + `EXISTS stream_cancel_events AS stream_settled`.
- **3 new API tests**: cancelled linear claimable, instantRefunded flag, streamSettled flag.

**Week 8 total stats**: ~6300+ insertions, major refactor of UI layer

---

## Week 9 — Bug Fixes + Documentation (2026-06-16 to 2026-06-20)

**Key commits**: `30e1f26`, `3786366`, `546a135`, `b27e0fd`, `16248db`

### `30e1f26` — Build Fix: StreamEntry + tsconfig

- Added missing `leafIndex`, `cliffTime`, `startTime`, `endTime` fields to `StreamEntry` TypeScript interface (Lana's per-leaf schedule change required this).
- Excluded `__tests__/` from `tsconfig.json` `include` to prevent test stubs from polluting client type-check.

### `3786366` — E2E Fix: Imports + Inline Variables

- Added missing imports (`expect`, `test`) to several E2E spec files.
- Inlined helper variables that were undefined at runtime.
- Fixed `create-cliff.spec.ts`, `create-linear.spec.ts` imports.

### `546a135` — E2E Fix: Campaign-Level Schedule Before CSV Parse

- `create-cliff.spec.ts` and `create-linear.spec.ts`: now fill Start/Cliff/End schedule fields before attempting CSV upload.
- Required by Lana's Week 9 change moving schedule to campaign level (shared across all leaves).

### `b27e0fd` — Week 9 Bug Fixes (multiple areas)

**Cancel/Grace/Settled lifecycle**:
- `vesting/list.ts`: fixed `getSenderStreamStatus` order (settled checked before cancelled).
- `campaigns/route.ts`, `beneficiary/campaigns/route.ts`: expose `instantRefunded` and `streamSettled` in API responses.
- `vesting-list.test.ts`: updated assertions to match new lifecycle fields.

**CSV bulk flow**:
- `lib/campaign/csv.ts` (new): shared RFC 4180 quoted-CSV parser (`parseCsvRows`, `normalizeCsvHeader`) with header aliases.
- `campaign/bulk.ts`: uses shared parser, fixed amount conversion path.
- `campaigns/import/route.ts`: replaced naive `line.split(",")` with shared parser.
- `BulkCsvSection.tsx`: wired shared `csv.ts`, improved parse error UX.

**Campaign detail / allocation**:
- `ClaimWithProofButton.tsx`: shows claim action for cancelled campaigns when `claimable > 0 && !instantRefunded`.
- `CampaignTimeline.tsx`: handles settled/instant-refund states explicitly.
- `useUpdateRoot.ts`: preserves BigInt amounts, guards against stale roots.

**Dashboard / mobile**:
- `dashboard/page.tsx`: `needsAttention` filter now uses `isGracePeriodVisible()`.
- `campaigns/page.tsx`: mobile dropdown (`<select>`) replaces tab overflow on small screens.

### `16248db` — E2E Workflow Setup

- **`.github/workflows/web-ci.yml`** (181 insertions): full E2E CI pipeline.
- `playwright.config.ts`: additional project config for signing tests.
- Fixed 3 spec files (`csv-template-create`, `csv-validation`, `vesting-create-flows`) for updated schedule field layout.

### JSDoc + Error Code Fix (this session)

- Added `PerLeafCapExceeded: 6041` to `VESTING_ERROR_CODES` and `USER_MESSAGES` in `errors.ts`.
- Added JSDoc to 8 hooks: `useCampaignDetail`, `useVestingProgress`, `useVestingProgressSummary`, `useCreateCampaign`, `useCreateStream`, `useUpdateRoot`, `useProofLookup`, `useClaimRecord`.

**Week 9 total stats**: ~200+ insertions, 5 bug fix areas, full documentation suite

---

## Cumulative FE Statistics (Week 3–9)

| Metric | Count |
|---|---|
| Vitest unit tests | 572 (32 files) |
| Playwright E2E specs | 23 chromium + 10 signing |
| Devnet integration tests | 47 |
| React components | 68 files |
| Custom hooks | 21 files |
| Lib utilities | ~20 modules |
| Error codes covered | 6000–6041 (42 total) |
| Docs created | 15+ markdown files |
| shadcn/ui components | 12 |

---

## See Also

- [`docs/week9/FE_ARCHITECTURE.md`](week9/FE_ARCHITECTURE.md) — full stack architecture
- [`docs/week9/FE_BUG_LOG.md`](week9/FE_BUG_LOG.md) — 15 bugs, root causes, fix status
- [`docs/week9/FE_TESTING_STATUS.md`](week9/FE_TESTING_STATUS.md) — test suite status
- [`docs/week9/FE_DOCUMENTATION_REVIEW.md`](week9/FE_DOCUMENTATION_REVIEW.md) — doc accuracy review + 4 ADRs
- [`docs/week9/FE_E2E_GUIDE.md`](week9/FE_E2E_GUIDE.md) — E2E testing guide
- [`docs/week9/FE_COMPONENT_REFERENCE.md`](week9/FE_COMPONENT_REFERENCE.md) — all 68 components
