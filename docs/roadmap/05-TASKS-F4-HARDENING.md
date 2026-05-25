# Tasks: Vesting UX & Production Hardening

**Spec:** `vesting-ux-hardening`
**Phase:** F4 + P2
**Depends on:** `bulk-send` (F1.2 schedule math), `production-security-ops` (P0+P1)

---

## Part A — Vesting UX (F4)

### A1 — Vesting simulation endpoint

- [ ] Create `apps/web/src/app/api/simulate-vesting/route.ts`
  - `POST /api/simulate-vesting` (auth + rate limit: 30/min)
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
- [ ] **Verify:** Linear simulation for 1-year vesting shows 12 monthly entries with increasing cumulative

### A2 — Schedule template presets

- [ ] Create `apps/web/src/app/api/schedule-templates/route.ts`
  - `GET /api/schedule-templates` (rate limit: 60/min, no auth)
  - Return static JSON with predefined templates:
    - `4yr-linear-1yr-cliff`: releaseType 1, cliff 365 days, total 1460 days
    - `2yr-linear`: releaseType 1, cliff 0, total 730 days
    - `1yr-cliff`: releaseType 0, cliff 365 days
    - `milestone-4`: releaseType 2, 4 milestones
    - `6mo-cliff`: releaseType 0, cliff 180 days
  - Each template: `{ id, name, description, releaseType, params }`
- [ ] **Verify:** GET returns 5 templates with correct release types

### A3 — Simulation tests

- [ ] Create `apps/web/tests/api/simulate-vesting.test.ts`
  - Test: Linear simulation — verify first month vested > 0, last month = total amount
  - Test: Cliff simulation — verify all entries before cliff = 0, all after = full amount
  - Test: Milestone simulation — verify 0 before cliff, full after
  - Test: Invalid schedule (start > end) → 400
  - Test: Zero amount → 400
  - Test: All response values are strings (BigInt safe)
  - Test: Percent calculation is accurate (within 0.01%)
- [ ] All tests pass in CI

---

## Part B — Production Hardening (P2)

### B1 — Sentry error monitoring

- [ ] Install `@sentry/nextjs`
- [ ] Create `apps/web/sentry.client.config.ts`
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
- [ ] Create `apps/web/sentry.server.config.ts`
  ```typescript
  import * as Sentry from "@sentry/nextjs";
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.VERCEL_ENV || "development",
  });
  ```
- [ ] Update `apps/web/next.config.ts` — add Sentry webpack plugin
- [ ] Update `.env.example` — add `NEXT_PUBLIC_SENTRY_DSN`
- [ ] Wrap API error handler with `Sentry.captureException()`
- [ ] **Verify:** Throw an error in a test route → appears in Sentry dashboard

### B2 — API versioning

- [ ] Create `apps/web/src/lib/api/version.ts`
  - Export `API_VERSION = "1"` constant
  - Export `withVersion(handler)` wrapper that adds `X-API-Version: 1` to all responses
- [ ] Apply `withVersion` to all route handlers via the existing middleware chain
- [ ] Create `apps/web/tests/api/versioning.test.ts`
  - Test: All responses include `X-API-Version: 1` header
- [ ] **Verify:** `curl -I /api/campaigns` returns `X-API-Version: 1`

### B3 — Migration strategy

- [ ] Update `apps/web/drizzle.config.ts`
  - Ensure `migrations` folder path is correct
  - Add `migrationsPrefix` if needed
- [ ] Verify all migrations are committed and sequential
- [ ] Update `apps/web/README.md` (or `apps/web/.env.example`) with:
  ```bash
  # Apply migrations
  cd apps/web && pnpm drizzle-kit migrate
  # Generate new migration after schema change
  pnpm drizzle-kit generate
  ```
- [ ] Update CI (`web-ci.yml`): change `drizzle-kit push` to `drizzle-kit migrate`
- [ ] **Verify:** `pnpm drizzle-kit migrate` applies all migrations in order on a fresh DB

### B4 — Backup documentation

