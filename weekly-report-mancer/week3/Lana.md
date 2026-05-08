# Weekly Report — Lana (Week 3)

## What I built this week

**AC 1–6: Full Anchor program scaffold, deployed to devnet.**

### Project initialization

Initialized the Anchor 1.0.0 workspace, configured `Anchor.toml` and the workspace `Cargo.toml`. Generated the program keypair, derived the deterministic program ID (`G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`), hardcoded it in `lib.rs` and `Anchor.toml`, and deployed to devnet at slot 460511260.

### Instruction stubs — 10 entry points (AC 2, extended from 3 required)

The task asks for `create_stream`, `withdraw`, `cancel`. Our Week 2 architecture specifies 10 instructions. I implemented all 10 up front rather than 3 placeholders — retrofitting the remaining 7 later would have forced Geral to rebase on top of structural changes mid-sprint.

All 10 compile and return `Ok(())`. Handlers dispatch via `lib.rs`:

| Instruction | File | Status |
|---|---|---|
| `create_campaign` | `instructions/create_campaign.rs` | Stub + full `CreateCampaignArgs` struct |
| `fund_campaign` | `instructions/fund_campaign.rs` | Stub |
| `claim` | `instructions/claim.rs` | Stub |
| `cancel_campaign` | `instructions/cancel_campaign.rs` | Stub |
| `update_root` | `instructions/update_root.rs` | Stub |
| `withdraw_unvested` | `instructions/withdraw_unvested.rs` | Stub |
| `pause_campaign` | `instructions/pause_campaign.rs` | Stub (shares context with `unpause_campaign`) |
| `unpause_campaign` | `instructions/pause_campaign.rs` | Stub |
| `close_claim_record` | `instructions/close_claim_record.rs` | Stub |
| `get_vested_amount` | `instructions/get_vested_amount.rs` | Stub — returns `Ok(u64)` not `Ok(())` |

### Account structs (AC 3)

Three structs defined with correct Borsh wire order and `#[derive(InitSpace)]`:

- **`VestingTree`** — 16 fields, INIT_SPACE = 274 bytes (282 total with discriminator). Stores the Merkle root, campaign metadata, cancellation state, pause state, and authority pubkeys.
- **`ClaimRecord`** — 6 fields, INIT_SPACE = 113 bytes (121 total). Tracks per-beneficiary `claimed_amount` and `milestone_bitmap` ([u8; 32] = 256 bits for up to 255 milestones).
- **`VestingLeaf`** — 8 fields, 70-byte Borsh LE. Not an on-chain account — lives off-chain in the Merkle tree and gets passed as an instruction argument to `claim`.

`VestingError` enum: 28 typed error variants covering every failure path across all 10 instructions (Anchor codes 6000–6027).

9 event types in `events.rs`: `CampaignCreated`, `CampaignFunded`, `Claimed`, `CampaignCancelled`, `RootUpdated`, `UnvestedWithdrawn`, `CampaignPaused`, `CampaignUnpaused`, `ClaimRecordClosed`.

### `leaf_hash()` — live implementation

`math/merkle.rs::leaf_hash()` is the only non-stub piece of logic I shipped this week, and it was intentional. The Merkle hash function is the protocol's single most critical cross-language compatibility point — if Rust and TypeScript produce different bytes, every single `claim` in production fails `InvalidProof`. I wanted this locked and golden-vector-tested before Week 4 began.

Implementation:
```
leaf_hash(leaf) = keccak256([LEAF_PREFIX=0x00] || borsh::to_vec(leaf))
```

Uses `solana_keccak_hasher::hashv`. Includes a `golden_leaf_hex` unit test that prints `RUST_GOLDEN_HEX=<hex>` when run with `-- --nocapture`. Geral's TS encoder compares against this hex — as of end of Week 3, byte equality is confirmed.

`verify_merkle_proof` is intentionally stubbed (`return false`) — the full algorithm is specified in `TDD_LANA.md §2.6` and lands Week 4.

### CI pipeline (AC 6)

