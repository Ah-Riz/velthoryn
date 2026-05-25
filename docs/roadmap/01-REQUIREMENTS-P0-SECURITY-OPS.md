# Production Security & Operational Baseline — Requirements

**Phase:** P0 (Security Gate) + P1 (Operational Baseline)
**Blocks:** All other feature specs (F1-F4, P2)
**Owner:** Lana (BE lead)
**Estimate:** 7-9 days

---

## Overview

This phase hardens the backend API to production grade before any new feature endpoints ship. It adds protection against abuse (rate limiting, authentication, body size limits), secures the HTTP layer (CORS, security headers, row-level security), and establishes operational foundations (structured logging, health checks, graceful errors, sync checkpointing, transactional indexing). After this phase, every API route will enforce consistent security controls, return standardized error responses, and produce observable logs.

---

## User Stories

### Theme S1: Rate Limiting

#### US-S1.1 — Protect public read endpoints from abuse

**As a** Public visitor, **I want** read endpoints to remain responsive even under heavy traffic, **so that** I can always look up campaign details and proofs without timeouts.

- **GIVEN** I am an unauthenticated visitor
- **WHEN** I send more than 60 GET requests to any API route within 60 seconds
- **THEN** I receive a 429 status with a `Retry-After` header indicating when I can retry
- **AND** subsequent requests within the cooldown window also return 429

#### US-S1.2 — Protect campaign creation from flooding

**As an** Admin, **I want** campaign-creating endpoints to be tightly rate-limited, **so that** a single user cannot overload the server with expensive tree-verification requests.

- **GIVEN** I am an authenticated creator
- **WHEN** I send more than 10 POST requests to `/api/campaigns` within 60 seconds
- **THEN** I receive a 429 status with a `Retry-After` header
- **AND** the rate limit resets after the window expires

#### US-S1.3 — Protect admin sync from accidental hammering

**As an** Admin, **I want** the sync endpoint to be very tightly rate-limited, **so that** the Solana RPC is not overwhelmed by repeated manual sync calls.

- **GIVEN** I am an authenticated admin
- **WHEN** I send more than 3 POST requests to `/api/admin/sync` within 60 seconds
- **THEN** I receive a 429 status with a `Retry-After` header

---

### Theme S2: Authentication

#### US-S2.1 — Require proof of wallet ownership for campaign creation

**As a** Creator, **I want** to sign a request with my Solana wallet before creating a campaign, **so that** only verified wallet owners can write data to the platform.

- **GIVEN** I want to create a campaign or rotate a root
- **WHEN** I send a POST request without an `Authorization` header
- **THEN** I receive a 401 status with `WWW-Authenticate: Solana` header
- **AND** the request is rejected without processing

#### US-S2.2 — Obtain a nonce for signing

**As a** Creator, **I want** to request a fresh nonce from the API, **so that** I can sign it with my wallet to prove ownership.

- **GIVEN** I need to authenticate
- **WHEN** I send a GET request to the nonce endpoint
- **THEN** I receive a unique nonce and its expiration time
- **AND** the nonce expires within 5 minutes

#### US-S2.3 — Prevent replay attacks

**As an** Admin, **I want** each nonce to be usable only once, **so that** an intercepted signed message cannot be replayed.

- **GIVEN** a creator has successfully authenticated using a nonce
- **WHEN** the same signed message is submitted again
- **THEN** I receive a 401 status indicating the nonce has expired or already been used

#### US-S2.4 — Reject tampered signatures

**As an** Admin, **I want** the server to reject invalid signatures, **so that** an attacker cannot forge requests from a wallet they do not control.

- **GIVEN** a request contains a signature that does not match the claimed wallet public key
- **WHEN** the server verifies the signature
- **THEN** I receive a 401 status with no details about why verification failed

#### US-S2.5 — Keep admin key authentication unchanged

**As an** Admin, **I want** the existing `x-admin-key` header authentication to continue working for admin routes, **so that** I do not need to change my operational tooling.

