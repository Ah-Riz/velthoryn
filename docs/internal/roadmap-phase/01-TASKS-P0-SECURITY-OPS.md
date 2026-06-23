# Tasks: Production Security & Operational Baseline

**Spec:** `production-security-ops`
**Phase:** P0 (Security Gate) + P1 (Operational Baseline)
**Blocks:** All other specs
**Prerequisite:** `docs/roadmap/00-GAP-ANALYSIS.md` reviewed

---

## P0 — Security Gate

### P0.1 — Rate limiter utility
- [x] Install `@upstash/ratelimit` and `@upstash/redis`
- [x] Create `apps/web/src/lib/api/rate-limit.ts`
  - Export `rateLimit(key: string, limits: { requests: number, window: seconds }) => Promise<{ success: boolean, remaining: number, reset: number }>`
  - Use `Ratelimit.fixedWindow` from Upstash
  - Return 429 with `Retry-After` header on limit exceeded
  - Key = IP (from `x-forwarded-for` or `x-real-ip`) or wallet address if authenticated
- [x] Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to `.env.example`
- [x] **Verify:** Unit test creates 11 requests to a 10/min endpoint; 11th returns `success: false`

### P0.2 — Wallet signature auth middleware
- [x] Install `tweetnacl` and `@solana/web3.js` (already present)
- [x] Create `apps/web/src/app/api/auth/nonce/route.ts`
  - `GET`: generate random nonce, store in Redis with 5min TTL, return `{ nonce, expiresAt }`
- [x] Create `apps/web/src/lib/api/auth-middleware.ts`
  - Export `requireAuth(request: NextRequest): Promise<{ publicKey: string } | NextResponse>`
  - Parse `Authorization: Bearer <base64(signature)>.<base64(message)>` header
  - Extract signature bytes and message JSON `{ nonce, timestamp, wallet }`
  - Verify nonce exists in Redis (prevents replay)
  - Verify timestamp within 5min window
  - Verify signature with `nacl.sign.detached.verify(messageBytes, signature, publicKey)`
  - Delete nonce from Redis (one-time use)
  - Return 401 on any failure with `WWW-Authenticate: Solana` header
- [x] **Verify:** Unit test: valid signature passes; expired nonce fails; wrong signature fails; replayed nonce fails

### P0.3 — CORS + security headers middleware
- [x] Create `apps/web/src/middleware.ts`
  - CORS: `Access-Control-Allow-Origin` = env `ALLOWED_ORIGIN` (default `*` for dev)
  - CORS: `Access-Control-Allow-Methods` = `GET, POST, OPTIONS`
  - CORS: `Access-Control-Allow-Headers` = `Content-Type, Authorization`
  - CORS: `Access-Control-Max-Age` = `86400`
  - Handle OPTIONS preflight: return 204 with CORS headers
  - Pass through all other requests
- [x] Update `apps/web/next.config.ts`
  - **NOTE:** `headers()` function already exists with X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, and CSP. Only ADD `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` to the existing array. Do NOT replace the existing headers.
- [x] Add `ALLOWED_ORIGIN` to `.env.example`
- [x] **Verify:** `curl -H "Origin: http://evil.com"` rejected; `curl -H "Origin: https://velthoryn.vercel.app"` accepted; security headers present on all responses

### P0.4 — Request body size limits
- [x] Create helper in `apps/web/src/lib/api/body-limit.ts`
  - Export `checkBodySize(request: NextRequest, maxBytes: number): NextResponse | null`
  - Read `Content-Length` header; reject if > maxBytes with 413
  - Default limits: campaigns=2MB, import=10MB, root-versions=2MB, others=1MB
- [x] **Verify:** POST with 3MB body to `/api/campaigns` returns 413; 1MB body passes

