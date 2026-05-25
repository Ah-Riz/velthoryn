# BE–SC Merkle + Week 4 Acceptance Criteria — Status

**One place to remember:** what BE–SC Merkle delivered, how the bootcamp acceptance list maps to the code, and verification commands.

**Last updated:** 2026-05-25
**Branch / PR:** `dev_lana` → `test` — [PR #30](https://github.com/Ah-Riz/velthoryn/pull/30)  
**Deployed API:** [velthoryn.vercel.app](https://velthoryn.vercel.app) (redeploy after BE hardening merge)

---

## Part 1 — BE–SC Merkle pipeline (done)

| Phase | What | Status |
|-------|------|--------|
| 1 | Merkle parity — TS SDK vs `apps/web` builder | **13/13** (`scripts/test-merkle-parity.ts`) |
| 2 | DB schema — 4 tables + indexes on Supabase | **Done** |
| 3 | E2E — prepare → POST → GET proof → verify (3 release types) | **5/5** (`scripts/test-be-merkle-pipeline.ts`) |
| 4 | Local build + **98/98** SC tests (86 SPL + 12 native SOL) | **Pass** (`pnpm test:localnet`; keypair must match `G6iaig…`) |
| 4b | Devnet SC (`pnpm test:devnet`) | **93 pass, 9 pending** (T64–T68 bankrun-only) — upgrade slot **464782646** |
| 5 | Vercel deploy — 8 API routes | **Live** |
| 6 | Post-deploy E2E (`--url`, `--timeout`) | **Pass** (re-run after Vercel redeploy) |

**Security / CI (Week 5)**

- RLS on all Supabase tables
- **All leaves** verified on `POST /api/campaigns` and `POST .../root-versions` ([`lib/merkle/verify.ts`](../apps/web/src/lib/merkle/verify.ts))
- Drizzle `bigint` columns use `{ mode: "string" }` (no `Number()` truncation)
- `DATABASE_SSL_REJECT_UNAUTHORIZED=true` for strict production TLS (default `false` for CI/Supabase)
- `web-ci.yml` + `lint.yml` + `ci.yml`: Postgres 15, merkle parity, E2E pipeline, Vitest, IDL drift check
- `scripts/test-localnet.sh`: `CARGO_TARGET_DIR=target`, validator reset, `solana program deploy` to `G6iaig…`
- `scripts/test-devnet.sh`: `ts-mocha` on devnet RPC only (no `anchor test` redeploy to mismatched local keypair)

**How Merkle relates to vesting types**

- Parity + E2E use **Cliff, Linear, Milestone** leaves (`releaseType` 0 / 1 / 2) through `prepareCampaign` → API → on-chain `schedule.rs` math.
- BE proves **roots/proofs/leaves persist correctly**; SC proves **unlock math and cancel/withdraw** on-chain.

```bash
pnpm tsx scripts/test-merkle-parity.ts
pnpm tsx scripts/test-be-merkle-pipeline.ts --url https://velthoryn.vercel.app --timeout 120000
pnpm test:localnet   # 86/86 SC
```

More detail: [weekly-report-mancer/week5/Lana.md](../weekly-report-mancer/week5/Lana.md), [TESTING.md](./TESTING.md)

---

## Part 2 — Acceptance criteria (bootcamp checklist)

**SC baseline:** **86/86** pass — [DEVNET_TEST_RESULTS.md](./DEVNET_TEST_RESULTS.md)

Velthoryn ≠ tutorial `Stream` PDA. Single-recipient stream = `create_stream` + `withdraw` when `leaf_count == 1`. See [STREAM_MODEL.md](./STREAM_MODEL.md).

### Verdict table

| # | Criterion | Status | What we have |
|---|-----------|--------|--------------|
| 1 | **Cliff:** zero before cliff date; linear after | **Pass** | `schedule.rs`; T6, T17, T18, T41 |
| 2 | **Milestone:** unlock on **creator boolean flag**, not time | **Pass** | `set_milestone_released` + `milestone_released_flags` on `VestingTree`; claim/withdraw require flag; idempotency guard (`MilestoneAlreadyReleased`); T10, T11, T46, T63, T65 |
| 3 | **`cancel_stream`:** creator-only; unlocked → recipient, locked → creator | **Pass** | `cancel_stream` (single leaf); milestone-aware (released → full, unreleased → 0); OverClaim guard; T64, T64b, T64c, T64d |
| 4 | Cannot cancel already cancelled | **Pass** | `AlreadyCancelled` (6020); T35 |
| 5 | Cannot cancel after fully vested | **Pass** | `FullyVested` (6030); T60 |
| 6 | **Errors:** Unauthorized, AlreadyCancelled, FullyVested, NothingToWithdraw, StreamExpired | **Pass** | All mapped — see below |
| 7 | **Tests:** cliff times, milestone, cancel paths, errors | **Pass** | T60–T68 + existing matrix |
| 8 | All Week 4 tests still pass | **Pass** | **86/86** |

**Score for grader (literal checklist):** **8/8 fully met**, **0 partial**, **0 open gaps**.

### Error codes (checklist → Velthoryn)

| Checklist | Velthoryn | Code | Hex |
|-----------|-----------|------|-----|
| Unauthorized | `Unauthorized` | 6005 | `0x1775` |
| AlreadyCancelled | `AlreadyCancelled` | 6020 | `0x1784` |
| FullyVested | `FullyVested` | 6030 | `0x178e` |
| NothingToWithdraw | `NothingToClaim` | 6015 | `0x177f` |
| StreamExpired | `StreamExpired` | 6031 | `0x178f` |
| (milestone) | `MilestoneNotReleased` | 6032 | `0x1790` |
| (milestone) | `MilestoneAlreadyReleased` | 6033 | `0x1791` |

Source: [`programs/vesting/src/errors.rs`](../programs/vesting/src/errors.rs), [ERROR_MAP.md](./ERROR_MAP.md)

### Tests that cover each scenario

| Scenario | Test(s) | In checklist? |
|----------|---------|---------------|
| Cliff before / after | T6, T17, T18, T41 | Yes |
| Milestone creator flag | T10, T11, T46, T63 | Yes |
| `cancel_stream` one-tx split | T64, T64b, T64c, T64d | Yes |
| Cancel wrong user | T34 | Yes |
| Cancel twice | T35 | Yes |
| Cancel mid-stream (clamp) | T55 | Yes |
| Cancel before cliff | T62 | Yes |
| Cancel after full vest → error | T60 (`FullyVested`) | Yes |
| Withdraw after full claim / end | T61 (`StreamExpired`) | Yes |
| Withdraw > unlocked | T8, T23, T59 | Yes |

---

## Part 3 — Completed follow-ups

| Item | Status |
|------|--------|
| Verify all leaves on POST + root-versions | **Done** |
| u64 `{ mode: "string" }` in Drizzle | **Done** |
| Env-gated strict SSL | **Done** |
| `FullyVested` + `StreamExpired` + T60–T62 | **Done** |
| Milestone creator flag (`set_milestone_released`) | **Done** |
| `cancel_stream` instruction | **Done** |
| Milestone cancel_stream (released/unreleased paths) | **Done** (T64b–T64d) |
| `get_vested_amount` milestone flag gating | **Done** |
| `MilestoneAlreadyReleased` idempotency guard | **Done** (T65) |
| `cancel_stream` OverClaim guard | **Done** |

---

## Decision log

| Question | Your call | Date |
|----------|-----------|------|
| Grader: mapped design OK? | Superseded — literal 8/8 shipped | 2026-05-18 |
| Build `FullyVested`? | Yes | 2026-05-18 |
| Build milestone boolean flag? | Yes — `set_milestone_released` | 2026-05-18 |
| Build `StreamExpired`? | Yes | 2026-05-18 |
| Build `cancel_stream`? | Yes | 2026-05-18 |

---

## Quick commands

```bash
# SC — needs target/deploy/vesting-keypair.json matching G6iaig… (see README)
pnpm test:localnet

# BE–SC Merkle
pnpm tsx scripts/test-merkle-parity.ts
pnpm tsx scripts/test-be-merkle-pipeline.ts --url https://velthoryn.vercel.app --timeout 120000

# Web API (Postgres)
export DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/ci
cd apps/web && pnpm db:push && pnpm test
```
