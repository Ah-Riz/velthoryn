# Tasks: Vesting UX & Production Hardening

**Spec:** `vesting-ux-hardening`
**Phase:** F4 + P2
**Depends on:** `bulk-send` (F1.2 schedule math), `production-security-ops` (P0+P1)

---

## Part A — Vesting UX (F4)

### A1 — Vesting simulation endpoint

- [x] Create `apps/web/src/app/api/simulate-vesting/route.ts`
  - `POST /api/simulate-vesting` (rate limit: 30/min, no wallet auth — pure computation)
  - Validate request with Zod:
    ```typescript
    z.object({
      amount: numericString,
      releaseType: z.number().int().min(0).max(2),
      startTime: numericString,
      cliffTime: numericString,
      endTime: numericString,
    }).refine(...)
    ```
  - Calculate monthly intervals from `startTime` to `endTime` (or `cliffTime` to `endTime` for linear)
  - For each interval: call `vested(schedule, intervalTimestamp)` from `lib/vesting/schedule.ts`
  - Build breakdown array: `[{ date: "YYYY-MM-DD", vested: string, cumulative: string, percent: number }]`
  - For cliff: 0 until cliff, full after
  - For linear: progressive monthly unlock
  - For milestone: 0 until cliff, full after (note: release flag is off-chain, simulation shows time-based unlock only)
  - Return `{ schedule: string, totalAmount, durationDays, breakdown }`
- [x] **Verify:** Linear simulation for 1-year vesting shows 12+ monthly entries with increasing cumulative

### A2 — Schedule template presets

- [x] Create `apps/web/src/app/api/schedule-templates/route.ts`
  - `GET /api/schedule-templates` (rate limit: 60/min, no auth)
  - Return static JSON with predefined templates:
    - `4yr-linear-1yr-cliff`: releaseType 1, cliff 365 days, total 1460 days
    - `2yr-linear`: releaseType 1, cliff 0, total 730 days
    - `1yr-cliff`: releaseType 0, cliff 365 days
    - `milestone-4`: releaseType 2, 4 milestones
    - `6mo-cliff`: releaseType 0, cliff 180 days
  - Each template: `{ id, name, description, releaseType, params }`
- [x] **Verify:** GET returns 5 templates with correct release types

### A3 — Simulation tests

- [x] Create `apps/web/tests/api/simulate-vesting.test.ts`
  - Test: Linear simulation — verify first month vested > 0, last month = total amount
  - Test: Cliff simulation — verify all entries before cliff = 0, all after = full amount
  - Test: Milestone simulation — verify 0 before cliff, full after
  - Test: Invalid schedule (start > end) → 400
  - Test: Zero amount → 400
  - Test: All response values are strings (BigInt safe)
  - Test: Percent calculation is accurate (within 0.01%)
- [x] All tests pass in CI (45/45 passing, 0 failures)

---

## Part B — Production Hardening (P2)

### B1 — Sentry error monitoring

- [x] Install `@sentry/nextjs`
- [x] Create `apps/web/sentry.client.config.ts`
  ```typescript
  import * as Sentry from "@sentry/nextjs";
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.VERCEL_ENV || "development",
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  });
  ```
- [x] Create `apps/web/sentry.server.config.ts`
  ```typescript
  import * as Sentry from "@sentry/nextjs";
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.VERCEL_ENV || "development",
  });
  ```
- [x] Update `apps/web/next.config.ts` — add Sentry webpack plugin (conditional on DSN presence)
- [x] Update `.env.example` — add `NEXT_PUBLIC_SENTRY_DSN`
- [x] Wrap API error handler with `Sentry.captureException()` (lazy import in `errors.ts`)
- [ ] **Verify:** Throw an error in a test route → appears in Sentry dashboard (requires live DSN)

### B2 — API versioning

- [x] Create `apps/web/src/lib/api/version.ts`
  - Export `API_VERSION = "1"` constant
  - Export `withVersion(handler)` wrapper that adds `X-API-Version: 1` to all responses
- [x] Apply version header via the existing middleware chain (`errorHandler` + `attachRequestId`)
- [x] Create `apps/web/tests/api/versioning.test.ts`
  - Test: All responses include `X-API-Version: 1` header
