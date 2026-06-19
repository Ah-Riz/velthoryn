# Week 9 Documentation — Velthoryn Token Vesting

> Team 7 (Mancer × Superteam) · Program ID: `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` (devnet)

## FE Documentation (Geral)

| Doc | What it covers |
|-----|----------------|
| [FE_ARCHITECTURE.md](FE_ARCHITECTURE.md) | Tech stack, dir structure, provider hierarchy, data flows, env vars, CI |
| [FE_INTEGRATION_GUIDE.md](FE_INTEGRATION_GUIDE.md) | Step-by-step: create campaign → claim tokens → admin ops (code-first) |
| [FE_HOOKS_REFERENCE.md](FE_HOOKS_REFERENCE.md) | All 21 hooks + tx-builder: params, return types, TanStack Query keys, snippets |
| [FE_COMPONENT_REFERENCE.md](FE_COMPONENT_REFERENCE.md) | All 68 components with props and usage examples |
| [FE_E2E_GUIDE.md](FE_E2E_GUIDE.md) | Playwright E2E setup, mock wallet bypass, writing new tests |
| [FE_TESTING_STATUS.md](FE_TESTING_STATUS.md) | Unit + E2E test coverage summary (572 unit / 33 E2E specs) |
| [FE_BUG_LOG.md](FE_BUG_LOG.md) | Known bugs, root causes, fix status |
| [FE_DOCUMENTATION_REVIEW.md](FE_DOCUMENTATION_REVIEW.md) | Cross-verification audit of FE docs vs SC layer |
| [ADRs/ADR-FE-001](ADRs/ADR-FE-001-shadcn-ui-adoption.md) | Why shadcn/ui |
| [ADRs/ADR-FE-002](ADRs/ADR-FE-002-e2e-mock-wallet-localStorage.md) | E2E mock wallet localStorage bypass |
| [ADRs/ADR-FE-003](ADRs/ADR-FE-003-campaign-lifecycle-8-state.md) | 8-state CampaignLifecycle type |
| [ADRs/ADR-FE-004](ADRs/ADR-FE-004-bankrun-warptoslot-before-setclock.md) | Bankrun warpToSlot ordering |
| [ADRs/ADR-FE-005](ADRs/ADR-FE-005-server-side-tx-building.md) | Server-side tx building (tx-builder.ts) |
| [ADRs/ADR-FE-006](ADRs/ADR-FE-006-manual-claim-instruction-idl-drift.md) | Manual claim instruction (devnet IDL drift workaround) |
| [ADRs/ADR-FE-007](ADRs/ADR-FE-007-cancel-instant-vs-grace-design.md) | Cancel design: instant settle vs grace period (leaf_count boundary) |

## SC Documentation (Lana)

| Doc | What it covers |
|-----|----------------|
| [INSTRUCTION_REFERENCE.md](INSTRUCTION_REFERENCE.md) | All 18 on-chain instructions (raw Anchor SDK) |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | SC-level integration guide (TypeScript Anchor SDK) |
| [ADRs/ADR-001](ADRs/ADR-001-merkle-compressed-vesting.md) | Merkle compressed vesting decision |
| [ADRs/ADR-002](ADRs/ADR-002-keccak-256-domain-separation.md) | Keccak-256 domain separation |
| [ADRs/ADR-003](ADRs/ADR-003-issue-29-deferred-on-chain-fix.md) | Issue 29 deferred on-chain fix |

## Start here

| Goal | Go to |
|------|-------|
| New FE integrator (hooks + Next.js) | [FE_INTEGRATION_GUIDE.md](FE_INTEGRATION_GUIDE.md) |
| Hook API lookup | [FE_HOOKS_REFERENCE.md](FE_HOOKS_REFERENCE.md) |
| Architecture overview | [FE_ARCHITECTURE.md](FE_ARCHITECTURE.md) |
| Raw on-chain instructions | [INSTRUCTION_REFERENCE.md](INSTRUCTION_REFERENCE.md) |
| Why decisions were made | [ADRs/](ADRs/) |
