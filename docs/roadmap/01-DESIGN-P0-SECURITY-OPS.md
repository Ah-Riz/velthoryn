# Design: Production Security & Operational Baseline

**Spec:** `production-security-ops`
**Phases:** P0 (Security Gate) + P1 (Operational Baseline)
**Blocks:** All other feature specs (F1-F4, P2)
**Estimate:** 7-9 days
**Owner:** Lana (BE lead)

---

## Context

The BE API (`apps/web/src/app/api/`) has 8 routes live on Vercel. Zero have authentication, rate limiting, or security headers. The event indexer (`lib/indexer/claim-events.ts`) runs manually, has no checkpointing, and uses non-transactional writes. This spec hardens the BE to production grade before any new feature endpoints ship.

**Source:** `docs/roadmap/00-GAP-ANALYSIS.md` — P0 items S1-S6, P1 items O1-O7.

---

## Architecture

### Request lifecycle (after this spec)

```
Client Request
  → middleware.ts (CORS, security headers, OPTIONS preflight)
  → rate-limit.ts (Upstash Redis check, 429 if exceeded)
  → auth-middleware.ts (wallet sig verification for POST, skip for GET)
  → route handler (Zod validation, business logic)
  → errors.ts (structured error response with requestId)
  → logger.ts (structured JSON log)
  → Response
```

### Auth model

Two tiers:
1. **Public GET** — no auth required. Rate-limited.
2. **Authenticated POST** — wallet signature verification. Caller signs a nonce + timestamp, server verifies with `tweetnacl`. Nonces stored in Upstash Redis with 5min TTL to prevent replay.
3. **Admin routes** (`/api/admin/*`) — keep existing `ADMIN_API_KEY` header auth. No changes.

### Rate limit tiers

| Route pattern | Limit | Window |
|---------------|-------|--------|
| `GET /api/*` | 60 requests | 60 seconds |
| `POST /api/campaigns` | 10 requests | 60 seconds |
| `POST /api/campaigns/import` | 5 requests | 60 seconds |
| `POST /api/campaigns/:treeAddress/root-versions` | 10 requests | 60 seconds |
| `POST /api/admin/*` | 3 requests | 60 seconds |
| `POST /api/health` | unlimited | — |

### Error response format

```json
{
  "error": "Human-readable message",
  "code": "RATE_LIMITED",
  "requestId": "uuid-v4",
  "details": {}
}
```

Standard codes: `VALIDATION_ERROR`, `NOT_FOUND`, `UNAUTHORIZED`, `RATE_LIMITED`, `INTERNAL_ERROR`.

---

## Data Model

### New DB table: `sync_state`

```sql
CREATE TABLE sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

INSERT INTO sync_state (key, value, updated_at) VALUES
  ('last_synced_slot', '0', 0),
  ('last_sync_timestamp', '0', 0);
```

Used by the event indexer to persist progress across sync runs.

### RLS policies (migration 0003)

```sql
-- Enable RLS on all tables
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE root_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;

-- Public read access (anon role)
CREATE POLICY "Public read campaigns" ON campaigns FOR SELECT USING (true);
CREATE POLICY "Public read root_versions" ON root_versions FOR SELECT USING (true);
CREATE POLICY "Public read leaves" ON leaves FOR SELECT USING (true);
CREATE POLICY "Public read claim_events" ON claim_events FOR SELECT USING (true);

-- Service role has full access (used by admin/sync and authenticated POST)
-- This is handled by using the service_role key for write operations
-- and anon key for read operations.
```

### DB connection pool tuning

```typescript
// Current: max 3, no keepalive
// Production: max 10, keepalive 30s
const isProduction = process.env.NODE_ENV === "production";

const client = postgres(connectionString, {
  max: isProduction ? 10 : 3,
  keepalive: isProduction ? 30 : 0,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: sslOptionsForConnectionString(connectionString),
});
```

---

## Key Decisions

### D1: Upstash Redis for rate limiting

Vercel-native, no server needed. Free tier: 10K commands/day (sufficient for launch). Alternative: Vercel KV (same infrastructure, different SDK). Using `@upstash/ratelimit` + `@upstash/redis`.

