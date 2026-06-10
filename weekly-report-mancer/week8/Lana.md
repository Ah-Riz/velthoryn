# Weekly Report — Lana (Week 8)

**Scope:** BE-DB-SC-Merkle (backend API, Postgres/indexer, Solana program, Merkle client). Frontend UI is in scope where I implemented F2/F3 dashboard and clawback surfaces directly.

**This week (chronological):** Week 7 report review + backlog analysis → exploration (Mollusk tests, BE infra, security/ops) → **Mollusk 0.13.1 bump + 18 IGNORED comment standardization** → **production code quality sweep (`.expect()` → `.ok_or()`, clippy suppressions 4→2, unused import fix)** → **CU budget audit (8 new benchmarks, 12/18 handlers measured)** → **multisig setup docs + devnet test script** → **mainnet readiness checklist** → **CI hardening (Mollusk + proptest + cargo audit)** → **Week 8 L1/P0 fixes (8 issues: root rotation minCliffTime, API auth, base58 validation, race condition 409, migration 0010, PDA seed docs)** → **Week 8 QA sweep (7 bugs found & fixed across SC/BE/FE)** → **Transparency Dashboard UI (F2: dashboard rewrite, portfolio page, activity feed, hooks)** → **Auto Clawback UI surfaces (F3: banner, countdown, sidebar badge, needs-action tab, dashboard section)** → **Cron reverted to daily (Vercel Hobby limitation)** → **UI primitive extraction + infra hardening** (`4a3e7a0`: shared components, migrations 0002–0005, E2E mock send-tx, claims/sync admin-only, trust-boundary docs, pending-work audit).

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
| **SC** | `total_entitled` first-touch guard | `claim.rs` — `is_first_touch` flag prevents double-accumulation on milestone claim init (`4a3e7a0`) |
| **SC** | Pause→cancel→claim clock test hardened | `tests/vesting.clock.spec.ts` — explicit day-25/50/53/58 warps, asserts `cancelledAt` frozen vesting + grace sweep amounts |
| **SC** | Supplementary security concepts expanded | `tests/vesting.supplementary.spec.ts` — +112 lines of pause/cancel/grace coverage |
| **Docs** | CU budget document | `docs/CU_BUDGET.md` — all 18 handlers with measured/estimated CU, recommended compute limits, rent costs, client integration examples |
| **Docs** | Mainnet readiness checklist | `docs/MAINNET_CHECKLIST.md` — 5 sections (~60 checkboxes): pre-deployment, security, infrastructure, deployment procedure, rollback |
| **Docs** | Multisig setup runbook | `docs/operations/multisig-setup.md` — Squads v4 2-of-3 multisig procedure with CLI commands, verification steps, rollback |
| **Docs** | API trust boundaries | `docs/API_TRUST_BOUNDARIES.md` (165 lines) — full route table: Public / Wallet Auth / Admin / Removed tiers |
| **Docs** | Pending work audit | `docs/PENDING_WORK.md` — 86-item spec audit; 5 gaps closed 2026-06-10, 11 real gaps remain |
| **Docs** | Known issue #29 design | `docs/KNOWN_ISSUE_29_DESIGN.md` (279 lines) — per-leaf tracking proposal for multi-leaf non-milestone undercount |
| **Docs** | Backup/restore runbook | `docs/operations/backup-restore.md` — expanded procedure |
| **Docs** | SC docs refreshed | `SECURITY.md`, `PDD_LANA.md`, `TDD_LANA.md`, `AUDIT_REPORT.md`, `MATURITY_REPORT.md` updated in `4a3e7a0` |
| **Docs** | Docs index (uncommitted) | `docs/README.md` — navigation index with canonical `API_TRUST_BOUNDARIES.md` link |
| **Scripts** | Devnet multisig test script | `scripts/test-multisig-transfer.sh` — generates fresh keypair, deploys, transfers authority, verifies, restores on cleanup |
| **CI** | Mollusk tests in CI | `ci.yml` — runs 72 active Mollusk tests across 8 test files after anchor build |
| **CI** | Proptest in CI | `ci.yml` — runs `cargo test --lib` (31 tests including 18 proptest properties) |
| **CI** | Cargo audit in CI | `ci.yml` — installs and runs `cargo audit` before build |
| **QA** | 15 bugs found & fixed | 8 L1/P0 (auth, minCliffTime, base58, 409 race, migrations) + 7 QA sweep (2 P0, 3 P1, 2 P2 across SC/BE/FE) |
| **QA** | ClaimWithProofButton milestone fix | `ClaimWithProofButton.tsx` — milestone leaves use on-chain `milestoneBitmap` instead of greedy `claimedAmount` allocation |
| **QA** | claim.rs StreamExpired fix | `claim.rs:149` — removed `fully_claimed` sub-condition that blocked multi-leaf claims |
| **QA** | total_entitled accumulation | `claim.rs` — accumulates across milestone claims via `checked_add`; first-touch guard added in `4a3e7a0` |
| **QA** | milestoneIdx validation | `validators.ts` — `.max(255)` on all 3 Zod schemas; `prepare/route.ts` — duplicate `(beneficiary, milestoneIdx)` check |
| **QA** | VestingProgress milestone check | `vesting-progress/route.ts` — LEFT JOIN `milestone_events`, zeroes `claimable` for unreleased milestones |
| **QA** | MilestoneReleasePanel real indices | Panel uses `milestoneIndices` from API (derived from actual leaves) instead of `leafCount` |
| **BE** | BigInt serialization helper | `apps/web/src/lib/api/serialize.ts` + 5 unit tests in `tests/lib/serialize-bigint.test.ts` |
| **BE** | Event table migrations | `0002`–`0005` SQL files + journal entries — bootstrap notes, 8 event tables (`0004`, 137 lines), timeline indexes (`0005`) |
| **BE** | claims/sync admin-only | `app/api/claims/sync/route.ts` — `withRoute({ admin: true })`; browser clients use public `POST /api/events/sync` |
| **BE** | MilestoneReleasePanel cache invalidation | `MilestoneReleasePanel.tsx` — invalidates `campaign`, `beneficiaryCampaigns`, and `timeline` after release; 6 panel tests |
| **FE** | Transparency Dashboard (F2) rewrite | `dashboard/page.tsx` (461 lines post-extraction) — claimable banner, 6 stat cards, vesting progress cards (top 5), recent activity feed, needs attention alerts |
| **FE** | Portfolio page (F2) | `portfolio/page.tsx` (191 lines post-extraction) — 4 summary stats, per-campaign cards with progress bars + sort |
| **FE** | ActivityFeed component (F2) | `components/dashboard/ActivityFeed.tsx` (122 lines) — cross-campaign event feed with 8 event types, Solana explorer links |
| **FE** | Activity API route (F2) | `/api/activity/[address]/route.ts` (201 lines) — CTE + UNION ALL across 8 event tables, filtered to user's campaigns |
| **FE** | Timeline helpers extraction (F2) | `lib/vesting/timeline-helpers.ts` (114 lines) — shared `EVENT_CONFIG`, `eventDescription`, `formatBlockTime`, `formatAmount` |
| **FE** | Vesting progress hooks (F2) | `useVestingProgress` + `useVestingProgressSummary`; `useRecentActivity` — cross-campaign activity |
| **FE** | `useMintDecimals` integration (F2) | Dashboard + portfolio use on-chain mint decimals for real token amounts (not raw lamports) |
| **FE** | Sidebar Portfolio nav (F2) | Added "Portfolio" item between Dashboard and Create Stream in `Sidebar.tsx` |
| **FE** | CampaignStatusBanner (F3) | `components/campaign/detail/CampaignStatusBanner.tsx` (124 lines) — 7 states: null, instant-refunded, grace-active, grace-expired, settled, unfunded |
| **FE** | GracePeriodCountdown (F3) | `components/campaign/detail/GracePeriodCountdown.tsx` (45 lines) — 60s interval, amber/red color logic |
| **FE** | useNeedsActionCount hook (F3) | `hooks/useNeedsActionCount.ts` (53 lines) — counts cancelled sender campaigns + claimable recipient campaigns |
| **FE** | Sidebar amber dot badge (F3) | Amber dot on "My Campaigns" nav when `needsActionCount > 0` |
| **FE** | Needs Action tab (F3) | Campaigns list `action` tab — filters sender-cancelled + recipient-claimable campaigns |
| **FE** | Dashboard Needs Attention (F3) | Dashboard section with per-campaign grace period countdown + alert cards |
| **FE** | Shared UI primitives extracted | 8 components: `StatCard`, `ProgressBar`, `SectionHeader`, `FieldRow`, `DetailRow`, `Spinner` (`components/ui/`), `CampaignCard`, `RecipientListModal` — dashboard/portfolio/campaign detail refactored |
| **Tests** | Clawback API test suite | `apps/web/tests/api/clawback.test.ts` (681 lines) — cancel campaign (6), withdraw unvested (5), cancel stream (7), milestone release (5) |
| **Tests** | Clawback component tests | `CampaignStatusBanner.test.ts` (85 lines, 7 states), `GracePeriodCountdown.test.ts` (60 lines) |
| **Tests** | Campaign-actions E2E suite | `tests/e2e/campaign-actions.spec.ts` (825 lines, **33 tests**) — pause/unpause, cancel stream/campaign, instant refund, withdraw, milestone release, clawback banners, needs-action tab, sidebar badge |
| **Tests** | E2E mock send-tx helper | `WalletProvider.tsx` + `tests/e2e/helpers.ts` — `enableMockOnChainTransactions()` returns fixed sig for cancel flows without validator |
| **Tests** | E2E campaign list mocking | `mockCampaignListApis()` in `helpers.ts` — routes sender/recipient list APIs for campaigns page tests |
| **Ops** | Cron schedule reverted | `vercel.json` — `*/5 * * * *` → `0 0 * * *` (daily). Vercel Hobby plan only supports daily crons |

