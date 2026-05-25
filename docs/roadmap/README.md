# Roadmap — BE-DB-SC-Merkle Production Plan

**Owner:** Lana (SC/BE lead)
**Created:** 2026-05-22
**Branch:** `dev_lana`

Read in order. Each phase has a design doc (architecture, decisions, file map) and a task list (ordered, verifiable checkboxes).

## Reading order

| # | File | Phase | Est. | Blocks? |
|---|------|-------|------|---------|
| 00 | [GAP-ANALYSIS.md](00-GAP-ANALYSIS.md) | Master reference | — | — |
| 01 | [DESIGN-P0-SECURITY-OPS.md](01-DESIGN-P0-SECURITY-OPS.md) | P0+P1 Security & Ops | 7-9d | **Yes** |
| 01 | [TASKS-P0-SECURITY-OPS.md](01-TASKS-P0-SECURITY-OPS.md) | (task checklist) | | |
| 02 | [DESIGN-F1-BULK-SEND.md](02-DESIGN-F1-BULK-SEND.md) | F1 Bulk Send | 5d | No |
| 02 | [TASKS-F1-BULK-SEND.md](02-TASKS-F1-BULK-SEND.md) | (task checklist) | | |
| 03 | [DESIGN-F2-DASHBOARD.md](03-DESIGN-F2-DASHBOARD.md) | F2 Dashboard Transparency | 6d | After P0+P1 |
| 03 | [TASKS-F2-DASHBOARD.md](03-TASKS-F2-DASHBOARD.md) | (task checklist) | | |
| 04 | [DESIGN-F3-CLAWBACK.md](04-DESIGN-F3-CLAWBACK.md) | F3 Clawback API | 4d | After F2.1 |
| 04 | [TASKS-F3-CLAWBACK.md](04-TASKS-F3-CLAWBACK.md) | (task checklist) | | |
| 05 | [DESIGN-F4-HARDENING.md](05-DESIGN-F4-HARDENING.md) | F4+P2 Vesting UX & Hardening | 8d | No |
| 05 | [TASKS-F4-HARDENING.md](05-TASKS-F4-HARDENING.md) | (task checklist) | | |

## Dependency graph

```
P0 Security ──────┬── F1 Bulk Send
                  ├── F2 Dashboard ──── F3 Clawback
                  └── F4+P2 Hardening
```

**Critical path:** P0 → F2 → F3 (17-19 days)

## What 00-GAP-ANALYSIS contains

- Current state of SC (86/86), BE (8 routes), DB (4 tables), Merkle (13/13)
- Feature gap analysis for all 4 user priorities
- Production readiness audit (P0/P1/P2 severity)
- Total file change map (26 new, 10 modified, 3 migrations)
- Risk assessment

## Status

| Phase | Status |
|-------|--------|
| P0+P1 Security & Ops | Not started |
| F1 Bulk Send | Not started |
| F2 Dashboard | Not started |
| F3 Clawback | Not started |
| F4+P2 Hardening | Not started |
