# Pending Work Audit (as of 2026-06-11)

> Generated from full spec audit across 12 specs in `.claude/specs/`.
> Purpose: Give Cursor clear, prioritized work items. Separate "already done" from "actually missing".
> **Last refresh:** 2026-06-14 — **Week 9**: detect→triage→fix→docs pass across SC/MERKLE/BE/DB (5 fixes + 7 documented; new integrator docs in `docs/week9/`). See `docs/week9/BUG_LIST.md`. (Prior: 2026-06-11 — week8-lana-remnants.)

---

## ✅ WEEK 9 (2026-06-14) — Detection + hardening + docs

Detect → triage → fix → docs pass across SC / MERKLE / BE / DB. Full detail: [`docs/week9/BUG_LIST.md`](week9/BUG_LIST.md).

**Fixed (code + verified):**

| Item | Resolution |
|------|------------|
| BE-SEC-01 — `POST /api/campaigns` wallet auth | `auth:true` + unconditional `signer===creator` (`campaigns/route.ts`); +2 route tests staged |
| BE-SEC-06 — cron timing-safe compare | `timingSafeCompare` in `cron/sync/route.ts` (was plain `!==`) |
| BE-SEC-05 — rate-limit resilience | try/catch around `limiter.limit` → in-memory fallback on Upstash error |
| SC-FIND-02 — native-SOL rent drain | `withdraw_unvested` preserves `rent_min` (re-classified High→Low: availability-only, no fund loss) |
| SC-FIND-03 — withdraw guard | `!instant_refunded` guard added (mirrors `claim.rs`) |
| DB-DOC-01 — bigint mode doc divergence | `BE-SC-MERKLE-ACCEPTANCE-STATUS.md:27,122` corrected `mode:"string"` → `mode:"bigint"` |

**Documented (no code change — rationale in BUG_LIST §Phase 6):** SC-FIND-04/05/06, BE-SEC-02/03/04/08. **SC-#29 — FIXED on-chain (2026-06-16):** `ClaimRecord` is now `zero_copy` with a per-leaf ledger; ADR-003 is superseded. SC-FIND-06 (stale `total_entitled` after rotation) is fixed by the same change. **Merkle surface** independently audited — sound; Rust↔TS parity proven byte-for-byte + `fast-check` property tests added.

**New integrator docs:** `docs/week9/INSTRUCTION_REFERENCE.md`, `INTEGRATION_GUIDE.md`, `ADRs/` (ADR-001/002/003), refreshed root `README.md`.

**Still open / deferred:**
- BE route-level tests (`tests/api/**`, incl. BE-SEC-01 401/403 + rate-limit cluster) → need a Postgres-backed env to execute (tests are staged).
- SC Mollusk coverage of 4 `init_if_needed`/`Optional<T>` handlers → blocked on Mollusk 0.14.
- ✅ **RESOLVED (2026-06-24):** the now-obsolete Issue #29 BE guards (`cliffLinearSeen` in `apps/web/src/app/api/campaigns/prepare/route.ts` + `import/route.ts`) were relaxed to a **cap-aware** check — see `apps/web/src/lib/campaign/limits.ts` (`MAX_CLIFF_LINEAR_LEAVES_PER_BENEFICIARY = 8`, mirroring on-chain `PER_LEAF_CAP`). They now allow up to 8 cliff/linear leaves per beneficiary and reject more; the milestone duplicate guard is unchanged. (Previously: "remove in a separate post-deploy PR".) Tests updated in `tests/api/bulk-campaign.test.ts`.
- ⚠️ **Resolve `PATCH /api/campaigns/:treeAddress/status` divergence (decision pending).** The route **still exists in code** (`apps/web/src/app/api/campaigns/[treeAddress]/status/route.ts`, public, 10/min, writes `paused`/`cancelledAt`/`totalClaimed`/`instantRefunded` to DB) but is documented as **Removed** in `api-endpoints.md` + `trust-boundaries.md`, which claim status flows only from the indexer. Decide: (a) remove the route to match the documented indexer-only boundary, or (b) keep it and re-document honestly. Currently flagged via callouts in both reference docs; no code changed this pass.
- FE multi-leaf-cliff/linear support in the bulk-send UI → Geral (handoff; the on-chain program now supports it).
- `BE-SEC-02` (XFF trust) + `BE-SEC-04` (Redis prod assertion) → revisit if moving off Vercel.
- **SC-FIND-07 (new, 2026-06-21) — `claim.rs` + `withdraw.rs` drain all lamports on final native SOL claim, destroying VestingTree PDA.** `claim.rs` final drain uses `pda_info.lamports()` (all lamports including rent); `withdraw.rs` single-stream final withdraw has the same pattern. Solana deletes zero-lamport accounts at transaction end → `close_claim_record` subsequently fails with `AccountNotInitialized (3012)` because `vesting_tree` is a required non-optional account. `withdraw_unvested.rs` (SC-FIND-02) and `instant_refund_campaign.rs` already correctly preserve `rent_min`. Fix: apply the same pattern to `claim.rs` and `withdraw.rs` — `pda_info.lamports().saturating_sub(rent_min)` on the final drain. Requires SC redeploy. FE workaround already in place (see FE-BUG-20): pre-checks VestingTree existence and shows clear native-SOL-specific error if gone.

