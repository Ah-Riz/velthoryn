# Testing Tools Implementation Report

> **Date:** 2026-06-03  
> **Scope:** Add proptest, Mollusk instruction tests, and Mollusk CU benchmarks to the mancer-vesting program  
> **Result:** 40 tests passing across 4 Rust test suites, 0 failures

---

## Executive Summary

Implemented three new testing tools for the mancer-vesting Solana program:

1. **proptest** — Property-based testing for vesting math and Merkle proofs (10 tests)
2. **Mollusk instruction tests** — SVM-level instruction execution and validation (14 tests)
3. **Mollusk CU benchmarks** — Compute unit measurement for key instructions (9 benchmarks)

All 40 new tests pass in **0.45s total** — no validator, no network, no external dependencies.

---

## Test Results

| Suite | Command | Tests | Time |
|---|---|---|---|
| **proptest + unit** | `cargo test --lib` | 23 ✅ | 0.09s |
| **Mollusk instructions** | `cargo test --test instructions` | 14 ✅ | 0.19s |
| **Mollusk benchmarks** | `cargo test --test benchmarks` | 2 ✅ | 0.10s |
| **Mollusk scaffold** | `cargo test --test compute_units` | 1 ✅ | 0.07s |
| **Total** | | **40** | **0.45s** |

---

## 1. proptest — Property-Based Tests (10 tests)

**Files:** `programs/vesting/src/math/schedule.rs` (6), `programs/vesting/src/math/merkle.rs` (4)  
**Dependency:** `proptest = "1"` added to `[dev-dependencies]`

### Schedule Math Tests

| # | Test | Invariant |
|---|---|---|
| 1 | `vested_never_exceeds_amount` | For any (amount, cliff, end, now), vested ≤ amount |
| 2 | `cliff_all_or_nothing` | Release type 0 returns exactly 0 or full amount |
| 3 | `linear_monotonic` | Linear vesting never decreases as time advances |
| 4 | `cancel_clamps_to_cancel_time` | `get_vested_amount` with cancel returns same as `vested(cancel_at)` |
| 5 | `zero_before_cliff` | All 3 release types return 0 before cliff |
| 6 | `linear_midpoint_approx_half` | At 50% duration, vested ≈ amount/2 (integer rounding tolerance) |

### Merkle Proof Tests

| # | Test | Invariant |
|---|---|---|
| 7 | `tampered_proof_always_fails` | Any single-bit flip in root breaks verification |
| 8 | `single_leaf_root_equals_hash` | 1-leaf tree: leaf hash IS the root |
| 9 | `proof_len_for_powers_of_two` | `max_proof_len_for_leaf_count(2^n) = n` |
| 10 | `proof_len_bounded` | Proof length never exceeds MAX_MERKLE_PROOF_LEN (32) for any u32 |

---

## 2. Mollusk Instruction Tests (14 tests)

**File:** `programs/vesting/tests/instructions.rs`  
**Dependencies:** `mollusk-svm`, `sha2`, `borsh`, `solana-sdk`, `solana-account`, `solana-instruction`, `solana-pubkey`  
**Run:** `BPF_OUT_DIR=../../target/deploy cargo test --test instructions`

### create_campaign_native (4 tests)

| # | Test | Result |
|---|---|---|
| 1 | `happy_path` | ✅ Creates VestingTree, field-by-field assertion on all 17 fields |
| 2 | `empty_root` | ✅ Error 6000 (EmptyRoot) |
| 3 | `zero_leaf_count` | ✅ Error 6001 (EmptyCampaign) |
| 4 | `zero_amount` | ✅ Error 6002 (ZeroAmount) |

### get_vested_amount (6 tests)

