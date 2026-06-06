# Weekly Report — Lana (Week 8)

**Scope:** BE-DB-SC-Merkle (backend API, Postgres/indexer, Solana program, Merkle client). Frontend UI is out of scope unless noted as a dependency on Geral.

**This week (chronological):** Week 7 report review + backlog analysis → exploration (Mollusk tests, BE infra, security/ops) → **Mollusk 0.13.1 bump + 18 IGNORED comment standardization** → **production code quality sweep (`.expect()` → `.ok_or()`, clippy suppressions 4→2, unused import fix)** → **CU budget audit (8 new benchmarks, 12/18 handlers measured)** → **multisig setup docs + devnet test script** → **mainnet readiness checklist** → **CI hardening (Mollusk + proptest + cargo audit)**.

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
| Total files changed | — | **15** (14 modified + 1 new), 752 insertions, 33 deletions |
| Bugs found | 0 | 0 (no bugs this week — hardening sprint) |
| Rate limiting | Thought incomplete | **ALREADY DONE** — discovered during exploration |
| API versioning | Thought incomplete | **ALREADY DONE** — discovered during exploration |

---

## What's Next (Week 9+)

### SC — Solana Program
- [ ] **Upgrade Mollusk 0.14+** — when available, activates 18 ignored tests + enables SPL handler tests
- [ ] **SPL handler tests** — claim/withdraw SPL path, create_stream SPL, create_campaign SPL, fund_campaign SPL
- [ ] **Formal CU budget audit** — re-measure with mainnet cluster parameters, set `compute_budget` limits
- [ ] **External audit** — engage firm after ops budget approval

### BE — Backend API
- [ ] **k6 load test expansion** — add prepare, proof, spike test scripts
- [ ] **Sentry live DSN** — ops sets env var in Vercel
- [ ] **Rate limit tuning** — adjust per-route limits based on k6 load test results

### FE — Frontend (Geral dependency)
- [ ] **Native SOL create flows** — FE uses `*_native` instructions when mint = `NATIVE_SOL_MINT`
- [ ] **Instant refund UI** — Cancel UI distinguishes instant vs grace refund

### Security & Ops
- [ ] **Monitoring dashboard** — Grafana/PagerDuty for program + API health
- [ ] **Mainnet deploy** — follow `docs/MAINNET_CHECKLIST.md` after external audit
- [ ] **Multisig setup** — follow `docs/operations/multisig-setup.md` before mainnet