---

## ✅ RECENTLY COMPLETED (2026-06-11)

| # | Task | Resolution |
|---|------|------------|
| 1 | MilestoneReleasePanel cache invalidation | Invalidates `campaign`, `beneficiaryCampaigns`, and `timeline` keys immediately after release |
| 2 | BigInt serialization helper | `apps/web/src/lib/api/serialize.ts` + `tests/lib/serialize-bigint.test.ts` |
| 3 | Numbered migrations for event tables | `0002`–`0005` migration files + journal entries |
| 9 | Trust boundary document | [`docs/API_TRUST_BOUNDARIES.md`](API_TRUST_BOUNDARIES.md) — full route table |
| 16 | Component extraction | `StatCard`, `ProgressBar`, `CampaignCard`, `SectionHeader`, `FieldRow`, `DetailRow`, `Spinner`, `RecipientListModal` |
| 4 | Token-2022 mint guard verified | T71 in `vesting.supplementary.spec.ts` — `UnsupportedMint` rejected (62 passing) |
| 5 | Clock pause→cancel→claim test verified | `vesting.clock.spec.ts` — `clock: pause→cancel→claim with precise vesting math` (14 passing) |
| 6 | EXPLOIT 12 label verified | `security.spec.ts` — `EXPLOIT 12: pause then cancel then claim during grace succeeds` (11 passing) |
| 7 | Out-of-order milestone E2E verified | `vesting.supplementary.spec.ts` — `out-of-order milestone claim: 0 → 2 → 1 succeeds` |
| 13 | CI migration strategy verified | `.github/workflows/lint.yml` + `web-ci.yml` use `pnpm db:migrate`; `BACKEND_API.md` updated |
| 10 | SC documentation audit | 5 docs (`SECURITY.md`, `PDD_LANA.md`, `TDD_LANA.md`, `AUDIT_REPORT.md`, `MATURITY_REPORT.md`) verified against current SC state per week8 T16 |
| 11 | Backup procedure runbook | [`docs/operations/backup-restore.md`](operations/backup-restore.md) verified for completeness; staging drill pending (blocked on staging access) |
| 28 | BigInt serialization route audit | Grep of all route handlers under `apps/web/src/app/api/` confirms all use `jsonResponse` with `jsonReplacer` — no un-serialized BigInt paths |
| 29 | DB pool config verified | `ops-verification.test.ts` confirms `max: 10` in production, `max: 3` in development |
| 30 | sync_state checkpoint verified | `ops-verification.test.ts` confirms `persistSyncCheckpoint` writes and `getLastSyncedSlot` advances |
| 31 | Transactional rollback verified | `ops-verification.test.ts` confirms `db.transaction` rolls back inserts on error |
| 32 | RLS policy behavior verified | `ops-verification.test.ts` confirms anon SELECT succeeds, INSERT fails (CI with local Postgres); skipped on remote DBs gracefully |
| 33 | syncClaimEvents end-to-end via mock RPC | `ops-verification.test.ts` ("syncClaimEvents checkpoint") validates `syncClaimEventsWithConnection` advances checkpoint through full pipeline |
| 34 | processTransactions end-to-end | `ops-verification.test.ts` ("processTransactions rollback") validates event processing through `processTransactions` with mocked `getTransaction` |
| 35 | BigInt route guard (automated) | `ops-verification.test.ts` ("BigInt serialization guard") scans all route files; would catch a new route that omits `jsonResponse` |

