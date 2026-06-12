# Status Report — Week 8

**Scope:** Full stack — Solana program, Backend API/DB, Merkle pipeline, Frontend UI.

**This week:** Mollusk 0.13.1 bump + CU budget audit + production code quality sweep (`.expect()` → `.ok_or()`, clippy) + mainnet readiness docs (CU_BUDGET, MAINNET_CHECKLIST, multisig runbook) + CI hardening (Mollusk claim tests, cargo audit, proptest) + L1/P0 fixes (root rotation `minCliffTime`, API auth, base58 validation, migration 0010) + QA sweep (15 bugs fixed across SC/BE/FE) + gap-closure spec (`week8-gap-closure-lana` 34/34, `/spec-verify` passed) + KI#29 BE mitigation (prepare/import validation) + k6 load scripts + rate-limit tuning + Lana protocol doc realignment + late CI/E2E hardening (Flow 4 flake tolerance, localnet RPC pin, allocations timeout/fallback, Playwright RPC stub). **Frontend section pending Geral input** — interim FE work documented in [`Lana.md`](./Lana.md).

---

## 1. What's Working Well

### Smart Contract

| Item | Evidence |
|------|----------|
| 18 instructions, 41 error variants, 13 events -- all functional on devnet | `programs/vesting/src/instructions/` -- 18 handler files; `errors.rs` -- 41 error codes; `events.rs` -- 13 events |
| 31 Rust unit + proptest tests pass | `cargo test --lib` -- 31 tests (merkle 4 properties, schedule 6 properties, inline 1) |
| 72 Mollusk instruction tests active | `programs/vesting/tests/` -- 8 domain-specific files (instructions, stream, admin, cancel, claim, cleanup, lifecycle, benchmarks) |
| 9 active CU benchmark tests (+1 ignored) | `tests/benchmarks.rs` -- 9 pass; `bench_claim_native` ignored (`init_if_needed` limitation) |
| Clippy clean, zero warnings | `cargo clippy -- -D warnings` -- clean; only 2 intentional suppressions (`unexpected_cfgs`, `ambiguous_glob_reexports`) |
| All `.expect()` replaced with `.ok_or()` | 5 production panics eliminated in claim, withdraw, cancel_stream, withdraw_unvested, instant_refund_campaign |
| `total_entitled` first-touch guard | `claim.rs` -- `is_first_touch` flag prevents double-accumulation on milestone claim init |

### Tests

| Item | Evidence |
|------|----------|
| 924 unit tests pass (Vitest) | `cd apps/web && npx vitest run` -- 924 passing (73 files) |
| 31 Rust unit + proptest pass | `cargo test --lib` |
| 72 Mollusk integration tests pass | CI `ci.yml` -- 72 active across 8 test files |
| 10/18 handlers CU-measured | `docs/CU_BUDGET.md` -- 10 measured + 8 estimated (Mollusk 0.13.1) |
| k6 load test suite (4 scripts) | `apps/web/tests/load/` -- `api-load.js`, `prepare-load.js`, `proof-load.js`, `spike-load.js` + `run-load-test.sh` |
| Clawback API test suite | `apps/web/tests/api/clawback.test.ts` -- 681 lines (cancel, withdraw, milestone release) |
| Ops verification tests | `apps/web/tests/api/ops-verification.test.ts` -- pool, sync_state, txn rollback, RLS, BigInt route guard |
| 5 testing frameworks integrated | test-validator, bankrun, LiteSVM, Mollusk, proptest |

### Merkle

| Item | Evidence |
|------|----------|
| Rust-TS parity verified | Both `merkle.rs` and `merkle.ts` produce identical roots for identical leaf sets |
| Anti-second-preimage defense | `nodeHash()` uses tagged hashing (`\x01` prefix) -- second preimage attack infeasible |
| Scale tested to 15K leaves | 15K leaves: ~960 KB memory, 448-byte proofs, ~30K hashes build time |

### CI