- **GIVEN** I am calling an admin endpoint (`/api/admin/*`)
- **WHEN** I provide a valid `x-admin-key` header
- **THEN** the request is processed as before
- **AND** no wallet signature is required

---

### Theme S3: CORS

#### US-S3.1 — Allow cross-origin requests from the production domain

**As a** Public visitor, **I want** the API to accept requests from the production frontend domain, **so that** the web application can successfully call API endpoints from the browser.

- **GIVEN** the frontend is hosted on the production domain
- **WHEN** the browser sends a cross-origin request with the correct `Origin` header
- **THEN** the response includes `Access-Control-Allow-Origin` matching the production domain
- **AND** the request is processed normally

#### US-S3.2 — Reject cross-origin requests from unknown domains

**As an** Admin, **I want** the API to reject cross-origin requests from domains other than the production frontend, **so that** third-party sites cannot call the API directly from a browser.

- **GIVEN** a browser sends a request with an `Origin` header from an unauthorized domain
- **WHEN** the server processes the CORS check
- **THEN** the response does not include `Access-Control-Allow-Origin`
- **AND** the browser blocks the response from being read by the requesting page

#### US-S3.3 — Handle OPTIONS preflight requests

**As a** Public visitor, **I want** preflight OPTIONS requests to return quickly, **so that** the browser can proceed with the actual request without delay.

- **GIVEN** the browser sends an OPTIONS preflight request to any API route
- **WHEN** the server receives it
- **THEN** the response is 204 with appropriate CORS headers (`Allow-Methods`, `Allow-Headers`)
- **AND** the preflight response is cached for at least 24 hours (`Access-Control-Max-Age`)

---

### Theme S4: Security Headers

#### US-S4.1 — Prevent clickjacking

**As a** Public visitor, **I want** the API responses to include clickjacking protection, **so that** the application cannot be embedded in a malicious iframe.

- **GIVEN** any API response is returned
- **WHEN** I inspect the response headers
- **THEN** `X-Frame-Options` is set to `DENY`

#### US-S4.2 — Prevent MIME-type sniffing

**As a** Public visitor, **I want** responses to declare their content type strictly, **so that** browsers do not guess or reinterpret the content.

- **GIVEN** any API response is returned
- **WHEN** I inspect the response headers
- **THEN** `X-Content-Type-Options` is set to `nosniff`

#### US-S4.3 — Enforce HTTPS

**As a** Public visitor, **I want** the API to require HTTPS, **so that** my data cannot be intercepted on the network.

- **GIVEN** any API response is returned
- **WHEN** I inspect the response headers
- **THEN** `Strict-Transport-Security` is present with a long max-age and includes subdomains

---

### Theme S5: Request Body Limits

#### US-S5.1 — Reject oversized request bodies

**As an** Admin, **I want** the API to reject unreasonably large request bodies, **so that** a malicious request cannot consume all serverless function memory.

- **GIVEN** a POST request with a body larger than the configured limit
- **WHEN** the server checks the request size
- **THEN** the response is 413 (Payload Too Large) before any processing begins
- **AND** the size limits are: 2 MB for campaign creation, 10 MB for CSV import, 2 MB for root version rotation, 1 MB for all other routes

---

### Theme S6: Row-Level Security

#### US-S6.1 — Allow public read access to all tables

**As a** Public visitor, **I want** to query campaign data, leaves, root versions, and claim events without authentication, **so that** I can view transparency data freely.

- **GIVEN** a read-only database connection using the anon role
- **WHEN** I execute a SELECT query on campaigns, root_versions, leaves, or claim_events
- **THEN** the query succeeds and returns data

#### US-S6.2 — Block public write access

**As an** Admin, **I want** unauthenticated database connections to be unable to insert or modify data, **so that** all writes go through the API layer which enforces authentication.

- **GIVEN** a database connection using the anon role
- **WHEN** I attempt an INSERT, UPDATE, or DELETE on any table
- **THEN** the query is rejected by the database due to row-level security policy

---

### Theme O1: Structured Logging

#### US-O1.1 — Every request produces a structured log entry