---

## 🔴 HIGH PRIORITY — Real gaps that need code

### BE (Backend)

_No open high-priority BE items from the original audit._

### SC (Solana Program)

| # | Task | Source | What's needed |
|---|------|--------|---------------|
| 8 | Known issue #29 — cumulative claimed_amount undercount | Week8 Known Issues | ✅ **Fixed on-chain 2026-06-16** (per-leaf ledger; `ClaimRecord` now `zero_copy`; ADR-003 updated). ✅ **BE guards resolved 2026-06-24:** `cliffLinearSeen` (prepare + import) relaxed to cap-aware (≤ `PER_LEAF_CAP = 8`), not removed. |

### Ops/Infra

| # | Task | Source | What's needed |
|---|------|--------|---------------|
| 12 | Sentry DSN in Vercel production | B1 | Scaffolding done. Ops needs to set `NEXT_PUBLIC_SENTRY_DSN` in Vercel; production is live at `www.velthoryn.site` (legacy `velthoryn.vercel.app` subdomain returns DEPLOYMENT_NOT_FOUND). |

---

## 🟡 MEDIUM PRIORITY — Needed for production, not blocking

### BE

| # | Task | Source | What's needed |
|---|------|--------|---------------|
| 14 | k6 load test expansion | B5 / Week8 Next | **Done** — `prepare-load.js`, `proof-load.js`, `spike-load.js`, `run-load-test.sh all`; baselines in `TESTING.md` §k6. |
| 15 | Rate limit tuning | Week8 Next | **Done** — limits documented in `TESTING.md` §k6; smoke p95 supports current prepare 10/min, proof 60/min. |

### FE

| # | Task | Source | What's needed |
|---|------|--------|---------------|
| 17 | Clawback E2E Playwright tests | automatic-clawback-ui | 7 deferred E2E tests for banner states, sidebar badge, needs action tab, responsive. `campaign-actions.spec.ts` expanded with mock-send-tx helpers. |
| 18 | Native SOL TokenPickerModal + E2E | T21, T22 | T19/T20 already done. T21 (TokenPickerModal) may be done — verify. T22 is manual devnet E2E. |

### SC

| # | Task | Source | What's needed |
|---|------|--------|---------------|
| 19 | Formal CU budget audit | Week8 Next | **Done** — Mollusk benchmarks re-run 2026-06-15; `CU_BUDGET.md` updated (10 active + 1 ignored). |

---

## ⚪ BLOCKED / DEFERRED — Waiting on external deps

| # | Task | Category | Blocker |
|---|------|----------|---------|
| 20 | Mollusk 0.14+ upgrade | SC | Upstream — unblocks 18 ignored tests + SPL handler tests |
| 21 | SPL handler tests | SC | Blocked on Mollusk 0.14 |
| 22 | Cron 5-min sync | Ops | Vercel Hobby limitation — needs paid plan |
| 23 | External audit ($15-40K) | Ops | Budget approval needed |
| 24 | Monitoring dashboard (Grafana/PagerDuty) | Ops | Infra, not code |
| 25 | Mainnet deploy | Ops | Follow MAINNET_CHECKLIST.md after audit |
| 26 | Multisig setup execution | Ops | Doc exists at `docs/operations/multisig-setup.md`, needs doing |
| 27 | k6 rate limit tuning | BE | **Done** — see `TESTING.md` §k6 rate limit table. |

---

## ✅ SPEC CHECKBOX CLEANUP (2026-06-11)

Batch-verified and marked `[x]` in `.claude/specs/{production-security-ops,bulk-send,sc-remediation}/tasks.md`. `native-sol-vesting` BE tasks were already `[x]`; FE tasks T19–T22 remain deferred to Geral. `sc-remediation` §00.8 devnet redeploy still `[ ]`.

