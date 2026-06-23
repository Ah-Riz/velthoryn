# Audit Report

Combined security audit findings and code maturity assessment for the Velthoryn vesting program.

| Field | Value |
|---|---|
| **Auditor** | Daemon Blockint Technologies |
| **Program** | `vesting` |
| **Program ID** | `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` |
| **Framework** | Anchor 1.0.0 |
| **Scope** | `programs/vesting/` (on-chain program) |
| **Audit date** | 2026-05-17 |
| **Status** | VEL-001/VEL-012 remediated; VEL-009/VEL-010 fixed; CI includes Trident fuzz smoke |

---

## Executive Summary

A focused security review was performed using the Solana-specific six-pattern checklist (arbitrary CPI, PDA validation, ownership checks, signer checks, sysvar handling, instruction introspection), manual instruction review, and alignment with the project's threat model.

**Overall:** The program follows Anchor security conventions consistently on token-moving paths. CPI targets are typed, PDAs use canonical seeds, privileged operations require signers, and `claim` / `withdraw` follow check-effects-interactions (CEI) before SPL transfers.

**Two high-severity issues** were identified and remediated:
- **VEL-001:** Double payout via `withdraw -> close_claim_record -> withdraw` on single-recipient streams.
- **VEL-012:** Pause+Cancel beneficiary lockout during 7-day grace period.

**Post-audit hardening:** On-chain Merkle proof length bounds (VEL-009), timing-safe admin API auth (VEL-010), and Trident fuzz smoke in CI.

No critical arbitrary-CPI, PDA spoofing, or missing-signer issues were found.

---

## Methodology

| Step | Description |
|---|---|
| Solana six-pattern scan | Arbitrary CPI, PDA, ownership, signer, sysvar, instruction introspection |
| DeFi vulnerability analysis | Anchor constraints, CPI/CEI ordering, SPL paths |
| Governance/liquidity triage | Centralization, vault authority, upgrade posture |
| Per-instruction review | Against documented attack tables |
| Supply-chain and memory safety | `cargo audit`, `cargo geiger`, `cargo tarpaulin` |
| Regression tests | Bankrun EXPLOIT 11; `security.spec.ts` EXPLOIT 1-12 |
| Trident fuzz | 100x15 instruction flows; CI smoke |
| Code maturity | Trail of Bits 9-category assessment |

### Build / Test Environment

| Step | Result |
|---|---|
| `cargo build-sbf` | Success |
| `anchor build --ignore-keys` | Success |
| `cargo audit` | 0 vulnerabilities; 1 allowed warning (bincode unmaintained) |
| `cargo geiger` | 0 unsafe in `vesting` crate |
| `cargo tarpaulin` | 6.68% line coverage (instruction handlers covered by TS integration tests) |
| Trident fuzz | Pass (100x15 flows) |

---

## Findings Summary

| ID | Severity | Title | Status |
|---|---|---|---|
| VEL-001 | **High** | Double payout via `withdraw -> close_claim_record -> withdraw` | **Fixed** |
| VEL-012 | **High** | Pause+Cancel Lockout -- grace-period claims blocked | **Fixed** |
| VEL-002 | Low | Trail of Bits `solana-lints` not enabled in CI | Open |
| VEL-003 | Informational | `update_root` does not reset existing `ClaimRecord` state | Accepted |
| VEL-004 | Informational | Multiple linear leaves per beneficiary share one `ClaimRecord` | Accepted |
| VEL-005 | Informational | `get_vested_amount` accepts caller-supplied `now` | Accepted |
| VEL-006 | Low | Transitive `bincode` 1.3.3 unmaintained (RUSTSEC-2025-0141) | Monitor |
| VEL-007 | Medium | Rust unit-test line coverage 6.68% | Mitigated by TS tests |
| VEL-008 | Informational | `leaf_hash` uses `expect` on borsh serialize | Accepted |
| VEL-009 | Low | Unbounded Merkle proof on `claim` (CU griefing) | **Fixed** |
| VEL-010 | Low | Admin sync route used non-timing-safe key compare | **Fixed** |

---

## Detailed Findings

### VEL-001 -- High -- Double Payout via Withdraw/Close/Withdraw

**Affected instructions:** `withdraw`, `close_claim_record`

**Description:** `ClaimRecord.total_entitled` was set on first touch in `claim` but not in `withdraw`. For stream campaigns (`leaf_count == 1`), `close_claim_record` allowed closure when `claimed_amount >= total_entitled`. With `total_entitled == 0`, a beneficiary could close the PDA after a partial withdraw, then re-initialize via `init_if_needed` with `claimed_amount = 0`.