### Incomplete / deferred

| Item | Owner | Notes |
|------|-------|-------|
| k6 load test expansion | Lana | Existing `api-load.js` covers basic endpoints; prepare/proof/spike scripts deferred |
| Mollusk 0.14+ upgrade | Lana | Blocked upstream; would unblock 18 ignored tests + 5 SPL handler tests |
| Sentry DSN in production | Ops | Scaffolding complete; needs `NEXT_PUBLIC_SENTRY_DSN` in Vercel env vars |
| Monitoring dashboard | Ops | Grafana/PagerDuty — infra, not code |
| External audit engagement | Ops | Firms identified (Halborn/OtterSec/Sec3); budget $15-40K; not an engineering task |
| FE: native SOL + instant refund | Geral | BE exposes fields + tx builders; T19/T20 native paths done |
| Rate limiting | — | ALREADY DONE (Upstash Redis + in-memory fallback, per-route limits, all 25 routes wired) |
| API versioning | — | ALREADY DONE (`X-API-Version: 1` header on all responses) |
| Cron 5-min sync | Ops | Reverted to daily; Vercel Hobby limitation. Paid plan needed for `*/5 * * * *` |
| CI migration strategy | Lana | Switch CI from `drizzle-kit push` to `drizzle-kit migrate` — `db:migrate` script exists, 0000–0008 files present |
| Clawback E2E (responsive) | Lana | 33 campaign-actions tests done; 7 deferred responsive/layout cases per spec |
| Known issue #29 | Lana | Multi-leaf non-milestone `claimed_amount` undercount — needs breaking on-chain per-leaf tracking; design doc written |
| Docs polish (uncommitted) | Lana | `README.md`, `BACKEND_API.md`, `FE_INTEGRATION.md`, `TESTING.md`, `TRANSPARENCY_DASHBOARD.md` — auth/sync clarifications pending commit |

