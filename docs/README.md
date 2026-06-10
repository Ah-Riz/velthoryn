# Velthoryn Documentation Index

Quick map of `docs/` — start at the repo [`README.md`](../README.md) for setup and status.

## Getting started

| Doc | Audience | Contents |
|-----|----------|----------|
| [`LOCAL_DEV.md`](LOCAL_DEV.md) | All | Keypair, validator, first green test |
| [`TESTING.md`](TESTING.md) | All | SC + web + E2E commands, CI matrix |
| [`INTEGRATION.md`](INTEGRATION.md) | FE/BE | Program ID, PDAs, Merkle, sample calls |
| [`FE_INTEGRATION.md`](FE_INTEGRATION.md) | FE | Full frontend guide, file map, flows |

## Program & on-chain

| Doc | Contents |
|-----|----------|
| [`PROGRAM.md`](PROGRAM.md) | Instructions, state layouts, file map |
| [`STREAM_MODEL.md`](STREAM_MODEL.md) | Stream PDA vs campaign model |
| [`ERROR_MAP.md`](ERROR_MAP.md) | Error code reference |
| [`NATIVE_SOL_VESTING.md`](NATIVE_SOL_VESTING.md) | Native SOL dual-path design |
| [`CREATE_CAMPAIGN_VS_CREATE_STREAM.md`](CREATE_CAMPAIGN_VS_CREATE_STREAM.md) | When to use each entry point |
| [`ROOT_ROTATION_GUIDE.md`](ROOT_ROTATION_GUIDE.md) | Merkle root rotation |
| [`CU_BUDGET.md`](CU_BUDGET.md) | Compute unit notes |

## Backend & API

| Doc | Contents |
|-----|----------|
| [`BACKEND_API.md`](BACKEND_API.md) | Schema, routes, data flows |
| [`API_TRUST_BOUNDARIES.md`](API_TRUST_BOUNDARIES.md) | **Canonical** auth tier per route |
| [`API_ROUTE_TRUST_BOUNDARIES.md`](API_ROUTE_TRUST_BOUNDARIES.md) | Legacy P0.2 scoping note (superseded) |
| [`BE-SC-MERKLE-ACCEPTANCE-STATUS.md`](BE-SC-MERKLE-ACCEPTANCE-STATUS.md) | Bootcamp acceptance checklist |
| [`E2E_BE_VERIFICATION.md`](E2E_BE_VERIFICATION.md) | BE verification matrix |

## Features (F1–F4)

| Doc | Feature |
|-----|---------|
| [`TRANSPARENCY_DASHBOARD.md`](TRANSPARENCY_DASHBOARD.md) | F2 dashboard + portfolio |
| [`AUTOMATIC_CLAWBACK.md`](AUTOMATIC_CLAWBACK.md) | F3 clawback UI + APIs |
| [`roadmap/README.md`](roadmap/README.md) | Full roadmap specs (requirements, design, tasks) |

## Security & operations

| Doc | Contents |
|-----|----------|
| [`SECURITY.md`](SECURITY.md) | Program security notes |
| [`MAINNET_CHECKLIST.md`](MAINNET_CHECKLIST.md) | Pre-mainnet gates |
| [`operations/backup-restore.md`](operations/backup-restore.md) | DB backup & restore |
| [`operations/multisig-setup.md`](operations/multisig-setup.md) | Multisig runbook |
| [`AUDIT_REPORT.md`](AUDIT_REPORT.md) | Internal audit findings |
| [`MATURITY_REPORT.md`](MATURITY_REPORT.md) | Maturity assessment |

## Planning & known issues

| Doc | Contents |
|-----|----------|
| [`PENDING_WORK.md`](PENDING_WORK.md) | Prioritized backlog from spec audit |
| [`KNOWN_ISSUE_29_DESIGN.md`](KNOWN_ISSUE_29_DESIGN.md) | Multi-leaf `claimed_amount` undercount design |
| [`WEEK8_KNOWN_ISSUES.md`](WEEK8_KNOWN_ISSUES.md) | Week 8 bug sweep log |
| [`SHIP-PATH-NEXT.md`](SHIP-PATH-NEXT.md) | Ship path notes |

## Team-specific (scholarship)

| Doc | Owner |
|-----|-------|
| [`PRD_LANA.md`](PRD_LANA.md) / [`PDD_LANA.md`](PDD_LANA.md) / [`TDD_LANA.md`](TDD_LANA.md) | Lana (SC/BE) |
| [`PRD_GERAL.md`](PRD_GERAL.md) / [`PDD_GERAL.md`](PDD_GERAL.md) / [`TDD_GERAL.md`](TDD_GERAL.md) / [`SECURITY_GERAL.md`](SECURITY_GERAL.md) | Geral (FE) |