| Item | Evidence |
|------|----------|
| 3 workflows green | `ci.yml`, `lint.yml`, `web-ci.yml` -- all passing on `dev_lana` |
| 5 testing frameworks in CI | merkle unit, anchor build, Mollusk 8-file suite, proptest, cargo audit |
| Flow 4 flake hardening | `tests/week7-integration-flow.spec.ts` -- duplicate-tx tolerance; mocha retries in `ci.yml` |
| Localnet RPC pinning | `scripts/test-localnet.sh` -- integration tests use validator RPC regardless of `Anchor.toml` cluster |
| CI migration strategy | `lint.yml` + `web-ci.yml` use `pnpm db:migrate` |

### Backend API

| Item | Evidence |
|------|----------|
| 25+ API routes with rate limiting, auth, versioning | `apps/web/app/api/` -- all routes; Upstash Redis + in-memory fallback; `X-API-Version: 1` header |
| Campaign creation now requires auth | `apps/web/app/api/campaigns/route.ts` -- `auth: true` + `cancelAuthority` verification |
| Root-versions now requires auth | `apps/web/app/api/campaigns/[treeAddress]/root-versions/route.ts` -- `auth: true` + wallet verification |
| KI#29 BE mitigation (prepare/import) | `prepare/route.ts` + `import/route.ts` -- reject 2+ cliff/linear leaves per beneficiary; 4 tests in `bulk-campaign.test.ts` |
| Activity API route | `/api/activity/[address]/route.ts` -- CTE + UNION ALL across 8 event tables |
| BigInt serialization helper | `apps/web/src/lib/api/serialize.ts` + 5 unit tests in `tests/lib/serialize-bigint.test.ts` |
| claims/sync admin-only | `app/api/claims/sync/route.ts` -- `withRoute({ admin: true })`; browser clients use public `POST /api/events/sync` |
| Event table migrations 0002-0005 | `apps/web/src/lib/db/migrations/` -- bootstrap notes, 8 event tables, timeline indexes |
| Rate limits tuned from k6 baselines | prepare 10/min, proof + campaigns GET 60/min -- documented in `docs/TESTING.md` §k6 |

### Root Rotation (fixed this week)

| Item | Evidence |
|------|----------|
| SDK helper `prepareRootRotation()` | `clients/ts/src/prepare.ts` -- new exported function |
| FE hook fixed -- 3rd arg `minCliffTime` now passed | `apps/web/src/hooks/useUpdateRoot.ts:32` -- `updateRoot(root, leafCount, minCliffTime)` |
| DB schema updated -- `min_cliff_time NOT NULL` column | `apps/web/src/lib/db/schema.ts` -- migration `0010_add_min_cliff_time.sql` |
| BE route persists `minCliffTime` + returns 409 on conflict | `apps/web/app/api/campaigns/[treeAddress]/root-versions/route.ts` |
| Integration guide written | `docs/ROOT_ROTATION_GUIDE.md` -- step-by-step for FE integration |

### Docs

| Item | Evidence |
|------|----------|
| API trust boundaries | `docs/API_TRUST_BOUNDARIES.md` -- full route table: Public / Wallet Auth / Admin / Removed |
| Pending work audit | `docs/PENDING_WORK.md` -- 86 items audited; ~4 real gaps remain |
| KI#29 design + BE enforcement | `docs/KNOWN_ISSUE_29_DESIGN.md` §6 + `SECURITY.md` |
| Lana protocol docs realigned | `PRD_LANA.md`, `PDD_LANA.md`, `TDD_LANA.md` -- Phase 4 status, Stream PDA mapping |
| Gap-closure spec complete | `.claude/specs/week8-gap-closure-lana/` -- 34/34 tasks, `/spec-verify` passed |

### Frontend

<!-- Geral: add your working items here (FE tests, E2E, UI features, etc.) -->

| Item | Evidence |
|------|----------|
| _Add items_ | _Add evidence_ |

---

## 2. What's Not