- [ ] Create backup procedure documentation (in `docs/` or `apps/web/README.md`):
  - Enable PITR: Supabase Dashboard → Database → Backups → Enable PITR (Pro plan)
  - Manual backup: `pg_dump "$DATABASE_URL" > backup_$(date +%Y%m%d).sql`
  - Restore: `psql "$DATABASE_URL" < backup_YYYYMMDD.sql`
  - Verify backup: check `SELECT count(*) FROM campaigns` matches production
- [ ] Add weekly backup check to operational runbook
- [ ] **Verify:** Documented procedure is complete and accurate

### B5 — Load testing

- [ ] Install k6: `brew install k6` or `sudo apt install k6`
- [ ] Create `apps/web/tests/load/api-load.js`:
  ```javascript
  import http from 'k6/http';
  import { check, sleep } from 'k6';

  export const options = {
    stages: [
      { duration: '30s', target: 20 },   // ramp up
      { duration: '60s', target: 100 },   // sustain
      { duration: '30s', target: 0 },     // ramp down
    ],
    thresholds: {
      http_req_duration: ['p(95)<500'],   // 95% under 500ms
      http_req_failed: ['rate<0.01'],     // < 1% errors
    },
  };

  const BASE = __ENV.BASE_URL || 'http://localhost:3000';

  export default function () {
    // Test campaign list
    check(http.get(`${BASE}/api/campaigns`), {
      'campaigns status 200': (r) => r.status === 200,
    });
    // Test health
    check(http.get(`${BASE}/api/health`), {
      'health status 200': (r) => r.status === 200,
    });
    sleep(1);
  }
  ```
- [ ] Create `apps/web/tests/load/run-load-test.sh`:
  ```bash
  k6 run --env BASE_URL=http://localhost:3000 tests/load/api-load.js
  ```
- [ ] Run load test against local dev server
- [ ] Record baseline results: p50, p95, p99 latencies
- [ ] **Verify:** 100 RPS sustained with p95 < 500ms and error rate < 1%

### B6 — SC Token-2022 guard

- [ ] Add to `programs/vesting/src/errors.rs`:
  ```rust
  #[msg("Token-2022 mints are not supported; use classic SPL Token")]
  UnsupportedMint,
  ```
- [ ] Update `programs/vesting/src/instructions/create_campaign.rs`:
  - Add constraint to `mint` account: `constraint = mint.owner == token_program.key() @ VestingError::UnsupportedMint`
  - This checks that the mint was created by the classic SPL Token program, not Token-2022
- [ ] Update `programs/vesting/src/instructions/create_stream.rs`:
  - Same constraint on `mint` account
- [ ] Add integration test: create campaign with Token-2022 mint → `UnsupportedMint` error
  - File: add test to `tests/vesting.supplementary.spec.ts`
  - Create a Token-2022 mint via `createMint` with Token-2022 program
  - Attempt `create_campaign` with this mint
  - Assert error code matches `UnsupportedMint`
- [ ] Rebuild: `anchor build`
- [ ] Run all tests: `pnpm test:localnet` → 87/87 (1 new test)
- [ ] **Verify:** `create_campaign` with Token-2022 mint fails with `UnsupportedMint`; classic SPL mint still works

---

## Verification checklist

### Part A (Vesting UX)
- [ ] `POST /api/simulate-vesting` returns monthly breakdown
- [ ] Cliff simulation shows 0 → full transition
- [ ] Linear simulation shows progressive unlock
- [ ] `GET /api/schedule-templates` returns 5 templates
- [ ] All response values are strings (BigInt safe)

### Part B (Hardening)
- [ ] Sentry captures unhandled API errors
- [ ] All API responses include `X-API-Version: 1` header
- [ ] `drizzle-kit migrate` applies all migrations on fresh DB
- [ ] Backup procedure documented
- [ ] Load test: 100 RPS with p95 < 500ms
- [ ] SC: Token-2022 mint rejected with `UnsupportedMint`
- [ ] `pnpm test:localnet` passes (87/87)
- [ ] `pnpm test` passes in `apps/web/`
