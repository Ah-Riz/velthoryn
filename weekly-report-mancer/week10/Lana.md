# Weekly Report — Lana (Week 10)

**Scope:** BE-DB-SC-Merkle — backend API (`apps/web/src/app/api/`), Postgres/indexer (`apps/web/src/lib/db/`, `src/lib/indexer/`), Solana program (`programs/vesting/`), and the Merkle client/verifier (`clients/ts/`, `programs/vesting/src/math/`). Frontend UI is Geral's.

**Week 10 was two things.** First — the **production infrastructure shipped**: the `velthoryn.site` domain/DNS (apex → `www`, plus the `docs.velthoryn.site` subdomain) and the **GitBook docs site** published from this repo's `docs/`. Second — the **Demo Day verification pass**: an independent, evidence-based run that proves the BE + smart-contract + Merkle slice works end-to-end on devnet and in production, and that the docs/numbers are honest. No new product features; the work is infrastructure + docs + read-only verification, plus a targeted cleanup of a stale-deployment reference that was actively misleading.

## Infrastructure shipped this week — domain/DNS + GitBook

The headline deliverables for the week were standing up the production domain/DNS and the standalone docs site:

- **Domain/DNS:** configured the `velthoryn.site` zone. Apex `velthoryn.site` → **307 → `www.velthoryn.site`** (Vercel, production Next.js app — `/api/health` 200, `status:ok`). Added the **`docs.velthoryn.site`** subdomain → **HTTP 200**, `server: cloudflare`, serving the GitBook docs. The dead `velthoryn.vercel.app` (404) is retired in favour of the canonical `www.velthoryn.site` (the 41→0 stale-ref cleanup below). Verified live via `curl` (307 / 200 / `server: cloudflare`).
- **GitBook docs site:** created the GitBook site from this repo's `docs/` (GitBook-format migration, commit `ac0c1eb`) and published it at **`https://docs.velthoryn.site/`**. TOC (`docs/SUMMARY.md`): README + Getting Started; Guides ×4; Reference ×8 (incl. a new dedicated `database-schema.md` — all 13 tables, RLS, indexes, migrations); Frontend ×4; Security ×2; Operations ×4; Architecture Decisions ×11 (ADR-001/002/003 + 7 FE ADRs). Native `{% hint %}` callouts throughout.
- **Supporting docs/domain wiring:** pointed the app's "Docs" buttons/links (`Hero` + `Footer`) at `docs.velthoryn.site`, replacing the broken GitHub `.md` deep-links; added the GitBook README hero logo; plus a BE/DB/SC/MERKLE doc-alignment pass (corrected README Anchor version + error count, prepare rate limit, `root_versions` column; new DB schema page; relaxed the Issue #29 BE guards to cap-aware; flagged the `PATCH /status` route divergence).

