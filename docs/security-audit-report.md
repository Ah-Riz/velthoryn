# Velthoryn Security Audit Report

**Date:** 2026-06-02
**Scope:** Smart Contract (Anchor/Solana) + Backend API (Next.js) + Database (Supabase/Postgres) + Merkle Pipeline
**Program ID:** `E12PjVA4EhHSfypw8jM31Mx5ZByjYemJWNTXfFru5GEK`
**Reference:** [sealevel-attacks](https://github.com/coral-xyz/sealevel-attacks)

---

## Executive Summary

| Category | Critical | High | Medium | Low | Info | Pass |
|----------|----------|------|--------|-----|------|------|
| Smart Contract | 0 | 0 | 0 | 1 | 0 | 28 |
| Backend API | 0 | 0 | 1 | 1 | 0 | 6 |
| Database | 1 | 0 | 0 | 2 | 1 | 1 |
| **Total** | **1** | **0** | **1** | **4** | **1** | **35** |

---

## PART A — Smart Contract Security

### 1. Signer Authority — ✅ PASS (9/9 instructions verified)

All instructions enforce signer authorization via Anchor constraints (`has_one`, `seeds`, `Signer`):

| Instruction | Auth Check | Test |
|---|---|---|
| `create_campaign` | PDA seeds include `creator` — wrong signer → seeds mismatch | ✅ |
| `create_stream` | `has_one = creator` on seeds | ✅ |
| `fund_campaign` | `has_one = creator` (6005) | ✅ (existing) |
| `cancel_campaign` | `cancel_authority == Some(signer)` constraint (6005) | ✅ |
| `cancel_stream` | `has_one = creator` (6005) | ✅ |
| `update_root` | `cancel_authority == Some(signer)` constraint (6005) | ✅ |
| `pause/unpause` | `pause_authority == Some(signer)` constraint (6005) | ✅ |
| `withdraw_unvested` | `has_one = creator` → seeds mismatch for non-creator | ✅ |
| `set_milestone_released` | `has_one = creator` (6005) | ✅ |
| `instant_refund_campaign` | `creator == signer` constraint → seeds mismatch for non-creator | ✅ |

### 2. PDA Seeds Uniqueness — ✅ PASS (6/6 tests)

VestingTree PDA: `["tree", creator, mint, campaign_id_le]` — unique per (creator, mint, campaignId) tuple.
ClaimRecord PDA: `["claim", tree, beneficiary]` — unique per (tree, beneficiary) pair.
VaultAuthority PDA: `["vault_authority", tree]` — deterministic per tree.

- Different campaign_id → different PDA ✅
- Different creator → different PDA ✅
- Different mint → different PDA ✅
- Different beneficiary → different ClaimRecord PDA ✅
- VaultAuthority deterministic and unique per tree ✅

### 3. Integer Overflow — ✅ PASS

- `schedule::vested()` uses `u128` intermediate arithmetic — no overflow possible for `u64` inputs ✅
- `claim`, `withdraw`, `cancel_stream` all use `checked_add`/`checked_sub` with `Overflow` error ✅
- `fund_campaign` uses `checked_add` for vault balance with `OverFunded` cap check ✅
- `week7-edge-cases.spec.ts` EC16: `u64::MAX` linear at 50% — no overflow ✅
- Fund with near-u64::MAX → `OverFunded` or `Overflow` ✅

### 4. Account Ownership — ✅ PASS

- Wrong mint → `MintMismatch` (6007) ✅
- Wrong vault → `WrongVault` (6018) ✅
- Token-2022 mint rejected: `UnsupportedMint` constraint checks `mint.owner == token_program` ✅ (existing test)
- `source_ata` ownership validated via constraint: `source_ata.owner == creator.key()` ✅

### 5. Reentrancy — ✅ PASS (Code Analysis)

All CPI calls target external programs only (Token program, System program). No instruction CPIs back into the vesting program. No reentry path exists.

**CEI Pattern verified in all mutating instructions:**
- `claim.rs`: state mutated (claimed_amount, total_claimed, milestone_bitmap) → then CPI transfer
- `withdraw.rs`: same CEI pattern
- `cancel_stream.rs`: state mutated (cancelled_at, claimed_amount, total_claimed) → then 2x CPI transfers
- `instant_refund_campaign.rs`: state mutated (cancelled_at, instant_refunded) → then CPI transfer
- `withdraw_unvested.rs`: no state mutation needed (just transfer)

### 6. Merkle Proof Security — ✅ PASS (3/3 new tests + existing)

- Cross-campaign proof reuse → `InvalidProof` (6013) ✅
- Empty proof on multi-leaf tree → `InvalidProof` ✅
- Single byte tampered proof → `InvalidProof` ✅
- Proof length bounded by `MAX_MERKLE_PROOF_LEN` (32) and `max_proof_len_for_leaf_count` ✅ (existing)
- Oversized proof → `ProofTooLong` (6030) ✅ (existing)

### 7. Vesting Math Security — ✅ PASS (3/3 tests)

- **Vested ≤ total invariant**: Linear vesting with prime amount (777) at 25%/50%/75%/100% — cumulative never exceeds total, final equals exactly AMOUNT ✅
- **Rounding exploit**: amount=7 over 10 seconds (0.7/sec) — 10 progressive claims sum to exactly 7 ✅
- **Cliff boundary**: Before cliff → `NothingToClaim`, exactly at cliff → full amount ✅

### 8. Native SOL Security — ✅ PASS

- Partial claim preserves rent-exempt minimum on PDA ✅
- `NativeSolRentViolation` error prevents sub-rent transfers ✅ (code verified)
- Final claim drains all lamports including rent ✅ (existing test)
- System program transfer CPI for native SOL paths ✅ (code verified)

### 9. Cancel/Clawback Security — ✅ PASS (3/3 tests)

- Beneficiary cannot cancel campaign (only cancel_authority can) ✅
- `cancel_stream`: beneficiary receives vested portion (4000), creator receives remainder (6000) — verified on-chain transfer direction ✅
- `withdraw_unvested` during grace period → `GracePeriodActive` ✅ (existing + new)
- After `instant_refund`, all subsequent claims rejected with `InstantRefundedCampaign` ✅

### 10. Additional Findings

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| SC-L01 | Low | `createStream` and `createCampaign` use `Clock::get()?.unix_timestamp` for `created_at`. On-chain clock can be manipulated by validators. Impact: cosmetic only — `created_at` not used in vesting math. | Accepted |

---

## PART B — Backend API Security

### Authentication Model

The API uses **three** auth mechanisms:

1. **Wallet Auth** (`auth: true` in route config): Ed25519 signature verification with nonce. Used by most mutation routes.
2. **Admin Key Auth** (`admin: true` in route config): `x-admin-key` header checked against `ADMIN_API_KEY` env var via timing-safe SHA-256 comparison.
3. **Cron Auth**: `Authorization: Bearer <CRON_SECRET>` — used only by `/api/cron/sync`.

### Route Auth Matrix

| Route | Method | Auth Type | Rate Limit | Finding |
|-------|--------|-----------|------------|---------|
| `/api/campaigns` | GET | None | 60/min | ✅ Read-only |
| `/api/campaigns` | POST | Wallet | 10/min | ✅ Creator verified |
| `/api/campaigns/import` | POST | Wallet | 5/min | ✅ |
| `/api/campaigns/prepare` | POST | Wallet | 10/min | ✅ |
| `/api/campaigns/[addr]` | GET | None | 60/min | ✅ Read-only |
| `/api/campaigns/[addr]/cancel` | POST | Wallet | 10/min | ✅ Creator verified |
| `/api/campaigns/[addr]/cancel-stream` | POST | Wallet | 10/min | ✅ Creator verified |
| `/api/campaigns/[addr]/withdraw-unvested` | POST | Wallet | 10/min | ✅ Creator verified |
| `/api/campaigns/[addr]/milestones/[idx]` | POST | Wallet | 10/min | ✅ Creator verified |
| `/api/campaigns/[addr]/instant-refund` | POST | Wallet | 10/min | ✅ Creator verified |
| `/api/campaigns/[addr]/status` | PATCH | Wallet | 10/min | ✅ |
| `/api/campaigns/[addr]/root-versions` | POST | Wallet | 10/min | ✅ |
| `/api/campaigns/[addr]/proof` | GET | None | 60/min | ✅ Read-only |
| `/api/campaigns/[addr]/claims` | GET | None | 60/min | ✅ Read-only |
| `/api/campaigns/[addr]/timeline` | GET | None | 60/min | ✅ Read-only |
| `/api/claims/sync` | POST | Wallet | 5/min | ✅ |
| `/api/admin/sync` | POST | Admin | 3/min | ✅ |
| `/api/cron/sync` | GET | Cron Secret | None | ✅ |
| `/api/waitlist` | GET | Admin | 60/min | ✅ |
| `/api/waitlist` | POST | None | 5/min | ✅ Public join |
| `/api/health` | GET | None | None | ✅ |

### API Findings

| ID | Severity | Finding | Recommendation |
|----|----------|---------|----------------|
| API-M01 | Medium | ~~`POST /api/campaigns` (index campaign) has **no authentication**.~~ **Fixed:** `auth: true` added with `getAuthenticatedWallet` creator verification. | ✅ Remediated |
| API-L01 | Low | ~~`POST /api/claims/sync` has no authentication.~~ **Fixed:** `auth: true` added. | ✅ Remediated |

### Positive Findings

- **SQL Injection**: All queries use Drizzle ORM parameterized queries (`sql` template tag with `${}` bindings). No raw string concatenation in SQL. ✅
- **Rate Limiting**: All routes have rate limiting via `withRoute()`. Admin routes: 3-10/min. Public routes: 5-60/min. ✅
- **Timing-safe key comparison**: `verifyAdminKey()` and `verifyApiKey()` both hash inputs with SHA-256 before comparing, preventing timing attacks. ✅
- **Body size limits**: Route-specific body limits enforced via `bodyLimit` option. ✅
- **Input validation**: All request bodies validated via Zod schemas before processing. ✅
- **CORS**: Origin-restricted via middleware. Production defaults to `velthoryn.vercel.app`. ✅
- **Cron auth**: `CRON_SECRET` validated via Bearer token, not exposed in client code. ✅

---

## PART C — Database Security

### Findings

| ID | Severity | Finding | Recommendation |
|----|----------|---------|----------------|
| DB-C01 | **Critical** | **This audit report document itself exposes real production credentials in plain text** (see "Credential Exposure Detail" below). If this report is committed to git or shared externally, all listed credentials are compromised. Note: `.env` and `.env.local` are properly gitignored and were never committed to git — the exposure is in this report file only. | **Redact all credential values from this report immediately. Rotate all exposed credentials as a precaution.** Use secret management (Vercel env vars, Vault) for all production secrets. |
| DB-H01 | Low | **RLS is enabled on 12 of 13 tables** via migrations 0003 and 0004 with public read policies. However, `instant_refund_events` (added in migration 0007) is missing RLS. All other tables are properly protected. | Add `ALTER TABLE instant_refund_events ENABLE ROW LEVEL SECURITY` and a public read policy (migration 0008). |
| DB-L01 | Low | Supabase service-role key is NOT used anywhere in the codebase. Good — only anon key is used client-side. ✅ | — |
| DB-I01 | Info | Database connection uses Supabase connection pooler (`pooler.supabase.com:6543`) which is appropriate for serverless. ✅ | — |

### Credential Exposure Detail

The following credentials are exposed in git (`.env` and `.env.local`):

```
DATABASE_URL=postgresql://postgres.akxrfgwkdmragzlzlgbd:[REDACTED]@...
PINATA_API_KEY=[REDACTED]
PINATA_SECRET_API_KEY=[REDACTED]
PINATA_JWT=[REDACTED]
ADMIN_API_KEY=[REDACTED]
NEXT_PUBLIC_SUPABASE_ANON_KEY=[REDACTED]
```

> ⚠️ **Action required:** Rotate all above credentials even though values are now redacted. They were previously exposed in an earlier draft of this report.

---

## Test Coverage Summary

### New Tests (`tests/week7-security-sc.spec.ts`) — 29 tests

| Section | Tests | Status |
|---------|-------|--------|
| 1. Signer Authority | 9 | ✅ All pass |
| 2. PDA Seeds Uniqueness | 6 | ✅ All pass |
| 3. Integer Overflow | 1 | ✅ Pass |
| 4. Account Ownership | 2 | ✅ All pass |
| 5. Reentrancy Analysis | 1 | ✅ Pass (code analysis) |
| 6. Merkle Proof Security | 3 | ✅ All pass |
| 7. Vesting Math Security | 3 | ✅ All pass |
| 8. Native SOL Security | 1 | ✅ Pass |
| 9. Cancel/Clawback Security | 3 | ✅ All pass |

### Existing Tests (no duplication verified)

- `security.spec.ts`: 12 exploit tests (over-claim, forged proof, oversized proof, double milestone, etc.)
- `week7-edge-cases.spec.ts`: 7 edge cases (zero-amount leaf, update root, cliff boundary, u64::MAX, rounding, insufficient balance, grace boundary)
- `vesting.supplementary.spec.ts`: 70+ validation tests
- `instant-refund-campaign.spec.ts`: 8 instant refund tests
- `vesting-native-sol.spec.ts`: Native SOL lifecycle tests
- `vesting.clock.spec.ts`: 12 clock-dependent tests
- `week7-integration-flow.spec.ts`: 4 full integration flows

---

## Remediation Priority

1. **[DB-C01] CRITICAL**: Redact all credentials from this report. Rotate all exposed credentials as a precaution.
2. **[DB-H01] LOW**: Add RLS to `instant_refund_events` table (migration 0008)
3. **[API-M01] MEDIUM**: Add auth to `POST /api/campaigns` (campaign indexing)
4. **[API-L01] LOW**: Add auth to `POST /api/claims/sync`
5. **[SC-L01] LOW**: Accepted — on-chain clock manipulation has no security impact
