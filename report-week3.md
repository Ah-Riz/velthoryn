# Weekly Report — Geral (Week 3)

## What I built this week

Executed partner-build verification for Week 3 foundation (AC #7). Cloned from zero on WSL/Ubuntu, built and deployed to localnet in ~20 minutes. `anchor test` green — 1 passing. CI green on PR #1.
    
Surfaced and fixed the following gaps:

1. README missing Solana CLI install command
2. README missing Anchor/avm install steps (only listed `avm use`, not how to install avm itself)
3. Node version not pinned (CI uses 20, README said "≥ 20" — pinned to ≥ 20.10)
4. pnpm install order unclear for new devs
5. Keypair generation + devnet airdrop steps missing entirely
6. Placeholder program ID `Vest111...` breaks first `anchor build` ("String is the wrong size") — added sync step
7. `ts-mocha` and test dependencies not in `package.json` — `anchor test` fails immediately
8. Root `tsconfig.json` missing — TypeScript compilation error
9. `tests/` directory empty — no test files, added smoke test

## How we split the work

Lana owned acceptance criteria 1–6 (project init, instruction stubs, account structs, README, CI). I owned criterion 7 (partner verification), README fixes, missing project config (`tsconfig.json`), and smoke test.

## Blockers / insights

Windows native is not viable for Solana/Anchor development — WSL is required. README should mention this explicitly. Biggest friction was the placeholder program ID combined with zero test dependencies in `package.json`. A new contributor would hit 5+ blocking errors before their first successful `anchor test`. The README assumed prior Solana toolchain knowledge rather than being self-contained for a fresh setup. After all fixes applied, clone-to-test-pass took ~20 minutes including tool installation.
