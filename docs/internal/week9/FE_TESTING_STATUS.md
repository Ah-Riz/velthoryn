# FE Test Coverage & Status — Week 9

**Author:** Geral (Frontend, Team 7)
**Date:** 2026-06-18
**Updates:** docs/WEEK7_FE_COVERAGE_REPORT.md (Week 7 baseline)
**Program:** G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu (devnet)

---

## §1 Test Suite Summary

| Test Type | Framework | Files | Tests | Status |
|-----------|-----------|-------|-------|--------|
| Vitest unit | Vitest 3.x | 32 | 572 | ✅ All passing |
| E2E (chromium mock) | Playwright | 23 | — | ⏸️ Needs Postgres + dev server |
| E2E signing (localnet) | Playwright | 10 | — | ⏸️ CI disabled (needs localnet validator) |
| Bankrun / LiteSVM integration | Mocha / ts-mocha | 15 | — | ✅ Pass (run separately) |
| TS Merkle parity | Vitest (standalone) | 1 | 13 | ✅ All passing |

> Note: "Tests" for E2E is not shown as a fixed number because Playwright specs define dynamic test counts based on mocked data and parameterized fixtures.

**Previous baseline (Week 8 end):** ~978 Vitest tests across all configs combined. The drop to 572 reflects a deliberate refactor of the Vitest configuration to a dedicated unit config (`vitest.unit.config.ts`), which excludes integration-adjacent specs that were previously bundled with the unit run. Core unit coverage is unchanged or expanded.

---

## §2 Test Categories & Coverage

### 2.1 Vitest Unit Tests (32 files, 572 passing)

All run via `vitest.unit.config.ts`. No external services required.

#### Schedule Math, Merkle, Vesting Logic

**`tests/lib/`**
Core vesting library utilities:
- Vesting schedule math (linear, cliff, milestone payout calculations)
- Cluster helper functions (endpoint resolution, cluster detection)
- Datetime utilities (epoch conversion, slot estimation, duration formatting)

**`tests/math/`**
Edge-case arithmetic for all three schedule types:
- Linear schedule: boundary precision, partial periods, zero-duration windows
- Cliff schedule: pre-cliff/post-cliff unlock correctness, concurrent cliff+linear
- Milestone schedule: multi-milestone ordering, partial release aggregation

**`tests/merkle/`**
Merkle tree internals used by the Velthoryn protocol:
- Tree construction (leaf hashing, sibling ordering, root derivation)
- Proof generation and path verification
- Hash collision resistance checks, single-leaf edge case

**`tests/anchor/`**
On-chain address derivation and IDL tooling:
- PDA seed construction for all Velthoryn accounts (Campaign, Stream, ClaimRecord)
- IDL decoding utilities, discriminator extraction

**`tests/week7/`**
Coverage-boost tests written during Week 7 that remain part of the unit suite:
- Full vesting lifecycle (create → claim → close) using in-process mocks
- Error code map completeness (all `VestingError` variants present and mapped)
- Schedule variant matrix (all combinations of cliff/linear/milestone parameters)

#### Component Tests

**`tests/components/MilestoneReleasePanel.test.ts`**
Unit test for the `MilestoneReleasePanel` UI component:
- Renders correct milestone states (pending / releasable / released)
- Calls release handler with correct milestone index
- Disables release button when wallet disconnected

---

### 2.2 E2E Tests — Chromium Mock (23 spec files)

Located in `apps/web/tests/e2e/`. Require Postgres and a running Next.js dev server. Wallet interactions are mocked via `NEXT_PUBLIC_E2E_MOCK_WALLET=true`; transactions are intercepted at the localStorage boundary rather than submitted to a validator. Run in CI via `web-ci.yml`.