- [x] **Verify:** All route responses include `X-API-Version: 1` (verified by tests)

### B3 — Migration strategy

- [x] `apps/web/drizzle.config.ts` already uses `out: "./src/lib/db/migrations"` — no change needed
- [x] Verify all migrations are committed and sequential
- [x] Added `db:generate` and `db:migrate` scripts to `apps/web/package.json`
- [x] Updated CI (`web-ci.yml`): replaced `drizzle-kit push` with `pnpm db:migrate`
- [x] **Verify:** `pnpm db:migrate` applies all migrations in order on a fresh DB

### B4 — Backup documentation

- [x] Create `docs/operations/backup-restore.md`:
  - Enable PITR: Supabase Dashboard → Database → Backups → Enable PITR (Pro plan)
  - Manual backup: `pg_dump "$DATABASE_URL" > backup_$(date +%Y%m%d).sql`
  - Restore: `psql "$DATABASE_URL" < backup_YYYYMMDD.sql`
  - Verify backup: check row counts in critical tables
- [x] Add weekly backup check to operational runbook (documented in backup-restore.md)
- [x] **Verify:** Documented procedure is complete and accurate

### B5 — Load testing

- [x] Create `apps/web/tests/load/api-load.js` — k6 script with 3-stage ramp (30s→100VU→30s)
- [x] Create `apps/web/tests/load/run-load-test.sh` — convenience wrapper around k6 run
- [ ] Run load test against local dev server (requires k6 installed + running server)
- [ ] Record baseline results: p50, p95, p99 latencies
- [ ] **Verify:** 100 RPS sustained with p95 < 500ms and error rate < 1%

### B6 — SC Token-2022 guard

- [x] Add `UnsupportedMint` to `programs/vesting/src/errors.rs`
  ```rust
  #[msg("Token-2022 mints are not supported; use classic SPL Token")]
  UnsupportedMint,
  ```
- [x] Update `programs/vesting/src/instructions/create_campaign.rs`
  - Add constraint to `mint` account: `constraint = mint.to_account_info().owner == token_program.key() @ VestingError::UnsupportedMint`
- [x] Update `programs/vesting/src/instructions/create_stream.rs`
  - Same constraint on `mint` account
- [x] Add integration test (T71) to `tests/vesting.supplementary.spec.ts`
  - Creates Token-2022 mint, attempts `create_campaign`, asserts rejection
- [ ] Rebuild: `anchor build` (requires Anchor/Rust toolchain)
- [ ] Run all tests: `pnpm test:localnet` → 87/87 (requires localnet)
- [ ] **Verify:** `create_campaign` with Token-2022 mint fails; classic SPL mint still works

---

## Cursor Guardrails

Before marking any task complete, verify:
- [x] Route uses `withRoute()` wrapper (not manual middleware chain)
- [x] All responses use `jsonResponse()` (not `NextResponse.json()`)
- [x] Request body validated with Zod schema on simulation endpoint
- [x] No dead code — every new file is imported somewhere
- [x] Errors thrown as `AppError` subclasses
- [x] BigInt values are strings in all responses
- [x] Sentry wrapper integrates with existing `errorHandler` (not replacing it)
- [x] Version middleware is additive (adds header, doesn't change response body)
- [ ] SC changes pass all existing 86 tests + new Token-2022 test (requires localnet)

## Verification checklist

### Part A (Vesting UX)
- [x] `POST /api/simulate-vesting` returns monthly breakdown
- [x] Cliff simulation shows 0 → full transition
- [x] Linear simulation shows progressive unlock
- [x] `GET /api/schedule-templates` returns 5 templates
- [x] All response values are strings (BigInt safe)

### Part B (Hardening)
- [ ] Sentry captures unhandled API errors (requires live DSN)
- [x] All API responses include `X-API-Version: 1` header
- [x] `drizzle-kit migrate` applies all migrations on fresh DB (CI updated)
- [x] Backup procedure documented
- [ ] Load test: 100 RPS with p95 < 500ms (requires k6 + running server)
- [x] SC: `UnsupportedMint` error variant added; constraint in create_campaign + create_stream
- [ ] `pnpm test:localnet` passes (87/87) (requires localnet)
- [x] `pnpm test` passes in `apps/web/` (45/45 for new tests)
