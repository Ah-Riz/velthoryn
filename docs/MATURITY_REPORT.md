# Code Maturity Assessment — Velthoryn Vesting Protocol

| Field | Value |
|-------|--------|
| **Author** | Daemon Blockint Technologies |
| **Project** | Velthoryn — Merkle-compressed Solana token vesting |
| **Platform** | Solana / Anchor 1.0.0 |
| **Program ID** | `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` |
| **Assessment date** | 2026-05-17 |
| **Framework** | Trail of Bits — Building Secure Contracts, Code Maturity Evaluation v0.0.1 |
| **Scope** | `programs/vesting/` (primary), `tests/`, `trident-tests/`, `docs/` |
| **Companion** | [AUDIT_REPORT.md](./AUDIT_REPORT.md), [SECURITY.md](./SECURITY.md) |

---

## Executive summary

**Overall maturity: 2.8 / 4.0 (Moderate–Satisfactory)**

Velthoryn’s on-chain vesting program is **well documented** and **structurally sound** for a Solana token-distribution program: checked arithmetic on fund flows, CEI before SPL CPIs, no `unsafe` code, and a large integration + exploit test suite. The main gaps are **operational** (monitoring/incident response not in-repo), **governance centralization** (`update_root` by a single cancel authority), and **verification depth** (low Rust line-coverage metric, no property-based or formal verification in CI).

### Top 3 strengths

1. **Documentation (Strong)** — `SECURITY.md`, `PDD_LANA.md`, `TDD_LANA.md`, and `AUDIT_REPORT.md` form a threat model, per-instruction attack surface, and cross-language Merkle contract.
2. **Low-level safety (Strong)** — No `unsafe`/assembly; CPIs limited to typed SPL Token; PDA seeds documented with `CHECK` on `vault_authority`.
3. **Security regression testing** — 11 exploit scenarios in `tests/security.spec.ts`, golden-vector hash alignment, Trident fuzz in CI.

### Top 3 gaps

1. **Auditing / operations (Moderate)** — Events exist, but no documented monitoring alerts or incident-response runbook in the repository.
2. **Decentralization / access (Moderate)** — `cancel_authority` can rotate Merkle roots; no on-chain multisig/timelock; privileged keys assumed to be EOAs operationally.
3. **Testing & verification (Moderate)** — Instruction handlers are validated via TypeScript/bankrun, not Rust unit tests; `cargo tarpaulin` reports ~6.7% in-crate line coverage; no `proptest`/formal verification in CI.

### Priority recommendations

| Priority | Action |
|----------|--------|
| **CRITICAL** | Document and test **upgrade authority** holder for mainnet program ID before promotion |
| **HIGH** | Add **proptest** (or expand Trident) for Merkle proof ↔ verifier round-trip in CI |
| **HIGH** | Publish **monitoring + incident response** plan (alerts on `RootUpdated`, large `Claimed`, pause/cancel) |
| **MEDIUM** | Require **multisig** for `cancel_authority` / `pause_authority` at deployment (operational) |
| **MEDIUM** | Deduplicate shared **claim/withdraw** logic to reduce drift risk |

---

## Maturity scorecard

| # | Category | Rating | Score | Key notes |
|---|----------|--------|-------|-----------|
| 1 | Arithmetic | **Satisfactory** | 3 | `checked_add`, `saturating_sub`, `u128` linear math; unit tests; no CI property fuzz on Merkle |
| 2 | Auditing | **Moderate** | 2 | 9 event types; claim indexer in web app; no IR/monitoring runbook in repo |
| 3 | Authentication / access controls | **Moderate** | 2 | Anchor signers + constraints; governance keys not hardened on-chain |
| 4 | Complexity management | **Satisfactory** | 3 | ~1.5k LOC, modular; claim/withdraw duplication |
| 5 | Decentralization | **Moderate** | 2 | Documented root-rotation risk; BPF upgrade model; no timelock |
| 6 | Documentation | **Strong** | 4 | Exceptional spec + security docs; golden vector |
| 7 | Transaction ordering risks | **Satisfactory** | 3 | Not AMM-MEV; root-rotation window documented; on-chain clock for claims |
| 8 | Low-level manipulation | **Strong** | 4 | Zero `unsafe`; justified `UncheckedAccount` for vault PDA |
| 9 | Testing & verification | **Moderate** | 2 | 63+ on-chain tests, Trident fuzz CI; low tarpaulin %; no formal methods |
| | **Overall average** | **Moderate–Satisfactory** | **2.8** | |

