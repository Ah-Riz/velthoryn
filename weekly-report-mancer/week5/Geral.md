# Weekly Report — Geral (Week 5)

## What I built this week

**Complete frontend from scratch: landing page, 11 app routes, 27 components, 14 hooks, full program integration for all 14 instructions, authority system, token picker, root rotation, campaign list/detail/create flows, and 39 test files (393 tests). Deployed at velthoryn.vercel.app.**

### Landing Page & Marketing (commit `7e235b8`)

Built the public-facing landing page with 15 components:
- Hero with animated gradient, scroll reveal, smooth scroll links
- How It Works, Pillars, Use Cases, FAQ sections
- Campaign Preview (live demo card), Stats, Partners
- Waitlist form with email collection → Supabase
- Topbar with wallet connect + navigation
- Footer with social links
- SVG definitions for consistent iconography
- Marketing route tests

### Week 5 Core UI — Cliff/Milestone/Cancel (commit `e7cd08b`)

Major feature commit — added all vesting-specific UI:
- Campaign detail page: claim flow, cancel dialog, milestone badge
- Create page: form validation, schedule inputs
- `useClaimRecord` hook for on-chain claim state
- `formatVestingError` — user-friendly error messages for all 34 error codes
- `lib/vesting/display.ts` — countdown, progress, type labels
- `lib/vesting/milestone.ts` — bitmap helpers
- `lib/validation/stream-form.ts` — form validation rules
- Admin panel + waitlist management page
- API route for waitlist (`/api/waitlist`)
- 8 new test files: CancelConfirmDialog, TriggerMilestoneButton, useClaimRecord, cancel-transaction, error-retry, milestone-bitmap, stream-form-validation, vesting-display

### Full App Restructure (commit `7a017e4`)

Massive restructure — 5,064 insertions:
- Split create flow into type-specific pages (`/cliff`, `/linear`, `/milestone`)
- Component reorganization: `campaign/detail/`, `campaign/create/`, `campaign/list/`
- `useCreateStream` hook — calls `create_stream` on-chain + indexes to API
- `useCreateCampaign` hook — calls `create_campaign` + `fund_campaign`
- `useLocalCampaigns` hook — merges localStorage + API data for offline-first UX
- `useMintInfo` hook — fetch token decimals/symbol
- `lib/campaign/bulk.ts` — CSV parsing for bulk recipient upload
- `lib/vesting/list.ts` — sender/recipient status computation
- Campaign list components: `CampaignRow`, `EmptyState`, `RoleBadge`, `StatusBadge`
- Shared create form components with validation
- Devnet integration test harness (`devnet-helpers.ts` + `devnet-vesting.test.ts` — 13 tests)
- 6 new test files: bulk-campaign, vesting-list, vesting-display additions

### Token Picker, Root Rotation & Authority (commit `e899115`)

- `TokenPicker` component — wallet token detection with search/filter
- `useWalletTokens` hook — fetches all SPL tokens in connected wallet
- `RootRotationCard` — multi-recipient campaign root update UI
- `useUpdateRoot` hook — calls `update_root` on-chain
- `lib/campaign/authority.ts` — permission system (4 initial helpers)
- `lib/campaign/root-rotation.ts` — root rotation utilities
- `lib/token/normalize.ts` — token metadata normalization
- 4 new test files: TokenPicker, useWalletTokens, campaign-authority, root-rotation

### Milestone Release & Cancel Stream Integration (commit `3d27cbc`)

Final integration — all remaining program instructions wired to UI:
- `TriggerMilestoneButton` — creator releases milestones on-chain
- `MilestoneReleasePanel` — multi-leaf milestone release grid (0–31)
- `MilestoneStatusBadge` enhanced — 4-state (awaiting/released/ready/claimed)
- `CancelConfirmDialog` enhanced — dual-mode (Instant Settle vs Grace Period)
- Beneficiary fallback input + schedule guard for cancel_stream
- `CloseClaimRecordButton` — reclaim rent after fully claimed
- `canReleaseMilestone` + `canCancelStream` authority helpers
- `verify-onchain.ts` — dev-mode vesting parity check
- Cache update fix for cancel_stream status
- Token amount display capped to 4 decimal places