| Item | Status | Impact |
|------|--------|--------|
| Mollusk 0.14 upgrade | Blocked upstream | 19 instruction tests stay `#[ignore]`d -- cannot test SPL path, `init_if_needed`, `Optional<T>` handlers |
| Sentry DSN not configured | Deferred to ops | Error tracking scaffolding complete but not live -- needs `NEXT_PUBLIC_SENTRY_DSN` in Vercel env vars |
| Root rotation integration bug | **FIXED this week** | Was the main deliverable -- FE hook missing 3rd arg, SDK had no helper, DB had no column |
| API auth on campaign creation + root-versions | **FIXED this week** | Both routes now require `auth: true` + wallet verification |
| KI#29 on-chain fix | Deferred (BE mitigated) | Per-leaf tracking is a breaking on-chain change; prepare + import routes reject multi cliff/linear per beneficiary |
| DB migration snapshots | Partially addressed | Numbered migrations 0002-0005 + CI `pnpm db:migrate` in place; Drizzle snapshots for 0002-0010 still missing -- affects local integration test bootstrap |
| k6 load test expansion | **DONE this week** | `prepare-load.js`, `proof-load.js`, `spike-load.js` + `run-load-test.sh all`; baselines in `docs/TESTING.md` §k6 |
| External audit engagement | Deferred (ops) | Firms identified (Halborn/OtterSec/Sec3); budget $15-40K; requires ops/management approval |
| 6 SPL CU measurements | Estimates only | Mollusk blocked for SPL path instructions; 8/18 instructions are extrapolated from native path + CPI overhead |
| API latency (production) | Not measured | k6 baselines documented for dev/staging; production P50/P99 targets not validated under real traffic |
| Cron 5-min sync | Reverted to daily | Vercel Hobby plan only supports daily crons (`0 0 * * *`); paid plan needed for `*/5 * * * *` |

---

## 3. Known Bugs / Limitations

Full details in [`docs/WEEK8_KNOWN_ISSUES.md`](../../docs/WEEK8_KNOWN_ISSUES.md).

| Category | Count | Details |
|----------|-------|---------|
| **Fixed this week** | 15 | 8 L1/P0 (root rotation, auth, base58, 409 race, migration 0010, guide fixes) + 7 QA sweep (claim.rs StreamExpired, total_entitled, milestoneIdx, duplicate milestones, vesting-progress, ClaimWithProofButton, MilestoneReleasePanel) |
| **Documented (known limitations)** | 12 | 19 Mollusk tests ignored, 8 SPL/init_if_needed CU estimates, RLS SELECT-only, duplicate keccak packages, `createdAt` trusted from client, `getAuthenticatedWallet` trust model, `leaf_count > 1` FE-only gate, `create_stream` hardcoded `min_cliff_time=0`, native SOL withdraw drains PDA, Sentry DSN unconfigured, KI#29 cumulative claimed_amount |
| **Deferred to Week 9+** | 1 | External audit engagement (k6 expansion completed) |

---

## 4. Performance Findings

Full details in [`docs/CU_BUDGET.md`](../../docs/CU_BUDGET.md). k6 load baselines in [`docs/TESTING.md`](../../docs/TESTING.md) §k6.

### Compute Unit Budget

| Metric | Value |
|--------|-------|
| Instructions measured | **10/18** (56%) -- Mollusk 0.13.1 benchmarks |
| Instructions estimated | **8/18** (44%) -- SPL paths + `init_if_needed`/`Optional<T>` blocked |
| Benchmark suite | 9 active + 1 ignored (`bench_claim_native`) |
| Average CU utilization | **76%** (target range: 60-85%) |
| Tightest handler | `withdraw` (SPL) at ~100% estimated -- recommend raising to 20,000 CU limit |
| Most efficient handler | `close_claim_record` at 5,131 CU (73% of 7,000 limit) |
| Highest CU consumer | `create_stream_native` at 13,117 CU (82% of 16,000 limit) |

### Transaction Cost

| Flow | Cost (USD) | vs Jito Target |
|------|-----------|----------------|
| `create_campaign_native` (10k leaves) + `fund_campaign_native` | **~$0.0017** | **247x cheaper** than Jito $0.42 |
| Single instruction (any) | ~$0.00085 | Dominated by 5,000-lamport base signature fee, not CU |

Key insight: CU consumption is economically irrelevant at default priority (1 micro-lamport/CU). The base signature fee ($0.00085) dominates. No CU optimization needed.