**As an** Admin, **I want** every API request to produce a log entry with consistent fields, **so that** I can search, filter, and correlate logs in the Vercel dashboard.

- **GIVEN** any API request is processed
- **WHEN** the request completes (successfully or with error)
- **THEN** a structured JSON log entry is emitted containing at minimum: `requestId`, `method`, `path`, `status`, `durationMs`, and `timestamp`
- **AND** the `requestId` is included in both the log and the API response for correlation

#### US-O1.2 — Log entries are machine-parseable

**As an** Admin, **I want** production logs in JSON format, **so that** log aggregation tools can parse them without custom patterns.

- **GIVEN** the application is running in production mode
- **WHEN** any log is emitted
- **THEN** the log is a single-line JSON object with a `level` field and structured data fields

#### US-O1.3 — Development logs are human-readable

**As a** Developer, **I want** logs in development mode to be pretty-printed, **so that** I can read them easily during debugging.

- **GIVEN** the application is running in development mode
- **WHEN** any log is emitted
- **THEN** the log is formatted for terminal readability (not raw JSON)

---

### Theme O2: Health Check

#### US-O2.1 — Verify service health

**As an** Admin, **I want** a health check endpoint that verifies both the database and blockchain RPC connectivity, **so that** I can confirm the service is fully operational.

- **GIVEN** the API is deployed and running
- **WHEN** I send a GET request to the health endpoint
- **THEN** I receive a JSON response with the status of the database connection and the Solana RPC connection
- **AND** the response includes a version identifier and timestamp

#### US-O2.2 — Report degraded state

**As an** Admin, **I want** the health check to report a degraded or down status when a dependency is unavailable, **so that** monitoring can detect partial failures.

- **GIVEN** the database is unreachable
- **WHEN** I send a GET request to the health endpoint
- **THEN** the response is 503 with `db: false` in the body
- **AND** the response still includes the RPC status and version

- **GIVEN** the Solana RPC is unreachable
- **WHEN** I send a GET request to the health endpoint
- **THEN** the response is 503 with `rpc: false` in the body

---

### Theme O3: Database Connection Pool

#### US-O3.1 — Maintain sufficient connections under load

**As an** Admin, **I want** the database connection pool to be sized appropriately for production traffic, **so that** requests do not time out waiting for a connection.

- **GIVEN** the application is running in production
- **WHEN** multiple concurrent requests arrive
- **THEN** the pool supports up to 10 simultaneous connections
- **AND** idle connections are kept alive to prevent Supabase from closing them

---

### Theme O4: Error Responses

#### US-O4.1 — Receive structured error responses

**As a** Creator, **I want** all API errors returned in a consistent format, **so that** my frontend can parse and display error messages uniformly.

- **GIVEN** any API request results in an error
- **WHEN** the error response is returned
- **THEN** the response body is JSON with `error` (human-readable message), `code` (machine-readable string), and `requestId` fields
- **AND** standard error codes include: `VALIDATION_ERROR` (400), `NOT_FOUND` (404), `UNAUTHORIZED` (401), `RATE_LIMITED` (429), `PAYLOAD_TOO_LARGE` (413), `INTERNAL_ERROR` (500)

#### US-O4.2 — Internal errors do not leak details

**As an** Admin, **I want** internal server errors to return a generic message to the client, **so that** stack traces and internal state are never exposed.

- **GIVEN** an unhandled exception occurs during request processing
- **WHEN** the error response is returned to the client
- **THEN** the `error` field contains a generic message (not the exception message)
- **AND** the `requestId` is included so I can look up the full error in server logs

---

### Theme O5: Sync Checkpointing

#### US-O5.1 — Resume event syncing from last processed position

**As an** Admin, **I want** the event indexer to remember where it left off, **so that** restarting the sync does not reprocess already-handled events.

- **GIVEN** the event indexer has previously synced up to slot N
- **WHEN** I trigger a new sync run without specifying a starting slot
- **THEN** the indexer starts from slot N+1
- **AND** no events from slot N or earlier are reprocessed

#### US-O5.2 — Persist sync progress after each batch