### D2: Wallet signature auth (not JWT)

No user accounts or sessions in this app. Auth = prove you own a Solana wallet. Flow:
1. Client requests a nonce from `GET /api/auth/nonce`
2. Client signs `nonce + timestamp` with wallet
3. Client sends `Authorization: Bearer <base64(signature)>.<base64(message)>` 
4. Server verifies signature with `tweetnacl.sign.detached.verify`
5. Nonce consumed (deleted from Redis)

This matches the Solana ecosystem pattern (Phantom/Solflare wallet adapters).

### D3: Structured logging to stdout

Vercel collects stdout. No external log service needed for launch. Pino writes JSON to stdout, Vercel displays in dashboard. Phase P2 adds Sentry for error tracking.

### D4: Transactional event indexing

Wrap the event insert + campaigns.totalClaimed update + sync_state update in a single `db.transaction()`. If any step fails, all roll back. Eliminates the partial-write risk.

---

## File Map

### New files

| File | Purpose |
|------|---------|
| `apps/web/src/middleware.ts` | CORS, security headers, OPTIONS preflight |
| `apps/web/src/lib/api/rate-limit.ts` | Upstash rate limiter factory |
| `apps/web/src/lib/api/auth-middleware.ts` | Wallet signature verification |
| `apps/web/src/lib/api/errors.ts` | `AppError` class + `errorHandler` wrapper |
| `apps/web/src/lib/api/logger.ts` | Pino structured logger |
| `apps/web/src/app/api/health/route.ts` | Health check (DB + RPC) |
| `apps/web/src/app/api/auth/nonce/route.ts` | Nonce generation for wallet auth |
| `apps/web/src/lib/db/migrations/0003_rls_policies.sql` | RLS on all tables |
| `apps/web/tests/api/security.test.ts` | Rate limit + auth + CORS tests |
| `apps/web/tests/api/health.test.ts` | Health endpoint tests |

### Modified files

| File | Change |
|------|--------|
| `apps/web/next.config.ts` | Add security headers in `headers()` function |
| `apps/web/src/lib/db/index.ts` | Pool tuning (max, keepalive) |
| `apps/web/src/lib/db/schema.ts` | Add `syncState` table |
| `apps/web/src/app/api/campaigns/route.ts` | Wrap POST with auth + rate limit + error handler + logger |
| `apps/web/src/app/api/campaigns/[treeAddress]/root-versions/route.ts` | Same wrapping |
| `apps/web/src/app/api/admin/sync/route.ts` | Add sync_state read/write + transactional indexing |
| `apps/web/src/lib/indexer/claim-events.ts` | Transactional batch writes + sync_state update |

---

## Dependency order

```
middleware.ts (CORS/headers) ─┐
rate-limit.ts ────────────────┤
auth-middleware.ts ───────────┤── P0 (parallel, no deps between them)
errors.ts ────────────────────┤
logger.ts ────────────────────┘
       │
       ▼
  health/route.ts ──────── P1.1 (depends on errors + logger)
  db/index.ts tuning ───── P1.2 (independent)
  sync_state table ──────── P1.3 (depends on schema change)
  transactional indexer ─── P1.4 (depends on sync_state + errors)
  RLS migration ─────────── P1.5 (depends on all P0 + P1)
  route wrapping ─────────── P1.6 (depends on all P0 middleware)
  tests ──────────────────── P1.7 (depends on everything above)
```

---

## Environment variables

```bash
# Rate limiting (Upstash)
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxx

# Existing (no changes)
DATABASE_URL=postgresql://...
ADMIN_API_KEY=xxx
NEXT_PUBLIC_RPC_ENDPOINT=https://api.devnet.solana.com
DATABASE_SSL_REJECT_UNAUTHORIZED=true
```

---

## Out of scope

- Sentry integration (P2)
- API versioning `/api/v1/` (P2)
- Load testing (P2)
- Backup strategy (P2)
- Monitoring dashboard (P2)
- CSRF tokens (not needed — wallet signature auth is not cookie-based)