---

## Detailed analysis

### 1. Arithmetic — Satisfactory (3)

**Evidence**

- Fund-flow paths use checked arithmetic (`claim.rs`, `withdraw.rs`, `fund_campaign.rs`).
- Linear vesting uses `u128` intermediates in `math/schedule.rs`; unit tests cover max `u64`, cancel clamp, degenerate schedules.
- `docs/SECURITY.md` documents schedule semantics and overflow expectations.
- On-chain Merkle proof length bounds (`MAX_MERKLE_PROOF_LEN = 32`, `max_proof_len_for_leaf_count`) — VEL-009.

**Gaps**

- No dedicated arithmetic spec file (covered across `TDD_LANA` / `PDD_LANA`).
- `SECURITY.md` §4.3 calls for property-based Merkle fuzzing — not yet in CI.

**Improvement:** Add `proptest` in `math/merkle.rs` CI: generate tree → proof → `verify_merkle_proof` always passes; single-byte mutations fail.

---

### 2. Auditing — Moderate (2)

**Evidence**

- Nine event structs in `events.rs` covering create, fund, claim, cancel, root update, pause, unvested withdraw, close.
- Web indexer parses `Claimed` events (`apps/web/src/lib/indexer/claim-events.ts`).

**Gaps**

- No repository artifact for monitoring dashboards, alert thresholds, or on-call runbooks.
- `get_vested_amount` emits no event (acceptable for view-only).

**Questions for operators**

- Is there an off-repo monitoring stack wired to `RootUpdated` / large transfers?
- Has an incident-response tabletop been run for root compromise or vault anomaly?

---

### 3. Authentication / access controls — Moderate (2)

**Evidence**

- Privileged operations require explicit signers (`update_root.rs`, `pause_campaign.rs`, etc.).
- Beneficiary binding before proof check on `claim`.
- Eleven exploit tests in `tests/security.spec.ts`.
- Admin API uses timing-safe key compare via `verifyAdminKey()` (VEL-010).

**Gaps**

- `cancel_authority` / `pause_authority` are optional pubkeys — no on-chain multisig or timelock.
- `update_root` can change allocations without resetting `ClaimRecord` (VEL-003 — accepted governance risk).

---

### 4. Complexity management — Satisfactory (3)

**Evidence**

- Clear module layout: `instructions/`, `state/`, `math/`, `events/`, `errors/`.
- Handlers are focused; validation order documented in `SECURITY.md` §2.3 for `claim`.
- No `unsafe`, shallow nesting.

**Gaps**

- `claim.rs` and `withdraw.rs` duplicate vesting/claim logic — drift risk if one is patched without the other.

**Improvement:** Extract shared `process_claim(...)` used by both paths.

---

### 5. Decentralization — Moderate (2)

**Evidence**

- `cancellable` flag gates `cancel_campaign` / `update_root`.
- Beneficiaries can claim entitled tokens; `close_claim_record` reclaims rent after full claim or post-grace cancel.
- Root-rotation operational window documented in `SECURITY.md`.

**Gaps**

- Single `cancel_authority` can change `merkle_root` and `leaf_count` without beneficiary consent.
- No on-chain timelock; program upgradeable via standard BPF loader.

**Improvement:** Operational multisig + timelock on root updates; publish upgrade authority address and renounce/lock plan.

---

### 6. Documentation — Strong (4)

**Evidence**

- Sixteen `docs/*.md` files including `SECURITY.md` (425+ lines) with trust-boundary diagram and per-instruction attack tables.
- `PDD_LANA.md` / `TDD_LANA.md` specify Borsh layout, CPI contracts, error codes.
- Cross-language golden vector (`tests/golden_vector.spec.ts`).