### production-security-ops (P0+P1) — ~30 sub-items
- P0.1 Rate limiter utility → `lib/api/rate-limit.ts` exists
- P0.2 Wallet auth middleware → `lib/api/auth-middleware.ts` exists
- P0.3 CORS + security headers → `middleware.ts` + `next.config.ts` headers exist
- P0.4 Body size limits → `lib/api/body-limit.ts` exists
- P0.5 RLS policies → `0001_rls_policies.sql` exists
- P0.6 Security integration tests → `tests/api/security.test.ts` exists
- P1.1 Structured logger → `lib/api/logger.ts` exists
- P1.2 Error classification → `lib/api/errors.ts` exists
- P1.3 Health check → `app/api/health/route.ts` exists
- P1.4 DB pool tuning → `max: isProduction ? 10 : 3` in `db/index.ts`
- P1.5 Sync state checkpointing → `syncState` table + `db.transaction()` in `claim-events.ts`
- P1.6 Transactional indexing → confirmed in `claim-events.ts`
- P1.8 All 25 routes wrapped → confirmed in week8 report
- P1.9 Operational tests → `health.test.ts` + `error-handling.test.ts` exist

### bulk-send (F1) — ~15 sub-items
- F1.1 Workspace Merkle dep → prepare endpoint works (proves dep is wired)
- F1.2 TS schedule math → `lib/vesting/schedule.ts` exists
- F1.3 Schedule math tests → `tests/lib/vesting-schedule.test.ts` exists
- F1.4 Bulk validators → prepare/import endpoints validate input
- F1.5 Prepare endpoint → `app/api/campaigns/prepare/route.ts` exists
- F1.6 CSV import endpoint → `app/api/campaigns/import/route.ts` exists
- F1.7 Bulk flow tests → `tests/api/bulk-campaign.test.ts` exists

### sc-remediation (00) — ~12 sub-items
- 00.1 Cancel resets paused → `cancel_campaign.rs:36` confirms `tree.paused = false`
- 00.2 Defense-in-depth → `claim.rs:73` and `withdraw.rs:75` confirm. `cancel_stream.rs` uses different but valid approach (resets paused directly).
- 00.3 Pause→cancel→claim test → supplementary spec line 4263
- 00.4 Cancel resets paused test → supplementary spec line 4362

### vesting-ux-hardening (F4+P2) — ~15 sub-items
- A1 Simulation endpoint → `app/api/simulate-vesting/route.ts` exists
- A2 Schedule templates → `app/api/schedule-templates/route.ts` exists
- A3 Simulation tests → `tests/api/simulate-vesting.test.ts` exists
- B1 Sentry scaffolding → `sentry.client.config.ts` + `sentry.server.config.ts` exist (DSN env var pending)
- B2 API versioning → `lib/api/errors.ts` applies `X-API-Version: 1`, `tests/api/versioning.test.ts` exists
- B5 k6 basic load test → `api-load.js` + `run-load-test.sh` exist
- B6 Token-2022 error → `UnsupportedMint` in `errors.rs`, test in supplementary spec

### dashboard-transparency (F2) — ~3 sub-items
- F2.8b CRON_SECRET in .env.example → confirmed present
- F2.9 Event indexer tests → `tests/indexer/event-indexer.test.ts` exists

### native-sol-vesting — ~2 sub-items
- T19 useCreateStream native SOL → `createStreamNative()` branch exists
- T20 useCreateCampaign native SOL → `createCampaignNative()` + `fundCampaignNative()` branches exist

---

## Summary

| Category | Actually not done | Recently completed | Already done (spec cleanup) | Blocked/deferred |
|----------|-------------------|--------------------|----------------------------|------------------|
| **SC** | 1 | 4 | 12 | 2 |
| **BE** | 0 | 8 | 48 | 1 |
| **FE** | 2 | 1 | 2 | 0 |
| **Docs** | 0 | 3 | 0 | 0 |
| **Ops** | 1 | 1 | 0 | 5 |
| **Total** | **~4** | **~17** | **0** (batch done) | **8** |

**86 total items audited.** Last refresh 2026-06-24. Remaining real work: FE E2E/clawback, Ops Sentry DSN, and resolving the `PATCH /api/campaigns/:treeAddress/status` divergence (route still in code though documented as Removed). **8** externally blocked. Production is live at `www.velthoryn.site` (BE+Merkle pipeline + smoke tests pass 2026-06-23); the legacy `velthoryn.vercel.app` subdomain returns DEPLOYMENT_NOT_FOUND.
