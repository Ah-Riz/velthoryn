# Velthoryn

Solana token-distribution protocol combining Merkle-tree compression with full vesting (cliff / linear / milestone), per-recipient clawback via root rotation, and a 7-day campaign-wide grace clawback.

Built by Team 7 (Velthoryn x Superteam Scholarship).

> **Setup time**: ~10 min from clone to a green test on a machine with Rust + Solana CLI + Anchor + Node already installed; ~30 min from a clean machine.

## Repo layout

```
velthoryn/
├── programs/vesting/   # Anchor program (Rust)              — owner: Lana
├── clients/ts/         # TypeScript client library (leaf encoding, Merkle tree)
├── apps/web/           # Next.js dApp + API routes + Merkle   — owner: Lana (API), Geral (UI)
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
| `apps/web/`         | Geral | Frontend UI, wallet adapter                |
| `apps/web/api/`     | Lana  | Backend API routes, DB, merkle pipeline    |
| Root configs, CI    | Joint | Workspace files, GitHub Actions             |

## Current status

**Fully implemented and deployed to devnet.** All **14** instruction handlers (including `create_stream`, `withdraw`, `set_milestone_released`, and `cancel_stream`), schedule math (`vested`, `get_vested_amount`), and Merkle proof verification (`verify_merkle_proof`) are live with real logic. State structs, error codes (34 variants), and events (9 types) are fully defined. `leaf_hash()` is byte-verified against the TS encoder.

**Test results: 86/86 SC tests PASS** (`pnpm test:localnet`); **~200/200 web Vitest PASS** (API routes use real Postgres in CI; hooks/merkle/math need no DB)
**BE–SC Merkle pipeline verified end-to-end**: 3-leaf campaigns (Cliff/Linear/Milestone) through prepare → POST (all leaves verified) → GET proof → verify. RLS on all Supabase tables. **Bootcamp acceptance: 8/8** — see [`docs/BE-SC-MERKLE-ACCEPTANCE-STATUS.md`](docs/BE-SC-MERKLE-ACCEPTANCE-STATUS.md).
- Devnet (`pnpm test:devnet`): **86 passing, 1 pending** (T68 clock warp; cancel logic covered by T64b–T64d)
- Clock-dependent cases: `tests/vesting.clock.spec.ts` via **solana-bankrun** (T17–T20, T25, T47, T55–T64, EXPLOIT 4)

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
| `set_milestone_released` | Creator sets a milestone flag before milestone unlock.        |
| `cancel_stream`      | Creator-only single-leaf cancel: vested → beneficiary, rest → creator. Milestone-aware: released → full amount, unreleased → 0. |

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
pnpm test:localnet     # persistent validator — 86/86 passing (~3m)
pnpm test:devnet       # against devnet RPC (deployed program + funded wallet)
```

Clock-dependent tests (11) use `solana-bankrun` inside the full suite; they are included in `pnpm test:localnet` and do not need a separate run.

## Frontend (apps/web)

Next.js 15 dApp with wallet integration, vesting stream creation, and token claiming.

```bash
cd apps/web
cp .env.example .env   # fill in your keys (or symlink ../../.env)
pnpm dev               # http://localhost:3000

# Vitest — API tests need Postgres (see docs/TESTING.md)
export DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/ci
pnpm db:push && pnpm test
```

### Pages

- `/` — Landing page
- `/campaign/create` — Create a vesting stream (calls `createStream`)
- `/campaign/[treeAddress]` — View stream & claim tokens (calls `withdraw`)

Wallet connection uses wallet-standard auto-detect (Phantom/Solflare/Backpack). Set `NEXT_PUBLIC_RPC_ENDPOINT` to override the default devnet RPC.

### Backend API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/campaigns` | POST | Create campaign + root version + leaves |
| `/api/campaigns` | GET | List with filters, pagination |
| `/api/campaigns/[treeAddress]` | GET | Campaign detail + analytics |
| `/api/campaigns/[treeAddress]/proof` | GET | Leaf + merkle proof for beneficiary |
| `/api/campaigns/[treeAddress]/claims` | GET | Claim history |
| `/api/campaigns/[treeAddress]/root-versions` | GET | Root version history |
| `/api/beneficiary/[address]/campaigns` | GET | All campaigns for address |
| `/api/admin/sync` | POST | Indexer: backfill claim events (auth: x-admin-key) |

All routes deployed at [velthoryn.vercel.app](https://velthoryn.vercel.app/). Supabase tables have Row Level Security enabled (read-public, write-service-role).

See [`docs/BACKEND_API.md`](docs/BACKEND_API.md) for full API documentation.

### Vercel Deployment

Deployed at [velthoryn.vercel.app](https://velthoryn.vercel.app/). Root directory: `apps/web/`. Required env vars: see `apps/web/.env.example`.

Frontend docs: [`docs/PRD_GERAL.md`](docs/PRD_GERAL.md), [`docs/PDD_GERAL.md`](docs/PDD_GERAL.md), [`docs/TDD_GERAL.md`](docs/TDD_GERAL.md), [`docs/SECURITY_GERAL.md`](docs/SECURITY_GERAL.md).

## Devnet

Program is deployed at `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`. Latest upgrade at slot **463874212** (~447KB allocation). Upgrade authority: wallet `GPfHeZtBna1rJmwam1yCcREhYnLcxWhBmUdDoVuL5Es6`.

```bash
solana program show G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu --url devnet
```

To redeploy, the signing keypair must match `declare_id!` (`G6iaig…`). If `target/deploy/vesting-keypair.json` was generated locally with a different pubkey, use `solana program deploy` with the upgrade-authority wallet instead of `anchor deploy` (see [`docs/DEVNET_TEST_RESULTS.md`](docs/DEVNET_TEST_RESULTS.md)).

```bash
solana config set --url devnet
anchor build
solana program deploy target/deploy/vesting.so --program-id G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu
```

## CI

| Workflow | What it runs |
|----------|----------------|
| [`ci.yml`](.github/workflows/ci.yml) | `anchor build` + IDL drift check + `pnpm test:localnet` (86 SC tests) |
| [`lint.yml`](.github/workflows/lint.yml) | `cargo clippy`, Next.js lint, **Vitest + build** (Postgres 15 service + `drizzle-kit push`) |
| [`web-ci.yml`](.github/workflows/web-ci.yml) | 3 parallel jobs: merkle parity, E2E pipeline (Postgres + dev server + `test-be-merkle-pipeline.ts`), web build + Vitest (Postgres) |

All web jobs use `DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/ci` and host-aware SSL (TLS for Supabase, plain TCP for local CI Postgres).

## License

MIT — see `LICENSE`.