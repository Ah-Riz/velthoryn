# Testing Guide

## Test Suite Overview

**~705+ tests total** — green on local CI reproduction (June 2026).

- On-chain (Anchor): **127+ passing** across 15 files (`pnpm test:localnet`)
- Web (Vitest): **563 passing** (`vitest.unit.config.ts`; Postgres required for API tests)
- Trident fuzz: smoke test in CI (`trident-tests/fuzz_vesting`)
- Rust unit tests: **31** (math/merkle + math/schedule proptests + inline)
- Mollusk instruction tests: **73 active** across 8 test files (18 ignored — Mollusk limitations)
- Mollusk CU benchmarks: **10 active** benchmark functions (17 scenarios) in `programs/vesting/tests/benchmarks.rs`; `bench_claim_native` ignored (Mollusk 0.13 `init_if_needed` blocker)

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
| `tests/sealevel-attacks-gap.spec.ts` | 4 | Security gap tests from [coral-xyz/sealevel-attacks](https://github.com/coral-xyz/sealevel-attacks) analysis |
| `tests/vesting-litesvm.spec.ts` | 5 | LiteSVM PoC — boot, mint, time-travel, program loading |
| `programs/vesting/tests/test_helpers.rs` | — | Shared Mollusk helpers — account builders, error constants, Merkle tree, ix data |
| `programs/vesting/tests/instructions.rs` | 14 | Mollusk — create_campaign_native, get_vested_amount, pause/unpause |
| `programs/vesting/tests/stream.rs` | 7 | Mollusk — create_stream_native (happy, cliff, cancellable, zero amount, errors) |
| `programs/vesting/tests/admin.rs` | 18 (+6 ign.) | Mollusk — set_milestone, update_root, fund_campaign_native, cancel_campaign, instant_refund |
| `programs/vesting/tests/cancel.rs` | 5 (+9 ign.) | Mollusk — cancel_campaign, cancel_stream (native SOL) |
| `programs/vesting/tests/claim.rs` | 16 | Mollusk — claim (happy, partial, over-claim, wrong-proof, wrong-beneficiary, cancelled, paused, milestone) |
| `programs/vesting/tests/cleanup.rs` | 2 (+3 ign.) | Mollusk — withdraw_unvested, close_claim_record |
| `programs/vesting/tests/lifecycle.rs` | 8 | Mollusk — multi-instruction lifecycle sequences (create→pause→unpause, create→cancel→withdraw) |
| `programs/vesting/tests/benchmarks.rs` | 9 (+1 ign.) | Mollusk CU benchmarks — all native handlers; see `docs/CU_BUDGET.md` |

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

### Sealevel-Attacks Gap Tests (bankrun)

```bash
ANCHOR_TEST_GLOB='tests/sealevel-attacks-gap.spec.ts' anchor test --skip-build
# Expected: 4/4 PASS (~400ms)
```

Security tests inspired by [coral-xyz/sealevel-attacks](https://github.com/coral-xyz/sealevel-attacks), covering attack categories that are mitigated by Anchor but had no explicit proof:

| Test | Attack Category (sealevel-attacks) | What it proves |
|------|-------------------------------------|----------------|
| SA-1a | #6 Duplicate Mutable Accounts | `cancel_stream` rejects same ATA for beneficiary + creator |
| SA-1b | #6 Duplicate Mutable Accounts | `cancel_stream` rejects swapped ATAs (creator ATA in beneficiary slot) |
| SA-2 | #8 PDA Sharing | Cross-tree VaultAuthority misuse blocked by `has_one` constraint |
| SA-3 | #9 Closing Accounts | Closed `ClaimRecord` cannot be reinitialized (Anchor discriminator guard) |

### LiteSVM Tests

```bash
ANCHOR_TEST_GLOB='tests/vesting-litesvm.spec.ts' anchor test --skip-build
# Expected: 5/5 PASS (~110ms)
```

Proof-of-concept using [LiteSVM](https://github.com/LiteSVM/litesvm) as an alternative to `solana-bankrun`. LiteSVM provides an in-process Solana VM with faster execution, reliable clock time-travel (`setClock`), arbitrary account state injection (`setAccount`), and transaction simulation without committing state. Uses `litesvm@0.8.0` + `anchor-litesvm@0.2.1`.

| Test | What it verifies |
|------|-----------------|
| Boot + airdrop | LiteSVM boots and funds accounts with SOL |
| SPL mint creation | Token mint via raw transaction construction |
| Clock time-travel | `svm.setClock()` warps the Clock sysvar |
| Program .so loading | Loads `vesting.so` and verifies executable account |
| Simulation | Confirms Clock sysvar state after warp |

### proptest — Property-Based Tests (Rust)

```bash
cargo test --manifest-path programs/vesting/Cargo.toml --lib -- proptest
# Expected: 20 passed
```

[proptest](https://crates.io/crates/proptest) generates arbitrary inputs to automatically find edge cases. Tests are in `src/math/schedule.rs` (11 proptests + 5 unit tests) and `src/math/merkle.rs` (7 proptests + 7 unit tests).

| Test | Invariant Verified |
|------|--------------------|
| `vested_never_exceeds_amount` | vested ≤ amount for any (amount, cliff, end, now) |
| `cliff_all_or_nothing` | Cliff returns exactly 0 or full amount |
| `linear_monotonic` | Linear vesting never decreases over time |
| `cancel_clamps_to_cancel_time` | Cancel freezes vesting at cancel timestamp |
| `zero_before_cliff` | All release types return 0 before cliff |
| `linear_midpoint_approx_half` | Midpoint ≈ half with integer rounding tolerance |
| `start_before_cliff_same_as_start_eq_cliff` | start_time < cliff_time doesn't affect vesting |
| `vested_never_exceeds_extreme_amount` | vested ≤ amount even at u64::MAX |
| `vested_bounded_wide_range` | vested bounded for extreme cliff/end ranges |
| `cancel_clamp_never_exceeds_uncancelled` | get_vested_amount with cancel ≤ vested at cancel time |
| `tampered_root_always_fails` | Any bit-flip in root breaks Merkle proof |
| `tampered_proof_always_fails` | Any bit-flip in proof breaks verification |
| `single_leaf_root_equals_hash` | Leaf hash = root for 1-leaf tree |
| `proof_len_for_powers_of_two` | max_proof_len = log₂(n) for powers of 2 |
| `proof_len_bounded` | Never exceeds MAX_MERKLE_PROOF_LEN |
| `verify_non_power_of_two_tree` | Verification works for non-power-of-2 tree sizes |
| `verify_large_tree` | Verification works for trees up to 64 leaves |
| `sibling_tampering_detected` | Flipping sibling bits always fails |

### Mollusk Instruction Tests (Rust)

```bash
# Run all Mollusk tests:
BPF_OUT_DIR=../../target/deploy cargo test --manifest-path programs/vesting/Cargo.toml --test instructions --test stream --test admin --test cancel --test claim --test cleanup --test lifecycle -- --show-output
# Expected: 72 passed, 18 ignored

# Individual suites:
BPF_OUT_DIR=../../target/deploy cargo test --manifest-path programs/vesting/Cargo.toml --test instructions -- --show-output  # 14
BPF_OUT_DIR=../../target/deploy cargo test --manifest-path programs/vesting/Cargo.toml --test stream -- --show-output      # 7
BPF_OUT_DIR=../../target/deploy cargo test --manifest-path programs/vesting/Cargo.toml --test admin -- --show-output       # 18 active + 6 ignored
BPF_OUT_DIR=../../target/deploy cargo test --manifest-path programs/vesting/Cargo.toml --test cancel -- --show-output      # 5 active + 9 ignored
BPF_OUT_DIR=../../target/deploy cargo test --manifest-path programs/vesting/Cargo.toml --test claim -- --show-output       # 16
BPF_OUT_DIR=../../target/deploy cargo test --manifest-path programs/vesting/Cargo.toml --test cleanup -- --show-output     # 2 active + 3 ignored
BPF_OUT_DIR=../../target/deploy cargo test --manifest-path programs/vesting/Cargo.toml --test lifecycle -- --show-output   # 8
```

Instruction-level tests using [Mollusk](https://github.com/anza-xyz/mollusk) to execute Anchor instructions directly against the SVM — no validator, no network. Tests are organized by instruction domain across 8 test files with shared helpers in `test_helpers.rs` (938 lines). Covers 14/18 instruction handlers (78%); remaining 4 use `init_if_needed` or optional SPL accounts that Mollusk 0.13 cannot resolve.

| Test File | Active | Ignored | Instructions Covered |
|-----------|--------|---------|---------------------|
| `instructions.rs` | 14 | 0 | create_campaign_native, get_vested_amount, pause/unpause |
| `stream.rs` | 7 | 0 | create_stream_native |
| `admin.rs` | 18 | 6 | set_milestone_released, update_root, fund_campaign_native, cancel_campaign, instant_refund |
| `cancel.rs` | 5 | 9 | cancel_campaign, cancel_stream |
| `claim.rs` | 16 | 0 | claim (SPL + native SOL) |
| `cleanup.rs` | 2 | 3 | withdraw_unvested, close_claim_record |
| `lifecycle.rs` | 8 | 0 | Multi-instruction state transitions |
| `withdraw_unvested.rs` | 3 | 0 | native-SOL `withdraw_unvested` drain-to-rent (SC-FIND-02 audit) |

### Mollusk CU Benchmarks (Rust)

```bash
BPF_OUT_DIR=../../target/deploy cargo test --manifest-path programs/vesting/Cargo.toml --test benchmarks -- --show-output
# Expected: 2 passed (9 benchmark scenarios total)
```

[Mollusk](https://github.com/anza-xyz/mollusk) is a lightweight SVM test harness from Anza. It loads the compiled `.so` binary directly and executes instructions without AccountsDB/Bank overhead — the fastest possible unit test for Solana programs. Reports compute units consumed per instruction.

| Benchmark | Compute Units |
|-----------|---------------|
| `get_vested_amount` — 7 release-type scenarios | 615–916 |
| `create_campaign_native` — 2 leaf counts | 9,372–9,378 |

```bash
# Full Rust test suite (unit + proptest + Mollusk):
BPF_OUT_DIR=../../target/deploy cargo test --manifest-path programs/vesting/Cargo.toml -- --show-output
# Expected: 103 passed, 18 ignored
```

**Sealevel-attacks applicability:** 8 of 11 attack categories from `coral-xyz/sealevel-attacks` are already mitigated by Anchor's built-in safety features (Signer type, Account discriminator, init constraint, Program type, seeds+bump, Sysvar type, owner checks, type safety). The remaining 3 (#6 duplicate accounts, #8 PDA sharing, #9 closing accounts) are now explicitly proven safe by the gap tests above.

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

### Testing Frameworks

| Framework | Language | Use case | Speed |
|-----------|----------|----------|-------|
| `solana-test-validator` + `anchor test` | TypeScript | Full integration tests, closest to mainnet | Slowest (~4m full suite) |
| `solana-bankrun` + `anchor-bankrun` | TypeScript | Deterministic clock-dependent tests, embedded validator | Fast (~600ms per file) |
| **LiteSVM** + `anchor-litesvm` | TypeScript | In-process VM, time-travel, arbitrary account states, simulation | Faster (~110ms per file) |
| **Mollusk** | Rust only | CU benchmarking, per-instruction unit tests, no AccountsDB | Fastest |
| **proptest** | Rust only | Property-based testing — generates arbitrary inputs to find edge cases | Instant |

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

### E2E mock wallet and send-tx

For UI flows without a live devnet RPC, Playwright uses:

| localStorage key | Purpose |
|------------------|---------|
| `velthoryn:e2e-wallet` | Enables mock wallet (`NEXT_PUBLIC_E2E_MOCK_WALLET=true` on localhost) |
| `velthoryn:e2e-mock-send-tx` | `sendTransaction` returns a fixed signature; skips `confirmTransaction` (cancel flows) |

Helpers in `tests/e2e/helpers.ts`: `mockCampaignApi`, `mockProofApi`, `waitForCampaignListMocks`. Expanded coverage in `campaign-actions.spec.ts`.

Signing specs under `tests/e2e/signing/` use a real local validator on port 3200 — see file headers for the manual dev-server command.

If Chromium exits with `error while loading shared libraries: libnspr4.so`, install the Playwright OS dependencies:

```bash
cd apps/web
pnpm test:e2e:deps
```

On locked-down machines this may fail with `sudo: a password is required`; install `libnspr4`/Playwright Chromium dependencies at the OS level, then rerun `pnpm test:e2e`.

CI runs this in `.github/workflows/web-ci.yml` using a Postgres service container.

### E2E test suites

| File | Tests | Coverage |
|------|-------|----------|
| `campaign-actions.spec.ts` | 33+ | Pause, cancel, instant refund, withdraw, milestone, clawback UI (grace banners, needs-action tab, sidebar dot), responsive 375px |
| `wrap-sol.spec.ts` | 16 | WrapSolModal: trigger, content, tabs, submit, max, close |
| `campaign-journey.spec.ts` | — | End-to-end campaign creation + funding |
| `signing/*.spec.ts` | — | Real signing with local validator |

### Native SOL / Token-2022 (T22) manual devnet checklist

These flows require a funded devnet wallet and cannot be fully automated in CI. Run manually before release:

| # | Test | Steps | Expected |
|---|------|-------|----------|
| T19 | Token picker shows wSOL | Open create cliff → Select Token | wSOL row appears with balance |
| T20 | Wrap SOL modal | Token picker → "Wrap / Unwrap SOL" | Modal opens, SOL/wSOL balances shown |
| T21 | Wrap SOL transaction | Enter amount → click Wrap | wSOL balance increases, SOL decreases |
| T22 | Create campaign with wSOL | Wrap SOL → select wSOL → create cliff campaign via CSV | Campaign created, funded with wSOL |
| T23 | Token-2022 mint rejection | Use T22-extension mint in CSV | Parse error: "Token-2022 extensions not supported" |
| T24 | Unwrap wSOL | Wrap modal → Unwrap tab → enter amount → Unwrap | SOL balance increases |

**Setup:**
```bash
# Fund devnet wallet
solana airdrop 2 --url devnet

# Start dev server against devnet
cd apps/web
NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com pnpm dev
```

**Automated coverage:** `wrap-sol.spec.ts` covers T19–T20 UI paths with mock wallet. T21–T24 require real transactions.

## k6 load testing

Scripts live in `apps/web/tests/load/`. Run from `apps/web/`:

```bash
./tests/load/run-load-test.sh api          # default — health, campaigns, simulate-vesting
./tests/load/run-load-test.sh prepare
CAMPAIGN_ADDRESS=... BENEFICIARY_ADDRESS=... ./tests/load/run-load-test.sh proof
./tests/load/run-load-test.sh spike
./tests/load/run-load-test.sh all
```

### Baselines (local dev smoke, June 2026)

Measured with `k6 run --vus 2 --iterations 3..5` against `http://localhost:3000`. Full staged runs use the thresholds in each script.

| Script | Endpoint(s) | p95 (smoke) | Error rate | Threshold |
|--------|-------------|-------------|------------|-----------|
| `api-load.js` | GET health, campaigns, templates; POST simulate | <500ms | <1% | p95 <500ms |
| `prepare-load.js` | POST `/api/campaigns/prepare` (10 leaves) | ~77–1434ms | 0% | p95 <2000ms, errors <5% |
| `proof-load.js` | GET `/api/campaigns/:tree/proof?beneficiary=` | ~42–110ms | 0%* | p95 <500ms, errors <1% |
| `spike-load.js` | Mixed health + campaigns + prepare (200 VU peak) | ~1038ms | varies† | p95 <3000ms |

\* Requires Postgres with campaign data; without DB the endpoint returns 500 and thresholds fail.

† Spike error rate dominated by health 503 when DB/RPC down; re-run against staging with full stack for production baselines.

Reports written to `tests/load/last-*-report.json` via each script's `handleSummary`.

### Per-route rate limits (requests / 60s window)

| Route | Limit | Rationale |
|-------|-------|-----------|
| `POST /api/campaigns/prepare` | 10 | CPU-heavy Merkle build; p95 ~1.4s under load |
| `POST /api/campaigns/import` | 5 | Large CSV parse |
| `GET /api/campaigns/:tree/proof` | 60 | Read-only; smoke p95 <110ms |
| `GET /api/campaigns`, `GET /api/campaigns/:tree` | 60 | Public reads |
| `POST /api/simulate-vesting` | 30 | Stateless math |
| Default (via `withRoute`) | 60 | General API |

Configured in per-route `withRoute({ rateLimit: ... })` in `apps/web/src/app/api/**/route.ts`.

## SC benchmarks (Mollusk CU)

```bash
BPF_OUT_DIR=target/deploy cargo test --manifest-path programs/vesting/Cargo.toml --test benchmarks -- --show-output
```

9 active tests pass; `bench_claim_native` is `#[ignore]`. Full CU table: [`docs/CU_BUDGET.md`](CU_BUDGET.md).

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