**What I verified (chronological):**
- **Devnet program liveness (T1):** `solana program show G6iaig…8wvu --url devnet` — program live, upgrade authority `GPfHeZtB…L5Es6` correct, last-deploy slot **469,756,770** (newer than the documented 464,782,646). Flagged that the on-chain data length is **1,047,776 B (~1 MiB)** — ~2× both the documented "~492 KB" and the local `target/deploy/vesting.so` (530,208 B / ~518 KiB), i.e. the deployed binary does not match the local build and was upgraded after the README snapshot. Needs a confirmation that the deployed build is the intended one.
- **On-chain Merkle claim — the money shot (T2a):** ran `createCampaign → fundCampaign → claim` (2-leaf Cliff campaign, cliff in the past) against devnet using the funded authority wallet. Claim tx `3cDeHaqTX2jZdTpVFKT27WC9iRaA5GXgBX4h8j8R4cbqAVfhJQNoyHDCJiK3a83dRaUmEKXyvEA64bw7QHv4Cmrq` — `solana confirm` = **Finalized**, `err:null`, slot 471339602. Beneficiary ATA went **0 → 123,000,000 raw (123 UI)** = exactly the claimed leaf amount. Explorer: `https://solscan.io/tx/3cDeHaq…Cmrq?cluster=devnet`.
- **Named BE+Merkle pipeline (T2b):** ran the canonical `scripts/test-be-merkle-pipeline.ts` against the **live** backend — prepare (3 leaves Cliff/Linear/Milestone) → POST `/api/campaigns` (**HTTP 201**, campaignId **81**) → GET campaigns → GET proof 3/3 → verifyProof + leaf-data 3/3 → **ALL PASS**. (Gotcha found & documented: hitting the apex `velthoryn.site` returns 401 because the apex→`www` redirect is **cross-origin and `fetch` strips the `Authorization` header** on cross-origin redirects — target `www.velthoryn.site` directly.)
- **Live backend spot-check (T3):** corrected the biggest finding of the pass. The initial check reported the production deployment **down** — that was because it queried the stale default subdomain `velthoryn.vercel.app` (404 / `DEPLOYMENT_NOT_FOUND`). Production is actually **live and healthy at `https://www.velthoryn.site`** (apex `velthoryn.site` → 307 → `www`, Vercel). Spot-checked the API: `/api/health` 200 `{status:ok,db:true,rpc:true}`, `/api/campaigns` 200 (81 campaigns), `/api/campaigns/[addr]` 200 (detail + analytics), `/[addr]/claims` 200 (indexer), `/[addr]/timeline` 200 (indexer), `/api/beneficiary/[addr]/campaigns` 200, with `x-api-version: 1` + security headers. DB ✓, RPC ✓, indexer ✓.
- **Metrics from docs (T5–T6):** confirmed the headline numbers are still in the docs — SC 127+, web Vitest 569, devnet+bankrun 98 (+1 pending), native-SOL 12, sealevel-attacks 4, Mollusk 73 active / 18 ignored, proptest 18 invariants, coverage 98.02% host-buildable; CU avg util 76%, create+fund native ~$0.00170 (247× cheaper than Jito $0.42). Flagged minor cross-doc drift: clock 11 (narrative) vs 12 (tables); SC 127+ vs 126 (week-9 regression note); proptest split 10/8 vs 11/7.
- **LOC (T7):** installed `cloc 2.09` (no-root, `~/.local/bin`) and re-measured code-only LOC for the slice — **4,875** (Rust 3,017 + TS 1,858; 38 files; 744 blank + 550 comment excluded), replacing the earlier `wc -l` fallback of 6,168.

**Cleanup shipped this week:** the code/docs pointed at the dead `velthoryn.vercel.app` in **41** places (incl. the prod CORS fallback in `apps/web/src/middleware.ts`, `ALLOWED_ORIGIN` in `apps/web/.env.example`, README, and many docs/tests) vs the live `velthoryn.site` in only 10. Replaced `velthoryn.vercel.app → www.velthoryn.site` across **12 code/active-doc files** → **0 stale refs** in code/active-docs; corrected `docs/PENDING_WORK.md`'s "prod down" status to "live"; `middleware-cors` unit test stays **3/3 green**. Intentionally left: the `staging.velthoryn.vercel.app` preview-deployment examples in `apps/web/tests/load/*` (legit Vercel preview URLs) and all `weekly-report-mancer/*` (historical timestamped records).

---

## Status — Verified this week

