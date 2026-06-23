# Trust Boundaries

This reference documents the authentication and authorization model for every API route in the Velora backend. Routes are classified into four trust tiers based on the sensitivity of the operation they perform.

---

## Authentication Tiers

| Tier | Meaning | Enforcement |
|------|---------|-------------|
| **Public** | No authentication required. Rate-limited per IP (default 60 req/min unless noted). Safe for anonymous reads and stateless helpers. | `withRoute()` without `auth: true` or `admin: true`; no secret header checked in handler. |
| **Wallet Auth** | Caller must prove control of a Solana wallet via ed25519 signature over a nonce-backed message. | `withRoute({ auth: true })` invokes `requireAuth()` in `@/lib/api/auth-middleware.ts`. Handlers often additionally verify the signer matches an on-chain authority (creator, cancel authority). |
| **Admin** | Internal/operator only. Not for browser clients. | `withRoute({ admin: true })` checks `x-admin-key` header against `ADMIN_API_KEY`, or handler checks `Authorization: Bearer <CRON_SECRET>`. |
| **Removed** | Route exists in the codebase but must not be used. State must come from the on-chain indexer. | Documented for migration awareness; frontend must not call this endpoint. |

### Why These Tiers Exist

- **Public reads** (campaign lists, proofs, timelines) mirror on-chain data that is already publicly visible on Solana. Rate limiting prevents abuse; requiring wallet auth would block anonymous dashboard views.
- **Wallet Auth writes** build or record transactions that must match an on-chain signer. Signature verification prevents impersonating another wallet's identity.
- **Admin routes** trigger bulk indexing or expose operator data (waitlist export). They use server-side secrets, not wallet signatures.
- **Removed routes** previously allowed direct DB writes (e.g., pause/cancel flags) that could diverge from on-chain truth. Status now flows exclusively from indexed events.

---

## Per-Route Auth Requirements

### Public Routes

| Route | Method | Rate Limit | Description |
|-------|--------|------------|-------------|
| `/api/campaigns` | GET | 60/min | Paginated campaign list |
| `/api/campaigns/:treeAddress` | GET | 60/min | Single campaign detail with analytics |
| `/api/campaigns/:treeAddress/proof` | GET | 60/min | Merkle proof lookup by beneficiary |
| `/api/campaigns/:treeAddress/claims` | GET | 60/min | Claim history for a campaign |
| `/api/campaigns/:treeAddress/timeline` | GET | 60/min | Event timeline for dashboard |
| `/api/campaigns/prepare` | POST | 60/min | Server-side Merkle tree construction (stateless) |
| `/api/beneficiary/:address/campaigns` | GET | 60/min | Campaigns where address is a beneficiary |
| `/api/beneficiary/:address/vesting-progress` | GET | 60/min | Aggregated vesting progress |
| `/api/activity/:address` | GET | 60/min | Cross-campaign activity feed |
| `/api/auth/nonce` | GET | 60/min | Issue one-time nonce for wallet auth flow |
| `/api/events/sync` | POST | 20/min | Index Anchor events from tx signatures |
| `/api/health` | GET | None | Liveness check (DB + RPC); returns 503 when degraded |
| `/api/simulate-vesting` | POST | 30/min | Pure math vesting curve simulation |
| `/api/schedule-templates` | GET | 60/min | Preset schedule templates |
| `/api/waitlist` | POST | 5/min | Email signup |

### Wallet Auth Routes

All wallet-authenticated routes require the `Authorization` header with an ed25519 signature. The signer is verified against the relevant on-chain authority.

| Route | Method | Required Signer | Description |
|-------|--------|----------------|-------------|
| `/api/campaigns` | POST | `creator` | Register campaign + leaves after on-chain creation |
| `/api/campaigns/import` | POST | Any wallet | CSV bulk recipient upload |
| `/api/campaigns/:treeAddress/root-versions` | POST | `cancel_authority` | Record root rotation |
| `/api/campaigns/:treeAddress/cancel` | POST | `cancel_authority` | Build cancel campaign transaction |
| `/api/campaigns/:treeAddress/withdraw-unvested` | POST | `cancel_authority` | Build withdraw unvested transaction |
| `/api/campaigns/:treeAddress/cancel-stream` | POST | `cancel_authority` | Build stream cancel transaction |
| `/api/campaigns/:treeAddress/milestones/:idx` | POST | `cancel_authority` | Build milestone release transaction |
| `/api/campaigns/:treeAddress/instant-refund` | POST | `cancel_authority` | Build instant refund transaction |

