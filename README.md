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

**Fully implemented and deployed to devnet.** All **18** instruction handlers (14 SPL + 3 native SOL + `instant_refund_campaign`), schedule math (`vested`, `get_vested_amount`), and Merkle proof verification (`verify_merkle_proof`) are live with real logic. State structs, error codes (**42** variants), and events (**12** types, including `InstantRefunded`) are fully defined. `leaf_hash()` is byte-verified against the TS encoder. Native SOL vesting supports campaigns in raw SOL without wrapping to wSOL — see [`docs/NATIVE_SOL_VESTING.md`](docs/NATIVE_SOL_VESTING.md).

**Instant refund (B1):** Creator-only immediate refund for **unstarted multi-leaf** campaigns (`now < min_cliff_time`, no milestones released). Single-leaf campaigns still use `cancel_stream`; started campaigns use `cancel_campaign` (7-day grace). BE exposes `instantRefundEligible` and `POST .../instant-refund` tx builder — see [`docs/BACKEND_API.md`](docs/BACKEND_API.md).

**Week 8 bug sweep:** 15 bugs found and fixed across SC/BE/FE layers. **L1/P0 fixes (8):** root rotation `minCliffTime`, API auth on root-versions + campaign creation, base58 validation, race condition 409, migration 0010, PDA seed docs. **QA sweep (7):** (1) out-of-order milestone claiming bug in frontend — greedy `claimedAmount` allocation replaced with on-chain `milestoneBitmap` lookup; (2) `StreamExpired` early-return blocked multi-leaf claims; (3) `total_entitled` now accumulates across milestone claims; (4–5) backend validation added for `milestoneIdx` bounds (0–255) and duplicate `(beneficiary, milestoneIdx)` pairs; (6–7) VestingProgress API checks milestone release flags, MilestoneReleasePanel uses actual milestone indices from leaves. See [`docs/WEEK8_KNOWN_ISSUES.md`](docs/WEEK8_KNOWN_ISSUES.md).

**F1–F4 roadmap complete and implemented:** F1 Bulk Send (server-side Merkle build, CSV import), F2 Transparency Dashboard (dashboard rewrite with 6 stat cards + claimable banner + vesting progress + activity feed, portfolio page with per-campaign breakdown + sort, `/api/activity/[address]` cross-campaign feed, `useMintDecimals` for real token amounts), F3 Clawback (cancel campaign/stream, withdraw unvested, milestone release + `CampaignStatusBanner` 7-state banner, `GracePeriodCountdown`, sidebar amber dot badge, "Needs Action" tab, dashboard "Needs Attention" section), F4 Production Hardening (Sentry monitoring, API versioning, vesting simulation, schedule templates). 12 new API routes, 6 event tables, 15 bug fixes from code review.

**Week 8 gap closure (BE/infra):** k6 load scripts (`apps/web/tests/load/` — prepare, proof, spike + `run-load-test.sh`); rate-limit baselines in [`docs/TESTING.md`](docs/TESTING.md) §k6; CU budget re-audit in [`docs/CU_BUDGET.md`](docs/CU_BUDGET.md); **Known Issue #29 — fixed on-chain** (2026-06-16): `ClaimRecord` is now `#[account(zero_copy)]` with a per-leaf ledger (`leaf_claimed_idx`/`leaf_claimed_amt`, `PER_LEAF_CAP = 8`) so a beneficiary with multiple cliff/linear leaves is paid each in full. The BE guards (prepare + import reject multi cliff/linear per beneficiary) remain until a follow-up post-deploy PR removes them — see [`docs/KNOWN_ISSUE_29_DESIGN.md`](docs/KNOWN_ISSUE_29_DESIGN.md) + ADR-003 (superseded).

