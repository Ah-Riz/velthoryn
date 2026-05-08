# Weekly Report — Geral (Week 3)

## What I built this week

**AC #7 — Partner build verification.** Cloned from zero on WSL/Ubuntu, built and deployed to localnet in ~20 minutes. `anchor test` green — 1 passing. CI green on PR.

Surfaced and fixed the following gaps during verification:

1. README missing Solana CLI install command
2. README missing Anchor/avm install steps (listed `avm use` but not how to install avm)
3. Node version not pinned — CI uses 20, README said "≥ 20" — pinned to ≥ 20.10
4. pnpm install order unclear for new devs
5. Keypair generation + devnet airdrop steps missing entirely
6. Placeholder program ID `Vest111...` breaks first `anchor build` with "String is the wrong size" — added sync step
7. `ts-mocha` and test dependencies not in `package.json` — `anchor test` fails immediately on fresh clone
8. Root `tsconfig.json` missing — TypeScript compilation error
9. `tests/` directory empty — added smoke test

**CI improvement — DevOps layer.** Added `.github/workflows/lint.yml`:
- Separate from Lana's `ci.yml` to avoid merge conflict — no file collision on PR
- Lint job: `cargo fmt --all -- --check` + `cargo clippy --workspace -D warnings`
- Uses `Swatinem/rust-cache@v2` consistent with Lana's build workflow
- Explicit allow for Anchor macro false-positives (`unexpected_cfgs`, `unused_imports`)

**Frontend scaffold — `apps/web/`.** 17-file Next.js 15 scaffold matching Week 2 architecture decisions:
- Next.js 15 App Router + React 19 + Tailwind v4
- `WalletProvider`: wallet standard auto-detection (Phantom/Solflare/Backpack)
- `QueryProvider`: TanStack Query v5
- `lib/merkle/builder.ts`: `merkletreejs` + keccak256 with `LEAF_PREFIX=0x00`/`NODE_PREFIX=0x01` byte tags (anti second-preimage, matches Jito distributor pattern from Week 2 arch doc)
- `lib/anchor/client.ts`: `derivePda()` helper + PROGRAM_ID binding
- Zustand store for client state (separate from chain state per arch trade-off)
- Route scaffold: `/` (landing), `/campaign/create` (sender), `/campaign/[id]` (recipient)
- Vitest config + Day-1 Week-3 test gate: TS keccak byte-equal test against Rust golden hex (4 passing; 5th gate test skips until Lana provides Rust golden hex)

## How we split the work

| Area | Owner |
|------|-------|
| AC 1–6: program init, instruction stubs, account structs, CI build/test | Lana |
| AC 7: partner verification | Geral |
| README fixes (9 commits, each gap = 1 commit) | Geral |
| `.github/workflows/lint.yml` (separate from Lana's ci.yml) | Geral |
| `apps/web/` Next.js scaffold (17 files) | Geral |
| Merkle builder + Week 3 byte-equal test gate | Geral |

## Blockers / insights

**Windows native is not viable for Solana/Anchor development** — WSL is required. README should mention this explicitly for new contributors.

**Biggest friction point:** placeholder program ID (`Vest111...`) + zero test dependencies in `package.json` = 5+ blocking errors before a new contributor's first successful `anchor test`. The README assumed prior Solana toolchain knowledge rather than being self-contained for a fresh setup. This is the kind of gap that kills contributor onboarding.

**On the Merkle test gate:** `keccak256(LEAF_PREFIX || encodedLeaf)` in TypeScript must produce byte-equal output to Lana's Rust `leaf_hash()`. This is not optional — if it drifts, every single claim in production fails Merkle proof verification. The test is structured so it becomes active the moment Lana runs `cargo test -- --nocapture` and pastes the hex. Deliberately left as `skipIf(null)` rather than a stub so the gate is real and can't be accidentally passed.

**Why `wallets=[]` in WalletProvider:** `@solana/wallet-adapter-wallets` bundles 40+ adapters including several with React 16/17 peer requirements. React 19 + that package = dependency chaos. Phantom, Solflare, and Backpack all implement the wallet standard protocol so the adapter library is unnecessary — they auto-detect.

After all fixes applied, clone-to-test-pass on a fresh WSL machine: ~20 minutes including tool installation.
