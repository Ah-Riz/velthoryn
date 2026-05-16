# Testing Guide

## Test Suite Overview

**265 tests total** — all passing (on-chain security suite includes 11 exploit tests).

- On-chain (Anchor): 63 tests across 5 files
- Frontend (Vitest): 201 tests across 16 files

| Test File | Tests | Purpose |
|-----------|-------|---------|
| `tests/vesting.spec.ts` | 2 | Smoke tests (program ID, IDL structure) |
| `tests/vesting.supplementary.spec.ts` | 50 | Integration tests covering all instructions |
| `tests/vesting.clock.spec.ts` | 7 | Clock-dependent tests via `solana-bankrun` |
| `tests/security.spec.ts` | 11 | Security exploit tests (EXPLOIT 1–11) |
| `tests/golden_vector.spec.ts` | 1 | Cross-language hash verification |

## Running Tests

### Full Suite (local validator)

```bash
anchor test
# Expected: 56 passing, 7 skipped (clock-dependent)
```

### Clock-Dependent Tests (bankrun)

```bash
pnpm exec ts-mocha -p ./tsconfig.json -t 1000000 tests/vesting.clock.spec.ts
# Expected: 7/7 PASS (~600ms)
```

These use `solana-bankrun` + `anchor-bankrun` for deterministic clock control via `context.setClock()`. No external validator needed — bankrun runs an embedded `solana-program-test` instance.

| Test | What it verifies | Clock warp |
|------|-----------------|------------|
| T17 | Linear claim at exactly 25% | +250s from start |
| T18 | Progressive claims at 30%, then 80% | +300s, then +800s |
| T20 | withdraw_unvested after 7-day grace | +604800s |
| T25 | Progressive withdraw via createStream | +300s, then +800s |
| T47 | close_claim_record after grace period | +604800s |
| T55 | Cancel-time clamped withdraw | +500s for cancel, +2000s for withdraw |
| EXPLOIT 4 | Claim after vault drained | +604800s |

### Devnet

```bash
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com anchor test --skip-local-validator
# Expected: 56 passing, 7 skipped
```

Clock-dependent tests skip gracefully on devnet since `setClock` is unavailable on public clusters.

## Test Infrastructure

### Helpers (`tests/utils/`)

| File | Exports |
|------|---------|
| `setup.ts` | `setup()`, `airdrop()`, `createTestMint()`, `fundCreatorAta()`, `makeBeneficiary()`, PDA helpers |
| `helpers.ts` | `createAndFundCampaign()`, `issueClaim()`, `idlLeaf()`, `idlProof()`, `expectAnchorError()`, `validateClockAdvance()` |
| `bankrun.ts` | `startTest()`, `warpClock()`, `bankrunNow()`, PDA helpers (bankrun variant) |
| `time.ts` | `validatorNow()`, `createTimeHelpers()` |

### Writing Tests

```typescript
// Standard test (uses local validator)
describe("feature", () => {
  const { provider, program, creator, cancelAuthority, pauseAuthority } = setup();

  it("test name", async () => {
    // 1. Setup  2. Action  3. Assertion
  });
});
```

For time-dependent tests, use bankrun:

```typescript
import { startTest, warpClock, bankrunNow } from "./utils/bankrun";

describe("clock test", () => {
  let ctx = await startTest();
  const now = await bankrunNow(ctx.context);
  await warpClock(ctx.context, now + 250);
  // ... test assertions
});
```

## Frontend Tests (Vitest)

```bash
cd apps/web
pnpm test              # 201 passing
pnpm test -- --reporter=verbose  # detailed output
```

| Test File | Tests | Purpose |
|-----------|-------|---------|
| `tests/api/backend.test.ts` | 76 | API routes — campaigns, claims, proofs, beneficiary, admin sync |
| `tests/math/vesting.test.ts` | 23 | Vesting math — linear, cliff, milestone, cancel clamp, edge cases |
| `tests/api/bug-fix-validation.test.ts` | 14 | Input validation — address format, amount bounds, date logic |
| `tests/anchor/pda.test.ts` | 10 | PDA derivation — VestingTree, VaultAuthority, ClaimRecord seeds |
| `tests/lib/adapters.test.ts` | 10 | Anchor adapter utils — account parsing, type conversion |
| `tests/lib/anchor-client.test.ts` | 9 | Anchor client — program init, instruction building |
| `tests/lib/auth.test.ts` | 9 | Auth — admin key validation, signature verification |
| `tests/lib/sync-engine.test.ts` | 8 | Indexer sync engine — claim event processing, DB upsert |
| `tests/hooks/useCampaignList.test.ts` | 8 | Hook — campaign list fetch, loading/error/success states |
| `tests/hooks/useClaimHistory.test.ts` | 7 | Hook — claim history, pagination, filtering |
| `tests/hooks/useProofLookup.test.ts` | 6 | Hook — proof fetch, cache, error handling |
| `tests/merkle/builder.test.ts` | 5 | Merkle — encodeLeaf, hashLeaf, buildTree, getProof, golden vector |
| `tests/hooks/useBeneficiaryCampaigns.test.ts` | 5 | Hook — campaigns by beneficiary wallet |
| `tests/lib/store.test.ts` | 4 | Zustand store — selectedCampaignId, modal state |
| `tests/hooks/useCampaignDetail.test.ts` | 4 | Hook — single campaign fetch, account parsing |
| `tests/hooks/useVestingProgram.test.ts` | 3 | Hook — program instance, provider connection |

---

## Test Isolation

Integration tests create on-chain accounts that persist between runs. Use `solana-test-validator --reset` for clean local runs.

## Debugging

```bash
RUST_LOG=debug anchor test          # Enable program logging
anchor test -- --grep "T17"         # Run single test
```
