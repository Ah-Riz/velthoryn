# Velthoryn — Week 7 Security Checklist

**Team:** Team 7 (Mancer × Superteam)  
**Product:** Velthoryn Token Vesting (Solana)  
**Program ID:** `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`  
**Date:** 2026-06-05  
**Reviewers:** Geral (FE), Lana (SC/BE)  
**Reference:** [coral-xyz/sealevel-attacks](https://github.com/coral-xyz/sealevel-attacks)

---

## Executive Summary

| Layer | Checks | Pass | Fail | Critical Issues |
|-------|--------|------|------|-----------------|
| Smart Contract | 29 | 29 | 0 | 0 |
| Frontend | 45 | 45 | 0 | 0 |
| Sealevel Attacks | 11 | 11 | 0 | 0 |
| **Total** | **85** | **85** | **0** | **0** |

---

## PART A — Smart Contract Security (Lana)

### A1. Signer Authority — ✅ PASS (10/10 instructions)

All instructions enforce signer authorization via Anchor `Signer<'info>`, `has_one`, and `constraint`:

| Instruction | Auth Check | Tested |
|---|---|---|
| `create_campaign` | PDA seeds include `creator` | ✅ |
| `create_stream` | `has_one = creator` | ✅ |
| `fund_campaign` | `has_one = creator` (6005) | ✅ |
| `cancel_campaign` | `cancel_authority == Some(signer)` (6005) | ✅ |
| `cancel_stream` | `has_one = creator` (6005) | ✅ |
| `update_root` | `cancel_authority == Some(signer)` (6005) | ✅ |
| `pause/unpause` | `pause_authority == Some(signer)` (6005) | ✅ |
| `withdraw_unvested` | `has_one = creator` | ✅ |
| `set_milestone_released` | `has_one = creator` (6005) | ✅ |
| `instant_refund_campaign` | `creator == signer` | ✅ |

**Evidence:** `tests/week7-security-sc.spec.ts` — 12+ wrong-signer tests (lines 356–663)

### A2. PDA Seeds Uniqueness — ✅ PASS

- VestingTree PDA: `["tree", creator, mint, campaign_id_le]` — unique per (creator, mint, campaignId)
- ClaimRecord PDA: `["claim", tree, beneficiary]` — unique per (tree, beneficiary)
- VaultAuthority PDA: `["vault_authority", tree]` — deterministic per tree

**Evidence:** `tests/week7-security-sc.spec.ts` — 6 PDA uniqueness tests (lines 671–729)

### A3. Integer Overflow — ✅ PASS

- `schedule::vested()` uses `u128` intermediate arithmetic — no overflow for `u64` inputs
- `claim`, `withdraw`, `cancel_stream` use `checked_add`/`checked_sub` with `Overflow` error
- `fund_campaign` uses `checked_add` with `OverFunded` cap check
- Edge case: `u64::MAX` linear at 50% — no overflow

**Evidence:** `tests/week7-edge-cases.spec.ts` EC16 (line 671)

### A4. Account Ownership — ✅ PASS

- Wrong mint → `MintMismatch` (6007)
- Wrong vault → `WrongVault` (6018)
- Cross-campaign claim attempt → rejected

**Evidence:** `tests/week7-security-sc.spec.ts` — lines 778–918

### A5. No Reentrancy — ✅ PASS

- CEI pattern followed: all state mutations before CPI transfers
- All CPIs are external (SPL Token `transfer`) — no recursive program calls

**Evidence:** `tests/week7-security-sc.spec.ts` — lines 859–867

### A6. Proof Integrity — ✅ PASS

- Invalid proof rejected with `InvalidProof` (6013)
- Tampered leaf amount → proof fails
- Empty proof on multi-leaf → rejected

### A7. Cancellation & Grace Period — ✅ PASS

- 7-day grace period enforced before `withdraw_unvested`
- Vested tokens protected during cancel — beneficiary keeps earned amount
- Double cancel → `AlreadyCancelled` (6020)
- Cancel at exactly end time → 100% to beneficiary, 0% to creator

### A8. Milestone Security — ✅ PASS

- Milestone release gated to creator only
- Double release → `MilestoneAlreadyReleased` (6034)
- Claim before release → `MilestoneNotReleased` (6033)

### A9. Instant Refund — ✅ PASS

- Only allowed on unstarted campaigns (before min cliff time)
- Only allowed on multi-leaf campaigns
- After start → `CampaignAlreadyStarted` (6036)

---

## PART B — Frontend Security (Geral)

### B1. Input Validation & Sanitization — ✅ PASS (8/8)

| Check | Status | Evidence |
|---|---|---|
| All user text inputs validated before use | ✅ | `stream-form.ts` validates all fields |
| Public keys validated via `PublicKey()` constructor | ✅ | `validatePublicKey()` try/catch |
| Amounts validated with decimal precision | ✅ | `validateAmountWithDecimals()` |
| HTML/script tags rejected in all form fields | ✅ | 10 XSS payloads tested |
| SQL injection strings rejected | ✅ | 5 SQL payloads tested |
| CSV formula injection blocked | ✅ | `=CMD`, `+CMD` rejected |
| Unicode lookalike addresses rejected | ✅ | Cyrillic lookalike rejected |
| Null bytes in input rejected | ✅ | `\x00` fails base58 decode |

**Evidence:** `tests/week7/week7-fe-security.test.ts` — 11 XSS tests, 5 SQL tests, 3 CSV injection tests

### B2. Error Message Sanitization — ✅ PASS (7/7)

| Check | Status | Details |
|---|---|---|
| Long messages truncated | ✅ | >200 chars → generic fallback |
| Stack traces stripped | ✅ | Messages with `at ` → fallback |
| Internal URLs stripped | ✅ | Messages with `http` → fallback |
| 41 Anchor error codes mapped | ✅ | All codes by hex + name |
| Wallet rejections friendly | ✅ | "User rejected" → friendly msg |
| Network errors helpful | ✅ | "Failed to fetch" → connection msg |
| Error codes exhaustive | ✅ | 41/41 tested |

**Evidence:** `tests/week7/week7-fe-security.test.ts` — 12 error sanitization tests

### B3. Merkle Proof Integrity (FE-side) — ✅ PASS (4/4)

| Check | Status |
|---|---|
| Tampered leaf data rejected | ✅ |
| Empty proof on multi-leaf rejected | ✅ |
| `verifyAllLeaves` fails fast | ✅ |
| Single-leaf root match | ✅ |

### B4. Milestone Bitmap Bounds — ✅ PASS (5/5)

| Check | Status |
|---|---|
| Negative index → false | ✅ |
| Index ≥256 → false | ✅ |
| Beyond bitmap length → false | ✅ |
| Empty bitmap safe | ✅ |
| Correct bit isolation | ✅ |

### B5. Amount & Math Safety — ✅ PASS (6/6)

| Check | Status |
|---|---|
| BigInt for all token amounts | ✅ |
| `toRawAmount` handles edge cases | ✅ |
| `solToLamports` uses `Math.floor` | ✅ |
| Grace period uses BigInt | ✅ |
| No division by zero | ✅ |
| Percentages clamped [0,100] | ✅ |

### B6. Wallet & Auth Security — ✅ PASS (5/5)

| Check | Status |
|---|---|
| Wallet disconnect blocks operations | ✅ |
| Simulation before signing | ✅ |
| Wallet cancellation detected | ✅ |
| Fallback send path available | ✅ |
| No private keys stored client-side | ✅ |

### B7. Data Storage — ✅ PASS (3/3)

| Check | Status |
|---|---|
| No sensitive data in localStorage | ✅ |
| No auth tokens stored | ✅ |
| Local data cleaned after indexing | ✅ |

### B8. Network & API — ✅ PASS (4/4)

| Check | Status |
|---|---|
| Retryable vs permanent errors classified | ✅ |
| API responses validated | ✅ |
| Claim sync retries with backoff | ✅ |
| No raw errors shown to users | ✅ |

### B9. Retry Safety — ✅ PASS (3/3)

| Check | Status |
|---|---|
| Transient errors retryable | ✅ |
| Permanent errors NOT retryable | ✅ |
| Max 5 retries with backoff | ✅ |

---

## PART C — Sealevel Attacks Cross-Reference

Reference: [coral-xyz/sealevel-attacks](https://github.com/coral-xyz/sealevel-attacks)

| # | Attack Vector | Mitigation | Status |
|---|---|---|---|
| 0 | Signer Authorization | `Signer<'info>` on all instructions | ✅ PASS |
| 1 | Account Data Matching | `has_one`, `constraint` on all account structs | ✅ PASS |
| 2 | Owner Checks | Mint ownership verified; Token-2022 rejected | ✅ PASS |
| 3 | Type Cosplay | Anchor auto-discriminators on VestingTree, ClaimRecord | ✅ PASS |
| 4 | Initialization | `init` + `init_if_needed` with payer | ✅ PASS |
| 5 | Arbitrary CPI | Only `token::transfer` via PDA signer seeds | ✅ PASS |
| 6 | Duplicate Mutable Accounts | Anchor enforced + CSV duplicate beneficiary check | ✅ PASS |
| 7 | Bump Seed Canonicalization | Bump stored on init, reused on every access | ✅ PASS |
| 8 | PDA Sharing | Seeds include `creator` + `campaign_id` — unique per campaign | ✅ PASS |
| 9 | Closing Accounts | `close = beneficiary` + `CannotClose` guard | ✅ PASS |
| 10 | Sysvar Address Checking | Anchor handles sysvar injection automatically | ✅ PASS |

---

## Issues Found & Fixed

| # | Issue | Severity | Layer | Status |
|---|---|---|---|---|
| 1 | Timeline missing `instant_refund_events` UNION ALL | Low | BE | ✅ Fixed |
| 2 | Invalid base58 addresses in CSV test data | Low | FE | ✅ Fixed |
| 3 | Trailing whitespace in addresses | Info | FE | ✅ Not a bug (trim handles it) |
| 4 | Negative timestamps accepted in CSV | Low | FE | ℹ️ Documented |
| 5 | `toRawAmount` no u64 upper bound check | Low | FE | ℹ️ Documented |

**No critical or high-severity security issues remaining.**

---

## Test Evidence

| Suite | Tests | Owner |
|---|---|---|
| `week7-integration-flow.spec.ts` | 21 | Lana |
| `week7-edge-cases.spec.ts` | 8 | Lana |
| `week7-security-sc.spec.ts` | 29 | Lana |
| `week7-coverage-gaps.spec.ts` | 7 | Lana |
| `week7-fe-integration.test.ts` | 41 | Geral |
| `week7-fe-edge-cases.test.ts` | 54 | Geral |
| `week7-fe-security.test.ts` | 65 | Geral |
| E2E mock wallet (15 spec files, all flows) | 82 | Geral |
| E2E real signing (8 spec files, claim/cancel/milestone/wrap/root rotation) | 32 | Geral |
| **Total** | **339** | |

---

## Coverage

| Layer | Coverage | Criterion |
|---|---|---|
| Smart Contract (14 instructions) | 98.02% | >80% ✅ |
| FE Unit-Testable Code | ~92% | >80% ✅ |
| Combined | >90% | >80% ✅ |
