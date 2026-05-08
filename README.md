# Mancer Vesting

Solana token-distribution protocol combining Merkle-tree compression with full vesting (cliff / linear / milestone), per-recipient clawback via root rotation, and a 7-day campaign-wide grace clawback.

Built by Team 7 (Mancer x Superteam Scholarship).

> **Setup time**: ~10 min from clone to a green test on a machine with Rust + Solana CLI + Anchor + Node already installed; ~30 min from a clean machine.

## Repo layout

```
mancer-vesting/
├── programs/vesting/   # Anchor program (Rust)              — owner: Lana
├── apps/web/           # Frontend dApp + Merkle tooling      — owner: Geral
├── tests/              # ts-mocha integration tests
├── .github/workflows/  # CI: anchor build + anchor test
├── Anchor.toml
├── Cargo.toml
├── package.json
└── pnpm-workspace.yaml
```

## Ownership

| Area                | Owner | Notes                                       |
| ------------------- | ----- | ------------------------------------------- |
| `programs/vesting/` | Lana  | Anchor program, instructions, state, math   |
| `apps/web/`         | Geral | Frontend stack, wallet adapter, Merkle tooling |
| Root configs, CI    | Joint | Workspace files, GitHub Actions             |

## Architecture (Week 3 scaffold)

The program declares **10 instruction entry points** matching the Week 2 architecture:

| Instruction          | Role                                                              |
| -------------------- | ----------------------------------------------------------------- |
| `create_campaign`    | Initialize a vesting tree (Merkle root, supply, authorities).     |
| `fund_campaign`      | Creator deposits SPL tokens into the campaign vault.              |
| `claim`              | Recipient claims vested portion against a Merkle proof.           |
| `cancel_campaign`    | Cancel authority freezes the curve and starts a 7-day grace.      |
| `update_root`        | Rotate the Merkle root to add/remove/adjust recipients.           |
| `withdraw_unvested`  | Creator sweeps unvested tokens after the grace window.            |
| `pause_campaign`     | Temporarily block claims.                                         |
| `unpause_campaign`   | Resume a paused campaign.                                         |
| `close_claim_record` | Reclaim rent on a fully-claimed `ClaimRecord` PDA.                |
| `get_vested_amount`  | Read-only helper that runs the schedule math against a leaf.     |

> **Week 3 status**: All 10 handlers compile with empty `Ok(())` bodies. State structs (`VestingTree`, `ClaimRecord`, `VestingLeaf`), error codes, and event types are fully defined per Week 2 architecture. Real instruction logic, Merkle math, and integration tests land in Weeks 4-5.

For deeper reads:
- [`docs/PROGRAM.md`](docs/PROGRAM.md) — program internals, file map, instruction surface, state layouts, where Week 4 picks up.
- [`docs/INTEGRATION.md`](docs/INTEGRATION.md) — frontend-track guide: program ID, IDL/types location, PDA derivations, sample calls.

## Prerequisites

- Rust stable (edition 2021)
- Solana CLI ≥ 2.1
- Anchor CLI **1.0.0** — install with `avm install 1.0.0 && avm use 1.0.0`
- Node ≥ 20
- pnpm ≥ 10 (`npm i -g pnpm`)

## Quickstart

```bash
git clone https://github.com/Ah-Riz/mancerxsuperteam-token-vesting.git
cd mancerxsuperteam-token-vesting

pnpm install
```

### First build — sync program ID

The repo ships with a placeholder program ID. You must sync it to your local keypair before the first build:

```bash
solana address -k target/deploy/vesting-keypair.json
# Copy the output address, then replace in Anchor.toml and programs/vesting/src/lib.rs:
PROG_ID=$(solana address -k target/deploy/vesting-keypair.json) && \
sed -i "s/Vest1111111111111111111111111111111111111111/$PROG_ID/g" Anchor.toml programs/vesting/src/lib.rs
```

Then build:

```bash
anchor build
```

### Install test dependencies

Test runner (`ts-mocha`) and related packages are not yet in `package.json`. Install before running tests:

```bash
pnpm add -Dw ts-mocha mocha @types/mocha chai @types/chai typescript ts-node @coral-xyz/anchor @solana/web3.js
```

### Run tests

```bash
anchor test
```

Expected output: `2 passing` from the `vesting program scaffold` suite.

## Build

```bash
anchor build
```

Produces `target/deploy/vesting.so` and the IDL at `target/idl/vesting.json`. The program ID is fixed at `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` (committed at `target/deploy/vesting-keypair.json`, since this is a *program* keypair, not a wallet).

## Run tests

`anchor test` boots the embedded validator (Anchor 1.0 LiteSVM by default) and runs the suite in `tests/`:

```bash
pnpm install     # first time only
anchor test
```

Add new specs as `tests/*.spec.ts`. The runner is `ts-mocha` driven by the `[scripts] test` line in `Anchor.toml`.

## Deploy to devnet

```bash
# 1. Point Solana CLI at devnet and fund the deployer wallet
solana config set --url devnet
solana airdrop 2

# 2. Build and deploy
anchor build
anchor deploy --provider.cluster devnet

# 3. Verify the deployment
solana program show G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu --url devnet
```

`anchor deploy` reuses `target/deploy/vesting-keypair.json` so the program ID stays stable across redeploys.

## CI

`.github/workflows/ci.yml` runs `anchor build` and `anchor test` on every push and pull request. See the badge on the GitHub repo for the latest status.

## License

MIT — see `LICENSE`.
