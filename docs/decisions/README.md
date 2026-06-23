# Architecture Decision Records

This directory contains all Architecture Decision Records (ADRs) for the Velthoryn protocol. Each ADR documents a significant technical decision, its context, and consequences.

---

## Index

| ADR | Decision | Status |
|---|---|---|
| [ADR-001](./adr-001-merkle-compressed-vesting.md) | Use Merkle-compressed vesting (one tree per campaign, not one PDA per recipient) | Accepted |
| [ADR-002](./adr-002-keccak-256-domain-separation.md) | Use Keccak-256 with domain separation for Merkle hashing | Accepted |
| [ADR-003](./adr-003-issue-29-per-leaf-ledger.md) | Issue #29: per-leaf ledger in ClaimRecord (originally deferred, then shipped on-chain) | Accepted |
| [ADR-FE-001](./adr-fe-001-shadcn-ui.md) | Adopt shadcn/ui as the component primitive layer | Accepted |
| [ADR-FE-002](./adr-fe-002-e2e-mock-wallet.md) | E2E mock wallet via localStorage flag | Accepted |
| [ADR-FE-003](./adr-fe-003-campaign-lifecycle.md) | 8-state CampaignLifecycle enum | Accepted |
| [ADR-FE-004](./adr-fe-004-bankrun-ordering.md) | Bankrun `warpToSlot` before `setClock` | Accepted |
| [ADR-FE-005](./adr-fe-005-server-side-tx.md) | Server-side transaction building (tx-builder.ts) | Accepted |
| [ADR-FE-006](./adr-fe-006-idl-drift.md) | Manual claim instruction builder (IDL drift mitigation) | Accepted |
| [ADR-FE-007](./adr-fe-007-cancel-design.md) | Cancel design: instant settle vs grace period | Accepted |