**As an** Admin, **I want** the sync progress to be saved after each successful batch of events, **so that** progress is not lost if a later batch fails.

- **GIVEN** the indexer has processed a batch of events up to slot M
- **WHEN** the batch completes successfully
- **THEN** the last synced slot is persisted to the database
- **AND** a subsequent crash and restart resumes from slot M+1

---

### Theme O6/O7: Transactional Indexing

#### US-O6.1 — Event indexing is all-or-nothing per event

**As an** Admin, **I want** each event to be fully indexed or not indexed at all, **so that** the database never contains partial or inconsistent state after a failed sync.

- **GIVEN** the indexer is processing a claim event
- **WHEN** the event insert succeeds but the campaign's `totalClaimed` update fails
- **THEN** the event insert is also rolled back
- **AND** the sync state checkpoint is not advanced past this event

#### US-O6.2 — Sync checkpoint advances only on success

**As an** Admin, **I want** the sync checkpoint to update only after all operations in a batch succeed, **so that** a failed batch is retried on the next run.

- **GIVEN** a batch of events is being processed within a transaction
- **WHEN** all inserts and updates succeed
- **THEN** the sync state is updated to reflect the highest slot in the batch
- **WHEN** any operation fails
- **THEN** the sync state remains at the previous checkpoint

---

### Theme: BigInt Serialization

#### US-BI1 — API responses never contain raw BigInt values

**As a** Public visitor, **I want** all large numeric values in API responses to be represented as strings, **so that** every JSON client can parse the response without errors.

- **GIVEN** a database column stores a u64 value (e.g., total supply, amount, slot, timestamp)
- **WHEN** the value is included in an API response
- **THEN** it is serialized as a decimal string, not as a JavaScript BigInt
- **AND** `JSON.parse` on the response body succeeds without error in every environment

---

## Non-Functional Requirements

- **Performance**: Rate limiting checks must add less than 20 ms latency per request (Redis round-trip). Health checks must respond within 5 seconds (including dependency timeouts).
- **Security**: Nonce values must be cryptographically random. Signature verification must use constant-time comparison. Internal error details must never appear in client-facing responses. The `Retry-After` header on 429 responses must be accurate.
- **Reliability**: Event indexing transactions must guarantee atomicity — if any step fails, the entire batch rolls back. Sync checkpointing must persist to durable storage (database, not memory).
- **Observability**: Every request must include a unique `requestId` in both the response and the log entry. Log output must be parseable as JSON in production. Health check must distinguish between database failures and RPC failures.
- **Zero breaking changes**: All existing GET endpoints must continue to return the same response shapes. The admin key authentication flow must remain unchanged. Existing query parameters and filter behavior must not change.

---

## Dependencies

- **Upstash Redis**: Required for rate limiting and nonce storage. A free-tier account (10K commands/day) is sufficient for launch.
- **`tweetnacl`**: Required for Ed25519 signature verification on the server. No hosted service dependency.
- **`pino`**: Required for structured logging. Writes to stdout; no external log service needed.
- **Supabase RLS**: Row-level security policies require the Supabase anon and service_role keys to be properly configured. The application currently uses a single `DATABASE_URL`; this phase may require verifying that the connection string role supports RLS.
- **No P0/P1 dependencies on other specs**: This spec blocks all feature specs (F1-F4) and hardening (P2), but nothing blocks this spec.

---

## Out of Scope

- Sentry or external error monitoring (Phase P2)
- API versioning with a `/api/v1/` prefix (Phase P2)
- Load testing or performance benchmarks (Phase P2)
- Database backup and restore strategy (Phase P2)
- Monitoring dashboard or alerting (Phase P2)
- Indexing event types beyond `Claimed` (covered in F2 — Dashboard Transparency)
- Campaign state sync for cancelled/paused/root-rotated state (covered in F2)
- CSRF tokens (not needed — authentication is wallet-signature-based, not cookie-based)
- Token-2022 guard in the smart contract (SC P1, separate from this BE phase)
- Changes to the Merkle pipeline or TS SDK