### P0.5 — RLS verification + migration
- [x] Create `apps/web/src/lib/db/migrations/0003_rls_policies.sql`
  - `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on campaigns, root_versions, leaves, claim_events, sync_state
  - `CREATE POLICY "Public read ..."` for SELECT on all tables (using `true`)
  - Note: write operations use `service_role` key which bypasses RLS
- [ ] Verify RLS works: connect as `anon` key → SELECT succeeds, INSERT fails
- [ ] **Verify:** `psql` as anon role: `SELECT * FROM campaigns` works; `INSERT INTO campaigns ...` fails

### P0.6 — Security integration tests
- [x] Create `apps/web/tests/api/security.test.ts`
  - Test: rate limit returns 429 after threshold
  - Test: unauthenticated POST returns 401
  - Test: invalid signature returns 401
  - Test: expired nonce returns 401
  - Test: replayed nonce returns 401
  - Test: CORS preflight returns 204 with correct headers
  - Test: CORS rejects disallowed origin
  - Test: security headers present (X-Frame-Options, etc.)
  - Test: oversized body returns 413
- [x] All tests pass in CI (`pnpm test` in `apps/web/`)

---

## P1 — Operational Baseline

### P1.1 — Structured logger
- [x] Create `apps/web/src/lib/api/logger.ts`
  - Export `logger` with methods: `info`, `warn`, `error`, `debug`
  - Each log includes: `{ timestamp, level, requestId, method, path, message, ...meta }`
  - `requestId` from `x-vercel-id` header or generated UUID
  - In production: JSON format to stdout (Vercel collects)
  - In development: pretty-print to stdout
  - Export `withLogger(handler)` wrapper that attaches requestId to request context
- [x] **Verify:** Log output contains JSON with `requestId`, `method`, `path`, `timestamp` fields

### P1.2 — Error classification
- [x] Create `apps/web/src/lib/api/errors.ts`
  - `class AppError extends Error` with `{ statusCode, code, message, details }`
  - Subclasses: `ValidationError(400)`, `AuthError(401)`, `ForbiddenError(403)`, `NotFoundError(404)`, `RateLimitError(429)`, `PayloadTooLargeError(413)`, `InternalError(500)`
  - Export `errorHandler(handler)` wrapper that catches errors and returns structured response
  - Response format: `{ error: string, code: string, requestId: string, details?: object }`
  - Internal errors: log full stack trace, return generic message (no leak)
- [x] **Verify:** Throwing `new NotFoundError("Campaign")` returns `{ error: "Campaign not found", code: "NOT_FOUND", requestId: "..." }` with 404 status

### P1.3 — Health check endpoint
- [x] Create `apps/web/src/app/api/health/route.ts`
  - `GET /api/health` (no auth, no rate limit)
  - Check DB: `db.execute(sql\`SELECT 1\`)` — timeout 5s
  - Check RPC: `connection.getSlot()` — timeout 5s
  - Return: `{ status: "ok"|"degraded"|"down", db: boolean, rpc: boolean, version: string, timestamp: number }`
  - 200 if all healthy, 503 if any check fails
- [x] **Verify:** `curl /api/health` returns 200 with `{ status: "ok", db: true, rpc: true }`

### P1.4 — DB connection pool tuning
- [x] Update `apps/web/src/lib/db/index.ts`
  - Production: `max: 10`, `keepalive: 30`, `idle_timeout: 20`, `connect_timeout: 10`
  - Development: `max: 3`, `keepalive: 0`, `idle_timeout: 1`
  - Detect via `process.env.NODE_ENV` or `VERCEL` env var
- [x] **Verify:** In production env, pool shows `max: 10` config

### P1.5 — Sync state table + checkpointing
- [x] Add to `apps/web/src/lib/db/schema.ts`:
  ```typescript
  export const syncState = pgTable("sync_state", {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    updatedAt: bigint("updated_at", { mode: "bigint" }).notNull(),
  });
  ```
- [x] Update `apps/web/src/lib/indexer/claim-events.ts`:
  - `syncClaimEvents()` now reads `last_synced_slot` from `sync_state` table (fallback to `fromSlot` param)
  - After each successful batch, write `last_synced_slot` and `last_sync_timestamp` to `sync_state`
  - On next invocation, start from saved slot (no gap, no overlap)
- [ ] **Verify:** Call sync twice; second call starts from slot saved by first call

### P1.6 — Transactional event indexing
- [x] Update `apps/web/src/lib/indexer/claim-events.ts`:
  - Wrap per-event processing in `db.transaction()`:
    ```typescript
    await db.transaction(async (tx) => {
      await tx.insert(claimEvents).values(eventData).onConflictDoNothing();
      await tx.update(campaigns).set({ totalClaimed: ... }).where(eq(campaigns.id, campaignId));
      await tx.update(syncState).set({ value: String(lastSlot), updatedAt: ... }).where(eq(syncState.key, "last_synced_slot"));
    });
    ```
  - If any step fails, all roll back — no partial state
- [ ] **Verify:** Simulate failure mid-batch; verify no rows written for that batch

### P1.7 — BigInt serialization audit
- [x] Audit all API route responses
  - Search for `BigInt` values reaching `JSON.stringify` without `.toString()`
  - Drizzle returns `BigInt` for `bigint` columns with `{ mode: "bigint" }`
  - Fix: add serialization helper or convert in response builders
  - Check: `campaign.totalSupply`, `campaign.totalClaimed`, `campaign.campaignId`, `campaign.cancelledAt`, `campaign.createdAt`, `leaf.amount`, `leaf.startTime`, `leaf.cliffTime`, `leaf.endTime`, `claimEvent.amount`, `claimEvent.slot`, `claimEvent.blockTime`, etc.
- [x] Create `apps/web/src/lib/api/serialize.ts`
  - Export `serialize<T>(obj: T): Serialized<T>` that converts BigInt to string recursively
  - Apply to all API responses
- [x] **Verify:** `JSON.stringify` on any API response never throws `TypeError: Do not know how to serialize a BigInt`

### P1.8 — Wrap existing routes with middleware
- [x] Update all route handlers in `apps/web/src/app/api/`:
  - Import `errorHandler`, `withLogger`, `rateLimit`, `requireAuth`
  - Wrap each POST handler: `errorHandler(withLogger(rateLimit(requireAuth(handler), limits)))`
  - Wrap each GET handler: `errorHandler(withLogger(rateLimit(handler, { requests: 60, window: 60 })))`
  - Admin routes: keep `verifyAdminKey` + add rate limit
  - Health route: no wrapping
- [x] Routes to update:
  - `POST /api/campaigns` — auth + rate limit (10/min)
  - `GET /api/campaigns` — rate limit (60/min)
  - `GET /api/campaigns/:treeAddress` — rate limit (60/min)
  - `POST /api/campaigns/:treeAddress/root-versions` — auth + rate limit (10/min)
  - `GET /api/campaigns/:treeAddress/proof` — rate limit (60/min)
  - `GET /api/campaigns/:treeAddress/claims` — rate limit (60/min)
  - `GET /api/beneficiary/:address/campaigns` — rate limit (60/min)
  - `POST /api/admin/sync` — admin key + rate limit (3/min)
  - `POST /api/waitlist` — rate limit (5/min)
- [x] **Verify:** All existing tests still pass after wrapping

### P1.9 — Operational tests
- [x] Create `apps/web/tests/api/health.test.ts`
  - Test: healthy DB + RPC returns 200
  - Test: DB down returns 503 with `{ db: false }`
  - Test: RPC down returns 503 with `{ rpc: false }`
- [x] Create `apps/web/tests/api/error-handling.test.ts`
  - Test: unhandled exception returns 500 with generic message + requestId
  - Test: Zod validation failure returns 400 with `{ code: "VALIDATION_ERROR", details: [...] }`
  - Test: BigInt values in response are serialized as strings

---

## Verification checklist

After all tasks complete:

- [x] `pnpm test` passes in `apps/web/` (existing + new tests)
- [ ] `pnpm test:localnet` passes (86/86 SC tests unchanged)
- [ ] `curl https://velthoryn.vercel.app/api/health` returns 200
- [ ] `curl -X POST https://velthoryn.vercel.app/api/campaigns` (no auth) returns 401
- [ ] `curl -X POST` with invalid signature returns 401
- [ ] Rate limit triggers after threshold (429 with Retry-After)
- [ ] Security headers present on all responses
- [ ] CORS preflight returns 204
- [ ] BigInt values in all API responses are strings
- [ ] `POST /api/admin/sync` persists `last_synced_slot` to `sync_state` table
- [ ] Event indexing is transactional (no partial writes on failure)
- [ ] DB connection pool shows `max: 10` in production