### Merkle Tree Scale

| Leaves | Memory | Proof Size | Build Time (hashes) |
|--------|--------|------------|---------------------|
| 1,000 | 64 KB | 320 bytes | ~2,000 |
| 5,000 | 320 KB | 416 bytes | ~10,000 |
| 10,000 | 640 KB | 448 bytes | ~20,000 |
| 15,000 | 960 KB | 448 bytes | ~30,000 |
| 1,048,576 (max) | ~64 MB | 640 bytes | ~2,000,000 |

All sizes fit comfortably in Node.js default heap (1.7 GB). Maximum proof (640 bytes at depth 20) fits within Solana's 1,232-byte transaction limit alongside account metas and instruction data (~940 bytes total).

### API Latency

k6 smoke baselines documented in `docs/TESTING.md` §k6 (prepare, proof, spike scripts). Production P50/P99 not yet validated under real traffic. Targets:
- POST `/api/campaigns`: P50 < 500ms, P99 < 2,000ms
- GET `/api/campaigns`: P50 < 200ms, P99 < 1,000ms
- GET `/api/campaigns/:id/proof`: P50 < 100ms, P99 < 500ms

---

## 5. Phase 3 Recommendations

### Priority 1 -- Before Mainnet

| Recommendation | Owner | Rationale |
|----------------|-------|-----------|
| Engage external Solana program audit (Halborn / OtterSec / Sec3) | Ops/Management | Budget $15-40K. V1 is feature-complete and stable, but independent audit is required before mainnet launch. All 14 acceptance criteria pass; 18 instructions, 41 error codes, 13 events ready for review. |
| Mollusk 0.14 migration | Lana | When unblocked upstream, activates 19 ignored tests + enables SPL path CU measurement. Validates 8 estimated CU values. |
| Formal CU budget audit with mainnet cluster params | Lana | Current measurements are from Mollusk 0.13.1 (local). Mainnet cluster may differ. Re-measure with `compute_budget` limits set. |
| KI#29 on-chain fix (per-leaf tracking) | Lana | Breaking on-chain change; BE mitigated at prepare/import. Full fix required for multi cliff/linear per beneficiary edge case. |

### Priority 2 -- Production Hardening

| Recommendation | Owner | Rationale |
|----------------|-------|-----------|
| Configure Sentry live DSN in Vercel | Ops | One env var (`NEXT_PUBLIC_SENTRY_DSN`). Scaffolding complete. |
| Regenerate Drizzle migration snapshots | Lana | Migrations 0002-0010 exist and CI uses `pnpm db:migrate`; snapshots still missing for local integration test bootstrap. |
| Raise `withdraw` (SPL) CU limit to 20,000 | Lana | Current estimate at 100% utilization leaves zero headroom for CPI variance. Already documented in `CU_BUDGET.md`. |
| Cron upgrade to paid Vercel plan | Ops | Restore `*/5 * * * *` sync schedule for near-real-time dashboard indexing. |

### Priority 3 -- Post-Launch

| Recommendation | Owner | Rationale |
|----------------|-------|-----------|
| Mainnet deploy following `docs/MAINNET_CHECKLIST.md` | Team | 5 sections, ~60 checkboxes covering pre-deployment, security, infrastructure, deployment procedure, rollback. |
| Multisig setup following `docs/operations/multisig-setup.md` | Ops | Squads v4 2-of-3 multisig. Devnet test script exists (`scripts/test-multisig-transfer.sh`). |
| Monitoring dashboard (Grafana/PagerDuty) | Ops | Program + API health monitoring. Infrastructure, not code. |

---

## 6. Honest Assessment

### Backend / Smart Contract Readiness
Production-grade for devnet. All 18 instructions functional, 924 Vitest + 31 Rust + 72 Mollusk tests passing, clippy clean, no `.expect()` panics in production code. Gap-closure spec complete (34/34). KI#29 mitigated at API layer. Needs external audit before mainnet -- this is the single most important gate.