#### Create Flows
| Spec File | Coverage |
|-----------|----------|
| `vesting-create-flows.spec.ts` | Full create-stream flow for all three schedule types (linear, cliff, milestone) |
| `manual-create.spec.ts` | Manual single-stream creation with custom parameters |
| `csv-template-create.spec.ts` | CSV bulk-upload create flow; template download + re-upload round-trip |
| `csv-validation.spec.ts` | CSV parser error states: malformed rows, missing required columns, cap exceeded |

#### Campaign Actions
| Spec File | Coverage |
|-----------|----------|
| `campaign-actions.spec.ts` | Pause, resume, root rotation UI actions on an existing campaign |
| `campaign-detail.spec.ts` | Campaign detail page rendering: stream list, stats, merkle root display |
| `allocations.spec.ts` | Allocation table: pagination, sort, filter by status |
| `close-claim-record.spec.ts` | Close-claim-record action button state, confirmation dialog |

#### Dashboard & Navigation
| Spec File | Coverage |
|-----------|----------|
| `dashboard.spec.ts` | Dashboard overview page: campaign cards, aggregate stats |
| `my-campaigns.spec.ts` | My Campaigns list: empty state, campaign card actions |
| `navigation.spec.ts` | Navbar links, breadcrumbs, mobile menu toggle |
| `user-journey.spec.ts` | End-to-end happy path from landing → create → dashboard |

#### Wallet & UX
| Spec File | Coverage |
|-----------|----------|
| `wallet-connection.spec.ts` | Connect/disconnect wallet modal, adapter selection |
| `wrap-sol.spec.ts` | Wrap SOL dialog: input validation, balance display |
| `token-picker.spec.ts` | Token picker dropdown: search, custom mint input |

#### Responsive & Accessibility
| Spec File | Coverage |
|-----------|----------|
| `responsive.spec.ts` | Layout at 375px (mobile), 768px (tablet), 1440px (desktop) viewports |
| `accessibility.spec.ts` | axe-core audit on key pages (landing, dashboard, create form) |
| `error-validation.spec.ts` | Form field validation messages, required-field highlighting |
| `vesting-ui-components.spec.ts` | Shared UI component smoke tests (ScheduleCard, StreamStatusBadge, etc.) |

#### Other
| Spec File | Coverage |
|-----------|----------|
| `landing.spec.ts` | Landing page hero, feature cards, CTA button routing |
| `funding-recovery.spec.ts` | Funding-recovery flow: underfunded campaign warning, refund path |
| `create-pages.spec.ts` | Multi-page create wizard: step transitions, back navigation |
| `pageErrors.ts` | Shared helper: captures and asserts on Next.js page-level errors (not a spec) |

---

### 2.3 E2E Tests — Signing / Localnet (10 files)

Located in `apps/web/tests/e2e/signing/`. Require a running Solana Test Validator (localnet). These tests submit real transactions signed by a keypair loaded from env. CI job disabled since commit `129538c`; all tests are runnable locally with `solana-test-validator` in the background.

| File | Coverage |
|------|----------|
| `claim-flow.spec.ts` | End-to-end claim: wallet signs ClaimStream, balance delta verified on-chain |
| `cancel-stream.spec.ts` | Creator cancels active stream; unvested tokens returned |
| `create-and-claim.spec.ts` | Single session: create campaign + stream → claim → verify state |
| `milestone-release.spec.ts` | Sponsor releases a milestone on-chain; recipient claim unlocked |
| `multi-create.spec.ts` | Bulk creation via CSV; verifies N streams created in one workflow |
| `root-rotation.spec.ts` | Root rotation instruction signed and confirmed; new proof verified |
| `wrap-sol-signing.spec.ts` | wSOL wrapping transaction signed and confirmed |
| `campaign-actions-signing.spec.ts` | Pause and resume campaign instructions (on-chain state changes) |
| `close-claim-record.spec.ts` | CloseClaimRecord instruction signed; rent recovered |
| `helpers.ts` | Shared test utilities (keypair loading, airdrop, account polling) — not a spec |

---

### 2.4 Bankrun / LiteSVM Integration Tests (15 spec files)

