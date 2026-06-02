# Weekly Report — Lana (Week 7)

**Scope:** BE-DB-SC-Merkle (backend API, Postgres/indexer, Solana program, Merkle client). Frontend UI is out of scope unless noted as a dependency on Geral.

**This week (chronological):** Week 7 test suites (integration, edge cases, security, coverage gaps) → devnet program upgrade + IDL sync → full feature validation (4 core features, 27/27 PASS) → bug fix (timeline `instant_refund_events` gap) → validation report + cost analysis → acceptance criteria closure (14/14 sub-items PASS) → **sealevel-attacks analysis + LiteSVM/Mollusk integration**.

---

## Status — What works and what doesn't

### Working

| Area | Item | Evidence |
|------|------|----------|
| **SC** | Week 7 integration flow suite | `tests/week7-integration-flow.spec.ts` — **21 tests**: multi-recipient Merkle claims, timeline event lifecycle, cancel+grace+withdraw flow |
| **SC** | Week 7 edge case suite | `tests/week7-edge-cases.spec.ts` — **8 tests**: pause after full claim, instant refund after cliff, boundary conditions, cancel at exactly endTime |
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
| **Docs** | Coverage report | `docs/WEEK7_COVERAGE_REPORT.md` — 98.02% host-buildable code, 14/14 instructions exercised, >80% criterion met |
| **CI** | GitHub Actions green | `ci.yml` + `lint.yml` + `web-ci.yml` all passing on `dev_lana` |
| **SC** | Sealevel-attacks gap tests | `tests/sealevel-attacks-gap.spec.ts` — **4 tests**: duplicate mutable accounts (#6), cross-tree PDA sharing (#8), closed account reinit (#9) — all PASS via bankrun |
| **SC** | LiteSVM PoC integrated | `tests/vesting-litesvm.spec.ts` — **5 tests**: boot, mint, time-travel, .so loading, simulation — all PASS (~110ms) |
| **SC** | Mollusk CU benchmark | `programs/vesting/tests/compute_units.rs` — **1 test**: program loads and reports 1,738 CU baseline — PASS |
| **SC** | Mollusk instruction tests | `programs/vesting/tests/instructions.rs` — **14 tests**: create_campaign_native (happy + 3 errors), get_vested_amount (6 scenarios), pause/unpause (3 auth) — all PASS |
| **SC** | Mollusk CU benchmarks | `programs/vesting/tests/benchmarks.rs` — **9 benchmarks**: get_vested_amount 615–916 CU, create_campaign_native 9,378–9,372 CU |
| **SC** | proptest property tests | `programs/vesting/src/math/` — **10 tests**: schedule 6 invariants, merkle 4 invariants — all PASS |
| **Docs** | Testing tools report | `docs/TESTING_TOOLS_REPORT.md` — full implementation report with CU measurements |
| **Docs** | Testing tools reference | `docs/TESTING_TOOLS.md` — ecosystem research and recommendations |
| **Docs** | Sealevel-attacks analysis | Full 11-category applicability matrix: 8/11 already mitigated by Anchor; 3 now explicitly proven safe |
| **Docs** | TESTING.md updated | Added LiteSVM, Mollusk, sealevel-attacks sections + testing frameworks comparison table |

### Acceptance criteria (14/14 PASS)

| AC | Sub-item | Status | Evidence |
|----|----------|--------|----------|
| **AC1** | Integration: create_stream → wait → withdraw → verify balance | ✅ PASS | `supplementary.spec.ts:977-1048` (T22), `clock.spec.ts:793-871` (T59), `week7-integration-flow.spec.ts:583-619` |
| **AC2.1** | Zero amount stream | ✅ PASS | `supplementary.spec.ts:1709` (T32), `edge-cases.spec.ts:189` (EC6) |
| **AC2.2** | Withdraw at exactly cliff date | ✅ PASS | `edge-cases.spec.ts:470` (EC8), `security-sc.spec.ts:1083` |
| **AC2.3** | Cancel at exactly end date | ✅ PASS | `edge-cases.spec.ts` (EC19) — cancel_stream at endTime: 100% → beneficiary, 0% → creator |
| **AC2.4** | Double withdraw | ✅ PASS | `clock.spec.ts:793` (T59), `supplementary.spec.ts:3276` (T61) |
| **AC2.5** | Withdraw with nothing available | ✅ PASS | `supplementary.spec.ts:1053` (T23), `week7-integration-flow.spec.ts:1068` |
| **AC3.1** | Signer authority verification | ✅ PASS | 12+ wrong-signer tests across `security-sc.spec.ts:356-663` |
| **AC3.2** | PDA seeds unique | ✅ PASS | `security-sc.spec.ts:671-729` (6 tests) |
| **AC3.3** | No integer overflow | ✅ PASS | `edge-cases.spec.ts:671` (EC16: u64::MAX at 50%) |
| **AC3.4** | Account ownership validated | ✅ PASS | `security-sc.spec.ts:778-918` (wrong mint, wrong vault, cross-campaign) |
| **AC3.5** | No reentrancy | ✅ PASS | CEI pattern + all CPIs external; `security-sc.spec.ts:859-867` |
| **AC4** | Issues documented with fixes | ✅ PASS | Timeline bug found+fixed (commit `3334b34`); validation report updated |
| **AC5** | Coverage >80% | ✅ PASS | 98.02% host-buildable; 14/14 handlers exercised (265+ invocations); report §8 updated |

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
| Week 7 SC test suites | **10** new (integration 21, edge-cases 8, security 29, coverage 7, sealevel-attacks 4, litesvm 5, mollusk scaffold 1, mollusk instructions 14, mollusk benchmarks 9, proptest 10 = **108 tests**) |
| Rust unit tests | **23** (math/merkle 5, math/schedule 6, proptest 10, mollusk scaffold 1, inline 1) |
| Total SC tests | **127+** passing (TS integration) + **40** passing (Rust: proptest + Mollusk) |
| Timeline API tests | **9/9** PASS (was 7, +2 for instant_refunded) |
| Feature validation checks | **27/27** PASS |
| Acceptance criteria sub-items | **14/14** PASS |
| Bugs found | **1** Low (fixed) |
| Sealevel-attacks coverage | **11/11** categories analyzed (8 auto-mitigated by Anchor, 3 explicitly proven) |
| Testing frameworks | **5** (test-validator, bankrun, LiteSVM, Mollusk, proptest) |
| TODO/FIXME/HACK | **0** |
| DB migrations cumulative | `0000`–`0008` (9 total) |
| Merkle break-even | **N ≥ 2** recipients |
| Merkle savings at 100 recipients | **49.5%** (~0.216 SOL) |
| Devnet program | Upgraded, slot 466620187 |
| Reports delivered | `WEEK7_FEATURE_VALIDATION_REPORT.md`, `WEEK7_COVERAGE_REPORT.md`, `TESTING_TOOLS_REPORT.md`, `TESTING_TOOLS.md` |

**Week 7 test growth:** 10 new on-chain/Rust suites (+108 tests), 2 new timeline tests (+2). Full feature validation across SC+BE+DB+Merkle with PASS evidence on every checklist item. All 14 acceptance criteria sub-items PASS. Sealevel-attacks analysis confirms all 11 categories are mitigated. Three new testing frameworks (LiteSVM, Mollusk, proptest) integrated for faster iteration, CU benchmarking, and property-based edge-case discovery.
