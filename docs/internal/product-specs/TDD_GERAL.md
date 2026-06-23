# TDD — Velthoryn Vesting Frontend Test Design (Geral's Scope)

**Author:** Geral — frontend lead  
**Status:** Week 4 design → **Updated Week 9 (2026-06-18)**  
**Companion docs:** `docs/PRD_GERAL.md` (requirements), `docs/PDD_GERAL.md` (design), `docs/SECURITY_GERAL.md` (security)

> **Week 9 reality**: The targets in this doc were written at Week 4. See the "§ Week 9 Actuals" sections below for what actually shipped. The original design sections are preserved for historical context.

---

## §1 Test Strategy Overview

### Test pyramid (Week 4 target)

```
        ┌─────────────┐
        │   E2E (5)   │  Playwright — full user flows (Phase 2)
        ├─────────────┤
        │ Integration │  Anchor tests — SC interaction (Week 4)
        │    (5-8)    │
        ├─────────────┤
        │   Unit      │  Vitest — components, hooks, utilities (Week 4-6)
        │   (201)     │
        └─────────────┘
```

### Test pyramid (Week 9 actuals)

```
        ┌─────────────────────────────┐
        │  E2E chromium (23 specs)    │  Playwright — mock wallet, 23 spec files
        │  E2E signing  (10 specs)    │  Playwright — real devnet wallet, 10 spec files
        ├─────────────────────────────┤
        │  Integration (47 tests)     │  Devnet integration — helpers + ts-mocha
        │  Bankrun (15 files)         │  solana-bankrun clock-dependent tests
        ├─────────────────────────────┤
        │  Unit — Vitest (572 tests)  │  32 spec files, zero failures
        └─────────────────────────────┘
```

### Test ownership split

| Layer | Owner | Framework | Location | When |
|---|---|---|---|---|
| Smart contract unit tests (Rust) | Lana | `cargo test` | `programs/vesting/` | Week 4 |
| Integration tests (TypeScript) | **Geral** | `anchor test` (ts-mocha) | `tests/vesting.spec.ts` | Week 4 |
| Frontend unit tests | **Geral** | Vitest | `apps/web/tests/`, `apps/web/src/**/*.test.ts` | Week 4-6 |
| E2E tests | **Geral** | Playwright | `apps/web/e2e/` | Phase 2 |
| Merkle golden vector gate | **Joint** | Vitest | `apps/web/tests/merkle/builder.test.ts` | ✅ Week 3 (done) |

---

## §2 Integration Tests (Week 4 — Anchor + TypeScript)

### Test infrastructure

**Framework:** ts-mocha (ships with Anchor)  
**Location:** `tests/vesting.spec.ts`  
**Run command:** `anchor test`  
**Environment:** `solana-test-validator` (localnet) for anchor test; `solana-bankrun` for clock-dependent tests (deterministic clock warp)

### Prerequisites

```typescript
// Test setup utilities needed
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vesting } from "../target/types/vesting";
import {
  createMint, mintTo, getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

// Helpers
function derivePda(seeds: Buffer[], programId: PublicKey): [PublicKey, number];
function advanceClock(provider: AnchorProvider, seconds: number): Promise<void>;
function createFundedKeypair(provider: AnchorProvider): Promise<Keypair>;
```

### Test cases

#### T-INT-1: Create stream — happy path

**Maps to:** AC 1 (create_stream works), AC 2 (tokens locked in PDA)

```
Setup:
  - Create SPL mint
  - Mint 1,000,000 tokens to creator ATA
  - Derive VestingTree PDA for (creator, mint, campaignId=1)

Action:
  - Call createCampaign(root, leafCount=1, totalSupply=1_000_000, ...)
  - Call fundCampaign(amount=1_000_000)

Assert:
  - VestingTree account exists with correct merkle_root
  - VestingTree.total_supply == 1_000_000
  - VestingTree.is_funded == true
  - Vault ATA balance == 1_000_000
  - Creator ATA balance == 0 (all deposited)
  - Creator cannot call withdraw on vault directly (no such instruction)
```

#### T-INT-2: Linear unlock at 0%, 50%, 100%

**Maps to:** AC 3 (linear unlock calculation correct)