Located in `tests/`. Run via ts-mocha against Bankrun or LiteSVM in-process validators. No external services required. Executed by the `ci.yml` Anchor pipeline.

| Spec File | Coverage Area |
|-----------|---------------|
| `vesting-schedule.spec.ts` | Invariant: released ≤ total, schedule monotonicity |
| `native-sol.spec.ts` | Native SOL deposit, claim, withdraw paths |
| `sealevel-attacks.spec.ts` | Account substitution, CPI re-entrancy, signer spoofing |
| `security.spec.ts` | Authority checks, overflow guards, duplicate-claim prevention |
| `litesvm.spec.ts` | LiteSVM smoke test: deploy + basic round-trip |
| `week7-edge-cases.spec.ts` | Boundary conditions surfaced in Week 7 review |
| `week7-security.spec.ts` | Week 7 security-focused cases (unauthorized signer variants) |
| `clock-manipulation.spec.ts` | Bankrun clock override: pre-cliff claim rejection, post-end full release |
| `update-root-min-cliff.spec.ts` | Root update respects minimum cliff constraint |
| `golden-vector.spec.ts` | Fixed numeric vectors: deterministic output for known inputs |
| `instant-refund.spec.ts` | InstantRefund instruction: full unvested amount returned |
| `layout-validation.spec.ts` | Account layout byte offsets match IDL discriminators |
| `mollusk.spec.ts` | Mollusk handler coverage (partially blocked — see §4) |
| `stream-lifecycle.spec.ts` | Full stream lifecycle from open to settled |
| `error-codes.spec.ts` | All on-chain error codes reachable and map to correct anchor error |

---

## §3 CI Pipeline Status

Three CI workflow files are active (or partially active) in the repository.

### `ci.yml` — Anchor / Smart Contract Pipeline

**Status:** Active / ✅

Jobs:
1. **Anchor build** — `anchor build`, verifies program compiles cleanly
2. **IDL drift check** — detects uncommitted IDL changes (`anchor idl parse` diff)
3. **Native SOL tests** — Bankrun suite for SOL-specific paths
4. **Localnet integration** — full Bankrun/LiteSVM suite against a validator fixture
5. **Sealevel-attacks** — attack vector suite
6. **LiteSVM** — LiteSVM standalone smoke tests

Trigger: push / PR to `main` or `dev_*` branches touching `programs/` or `tests/`.

---

### `lint.yml` — Linting, Typecheck, Vitest, Build

**Status:** Active / ✅

Jobs:
1. **Clippy** — Rust linting with `--deny warnings`
2. **Next.js ESLint** — `next lint` over `apps/web`
3. **Vitest unit** — runs `vitest.unit.config.ts`; 572 tests, no Postgres required
4. **Next.js build** — production build check; full DB env required for compile-time queries

> Note: Vitest unit tests pass without Postgres because `vitest.unit.config.ts` explicitly excludes database-dependent specs. The full `vitest run` (all configs) requires Postgres for API route tests.

Trigger: push / PR to `main` or `dev_*` branches touching `apps/web/` or `clients/`.

---

### `web-ci.yml` — Web E2E Pipeline

**Status:** Partially active

Sub-jobs:
1. **Merkle parity** — standalone Vitest run of the TypeScript Merkle implementation against known vectors; 13/13 ✅. No external dependencies.
2. **E2E Playwright (chromium)** — runs the 23-spec chromium mock suite. Requires Postgres service container and Next.js dev server. Currently configured in the pipeline but blocked by environment provisioning (tracked separately). ⏸️
3. **Next.js production build** — final build gate; runs after E2E. ✅
4. **Playwright Signing E2E (localnet)** — **DISABLED** since commit `129538c`. The job requires a running Solana Test Validator which is not available as a GitHub Actions service container. Tests remain fully runnable locally.

Trigger: push / PR to `main` or `dev_*` branches touching `apps/web/`.

---

