# Solana Program Testing Tools — Beyond sealevel-attacks & Anchor Docs

> Research reference for the mancer-vesting project. Covers tools, frameworks, and approaches not yet in use.

---

## What's Already In Use

| Tool | Where | Purpose |
|---|---|---|
| Mocha + Chai + ts-mocha | `tests/**/*.spec.ts` (14 spec files) | Integration tests |
| solana-bankrun + anchor-bankrun | `tests/utils/bankrun.ts` | In-memory VM tests with time warping |
| Rust `cargo test` | `programs/vesting/src/math/` | Merkle proof + schedule math unit tests |
| solana-test-validator | `scripts/test-localnet.sh` | Full local validator E2E tests |
| Trident fuzz | `trident-tests/` | Fuzz testing (configured, separate crate) |
| Vitest | `apps/web/` | Web app unit tests |
| Playwright | `apps/web/` | Browser E2E tests |

---

## Additional Tools Available

### 1. Mollusk ⭐ (Recommended — fastest option)

- **Repo:** https://github.com/anza-xyz/mollusk
- **By:** Anza (Solana core team) — officially recommended by Anchor docs
- **What it does:** Lightweight test harness that runs instructions directly against the SVM — no AccountsDB, no Bank, no validator. **Fastest possible test execution.**
- **Key features:**
  - `Check` enum for expressive assertions on account state (lamports, data)
  - `process_instruction_chain` for testing multi-instruction flows (create_campaign → fund → claim)
  - **Built-in compute unit benchmarking** — generates markdown tables comparing CU usage across benchmarks
  - **Built-in fuzz fixture generation** — eject every instruction as a replayable fixture via `EJECT_FUZZ_FIXTURES` env var
  - `register-tracing` feature for low-level execution introspection
  - `sbpf-debugger` feature for GDB remote protocol stepping
- **Language:** Rust only
- **Install:** `cargo add --dev mollusk`

```rust
// Example: test claim instruction
let mollusk = Mollusk::default();
let result = mollusk.process_and_validate_instruction(
    ix,
    &[
        Check::account(&claim_record).data(expected_data).build(),
        Check::success(),
    ],
);
```

---

### 2. LiteSVM

- **Repo:** https://github.com/LiteSVM/litesvm
- **What it does:** In-process Solana VM — faster than bankrun, slower than Mollusk. Supports Rust, TS/JS, and Python.
- **Key features:**
  - Very ergonomic API: `svm.airdrop()`, `svm.send_transaction()`
  - Time manipulation (clock warping) — useful for vesting cliff/period testing
  - Multi-language support (Rust, TypeScript/JS, Python via `solders`)
- **Could replace or complement bankrun** for faster TS test execution
- **Officially recommended by Anchor docs** alongside Mollusk
- **Install (Rust):** `cargo add --dev litesvm` / **(JS):** `pnpm add -D litesvm`

```rust
let mut svm = LiteSVM::new();
svm.airdrop(&payer, 10_000_000_000).unwrap();
let tx_res = svm.send_transaction(tx).unwrap();
```

---

### 3. proptest (Property-Based Testing) ⭐

- **Crate:** https://crates.io/crates/proptest
- **What it does:** Generate arbitrary inputs to find edge cases automatically. Like Hypothesis (Python) for Rust.
- **Why it's valuable for this project:**
  - Fuzz `calculate_vested_amount()` with arbitrary `(amount, start_time, cliff_time, end_time, current_time)` tuples
  - Fuzz Merkle proof verification with malformed proofs
  - Assert invariants: `claimed_amount <= total_entitled` is never violated for any input
  - Test overflow safety in vesting math
  - Would catch boundary bugs automatically instead of manually
- **Install:** `cargo add --dev proptest`

```rust
proptest! {
    #[test]
    fn vested_amount_never_exceeds_total(
        amount in 1u64..1_000_000_000_000u64,
        start in 0i64..1_000_000i64,
        cliff in 0i64..1_000_000i64,
        end in 0i64..1_000_000i64,
        now in 0i64..2_000_000i64,
    ) {
        let (start, cliff, end) = sort3(start, cliff, end);
        let vested = calculate_vested_amount(amount, start, cliff, end, now);
        prop_assert!(vested <= amount);
    }
}
```

---

### 4. solana-program-test (BanksClient direct)

- **Docs:** https://docs.rs/solana-program-test
- **What it does:** Lower-level BanksClient access — more control but less ergonomic than bankrun
- **Status:** ⚠️ **Deprecated since v3.1.0** — being moved to `agave-unstable-api`
- **Verdict:** Skip — bankrun already wraps this and provides a better API

---

### 5. Formal Verification

- **Status:** ⚠️ **No production-grade tool exists** for Solana (unlike Move Prover for Move)
- **Closest:** Mollusk's `register-tracing` and `sbpf-debugger` features provide low-level execution introspection
- **Not actionable today**, but worth watching as the ecosystem matures

---

### 6. Automated Security Scanning

- **Status:** ⚠️ **No Slither-equivalent exists** for Solana
- The project already has `tests/security.spec.ts` and `tests/sealevel-attacks-gap.spec.ts`
- Manual audit firms available: [OtterSec](https://osec.io/), [Sec3/Soteria](https://www.sec3.dev/), [Neodyme](https://neodyme.io/), [Zellic](https://zellic.io/)
- For this project's size, the existing security test suite + sealevel-attacks coverage is solid

---

## Speed Comparison

```
Mollusk        ████████░░  Fastest (raw SVM, no Bank/AccountsDB)
LiteSVM        ███████░░░  Very fast (in-process VM)
bankrun        █████░░░░░  Fast (BanksServer, no validator)  ← already in use
program-test   ████░░░░░░  Fast (deprecated)
test-validator █░░░░░░░░░  Slowest (full validator)  ← already in use
```

---

## Recommended Priority for mancer-vesting

| Priority | Tool | Effort | Impact |
|---|---|---|---|
| 🥇 1st | **proptest** | Low (add to existing `#[cfg(test)]` modules) | High — catches math edge cases automatically |
| 🥈 2nd | **Mollusk** | Medium (new Rust test files) | High — CU benchmarking + fastest test iteration |
| 🥉 3rd | **LiteSVM** | Medium (could replace bankrun for speed) | Medium — faster than bankrun, similar capability |

---

## Sources

- [Solana Official Testing Docs](https://solana.com/docs/programs/testing)
- [Mollusk (anza-xyz)](https://github.com/anza-xyz/mollusk)
- [LiteSVM](https://github.com/LiteSVM/litesvm)
- [solana-bankrun](https://github.com/kevinheavey/solana-bankrun)
- [solana-program-test docs.rs](https://docs.rs/solana-program-test/latest/solana_program_test/)
- [Anchor Testing Guide](https://www.anchor-lang.com/docs/testing)
- [Anchor LiteSVM Guide](https://www.anchor-lang.com/docs/testing/litesvm)
- [Anchor Mollusk Guide](https://www.anchor-lang.com/docs/testing/mollusk)