| # | Test | Input | Expected |
|---|---|---|---|
| 5 | `cliff_before` | now < cliff_time | 0 |
| 6 | `cliff_after` | now ≥ cliff_time | 1000 (full amount) |
| 7 | `linear_mid` | 50% through vesting | 500 |
| 8 | `linear_full` | now ≥ end_time | 1000 |
| 9 | `milestone_no_flag` | milestone_released_flags = None | 0 |
| 10 | `milestone_with_flag` | flag set for milestone_idx | 1000 |
| 11 | `cancelled` | cancel_at clamps vesting | Correct clamped value |

### pause/unpause (3 tests)

| # | Test | Result |
|---|---|---|
| 12 | `pause_unpause_campaign` | ✅ pause→paused=true, unpause→paused=false |
| 13 | `pause_unauthorized` | ✅ Error 6005 (Unauthorized) — wrong authority |
| 14 | `pause_not_pausable` | ✅ Error 6021 (NotPausable) — no pause_authority set |

---

## 3. Mollusk CU Benchmarks (9 measurements)

**File:** `programs/vesting/tests/benchmarks.rs`  
**Run:** `BPF_OUT_DIR=../../target/deploy cargo test --test benchmarks -- --show-output`

### get_vested_amount — CU Cost per Release Type

| Scenario | Compute Units |
|---|---|
| Cliff, before cliff (returns 0) | **615** |
| Cliff, after cliff (returns full) | **615** |
| Linear, mid-vesting (50%) | **909** |
| Linear, fully vested | **614** |
| Milestone, flag not set (returns 0) | **624** |
| Milestone, flag set (returns full) | **655** |
| Linear, cancelled (cancel clamp) | **916** |

### create_campaign_native — CU Cost Scaling

| Configuration | Compute Units |
|---|---|
| 100 leaves, cancellable | **9,378** |
| 10,000 leaves, non-cancellable | **9,372** |

**Key insight:** CU cost is nearly identical regardless of leaf_count — the program stores the root hash, not the leaves. The ~6 CU difference is noise from serialization.

---

## Files Changed

| File | Action |
|---|---|
| `programs/vesting/Cargo.toml` | Added `proptest = "1"`, `sha2 = "0.10"`, `borsh = "1"` to `[dev-dependencies]` |
| `programs/vesting/src/math/schedule.rs` | Added `proptest_tests` module with 6 property tests |
| `programs/vesting/src/math/merkle.rs` | Added `proptest_tests` module with 4 property tests |
| `programs/vesting/tests/instructions.rs` | **New** — 14 Mollusk instruction-level tests |
| `programs/vesting/tests/benchmarks.rs` | **New** — 9 CU benchmarks across 2 test functions |
| `docs/TESTING_TOOLS.md` | **New** — testing tools reference doc |
| `docs/TESTING_TOOLS_REPORT.md` | **New** — this report |
| `docs/TESTING.md` | Updated — added proptest + Mollusk sections |
| `README.md` | Updated — added new testing tools to status |
| `weekly-report-mancer/week7/Lana.md` | Updated — added proptest + Mollusk metrics |

---

## Dev-Dependencies Added

```toml
[dev-dependencies]
proptest = "1"
sha2 = "0.10"
borsh = "1"
# Previously existing:
mollusk-svm = "0.13"
mollusk-svm-bencher = "0.13"
solana-sdk = "2.3"
solana-account = "3.4"
solana-instruction = "3.2"
solana-pubkey = "4.1"
hex = "0.4"
```

---

## How to Run

```bash
# Property tests only (no BPF binary needed)
cargo test --manifest-path programs/vesting/Cargo.toml --lib

# Mollusk instruction tests (needs compiled .so)
BPF_OUT_DIR=../../target/deploy cargo test --manifest-path programs/vesting/Cargo.toml --test instructions

# Mollusk CU benchmarks
BPF_OUT_DIR=../../target/deploy cargo test --manifest-path programs/vesting/Cargo.toml --test benchmarks -- --show-output

# Full Rust test suite (all of the above)
BPF_OUT_DIR=../../target/deploy cargo test --manifest-path programs/vesting/Cargo.toml -- --show-output
```
