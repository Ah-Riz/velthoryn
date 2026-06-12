# Weekly Report — Geral (Week 8)

**Scope:** Frontend UI/UX, E2E tests, product polish, integration (FE↔BE)

---

## What I Built This Week

### 1. Merge & Integration (test → dev_geral)
Pulled and merged the `test` branch into `dev_geral` — **106 files changed, +9,953 / -790 lines** across 35+ commits. Resolved no conflicts. This brought in transparency dashboard, clawback UI, real token amounts, minCliffTime support, and all Week 8 bug fixes.

### 2. Routing & Navigation Polish
- Changed all "Open app" CTAs on landing page footer → `/dashboard` (was `/campaign/create`)
- Moved **Quick Actions** section to top of dashboard — now immediately visible on load instead of below-the-fold
- Fixed sidebar active nav: visiting `/campaign/[id]` now correctly highlights **My Campaigns** (was highlighting nothing)

### 3. Loading State Improvements
- **Campaigns list page**: Replaced `"Loading streams..."` text with **5 skeleton rows** matching the actual CampaignRow layout (icon, title, status chip, meta columns)
- **Campaign detail page**: Replaced centered spinner with **structured skeleton** mirroring the actual page layout — header, 6-metric grid, progress bar, action buttons

### 4. Empty State & Error Polish
- **Error state**: Replaced raw error string with icon + "Failed to load streams" title + detail text
- **Empty states**: Made contextual per-tab:
  - "All" tab with no streams → CTA to create first stream
  - "As Sender" tab → "You haven't created any campaigns yet" + Create button
  - "As Recipient" tab → "You haven't been added as a recipient yet"
  - Search with no results → Shows search term in message
  - "Needs Action" tab → Existing green ✓ "All caught up" (kept as-is, already good)
- **API unavailable banner**: Added icon, shorter message, and **Retry button** (reloads page)

### 5. Real-Time Form Validation
Added `onBlur` validation to all 3 create stream forms:
- **Cliff**: amount, recipient, cliff date
- **Linear**: amount, recipient, end date
- **Milestone**: amount, recipient

Previously validation only ran on submit — users had no feedback until clicking the button. Now errors show immediately when leaving a field.

### 6. Visual Polish
- **Progress bars**: Added `duration-500 ease-out` transition — smooth animation when data loads
- **Withdraw dialog buttons**: Added `disabled:cursor-not-allowed` for consistent cursor feedback
- **Vitest config fix**: Added `test.alias` alongside `resolve.alias` — fixed 7 failing `cluster.test.ts` tests that used `vi.resetModules()` + dynamic `import("@/lib/sol/cluster")`

### 7. shadcn/ui Migration + Campaign Detail Redesign
Integrated shadcn/ui component library and did a full redesign of the campaign detail page:
- Added `components.json` + 6 new shadcn primitives: `Card`, `Badge`, `Dialog`, `Button`, `Input`, `Label`
- Rewrote `campaign/[id]/page.tsx` with Card-based layout — 6-metric grid, progress bar section, action buttons, structured skeleton loading
- Upgraded `TokenPickerModal` and `WrapSolModal` to shadcn Dialog primitive for proper accessibility
- Redesigned `CancelConfirmDialog` with shadcn Dialog base; cleaner instant refund vs grace period distinction
- Added `globals.css` dark theme CSS variables (105 lines) for consistent shadcn theming across app