### Admin Routes

| Route | Method | Auth Mechanism | Rate Limit | Description |
|-------|--------|---------------|------------|-------------|
| `/api/admin/sync` | POST | `x-admin-key: <ADMIN_API_KEY>` | 3/min | Full event indexer run |
| `/api/claims/sync` | POST | `x-admin-key: <ADMIN_API_KEY>` | 5/min | Claim event backfill |
| `/api/cron/sync` | GET | `Authorization: Bearer <CRON_SECRET>` | None | Vercel cron entry point |
| `/api/waitlist` | GET | `x-admin-key: <ADMIN_API_KEY>` | 60/min | Export waitlist (JSON or CSV) |

### Removed Routes

| Route | Method | Replacement |
|-------|--------|-------------|
| `/api/campaigns/:treeAddress/status` | PATCH | Use on-chain transactions + indexer. Read state from `GET /api/campaigns/:treeAddress` and timeline endpoints. |

{% hint style="warning" %}
The `PATCH /status` endpoint previously allowed direct writes of `paused` and `cancelledAt` to the database, creating a trust gap with on-chain state. Status now flows exclusively from indexed events (`CampaignPaused`, `CampaignUnpaused`, `CampaignCancelled`).
{% endhint %}

---

## Wallet Auth Flow

The wallet authentication flow uses a nonce-based ed25519 signature scheme.

### Sequence

1. **Frontend** requests a nonce: `GET /api/auth/nonce`
2. **Server** stores the nonce in Redis with a 5-minute TTL
3. **Frontend** builds a JSON message: `{ nonce, timestamp, wallet }`
4. **Frontend** signs the message with `wallet.signMessage()`
5. **Frontend** sends the request with `Authorization: Bearer <base64(sig)>.<base64(message)>`
6. **Server** consumes the nonce from Redis (`GETDEL`), verifies timestamp and ed25519 signature
7. **Handler** may additionally verify the signer matches an on-chain authority

### Header Format

```
Authorization: Bearer <base64url(signature)>.<base64url(messageBytes)>
```

The `messageBytes` are UTF-8 JSON:

```json
{
  "nonce": "abc123...",
  "timestamp": 1718000000000,
  "wallet": "<base58 pubkey>"
}
```

### Server Verification Steps

1. Parse the `Authorization` Bearer token into signature and message components
2. Consume nonce from Redis via `GETDEL` -- replay is rejected if missing or already used
3. Reject if `timestamp` is in the future or older than 5 minutes
4. Verify ed25519 signature against the `wallet` public key using `nacl.sign.detached.verify`
5. Route handler may additionally require the signer to match a specific on-chain authority (creator, cancel authority)

---

## Admin Auth

| Mechanism | Header | Environment Variable | Protected Routes |
|-----------|--------|---------------------|------------------|
| Admin API key | `x-admin-key: <secret>` | `ADMIN_API_KEY` | `POST /api/admin/sync`, `POST /api/claims/sync`, `GET /api/waitlist` |
| Cron secret | `Authorization: Bearer <secret>` | `CRON_SECRET` | `GET /api/cron/sync` |

Both use timing-safe comparison (`verifyAdminKey` in `@/lib/auth.ts`) to prevent timing attacks.

{% hint style="warning" %}
Never embed `ADMIN_API_KEY` or `CRON_SECRET` in client-side code. These are server-side secrets only. Browser clients that need post-claim indexing should use `POST /api/events/sync` (public, rate-limited) or wait for the cron sync.
{% endhint %}

---

## Frontend Implementation Checklist

- Fetch a nonce via `GET /api/auth/nonce` before each mutating request (or refresh on 401)
- Include the `Authorization` header on all Wallet Auth routes listed above
- Do not call `PATCH /api/campaigns/:treeAddress/status` -- poll indexed campaign state instead
- Do not embed `ADMIN_API_KEY` or `CRON_SECRET` in client code
- Use `POST /api/events/sync` for browser-initiated post-transaction indexing
