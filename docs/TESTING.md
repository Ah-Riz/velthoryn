# Testing Guide

This document explains how to run and write tests for the Mancer Vesting program.

## Test Suite Overview

The test suite consists of 63 tests across 4 files:

| Test File | Tests | Purpose |
|-----------|-------|---------|
| `tests/vesting.spec.ts` | 2 | Smoke tests (program ID, IDL structure) |
| `tests/vesting.supplementary.spec.ts` | 51 | Integration tests covering all instructions |
| `tests/security.spec.ts` | 10 | Security exploit tests |
| `tests/golden_vector.spec.ts` | 1 | Cross-language hash verification |

## Running Tests

### Local Test Validator (Recommended)

For reliable, deterministic test runs, use a persistent local validator:

```bash
# Terminal 1: Start local validator with clean state
solana-test-validator --reset

# Terminal 2: Run tests
anchor test
```

**Expected results:** 61 passing, 2 known failures (T19, T48 - error-code mismatches)

### One-Shot Local Testing

```bash
anchor test
```

This starts and stops a local validator automatically. Less reliable for time-sensitive tests.

### Devnet Testing

```bash
solana config set --url devnet
anchor test --skip-local-validator
```

**Expected results:** 44 passing, 12 stale-PDA failures (persistent state), 8 skipped (setClock unavailable)

## Time-Sensitive Tests

Several tests (T17, T18, T25, T55) use the `setClock` RPC method to warp the validator's clock for precise timing. This method **only works on local test validators**, not on devnet.

### Clock Validation

As of the latest fixes, these tests use consistent 90% threshold validation:

```typescript
// After setClock call, verify clock actually advanced
const clockValid = await validateClockAdvance(
  provider,
  targetTimestamp,
  baselineTimestamp,
  90, // 90% threshold
);
if (!clockValid) {
  this.skip(); // Skip gracefully on devnet
}
```

This ensures:
- Tests pass when setClock works (local validator)
- Tests skip gracefully when setClock doesn't work (devnet)
- No misleading failures like "expected 2500, got 20"

### Utilities

Clock validation utilities are in `tests/utils/helpers.ts`:

- `validateClockAdvance()` — Core validation logic
- `skipIfClockNotAdvanced()` — Mocha-friendly wrapper

## Test Isolation

**Important:** Integration tests create on-chain accounts that persist between runs. Always use `solana-test-validator --reset` for clean local runs.

### Why No Cleanup?

Anchor test accounts cannot easily be closed programmatically due to:
- SOL rent exemption minimums
- PDA-derived addresses that can't be closed without authority
- Complex account interdependencies

### Best Practices

1. **Use `--reset` flag** when starting local validator
2. **Run tests in isolation** for debugging: `anchor test -- --grep "T17"`
3. **Skip expensive tests** locally: `anchor test -- --grep "^(?!T55)"` (skips 7-day grace test)

## Writing New Tests

### Test Structure

```typescript
describe("feature name", () => {
  const { provider, program, creator, cancelAuthority, pauseAuthority } = setup();

  it("test name", async () => {
    // 1. Setup (create accounts, fund)
    // 2. Action (call instruction)
    // 3. Assertion (verify state changes)
  });
});
```

### Helper Functions

Use utilities from `tests/utils/helpers.ts`:

- `createAndFundCampaign()` — Create + fund campaign in one call
- `issueClaim()` — Execute claim with all boilerplate
- `createTimeHelpers()` — Get validator's current timestamp
- `validateClockAdvance()` — Verify setClock worked
- `expectAnchorError()` — Assert specific error codes

### Time-Based Tests

For tests that depend on time passing:

```typescript
const t = await createTimeHelpers(provider.connection);
const start = t.now;
const end = t.now + 1000;
const targetTimestamp = start + 250;

// Use validateClockAdvance for deterministic timing
const clockValid = await validateClockAdvance(
  provider,
  targetTimestamp,
  start,
  90, // 90% threshold
);
if (!clockValid) {
  this.skip();
}

// Proceed with test using targetTimestamp
```

## Debugging Failed Tests

### Enable Logging

```bash
RUST_LOG=anchor_lang::solana_program=info anchor test
```

### Inspect Accounts

```bash
# After test run, inspect account state
solana account <PDA_ADDRESS> --url localhost
```

### Run Single Test

```bash
anchor test -- --grep "T17"
```

### Check Validator Logs

Local validator logs show to stdout. Look for:
- Program log outputs
- CPI call traces
- Error details

## Known Test Issues

### T19 — withdraw_unvested non-creator

**Issue:** Expects `Unauthorized` (6005) but gets different error.

**Status:** Pending investigation — may be error code mismatch in test assertion.

### T48 — over-claim

**Issue:** Expects `OverClaim` (6017) but gets different error code.

**Status:** Pending investigation — may be error code mismatch in test assertion.

### T55 — 7-day grace period

**Issue:** Uses `setClock` to warp 7 days forward; skips without clock control.

**Status:** Not a bug — test infrastructure limitation. Test validates correct logic when it runs.

## CI/CD

Tests run automatically on:

- **Push to main/PR:** `.github/workflows/ci.yml`
- **Manual trigger:** GitHub Actions UI

CI runs `anchor build` + `anchor test` with cached dependencies.

## Test Metrics

| Metric | Value |
|--------|-------|
| Total tests | 63 |
| Passing (local) | 61 (97%) |
| Known failures | 2 (error-code mismatches) |
| Test code lines | 4,675 |
| Helper utilities | 649 lines (385 test utils + 264 clock validation) |
