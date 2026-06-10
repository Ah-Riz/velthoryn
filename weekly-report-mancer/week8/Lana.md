# Weekly Report — Lana (Week 8)

**Scope:** BE-DB-SC-Merkle (backend API, Postgres/indexer, Solana program, Merkle client). Frontend UI is out of scope unless noted as a dependency on Geral.

**This week (chronological):** Week 7 report review + backlog analysis → exploration (Mollusk tests, BE infra, security/ops) → **Mollusk 0.13.1 bump + 18 IGNORED comment standardization** → **production code quality sweep (`.expect()` → `.ok_or()`, clippy suppressions 4→2, unused import fix)** → **CU budget audit (8 new benchmarks, 12/18 handlers measured)** → **multisig setup docs + devnet test script** → **mainnet readiness checklist** → **CI hardening (Mollusk + proptest + cargo audit)** → **Week 8 L1/P0 fixes (8 issues: root rotation minCliffTime, API auth, base58 validation, race condition 409, migration 0010, PDA seed docs)** → **Week 8 QA sweep (7 bugs found & fixed across SC/BE/FE)** → **Transparency Dashboard UI (F2: dashboard rewrite, portfolio page, activity feed, hooks)** → **Auto Clawback UI surfaces (F3: banner, countdown, sidebar badge, needs-action tab, dashboard section)** → **Cron reverted to daily (Vercel Hobby limitation)**.

---

## Status — What works and what doesn't

### Working

| Area | Item | Evidence |
|------|------|----------|
| **SC** | Mollusk 0.13.1 bump | `programs/vesting/Cargo.toml` — all three mollusk crates pinned to `0.13.1` |
| **SC** | 18 IGNORED test comments standardized | `tests/cancel.rs` (9), `tests/admin.rs` (6), `tests/cleanup.rs` (3) — all use `// IGNORED: Mollusk 0.13.x limitation —` format |
| **SC** | 8 new CU benchmark tests | `tests/benchmarks.rs` — create_stream_native, fund_campaign_native, cancel_campaign, set_milestone_released, update_root, pause/unpause, close_claim_record |
| **SC** | 9/10 benchmarks pass, 1 ignored | `bench_claim_native` ignored (init_if_needed limitation) |
| **SC** | Production code quality improved | 5 `.expect()` → `.ok_or(VestingError::WrongVault)?` in claim, withdraw, cancel_stream, withdraw_unvested, instant_refund_campaign |
| **SC** | Clippy suppressions reduced 4→2 | `lint.yml` — removed `unused_imports` + `clippy::diverging_sub_expression`; fixed root cause (unused import in merkle.rs) |
| **SC** | Clippy clean | `cargo clippy -- -D warnings -A unexpected_cfgs -A ambiguous_glob_reexports` — zero findings |
| **SC** | Lib tests pass | `cargo test --lib` — 31 tests pass (merkle + schedule unit + proptest) |
| **Docs** | CU budget document | `docs/CU_BUDGET.md` — all 18 handlers with measured/estimated CU, recommended compute limits, rent costs, client integration examples |
| **Docs** | Mainnet readiness checklist | `docs/MAINNET_CHECKLIST.md` — 5 sections (~60 checkboxes): pre-deployment, security, infrastructure, deployment procedure, rollback |
| **Docs** | Multisig setup runbook | `docs/operations/multisig-setup.md` — Squads v4 2-of-3 multisig procedure with CLI commands, verification steps, rollback |
| **Scripts** | Devnet multisig test script | `scripts/test-multisig-transfer.sh` — generates fresh keypair, deploys, transfers authority, verifies, restores on cleanup |
| **CI** | Mollusk tests in CI | `ci.yml` — runs 72 active Mollusk tests across 8 test files after anchor build |
| **CI** | Proptest in CI | `ci.yml` — runs `cargo test --lib` (31 tests including 18 proptest properties) |
| **CI** | Cargo audit in CI | `ci.yml` — installs and runs `cargo audit` before build |
| **QA** | 7 bugs found & fixed | P0: out-of-order milestone claiming (FE), StreamExpired multi-leaf (SC). P1: total_entitled accumulation (SC), milestoneIdx bounds + dedup (BE). P2: VestingProgress release check, MilestoneReleasePanel indices (BE/FE) |
| **QA** | ClaimWithProofButton milestone fix | `ClaimWithProofButton.tsx` — milestone leaves use on-chain `milestoneBitmap` instead of greedy `claimedAmount` allocation |
| **QA** | claim.rs StreamExpired fix | `claim.rs:149` — removed `fully_claimed` sub-condition that blocked multi-leaf claims |
| **QA** | total_entitled accumulation | `claim.rs:113-121` — accumulates across milestone claims via `checked_add` |
| **QA** | milestoneIdx validation | `validators.ts` — `.max(255)` on all 3 Zod schemas; `prepare/route.ts` — duplicate `(beneficiary, milestoneIdx)` check |
| **QA** | VestingProgress milestone check | `vesting-progress/route.ts` — LEFT JOIN `milestone_events`, zeroes `claimable` for unreleased milestones |
| **QA** | MilestoneReleasePanel real indices | Panel uses `milestoneIndices` from API (derived from actual leaves) instead of `leafCount` |
| **FE** | Transparency Dashboard (F2) rewrite | `dashboard/page.tsx` (481 lines) — claimable banner, 6 stat cards (Total Streams, Active, TVL, As Sender, As Recipient, Claimable Now), vesting progress cards (top 5), recent activity feed, needs attention alerts |
| **FE** | Portfolio page (F2) | `portfolio/page.tsx` (331 lines) — 4 summary stats, per-campaign cards with progress bars + sort (by claimable/progress/next unlock) |
| **FE** | ActivityFeed component (F2) | `components/dashboard/ActivityFeed.tsx` (122 lines) — cross-campaign event feed with 8 event types, Solana explorer links |
| **FE** | Activity API route (F2) | `/api/activity/[address]/route.ts` (201 lines) — CTE + UNION ALL across 8 event tables, filtered to user's campaigns |
| **FE** | Timeline helpers extraction (F2) | `lib/vesting/timeline-helpers.ts` (114 lines) — shared `EVENT_CONFIG`, `eventDescription`, `formatBlockTime`, `formatAmount` for CampaignTimeline + ActivityFeed |
| **FE** | Vesting progress hooks (F2) | `useVestingProgress` + `useVestingProgressSummary` — fetch + aggregate BigInt totals; `useRecentActivity` — cross-campaign activity |
| **FE** | `useMintDecimals` integration (F2) | Dashboard + portfolio use on-chain mint decimals for real token amounts (not raw lamports) |
| **FE** | Sidebar Portfolio nav (F2) | Added "Portfolio" item between Dashboard and Create Stream in Sidebar.tsx |
| **FE** | CampaignStatusBanner (F3) | `components/campaign/detail/CampaignStatusBanner.tsx` (124 lines) — 7 states: null, instant-refunded, grace-active, grace-expired, settled, unfunded |
| **FE** | GracePeriodCountdown (F3) | `components/campaign/detail/GracePeriodCountdown.tsx` (45 lines) — 60s interval, amber/red color logic |
| **FE** | useNeedsActionCount hook (F3) | `hooks/useNeedsActionCount.ts` (53 lines) — counts cancelled sender campaigns + claimable recipient campaigns |
| **FE** | Sidebar amber dot badge (F3) | Amber dot on "My Campaigns" nav when `needsActionCount > 0` |
| **FE** | Needs Action tab (F3) | Campaigns list `action` tab — filters sender-cancelled + recipient-claimable campaigns |
| **FE** | Dashboard Needs Attention (F3) | Dashboard section with per-campaign grace period countdown + alert cards |
| **Tests** | Clawback API test suite | `apps/web/tests/api/clawback.test.ts` (681 lines) — cancel campaign (6), withdraw unvested (5), cancel stream (7), milestone release (5) |
| **Tests** | Clawback component tests | `CampaignStatusBanner.test.ts` (85 lines, 7 states), `GracePeriodCountdown.test.ts` (60 lines) |
| **Ops** | Cron schedule reverted | `vercel.json` — `*/5 * * * *` → `0 0 * * *` (daily). Vercel Hobby plan only supports daily crons |