```
Setup:
  - Campaign created + funded (from T-INT-1 setup)
  - Linear leaf: start_ts = T, end_ts = T + 1000
  - Build Merkle tree with single leaf, get root + proof

Action & Assert:
  At T + 0 (0% elapsed):
    - Call claim → claimable should be 0
    - Assert NothingToClaim error OR 0 tokens transferred

  At T + 500 (50% elapsed):
    - Advance clock to T + 500
    - Call claim → expect ~500,000 tokens transferred (±5%)
    - Check recipient ATA balance

  At T + 1000 (100% elapsed):
    - Advance clock to T + 1000
    - Call claim → remaining ~500,000 tokens transferred
    - Total claimed == 1,000,000
    - Vault balance == 0
```

#### T-INT-3: Withdraw partial — claim some, claim more later

**Maps to:** AC 4 (withdraw works), AC 5 (partial withdrawals)

```
Setup:
  - Campaign with linear vesting: 1,000,000 over 1000 seconds
  - Advance clock to 25% elapsed

Action:
  - First claim: expect ~250,000 tokens
  - Advance clock to 75% elapsed
  - Second claim: expect ~500,000 more tokens (750,000 total - 250,000 already claimed)

Assert:
  - ClaimRecord.claimed_amount == ~750,000 after second claim
  - Recipient ATA balance matches total claimed
  - Vault balance == ~250,000 remaining
```

#### T-INT-4: Withdraw more than unlocked — expect error

**Maps to:** AC 6 (cannot withdraw more than unlocked)

```
Setup:
  - Campaign with linear vesting, advance clock to 25% elapsed

Action:
  - Claim with correct proof (should succeed for ~25%)
  - Try to claim again immediately (nothing new has vested)

Assert:
  - Second claim returns VestingError::NothingToClaim (error code 6003)
  - No tokens transferred on second attempt
  - ClaimRecord unchanged
```

#### T-INT-5: Withdraw unauthorized — wrong signer

