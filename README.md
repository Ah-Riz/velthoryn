# Mancer Vesting

Solana token-distribution protocol combining Merkle-tree compression with full vesting (cliff / linear / milestone), per-recipient clawback via root rotation, and a 7-day campaign-wide grace clawback.

Built by Team 7 (Mancer x Superteam Scholarship).

> **Build verified by @geral on 2026-05-06.** Clone-to-test in ~10 min on WSL/Ubuntu. See [Week 3 report](report-week3.md) for full verification log and friction points found.

## Repo layout

```
mancer-vesting/
├── programs/vesting/   # Anchor program (Rust)              — owner: Lana
├── clients/ts/         # Off-chain Merkle tooling (TS)      — placeholder, see apps/web/src/lib/merkle/
├── apps/web/           # Frontend dApp (Next.js 15)          — owner: Geral
├── tests/              # ts-mocha integration tests
├── .github/workflows/  # CI: anchor build + anchor test + lint
├── Anchor.toml
├── Cargo.toml
├── package.json
└── pnpm-workspace.yaml
```

## Ownership

| Area                | Owner | Notes                                             |
| ------------------- | ----- | ------------------------------------------------- |
| `programs/vesting/` | Lana  | Anchor program, instructions, state, math         |
| `clients/ts/`       | Lana  | Placeholder — Merkle helpers currently in `apps/web/src/lib/merkle/builder.ts` |
| `apps/web/`         | Geral | Frontend, wallet adapter, Merkle builder, UX      |
| Root configs, CI    | Joint | Workspace files, GitHub Actions                   |

## Current status

**10 instruction entry points** matching the Week 2 architecture — all compile, handlers are stubs (`Ok(())`). State structs, error codes, and events are fully defined. `leaf_hash()` is live and byte-verified against the TS encoder. Real instruction logic lands Week 4.

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
| `get_vested_amount`  | Read-only helper that runs the schedule math against a leaf.      |

For deeper reads:
- [`docs/PROGRAM.md`](docs/PROGRAM.md) — program internals, file map, instruction surface, state layouts, what's live vs stub.
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
git checkout test      # Week 3 work — not yet merged to main
pnpm install
```

`target/deploy/vesting-keypair.json` is **not committed** (security). Generate it once on a fresh clone:

```bash
solana-keygen new -o target/deploy/vesting-keypair.json --no-bip39-passphrase
```

> The program ID is already hardcoded in `Anchor.toml` and `programs/vesting/src/lib.rs` (`G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`). The keypair file is only needed locally to sign a redeploy — for normal build and test it isn't used.

```bash
anchor build           # produces target/idl/vesting.json + target/types/vesting.ts
anchor test            # expected: 3 passing
```

## Devnet

Program is deployed at `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` (slot 460511260).

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