| Area | Item | Evidence |
|------|------|----------|
| **SC (devnet)** | Program `G6iaig…8wvu` live; authority `GPfHeZtB…L5Es6`; slot 469,756,770 | `solana program show … --url devnet` |
| **SC (devnet)** | On-chain Merkle claim finalizes; beneficiary paid in full | claim sig `3cDeHaq…Cmrq` — Finalized, slot 471339602; ATA 0 → 123,000,000 raw |
| **BE (live)** | Named BE+Merkle pipeline ALL PASS | `scripts/test-be-merkle-pipeline.ts --url https://www.velthoryn.site` — POST 201 (campaignId 81), proof 3/3, verify 3/3 |
| **BE (live)** | 6 core endpoints live + healthy; DB/RPC/indexer ok | GET health/campaigns/detail/claims/timeline/beneficiary all 200 at `www.velthoryn.site` |
| **Ops** | Production canonical URL confirmed = `https://www.velthoryn.site` | apex 307→www (Vercel); `velthoryn.vercel.app` dead (404) |
| **Docs** | Stale dead-URL refs removed from code/active-docs (41 → 0) | 12-file swap `vercel.app → www.velthoryn.site`; `PENDING_WORK.md` status corrected; CORS test 3/3 |
| **Tooling** | `cloc 2.09` installed (no-root) | `~/.local/bin/cloc` |
| **Metrics** | Slice code-only LOC = 4,875 | `cloc` Rust 3,017 + TS 1,858 |
| **Domain/DNS** | `velthoryn.site` apex→www (Vercel) + `docs.velthoryn.site` (Cloudflare/GitBook) live | `curl`: apex 307→www; `docs` 200 `server: cloudflare`; `/api/health` 200 |
| **Docs** | GitBook site live at `https://docs.velthoryn.site/` from repo `docs/` | commit `ac0c1eb`; `docs/SUMMARY.md` (Guides×4, Reference×8 + DB schema page, ADRs×11) |

---

## Issues / follow-ups

| Sev | Item | Owner / next step |
|-----|------|-------------------|
| 🟡 Med | **T1 on-chain binary ≠ local build ≠ docs** — data length ~1 MiB vs local `.so` ~518 KiB vs docs ~492 KB; deployed at a newer slot | Confirm the deployed build is the intended revision (rebuild + redeploy, or update docs to match) |
| 🟢 Low | **T5 cross-doc drift** — clock 11-vs-12; SC 127-vs-126; proptest split 10/8-vs-11/7 | Reconcile the numbers in one pass |
| 🟢 Low | **12 uncommitted URL-cleanup edits** on `dev_lana` (working tree; not committed/PR'd) | Commit + PR to `test`/`main` |
| 🟢 Low | BE pipeline test created **1 ephemeral test campaign** (campaignId 81) in live Supabase | Acceptable test data; prune if desired |
| 🟢 Low | **GitBook dashboard logo/header** — README hero logo added in-repo, but the space-icon / header logo is a GitBook-only dashboard setting | Upload the SVG in GitBook Space settings (space icon + paid Header) |
| 🟢 Low | **`docs.velthoryn.site` links point to root only** — footer resource links all go to the docs home, not deep-linked | Optional: map each to its GitBook page slug once confirmed |

---

## Delivery

- **Uncommitted on `dev_lana`:** 12 files (`README.md`, `apps/web/{.env.example,src/middleware.ts,tests/lib/middleware-cors.test.ts}`, `docs/{BACKEND_API,BE-SC-MERKLE-ACCEPTANCE-STATUS,INTEGRATION,PENDING_WORK,SHIP-PATH-NEXT,security-audit-report}.md`, `docs/roadmap/01-TASKS-P0-SECURITY-OPS.md`, `docs/week9/INTEGRATION_GUIDE.md`) — +24/−24, URL swap + PENDING_WORK status correction. Commit/PR on request.
- **Also uncommitted on `dev_lana` (domain/GitBook/docs work this week):** GitBook hero logo + SC-number fixes (`docs/README.md`), `docs/SUMMARY.md`, `docs/getting-started.md`, new `docs/reference/database-schema.md`, `docs/reference/{api-endpoints,trust-boundaries}.md`, `docs/decisions/adr-003-*.md`, `docs/internal/tracking/PENDING_WORK.md`; app "Docs" links → `docs.velthoryn.site` (`apps/web/src/components/landing/{Hero,Footer}.tsx`); cap-aware Issue #29 guard (`apps/web/src/lib/campaign/limits.ts`, `prepare`/`import` routes, `tests/api/bulk-campaign.test.ts`). All lint/test green; commit/PR on request.
- **Verification verdict for Demo Day:** SC live on devnet (claim finalized), BE+Merkle pipeline ALL PASS against production, production API healthy at `https://www.velthoryn.site`, metrics and LOC honest. No Demo Day blockers remaining from the BE/SC/Merkle slice; one item to confirm (deployed-build identity, T1).