**Maps to:** AC 7 (cannot withdraw from someone else's stream)

```
Setup:
  - Campaign with leaf for beneficiary Alice
  - Attacker = different keypair (Bob)

Action:
  - Bob tries to call claim with Alice's leaf + proof, signing as Bob

Assert:
  - Transaction fails with constraint violation or VestingError::Unauthorized
  - No tokens transferred to Bob
  - Alice's ClaimRecord unchanged
```

### Integration test summary table

| ID | Test Case | AC | Priority | Status |
|---|---|---|---|---|
| T-INT-1 | Create stream happy path | AC 1, 2 | P0 | ⏳ Week 4 |
| T-INT-2 | Linear unlock 0%/50%/100% | AC 3 | P0 | ⏳ Week 4 |
| T-INT-3 | Withdraw partial (two claims) | AC 4, 5 | P0 | ⏳ Week 4 |
| T-INT-4 | Withdraw > unlocked → error | AC 6 | P0 | ⏳ Week 4 |
| T-INT-5 | Withdraw unauthorized → error | AC 7 | P0 | ⏳ Week 4 |

---

## §3 Frontend Unit Tests (Vitest)

### Test infrastructure

**Framework:** Vitest 3.0  
**Location:** `apps/web/tests/` and `apps/web/src/**/*.test.ts`  
**Run command:** `cd apps/web && pnpm test`  
**Config:** `apps/web/vitest.config.ts`

```typescript
// vitest.config.ts — current
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
```

### Existing tests (Week 3)

| File | Tests | Status |
|---|---|---|
| `tests/merkle/builder.test.ts` | 5 tests (hashLeaf 32 bytes, deterministic, buildTree root, proof round-trip, golden vector gate) | ✅ All passing |

### Planned unit tests

#### Group 1: Merkle utilities (existing + expand)

| ID | Test | File | Priority |
|---|---|---|---|
| U-MRK-1 | hashLeaf returns 32 bytes | `tests/merkle/builder.test.ts` | ✅ Done |
| U-MRK-2 | hashLeaf is deterministic | `tests/merkle/builder.test.ts` | ✅ Done |
| U-MRK-3 | buildTree produces valid root | `tests/merkle/builder.test.ts` | ✅ Done |
| U-MRK-4 | getProof round-trip verification | `tests/merkle/builder.test.ts` | ✅ Done |
| U-MRK-5 | Golden vector gate (Rust byte-equal) | `tests/merkle/builder.test.ts` | ✅ Done |
| U-MRK-6 | encodeLeaf produces 70 bytes | `tests/merkle/builder.test.ts` | P0 |
| U-MRK-7 | Multi-leaf tree proof verification | `tests/merkle/builder.test.ts` | P0 |
| U-MRK-8 | Proof for non-existent leaf returns empty | `tests/merkle/builder.test.ts` | P1 |

#### Group 2: Vesting math

| ID | Test | File | Priority |
|---|---|---|---|
| U-MATH-1 | Linear vesting: 0% at start | `tests/math/vesting.test.ts` | P0 |
| U-MATH-2 | Linear vesting: 50% at midpoint | `tests/math/vesting.test.ts` | P0 |
| U-MATH-3 | Linear vesting: 100% at end | `tests/math/vesting.test.ts` | P0 |
| U-MATH-4 | Linear vesting: 100% past end (clamped) | `tests/math/vesting.test.ts` | P0 |
| U-MATH-5 | Cliff vesting: 0 before cliff | `tests/math/vesting.test.ts` | P1 |
| U-MATH-6 | Cliff vesting: full after cliff | `tests/math/vesting.test.ts` | P1 |
| U-MATH-7 | Claimable = vested - claimed (no negative) | `tests/math/vesting.test.ts` | P0 |
| U-MATH-8 | Large amounts (u64 max) no overflow | `tests/math/vesting.test.ts` | P1 |

#### Group 3: PDA derivation

| ID | Test | File | Priority |
|---|---|---|---|
| U-PDA-1 | deriveVestingTree deterministic | `tests/anchor/pda.test.ts` | P0 |
| U-PDA-2 | deriveVaultAuthority deterministic | `tests/anchor/pda.test.ts` | P0 |
| U-PDA-3 | deriveClaimRecord deterministic | `tests/anchor/pda.test.ts` | P0 |
| U-PDA-4 | PDA seeds match Rust (cross-validate) | `tests/anchor/pda.test.ts` | P0 |

#### Group 4: CSV parsing (Week 6)

| ID | Test | File | Priority |
|---|---|---|---|
| U-CSV-1 | Valid CSV parses correctly | `tests/csv/parser.test.ts` | P1 |
| U-CSV-2 | Invalid wallet address rejected | `tests/csv/parser.test.ts` | P1 |
| U-CSV-3 | Negative amount rejected | `tests/csv/parser.test.ts` | P1 |
| U-CSV-4 | Duplicate wallet detected | `tests/csv/parser.test.ts` | P1 |
| U-CSV-5 | Empty CSV returns error | `tests/csv/parser.test.ts` | P2 |

#### Group 5: Error mapping

| ID | Test | File | Priority |
|---|---|---|---|
| U-ERR-1 | All 30 error codes have human-readable mapping | `tests/errors/mapping.test.ts` | P1 |
| U-ERR-2 | Unknown error code shows fallback message | `tests/errors/mapping.test.ts` | P1 |

### Unit test summary (Week 4 targets — original)

| Group | Tests | Done | Week 4 | Week 6 |
|---|---|---|---|---|
| Merkle utilities | 8 | 5 | 3 | — |
| Vesting math | 8 | 0 | 4 | 4 |
| PDA derivation | 4 | 0 | 4 | — |
| CSV parsing | 5 | 0 | — | 5 |
| Error mapping | 2 | 0 | — | 2 |
| **Total** | **27** | **5** | **11** | **11** |

### Unit test actuals (Week 9)

| Area | Test files | Tests | Status |
|---|---|---|---|
| Merkle builder | `tests/lib/merkle-builder.test.ts` | 12 | ✅ All pass |
| Vesting math / schedule | `tests/lib/schedule.test.ts` | 38 | ✅ All pass |
| Error mapping | `tests/lib/errors.test.ts` | 24 | ✅ All pass |
| CSV bulk parsing | `tests/lib/bulk-campaign.test.ts` | 39 | ✅ All pass |
| Vesting list helpers | `tests/lib/vesting-list.test.ts` | 18 | ✅ All pass |
| API routes (Postgres) | `tests/api/*.test.ts` (8 files) | 180 | ✅ All pass |
| Component tests | `tests/components/*.test.ts` | 61 | ✅ All pass |
| Hook tests | `tests/hooks/*.test.ts` | 38 | ✅ All pass |
| Other lib utils | (10+ files) | 162 | ✅ All pass |
| **Total** | **32 files** | **572** | ✅ **572/572** |

**Run command**: `cd apps/web && npx vitest --config vitest.unit.config.ts --run`

---

## §4 E2E Tests (Week 9 — Implemented)

### Test infrastructure (current)

**Framework:** Playwright  
**Location:** `apps/web/tests/e2e/` (23 chromium) + `apps/web/tests/e2e/signing/` (10 real-wallet)  
**Config:** `playwright.config.ts` (chromium mock) + `playwright.signing.config.ts` (signing)  
**Mock wallet:** `NEXT_PUBLIC_E2E_MOCK_WALLET=true` + `localStorage.setItem('velthoryn:e2e-mock-send-tx', '1')`  
**Run command:** `cd apps/web && npx playwright test` (chromium) | `npx playwright test --config playwright.signing.config.ts` (signing)

### Implemented E2E specs (chromium — mock wallet)

| Spec | Tests | Area |
|---|---|---|
| `landing.spec.ts` | 3 | Public landing page |
| `navigation.spec.ts` | 4 | Sidebar routing |
| `wallet-connection.spec.ts` | 3 | Connect/disconnect modal |
| `campaign-detail.spec.ts` | 6 | Campaign detail rendering |
| `campaign-actions.spec.ts` | 8 | Pause, cancel, claim (mock tx) |
| `create-pages.spec.ts` | 4 | Create flow pages render |
| `vesting-create-flows.spec.ts` | 6 | Full cliff/linear/milestone create |
| `csv-template-create.spec.ts` | 3 | CSV download + upload |
| `csv-validation.spec.ts` | 5 | CSV row-level errors |
| `my-campaigns.spec.ts` | 4 | Campaign list tabs |
| `dashboard.spec.ts` | 5 | Dashboard + needs-action |
| `token-picker.spec.ts` | 4 | TokenPickerModal |
| `wrap-sol.spec.ts` | 3 | WrapSolModal |
| `allocations.spec.ts` | 3 | AllocationEditor lock states |
| `responsive.spec.ts` | 4 | Mobile (375px) layout |
| (8 other specs) | ~28 | Various flows |
| **Total chromium** | **~93** | **23 spec files** |

### Signing specs (real devnet wallet — CI disabled)

10 spec files in `tests/e2e/signing/` covering create/fund/claim/pause/cancel/withdraw on actual devnet. Skipped in CI to avoid RPC costs.

### See also

`docs/week9/FE_E2E_GUIDE.md` — full E2E quick start and guide.

---

### Original §4 planned tests (Week 4 — for reference)

| ID | Flow | Priority | Status |
|---|---|---|---|
| E2E-1 | Wallet connect | P1 | ✅ `wallet-connection.spec.ts` |
| E2E-2 | Create campaign | P1 | ✅ `vesting-create-flows.spec.ts` |
| E2E-3 | Claim tokens | P1 | ✅ `campaign-actions.spec.ts` |
| E2E-4 | Cancel campaign | P2 | ✅ `campaign-actions.spec.ts` |
| E2E-5 | Mobile responsive | P2 | ✅ `responsive.spec.ts` |

---

## §5 Test Matrix

Cross-reference: feature × test type × priority.

| Feature | Unit (Vitest) | Integration (Anchor) | E2E (Playwright) |
|---|---|---|---|
| **Merkle tree building** | U-MRK-1 to 8 ✅ | — | — |
| **Vesting math** | U-MATH-1 to 8 | T-INT-2 (unlock checks) | — |
| **PDA derivation** | U-PDA-1 to 4 | T-INT-1 (PDA exists) | — |
| **Create campaign** | — | T-INT-1 | E2E-2 |
| **Claim tokens** | — | T-INT-2, 3, 4 | E2E-3 |
| **Authorization** | — | T-INT-5 | — |
| **CSV parsing** | U-CSV-1 to 5 | — | E2E-2 |
| **Error handling** | U-ERR-1, 2 | T-INT-4, 5 | — |
| **Wallet connect** | — | — | E2E-1 |
| **Responsive layout** | — | — | E2E-5 |

---

## §6 Coverage Targets

### Week 4 targets (original)

| Metric | Target |
|---|---|
| Integration tests passing | 5/5 |
| Frontend unit tests passing | 16/16 (existing 5 + new 11) |
| Acceptance criteria covered by tests | AC 1-7 (all 7 via integration tests) |

### Week 6 targets (original)

| Metric | Target |
|---|---|
| Frontend unit tests total | 27+ |
| Line coverage (Vitest) | ≥ 70% on `src/lib/` and `src/hooks/` |
| All FACs testable | FAC1-FAC10 (manual or automated) |

### Week 9 actuals

| Metric | Target | Actual | Status |
|---|---|---|---|
| Vitest unit tests | 27+ | **572 / 572** | ✅ |
| Line coverage `src/lib/` | ≥ 70% | **81%** (Week 7 measurement) | ✅ |
| E2E chromium specs | 5 | **23 spec files** | ✅ |
| E2E signing specs | 0 (deferred) | **10 spec files** | ✅ bonus |
| Devnet integration tests | 5-8 | **47** | ✅ |
| Error codes tested | all | 18 of 42 via integration | 🔧 partial |
| CI pipeline coverage | Unit + Integration | Unit + Lint + Build + E2E | ✅ |

---

## §7 Test Utilities

### Shared helpers needed

```typescript
// tests/utils/setup.ts
export async function createTestMint(provider: AnchorProvider): Promise<PublicKey>;
export async function mintTokens(mint: PublicKey, to: PublicKey, amount: number): Promise<void>;
export async function createFundedKeypair(provider: AnchorProvider): Promise<Keypair>;
export async function getTokenBalance(ata: PublicKey): Promise<number>;

// tests/utils/time.ts
export async function advanceClock(provider: AnchorProvider, seconds: number): Promise<void>;
export function nowTs(): number;

// tests/utils/merkle.ts
export function buildTestTree(leaves: VestingLeaf[]): { tree: MerkleTree; root: Buffer; proofs: Buffer[][] };
export function createLinearLeaf(overrides?: Partial<VestingLeaf>): VestingLeaf;
export function createCliffLeaf(overrides?: Partial<VestingLeaf>): VestingLeaf;
```

### Test data fixtures

```typescript
// tests/fixtures/leaves.ts
export const LINEAR_LEAF: VestingLeaf = {
  leafIndex: 0,
  beneficiary: "11111111111111111111111111111111",
  amount: 1_000_000n,
  releaseType: 1,
  startTs: 1_700_000_000n,
  cliffTs: 0n,
  endTs: 1_700_001_000n, // 1000 seconds duration
  milestoneIdx: 0,
};

export const CLIFF_LEAF: VestingLeaf = {
  leafIndex: 1,
  beneficiary: "22222222222222222222222222222222",
  amount: 500_000n,
  releaseType: 0,
  startTs: 1_700_000_000n,
  cliffTs: 1_700_000_500n,
  endTs: 1_700_001_000n,
  milestoneIdx: 0,
};
```

---

## §8 CI Integration

### Week 9 CI pipelines (actual — 3 workflows)

| Workflow | File | What it runs |
|---|---|---|
| SC + Integration | `.github/workflows/ci.yml` | `anchor build`, `anchor test`, Vitest unit |
| Lint | `.github/workflows/lint.yml` | Biome lint, TypeScript `--noEmit` |
| Web Build + E2E | `.github/workflows/web-ci.yml` | Next.js build, Playwright chromium |

Signing E2E (`playwright.signing.config.ts`) is **disabled in CI** — requires funded devnet wallet.

### Original planned additions (Week 4 reference)

```yaml
# Add to ci.yml or new frontend-test.yml
jobs:
  frontend-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install
      - run: cd apps/web && pnpm test
        name: Frontend unit tests (Vitest)
```

**Status**: ✅ Implemented (via `web-ci.yml`)

---

## §9 Test Execution Order

### Week 4 execution plan

```
Day 1: Read SC code, understand instruction signatures
Day 2: Write integration tests T-INT-1 through T-INT-5
        Write unit tests U-MATH-1 to 4, U-PDA-1 to 4
Day 3: Run all tests, debug failures
        Write remaining unit tests U-MRK-6, 7, 8
        Include test results in PR description
```

### Run order

```bash
# 1. Smart contract tests (Lana's + Geral's integration tests)
anchor test

# 2. Frontend unit tests
cd apps/web && pnpm test

# 3. Both green → ready for PR
```
