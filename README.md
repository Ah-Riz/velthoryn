# Velthoryn

Solana token-distribution protocol combining Merkle-tree compression with full vesting (cliff / linear / milestone), per-recipient clawback via root rotation, and a 7-day campaign-wide grace clawback.

Built by Team 7 (Velthoryn x Superteam Scholarship).

> **Setup time**: ~10 min from clone to a green test on a machine with Rust + Solana CLI + Anchor + Node already installed; ~30 min from a clean machine.

## Repo layout

```
velthoryn/
├── programs/vesting/   # Anchor program (Rust)              — owner: Lana
├── clients/ts/         # TypeScript client library (leaf encoding, Merkle tree)
├── apps/web/           # Frontend dApp + Merkle tooling      — owner: Geral
├── tests/              # ts-mocha integration tests
├── .github/workflows/  # CI: anchor build + anchor test + lint
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
| `apps/web/`         | Geral | Frontend stack, wallet adapter, Merkle tooling |
| Root configs, CI    | Joint | Workspace files, GitHub Actions             |

## Current status

**Fully implemented and deployed to devnet.** All 12 instruction handlers (including `create_stream` and `withdraw` for single-recipient streams), schedule math (`vested`, `get_vested_amount`), and Merkle proof verification (`verify_merkle_proof`) are live with real logic. State structs, error codes (31 variants), and events (9 types) are fully defined. `leaf_hash()` is byte-verified against the TS encoder.

**Test results: 65/65 PASS** (stream checklist: T58 50% withdraw, T59 double-withdraw guard)
- Devnet: 58+ passing; clock-dependent cases run on bankrun
- Localnet (bankrun): `tests/vesting.clock.spec.ts` — T17–T20, T25, T47, T55–T59, EXPLOIT 4

See [`docs/STREAM_MODEL.md`](docs/STREAM_MODEL.md) (tutorial `Stream` PDA vs campaign model) and [`docs/ERROR_MAP.md`](docs/ERROR_MAP.md).

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
| `get_vested_amount`  | Read-only helper that runs the schedule math against a leaf.      |

For deeper reads:
- [`docs/PROGRAM.md`](docs/PROGRAM.md) — program internals, file map, instruction surface, state layouts.
- [`docs/INTEGRATION.md`](docs/INTEGRATION.md) — frontend-track guide: program ID, IDL/types location, PDA derivations, Merkle helpers, sample calls.
- [`docs/TESTING.md`](docs/TESTING.md) — how to run tests, clock-dependent tests, writing new tests.
- [`docs/DEVNET_TEST_RESULTS.md`](docs/DEVNET_TEST_RESULTS.md) — full test results matrix with acceptance criteria.

## Prerequisites

- Rust stable (edition 2021)
- Solana CLI >= 2.1
- Anchor CLI **1.0.0** — `avm install 1.0.0 && avm use 1.0.0`
- Node >= 20
- pnpm >= 10 (`npm i -g pnpm`)

> **Windows users:** native Windows is not viable for Solana/Anchor development — use WSL2 (Ubuntu).

## Quickstart

```bash
git clone https://github.com/Ah-Riz/mancerxsuperteam-token-vesting.git
cd mancerxsuperteam-token-vesting
git checkout test      # Integration branch (merged from dev_lana + dev_geral)
pnpm install
```

`target/deploy/vesting-keypair.json` is **not committed** (security). Generate it once on a fresh clone:

```bash
solana-keygen new -o target/deploy/vesting-keypair.json --no-bip39-passphrase
```

> The program ID is already hardcoded in `Anchor.toml` and `programs/vesting/src/lib.rs` (`G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`). The keypair file is only needed locally to sign a redeploy — for normal build and test it isn't used.

```bash
anchor build           # produces target/idl/vesting.json + target/types/vesting.ts
pnpm test:localnet     # persistent validator — 74/74 passing (~2m)
pnpm test:devnet       # against devnet RPC (deployed program + funded wallet)
```

Clock-dependent tests (11) use `solana-bankrun` inside the full suite; they are included in `pnpm test:localnet` and do not need a separate run.

## Frontend (apps/web)

Next.js 15 dApp with wallet integration, vesting stream creation, and token claiming.

```bash
cd apps/web
pnpm dev               # http://localhost:3000
pnpm test              # 38 Vitest tests (vesting math, PDA derivation, Merkle)
```

Routes:
- `/` — Landing page
- `/campaign/create` — Create a vesting stream (calls `createStream`)
- `/campaign/[treeAddress]` — View stream & claim tokens (calls `withdraw`)

Wallet connection uses wallet-standard auto-detect (Phantom/Solflare/Backpack). Set `NEXT_PUBLIC_RPC_ENDPOINT` to override the default devnet RPC.

Frontend docs: [`docs/PRD_GERAL.md`](docs/PRD_GERAL.md), [`docs/PDD_GERAL.md`](docs/PDD_GERAL.md), [`docs/TDD_GERAL.md`](docs/TDD_GERAL.md), [`docs/SECURITY_GERAL.md`](docs/SECURITY_GERAL.md).

## Devnet

Program is deployed at `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`. Latest upgrade at slot 461219566 (~447KB allocation).

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

`.github/workflows/ci.yml` runs `anchor build` + `pnpm test:localnet` on every push and PR.
`.github/workflows/lint.yml` runs `cargo clippy` + Next.js ESLint (`pnpm lint` in `apps/web/`) on pushes to main/dev branches and PRs to main.

## License

MIT — see `LICENSE`.