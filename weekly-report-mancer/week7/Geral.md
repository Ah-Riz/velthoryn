# Weekly Report — Geral (Week 7)

## What I built this week

**Frontend test suite and security review for Velthoryn Token Vesting. Main focus: write comprehensive FE integration tests, edge case tests, and security tests covering all user flows. Cross-referenced all 11 sealevel-attacks vectors against our codebase. Documented issues found and produced security checklist + coverage report.**

### 1. FE Integration Test Suite (41 tests)

**Problem:** Frontend had existing unit tests (236) but no dedicated Week 7 integration tests covering full user flows from create → claim → cancel → withdraw.

**Solution:** Created `tests/week7/week7-fe-integration.test.ts` covering 8 test categories.

#### Test categories

| Category | Tests | What it covers |
|----------|-------|----------------|
| Create stream form validation | 11 | Valid/invalid forms for cliff, linear, milestone; decimal precision; 60s cliff gap |
| Bulk CSV pipeline | 12 | Parse, validate, prepare; duplicates; milestone dedup; type filtering; Merkle tree build |
| Claim flow calculations | 4 | `toRawAmount` decimal conversion; zero handling; max precision |
| Cancel dialog logic | 4 | Grace period state machine; boundary conditions |
| Withdraw unvested | 8 | Disabled reasons: loading, paused, cancelled, cliff not reached, milestone not released |
| Vesting display | 5 | Countdown formatting; type labels |
| Token picker / SOL wrap | 5 | `isNativeSol`, `isWrappedSol`, `solToLamports`; mint address constants |
| CSV encoding edge cases | 4 | Quoted fields; CRLF; ISO dates; case-insensitive release type |

#### File

- `apps/web/tests/week7/week7-fe-integration.test.ts`

---

### 2. FE Edge Case Test Suite (54 tests)

**Problem:** No tests for boundary conditions — zero amounts, u64 overflow, negative timestamps, empty bitmaps, malformed CSV — that could break the product during a demo.

**Solution:** Created `tests/week7/week7-fe-edge-cases.test.ts` covering 10 edge case categories.

#### Key edge cases tested

| Category | Tests | Examples |
|----------|-------|---------|
| Zero/boundary amounts | 10 | Zero, u64 max, negative, minimum fraction, 0 decimals |
| Invalid addresses | 9 | HTML, script tags, SQL injection, unicode, null bytes, long strings |
| Schedule boundaries | 8 | cliff == start, 60s minimum, epoch 0, year 2100, NaN |
| Campaign ID | 5 | Zero, negative, float, non-numeric |
| Milestone index | 5 | 0, 255, 256 (overflow), -1, float |
| Milestone bitmap | 7 | Bit isolation, empty bitmap, beyond length, all 0xFF |
| Grace period | 4 | 1s before expiry, exactly at expiry, future cancel, boundary |
| Malformed CSV | 7 | Headers only, empty rows, zero amount, invalid type, negative ts, milestone >255 |
| Countdown display | 4 | Exactly 1 day, 1 hour, 59 seconds, 365 days |
| Compound form | 4 | All empty, 0-decimal mint, same beneficiary/mint, milestone idx 0 |

#### File

- `apps/web/tests/week7/week7-fe-edge-cases.test.ts`

---

### 3. FE Security Test Suite (65 tests)

**Problem:** No dedicated security test suite validating XSS prevention, input sanitization, error message sanitization, Merkle proof tamper detection, or amount overflow protection.

**Solution:** Created `tests/week7/week7-fe-security.test.ts` with 10 security test categories.

#### Security test categories

| Category | Tests | What it validates |
|----------|-------|-------------------|
| XSS prevention | 11 | 10 XSS payloads rejected in all form fields + full form compound test |
| SQL injection prevention | 5 | 5 SQL payloads rejected in address + amount fields |
| CSV formula injection | 3 | `=CMD`, `+CMD`, formula prefixes blocked |
| Amount overflow | 5 | u64 max, large decimal conversion, BigInt safety, lamports precision |
| Error message sanitization | 12 | Long messages truncated, stack traces stripped, URLs stripped, 41 error codes mapped |
| Merkle proof tamper | 3 | Wrong leaf data rejected, empty proof rejected, `verifyAllLeaves` fails fast |
| Milestone bitmap bounds | 5 | Negative index, >255, beyond bitmap, empty bitmap, bit isolation |
| Public key spoofing | 4 | Null bytes, unicode lookalikes, trailing whitespace, embedded tab |
| Retryable error classification | 2 | 7 transient patterns retryable, 7 permanent patterns non-retryable |
| Error code exhaustiveness | 4 | All 41 codes unique, sequential from 6000, mapped by name + hex |

#### File

- `apps/web/tests/week7/week7-fe-security.test.ts`

---

### 4. Sealevel Attacks Cross-Reference

