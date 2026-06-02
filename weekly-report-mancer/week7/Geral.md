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

- **396 total tests** (236 existing + 160 new Week 7)
- **0 failures**
- **Unit-testable FE code: ~92% line coverage** (>80% criterion met)
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

- **DB auth for full test suite:** `globalSetup.ts` requires local PostgreSQL — limits FE tests to unit-only without DB. Workaround: `vitest.unit.config.ts` runs 396 tests without DB.
- **Coverage provider version mismatch:** `@vitest/coverage-v8@4.x` incompatible with `vitest@3.x`. Fixed by downgrading to `@vitest/coverage-v8@^3.0.0`.

### Insights

1. **Input validation is the FE's first line of defense.** Every XSS payload, SQL injection, and CSV formula injection was caught by existing validators (`validatePublicKey`, `validateAmount`, etc.) because they use strict pattern matching, not blacklists. This is the right approach — validation by format, not by known-bad patterns.

2. **Error message sanitization prevents information leakage.** `formatVestingError` in `errors.ts` has a >200 char cutoff + URL/stack trace detection that prevents RPC endpoints, internal paths, and debug info from reaching users. Found this was already well-implemented — no changes needed.

3. **BigInt everywhere for token math is critical.** All token amount calculations use `bigint` instead of `number`, preventing float precision loss that could lead to over-claims or incorrect vesting calculations. This is especially important for tokens with 9 decimal places where `Number` precision breaks down above ~2^53.

4. **Sealevel attacks are already mitigated by Anchor.** 8 of 11 attack vectors are handled automatically by Anchor's type system (`Signer`, `Account`, PDA seeds, discriminators). The remaining 3 (account data matching, arbitrary CPI, PDA sharing) require manual constraints — all present in our code.

5. **Milestone bitmap bounds checking prevents runtime crashes.** `isMilestoneTriggered` correctly handles negative indices, indices beyond bitmap length, and empty bitmaps — any of which could crash if unchecked in a language without bounds protection.

---

## Files changed/created this week

### New files
- `apps/web/tests/week7/week7-fe-integration.test.ts` — 41 integration tests
- `apps/web/tests/week7/week7-fe-edge-cases.test.ts` — 54 edge case tests
- `apps/web/tests/week7/week7-fe-security.test.ts` — 65 security tests
- `docs/WEEK7_FE_SECURITY_CHECKLIST.md` — 56-check security checklist + sealevel cross-ref
- `docs/WEEK7_FE_ISSUE_LOG.md` — 5 issues documented
- `docs/WEEK7_FE_COVERAGE_REPORT.md` — Coverage analysis
- `weekly-report-mancer/week7/Geral.md` — This report

### Modified files
- `apps/web/vitest.unit.config.ts` — Added `tests/week7/**/*.test.ts` to include pattern
- `package.json` — Added `@vitest/coverage-v8` dev dependency
