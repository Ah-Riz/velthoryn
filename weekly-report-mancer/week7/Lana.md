# Weekly Report — Lana (Week 7)

**Scope:** BE-DB-SC-Merkle (backend API, Postgres/indexer, Solana program, Merkle client). Frontend UI is out of scope unless noted as a dependency on Geral.

**This week (chronological):** Week 7 test suites (integration, edge cases, security, coverage gaps) → devnet program upgrade + IDL sync → full feature validation (4 core features, 27/27 PASS) → bug fix (timeline `instant_refund_events` gap) → validation report + cost analysis.

---

## Status — What works and what doesn't

### Working

| Area | Item | Evidence |
|------|------|----------|
| **SC** | Week 7 integration flow suite | `tests/week7-integration-flow.spec.ts` — **21 tests**: multi-recipient Merkle claims, timeline event lifecycle, cancel+grace+withdraw flow |
| **SC** | Week 7 edge case suite | `tests/week7-edge-cases.spec.ts` — **7 tests**: pause after full claim, instant refund after cliff, boundary conditions |
| **SC** | Week 7 security suite | `tests/week7-security-sc.spec.ts` — **29 tests**: unauthorized access, wrong-signer, over-claim, proof tampering, re-entrancy guards |
| **SC** | Week 7 coverage gap suite | `tests/week7-coverage-gaps.spec.ts` — **7 tests**: missing error paths, event exhaustiveness assertion |
| **SC** | Devnet upgrade deployed | Program `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` upgraded; deploy sig `2APdqFPgdRboc8QThpb2EfR7gVGRqemegvLJLTbf1sVgSMDHv3Y9PexECKuBRPmDWyLTD7AF9yzbmDxMZqqZqfAn` |
| **DB** | All migrations applied | `0003`–`0008` (RLS, event tables, timeline indexes, instant refund fields + events + RLS) |
| **DB** | Timeline indexes verified | `block_time`, `campaignId`, `beneficiary+rootVersionId` composite — all covered |
| **API** | Timeline `instant_refund_events` fix | 8th UNION ALL arm + COUNT term wired; all 8 event types now in timeline response |
| **API** | Timeline test suite | `apps/web/tests/api/timeline.test.ts` — **9/9 PASS** (incl. new instant_refunded shape test + multi-table 8-event ordering) |
| **Merkle** | Full pipeline validated | Tree build, CSV import, leaf storage, proof retrieval, on-chain root commitment, multi-claim, invalid-proof rejection |
| **Merkle** | Cost analysis complete | 49.5% cheaper at 100 recipients; break-even at N ≥ 2; ~350 CU overhead per claim (<1%) |
| **Docs** | Feature validation report | `docs/WEEK7_FEATURE_VALIDATION_REPORT.md` — 27/27 checks PASS, 0 bugs remaining |
| **Docs** | Coverage report | `docs/WEEK7_COVERAGE_REPORT.md` — 14 instructions, 41 errors, 12 events, all covered |
| **CI** | GitHub Actions green | `ci.yml` + `lint.yml` + `web-ci.yml` all passing on `dev_lana` |

### Feature validation summary (27/27 PASS)

| Feature | Checks | Key findings |
|---------|--------|--------------|
| F1 — Bulk Send (Merkle) | 8/8 | E2E pipeline verified: prepare → import → store → proof → create_campaign → multi-claim → reject invalid |
| F2 — Transparency (Dashboard) | 6/6 | 12 on-chain events emitted; 8/8 timeline event types; accurate vesting-progress %; publicly readable accounts |
| F3 — Standard Vesting | 6/6 | Cliff/Linear/Milestone all mathematically correct; u128 safe math; multiply-before-divide; no rounding exploits |
| F4 — Automatic Clawback | 7/7 | 7-day grace enforced; vested tokens protected; atomic split transfers; instant refund gated to unstarted |

### Bug fix this week

| Bug | Severity | Fix |
|-----|----------|-----|
| Timeline missing `instant_refund_events` UNION ALL | Low | Added 8th arm to eventsQuery + countQuery; added `seedInstantRefundEvent` fixture; updated + added tests (9/9 PASS) |

### Incomplete / out of BE-DB-SC-Merkle scope

| Item | Owner | Notes |
|------|-------|-------|
| FE: instant refund + native SOL in create flows | Geral | BE exposes API fields + tx builders |
| Sentry live DSN, k6 load tests | Ops | Post-validation hardening |
| Formal external audit | — | Post-implementation |

---

## Blockers — What's stuck or what you need

**No blockers in BE-DB-SC-Merkle.** All 4 core features validated. All tests passing. Devnet deployed.

| Dependency | Who | What |
|------------|-----|------|
| Cancel UI for instant vs grace | Geral | `instantRefundEligible` + `POST .../instant-refund` |
| Native SOL in create flows | Geral | Use `*_native` instructions when mint is `NATIVE_SOL_MINT` |

---

## Metrics — Quantifiable progress

| Metric | End of Week 7 |
|--------|---------------|
| Instructions (total) | **18** (14 SPL + 3 native + `instant_refund_campaign`) |
| Error variants | **41** |
| Events | **12** (all emitted, all indexed) |
| Week 7 SC test suites | **4** new (integration 21, edge-cases 7, security 29, coverage 7 = **64 tests**) |
| Timeline API tests | **9/9** PASS (was 7, +2 for instant_refunded) |
| Feature validation checks | **27/27** PASS |
| Bugs found | **1** Low (fixed) |
| TODO/FIXME/HACK | **0** |
| DB migrations cumulative | `0000`–`0008` (9 total) |
| Merkle break-even | **N ≥ 2** recipients |
| Merkle savings at 100 recipients | **49.5%** (~0.216 SOL) |
| Devnet program | Upgraded, slot 466620187 |
| Reports delivered | `WEEK7_FEATURE_VALIDATION_REPORT.md`, `WEEK7_COVERAGE_REPORT.md` |

**Week 7 test growth:** 4 new on-chain suites (+64 tests), 2 new timeline tests (+2). Full feature validation across SC+BE+DB+Merkle with PASS evidence on every checklist item.
