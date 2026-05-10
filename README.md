# Mancer Vesting

Solana token-distribution protocol combining Merkle-tree compression with full vesting (cliff / linear / milestone), per-recipient clawback via root rotation, and a 7-day campaign-wide grace clawback.

Built by Team 7 (Mancer x Superteam Scholarship).

> **Setup time**: ~10 min from clone to a green test on a machine with Rust + Solana CLI + Anchor + Node already installed; ~30 min from a clean machine.

## Repo layout

```
mancer-vesting/
├── programs/vesting/   # Anchor program (Rust)              — owner: Lana
├── clients/ts/         # TypeScript client library (leaf encoding, Merkle tree)
├── apps/web/           # Frontend dApp + Merkle tooling      — owner: Geral
├── tests/              # ts-mocha integration tests
├── .github/workflows/  # CI: anchor build + anchor test + lint
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

## Current status

**Fully implemented and deployed to devnet.** All 12 instruction handlers (including `create_stream` and `withdraw` for single-recipient streams), schedule math (`vested`, `get_vested_amount`), and Merkle proof verification (`verify_merkle_proof`) are live with real logic. State structs, error codes (31 variants), and events (9 types) are fully defined. `leaf_hash()` is byte-verified against the TS encoder.

**Test results:**
- Local validator (`anchor test`): 61 passing, 2 known failures (error-code mismatches — pending fix)
- Devnet (live): 44 passing, 12 stale-PDA failures (persistent state from prior runs), 8 skipped
- T17/T18/T25 setClock tests: Fixed — now use consistent 90% threshold validation and skip gracefully on devnet

| Instruction          | Role                                                              |
| -------------------- | ----------------------------------------------------------------- |
| `create_campaign`    | Initialize a vesting tree (Merkle root, supply, authorities).     |
| `create_stream`      | Atomic single-recipient campaign creation + funding in one tx.    |
| `fund_campaign`      | Creator deposits SPL tokens into the campaign vault.              |
| `claim`              | Recipient claims vested portion against a Merkle proof.           |
| `withdraw`           | Simplified claim for single-recipient streams (no Merkle proof).  |
| `cancel_campaign`    | Cancel authority freezes the curve and starts a 7-day grace.      |
| `update_root`        | Rotate the Merkle root to add/remove/adjust recipients.           |
| `withdraw_unvested`  | Creator sweeps unvested tokens after the grace window.            |
| `pause_campaign`     | Temporarily block claims.                                         |
| `unpause_campaign`   | Resume a paused campaign.                                         |
| `close_claim_record` | Reclaim rent on a fully-claimed `ClaimRecord` PDA.                |
| `get_vested_amount`  | Read-only helper that runs the schedule math against a leaf.      |

For deeper reads:
- [`docs/PROGRAM.md`](docs/PROGRAM.md) — program internals, file map, instruction surface, state layouts.
- [`docs/INTEGRATION.md`](docs/INTEGRATION.md) — frontend-track guide: program ID, IDL/types location, PDA derivations, Merkle helpers, sample calls.

## Prerequisites

- Rust stable (edition 2021)
- Solana CLI ≥ 2.1
- Anchor CLI **1.0.0** — `avm install 1.0.0 && avm use 1.0.0`
- Node ≥ 20
- pnpm ≥ 10 (`npm i -g pnpm`)

> **Windows users:** native Windows is not viable for Solana/Anchor development — use WSL2 (Ubuntu).

## Quickstart

```bash
git clone https://github.com/Ah-Riz/mancerxsuperteam-token-vesting.git
cd mancerxsuperteam-token-vesting
git checkout dev_lana  # Active development branch
pnpm install
```

`target/deploy/vesting-keypair.json` is **not committed** (security). Generate it once on a fresh clone:

```bash
solana-keygen new -o target/deploy/vesting-keypair.json --no-bip39-passphrase
```

> The program ID is already hardcoded in `Anchor.toml` and `programs/vesting/src/lib.rs` (`G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`). The keypair file is only needed locally to sign a redeploy — for normal build and test it isn't used.

```bash
anchor build           # produces target/idl/vesting.json + target/types/vesting.ts
anchor test            # local validator: 61 passing, 2 known failures (pending fix)
```

## Devnet

Program is deployed at `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`. Latest upgrade at slot 461219566 (~447KB allocation). Tested on devnet: 44/56 tests pass (12 failures due to stale PDA state from prior runs — use `solana-test-validator --reset` for clean local runs).

```bash
solana program show G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu --url devnet
```

To redeploy (inject keypair from your local file — program ID stays stable):

```bash
solana config set --url devnet
anchor build
anchor deploy --provider.cluster devnet
```

## CI

`.github/workflows/ci.yml` runs `anchor build` + `anchor test` on every push and PR.
`.github/workflows/lint.yml` runs `cargo clippy` separately (no merge conflict with ci.yml).

## License

MIT — see `LICENSE`.