---

## Gaps closed vs gaps remaining

Source: `docs/PENDING_WORK.md` (refreshed 2026-06-10). **86 items audited** — 5 closed this week in `4a3e7a0`, 62 are spec-checkbox cleanup only (code already done), **11 real gaps remain**, 8 blocked/deferred.

### Closed this week (2026-06-10)

| # | Task | Resolution |
|---|------|------------|
| 1 | MilestoneReleasePanel cache invalidation | Invalidates `campaign`, `beneficiaryCampaigns`, `timeline` after release |
| 2 | BigInt serialization helper | `lib/api/serialize.ts` + 5 unit tests |
| 3 | Numbered migrations for event tables | `0002`–`0005` migration files + journal entries |
| 9 | Trust boundary document | `docs/API_TRUST_BOUNDARIES.md` — full route table |
| 16 | Component extraction | 8 shared UI components; dashboard 481→461 lines, portfolio 331→191 lines |

### Still open (real code work)

| Priority | # | Task | Notes |
|----------|---|------|-------|
| 🔴 High | 4 | Token-2022 mint guard verification | `UnsupportedMint` exists; verify constraint in `create_campaign.rs` / `create_stream.rs` |
| 🔴 High | 5 | Dedicated clock-based pause→cancel→claim test | Concept in supplementary; dedicated `vesting.clock` test partially hardened |
| 🔴 High | 6 | EXPLOIT 12 label in security test | Concept exists; explicit tag missing |
| 🔴 High | 7 | Out-of-order milestone E2E | ts-mocha: claim milestones 0→2→1 |
| 🔴 High | 8 | Known issue #29 per-leaf tracking | Breaking on-chain change; design doc done |
| 🔴 High | 10–11 | SC docs + backup runbook verification | Partially done; needs final pass |
| 🔴 High | 12–13 | Sentry DSN + CI migrate strategy | Ops / infra |
| 🟡 Medium | 14–15, 17–19 | k6 expansion, rate tuning, responsive E2E, native SOL E2E, CU re-audit | Production polish |

### Blocked / deferred (no code path yet)