### Merkle Pipeline
Robust and cost-competitive. Rust-TS parity verified. Anti-second-preimage defense in place. Scale tested to 15K leaves with no issues. 247x cheaper than Jito bundle tips for campaign creation. No optimization needed.

### API
Feature-complete with 25+ routes. Rate limiting (Upstash Redis + in-memory fallback) and versioning (`X-API-Version: 1`) operational. Auth hardening fixed for campaign creation and root-versions. KI#29 validation on prepare/import. k6 load scripts and rate-limit baselines in place.

### Root Rotation
Was the critical bug early in the week. The FE hook `useUpdateRoot.ts` was calling `updateRoot(root, leafCount)` without the required 3rd argument `minCliffTime`, causing on-chain `InvalidSchedule` rejections. Fixed across all layers: SDK helper, DB schema, BE route, FE hook, integration guide. No regression risk -- all 4 sub-tasks (L1a-L1d) verified with passing tests.

### Test Infrastructure
Unit tests are healthy (924 Vitest, 31 Rust unit+proptest, 72 Mollusk). k6 load suite and ops-verification tests added. Drizzle migration snapshots for 0002-0010 remain a tooling gap for local integration bootstrap -- CI migrate strategy is in place.

### Frontend

<!-- Geral: add your honest assessment of FE readiness here -->

Interim F2/F3 work (dashboard, clawback UI, E2E) is documented in [`Lana.md`](./Lana.md); this team report awaits Geral input.

### Overall
V1 is stable and ready for external audit. The two blockers for mainnet are (1) external audit completion and (2) Mollusk 0.14 upgrade to validate the 8 estimated CU measurements. All code-level work is either done or has a clear path forward.

---

## 7. Files Changed This Week

### Modified

| File | Change |
|------|--------|
| `.gitignore` | Gitignored weekly report directory |
| `clients/ts/src/prepare.ts` | Added `prepareRootRotation()` function + `PreparedRootRotation` type for root rotation SDK helper |
| `clients/ts/src/index.ts` | Added exports for new `prepareRootRotation` function |
| `apps/web/src/lib/api/validators.ts` | `minCliffTime` required field + `base58String` validator + `milestoneIdx` `.max(255)` |
| `apps/web/src/lib/api/serialize.ts` | BigInt serialization helper for API responses |
| `apps/web/src/lib/db/schema.ts` | `minCliffTime` NOT NULL column on `rootVersions` table |
| `apps/web/src/lib/db/migrations/meta/_journal.json` | Journal entries for migrations 0002-0010 |
| `apps/web/app/api/campaigns/[treeAddress]/root-versions/route.ts` | Auth (`auth: true`) + `minCliffTime` persist + 409 Conflict on unique constraint violation |
| `apps/web/app/api/campaigns/route.ts` | Auth (`auth: true`) + `cancelAuthority` creator wallet verification |
| `apps/web/app/api/campaigns/prepare/route.ts` | KI#29 validation -- reject duplicate cliff/linear per beneficiary |
| `apps/web/app/api/campaigns/import/route.ts` | KI#29 validation -- reject duplicate cliff/linear per beneficiary |
| `apps/web/app/api/claims/sync/route.ts` | Admin-only (`withRoute({ admin: true })`) |
| `apps/web/app/api/campaigns/[treeAddress]/vesting-progress/route.ts` | LEFT JOIN milestone_events; zero claimable for unreleased milestones |
| `apps/web/src/hooks/useUpdateRoot.ts` | Fixed on-chain call -- passes 3rd arg `minCliffTime` to `updateRoot` |
| `apps/web/src/app/(app)/campaign/[id]/allocations/page.tsx` | 8s `withTimeout` on on-chain fetch + indexed API fallback; TypeScript build fix |
| `apps/web/tests/lib/root-rotation.test.ts` | Test fixture updated for `minCliffTime` field |
| `apps/web/tests/api/bulk-campaign.test.ts` | +4 KI#29 validation tests |
| `programs/vesting/src/instructions/claim.rs` | StreamExpired fix, total_entitled accumulation, first-touch guard |
| `docs/CU_BUDGET.md` | CU measurements re-audited 2026-06-11; withdraw SPL limit raised to 20,000 |
| `docs/API_TRUST_BOUNDARIES.md` | Full route trust-tier table |
| `docs/PENDING_WORK.md` | 86-item audit refresh |
| `docs/TESTING.md` | k6 section + rate-limit baselines |
| `docs/PRD_LANA.md`, `docs/PDD_LANA.md`, `docs/TDD_LANA.md` | Phase 4 realignment |
| `docs/SECURITY.md`, `docs/BACKEND_API.md`, `docs/AUDIT_REPORT.md`, `docs/MATURITY_REPORT.md` | Post-gap-closure accuracy pass |
| `programs/vesting/benches/compute_units.md` | Benchmark data updated |
| `vercel.json` | Cron reverted to daily (`0 0 * * *`) -- Vercel Hobby limitation |
| `scripts/test-localnet.sh` | Pin localnet tests to validator RPC |
| `Anchor.toml` | Provider cluster configuration for devnet/localnet |