**Minor gaps**

- `TESTING.md` updated to 11 security tests; keep in sync after test additions.

---

### 7. Transaction ordering risks — Satisfactory (3)

**Evidence**

- Not an AMM or oracle-dependent swap — classic sandwich MEV does not apply to fixed-entitlement claims.
- Claims use `Clock::get()?.unix_timestamp` on-chain (except view-only `get_vested_amount`).
- Root-rotation ordering window documented; vault insufficiency fails closed (`InsufficientVault`).

**Residual risks (documented)**

- Race between `update_root` and off-chain proof distribution (operational).

---

### 8. Low-level manipulation — Strong (4)

**Evidence**

- `cargo geiger`: **zero `unsafe`** in first-party `vesting` crate.
- CPIs only through `anchor_spl::token::transfer` with `Program<'info, Token>`.
- `UncheckedAccount` for `vault_authority` only as PDA signer, with explicit `CHECK` comments.
- Merkle hashing via `solana_keccak_hasher::hashv` with domain-separated prefixes.

No assembly, no manual account deserialization, no arbitrary program invocation.

---

### 9. Testing & verification — Moderate (2)

**Evidence**

| Layer | Coverage |
|-------|----------|
| Integration | `vesting.supplementary.spec.ts` (~50), `vesting.spec.ts`, `vesting.clock.spec.ts` (7) |
| Security | `security.spec.ts` (11 exploits) |
| Cross-lang | `golden_vector.spec.ts` |
| Web | 201 Vitest tests |
| Fuzz | Trident `fuzz_vesting` — 100×15 flows, CI smoke |
| CI | `ci.yml` (anchor test + Trident), `lint.yml` (clippy, vitest, next build) |

**Gaps**

- `cargo tarpaulin` on `programs/vesting`: **6.68%** line coverage — handlers hit via TS, not Rust unit tests (VEL-007).
- No formal verification, mutation testing, or `proptest` in pipeline.
- `solana-lints` / `cargo dylint` not configured (VEL-002).
- Trident CI is smoke-only.

**Improvement:** Mollusk/LiteSVM unit tests for handler branches; nightly Trident with fixed seeds.

---

## Improvement roadmap

### CRITICAL (before mainnet)

| Item | Effort | Impact |
|------|--------|--------|
| Document **program upgrade authority** and deployment checklist | 0.5 day | Prevents silent program replacement |
| Verify **VEL-001** + **VEL-009** on deployed binary (EXPLOIT 11, EXPLOIT 4) | 1 day | Confirms remediated build |

### HIGH (1–2 months)

| Item | Effort | Impact |
|------|--------|--------|
| **proptest** / expanded Trident for Merkle round-trip in CI | 3–5 days | Arithmetic/Merkle assurance |
| **Monitoring + IR runbook** | 2–3 days | Auditing → Satisfactory |
| **Multisig** for cancel/pause authorities (operational) | 1 day | Access / decentralization |

### MEDIUM (2–4 months)

| Item | Effort | Impact |
|------|--------|--------|
| Refactor shared **claim/withdraw** core | 2–3 days | Complexity / maintenance |
| Enable **solana-lints** in CI | 1–2 days | Static Solana patterns |
| Longer **Trident** campaigns (nightly) | 1 day | Deeper state-space exploration |
| Optional external **re-audit** | 2–4 weeks | Third-party sign-off |

---

## Off-repo questions

1. Will `cancel_authority` / `pause_authority` be Squads multisigs on mainnet?
2. Is claim/root/pause event indexing connected to paging alerts?
3. Who holds the BPF upgrade key for `G6iaig…`, and is immutability planned post-audit?
4. Is there a tested playbook for root compromise or vault anomaly?

---

*Assessment performed by **Daemon Blockint Technologies** against Trail of Bits Code Maturity Evaluation v0.0.1. Not a formal audit certificate. See [AUDIT_REPORT.md](./AUDIT_REPORT.md) for point-in-time security findings.*