`.github/workflows/ci.yml` runs on every push and pull request:

1. Installs Rust stable
2. Installs Solana CLI 2.1.6 (with `~/.cache/solana` pre-created — without this, `cargo-build-sbf` panics on a fresh runner before downloading platform tools)
3. Caches Solana platform tools via `actions/cache@v4`
4. Installs Anchor CLI 1.0.0 via `avm`
5. Installs `surfpool` (the Anchor 1.0 local validator — replaces `solana-test-validator`)
6. Writes `PROGRAM_KEYPAIR_JSON` secret to `target/deploy/vesting-keypair.json`
7. `anchor build` → `anchor test`

Two non-obvious CI problems I had to solve:
- `~/.cache/solana` must exist before the platform tools step or `cargo-build-sbf` panics at startup reading the dir. Fixed with `mkdir -p ~/.cache/solana`.
- `AnchorProvider.env()` reads `~/.config/solana/id.json` at test startup. On a fresh runner this file doesn't exist. Fixed by generating a throwaway keypair in the install step.

### Tests (AC 5)

Two passing tests in `tests/vesting.spec.ts`:
1. Program loads with the correct program ID.
2. IDL exposes all 10 architecture instructions by camelCase name.

These are deliberately minimal — they verify the scaffold compiles, deploys, and is structurally correct, not that instruction logic works (that's Week 4).

### README (AC 4)

Initial README covered: prerequisites, quickstart (clone → build → test), devnet deploy command, CI summary. Geral found 9 gaps during partner verification and patched them — see his report.

---

## How we split the work

| Area | Owner |
|---|---|
| AC 1–6: program init, instruction stubs, account structs, error codes, events, `leaf_hash()`, CI (`ci.yml`), devnet deploy | Lana |
| AC 7: partner build verification | Geral |
| README: 9 gap patches (WSL note, avm install, keypair gen, devnet airdrop, sync step, test deps, tsconfig, smoke test) | Geral |
| `.github/workflows/lint.yml` (clippy, separate file to avoid merge conflict) | Geral |
| `apps/web/` — Next.js 15 scaffold, wallet adapter, TanStack Query, Zustand, route structure | Geral |
| `apps/web/src/lib/merkle/builder.ts` — TS Merkle encoder + byte-equal test gate against `RUST_GOLDEN_HEX` | Geral |

---

## Blockers and insights

**Anchor 1.0.0 is a very fresh release.** The stable ecosystem documentation mostly covers 0.29–0.30. A few things changed in 1.0: `borsh::to_vec()` replaces `try_to_vec()`, `anchor-spl` must be added manually (it's no longer bundled), and `surfpool` replaces `solana-test-validator` as the default local validator. I had to read the Anchor 1.0 changelog and the surfpool README rather than existing tutorials.

**`PROGRAM_KEYPAIR_JSON` secret is load-bearing for CI.** The keypair file is not committed (security), so CI needs it injected as a secret. First push to the repo will fail until the repo owner adds this secret in Settings → Secrets → Actions. This is documented in the README but is easy to miss.

**Going to 10 stubs on Day 1 was the right call.** The task requires 3. I did 10. The reasoning: our Week 2 architecture is concrete — I know exactly what the remaining 7 instructions are. If I had shipped 3 stubs and Geral's scaffold imported the IDL expecting 10 instructions, his frontend would have compiled against an incomplete IDL. Starting from the complete surface meant his test gate could immediately assert `program.idl.instructions.length === 10`.

**`leaf_hash` is the highest-risk cross-language interface in the protocol.** Getting this right in Week 3 — and golden-vector testing it — means Week 4 claim tests can fail for the right reasons (schedule math, account constraints) not because the hash function diverged. Every hour invested here is insurance against a silent production failure.

**Blockers going into Week 4:** `anchor-spl` is not yet in `programs/vesting/Cargo.toml`. No instruction that touches tokens (`fund_campaign`, `claim`, `withdraw_unvested`) can compile without it. This is the first thing to add at the start of Week 4 before any SPL CPI work — `TDD_LANA.md §1` documents the exact dependency line and the `idl-build` feature gate.

---

## Status — What works and what doesn't

### Working

| Item | Evidence |
|---|---|
| `anchor build` exits 0 | CI green on every push |
| Program deployed on devnet | `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`, slot 460511260 |
| All 10 instruction stubs compile | IDL generated, all names present in `target/idl/vesting.json` |
| `VestingTree`, `ClaimRecord`, `VestingLeaf` structs | Correct Borsh wire order, `#[derive(InitSpace)]`, confirmed field sizes |
| `VestingError` (28 variants) | Anchor codes 6000–6027 covering all failure paths |
| 9 event types | Live in IDL, ready for `emit!()` calls in Week 4 |
| `leaf_hash()` | keccak256 implementation confirmed byte-identical to Geral's TS encoder |
| `golden_leaf_hex` test | Prints `RUST_GOLDEN_HEX=<hex>` — cross-language gate is active |
| CI (`ci.yml`) | `anchor build` + `anchor test` on every push and PR |
| 2 smoke tests | Program ID check + all 10 IDL instruction names verified |

### Incomplete (intentional stubs)

| Item | Status | Lands |
|---|---|---|
| `verify_merkle_proof` | Returns `false` unconditionally | Week 4 |
| `math::schedule::vested` | Returns `0` | Week 4 |
| `math::schedule::get_vested_amount` | Returns `0` | Week 4 |
| All 10 instruction handlers | Return `Ok(())` / `Ok(0)` — no state writes, no token CPIs | Week 4 |
| `anchor-spl` in `Cargo.toml` | Not added — no SPL CPI needed yet | Week 4 step 1 |

---

## Blockers — What's stuck or what you need

**`anchor-spl` missing — unblocks nothing in Week 3, blocks everything in Week 4.** The dependency must be added before the first token-touching instruction (`fund_campaign`, `claim`, `withdraw_unvested`) can compile. The exact crate line and `idl-build` feature gate are documented in `TDD_LANA.md §1`.

**`PROGRAM_KEYPAIR_JSON` GitHub secret.** CI fails on first push to a fork or new repo until this secret is set (Settings → Secrets → Actions). Not blocking us — our repo has it — but any external contributor will hit this immediately. Should be called out in the CONTRIBUTING section of the README.

**Geral's `RUST_GOLDEN_HEX` dependency — resolved.** Geral's TS keccak gate was gated on Lana running `cargo test -- --nocapture` and providing the hex. Done end of Week 3. The gate is active; any future drift in the hash function will fail the test immediately.

**No open questions from BD or Geral that block Week 4.** All 10 instruction signatures are locked in the IDL. Geral's frontend can import the IDL and call any instruction as soon as the stub is replaced.

---

## Metrics — Quantifiable progress

| Metric | Value |
|---|---|
| Rust source files created | 20 (`lib.rs`, `constants.rs`, `errors.rs`, `events.rs`, 3 state files, 2 math files, 11 instruction files) |
| Instruction entry points | 10 / 10 architecture instructions scaffolded |
| Account structs | 3 / 3 defined with correct field layout |
| Error variants | 28 defined (Anchor codes 6000–6027) |
| Event types | 9 defined |
| Live logic functions | 1 (`leaf_hash`) |
| Stub functions | 12 (`verify_merkle_proof`, `vested`, `get_vested_amount`, 9 instruction handlers) |
| Tests passing | 2 / 2 |
| CI workflows | 2 (`ci.yml` build+test, `lint.yml` clippy — Geral's addition) |
| Devnet programs deployed | 1 |
| VestingTree on-chain size | 282 bytes (274 INIT_SPACE + 8 discriminator) |
| ClaimRecord on-chain size | 121 bytes (113 INIT_SPACE + 8 discriminator) |
| VestingLeaf serialized size | 70 bytes (Borsh LE, off-chain) |
| Creator fixed setup cost | ~0.005 SOL for any campaign size |
| README gaps found + fixed | 9 (Geral's contribution, see his report) |