## §4 Testing Gaps

| Gap | Impact | Recommended Fix |
|----|--------|----------------|
| E2E signing tests require localnet validator — CI job disabled | Medium: real transaction signing paths (claim, cancel, root-rotation) are not validated in CI | Explore `solana-test-validator` as a GitHub Actions service container, or build a LiteSVM-backed E2E adapter that intercepts RPC calls |
| API route tests (`tests/api/**`) require Postgres — not wired to CI | Medium: API security cases (BE-SEC-01: 401/403 enforcement) are not automatically verified | Add a Postgres service container to `lint.yml` and run the full `vitest` config (not just `vitest.unit.config.ts`) |
| No E2E test for error code 6041 (`PerLeafCapExceeded`) | Low: the error path exists in the program but is not exercised from the UI test layer | Add a case to `error-validation.spec.ts` after `errors.ts` is updated with the new code |
| Mollusk 4 handlers blocked (`claim`, `cancel_stream`, `instant_refund`, `withdraw_unvested`) | Medium: compute-unit budgets for these instruction paths are unverified; regressions could go undetected | Unblocks with Mollusk 0.14 upgrade; track as a follow-up task |
| No visual regression tests | Low: dark-mode layout shifts and component regressions require manual visual inspection | Introduce Playwright screenshot tests with `toMatchSnapshot()` for key pages in dark and light mode |

---

## §5 Week 9 Test Changes — Geral's Contributions

All commits below are on the `dev_geral` branch and represent the full E2E testing buildout for Week 9.

---

### `16248db` — feat: setup e2e testing and workflows

Established the entire E2E testing foundation from scratch:

- Added `playwright.config.ts` and `playwright.signing.config.ts` with separate project definitions for chromium-mock and localnet-signing runs.
- Integrated both Playwright configs into `web-ci.yml` as distinct CI sub-jobs.
- Implemented `NEXT_PUBLIC_E2E_MOCK_WALLET=true` mode in the wallet adapter layer: when active, the adapter returns a synthetic keypair and intercepts `sendTransaction` calls, writing mock signatures to localStorage instead of submitting to an RPC.
- Created `tests/e2e/helpers.ts` with shared utilities: `connectWallet()`, `navigateTo()`, `waitForToast()`, `fillCreateForm()`, and assertion helpers for common UI states.
- Wrote initial spec stubs for all 23 chromium-mock specs and all 10 signing specs, establishing the file structure and import conventions used by all subsequent test work.

---

### `76cb9d1` — test(e2e): fix all failing chromium and signing E2E tests

After Lana's commit `09e49a8` moved vesting schedule inputs from stream-level to campaign-level in the create flow, the majority of existing E2E tests broke. This commit fixed the bulk of the failures:

- Updated form fill sequences in all create-flow specs to target the new campaign-level `Start Date`, `Cliff Date`, and `End Date` fields.
- Replaced stream-level schedule selectors with the new shared schedule section selectors.
- Updated mock data structures passed to `fillCreateForm()` to reflect the new field layout.
- Fixed corresponding signing test fixtures that constructed transaction payloads from the same form data.

---

### `2f87a82` — fix(e2e): restrict signing testMatch to \*.spec.ts