**Attack scenario:**
1. `create_stream` with linear vesting; beneficiary calls `withdraw` at ~50% vesting.
2. `close_claim_record` succeeds (`total_entitled == 0`).
3. Second `withdraw` with fresh `ClaimRecord` claims ~50% again.

**Remediation:**
- `withdraw.rs`: On first-touch init, set `cr.total_entitled = leaf.amount`.
- `close_claim_record.rs`: Require `total_entitled > 0` before treating the record as fully claimed.

**Verification:** EXPLOIT 11 in `vesting.clock.spec.ts` (bankrun) and mirror test in `security.spec.ts`.

---

### VEL-012 -- High -- Pause+Cancel Beneficiary Lockout

**Affected instructions:** `cancel_campaign`, `cancel_stream`, `claim`, `withdraw`

**Description:** `cancel_campaign` set `cancelled_at` but did not reset `paused`. Beneficiaries on a paused-then-cancelled campaign could not claim vested tokens during the 7-day grace period (`CampaignPaused` error), while `unpause_campaign` was blocked by `cancelled_at`.

**Attack scenario:**
1. `pause_campaign` sets `paused = true`.
2. `cancel_campaign` sets `cancelled_at` but leaves `paused == true`.
3. Beneficiary calls `claim` during grace -> `CampaignPaused`.
4. After grace ends, creator calls `withdraw_unvested` and recovers vested amounts.

**Remediation:**
- `cancel_campaign.rs`: Clear `paused = false` on cancel.
- `claim.rs` / `withdraw.rs`: Defense-in-depth -- allow claims on cancelled campaigns regardless of pause state.

**Verification:** T69, T70, EXPLOIT 12, clock test.

---

### VEL-009 -- Low -- Unbounded Merkle Proof on Claim

**Description:** The `claim` instruction accepted a `Vec<[u8; 32]>` proof of arbitrary length, allowing CU waste.

**Remediation:**
- On-chain cap: `MAX_MERKLE_PROOF_LEN = 32` in `constants.rs`.
- Depth check: `proof.len() <= max_proof_len_for_leaf_count(tree.leaf_count)`.
- New error variant: `ProofTooLong` (6029).
- API validation: `.max(32)` in Zod schemas.

---

### VEL-010 -- Low -- Timing-Unsafe Admin API Key Check

**Description:** Admin sync route compared `x-admin-key` header with `!==`, enabling timing side-channel.

**Remediation:** `verifyAdminKey` now uses SHA-256 + `crypto.timingSafeEqual`.

---

### VEL-002 -- Low -- Static Solana Lints Not in Pipeline

Trail of Bits `solana-lints` are not configured in CI. **Status:** Open.

### VEL-003 -- Informational -- update_root and Existing Claim State

`update_root` may change `merkle_root` while existing `ClaimRecord` accounts retain prior state. This is a governance/operational risk, not a CPI or signer bypass. **Status:** Accepted.

### VEL-006 -- Low -- Transitive bincode Advisory

`bincode` 1.3.3 marked unmaintained (RUSTSEC-2025-0141), pulled transitively via Anchor. No memory-safety CVE reported. **Status:** Monitor upstream.

### VEL-007 -- Medium -- Low In-Crate Test Coverage

`cargo tarpaulin` reports 6.68% line coverage. Instruction handlers are covered by TypeScript integration tests (76+ tests). **Status:** Mitigated.

---

## Six-Pattern Solana Checklist

| Pattern | Severity | Result |
|---|---|---|
| Arbitrary CPI | Critical | **Pass** -- no raw `invoke`; typed `Program<Token>` |
| Improper PDA validation | Critical | **Pass** -- Anchor `seeds` + `bump` |
| Missing ownership check | High | **Pass** -- `Account<'info, T>` |
| Missing signer check | Critical | **Pass** -- `Signer<'info>` on privileged accounts |
| Sysvar spoofing | High | **Pass** -- `Sysvar<'info, Rent>` only |
| Instruction introspection | Medium | **N/A** -- not used |

---

## Instruction Review Matrix

| Instruction | Moves tokens | Key controls |
|---|---|---|
| `create_campaign` | No | `init` PDA, empty-root checks |
| `create_stream` | Yes (fund) | On-chain `leaf_hash` -> root, schedule validation |
| `fund_campaign` | Yes | `has_one` creator/vault, `OverFunded`, not cancelled |
| `claim` | Yes | Pause guard, beneficiary binding, Merkle proof, CEI, `total_entitled` |
| `withdraw` | Yes | `leaf_count == 1`, root hash bind, CEI, `total_entitled` |
| `cancel_campaign` | No | Cancel authority, one-shot `cancelled_at`, resets `paused` |
| `update_root` | No | Cancel authority, cancellable flag |
| `withdraw_unvested` | Yes | Creator, cancelled + grace period |
| `pause/unpause` | No | Pause authority |
| `close_claim_record` | No (rent) | Fully claimed or post-grace |
| `get_vested_amount` | No | View only |

