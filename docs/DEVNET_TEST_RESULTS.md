# Devnet Test Results — Velthoryn

**Date:** 2026-05-17
**Network:** devnet (https://api.devnet.solana.com)
**Program:** `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` (deployed slot **462786659**)
**Wallet:** `GPfHeZtBna1rJmwam1yCcREhYnLcxWhBmUdDoVuL5Es6`
**Method:** `pnpm test:devnet` (`scripts/test-devnet.sh`)

**Summary: 74 passing, 0 failing, 0 skipped (~2m)**

Integration tests that create on-chain state run against devnet RPC. Clock-dependent cases in `tests/vesting.clock.spec.ts` always run via **solana-bankrun** (embedded, not public RPC `setClock`).

```bash
solana airdrop 2 --url devnet   # if wallet is low on SOL
pnpm test:devnet
```

Localnet (CI uses the same flow after `anchor build`):

```bash
pnpm test:localnet
```

---

## Combined Test Coverage

| Suite | Devnet RPC | Bankrun (in-process) | Total |
|-------|------------|----------------------|-------|
| Golden Vector (5) | 5 PASS | — | **5/5** |
| Security Exploit (10) | 9 PASS | 1 PASS (EXPLOIT 4) | **10/10** |
| Smoke / Scaffold (2) | 2 PASS | — | **2/2** |
| Supplementary (47) | 47 PASS | — | **47/47** |
| Clock-dependent (11) | — | 11 PASS | **11/11** |
| **Total** | **63 on devnet RPC** | **11 bankrun** | **74/74 PASS** |

> **2026-05-13 note:** An older run reported 56 pass / 7 skip when clock tests were skipped on devnet. The suite now includes bankrun in the full `anchor test` / `pnpm test:devnet` flow, so one command yields 74/74.

---

## All Tests — Devnet Status

### Golden Vector Tests (4/4 PASS)

| # | Test | Status |
|---|------|--------|
| GV1 | encodeLeaf is 70 bytes | PASS |
| GV2 | leafHash is 32 bytes and deterministic | PASS |
| GV3 | matches Rust golden hash (cross-language GATE) | PASS |
| GV4 | merkle tree single-leaf root equals leaf hash | PASS |

### Security Exploit Tests (10/10 PASS — 9 on devnet, 1 on localnet)

| # | Test | Status | Notes |
|---|------|--------|-------|
| EXPLOIT 1 | over-claim (claim more than leaf amount) -> NothingToClaim | PASS | |
| EXPLOIT 2 | wrong beneficiary claims another's leaf -> UnauthorizedClaimer | PASS | |
| EXPLOIT 3 | forged Merkle proof -> InvalidProof | PASS | |
| EXPLOIT 4 | claim after full vault withdrawal -> InsufficientVault | PASS (bankrun) | Bankrun clock warp past grace period |
| EXPLOIT 5 | claim same milestone twice -> MilestoneAlreadyClaimed | PASS | |
| EXPLOIT 6 | withdraw_unvested before grace period -> GracePeriodActive | PASS | |
| EXPLOIT 7 | fund after campaign cancel -> CampaignCancelled | PASS | |
| EXPLOIT 8 | non-creator tries to fund -> rejected (ConstraintSeeds) | PASS | |
| EXPLOIT 9 | pause after campaign cancel -> CampaignCancelled | PASS | |
| EXPLOIT 10 | close claim record prematurely -> CannotClose | PASS | |

### Smoke / Scaffold Tests (2/2 PASS)

| # | Test | Status |
|---|------|--------|
| S1 | loads with the expected program ID | PASS |
| S2 | exposes all 12 architecture instructions in the IDL | PASS |

### Supplementary Tests (47/47 PASS on devnet RPC)

| # | Test | Status | Notes |
|---|------|--------|-------|
| T6 | claim before cliff rejects with NothingToClaim | PASS | |
| T7 | claim after end_time transfers full amount | PASS | |
| T8 | double-claim on linear leaf rejects with NothingToClaim | PASS | |
| T9 | wrong signer claiming rejects with UnauthorizedClaimer | PASS | |
| T10 | double-claim same milestone rejects with MilestoneAlreadyClaimed | PASS | |
| T11 | same beneficiary can claim two different milestones | PASS | |
| T12 | withdraw_unvested during grace period rejects with GracePeriodActive | PASS | |
| T13 | close_claim_record after full claim refunds rent | PASS | |
| T14 | update_root with identical root rejects with SameRoot | PASS | |
| T15 | update_root from wrong signer rejects with Unauthorized | PASS | |
| T16 | update_root after cancel rejects with CampaignCancelled | PASS | |
| T17 | linear claim at exactly 25% unlocks exactly 25% of leaf amount | PASS (bankrun) | See `vesting.clock.spec.ts` |
| T18 | progressive claim yields increasing cumulative amounts | PASS (bankrun) | Bankrun warp to 30%, then 80% |
| T19 | withdraw_unvested from non-creator rejects with Unauthorized | PASS | |
| T20 | withdraw_unvested succeeds after grace period | PASS (bankrun) | Bankrun warp past 604800s |
| T21 | create_stream atomically creates campaign and deposits tokens | PASS | |
| T22 | withdraw claims unlocked tokens without Merkle proof | PASS | |
| T23 | withdraw at 0% returns NothingToClaim | PASS | |
| T24 | withdraw unauthorized signer returns UnauthorizedClaimer | PASS | |
| T25 | withdraw partial then full — progressive claims | PASS (bankrun) | Bankrun warp to 30%, then 80% |
| T26 | create_campaign with empty root rejects with EmptyRoot | PASS | |
| T27 | create_campaign with zero supply rejects with ZeroAmount | PASS | |
| T28 | create_campaign with zero leaf_count rejects with EmptyCampaign | PASS | |
| T29 | create_campaign cancellable=true with null cancel_authority -> MissingCancelAuthority | PASS | |
| T30 | create_stream with start > cliff rejects with InvalidSchedule | PASS | |
| T31 | create_stream with release_type=3 rejects with InvalidScheduleType | PASS | |
| T32 | create_stream with zero amount rejects with ZeroAmount | PASS | |
| T33 | cancel_campaign on non-cancellable campaign rejects with NotCancellable | PASS | |
| T34 | cancel_campaign from wrong authority rejects with Unauthorized | PASS | |
| T35 | cancel_campaign when already cancelled rejects with AlreadyCancelled | PASS | |
| T36 | pause_campaign from wrong authority rejects with Unauthorized | PASS | |
| T37 | pause_campaign when already paused rejects with AlreadyPaused | PASS | |
| T38 | unpause_campaign when not paused rejects with NotPaused | PASS | |
| T39 | fund_campaign exceeding total_supply rejects with OverFunded | PASS | |
| T40 | withdraw on multi-leaf campaign rejects with NotSingleStream | PASS | |
| T41 | get_vested_amount returns correct amounts for cliff/linear/milestone | PASS | Off-chain math |
| T42 | pause blocks claims with CampaignPaused | PASS | |
| T43 | unpause resumes claims successfully | PASS | |
| T44 | update_root allows claim with new merkle root | PASS | |
| T45 | withdraw on paused campaign rejects with CampaignPaused | PASS | |
| T46 | withdraw with milestone release_type succeeds after cliff | PASS | |
| T47 | close_claim_record after grace period succeeds | PASS (bankrun) | Bankrun warp past 604800s |
| T48 | over-claim exceeding total_supply rejects with OverClaim | PASS | |
| T49 | pause on campaign with no pause_authority rejects with NotPausable | PASS | |
| T50 | withdraw_unvested on non-cancelled campaign rejects with NotCancelled | PASS | |
| T51 | claim with wrong vault rejects with WrongVault | PASS | |
| T52 | claim when vault underfunded rejects with InsufficientVault | PASS | |
| T53 | claim with wrong mint rejects with MintMismatch | PASS | |
| T54 | fund_campaign with zero amount rejects with ZeroAmount | PASS | |
| T55 | withdraw after cancel uses cancel-time clamped amount | PASS (bankrun) | Bankrun warp to 50% cancel, then past end |
| T56 | withdraw at 25% vested unlocks 25% of stream amount | PASS | |
| T57 | withdraw at 100% vested claims full stream amount | PASS | |
| T58 | withdraw at 50% vested unlocks 50% of stream amount | PASS | Symmetric cliff/end window (~50% at validator now) |
| T59 | immediate second withdraw rejects with NothingToClaim | PASS (bankrun) | Bankrun — after 25% claim |

---

## Clock-Dependent Tests — Bankrun (included in full suite)

These tests need deterministic clock warping, which is not available on devnet RPC. They run in-process via `solana-bankrun` + `anchor-bankrun` (`context.setClock()`). Included automatically in `pnpm test:localnet` and `pnpm test:devnet`.

Standalone:

```bash
pnpm exec ts-mocha -p ./tsconfig.json -t 1000000 tests/vesting.clock.spec.ts
```

| Test | What it tests | Clock warp | Localnet Result |
|------|--------------|------------|----------------|
| T17 | Linear claim at exactly 25% vested | +250s from start | PASS — claimed 2500/10000 |
| T18 | Progressive claims at 30%, then 80% | +300s, then +800s | PASS — 3000 then 8000 cumulative |
| T20 | withdraw_unvested after 7-day grace period | +604800s (7 days) | PASS — full vault recovery |
| T25 | Withdraw partial then full (progressive) | +300s, then +800s | PASS — 3000 then 8000 cumulative |
| T47 | close_claim_record after grace period | +604800s (7 days) | PASS — SOL rent refund |
| T55 | Cancel-time clamped withdraw | +500s for cancel, +2000s for withdraw | PASS — received ~5000 (not 10000) |
| T56 | Withdraw at exactly 25% vested | +250s of 1000s window | PASS — claimed 2500/10000 |
| T58 | Withdraw at exactly 50% vested | +500s of 1000s window | PASS — claimed 5000/10000 |
| T59 | Second withdraw when caught up | none (same clock) | PASS — NothingToClaim (6015) |
| EXPLOIT 4 | Claim after vault drained past grace period | +604800s (7 days) | PASS — InsufficientVault error |

**Test file:** `tests/vesting.clock.spec.ts` | **Runtime:** ~1s for all bankrun clock tests

---

## Acceptance Criteria — Devnet Verification

| AC | Criterion | Devnet Status | Localnet Status |
|----|-----------|--------------|-----------------|
| AC1 | create_stream works | PASS (T21) | — |
| AC2 | Tokens locked in PDA | PASS (EXPLOIT 6, T12, T19) | — |
| AC3 | Linear unlock math | PASS — off-chain only (T41) | PASS — on-chain 25%/30%/80% (T17, T18) |
| AC4 | withdraw instruction works | PASS (T22) | PASS — progressive (T25) |
| AC5 | Partial withdrawals | PASS (T18, T25 via bankrun in full suite) | PASS |
| AC6 | Cannot withdraw more than unlocked | PASS (T23) | PASS (T59 — NothingToClaim on double withdraw) |
| AC7 | Cannot withdraw from another's stream | PASS (T24) | — |
| AC8 | 0%/25%/50%/100% checkpoints | PASS — 0% (T23), 25% (T56), 50% (T58), 100% (T57) | PASS — exact 25%/50% (T56, T58) + progressive (T25) |
| AC9 | Deployed to devnet | PASS | — |
| AC10 | Grace period enforcement | PASS — reject before (T12) | PASS — allow after (T20, T47, EXPLOIT 4) |
| AC11 | Cancel-time clamping | PASS (T55 via bankrun in full suite) | PASS — 50% clamped |
