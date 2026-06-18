# Status Report — Week 9

**Week 9 was the documentation week.** Scholarship `task.md` KPI: *a developer who has never seen the code can integrate with the program using only the docs.* Alongside the documentation deliverables, the week included a detect → triage → fix → docs hardening pass across SC / BE / Merkle. Program: `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` (devnet).

---

## 1. What's Working Well

### Smart Contract
18 instruction handlers live on devnet with real logic. Week 9 closed two findings: native-SOL `withdraw_unvested` now preserves `rent_min` (no PDA garbage-collection), and `withdraw` gained the `!instant_refunded` guard matching `claim` (`91fefa1`). Schedule math and Merkle verification byte-match the TS encoder. `cargo test`: **125 passed / 0 failed / 19 ignored**.

### Backend API
26 routes across Vercel/Next.js, classified Public / Wallet / Admin per `docs/API_TRUST_BOUNDARIES.md`. Week 9 closed three security findings: POST `/api/campaigns` requires wallet auth + `signer===creator` (BE-SEC-01, High), rate limiter degrades gracefully on Upstash error (BE-SEC-05), cron secret compared constant-time (BE-SEC-06) — all in `81e93f9`. Vitest: **565/565**, no regression.

### Merkle
Independently audited — **sound**. Five findings, all confirming integrity: byte-identical leaf hashes (Rust↔Client↔Web), 0x00/0x01 domain separation blocks second-preimage, no proof-forgery path (6 auditor PoCs rejected), duplicate-leaf = under-count only (never overspend), proof-length math correct for all u32.

### Tests
Week 9 added **+901 LOC** test-only (`fe22cc5`): 18 Rust proptest invariants (schedule 10 + merkle 8), the `withdraw_unvested.rs` Mollusk audit file (3 active), 7 TS fast-check merkle-parity properties, and BE route security tests (BE-SEC-01 401/403). TS merkle parity **13/13**; fast-check **7/7**.

### Docs (Week 9 focus)
The documentation deliverables landed (`cc0e3f4`): a full instruction reference, an end-to-end integration guide, three ADRs, and a cross-cutting bug list. README accuracy reconciled: stale test counts corrected across README/TESTING/E2E/PENDING_WORK (working tree, 2026-06-15) — Mollusk 73 active / 18 ignored across 8 files, bench 10/1, proptest 18 invariants.

### CI
`ci.yml` (anchor build + IDL drift + native SOL + localnet + sealevel-attacks + LiteSVM), `lint.yml` (clippy + Next.js lint + Vitest/build w/ Postgres), `web-ci.yml` (merkle parity + E2E pipeline + build). Week 9 added repeatable Vercel deploy tooling (`29a9a3b`: `pnpm deploy:web`, `vercel:link`).

---

## 2. What's Not

- **Prod deployment is down** — `velthoryn.vercel.app` returns `DEPLOYMENT_NOT_FOUND`. Redeploy runbook is in README §Vercel; one-liner added in `29a9a3b`.
- **4 SC handlers un-benchable by Mollusk 0.13** (`claim`, `cancel_stream`, `instant_refund`, `withdraw_unvested`) — blocked on `init_if_needed` / `Optional<T>` resolution; 19 tests `#[ignore]`d pending Mollusk 0.14. (`withdraw_unvested` native path IS covered via the new audit file.)
- **BE route-level tests need Postgres** — staged in `apps/web/tests/api/**` but not yet runnable in CI.
- **Issue #29 on-chain fix deferred** — multi-leaf cumulative `claimed_amount` undercount; breaking change, mitigated at the BE layer (`ADR-003`).

---

## 3. Known Bugs / Limitations

| ID | Severity | Status | Note |
|----|----------|--------|------|
| **SC-#29** | Known | Documented (`ADR-003`) | Multi-leaf cumulative `claimed_amount` undercount. BE rejects multi cliff/linear per beneficiary at ingest. |
| SC-FIND-04 | Medium | Documented | `close_claim_record` lacks seeds/bump on `vesting_tree` — not exploitable (ClaimRecord PDA derives from tree + `has_one`). |
| SC-FIND-05 | Medium | Documented | `update_root` allows rotation while paused — trusted admin op, no fund movement. |
| SC-FIND-06 | Medium | Documented | `close_claim_record` stale `total_entitled` after root rotation — same multi-leaf gap as #29. |
| SC-DEP-01 | Low/Info | Documented | Cargo audit: curve25519-dalek, ed25519-dalek, rand 0.7.3 — all transitive; needs Solana SDK upgrade. |
| SC-DEP-02 | Low/Info | Detected | cargo-deny advisories/licenses FAIL — no `deny.toml`. |
| BE-SEC-02 | Medium | Documented | `getClientIp` trusts `x-forwarded-for[0]` — mitigated on Vercel prod (Vercel overwrites XFF). |
| BE-SEC-03 | Medium | Documented | Auth-route rate-limit keyed on unvalidated Authorization header. |
| BE-SEC-04 | Medium | Documented | In-memory rate-limit fallback on serverless — mitigated when Upstash Redis configured. |
| BE-SEC-08 | Medium | Documented | CSP includes `unsafe-eval` + `unsafe-inline` — needs FE regression before tightening. |

---

## 4. Documentation deliverables (Week 9)

The documentation-week KPI — *an unfamiliar developer integrates using only the docs* — is met. Each `task.md` criterion maps to a concrete artifact:

