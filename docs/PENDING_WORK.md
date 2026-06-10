# Pending Work Audit (as of 2026-06-10)

> Generated from full spec audit across 12 specs in `.claude/specs/`.
> Purpose: Give Cursor clear, prioritized work items. Separate "already done" from "actually missing".
> **Last refresh:** 2026-06-10 — items 1–3, 9, 16 marked done in commit `4a3e7a0`.

---

## ✅ RECENTLY COMPLETED (2026-06-10)

| # | Task | Resolution |
|---|------|------------|
| 1 | MilestoneReleasePanel cache invalidation | Invalidates `campaign`, `beneficiaryCampaigns`, and `timeline` keys immediately after release |
| 2 | BigInt serialization helper | `apps/web/src/lib/api/serialize.ts` + `tests/lib/serialize-bigint.test.ts` |
| 3 | Numbered migrations for event tables | `0002`–`0005` migration files + journal entries |
| 9 | Trust boundary document | [`docs/API_TRUST_BOUNDARIES.md`](API_TRUST_BOUNDARIES.md) — full route table |
| 16 | Component extraction | `StatCard`, `ProgressBar`, `CampaignCard`, `SectionHeader`, `FieldRow`, `DetailRow`, `Spinner`, `RecipientListModal` |

---

## 🔴 HIGH PRIORITY — Real gaps that need code

### BE (Backend)

_No open high-priority BE items from the original audit._

### SC (Solana Program)

| # | Task | Source | What's needed |
|---|------|--------|---------------|
| 4 | Verify Token-2022 mint guard | B6 | `UnsupportedMint` error exists in `errors.rs`, but verify `mint.owner == token_program.key()` constraint exists in `create_campaign.rs` and `create_stream.rs`. Grep came back empty — may use different mechanism or incomplete. |
| 5 | Clock-based pause→cancel→claim test | 00.5 | Precise timestamp vesting math test in `vesting.clock.spec.ts`. Concept test exists in supplementary but dedicated clock test not confirmed. |
| 6 | EXPLOIT 12 label in security test | 00.6 | Test concept exists in `security.spec.ts` ("pause -> cancel must not lock beneficiaries") but explicit "EXPLOIT 12" tag missing. |
| 7 | Out-of-order milestone E2E test | Week8 Next | ts-mocha test: create 3-milestone campaign, claim 0→2→1, verify all succeed. |
| 8 | Known issue #29 — cumulative claimed_amount undercount | Week8 Known Issues | Multi-leaf non-milestone leaves undercount via cumulative `claimed_amount`. Needs per-leaf tracking — **breaking on-chain change**. |

### Docs

| # | Task | Source | What's needed |
|---|------|--------|---------------|
| 10 | Update 5 SC documentation files | 00.10 | Partially done in week 8 — verify `SECURITY.md`, `PDD_LANA.md`, `TDD_LANA.md`, `AUDIT_REPORT.md`, `MATURITY_REPORT.md` match current SC state. |
| 11 | Backup procedure documentation | B4 | Partially done — see [`docs/operations/backup-restore.md`](operations/backup-restore.md); verify runbook completeness. |

### Ops/Infra

| # | Task | Source | What's needed |
|---|------|--------|---------------|
| 12 | Sentry DSN in Vercel production | B1 | Scaffolding done (`sentry.client.config.ts`, `sentry.server.config.ts`). Just needs `NEXT_PUBLIC_SENTRY_DSN` env var set in Vercel dashboard. |
| 13 | CI migration strategy | B3 | Switch CI from `drizzle-kit push` to `drizzle-kit migrate`. `db:migrate` script exists, migrations directory has 0000-0008 files. |

---

## 🟡 MEDIUM PRIORITY — Needed for production, not blocking

### BE

| # | Task | Source | What's needed |
|---|------|--------|---------------|
| 14 | k6 load test expansion | B5 / Week8 Next | `api-load.js` covers basic endpoints. Need: prepare, proof, spike scripts + baseline results. |
| 15 | Rate limit tuning | Week8 Next | Adjust per-route limits based on k6 load test results. |

### FE

| # | Task | Source | What's needed |
|---|------|--------|---------------|
| 17 | Clawback E2E Playwright tests | automatic-clawback-ui | 7 deferred E2E tests for banner states, sidebar badge, needs action tab, responsive. `campaign-actions.spec.ts` expanded with mock-send-tx helpers. |
| 18 | Native SOL TokenPickerModal + E2E | T21, T22 | T19/T20 already done. T21 (TokenPickerModal) may be done — verify. T22 is manual devnet E2E. |

### SC

| # | Task | Source | What's needed |
|---|------|--------|---------------|
| 19 | Formal CU budget audit | Week8 Next | Re-measure with mainnet cluster parameters, set `compute_budget` limits. |

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
| 27 | k6 rate limit tuning | BE | Blocked on #14 (load test expansion) |

---

## ✅ ALREADY DONE BUT NOT CHECKED IN SPECS — Spec file cleanup only

These items are implemented in the codebase but their `tasks.md` checkboxes were never marked `[x]`.
**No code work needed — just update the spec files.**

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
| **SC** | 5 | 0 | 12 | 2 |
| **BE** | 0 | 3 | 48 | 1 |
| **FE** | 2 | 1 | 2 | 0 |
| **Docs** | 2 | 1 | 0 | 0 |
| **Ops** | 2 | 0 | 0 | 5 |
| **Total** | **11** | **5** | **62** | **8** |

**86 total items audited.** 5 completed 2026-06-10. 62 need spec file checkboxes only. **11** remain as real work. 8 are externally blocked.
