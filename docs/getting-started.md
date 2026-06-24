# Getting Started

Set up your local environment and run the test suite in under 10 minutes.

## Prerequisites

| Tool            | Version      | Install                                     |
| --------------- | ------------ | ------------------------------------------- |
| Rust            | stable       | [rustup.rs](https://rustup.rs/)             |
| Solana CLI      | >= 2.1       | `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"` |
| Anchor CLI      | 1.0.0        | `cargo install --git https://github.com/coral-xyz/anchor avm --locked --force && avm install 1.0.0 && avm use 1.0.0` |
| Node.js         | >= 20        | [nodejs.org](https://nodejs.org/)           |
| pnpm            | >= 10        | `corepack enable && corepack prepare pnpm@latest --activate` |

## 1. Clone and Install

```bash
git clone https://github.com/Ah-Riz/mancerxsuperteam-token-vesting.git
cd mancerxsuperteam-token-vesting
pnpm install
```

## 2. Build the Program

```bash
anchor build
```

This produces:
- `target/idl/vesting.json` — the program IDL
- `target/types/vesting.ts` — generated TypeScript types
- `target/deploy/vesting.so` — the compiled program

## 3. Run Tests

```bash
pnpm test:localnet     # 127+ integration tests (~4 min)
```

For Rust-only unit tests (math, Merkle — no keypair needed):

```bash
cd programs/vesting && cargo test -- --nocapture
```

For frontend tests:

```bash
cd apps/web && pnpm test
```

{% hint style="info" %}
**Setup time:** ~10 minutes with toolchain pre-installed; ~30 minutes from a clean machine.
{% endhint %}

## Program Keypair

The program ID is `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`. The keypair file `target/deploy/vesting-keypair.json` is **not committed** to the repo — Anchor auto-generates a random one on first build.

Two files that **must agree**:

| File                                | Role                                      |
| ----------------------------------- | ----------------------------------------- |
| `programs/vesting/src/lib.rs`       | `declare_id!("G6iaig...")`                |
| `target/deploy/vesting-keypair.json`| Pubkey **is** the program ID              |

If they mismatch, every instruction fails with `DeclaredProgramIdMismatch` (Anchor 4100).

{% hint style="warning" %}
**Don't confuse keypairs.** Your Solana CLI wallet (`~/.config/solana/id.json`) is the **payer**. The program keypair (`target/deploy/vesting-keypair.json`) determines the **program ID**. They are different files with different pubkeys.
{% endhint %}

## Running Tests Without the Keypair

If you don't have the canonical G6iaig keypair, you have three options:

### Option A — Rely on CI

Push to a feature branch and let GitHub Actions run the full suite. The CI has the keypair configured as a secret (`PROGRAM_KEYPAIR_JSON`).

### Option B — Use Bankrun

`solana-bankrun` loads the program from build artifacts and bypasses the keypair mismatch:

```bash
pnpm exec ts-mocha -p ./tsconfig.json -t 1000000 'tests/vesting-native-sol.spec.ts'
```

### Option C — Rotate to a Fresh Program ID

Generate a new keypair and update `declare_id!`, `Anchor.toml`, test setup, and CI in lockstep. This orphans the existing devnet deployment — only do this for a full redeploy.

## Verify a Keypair

```bash
solana-keygen pubkey <path-to-keypair.json>
# Must print: G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu
```

## What's Next

- [Program Integration Guide](guides/integration.md) — create a campaign, fund it, claim tokens
- [Frontend Integration Guide](guides/frontend-integration.md) — build UI with hooks and components
- [Architecture](frontend/architecture.md) — understand the tech stack