**Week 8 FE cleanup:** Shared UI primitives extracted (`StatCard`, `ProgressBar`, `CampaignCard`, `SectionHeader`, `FieldRow`, `DetailRow`, `Spinner`, `RecipientListModal`). Centralized `lib/api/serialize.ts` for BigInt-safe JSON. Numbered migrations `0002`–`0005` backfill event-table history. Post-tx indexing uses public `POST /api/events/sync`; operator backfill uses admin-only `POST /api/claims/sync`. E2E helpers support mock wallet + mock send-tx for cancel flows without devnet RPC.

**Week 9 detection + hardening:** a systematic detect → triage → fix → docs pass across SC / MERKLE / BE / DB. **5 code fixes applied + verified** (`BE-SEC-01` campaign-POST wallet auth, `BE-SEC-06` cron timing-safe compare, `BE-SEC-05` rate-limit resilience, `SC-FIND-02` native-SOL rent preservation, `SC-FIND-03` withdraw guard); 7 findings documented with rationale; Merkle surface independently audited (**sound**). New integrator docs in [`docs/week9/`](docs/week9/) — see "deeper reads" below. Regression: SC **126/0/19** (was 125/0/19; +1 Issue #29 two-leaf regression test), BE **565/565** + typecheck BE-clean. Full finding list: [`docs/week9/BUG_LIST.md`](docs/week9/BUG_LIST.md).

**Campaign-level schedule (cliff/linear):** recipients with different amounts (e.g. 0.5 SOL vs 1 SOL) now unlock at the same instant. The schedule (Start/Cliff/End for linear, Start/Cliff for cliff) is **campaign-level** — one shared schedule stamped on every leaf — instead of per-recipient. The on-chain schedule math was already correct; the fix is FE-only: the create flow (Manual + CSV) and the linear/cliff CSV templates now carry wallet + amount per recipient and one schedule per campaign. Milestone leaves keep their per-row unlock times. **No on-chain, prepare-route, or client-SDK changes.** Regression tests in `apps/web/tests/lib/bulk-campaign.test.ts` cover the 0.5-vs-1-SOL identical-schedule guarantee and milestone isolation.

**Test results: 127+ SC tests PASS** (`pnpm test:localnet`); **572 web Vitest PASS** (API routes use Postgres in CI)
**BE–SC Merkle pipeline verified end-to-end**: 3-leaf campaigns (Cliff/Linear/Milestone) through prepare → POST (all leaves verified) → GET proof → verify. RLS on all Supabase tables. **Bootcamp acceptance: 8/8** — see [`docs/BE-SC-MERKLE-ACCEPTANCE-STATUS.md`](docs/BE-SC-MERKLE-ACCEPTANCE-STATUS.md).
- Devnet + bankrun (`pnpm test:devnet`): **98 passing, 1 pending** — live breakdown in [`docs/DEVNET_TEST_RESULTS.md`](docs/DEVNET_TEST_RESULTS.md) (devnet RPC 75 + bankrun 24; T68 pending on RPC, covered by clock suite)
- Native SOL tests: `tests/vesting-native-sol.spec.ts` via **solana-bankrun** (12 tests covering full SOL lifecycle)
- Clock-dependent cases: `tests/vesting.clock.spec.ts` via **solana-bankrun** (T17–T20, T25, T47, T55–T64, EXPLOIT 4)
- Sealevel-attacks gap tests: `tests/sealevel-attacks-gap.spec.ts` via **solana-bankrun** (4 tests: duplicate accounts #6, PDA sharing #8, close-reinit #9)
- LiteSVM PoC: `tests/vesting-litesvm.spec.ts` via **LiteSVM** (5 tests: boot, mint, time-travel, program loading, simulation)
- Mollusk instruction tests: 8 domain-specific test files via **Mollusk** (73 active + 18 ignored): `instructions.rs` (14), `stream.rs` (7), `admin.rs` (18+6), `cancel.rs` (5+9), `claim.rs` (17), `cleanup.rs` (2+3), `lifecycle.rs` (8), `withdraw_unvested.rs` (3)
- Mollusk CU benchmarks: `programs/vesting/tests/benchmarks.rs` via **Mollusk** (10 active + 1 ignored; see [`docs/CU_BUDGET.md`](docs/CU_BUDGET.md))
- proptest property tests: `programs/vesting/src/math/{schedule,merkle}.rs` via **proptest** (18 property invariants: schedule 10 + merkle 8; plus 24 standalone unit tests)

See [`docs/STREAM_MODEL.md`](docs/STREAM_MODEL.md) (tutorial `Stream` PDA vs campaign model) and [`docs/ERROR_MAP.md`](docs/ERROR_MAP.md).

| Instruction              | Role                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| `create_campaign`        | Initialize a vesting tree (Merkle root, supply, authorities).     |
| `create_campaign_native` | Same for native SOL — PDA holds lamports directly, no vault ATA.  |
| `create_stream`          | Atomic single-recipient campaign creation + SPL funding in one tx. |
| `create_stream_native`   | Same for native SOL — `system_program::transfer` funds the PDA.   |
| `fund_campaign`          | Creator deposits SPL tokens into the campaign vault.              |
| `fund_campaign_native`   | Same for native SOL — SOL transfer to PDA via system CPI.         |
| `claim`                  | Recipient claims vested portion against a Merkle proof (SPL + SOL). |
| `withdraw`               | Simplified claim for single-recipient streams (SPL + SOL).        |
| `cancel_campaign`        | Cancel authority freezes the curve and starts a 7-day grace.      |
| `update_root`            | Rotate the Merkle root to add/remove/adjust recipients.           |
| `withdraw_unvested`      | Creator sweeps unvested tokens after the grace window (SPL + SOL). |
| `pause_campaign`         | Temporarily block claims.                                         |
| `unpause_campaign`       | Resume a paused campaign.                                         |
| `close_claim_record`     | Reclaim rent on a fully-claimed `ClaimRecord` PDA.                |
| `get_vested_amount`      | Read-only helper that runs the schedule math against a leaf.      |
| `set_milestone_released` | Creator sets a milestone flag before milestone unlock.        |
| `cancel_stream`          | Creator-only single-leaf cancel: vested → beneficiary, rest → creator (SPL + SOL). Milestone-aware. |
| `instant_refund_campaign` | Creator-only instant refund for unstarted multi-leaf campaigns; drains vault/PDA to creator. |

Full doc index: [`docs/README.md`](docs/README.md).

For deeper reads:
- [`docs/PROGRAM.md`](docs/PROGRAM.md) — program internals, file map, instruction surface, state layouts.
- [`docs/INTEGRATION.md`](docs/INTEGRATION.md) — frontend-track guide: program ID, IDL/types location, PDA derivations, Merkle helpers, sample calls.
- [`docs/FE_INTEGRATION.md`](docs/FE_INTEGRATION.md) — complete FE developer guide: flows, file map, events, error handling.
- [`docs/NATIVE_SOL_VESTING.md`](docs/NATIVE_SOL_VESTING.md) — native SOL vesting research: architecture, dual-path design, cost comparison, security considerations.
- [`docs/TESTING.md`](docs/TESTING.md) — how to run tests, k6 load testing, SC benchmarks, CI matrix, clock/native SOL tests.
- [`docs/DEVNET_TEST_RESULTS.md`](docs/DEVNET_TEST_RESULTS.md) — full test results matrix with acceptance criteria.
- [`docs/API_TRUST_BOUNDARIES.md`](docs/API_TRUST_BOUNDARIES.md) — every API route: public / wallet-auth / admin classification.
- [`docs/PENDING_WORK.md`](docs/PENDING_WORK.md) — prioritized backlog from spec audit (updated as items land).
- [`docs/KNOWN_ISSUE_29_DESIGN.md`](docs/KNOWN_ISSUE_29_DESIGN.md) — multi-leaf `claimed_amount` undercount — ✅ **fixed on-chain** 2026-06-16 (per-leaf ledger; ADR-003 superseded).
- [`docs/week9/INSTRUCTION_REFERENCE.md`](docs/week9/INSTRUCTION_REFERENCE.md) — **every instruction**: accounts + constraints, args, behavior, full error-code table (6000–6041), events, TS examples.
- [`docs/week9/INTEGRATION_GUIDE.md`](docs/week9/INTEGRATION_GUIDE.md) — end-to-end creator + beneficiary walkthrough (prepare → create → fund → register → claim) with runnable TS snippets; SPL + native SOL.
- [`docs/week9/ADRs/`](docs/week9/ADRs/) — Merkle-compressed vesting, keccak-256 + domain separation, Issue #29 on-chain fix (ADR-003, superseded — shipped).
- [`docs/week9/BUG_LIST.md`](docs/week9/BUG_LIST.md) — Week 9 detection findings, fixes applied, and documented limitations.
- [`docs/week9/FE_DOCUMENTATION_REVIEW.md`](docs/week9/FE_DOCUMENTATION_REVIEW.md) — FE-perspective review of instruction reference + integration guide; 4 FE ADRs; FE-SC interface matrix; error code coverage (6000–6041).
- [`docs/week9/FE_TESTING_STATUS.md`](docs/week9/FE_TESTING_STATUS.md) — FE test suite status: Vitest 572/572, E2E 23 chromium specs + 10 signing specs, CI pipeline status.
- [`docs/week9/FE_ARCHITECTURE.md`](docs/week9/FE_ARCHITECTURE.md) — FE tech stack, directory structure, data flow, state management, wallet integration, 8-state lifecycle, env vars.
- [`docs/week9/FE_COMPONENT_REFERENCE.md`](docs/week9/FE_COMPONENT_REFERENCE.md) — all 68 FE components with props, purpose, and usage context.
- [`docs/week9/FE_BUG_LOG.md`](docs/week9/FE_BUG_LOG.md) — 15 FE bugs (FE-BUG-01 to FE-BUG-15): root cause, fix status, prevention.
- [`docs/week9/FE_E2E_GUIDE.md`](docs/week9/FE_E2E_GUIDE.md) — E2E quick start, mock wallet architecture, env setup, writing tests, debugging, CI.
- [`docs/FE_CHANGELOG.md`](docs/FE_CHANGELOG.md) — per-week FE changelog (Week 3–9) based on actual commit diffs.

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

> The program ID is hardcoded in `Anchor.toml` and `programs/vesting/src/lib.rs` (`G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`). To run the integration tests locally you need the matching program keypair — see [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md) for the full explanation and workarounds. CI runs the full suite on every push using the `PROGRAM_KEYPAIR_JSON` secret.

```bash
anchor build           # produces target/idl/vesting.json + target/types/vesting.ts
pnpm test:localnet     # persistent validator — 127+ passing (~4m)
pnpm test:devnet       # against devnet RPC (deployed program + funded wallet)
```

Clock-dependent tests (11) use `solana-bankrun` inside the full suite; they are included in `pnpm test:localnet` and do not need a separate run. Sealevel-attacks gap tests (4) and LiteSVM PoC (5) are also included in the full suite.

For Rust-level CU benchmarks via Mollusk:
```bash
BPF_OUT_DIR=target/deploy cargo test --manifest-path programs/vesting/Cargo.toml --test benchmarks -- --show-output
# Expected: 10 passed, 1 ignored (bench_claim_native)
```

k6 load tests (from `apps/web/`):
```bash
./tests/load/run-load-test.sh prepare
CAMPAIGN_ADDRESS=... BENEFICIARY_ADDRESS=... ./tests/load/run-load-test.sh proof
./tests/load/run-load-test.sh all
```

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

> **Database schema:** Use `pnpm db:push` for local dev (fast sync, no migration files). Use `pnpm db:migrate` for CI and production — it applies numbered files under `src/lib/db/migrations/` in order. After schema changes, run `pnpm db:generate`, commit the migration, then `pnpm db:migrate` against the target database.

### Pages

- `/` — Landing page
- `/dashboard` — Transparency dashboard: 6 stat cards, claimable banner, vesting progress, recent activity feed, needs attention alerts (F2)
- `/portfolio` — Per-campaign vesting breakdown: progress bars, sort by claimable/progress/next unlock, summary stats (F2)
- `/campaign/create` — Create a vesting stream (calls `createStream`)
- `/campaign/[treeAddress]` — View stream & claim tokens (calls `withdraw`), campaign status banner, grace period countdown, milestone release panel

Wallet connection uses wallet-standard auto-detect (Phantom/Solflare/Backpack). Set `NEXT_PUBLIC_RPC_ENDPOINT` to override the default devnet RPC.

### Shared UI components

Reusable primitives under `apps/web/src/components/ui/`:

| Component | Used by |
|-----------|---------|
| `StatCard` | Dashboard, portfolio, campaign detail |
| `ProgressBar` | Portfolio `CampaignCard`, campaign detail, vesting progress |
| `SectionHeader`, `FieldRow`, `DetailRow` | Campaign detail page |
| `Spinner` | Loading states across campaign flows |
| `CampaignCard` | Dashboard vesting cards, portfolio list (`toCampaignCardData` adapter) |
| `RecipientListModal` | Campaign detail recipient table |

### Backend API Routes

Auth tiers: **Public** (read + stateless helpers), **Wallet** (ed25519 signature via `Authorization`), **Admin** (`x-admin-key` or cron bearer). See [`docs/API_TRUST_BOUNDARIES.md`](docs/API_TRUST_BOUNDARIES.md) for the full route table.

| Route | Method | Purpose | Auth |
|---|---|---|---|
| `/api/campaigns` | POST | Create campaign + root version + leaves | Wallet |
| `/api/campaigns` | GET | List with filters, pagination | Public |
| `/api/campaigns/[treeAddress]` | GET | Campaign detail + analytics | Public |
| `/api/campaigns/[treeAddress]/proof` | GET | Leaf + merkle proof for beneficiary | Public |
| `/api/campaigns/[treeAddress]/claims` | GET | Claim history | Public |
| `/api/campaigns/[treeAddress]/root-versions` | POST | Record root version after on-chain `update_root` | Wallet |
| `/api/beneficiary/[address]/campaigns` | GET | All campaigns for address | Public |
| `/api/activity/[address]` | GET | Cross-campaign activity feed (F2) | Public |
| `/api/events/sync` | POST | Index on-chain events from tx signatures (post-claim UI) | Public |
| `/api/claims/sync` | POST | Operator claim-event backfill | Admin |
| `/api/admin/sync` | POST | Full indexer run | Admin |
| `/api/campaigns/prepare` | POST | Build Merkle tree server-side; returns `minCliffTime` (F1) | Public |
| `/api/campaigns/[treeAddress]/instant-refund` | POST | Instant refund tx for unstarted multi-leaf campaigns | Wallet |
| `/api/campaigns/import` | POST | CSV import of beneficiaries (F1) | Wallet |
| `/api/campaigns/[treeAddress]/timeline` | GET | Event timeline — cancel, pause, withdraw, milestone (F2) | Public |
| `/api/beneficiary/[address]/vesting-progress` | GET | Vesting progress for beneficiary (F2) | Public |
| `/api/cron/sync` | GET | Auto-sync cron — indexer event processing (F2, daily on Hobby) | Admin |
| `/api/campaigns/[treeAddress]/cancel` | POST | Cancel campaign, start grace period (F3) | Wallet |
| `/api/campaigns/[treeAddress]/withdraw-unvested` | POST | Withdraw unvested tokens after grace (F3) | Wallet |
| `/api/campaigns/[treeAddress]/cancel-stream` | POST | Cancel single stream (F3) | Wallet |
| `/api/campaigns/[treeAddress]/milestones/[idx]` | POST | Release milestone flag (F3) | Wallet |
| `/api/simulate-vesting` | POST | Vesting simulation — linear/cliff/milestone (F4) | Public |
| `/api/schedule-templates` | GET | Schedule presets — common vesting templates (F4) | Public |

All routes deployed at [velthoryn.vercel.app](https://velthoryn.vercel.app/). Supabase tables have Row Level Security enabled (read-public, write-service-role).

See [`docs/BACKEND_API.md`](docs/BACKEND_API.md) for request/response shapes and data flows.

### Vercel Deployment

Deployed at [velthoryn.vercel.app](https://velthoryn.vercel.app/). The Vercel project imports this repo
(`Ah-Riz/mancerxsuperteam-token-vesting`) via the native GitHub integration, with **Root Directory
`apps/web/`** and Framework Preset **Next.js**. Production Branch: `main`. Required env vars: see
`apps/web/.env.example` — these must be set on the Vercel project for the app to *function* (not just build).

**Quick redeploy (dashboard):** If the site returns `404: NOT_FOUND / DEPLOYMENT_NOT_FOUND`, the
production deployment is missing. In vercel.com → the `velthoryn` project → confirm Root Directory
`apps/web/`, Git integration connected to this repo, and `velthoryn.vercel.app` assigned under
Domains → then Deployments → most recent **Ready** → ⋯ → **Redeploy**. (Equivalent trigger: push an
empty commit to `main`.) If the project itself is gone, recreate it: New Project → import this repo →
Root Directory `apps/web/` → add the env vars → Deploy → assign the domain.

**Redeploy from the terminal (one-liner):** after a one-time `pnpm vercel:link` (links `apps/web/` to
the existing Vercel project and writes the committed `apps/web/.vercel/project.json`), run:

```bash
pnpm deploy:web   # = vercel deploy --prod --cwd apps/web
```

> The `apps/web/.vercel/project.json` link contains project/org IDs only (no secrets); secrets stay in
> the Vercel dashboard.

**Production database:** Do not run `db:push` against production. Apply schema changes with `pnpm db:migrate` (from `apps/web/`, with production `DATABASE_URL` set) after merging migration files. CI (`lint.yml`, `web-ci.yml`) uses `db:migrate` the same way. Local development may still use `db:push` for speed.

Frontend docs: [`docs/PRD_GERAL.md`](docs/PRD_GERAL.md), [`docs/PDD_GERAL.md`](docs/PDD_GERAL.md), [`docs/TDD_GERAL.md`](docs/TDD_GERAL.md), [`docs/SECURITY_GERAL.md`](docs/SECURITY_GERAL.md). Feature docs: [`docs/TRANSPARENCY_DASHBOARD.md`](docs/TRANSPARENCY_DASHBOARD.md), [`docs/AUTOMATIC_CLAWBACK.md`](docs/AUTOMATIC_CLAWBACK.md).

## Devnet

Program is deployed at `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`. Latest upgrade at slot **464782646** (~492KB allocation). Upgrade authority: wallet `GPfHeZtBna1rJmwam1yCcREhYnLcxWhBmUdDoVuL5Es6`.

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
| [`ci.yml`](.github/workflows/ci.yml) | `anchor build` + IDL drift check + native SOL tests (bankrun) + `pnpm test:localnet` (127+ SC tests) + sealevel-attacks gap tests (bankrun) + LiteSVM PoC |
| [`lint.yml`](.github/workflows/lint.yml) | `cargo clippy`, Next.js lint, **Vitest + build** (Postgres 15 service + `pnpm db:migrate`) |
| [`web-ci.yml`](.github/workflows/web-ci.yml) | 3 parallel jobs: merkle parity, E2E pipeline (Postgres + dev server + `test-be-merkle-pipeline.ts`), web build + Vitest (Postgres) |

All web jobs use `DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/ci` and host-aware SSL (TLS for Supabase, plain TCP for local CI Postgres).

## License

MIT — see `LICENSE`.