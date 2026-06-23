# API Route Trust Boundaries (Phase 00)

> **Superseded for day-to-day use.** See [`API_TRUST_BOUNDARIES.md`](API_TRUST_BOUNDARIES.md) for the current full route table (26 routes, June 2026). This file is kept as the original P0.2 scoping note.

**Owner:** Lana (SC/BE) — definitions for P0.2 implementation by Geral  
**Date:** 2026-05-25  
**Scope:** Routes that mirror or index on-chain vesting state

---

## Summary

Four mutating API routes currently accept unauthenticated writes. Status changes must not be written directly to the database; they must follow on-chain events via the indexer (F2).

---

## Route policies

| Route | Current auth | Required auth | Notes |
|-------|-------------|---------------|-------|
| `POST /api/campaigns` | None | **Wallet signature** (creator) | Verify the signer owns or controls the funding wallet used in `create_campaign`. Reject if leaf proofs fail `verifyAllLeaves`. |
| `POST /api/campaigns/[treeAddress]/root-versions` | None | **Wallet signature** (creator or designated authority) | Verify signer matches campaign `cancel_authority` or creator per on-chain `VestingTree` (same trust as `update_root`). |
| `PATCH /api/campaigns/[treeAddress]/status` | None | **Remove route** | Do not write `paused` / `cancelledAt` to DB from an API call. Index `CampaignPaused`, `CampaignUnpaused`, `CampaignCancelled` from chain (F2). |
| `POST /api/claims/sync` | None | **Admin API key** (existing pattern) | Trusted indexer only; acceptable for internal sync. |

---

## Implementation notes (for P0.2)

1. **Wallet signature:** `Authorization: Bearer <base64(signature)>` with a nonce + message body; verify ed25519 server-side; store last N nonces in Redis for replay protection.
2. **PATCH status removal:** Coordinate with FE — use wallet-signed tx builders (F3) or read indexed state from `GET /api/campaigns/[treeAddress]`.
3. **Read routes** (`GET /api/campaigns`, proof, claims): public read with rate limiting (P0.1); no wallet auth required.

---

## Related

- Requirements: `docs/roadmap/00-REQUIREMENTS-SC-REMEDIATION.md` (US-4.1)
- Design: `docs/roadmap/00-DESIGN-SC-REMEDIATION.md` (API Route Trust Boundaries table)
- P0 security gate: `docs/roadmap/01-REQUIREMENTS-P0-SECURITY-OPS.md`
