# Testing Guide

## Test Suite Overview

**~680+ tests total** — green on local CI reproduction (May 2026).

- On-chain (Anchor): **118 passing**, 2 pending across 10+ files (`pnpm test:localnet`)
- Web (Vitest): **553 passing**, 13 skipped (devnet integration; Postgres required)
- Trident fuzz: smoke test in CI (`trident-tests/fuzz_vesting`)

| Test File | Tests | Purpose |
|-----------|-------|---------|
| `tests/vesting.spec.ts` | 2 | Smoke tests (program ID, IDL structure — 18 instructions) |
| `tests/instant-refund-campaign.spec.ts` | 11 | Instant refund eligibility, SPL + native SOL, post-refund claim/release guards |
| `tests/update-root-min-cliff.spec.ts` | 1 | `update_root` persists `min_cliff_time` |
| `tests/vesting-tree-layout.spec.ts` | — | `VestingTree` Borsh layout / legacy parsing |
| `tests/vesting.supplementary.spec.ts` | 62+ | Integration tests covering all instructions (incl. T41 milestone flags, T63–T71 cancel/milestone) |
| `tests/vesting.clock.spec.ts` | 12 | Clock-dependent tests via `solana-bankrun` (incl. T64 `cancel_stream`) |
| `tests/vesting-native-sol.spec.ts` | 12 | Native SOL vesting lifecycle tests (create, withdraw, claim, cancel, fund, withdraw_unvested + error guards) |
| `tests/security.spec.ts` | 11 | Security exploit tests (EXPLOIT 1–11) |
| `tests/golden_vector.spec.ts` | 1 | Cross-language hash verification |

## Running Tests

### Full Suite (localnet — recommended)

Use a **persistent** `solana-test-validator`. `anchor test` alone can flake on Solana CLI 3.x (`Blockhash not found` mid-suite).

```bash
pnpm test:localnet
# Starts validator if needed, upgrades program to G6iaig…, then 118 passing (~4m)
# Use CARGO_TARGET_DIR=$PWD/target anchor build before first run if BPF artifact is stale
```

CI: [`ci.yml`](../.github/workflows/ci.yml) runs `anchor build`, IDL drift check, native SOL tests (bankrun), then `pnpm test:localnet` with `TEST_SKIP_BUILD=1`. [`web-ci.yml`](../.github/workflows/web-ci.yml) runs merkle parity, E2E pipeline, and Vitest with Postgres 15.

Legacy one-shot (may flake):

```bash
anchor test
```

### Clock-Dependent Tests (bankrun)

```bash
pnpm exec ts-mocha -p ./tsconfig.json -t 1000000 tests/vesting.clock.spec.ts
# Expected: 11/11 PASS (~600ms)
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
| EXPLOIT 11 | withdraw → close → withdraw (double payout) | Various |

### Native SOL Tests (bankrun)

```bash
pnpm exec ts-mocha -p ./tsconfig.json -t 1000000 tests/vesting-native-sol.spec.ts
# Expected: 12/12 PASS
```

Uses `solana-bankrun` for deterministic testing. No external validator needed. Tests the full native SOL lifecycle: create stream/campaign → withdraw/claim → cancel → withdraw_unvested, plus error guards (over-claim, early claim, unauthorized cancel, over-funding).

| Test | What it verifies |
|------|-----------------|
| create_stream with native SOL | Stream creation + SOL deposit + state validation |
| withdraw partial vested SOL | Partial withdrawal, PDA lamports decrease |
| withdraw final vested SOL drains PDA | Full claim drains PDA including rent |
| cancel native SOL stream splits lamports | Vested → beneficiary, unvested → creator |
| create_campaign with native SOL | Multi-recipient campaign with Merkle root |
| fund_campaign with native SOL | Additional SOL funding via system CPI |
| claim from native SOL campaign | Merkle proof + native SOL claim |
| withdraw_unvested from cancelled native SOL campaign | Post-grace drain to creator |
| over-claim on native SOL fails | `InsufficientVault` guard |
| claim before cliff returns NothingToClaim | Schedule enforcement |
| cancel by non-creator fails | `Unauthorized` authority guard |
| fund beyond total_supply fails | `OverFunded` guard |

### Devnet

Program must be deployed at `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`. Wallet needs devnet SOL (`solana airdrop 2 --url devnet`).

```bash
pnpm test:devnet
# RPC tests on devnet; clock suite still uses bankrun (12 tests, no RPC clock warp)
# 86 passing, 1 pending (T64 cancel_stream on public devnet RPC)
```

Equivalent:

```bash
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
  anchor test --skip-local-validator --skip-build