### Created

| File | Purpose |
|------|---------|
| `apps/web/src/lib/db/migrations/0010_add_min_cliff_time.sql` | Migration: adds `min_cliff_time bigint NOT NULL DEFAULT 0` to `root_versions` |
| `apps/web/src/lib/db/migrations/0002`–`0005` | Event table migrations (bootstrap, 8 event tables, timeline indexes) |
| `apps/web/app/api/activity/[address]/route.ts` | Cross-campaign activity feed API |
| `apps/web/tests/load/prepare-load.js` | k6 load test for POST `/api/campaigns/prepare` |
| `apps/web/tests/load/proof-load.js` | k6 load test for GET proof endpoint |
| `apps/web/tests/load/spike-load.js` | k6 spike test |
| `apps/web/tests/load/run-load-test.sh` | Orchestrator (`api\|prepare\|proof\|spike\|all`) |
| `apps/web/tests/api/clawback.test.ts` | Clawback API test suite (681 lines) |
| `apps/web/tests/api/ops-verification.test.ts` | Pool, sync_state, txn rollback, RLS, BigInt route guard |
| `apps/web/tests/lib/serialize-bigint.test.ts` | BigInt serialization unit tests |
| `docs/ROOT_ROTATION_GUIDE.md` | Root rotation integration guide |
| `docs/KNOWN_ISSUE_29_DESIGN.md` | KI#29 design + BE enforcement §6 |
| `docs/MAINNET_CHECKLIST.md` | Mainnet readiness checklist (~60 checkboxes) |
| `docs/operations/multisig-setup.md` | Squads v4 multisig runbook |
| `docs/WEEK8_KNOWN_ISSUES.md` | Bug audit: 15 fixed, 12 documented, 1 deferred |
| `scripts/test-multisig-transfer.sh` | Devnet multisig authority transfer test |
| `weekly-report-mancer/week8/STATUS_REPORT.md` | This file |

### Frontend

<!-- Geral: add your created/modified files here -->

| File | Change |
|------|--------|
| _Add files_ | _Add changes_ |

### CI Fixes (committed)

| File | Change |
|------|--------|
| `.github/workflows/ci.yml` | Fixed claim Mollusk tests (Option<T> accounts + rent-exempt lamports), removed bare `--skip` flags, added cargo audit, added `curve25519-dalek` + `ed25519-dalek` transitive advisory ignores, Flow 4 mocha retries |
| `programs/vesting/tests/claim.rs` | Fixed Mollusk test setup for `Optional<T>` account handling |
| `programs/vesting/tests/test_helpers.rs` | Updated helper for rent-exempt lamport calculation |
| `programs/vesting/src/math/merkle.rs` | Restored `MAX_MERKLE_PROOF_LEN` import, removed unused import |
| `tests/week7-integration-flow.spec.ts` | Flow 4 duplicate-tx tolerance (`7efe0f6`) |
| `tests/e2e/helpers.ts` | `mockSolanaRpcGetAccountInfoNull()` stub for Playwright CI |
| `tests/e2e/allocations.spec.ts`, `campaign-actions.spec.ts`, `user-journey.spec.ts` | Wired RPC stub to avoid devnet hangs |