| Criterion | Delivered file | Contents |
|-----------|----------------|----------|
| Instruction reference | `docs/week9/INSTRUCTION_REFERENCE.md` | All 13 instructions + view fn; accounts/constraints, args, behavior, full error table (6000–6040, 41 variants), 13 events, per-instruction TS examples. |
| Integration guide | `docs/week9/INTEGRATION_GUIDE.md` | End-to-end creator + beneficiary walkthrough (prepare → create → fund → register → claim → cancel), runnable TS snippets, SPL + native SOL. |
| ≥3 ADRs | `docs/week9/ADRs/ADR-001` (merkle-compressed vesting), `ADR-002` (keccak-256 + domain separation), `ADR-003` (Issue #29 deferred on-chain fix) | Decisions + rationale. |
| README accuracy | `README.md`, `docs/CU_BUDGET.md`, `docs/TESTING.md`, `docs/E2E_BE_VERIFICATION.md`, `docs/PENDING_WORK.md` | Week-9 status + reconciled test counts. |
| Finding log | `docs/week9/BUG_LIST.md` | Cross-cutting findings SC/MERKLE/BE/DB with fix-or-rationale. |

---

## 5. Performance Findings

### Compute Unit Budget
Re-measured 2026-06-15 on Solana CLI 3.1.12 (Agave), Mollusk 0.13.1. Every handler is well under the 200k CU limit. Full table in `docs/CU_BUDGET.md`; headline native-SOL figures:

| Instruction | Native CU | Recommended Limit |
|-------------|-----------|-------------------|
| `get_vested_amount` | 614–916 | 1,200 |
| `create_campaign_native` | 9,378–12,372 | 15,000 |
| `create_stream_native` | 11,617–16,117 | 17,000 |
| `fund_campaign_native` | 7,891 | 10,000 |
| `cancel_campaign` | 5,672 | 8,000 |
| `update_root` | 5,567 | 7,000 |
| `set_milestone_released` | 5,301 | 7,000 |
| `pause` / `unpause_campaign` | 5,380 / 5,383 | 7,000 |
| `close_claim_record` | 5,131 | 7,000 |

`claim`/`cancel_stream` are estimated (~11,500 / ~12,000 from bankrun) — Mollusk-blocked on `init_if_needed`; full measurement pending Mollusk 0.14.

### Merkle Tree Scale
15,000 leaves: ~248 ms build, 448-byte proofs, ~93 µs/leaf verify. Proof length bounded by `MAX_MERKLE_PROOF_LEN`; `max_proof_len_for_leaf_count` verified correct for all u32.

---

## 6. Recommendations

**Priority 1 — before mainnet**
- Restore the prod deployment (`pnpm deploy:web`, `29a9a3b`); set Sentry DSN in Vercel.
- Execute the BE route tests against Postgres in CI (BE-SEC-01 401/403 + rate-limit cluster).
- Unblock Mollusk 0.14 → lift 19 ignored tests + cover the 4 blocked handlers.

**Priority 2 — production hardening**
- Add `deny.toml` (SC-DEP-02) and a `test:sc` script with `BPF_OUT_DIR` (SC-ENV-01).
- On-chain Issue #29 fix (per-leaf claimed tracking) — coordinate BE + FE migration.
- Tighten BE-SEC-02/03/04/08 if moving off Vercel (needs FE regression for CSP).
- External audit ($15–40k).

**Priority 3 — post-launch (Phase 5)**
- Token-2022 mint support.
- Squads v4 multisig for `cancel_authority`.
- Pinocchio performance rewrite; formal fuzzing beyond current property tests.

---

## 7. Files Changed This Week

### Created
| File | Commit | Purpose |
|------|--------|---------|
| `docs/week9/INSTRUCTION_REFERENCE.md` | `cc0e3f4` | Per-instruction reference |
| `docs/week9/INTEGRATION_GUIDE.md` | `cc0e3f4` | End-to-end integration walkthrough |
| `docs/week9/BUG_LIST.md` | `cc0e3f4` | Cross-cutting finding log |
| `docs/week9/ADRs/ADR-001|002|003` | `cc0e3f4` | Architecture decision records |
| `programs/vesting/tests/withdraw_unvested.rs` | `fe22cc5` | Mollusk audit (SC-FIND-02) |
| `clients/ts/src/__tests__/merkle-properties.test.ts` | `fe22cc5` | TS fast-check merkle parity |
| `apps/web/tests/api/security.test.ts` | `fe22cc5` | BE route security tests (BE-SEC-01) |
| Rust proptest blocks in `math/merkle.rs`, `math/schedule.rs` | `fe22cc5` | Forgery + overspend invariants |

### Modified
| File | Commit | Purpose |
|------|--------|---------|
| `programs/vesting/src/instructions/withdraw_unvested.rs` | `91fefa1` | Preserve `rent_min` (SC-FIND-02) |
| `programs/vesting/src/instructions/withdraw.rs` | `91fefa1` | `!instant_refunded` guard (SC-FIND-03) |
| `apps/web/src/app/api/campaigns/route.ts` | `81e93f9` | Wallet auth (BE-SEC-01) |
| `apps/web/src/lib/api/rate-limit.ts` | `81e93f9` | Resilient fallback (BE-SEC-05) |
| `apps/web/src/app/api/cron/sync/route.ts` | `81e93f9` | `timingSafeCompare` (BE-SEC-06) |
| `tests/vesting-native-sol.spec.ts` | `46472af` | Align to rent-preservation fix |
| `programs/vesting/benches/compute_units.md` | `067603e` | CU bench refresh (2026-06-15) |
| `apps/web/.vercel/project.json`, root `package.json` | `29a9a3b` | Repeatable deploy tooling |
| `README.md`, `docs/CU_BUDGET.md`, `docs/TESTING.md`, `docs/E2E_BE_VERIFICATION.md`, `docs/PENDING_WORK.md` | working tree (2026-06-15) | Test-count reconciliation (pending commit) |
