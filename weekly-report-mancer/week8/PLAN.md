# Week 8 Work Plan — Geral

**Due:** 2026-06-13
**Score breakdown:** Product Stability (15) + Problem Solving (15) + Self-Assessment (10) + Performance (5) + Insight (5) = 50 pts

---

## Current State (as of 2026-06-10)

### Already merged from `test` branch into `dev_geral`
- 106 files changed, +9,953 / -790 lines
- 35+ commits covering: transparency dashboard, clawback UI, real token amounts, minCliffTime, mainnet hardening, CU benchmarks, multisig support
- 15 P0/P1 bugs fixed this week (auth routes, milestone claiming, claim accumulation, minCliffTime, etc.)

### What's working end-to-end
- Create stream (cliff / linear / milestone) → view dashboard → claim → cancel → withdraw unvested
- 26 API routes: all implemented, no stubs
- 20 React hooks: all complete
- 540+ vitest tests, 253+ E2E Playwright tests, 72 Mollusk on-chain tests

### Known limitations (documented, not fixed)
- 19 Rust tests `#[ignore]`d — Mollusk 0.13 upstream blocker
- Withdraw unvested happy path — untestable (7-day grace period)
- Sentry DSN not configured in production
- External audit not yet engaged (blocks mainnet)
- 6 CU measurements are estimates (Mollusk blocked for SPL path)

---

## Execution Order

### Day 1 AM — P1: Test Suite Stability
- Run `pnpm run test` → vitest all pass
- Run `pnpm run test:e2e` → playwright all pass
- Fix any regressions from test branch merge
- Verify no new failures

### Day 1 PM — P2a: Loading State Polish
- **campaigns/page.tsx** — replace "Loading streams..." with skeleton rows (6x animate-pulse cards)
- **dashboard/page.tsx** — verify skeleton states are consistent
- **campaign/[id]/page.tsx** — review all loading paths

### Day 2 AM — P2b + P2c: Empty States & Form UX
- Improve empty campaign list CTA (more helpful message)
- Better API unavailable fallback on campaigns page
- Real-time form validation on cliff/linear/milestone create pages
- Inline field error messages

### Day 2 PM — P2d + P2e: Navigation & Visual Polish
- Mobile responsiveness audit (sidebar, forms, charts)
- Active nav highlighting on all routes
- Button hover/disabled states consistency
- Toast notification verify
- Progress bar animations

### Day 2 PM — P3: Performance Check
- Measure tx times on devnet: create, claim, cancel, withdraw
- Run `pnpm run build` → check bundle size output
- Check RPC call efficiency (duplicate calls)
- Reference `docs/CU_BUDGET.md` for on-chain CU data

### Day 3 AM — P4: Status Report
Update/finalize `STATUS_REPORT.md`:
- What's working (with evidence: test counts, tx speeds, CU budgets)
- What's not (12 known limitations)
- Performance findings
- Phase 3 recommendations
- Share with BD + Marketing

### Day 3 AM — P5: Weekly Report (Geral.md)
Write `weekly-report-mancer/week8/Geral.md`:
- MY specific contributions (with commit references)
- Work split with Lana
- Blockers + insights
- Link to PR + deployed URL

### Day 3 PM — Final
- Create PR from `dev_geral` → `main`
- Verify deployment on Vercel

---

## Files to Modify

| File | Change |
|------|--------|
| `apps/web/src/app/(app)/campaigns/page.tsx` | Skeleton loader |
| `apps/web/src/app/(app)/dashboard/page.tsx` | Loading polish |
| `apps/web/src/app/(app)/campaign/[id]/page.tsx` | Loading/error polish |
| `apps/web/src/app/(app)/campaign/create/cliff/page.tsx` | Real-time validation |
| `apps/web/src/app/(app)/campaign/create/linear/page.tsx` | Real-time validation |
| `apps/web/src/app/(app)/campaign/create/milestone/page.tsx` | Real-time validation |
| `apps/web/src/app/(app)/portfolio/page.tsx` | Minor polish |
| `weekly-report-mancer/week8/Geral.md` | Individual report |

### Already Done This Session
- [x] Merged `test` branch → `dev_geral` (35+ commits, 106 files)
- [x] Footer "Open app" → redirects to `/dashboard`
- [x] Quick Actions moved to top of dashboard
- [x] vitest config fix (cluster.test.ts alias)
- [x] Skeleton loaders (campaigns list, campaign detail)
- [x] Contextual empty states + error UI
- [x] onBlur validation (cliff, linear, milestone)
- [x] Nav active state fix (campaign detail → My Campaigns)
- [x] Progress bar animations
- [x] Button disabled states
- [x] Geral.md weekly report written
- [x] Committed (without this file + task.md)

---

## Acceptance Criteria (from task brief)

- [x] All known bugs from Week 4–7 fixed or documented as known limitations
- [x] Product works E2E on devnet without crashes: create → dashboard → withdraw → cancel
- [x] Performance check done: tx times, costs, bottlenecks documented
- [x] Status report: what works, what doesn't, known bugs, Phase 3 recommendations
- [ ] Status report shared with BD + Marketing (needs Google Doc submission)