---

## Code Maturity Assessment

Assessed using the Trail of Bits 9-category framework.

**Overall maturity: 2.8 / 4.0 (Moderate-Satisfactory)**

| Category | Rating | Score |
|---|---|---|
| Arithmetic | Satisfactory | 3 |
| Auditing | Moderate | 2 |
| Authentication / access controls | Moderate | 2 |
| Complexity management | Satisfactory | 3 |
| Decentralization | Moderate | 2 |
| Documentation | Strong | 4 |
| Transaction ordering risks | Satisfactory | 3 |
| Low-level manipulation | Strong | 4 |
| Testing & verification | Moderate | 2 |

### Top Strengths

1. **Documentation (Strong)** -- Threat model, per-instruction attack surfaces, and cross-language Merkle contract.
2. **Low-level safety (Strong)** -- No `unsafe`/assembly; CPIs limited to typed SPL Token; justified `UncheckedAccount` for vault PDA.
3. **Security regression testing** -- 12 exploit scenarios, golden-vector hash alignment, Trident fuzz in CI.

### Top Gaps

1. **Auditing / operations** -- Events exist but no documented monitoring alerts or incident-response runbook.
2. **Decentralization** -- `cancel_authority` can rotate roots; no on-chain multisig/timelock.
3. **Testing depth** -- Instruction handlers validated via TS/bankrun, not Rust unit tests; no formal verification.

---

## Test Coverage (Security-Relevant)

| Suite | Role |
|---|---|
| `security.spec.ts` | EXPLOIT 1-12: over-claim, wrong beneficiary, forged proof, oversized proof, milestone double-claim, grace/fund/pause/close abuses |
| `vesting.clock.spec.ts` | Bankrun clock/grace/withdraw; EXPLOIT 4 (vault drain), EXPLOIT 11 (VEL-001) |
| `vesting.supplementary.spec.ts` | Streams, milestones, edge cases (~50 tests) |
| `golden_vector.spec.ts` | Cross-language `leaf_hash` (Rust <-> TypeScript) |
| `trident-tests/fuzz_vesting/` | Fuzz harness: random instruction sequences; `total_claimed <= total_supply` invariant |

---

## Dependency and Static Analysis

### cargo audit

```
Scanning Cargo.lock for vulnerabilities (232 crate dependencies)
Crate:     bincode 1.3.3  --  Warning: unmaintained (RUSTSEC-2025-0141)
warning: 1 allowed warning found
```

No vulnerable crates reported at audit time.

### cargo geiger

**No `unsafe` Rust** in the first-party `vesting` package.

### cargo tarpaulin

6.68% coverage, 28/419 lines covered. Instruction handlers require integration coverage (VEL-007).

---

## Recommendations

### Before Mainnet

1. Deploy program build containing VEL-001 and VEL-012 fixes.
2. Run full `anchor test` in CI with correct program keypair.
3. Confirm no live `ClaimRecord` accounts with `total_entitled == 0`.

### Hardening (Non-Blocking)

4. Enable `solana-lints` in CI (VEL-002).
5. Run `cargo audit` in CI; fail on vulnerabilities.
6. Run `cargo geiger` in CI to fail if `unsafe` is introduced.
7. Add `proptest` for Merkle round-trip.
8. Publish monitoring/incident-response runbook.
9. Regenerate IDL after deploy to include `ProofTooLong` (6029).
10. Extend Trident to nightly long campaigns.

---

## Priority Improvement Roadmap

| Priority | Action | Effort |
|---|---|---|
| CRITICAL | Document program upgrade authority and deployment checklist | 0.5 day |
| CRITICAL | Verify VEL-001, VEL-009, VEL-012 on deployed binary | 1 day |
| HIGH | `proptest` for Merkle round-trip in CI | 3-5 days |
| HIGH | Monitoring + IR runbook | 2-3 days |
| HIGH | Multisig for cancel/pause authorities | 1 day |
| MEDIUM | Refactor shared claim/withdraw core | 2-3 days |
| MEDIUM | Enable solana-lints in CI | 1-2 days |
| MEDIUM | Optional external re-audit | 2-4 weeks |

---

*This report is a point-in-time technical review. Re-audit after material program changes.*
