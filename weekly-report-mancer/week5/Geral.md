nb# Weekly Report — Geral (Week 5)

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

### Security Hardening & Gap Analysis (May 22)

Full security audit + gap analysis against Sablier/Streamflow:
- CSP headers + X-Frame-Options + XCTO + Referrer-Policy + Permissions-Policy
- `cargo clippy --workspace -- -D warnings` clean (0 warnings)
- No `unwrap()`/`todo!()`/`unimplemented!()` in production Rust code
- Error messages filtered to prevent internal state leakage
- DB truncation guard (blocks TRUNCATE on Supabase/pooler URLs in tests)
- `pnpm audit`: next.js upgraded 15.5.15 → 15.5.18 (0 critical)
- Root rotation confirmation dialog, pause authority warning, 60s min cliff validation
- Identified critical Pause+Cancel exploit (documented in `research-docs/week5/fix.md`)

### UI Redesign — Per-Stream Card System (May 22)

Complete redesign of all 3 create pages:
- **Cliff page**: General Details card + per-stream cards (amount, recipient, start, cliff, Apply All)
- **Linear page**: Same pattern + optional cliff + end time per card
- **Milestone page**: Shared recipient + per-milestone cards (amount, unlock time, auto-index)
- Manual/CSV mode toggle, form reset, token symbol + Max button
- CSV: file upload, download template per type, human-readable datetime, duplicate beneficiary validation

### Claim Flow Fixes (May 22)

- Fixed `toAnchorLeaf`: camelCase (Anchor auto-converts to snake_case)
- Fixed `handleWithdraw`: raw unix timestamps (datetime-local truncates seconds)
- Multi-leaf claim selector with per-beneficiary ClaimRecord status
- Claim sync to DB with 3x retry, cancel dialog amount formatting

### Sablier-Style Token Picker + SOL Wrap (May 22)

- Redesigned TokenPickerModal: dark theme, search, solscan links
- SOL "Wrap required" → WrapSolModal; wSOL separate selectable row
- `useWrapSol` hook: wrap (createATA + transfer + syncNative) / unwrap (closeAccount)
- Success animation, correct SOL/wSOL balance display, auto-refetch after wrap

### Real-Time Dashboard (May 22)

- WebSocket subscription for campaign detail auto-refresh
- 30s polling for campaign list + beneficiary campaigns
- Claimable banner + "As Recipient" stat card
- Implements Feature #2 from Week 2 research (Transparency / Real-Time Dashboard)

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
| SOL wrap/unwrap modal | Sablier-style, success animation, auto-refetch |
| Vesting curve chart (SVG) | Cliff/Linear/Milestone visualization |
| CSV bulk upload + file drag-and-drop | Template download per type, human-readable datetime |
| Real-time dashboard | WebSocket + 30s polling, claimable banner |
| Security headers (CSP) | All major headers configured |
| Multi-leaf claim selector | Per-beneficiary claimed status from ClaimRecord PDA |

### Not yet demo'd (needs setup)

| Item | Blocker |
|---|---|
| Multi-milestone release panel (live) | Needs multi-recipient campaign — script created (`scripts/create-multi-milestone.ts`) |
| FIX-1: Pause+Cancel exploit | Needs smart contract change (Lana's domain) |

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
| Components created | **30+** (campaign detail, create, list, landing, token picker, wrap modal) |
| Custom hooks | **16** (+ useWrapSol, useWSOLBalance) |
| Test files | **39** |
| Tests passing | **393** |
| Authority helpers | **6** |
| Program instructions with UI | **14/14** (100%) |
| Error codes mapped | **34** (all with user-friendly messages) |
| Security checklist items done | **13/15** (93%) |
| Week 2 priority features implemented | **4/4** (100%) |
| Lines added (total across all commits) | **~16,000+** |
| Landing page components | **15** |
| Build status | ✅ Clean |
| Deployment | ✅ velthoryn.vercel.app |
| CI | ✅ Lint + Web CI pass |