### Incomplete / deferred

| Item | Owner | Notes |
|------|-------|-------|
| k6 load test expansion | Lana | Existing `api-load.js` covers basic endpoints; prepare/proof/spike scripts deferred |
| Mollusk 0.14+ upgrade | Lana | Blocked upstream; would unblock 18 ignored tests + 5 SPL handler tests |
| Sentry DSN in production | Ops | Scaffolding complete; needs `NEXT_PUBLIC_SENTRY_DSN` in Vercel env vars |
| Monitoring dashboard | Ops | Grafana/PagerDuty — infra, not code |
| External audit engagement | Ops | Firms identified (Halborn/OtterSec/Sec3); budget $15-40K; not an engineering task |
| FE: native SOL + instant refund | Geral | BE exposes fields + tx builders |
| Rate limiting | — | ALREADY DONE (Upstash Redis + in-memory fallback, per-route limits, all 25 routes wired) |
| API versioning | — | ALREADY DONE (`X-API-Version: 1` header on all responses) |
| Cron 5-min sync | Ops | Reverted to daily; Vercel Hobby limitation. Paid plan needed for `*/5 * * * *` |
| Component extraction | Lana | `ProgressBar`, `NeedsAttentionAlert`, `CampaignCard` are inline — could extract for reuse |

---

## Blockers — What's stuck or what you need

**No blockers in BE-DB-SC-Merkle.** All Week 8 tasks complete or deferred with clear owners.