```

Tests that call `setClock` on the public RPC skip on devnet (see `skipIfClockNotAdvanced` in supplementary specs). Bankrun clock tests always run locally inside `vesting.clock.spec.ts`.

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

## Web Tests (Vitest)

API route tests (`tests/api/*`) use a **real Postgres** database. CI provides Postgres via service containers in `web-ci.yml` and `lint.yml`. Hooks, merkle, and math tests do not need a database.

### DB-free unit subset

Use this when you only need deterministic parser/math/adapter coverage and do not want Vitest to touch Postgres:

```bash
cd apps/web
pnpm test:unit
```

`test:unit` uses `vitest.unit.config.ts`, has no global DB setup, and excludes DB/indexer tests. This is the fastest local sanity check for CSV parsing, Merkle math, vesting schedule math, and Anchor adapter utilities.

### Local setup (Postgres required for full suite)

```bash
docker run -d --name vesting-pg \
  -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=ci \
  -p 5432:5432 postgres:15

export DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/ci
cd apps/web && pnpm db:migrate && pnpm test
```

```bash
cd apps/web
pnpm test              # full suite (requires DATABASE_URL)
pnpm test:db           # explicit alias for the DB-backed suite
pnpm test -- --reporter=verbose  # detailed output
```

`tests/globalSetup.ts` refuses to run against hosted databases (Supabase, Neon, poolers) unless `ALLOW_REMOTE_DB_TEST_WRITES=true` is set. This prevents API tests from writing dummy campaign rows to production-like databases. Use local Postgres for normal development. `tests/globalSetup.ts` runs `drizzle-kit push` locally when `DATABASE_URL` is set (skipped when `CI=true` — workflows apply migrations explicitly via `pnpm db:migrate`). Each API test file calls `resetDb()` in `beforeEach` to truncate tables.

**Test helpers:** `tests/helpers/db.ts` (`resetDb`), `tests/helpers/fixtures.ts` (`createCampaignViaPost`, `seedClaimEvent`), `tests/helpers/requests.ts` (shared campaign payloads).

| Test File | Tests | Purpose |
|-----------|-------|---------|
| `tests/api/backend.test.ts` | ~69 | API routes — campaigns, claims, proofs, beneficiary, admin sync (real DB) |
| `tests/math/vesting.test.ts` | 23 | Vesting math — linear, cliff, milestone, cancel clamp, edge cases |
| `tests/api/bug-fix-validation.test.ts` | ~14 | Bug-fix regressions — validation, indexer cursor, real DB transactions |
| `tests/lib/db-ssl.test.ts` | 3 | DB SSL host detection (local vs Supabase) |
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
| `tests/datetime.test.ts` | 1 | Date/time formatting utilities |
| `tests/stream-persist.test.ts` | 1 | Stream state persistence |
| `tests/vesting-errors.test.ts` | 5 | Error formatting and mapping |
| `tests/api/bulk-campaign.test.ts` | 16 | F1 prepare + import — Merkle tree build, CSV import |
| `tests/api/clawback.test.ts` | 28 | F3 cancel/withdraw/cancel-stream/milestone/grace-period |
| `tests/api/simulate-vesting.test.ts` | 21 | F4 linear/cliff/milestone simulation + schedule templates |
| `tests/api/timeline.test.ts` | 8 | F2 event timeline (cancel, pause, withdraw, milestone, root-update, stream-cancel) |
| `tests/api/vesting-progress.test.ts` | 6 | F2 vesting progress for beneficiary |
| `tests/api/cron-sync.test.ts` | 5 | F2 cron sync — auth guard, event processing |
| `tests/api/versioning.test.ts` | 5 | F4 X-API-Version header on all responses |
| `tests/indexer/event-indexer.test.ts` | 21 | F2 event parser — 11 discriminator types across 6 event tables |
| `tests/lib/vesting-schedule.test.ts` | 19 | F1 schedule math parity — TS matches Rust exactly |

## Merkle Parity Test

```bash
pnpm tsx scripts/test-merkle-parity.ts
# Expected: 13/13 checks pass (roots, proofs, cross-verification)
```

Validates that `clients/ts/src/merkle.ts` and `apps/web/src/lib/merkle/builder.ts` produce byte-identical roots and proofs for Cliff, Linear, and Milestone release types.

## E2E Merkle Pipeline Test

```bash
# Start dev server first:
cd apps/web && pnpm dev

# In another terminal:
pnpm tsx scripts/test-be-merkle-pipeline.ts
# Expected: ALL PASS (prepare, POST 201, GET campaigns, GET proofs 3/3, verifyProof 3/3)

# Against deployed URL:
pnpm tsx scripts/test-be-merkle-pipeline.ts --url https://your-app.vercel.app --timeout 120000
```

Validates the full BE-SC pipeline: `prepareCampaign` → POST campaign → GET proof per beneficiary → verify proof against root. Tests 3 release types (Cliff, Linear, Milestone).

## Browser E2E Smoke Tests

```bash
cd apps/web
pnpm test:e2e:install   # first run only: downloads Chromium
pnpm test:e2e:deps      # first run only: installs OS libs, may need sudo
pnpm test:e2e
```

`pnpm test:e2e` starts Next.js on `127.0.0.1:3100` and runs the Playwright smoke tests in `tests/e2e/`.

If Chromium exits with `error while loading shared libraries: libnspr4.so`, install the Playwright OS dependencies:

```bash
cd apps/web
pnpm test:e2e:deps
```

On locked-down machines this may fail with `sudo: a password is required`; install `libnspr4`/Playwright Chromium dependencies at the OS level, then rerun `pnpm test:e2e`.

CI runs this in `.github/workflows/web-ci.yml` using a Postgres service container.

## CI workflows (web + API)

| Job | Workflow | Postgres? | Notes |
|-----|----------|-----------|-------|
| `merkle-parity` | `web-ci.yml` | No | `scripts/test-merkle-parity.ts` (13 checks) |
| `e2e-pipeline` | `web-ci.yml` | Yes | `drizzle-kit push` → dev server → `test-be-merkle-pipeline.ts` |
| `web-build-test` | `web-ci.yml` | Yes | `drizzle-kit push` → Vitest → `next build` |
| `lint` | `lint.yml` | Yes | clippy + lint + Vitest + build (same DB URL) |

---

## Test Isolation

Integration tests create on-chain accounts that persist between runs. Use `solana-test-validator --reset` for clean local runs.

## Debugging

```bash
RUST_LOG=debug anchor test          # Enable program logging
anchor test -- --grep "T17"         # Run single test
```
