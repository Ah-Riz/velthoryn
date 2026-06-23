# Design: Vesting UX & Production Hardening

**Spec:** `vesting-ux-hardening`
**Phase:** F4 (Vesting UX) + P2 (Hardening)
**Depends on:** `bulk-send` (F1.2 schedule math), `production-security-ops` (P0+P1)
**Estimate:** 8 days
**Owner:** Lana (BE lead)

---

## Context

Two remaining pieces:
1. **Vesting UX (F4):** Schedule simulation and templates for dashboard transparency.
2. **Production Hardening (P2):** Monitoring, API versioning, migration strategy, backups, load testing, SC Token-2022 guard.

These are lower priority than F1-F3 and can ship incrementally.

---

## Part A: Vesting UX (F4) — 3 days

### A1: Schedule simulation endpoint

`POST /api/simulate-vesting` — pure computation, no DB. Returns a month-by-month breakdown.

Request:
```json
{
  "amount": "1000000000",
  "releaseType": 1,
  "startTime": "1700000000",
  "cliffTime": "1700000000",
  "endTime": "1731536000"
}
```

Response:
```json
{
  "schedule": "linear",
  "totalAmount": "1000000000",
  "durationDays": 365,
  "breakdown": [
    { "date": "2023-11-15", "vested": "0", "cumulative": "0", "percent": 0 },
    { "date": "2023-12-15", "vested": "84931506", "cumulative": "84931506", "percent": 8.49 },
    { "date": "2024-01-15", "vested": "84931506", "cumulative": "169863012", "percent": 16.99 },
    ...
    { "date": "2024-11-01", "vested": "1000000000", "cumulative": "1000000000", "percent": 100 }
  ]
}
```

Uses `lib/vesting/schedule.ts` from F1.2 to calculate vested amounts at each monthly interval.

### A2: Schedule template presets

`GET /api/schedule-templates` — static JSON, no DB.

Response:
```json
{
  "templates": [
    {
      "id": "4yr-linear-1yr-cliff",
      "name": "4-Year Linear with 1-Year Cliff",
      "description": "Standard employee vesting. 25% unlocks after 1 year, then monthly for 3 years.",
      "releaseType": 1,
      "params": { "cliffDurationDays": 365, "totalDurationDays": 1460 }
    },
    {
      "id": "2yr-linear",
      "name": "2-Year Linear",
      "description": "Monthly unlock over 24 months. No cliff.",
      "releaseType": 1,
      "params": { "cliffDurationDays": 0, "totalDurationDays": 730 }
    },
    {
      "id": "1yr-cliff",
      "name": "1-Year Cliff",
      "description": "Full amount unlocks after 12 months.",
      "releaseType": 0,
      "params": { "cliffDurationDays": 365 }
    },
    {
      "id": "milestone-4",
      "name": "4 Milestones",
      "description": "4 equal milestones. Each unlocks on creator release.",
      "releaseType": 2,
      "params": { "milestoneCount": 4 }
    }
  ]
}
```

---

## Part B: Production Hardening (P2) — 5 days

### B1: Error monitoring (Sentry)

Integrate Sentry for automatic error tracking:
- `@sentry/nextjs` package
- Capture unhandled exceptions in API routes
- Capture failed RPC calls
- Source maps uploaded on build
- Performance monitoring (optional, P3)
- Environment separation: `production` vs `preview` vs `development`

### B2: API versioning

Add `/api/v1/` prefix to all routes. Current routes become v1.

Options:
- **A: Directory restructuring** — Move `api/campaigns/` to `api/v1/campaigns/`. Clean but large refactor.
- **B: Middleware-based** — Add `Accept-Version: 1` header check. Routes stay where they are. Simpler.

**Decision:** Option B for now. Add version header to all responses (`X-API-Version: 1`). When v2 is needed, create `/api/v2/` routes. Current routes serve v1 by default.

### B3: Migration strategy

Current: `drizzle-kit push` (schema diff → apply directly).

Production: `drizzle-kit generate` (create migration files) → `drizzle-kit migrate` (apply migrations).

Steps:
1. Switch `drizzle.config.ts` to use migrations
2. Ensure `migrations/` directory is committed and reviewed
3. Add migration to CI: apply migrations before tests
4. Document rollback: each migration gets a manual down SQL

### B4: Backup strategy

Supabase PITR (Point-in-Time Recovery):
- Enable on Supabase dashboard (Pro plan required)
- Document restore procedure: `pg_dump` + `supabase db reset --linked`
- Add daily backup verification cron

### B5: Load testing

Create k6 or Artillery scripts:
- Baseline: 100 RPS on GET routes, 10 RPS on POST routes
- Endpoints: `/api/campaigns`, `/api/campaigns/:tree/proof`, `/api/beneficiary/:addr/campaigns`
- Report: p50, p95, p99 latencies, error rate

### B6: SC Token-2022 guard

Add to `programs/vesting/src/errors.rs`:
```rust
#[msg("Token-2022 mints are not supported")]
UnsupportedMint,
```

Add to `create_campaign.rs` and `create_stream.rs`:
```rust
constraint = mint.owner == token_program.key() @ VestingError::UnsupportedMint,
```

This prevents Token-2022 mints from being used, avoiding silent transfer fee issues.

---

## File Map

### Part A: Vesting UX

| File | Purpose |
|------|---------|
| `apps/web/src/app/api/simulate-vesting/route.ts` | Schedule simulation endpoint |
| `apps/web/src/app/api/schedule-templates/route.ts` | Template presets endpoint |
| `apps/web/tests/api/simulate-vesting.test.ts` | Simulation tests |

### Part B: Hardening

| File | Purpose |
|------|---------|
| `apps/web/sentry.client.config.ts` | Sentry client config |
| `apps/web/sentry.server.config.ts` | Sentry server config |
| `apps/web/next.config.ts` | Sentry webpack plugin |
| `apps/web/src/lib/api/version.ts` | API version middleware |
| `apps/web/tests/load/api-load.js` | k6 load test script |
| `programs/vesting/src/errors.rs` | Add `UnsupportedMint` variant |
| `programs/vesting/src/instructions/create_campaign.rs` | Add mint owner check |
| `programs/vesting/src/instructions/create_stream.rs` | Add mint owner check |
| `apps/web/tests/api/versioning.test.ts` | Version header tests |

---

## Cursor Guardrails

Rules derived from P0/P1 implementation audit. Every route in this spec MUST follow these.

### Route construction
- **Use `withRoute()` wrapper** from `@/lib/api/route-wrapper`. Never construct middleware manually.
- **Use `jsonResponse()` from `@/lib/api/json-response`** for ALL responses. Never `NextResponse.json()`.
- **Zod-validated request body** on `POST /api/simulate-vesting`. Never raw `request.json()`.

### Pure computation endpoints
- **Simulation endpoint does NO DB writes.** Pure math only. Read-only. No transaction needed.
- **Template endpoint is static JSON.** No DB, no computation. Just `jsonResponse(templates)`.
- **Both are public GET/POST with rate limits.** No auth needed.

### Error handling
- **Throw `AppError` subclasses.** The `errorHandler` wrapper handles the rest.

### BigInt
- **All amounts and timestamps in responses are strings.** `jsonResponse()` handles this automatically.

## Out of scope

- DeFi composability (Phase 2)
- Squads multisig integration (Phase 2, no code change)
- Pinocchio/proptest/cargo-fuzz (Phase 2)
- DAO governance (Phase 3)
