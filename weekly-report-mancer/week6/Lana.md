# Weekly Report — Lana (Week 6)

**Scope:** BE-DB-SC-Merkle (backend API, Postgres/indexer, Solana program, Merkle client). Frontend UI is out of scope unless noted as a dependency on Geral.

**This week (chronological):** Native SOL dual-path vesting → F1–F4 BE/indexer (prepare, timeline, clawback APIs, hardening) → instant refund for unstarted multi-leaf campaigns (B1) + polish.

---

## Status — What works and what doesn't

### Working

| Area | Item | Evidence |
|------|------|----------|
| **SC** | Native SOL path | `create_*_native`, `fund_campaign_native`; lamport branches on claim/withdraw/cancel/withdraw_unvested — **12/12** bankrun tests |
| **SC** | F1–F4 surface | Bulk/clawback/hardening instructions unchanged; Token-2022 guard |
| **SC** | `instant_refund_campaign` | Creator-only; multi-leaf + `now < min_cliff_time`; drains vault/PDA |
| **SC** | `min_cliff_time` + `instant_refunded` | On `VestingTree`; create/update_root; blocks claim/milestone after refund |
| **SC** | `InstantRefunded` event + errors | 6035–6040 incl. `NotMultiLeafCampaign` (6040) |
| **DB** | Event + campaign schema | F1–F4 tables (`0003`–`0005`); instant refund (`0006`, `0007`) |
| **Indexer** | State sync + events | PDA/layout fix from review; `InstantRefunded` ingestion |
| **API** | F1–F4 routes | prepare, import, timeline, clawback tx builders, cron, simulate |
| **API** | Instant refund | `GET` → `instantRefundEligible`; `POST .../instant-refund` with pre-check |
| **Merkle** | Client + parity | `prepareCampaign()` + `minCliffTime`; parity + E2E scripts pass |
| **Docs** | README, PROGRAM, TESTING, BACKEND_API, ERROR_MAP | Updated for 18 instructions / instant refund |

### Incomplete / out of BE-DB-SC-Merkle scope

| Item | Owner | Notes |
|------|-------|-------|
| Native SOL + instant refund in FE | Geral | Hooks/UI; BE exposes API fields + tx builders |
| Sentry live DSN, k6 load tests | Ops | F4 hardening |
| Devnet smoke for `instant_refund_campaign` | BE/SC | Localnet green; devnet upgrade pending |
| Formal audit | — | Post-implementation |

### Test results (end of Week 6, local)

| Suite | Result |
|-------|--------|
| `tests/vesting-native-sol.spec.ts` | **12/12** |
| `tests/instant-refund-campaign.spec.ts` | **11/11** |
| `pnpm test:localnet` (full SC) | **118 passing**, 2 pending |
| `pnpm --filter @velthoryn/web test` | **553 passing**, 13 skipped |
| Merkle parity + E2E pipeline | **PASS** |
| `anchor build` + committed IDL drift check | **PASS** |

**Cancellation model (instant refund):** single-leaf → `cancel_stream`; multi-leaf started → `cancel_campaign` (grace); multi-leaf unstarted → `instant_refund_campaign`.

Spec: `.claude/specs/instant-refund-unstarted-campaigns/` — verified for BE-SC-DB-Merkle (T1–T16).

---

## Blockers — What's stuck or what you need

**No blockers in BE-DB-SC-Merkle.**

| Dependency | Who | What |
|------------|-----|------|
| Cancel UI for instant vs grace | Geral | `instantRefundEligible` + `POST .../instant-refund` |
| Native SOL in create flows | Geral | Use `*_native` instructions when mint is `NATIVE_SOL_MINT` |

**Questions:** None blocking merge for this week’s BE-SC-DB-Merkle delivery.

---

## Metrics — Quantifiable progress

| Metric | End of Week 6 |
|--------|----------------|
| Instructions (total) | **18** (14 SPL + 3 native + `instant_refund_campaign`) |
| Error variants | **41** |
| Events | **10** |
| SC tests (`pnpm test:localnet`) | **118** passing, 2 pending |
| — native SOL suite | 12 |
| — instant-refund suite | 11 |
| Web Vitest | **553** passing, 13 skipped |
| API routes (cumulative F1–F4 + instant refund) | **12** new this period (11 F1–F4 + 1 instant refund) |
| DB migrations this period | **0003**–**0007** |
| Code review fixes (F1–F4 pass) | **8** |
| Research / design docs | `NATIVE_SOL_VESTING.md`; instant-refund spec + verification |

**SC test growth this week:** suite grew with native SOL (+12) and instant refund (+11) on top of the existing SPL/integration matrix — **118** total on localnet, not a separate “week 7” baseline.