Mollusk 0.14+, SPL handler tests, cron 5-min sync (Vercel paid), external audit, monitoring dashboard, mainnet deploy, multisig execution.

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
| CU benchmark tests | 2 | **+8** = 10 total |
| CU-measured handlers | 2/18 | **12/18** measured (+5 estimated for SPL/init_if_needed) |
| Clippy suppressions | 4 | **2** |
| Production `.expect()` calls | 5 | **0** (all replaced with `.ok_or()`) |
| IGNORED comment format | Mixed | **18/18** standardized |
| CI test steps | 5 | **+3** (lib/proptest, Mollusk 8-file suite, cargo audit) |
| New docs | 0 | **+7** (`CU_BUDGET`, `MAINNET_CHECKLIST`, `multisig-setup`, `API_TRUST_BOUNDARIES`, `PENDING_WORK`, `KNOWN_ISSUE_29_DESIGN`, backup-restore refresh) |
| New scripts | 0 | **+1** (`test-multisig-transfer.sh`) |
| DB migrations (numbered) | 0000–0001 | **+6** (0002–0008 total; 0002–0005 event tables in `4a3e7a0`) |
| Bugs found | 0 | **15** (8 L1/P0 + 7 QA sweep) |
| Bugs fixed | 0 | **15** — compiles clean, 31 Rust unit tests pass |
| Shared UI components | 0 | **+8** (`StatCard`, `ProgressBar`, `SectionHeader`, `FieldRow`, `DetailRow`, `Spinner`, `CampaignCard`, `RecipientListModal`) |
| FE pages (new/rewritten) | 0 | **+2** (dashboard, portfolio) |
| FE components (new) | 0 | **+12** (F2/F3 features + 8 extracted primitives) |
| FE hooks (new) | 0 | **+4** (`useVestingProgress`, `useVestingProgressSummary`, `useRecentActivity`, `useNeedsActionCount`) |
| API routes (new) | 20 | **+1** (`/api/activity/[address]`) |
| FE unit tests (new) | 0 | **+3** (clawback API 681 lines, serialize-bigint 5 tests, MilestoneReleasePanel +6 tests) |
| FE component tests (new) | 0 | **+2** (CampaignStatusBanner, GracePeriodCountdown) |
| E2E tests (campaign-actions) | 0 | **33** tests in 825-line suite |
| Pending-work gaps closed | — | **5** of 86 audited items (`4a3e7a0`) |
| Rate limiting | Thought incomplete | **ALREADY DONE** |
| API versioning | Thought incomplete | **ALREADY DONE** |

---

## What's Next (Week 9+)

### SC — Solana Program
- [ ] **Upgrade Mollusk 0.14+** — when available, activates 18 ignored tests + enables SPL handler tests
- [ ] **SPL handler tests** — claim/withdraw SPL path, create_stream SPL, create_campaign SPL, fund_campaign SPL
- [ ] **Formal CU budget audit** — re-measure with mainnet cluster parameters, set `compute_budget` limits
- [ ] **External audit** — engage firm after ops budget approval
- [ ] **Multi-leaf non-milestone tracking (Known Issue #29)** — per-leaf tracking (breaking on-chain change); design in `docs/KNOWN_ISSUE_29_DESIGN.md`
- [ ] **Out-of-order milestone E2E test** — create 3-milestone campaign, claim 0→2→1, verify all succeed
- [ ] **EXPLOIT 12 tag** — add explicit label to pause→cancel security test in `security.spec.ts`
- [ ] **Token-2022 mint guard** — verify `mint.owner == token_program` constraint in create paths

### BE — Backend API
- [ ] **k6 load test expansion** — add prepare, proof, spike test scripts
- [ ] **Sentry live DSN** — ops sets env var in Vercel
- [ ] **Rate limit tuning** — adjust per-route limits based on k6 load test results
- [ ] **CI migration strategy** — switch from `drizzle-kit push` to `drizzle-kit migrate`
- [ ] **Cron upgrade to paid Vercel plan** — restore `*/5 * * * *` sync schedule for near-real-time dashboard

### FE — Frontend
- [ ] **Clawback responsive E2E** — 7 deferred layout/responsive tests for banner, sidebar badge, needs-action tab
- [ ] **Native SOL create flows** — FE uses `*_native` instructions when mint = `NATIVE_SOL_MINT` (Geral dependency)
- [ ] **Instant refund UI** — Cancel UI distinguishes instant vs grace refund (Geral dependency)
- [ ] **Commit doc polish** — README index, `BACKEND_API` auth tiers, `FE_INTEGRATION` events/sync guidance

### Security & Ops
- [ ] **Monitoring dashboard** — Grafana/PagerDuty for program + API health
- [ ] **Mainnet deploy** — follow `docs/MAINNET_CHECKLIST.md` after external audit
- [ ] **Multisig setup** — follow `docs/operations/multisig-setup.md` before mainnet
- [ ] **SC docs final pass** — verify `SECURITY.md`, `PDD_LANA.md`, `TDD_LANA.md`, `AUDIT_REPORT.md`, `MATURITY_REPORT.md`
