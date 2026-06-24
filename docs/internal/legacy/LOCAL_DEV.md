# Local development — running the test suite

This document explains the keypair setup required to run the Anchor test
suite locally. **Read this before your first `anchor test`.**

---

## TL;DR

| Where you're running | What you need | Tests run? |
|---|---|---|
| GitHub Actions (CI) | `PROGRAM_KEYPAIR_JSON` secret (configured) | ✓ automatic |
| Local machine | The G6iaig program keypair (NOT in this repo) | ✓ if you have the key |
| Local machine without the key | — | ✗ see workaround below |

If your `anchor test` fails with `Transaction simulation failed: Attempt to load a program that does not exist` or `DeclaredProgramIdMismatch` (Anchor 4100), you are hitting the keypair mismatch described below.

---

## Why local tests need a specific keypair

The vesting program's ID is hardcoded in two places that **must agree**:

1. `programs/vesting/src/lib.rs` → `declare_id!("G6iaig...")`
2. `target/deploy/vesting-keypair.json` → pubkey of the program keypair

Anchor's runtime check (`DeclaredProgramIdMismatch`, code 4100) compares the
**deployed program ID** against `declare_id!`. If they differ, every
instruction rejects with 4100.

The devnet deployment at `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` is
the canonical program. To run the same code path locally, you must build
the program with the matching keypair so that the local `target/deploy/`
also produces a `.so` whose `declare_id!` and deployed-at address both
resolve to `G6iaig...`.

The `target/deploy/vesting-keypair.json` that Anchor auto-generates on a
fresh clone produces a random pubkey (e.g. `E12PjVA4...`) — this is a
**different** program ID. Deploying it locally and pointing tests at it
fails with `DeclaredProgramIdMismatch`.

---

## Where the G6iaig keypair lives

The real keypair is **NOT in this repository** (it would let anyone upgrade
the devnet program). It lives in two known places:

1. **GitHub Actions secret** `PROGRAM_KEYPAIR_JSON` on the repo settings.
   This is what CI uses (`.github/workflows/ci.yml:103`). The CI workflow
   verifies the keypair derives to `G6iaig...` before building.

2. ** whoever deployed devnet originally has a copy on disk**. If you have
   admin access to devnet, you can rotate upgrade authority to a new
   keypair you control, but that's a separate decision and outside the
   scope of this doc.

---

## Running tests in CI

CI runs the full suite (including `tests/week7-coverage-gaps.spec.ts`) on
every push to non-main branches and on PRs to `main`/`test`. No setup
needed beyond keeping the `PROGRAM_KEYPAIR_JSON` secret current.

Coverage gate: the dedicated "Coverage gap tests" step
(`.github/workflows/ci.yml`) runs only `tests/week7-coverage-gaps.spec.ts`
so coverage regressions are labelled distinctly from integration failures.

---

## Local workaround — without the G6iaig keypair

You have three options if you don't have the program keypair.

### Option A — Don't run integration tests locally; rely on CI

Push to a feature branch, let CI run them. Use `cargo test` for the pure
Rust unit tests (math, merkle) — those work without any keypair:

```bash
cd programs/vesting && cargo test -- --nocapture
```

This covers the math module (`math/merkle.rs`, `math/schedule.rs`) which is
where most correctness risk lives.

### Option B — Use bankrun for stateless tests

`tests/vesting-native-sol.spec.ts` and the `tests/utils/bankrun.ts` helper
use `solana-bankrun` which loads the program freshly per test from the
build artifacts. Bankrun uses whatever keypair is in
`target/deploy/vesting-keypair.json` and synthesizes a program ID from
it — so the mismatch with `declare_id!` doesn't apply the same way.

To run just the bankrun tests:

```bash
pnpm exec ts-mocha -p ./tsconfig.json -t 1000000 'tests/vesting-native-sol.spec.ts'
```

This works without the G6iaig keypair.

### Option C — Rotate to a fresh local-only program ID

If you want the full suite to run locally and accept that you're forking
the program ID away from devnet, generate a fresh keypair and update
`declare_id!`, `Anchor.toml`, `tests/utils/setup.ts`, the IDL, and the CI
workflow in lockstep. This is a large, careful change; see the git history
around the keypair commits for the canonical sequence.

**Warning:** doing this orphanates the existing devnet deployment at
`G6iaig...` — it stays on devnet but is no longer the program this repo
builds. Only do this if you intend to redeploy devnet from scratch.

---

## Verifying the keypair matches

If you do have a candidate keypair file, check it before copying into
`target/deploy/`:

```bash
solana-keygen pubkey <path-to-keypair.json>
# must print: G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu
```

If it prints anything else, that keypair derives a different program ID
and tests will fail with 4100. Either find the G6iaig keypair or follow
Option C above.

---

## Frequently confused

| File | Role |
|---|---|
| `~/.config/solana/id.json` | Your Solana CLI **payer wallet** (pays for transactions, gets airdrops). Pubkey is unrelated to the program ID. |
| `target/deploy/vesting-keypair.json` | The **program keypair**. Its pubkey **is** the program ID. Must match `declare_id!`. |
| `PROGRAM_KEYPAIR_JSON` secret | GitHub Actions secret containing the JSON contents of the real G6iaig keypair. |

Wallet keypair ≠ program keypair. They are different files with different
pubkeys serving different roles.