Playwright's default `testMatch` glob was collecting `helpers.ts` inside `tests/e2e/signing/` as a test file, causing a collection error at suite startup. Fixed by adding an explicit `testMatch: ['**/*.spec.ts']` override to `playwright.signing.config.ts`. The `helpers.ts` file remains importable as a module.

---

### `3a92473` — fix(e2e): fix 8 failing signing E2E tests (round 1)

After `76cb9d1`, 8 signing tests were still failing due to:

- Incorrect PDA seed construction in test fixtures: `campaign` PDA was being derived with a stale seed buffer format. Updated to match the current IDL seed layout.
- Async timing issue in the mock wallet: `signTransaction` was resolving before the mock signature was written to localStorage, causing subsequent reads to return `null`. Fixed by awaiting the localStorage write explicitly.
- Account lookup sequences in `create-and-claim.spec.ts` were polling the wrong account address after the PDA fix. Corrected the derived address references.

---

### `8daf263` — fix(e2e): fix 5 remaining signing test failures (round 2)

Resolved 5 failures that remained after round 1:

- `minCliffTime` field was being passed as a JS `Date` object in test fixtures but the instruction builder expected a Unix timestamp (seconds). Added explicit `.getTime() / 1000` conversion in affected specs.
- Mock signature confirmation sequencing in `claim-flow.spec.ts` was not waiting for the simulated confirmation before asserting on-chain state. Added a `waitForConfirmation()` utility call.

---

### `129538c` — ci: disable Playwright Signing E2E (localnet) job

The GitHub Actions environment does not provide a persistent Solana Test Validator as a service container. The signing E2E sub-job in `web-ci.yml` was consistently failing at the validator startup step, blocking the overall pipeline. The job has been disabled (commented out) to restore CI green status. All signing tests remain runnable locally:

```bash
solana-test-validator --reset &
pnpm playwright test --config=playwright.signing.config.ts
```

Restoring CI coverage for signing tests is tracked as a gap in §4.

---

### `3786366` — fix(e2e): add missing imports and inline variable definitions in create-flow tests

Two create-flow spec files had import omissions introduced during the `76cb9d1` mass-update:

- `page` and `expect` from `@playwright/test` were missing in `csv-template-create.spec.ts` and `create-pages.spec.ts`.
- Several inline `const` declarations were referencing variables from a prior test block scope that was restructured, causing ReferenceErrors at collection time.

Fixed by restoring the proper `@playwright/test` destructured imports and inlining the affected variable declarations within the correct `test` callback scope.

---

### `546a135` — fix(e2e): fill campaign-level schedule before CSV parse in cliff/linear tests

After the campaign-level schedule change, the cliff and linear create specs were filling the CSV upload field before the shared schedule section (Start/Cliff/End) was populated. The Next.js form validates the schedule section before processing the CSV, causing a validation block that prevented the CSV from being parsed.

Fixed by reordering the test steps: schedule fields are now filled first, then the CSV is uploaded and parsed. Updated both `csv-template-create.spec.ts` (cliff variant) and `vesting-create-flows.spec.ts` (linear variant).

---

### `30e1f26` — fix(build): add missing StreamEntry fields & exclude \_\_tests\_\_ from client tsc

Two unrelated build regressions fixed together:

**TypeScript client build (`clients/ts/tsconfig.json`):**
The `@velthoryn/client` package was not excluding `__tests__/` directories from its TypeScript compilation. Jest test utilities imported from `@jest/globals` were leaking into the client build output, causing type errors in downstream consumers (including the Next.js app). Fixed by adding `"exclude": ["**/__tests__/**"]` to `clients/ts/tsconfig.json`.

**`StreamEntry` type definition:**
The `StreamEntry` interface was missing two fields added to the on-chain account layout in a recent program update: `instantRefunded: boolean` and `streamSettled: boolean`. Their absence caused TypeScript errors in components that read those fields. Added both fields to the type definition with correct types.

---

## §6 Running Tests Locally

```bash
# Vitest unit tests (no external deps)
cd apps/web
pnpm vitest run --config vitest.unit.config.ts

# E2E chromium mock (requires Postgres + dev server)
pnpm dev &                          # start Next.js
pnpm playwright test                # runs playwright.config.ts

# E2E signing (requires localnet validator)
solana-test-validator --reset &
pnpm playwright test --config playwright.signing.config.ts

# Bankrun / LiteSVM integration
cd tests
pnpm ts-mocha -p tsconfig.json "*.spec.ts"

# Merkle parity (standalone)
pnpm vitest run tests/merkle-parity.test.ts
```

---

*End of Week 9 FE Testing Status Report.*