| Dependency | Who | What |
|------------|-----|------|
| Cancel UI for instant vs grace | Geral | `instantRefundEligible` + `POST .../instant-refund` |
| Native SOL in create flows | Geral | Use `*_native` instructions when mint is `NATIVE_SOL_MINT` |
| Sentry DSN set in Vercel | Ops | One env var; scaffolding already works |
| External audit firm selected | Ops | Budget approval needed before engagement |

---

## Metrics — Quantifiable progress

| Metric | End of Week 7 | Week 8 Delta |
|--------|---------------|-------------|
| CU benchmark tests | 2 (get_vested_amount + create_campaign_native) | **+8** = 10 total |
| CU-measured handlers | 2/18 | **12/18** measured (+5 estimated for SPL/init_if_needed) |
| Clippy suppressions | 4 | **2** (removed `unused_imports` + `diverging_sub_expression`) |
| Production `.expect()` calls | 5 | **0** (all replaced with `.ok_or()`) |
| IGNORED comment format | Mixed | **18/18** standardized (`// IGNORED: Mollusk 0.13.x limitation —`) |
| CI test steps | 5 (merkle, anchor build, IDL check, bankrun, localnet) | **+3** (lib/proptest, Mollusk 8-file suite, cargo audit) |
| New docs | 0 this week | **3** (`CU_BUDGET.md`, `MAINNET_CHECKLIST.md`, `multisig-setup.md`) |
| New scripts | 0 this week | **1** (`test-multisig-transfer.sh`) |
| Bugs found | 0 | **15** (8 L1/P0 + 2 P0 + 3 P1 + 2 P2 from QA sweep) — found with senior-dev + code-reviewer + qa agents |
| Bugs fixed | 0 | **15** — all fixed, compiles clean, 31 Rust unit tests pass |
| Rate limiting | Thought incomplete | **ALREADY DONE** — discovered during exploration |
| API versioning | Thought incomplete | **ALREADY DONE** — discovered during exploration |
| FE pages (new/rewritten) | 0 | **+2** (dashboard rewrite 481 lines, portfolio page 331 lines) |
| FE components (new) | 0 | **+4** (`ActivityFeed`, `GracePeriodCountdown`, `CampaignStatusBanner`, timeline helpers) |
| FE hooks (new) | 0 | **+3** (`useVestingProgress` + `useVestingProgressSummary`, `useRecentActivity`, `useNeedsActionCount`) |
| API routes (new) | 20 | **+1** (`/api/activity/[address]` — cross-campaign activity feed) |
| FE tests (new) | 0 | **+4** (clawback API 681 lines, CampaignStatusBanner 85 lines, GracePeriodCountdown 60 lines, E2E campaign-actions) |

---

## What's Next (Week 9+)

### SC — Solana Program
- [ ] **Upgrade Mollusk 0.14+** — when available, activates 18 ignored tests + enables SPL handler tests
- [ ] **SPL handler tests** — claim/withdraw SPL path, create_stream SPL, create_campaign SPL, fund_campaign SPL
- [ ] **Formal CU budget audit** — re-measure with mainnet cluster parameters, set `compute_budget` limits
- [ ] **External audit** — engage firm after ops budget approval
- [ ] **Multi-leaf non-milestone tracking** — cumulative `claimed_amount` undercounts for beneficiaries with multiple cliff/linear leaves. Needs per-leaf tracking (breaking on-chain change) — see Known Issue #29 in `docs/WEEK8_KNOWN_ISSUES.md`
- [ ] **Out-of-order milestone E2E test** — add ts-mocha test: create 3-milestone campaign, claim 0→2→1, verify all succeed

### BE — Backend API
- [ ] **k6 load test expansion** — add prepare, proof, spike test scripts
- [ ] **Sentry live DSN** — ops sets env var in Vercel
- [ ] **Rate limit tuning** — adjust per-route limits based on k6 load test results
- [ ] **MilestoneReleasePanel cache invalidation** — after milestone release, invalidate `["campaign"]` and `["beneficiaryCampaigns"]` query keys (currently only invalidates `["timeline"]`)
- [ ] **Cron upgrade to paid Vercel plan** — restore `*/5 * * * *` sync schedule for near-real-time dashboard

### FE — Frontend
- [ ] **Component extraction** — extract `ProgressBar`, `NeedsAttentionAlert`, `CampaignCard` from inline in dashboard/portfolio pages
- [ ] **Native SOL create flows** — FE uses `*_native` instructions when mint = `NATIVE_SOL_MINT` (Geral dependency)
- [ ] **Instant refund UI** — Cancel UI distinguishes instant vs grace refund (Geral dependency)

### Security & Ops
- [ ] **Monitoring dashboard** — Grafana/PagerDuty for program + API health
- [ ] **Mainnet deploy** — follow `docs/MAINNET_CHECKLIST.md` after external audit
- [ ] **Multisig setup** — follow `docs/operations/multisig-setup.md` before mainnet