**Problem:** Week 7 requires a security review referencing [coral-xyz/sealevel-attacks](https://github.com/coral-xyz/sealevel-attacks).

**Solution:** Reviewed all 11 attack vectors from the sealevel-attacks repo and mapped each to our smart contract mitigations and FE-side verification.

#### Cross-reference summary

| # | Attack | Our Mitigation |
|---|--------|----------------|
| 0 | Signer Authorization | `Signer<'info>` on all 14 instructions |
| 1 | Account Data Matching | `has_one`, `constraint` checks on every account struct |
| 2 | Owner Checks | Mint ownership verified; Token-2022 rejected |
| 3 | Type Cosplay | Anchor auto-discriminators on VestingTree, ClaimRecord |
| 4 | Initialization | `init` + `init_if_needed` with payer |
| 5 | Arbitrary CPI | Only `token::transfer` via PDA signer |
| 6 | Duplicate Mutable Accounts | Anchor enforced + CSV duplicate check |
| 7 | Bump Seed Canonicalization | Bump stored on init, reused |
| 8 | PDA Sharing | Seeds include creator + campaign_id |
| 9 | Closing Accounts | `close = beneficiary` + CannotClose guard |
| 10 | Sysvar Address Checking | Anchor handles automatically |

**All 11 vectors mitigated. No vulnerabilities found.**

Full cross-reference in `docs/WEEK7_FE_SECURITY_CHECKLIST.md` appendix.

---

### 5. Security Checklist (56 checks)

Created `docs/WEEK7_FE_SECURITY_CHECKLIST.md` with 56 security checks across 10 categories:

| Category | Checks | Result |
|----------|--------|--------|
| Input Validation & Sanitization | 8 | 8/8 PASS |
| Error Message Sanitization | 7 | 7/7 PASS |
| Merkle Proof Integrity | 4 | 4/4 PASS |
| Milestone Bitmap Bounds | 5 | 5/5 PASS |
| Amount & Math Safety | 6 | 6/6 PASS |
| Wallet & Auth Security | 5 | 5/5 PASS |
| Data Storage & Privacy | 3 | 3/3 PASS |
| Network & API Security | 4 | 4/4 PASS |
| Retryable Error Safety | 3 | 3/3 PASS |
| Sealevel Attacks | 11 | 11/11 PASS |
| **Total** | **56** | **56/56 PASS** |

---

### 6. Issue Documentation

Created `docs/WEEK7_FE_ISSUE_LOG.md` documenting 5 issues found during testing:

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | Invalid base58 addresses in CSV test data | Low | ✅ Fixed |
| 2 | Trailing whitespace in addresses | Info | ✅ Not a bug (trim handles it) |
| 3 | Negative Unix timestamps accepted in CSV | Low | ℹ️ Documented |
| 4 | `toRawAmount` no u64 upper bound check | Low | ℹ️ Documented |
| 5 | Timeline missing instant refund events (Lana's bug) | Low | ✅ Fixed on dev_lana |

No critical or high-severity issues found.

---

### 7. Coverage Report

Created `docs/WEEK7_FE_COVERAGE_REPORT.md`:

- **540 total tests** (236 existing + 304 new Week 7)
- **0 failures**
- **Unit-testable FE code: 81.12% line coverage** (>80% criterion met)
- Server-side code (DB, indexer, API routes) covered by Lana's integration tests

---

## How Lana and I split the work

| Area | Owner | Deliverables |
|------|-------|-------------|
| Smart contract tests (65 tests) | Lana | `week7-integration-flow.spec.ts`, `week7-edge-cases.spec.ts`, `week7-security-sc.spec.ts`, `week7-coverage-gaps.spec.ts` |
| Smart contract security audit | Lana | Signer authority, PDA seeds, overflow, reentrancy |
| Backend API + DB tests | Lana | Timeline API fix, 9/9 API tests, migrations |
| Feature validation report | Lana | `WEEK7_FEATURE_VALIDATION_REPORT.md`, `WEEK7_COVERAGE_REPORT.md` |
| **FE integration tests (41 tests)** | **Geral** | `week7-fe-integration.test.ts` |
| **FE edge case tests (54 tests)** | **Geral** | `week7-fe-edge-cases.test.ts` |
| **FE security tests (65 tests)** | **Geral** | `week7-fe-security.test.ts` |
| **FE security checklist (56 checks)** | **Geral** | `WEEK7_FE_SECURITY_CHECKLIST.md` |
| **FE issue log** | **Geral** | `WEEK7_FE_ISSUE_LOG.md` |
| **FE coverage report** | **Geral** | `WEEK7_FE_COVERAGE_REPORT.md` |
| **Sealevel attacks cross-reference** | **Geral** | Appendix in security checklist |

---

## My individual blockers and insights

### Blockers

- **DB auth for full test suite:** `globalSetup.ts` requires local PostgreSQL — limits FE tests to unit-only without DB. Workaround: `vitest.unit.config.ts` runs 540 tests without DB.
- **Coverage provider version mismatch:** `@vitest/coverage-v8@4.x` incompatible with `vitest@3.x`. Fixed by downgrading to `@vitest/coverage-v8@^3.0.0`.

### Insights

1. **Error message sanitization is the most underrated security layer in token apps.** While testing `formatVestingError` in `errors.ts`, I found that without the >200 char cutoff + URL/stack trace detection, error messages from Solana RPC could expose: (a) internal RPC endpoint URLs (e.g., `https://api.internal.com/...`), (b) full stack traces with file paths and line numbers, (c) raw account public keys involved in failed transactions. I tested 12 different error patterns — all were properly sanitized to generic user-facing messages. This is critical because a DeFi frontend that leaks RPC URLs invites targeted DoS, and leaked account keys could reveal internal program architecture.

2. **CSV formula injection is a real attack vector for token vesting.** When testing CSV upload for bulk campaigns, I verified that payloads like `=CMD('calc')`, `+CMD()`, and `@SUM()` in the beneficiary or amount field are rejected. In a vesting product where creators upload recipient lists via CSV, a malicious CSV could trigger formula execution when opened in Excel — potentially exfiltrating data from the creator's machine. Our defense: strict address validation (`new PublicKey()`) and numeric-only amount validation reject all formula prefixes (`=`, `+`, `-`, `@`) as invalid input.

3. **Milestone bitmap has a subtle edge case at index 255.** The bitmap uses `Uint8Array` with bit-level indexing: `bitmap[byteIndex] & (1 << bitIndex)`. At index 255 (maximum u8), `byteIndex = 31` and `bitIndex = 7`, requiring exactly 32 bytes of bitmap data. I tested all 256 possible indices and confirmed `isMilestoneTriggered` handles: negative indices (returns false, not crash), indices beyond bitmap length (returns false), and empty bitmaps (returns false for all). Without these bounds checks, a milestone vesting campaign with >8 milestones could trigger undefined behavior on index 8+ if the bitmap is only 1 byte.

4. **Sealevel attack #8 (PDA Sharing) is the most relevant risk for our architecture.** Our VestingTree PDA uses seeds `["tree", creator, mint, campaign_id_le]`. If seeds only included `creator + campaign_id` without `mint`, a malicious creator could: create campaign A with Token X, fund it, then create campaign B with same campaign_id but Token Y, and the PDA collision would let them claim Token X using Token Y's proof. The `mint` in seeds prevents this entirely. I verified this by testing that different mints produce different PDAs in `pda.test.ts`.

5. **`toRawAmount` silently allows amounts exceeding u64 max (18.4 quintillion).** During testing, I found that `toRawAmount("999999999999.999999999", 9)` produces a valid BigInt that's ~10^21 — well above u64 max (1.8×10^19). The FE doesn't reject this; it relies on the on-chain program to catch the overflow with error code 6008 (Overflow). For a future improvement, adding a client-side `BigInt(result) <= 2n**64n - 1n` check in `prepareBulkCampaign` would give users a friendlier error message instead of a cryptic transaction failure.

6. **Retryable error classification prevents double-spend risk.** The `isRetryableError` function classifies "BlockhashNotFound" and "TransactionExpiredBlockheightExceeded" as retryable, but importantly does NOT classify "OverClaim" (6017) or "AlreadyCancelled" (6020) as retryable. If OverClaim were retried, a user could accidentally submit the same claim transaction twice — the first might succeed and the second would fail, but the retry mechanism would keep trying. By correctly separating transient (network) from permanent (business logic) errors, we prevent claim retry loops.

---

## Files changed/created this week

### New files
- `apps/web/tests/week7/week7-fe-integration.test.ts` — 41 integration tests
- `apps/web/tests/week7/week7-fe-edge-cases.test.ts` — 54 edge case tests
- `apps/web/tests/week7/week7-fe-security.test.ts` — 65 security tests
- `apps/web/tests/week7/week7-fe-coverage-boost.test.ts` — 106 coverage boost tests
- `apps/web/tests/week7/week7-fe-coverage-boost-2.test.ts` — 38 additional coverage tests
- `docs/WEEK7_FE_SECURITY_CHECKLIST.md` — 56-check security checklist + sealevel cross-ref
- `docs/WEEK7_SECURITY_CHECKLIST_GDOC.md` — Combined SC+FE checklist for Google Doc submission
- `docs/WEEK7_FE_ISSUE_LOG.md` — 5 issues documented
- `docs/WEEK7_FE_COVERAGE_REPORT.md` — Coverage analysis
- `weekly-report-mancer/week7/Geral.md` — This report

### Modified files
- `apps/web/vitest.unit.config.ts` — Added `tests/week7/**/*.test.ts` to include pattern
- `package.json` — Added `@vitest/coverage-v8` dev dependency
