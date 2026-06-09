# Weekly Report — Lana (Week 8)

**Scope:** BE-DB-SC-Merkle (backend API, Postgres/indexer, Solana program, Merkle client). Frontend UI is out of scope unless noted as a dependency on Geral.

**This week (chronological):** Week 7 report review + backlog analysis → exploration (Mollusk tests, BE infra, security/ops) → **Mollusk 0.13.1 bump + 18 IGNORED comment standardization** → **production code quality sweep (`.expect()` → `.ok_or()`, clippy suppressions 4→2, unused import fix)** → **CU budget audit (8 new benchmarks, 12/18 handlers measured)** → **multisig setup docs + devnet test script** → **mainnet readiness checklist** → **CI hardening (Mollusk + proptest + cargo audit)** → **Week 9 QA sweep (7 bugs found & fixed across SC/BE/FE)**.

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
| Total files changed | — | **25** (24 modified + 1 new), 875 insertions, 63 deletions |
| Bugs found | 0 | **7** (2 P0, 3 P1, 2 P2) — QA sweep with senior-dev + code-reviewer + qa agents |
| Bugs fixed | 0 | **7** — all fixed, compiles clean, 31 Rust unit tests pass |
| Rate limiting | Thought incomplete | **ALREADY DONE** — discovered during exploration |
| API versioning | Thought incomplete | **ALREADY DONE** — discovered during exploration |

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

### FE — Frontend (Geral dependency)
- [ ] **Native SOL create flows** — FE uses `*_native` instructions when mint = `NATIVE_SOL_MINT`
- [ ] **Instant refund UI** — Cancel UI distinguishes instant vs grace refund

### Security & Ops
- [ ] **Monitoring dashboard** — Grafana/PagerDuty for program + API health
- [ ] **Mainnet deploy** — follow `docs/MAINNET_CHECKLIST.md` after external audit
- [ ] **Multisig setup** — follow `docs/operations/multisig-setup.md` before mainnet