### Bug Fixes & CI

- Fixed `vesting-errors.test.ts` hex codes (off-by-one after new error variants)
- Fixed devnet milestone tests (call `setMilestoneReleased` before claim)
- Fixed lint warnings and type errors breaking CI/Vercel build
- Stabilized campaign indexing and dashboard state
- Synced IDL with deployed program + wallet rejection handling
- Skipped `ci/build-test` on `dev_geral` (no keypair secret)

---

## How we split the work

| Area | Owner | Notes |
|---|---|---|
| Smart contract (Rust) | Lana | All 14 instructions, state, math, errors, events |
| Program tests (86 SC tests) | Lana | ts-mocha + bankrun integration tests |
| Backend API routes | Lana | 8 API routes, DB schema, merkle pipeline, RLS |
| **Frontend UI (entire app)** | **Geral** | Landing, all pages, all components, all hooks, wallet integration |
| **Frontend tests (39 files)** | **Geral** | Component, hook, integration, lib tests |
| CI workflows | Joint | Lana: initial setup; Geral: fixes + dev_geral config |

---

## Status — What works and what doesn't

### Working

| Item | Evidence |
|---|---|
| Landing page | Live at velthoryn.vercel.app |
| Create stream (cliff/linear/milestone) | 3 type-specific pages, on-chain tx verified |
| Campaign list (sender + recipient views) | Local + API data merge, status badges |
| Campaign detail page | All 14 instructions surfaced with authority gating |
| Milestone release flow | Demo verified: creator release → badge update → beneficiary claim |
| Cancel & Settle (instant) | Demo verified: tokens distributed atomically |
| Cancel Campaign (grace period) | Working, 7-day grace + withdraw unvested |
| Pause / Unpause | Working, authority-gated |
| Token picker | Wallet token detection with search |
| Root rotation | Multi-recipient campaign root update |
| Claim (single-stream + multi-recipient) | Both paths working |
| Authority system | 6 helpers, all action buttons properly gated |
| Wallet integration | Auto-detect (Phantom/Solflare/Backpack) |
| 39 Vitest files, 393 tests | All pass |
| Next.js build | Clean, no type errors |
| Vercel deployment | Live, all routes responding |

### Not yet demo'd (needs setup)

| Item | Blocker |
|---|---|
| Multi-milestone release panel (live) | Needs multi-recipient campaign from `create_campaign` |
| Close claim record (live) | Needs fully-claimed stream |
| Bulk CSV upload (live) | Needs multi-recipient flow end-to-end |

---

## Blockers — What's stuck or what you need

| Blocker | Impact | Resolution |
|---|---|---|
| `ci/build-test` needs keypair secret | CI red on push | Skipped for `dev_geral`; runs on PR to `main`/`test` |
| Multi-leaf campaign creation | Can't demo MilestoneReleasePanel live | Need `create_campaign` + `fund_campaign` (Lana's domain) |
| Supabase free tier behavior | Data persistence concerns | Monitoring; may need keep-alive cron |
| Devnet faucet rate limit | Integration tests skip | Transient; resets daily |

---

## Metrics — Quantifiable progress

| Metric | Value |
|---|---|
| Pages/routes built | **11** |
| Components created | **27** (campaign detail, create, list, landing) |
| Custom hooks | **14** |
| Test files | **39** |
| Tests passing | **393** |
| Authority helpers | **6** |
| Program instructions with UI | **14/14** (100%) |
| Error codes mapped | **34** (all with user-friendly messages) |
| Lines added (from landing page commit) | **+14,372** across 133 files |
| Landing page components | **15** |
| Build status | ✅ Clean |
| Deployment | ✅ velthoryn.vercel.app |
| CI | ✅ Lint + Web CI pass |