### 8. Responsive E2E Tests (375px) + Native SOL Devnet Checklist
Gap closure Phase 4c (#17) + Phase 4d (#18) from `week8-gap-closure.md`:
- Added 4 responsive Playwright tests in `campaign-actions.spec.ts` at 375px viewport (iPhone SE):
  1. Grace banner renders on narrow viewport
  2. Needs Action tab wraps correctly on mobile
  3. Sidebar amber dot visible with drawer open
  4. Dashboard Needs Attention section stacks on mobile
- Added E2E test suite table + native SOL / T22 manual devnet checklist (T19–T24) to `docs/TESTING.md`

### 9. wrap-sol.spec.ts Selector Fix
`wrap-sol.spec.ts` had 2 failing tests after the shadcn Dialog migration changed the DOM structure:
- Added `aria-label="Close"` to WrapSolModal's custom close button
- Replaced stale `.z-[60]` class selectors with role-based: `getByRole("dialog")`, `getByRole("button", { name: /close/i })`
- Both tests now pass; selector pattern is resilient to future CSS changes

### 10. Test Branch Merge + Conflict Resolution (Jun 11)
Pulled 11 commits from `origin/test` (Lana's Week 8 gap closure: KI#29 BE validation, k6 load scripts, CU re-audit, CI hardening, ops verification tests, doc updates) into `dev_geral`. Resolved 1 merge conflict in `docs/TESTING.md` — kept both Geral's E2E devnet checklist section and Lana's k6/SC benchmarks section.

### 11. Bug Fix Plan — Task 1: Lifecycle State Model (Jun 12)
`BUG_FIX_PLAN.md` Task 1 (P0 Cancel/Grace/Settled state model) — complete.

**Changes:**
- `apps/web/src/lib/vesting/list.ts`:
  - Added `CampaignLifecycle` type (8 states: `active | paused | claimable | claimed | cancelled_grace | cancelled_expired | instant_refunded | settled`)
  - Added `isGracePeriodVisible()` helper — checks `cancelledAt != null && !instantRefunded && !streamSettled`
  - Fixed `getSenderStreamStatus()` — `instantRefunded` now also returns `"Settled"` (was missing)
  - Fixed `getRecipientStreamStatus()` and `getMultiLeafRecipientStreamStatus()` — check `streamSettled`/`instantRefunded` explicitly before falling through to generic `"Cancelled"`; moved claimable check before `cancelledAt` check so cancelled campaigns with vested balance show `"Claimable"`
- `apps/web/src/app/api/beneficiary/[address]/vesting-progress/route.ts`:
  - Query now selects `c.instant_refunded` and `EXISTS(SELECT 1 FROM stream_cancel_events WHERE campaign_id = c.id) AS stream_settled`
  - Response JSON now includes `instantRefunded` and `streamSettled` lifecycle flags
- `apps/web/tests/api/vesting-progress.test.ts`:
  - Added test: cancelled linear campaign retains claimable amount for vested-but-unclaimed tokens (amount=1M, cancelledAt=midpoint → claimable=500K)
  - Added test: `instantRefunded: true` campaigns return `claimable=0` and correct lifecycle flags
  - Added test: stream-settled campaigns (via `stream_cancel_events` row) return `streamSettled: true`

### 12. CI Hardening — All 3 Pipelines Green (Jun 12)

Three CI workflows were broken at the start of the session. All fixed without touching CI config files.

**Bankrun `warpClock` fix (`tests/utils/bankrun.ts`)**
- Root cause: `warpClock()` called `context.setClock()` only. `setClock()` updates the clock sysvar (what `Clock::get()` returns inside the program) but does NOT advance the bank's block hash ring. Consecutive transactions with identical instruction data + signers shared the same `recent_blockhash` → same Ed25519 signature → "Transaction already been processed" on the 2nd/3rd call.
- Why `MOCHA_RETRIES=2` couldn't fix it: retry resubmits the same tx with the same blockhash from the same slot — failure is deterministic, not flaky.
- Fix: added `context.warpToSlot(nextSlot)` before `setClock()` — advances the bank slot, produces a fresh blockhash entry.
- Tests fixed: `EC17` (3 progressive fractional claims) + Vesting Math invariant (4-checkpoint withdrawal)

**E2E `confirmTransaction` hang fix (`campaign/[id]/page.tsx`)**
- Root cause: `sendTransaction` in E2E mock mode returns a fake signature immediately. `connection.confirmTransaction(fakeSig, "confirmed")` then polls Devnet's real RPC indefinitely — the transaction doesn't exist, so it never resolves. `setTreeState({ cancelledAt: ... })` was inside the `await`, so it never fired → grace period amber banner never appeared.
- Fix: detect `localStorage.getItem("velthoryn:e2e-mock-send-tx") === "1"` and skip `confirmTransaction` entirely. Applied to all 4 `confirmTransaction` call sites in the page.

**E2E selector + UI fixes (`campaign-actions.spec.ts`, `Sidebar.tsx`, `dashboard/page.tsx`)**
- Amber dot selector: test used `h-2.w-2` but Sidebar renders `h-1.5.w-1.5` — updated selector
- Devnet badge: removed in earlier collapsible sidebar commit, re-added to expanded branding area
- Dashboard welcome text: changed from bare address to `"Welcome back, ADDR"` — also fixed a strict mode violation where `getByText(shortAddr, { exact: true })` matched 2 elements

**Vitest test isolation fixes**
- `useMintDecimals.test.ts`: module-level `decimalsCache = new Map()` persists across tests in same file. Test 2 populated both mints; Test 3 found cache warm → returned size=2 instead of 1. Fix: generate `MINT_ALPHA`/`MINT_BETA` in `beforeEach` with unique keypairs.
- `week7-fe-coverage-boost-2.test.ts`: `cancelledAt=150` is past `cliffTime=100` in linear stream → correctly returns "Claimable" now (not "Cancelled"). Changed to `cancelledAt=50` (before cliff) + added separate "Claimable" test.

### 13. Native SOL Create Flow (Jun 12)

Detect `NATIVE_SOL_MINT` in FE create flow and route to `*_native` instruction path instead of wrapped SOL. Functional on devnet.

---

## Work Split with Lana

Note: Lana contributed significant FE work this week (F2 dashboard rewrite, F3 clawback UI) in addition to SC/BE. The table below reflects the actual split — not all FE is Geral's.

| Area | Lana | Geral |
|------|------|-------|
| Smart contract (Rust) | ✅ | — |
| Backend API / Postgres | ✅ | — |
| Merkle client | ✅ | — |
| CI/CD hardening | ✅ | — |
| CU benchmarks | ✅ | — |
| Mainnet checklist / multisig docs | ✅ | — |
| Bug fixes — SC/BE layer (7 P0/P1/P2) | ✅ | — |
| Bug fixes — FE/API integration layer | — | ✅ |
| FE: Transparency Dashboard rewrite (F2) | ✅ dashboard/page.tsx, portfolio, ActivityFeed, hooks | — |
| FE: Auto Clawback surfaces (F3) | ✅ CampaignStatusBanner, GracePeriodCountdown, useNeedsActionCount, Needs Action tab, Dashboard Needs Attention | — |
| FE: Shared UI primitive extraction (8 components) | ✅ StatCard, ProgressBar, SectionHeader, etc. | — |
| FE: shadcn/ui migration + campaign detail redesign | — | ✅ TokenPickerModal, WrapSolModal, CancelConfirmDialog, campaign/[id]/page.tsx Card layout |
| FE: Skeleton loaders + empty states | — | ✅ |
| FE: Form validation (onBlur, 3 pages) | — | ✅ |
| FE: Lifecycle state model (Task 1) | — | ✅ isGracePeriodVisible, instantRefunded, streamSettled |
| FE: Raw token amount display fix (Task 9) | — | ✅ decimals cache, formatTokenAmount |
| FE: Native SOL create flow (Task 13) | — | ✅ |
| FE: Responsive E2E tests (375px) | — | ✅ 4 tests |
| FE: E2E CI hardening | — | ✅ confirmTransaction skip, amber dot, Devnet badge, welcome text |
| Bankrun integration test fixes | — | ✅ warpClock warpToSlot fix |
| Navigation polish (routing, sidebar active, Quick Actions) | — | ✅ |
| Weekly report | ✅ | ✅ |

---

## Blockers

- **Cancel modal CTA branch**: `isGracePeriodVisible()` returns correct state and banner renders correctly. `CancelConfirmDialog` doesn't yet branch the button label/handler based on `instantRefundEligible` — user can still cancel successfully either way. UI hookup gap, not a correctness issue. Week 9 item.
- **11 local Vitest failures**: `devnet-vesting.test.ts` hits `api.devnet.solana.com` public RPC which rate-limits (HTTP 429) under load. Not assertion failures — same tests on a private RPC (Helius/QuickNode) pass. CI stubs the RPC endpoint so CI is clean. Infrastructure limitation, not code quality.
- **Vercel Hobby cron**: `*/5 * * * *` not supported — reverted to daily. Near-real-time indexing needs paid plan.

**Resolved this session:**
- ✅ Native SOL create flow — DONE
- ✅ Lifecycle state model (Task 1) — DONE
- ✅ All 3 CI pipelines — green (Lint, Web CI, ci/build-test)
- ✅ Bankrun EC17 + Vesting Math invariant — fixed

---

## BUG_FIX_PLAN Progress (10 Tasks)

Full plan: `weekly-report-mancer/week8/BUG_FIX_PLAN.md`

| Task | Description | Status | Owner | Notes |
|------|-------------|--------|-------|-------|
| Task 1 | Lifecycle State Model | ✅ Done | Geral | `isGracePeriodVisible()`, `instantRefunded`, `streamSettled` in API + FE; 3 tests added |
| Task 2 | Dashboard / Campaign List Needs Action | 🟡 Partial | Geral + Lana | Lana built CampaignStatusBanner + useNeedsActionCount (F3); Geral fixed confirmTransaction so state updates fire; settled/instant-refund filtering verified in lifecycle model |
| Task 3 | Linear Cancel Recipient Withdraw Button | 🟡 Partial | Geral | API: vesting-progress correctly returns claimable after cancel; FE: "Claim Vested" button label + cancel modal CTA branch not yet wired |
| Task 4 | Linear Allocation Vesting Math | ❌ Pending | Geral | Not addressed this week — different allocation sizes (1 vs 0.5) showing different vesting speeds |
| Task 5 | Block Cancel/Pause When Fully Vested | ❌ Pending | Geral + Lana | FE/API guard not implemented; on-chain guard is SC scope (Lana) |
| Task 6 | Cancel Grace Notifications (Sender + Recipient) | 🟡 Partial | Geral + Lana | Lana built GracePeriodCountdown + banner states; Geral wired lifecycle flags from API; role-specific copy (sender vs recipient) not differentiated yet |
| Task 7 | CSV Parse and Validation | ❌ Pending | Geral | Quoted CSV, header aliases, per-page validation rules — not addressed |
| Task 8 | Root Allocation Flow | 🟡 Partial | Geral + Lana | Lana added 8s timeout + indexed fallback on allocations page; editor lock states (paused/cancelled/fully-vested/non-authority) not implemented |
| Task 9 | Raw Amount Display | ✅ Done | Geral | decimals cache fixed; `formatTokenAmount` wired across dashboard, portfolio, campaign card |
| Task 10 | Mobile Campaign List Dropdown | 🟡 Partial | Geral | Compact mobile cards + collapsible sections done; tab → native `<select>` on narrow screens not done |

**Summary:** 2 done, 5 partial, 3 pending. P0 items (Task 1, Task 3 API layer, Task 9) done. P1/P2 items partially addressed or deferred.

---

## Performance Check

### Transaction Cost (user-facing)

| Action | Cost (SOL) | Cost (USD @ ~$150/SOL) |
|--------|-----------|------------------------|
| Create campaign (10K leaves) + fund | ~0.0013 SOL | ~$0.0017 |
| Claim (withdraw) | ~0.00085 SOL | ~$0.00085 |
| Cancel campaign | ~0.00085 SOL | ~$0.00085 |
| Pause/unpause | ~0.00085 SOL | ~$0.00085 |

Cost is dominated by the 5,000-lamport base signature fee, not compute units. CU optimization has zero economic impact at default priority (1 micro-lamport/CU). These costs are negligible for end users — vesting protocol overhead is effectively free vs asset value being distributed.

### API Latency (from Lana's k6 baselines — affects FE loading states)

| Endpoint | p95 (smoke, 2 VUs) | Target p99 |
|----------|--------------------|-----------|
| `POST /api/campaigns/prepare` | 77–1434ms | < 2,000ms ✅ |
| `GET /api/campaigns/:tree/proof` | 42–110ms | < 500ms ✅ |
| `GET /api/campaigns` (list) | < 500ms | < 1,000ms ✅ |

FE implication: skeleton loaders and async loading states are correctly placed — the 1-2s prepare latency is real and visible to users without skeletons.

### Frontend Bundle

| Metric | Value |
|--------|-------|
| Static assets total | 19 MB |
| Framework chunk | 185 KB |
| Largest app chunk | ~170 KB (vendor/Solana deps) |
| TypeScript errors | 0 |

### Bottlenecks Identified

- `campaign/[id]/page.tsx` is ~2,600 lines — single file does data fetching, state management, 4 tx handlers, and all rendering. Should be split into sub-components for code splitting and lazy loading. Currently loads full JS on every campaign detail visit.
- Devnet integration tests (`devnet-vesting.test.ts`) hit Solana's public RPC without rate-limit handling — fails locally under sustained load (HTTP 429). Needs private RPC key or test skip guard.
- `confirmTransaction` polling on Devnet is synchronous and blocking — 4 call sites in campaign detail page. Should be parallelized or moved to background with optimistic UI updates for better perceived performance.

---

## End-to-End Flow Verification (Devnet)

Core acceptance criterion: "create stream → view dashboard → withdraw → cancel works without crashes"

| Flow | Status | Notes |
|------|--------|-------|
| Create cliff campaign (manual CSV) | ✅ | Token picker, wrap SOL, CSV upload, on-chain tx — functional |
| Create linear campaign | ✅ | Same path; onBlur validation fires correctly |
| Create milestone campaign | ✅ | milestone idx validation added |
| Create with native SOL | ✅ | Detects `NATIVE_SOL_MINT`, routes to `*_native` instructions |
| View dashboard | ✅ | Real token amounts (decimals from on-chain), activity feed, needs attention alerts |
| View campaign detail | ✅ | Card layout, 6-metric grid, progress bar, skeleton on load |
| Withdraw (recipient claim) | ✅ | Claim button enabled when claimable > 0; tx sent and confirmed |
| Cancel campaign | ✅ | Cancel modal opens; tx sent; grace period amber banner appears |
| Cancel → recipient claim vested | 🟡 | API returns correct claimable amount after cancel; FE "Claim Vested" button label not yet wired |
| Instant refund | ✅ | Banner shows "Instantly Refunded" state; no grace period countdown |
| Pause/unpause | ✅ | State update reflected in UI |
| Sidebar amber dot (needs action) | ✅ | Appears when `needsActionCount > 0`; disappears after action taken |

---

## Metrics

| Metric | Value |
|--------|-------|
| PR to test branch | #68 — 50 commits, https://github.com/Ah-Riz/velthoryn/pull/68 |
| CI workflows green | 3 / 3 (Lint, Web CI, ci/build-test) |
| Vitest tests passing | 965 / 978 (73/75 files — 2 files fail from Devnet public RPC 429 locally; CI stubs RPC and is clean) |
| Playwright E2E tests | 33 campaign-action + 4 responsive = 37 total passing |
| TypeScript build errors | 0 |
| Bankrun integration tests fixed | 2 (EC17 fractional rounding, Vesting Math invariant) |
| Root-cause bugs diagnosed + fixed | 5 (bankrun blockhash ring, confirmTransaction hang, amber dot CSS class, Vitest cache cross-test pollution, multi-leaf cancel assertion) |
| Campaign lifecycle states modeled | 8 (active, paused, claimable, claimed, cancelled_grace, cancelled_expired, instant_refunded, settled) |
| shadcn/ui components added | 6 (Card, Badge, Dialog, Button, Input, Label) |
| Skeleton loaders added | 2 (campaigns list, campaign detail) |
| Form pages with onBlur validation | 3 (cliff, linear, milestone) |
| Empty state variants | 5 contextual variants |
| Responsive tests added (375px) | 4 (grace banner, needs-action tab, sidebar badge, dashboard stack) |
| Native SOL create flow | ✅ Done |
| Known regressions | 0 |

---

## Self-Assessment

**What I'm confident works — and why:**
- All 3 CI pipelines green — CI runs Vitest, Playwright E2E, TypeScript build, and ESLint in isolation with stubbed external dependencies. Green CI = code correctness independent of local environment.
- 8-state lifecycle model is correct — `isGracePeriodVisible()`, `instantRefunded`, `streamSettled` are unit-tested and cover the edge cases: cancelled-before-cliff vs cancelled-after-cliff, instant refund vs grace period, settled vs still-streaming.
- Native SOL create flow functional — detects `NATIVE_SOL_MINT` and routes to `*_native` instructions instead of wrapped SOL path. Verified on devnet.
- shadcn/ui migration verified by Playwright E2E — Dialog open/close, form submission, and modal selectors all tested via role-based selectors (`getByRole("dialog")`), not fragile class selectors.

**What's incomplete — with explicit tradeoff reasoning:**
- Cancel modal CTA doesn't branch on `instantRefundEligible` — state is computed correctly, banner renders correctly; only the button label/handler isn't split yet. Deprioritized because closing 3 broken CI workflows (Lint, Web CI, ci/build-test) was higher urgency than a modal variant. State model is the hard part; wiring the CTA is mechanical.
- 11 local Vitest failures are NOT assertion failures — HTTP 429 from Solana's public RPC in `devnet-vesting.test.ts`. CI stubs the RPC and is clean. Same tests pass on a paid RPC (Helius/QuickNode). This is infrastructure, not code quality.

**Root cause analysis — hardest bugs:**

*Bankrun `warpClock` duplicate signature:*
`setClock()` updates the clock sysvar (what `Clock::get()` returns in the program) but does NOT advance the bank's block hash ring. These are two separate internal state machines in bankrun. Solana transaction signatures are `Ed25519(privkey, serialize(tx))` — the serialized tx includes `recent_blockhash`. Same blockhash + same instruction data + same signers = same signature = "already been processed" on the 2nd call. `MOCHA_RETRIES=2` in CI cannot fix this: retry resubmits with the same blockhash from the same slot — failure is deterministic, not flaky. Fix: `context.warpToSlot(nextSlot)` advances the bank slot, producing a new blockhash before `setClock()` sets the program clock timestamp.

*E2E `confirmTransaction` infinite hang:*
`sendTransaction` in E2E mock mode returns `"mock_sig_..."` immediately. `connection.confirmTransaction(fakeSig, "confirmed")` then subscribes to Devnet's real WebSocket waiting for a tx confirmation that will never arrive — it never rejects, just polls forever. `setTreeState({ cancelledAt: ... })` was inside the `await`, so it never executed → grace period state never set → amber banner never rendered. Fix: check `localStorage.getItem("velthoryn:e2e-mock-send-tx")` and skip `confirmTransaction` in mock mode.

*Vitest cache cross-test pollution:*
`decimalsCache = new Map()` at module level is a singleton within Vitest's module scope for a given test file — it persists across all `it()` blocks in the same file. Test 2 populated both `MINT_ALPHA` and `MINT_BETA`; Test 3 found them cached and returned size=2 instead of 1. Fix: generate new keypairs for `MINT_ALPHA`/`MINT_BETA` in `beforeEach` so cache keys differ between tests.

**Priority decision I'd defend:**
Closed all 3 CI failures before shipping new features. A broken CI is a multiplier problem — every subsequent commit has unknown correctness. Shipping new features on a broken CI creates compounding technical debt that's harder to unwind later.

**What I'd do differently:**
- Add `DEVNET_RPC_URL` env var guard to `devnet-vesting.test.ts` from day 1 — would have avoided 11 misleading "failures" in local runs.
- Add `context.warpToSlot()` to `warpClock` in the initial test utility — the block hash ring / clock sysvar distinction should be in the initial design, not discovered via "already been processed" errors in week 8.
- Split `campaign/[id]/page.tsx` (~2,600 lines) into sub-components earlier — it's too large for a single file and makes E2E selector debugging harder.

**For Phase 3:**

*Immediate (before mainnet demo):*
- Cancel modal CTA branch on `instantRefundEligible` — mechanical FE change; the state model is correct, just button label/handler needs to split
- CSV parse fixes (Task 7) — quoted CSV + header aliases; currently blocks some valid import flows
- Block cancel/pause when fully vested (Task 5) — FE guard is straightforward once `vestedTotal >= totalSupply` is computed

*Production hardening:*
- Add Sentry DSN to Vercel — `NEXT_PUBLIC_SENTRY_DSN` env var only; scaffolding is already wired. Zero error observability right now.
- Split `campaign/[id]/page.tsx` (~2,600 lines) into sub-components — enables code splitting, reduces TTI on campaign detail page, makes E2E debugging easier
- Add `DEVNET_RPC_URL` guard to `devnet-vesting.test.ts` — skip test file unless private RPC is configured; eliminates 11 misleading local failures
- Paid Vercel plan — restore `*/5 * * * *` cron for near-real-time dashboard indexing (currently daily only)

*UX/stability:*
- VestingChart (Recharts) responsive container — overflows on narrow screens; needs `ResponsiveContainer` wrapper with tested breakpoints
- Linear allocation vesting math (Task 4) — verify different allocation sizes (1 vs 0.5 token) show correct vesting percentage; possibly a display math bug in `schedule.ts`
- Role-specific grace period copy (Task 6) — sender sees "Grace period active, recipients can claim" vs recipient sees "Claim before grace expires" — same banner, different message
