# Security Audit Report — Velthoryn Vesting Program

| Field | Value |
|-------|--------|
| **Author** | Daemon Blockint Technologies |
| **Program** | `vesting` |
| **Program ID** | `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` |
| **Framework** | Anchor 1.0.0 |
| **Scope** | `programs/vesting/` (on-chain program only) |
| **Audit date** | 2026-05-17 |
| **Last updated** | 2026-05-17 (post-audit hardening + maturity pass) |
| **Status** | VEL-001 remediated; VEL-009/VEL-010 fixed; CI includes Trident fuzz smoke |
| **Frameworks** | Solana DeFi vulnerability analyst, DeFi security audit agent, six-pattern scanner, Trail of Bits code maturity (9-category) |
| **Tooling** | `cargo audit`, `cargo geiger`, `cargo tarpaulin`, Trident (`trident-tests/`) |
| **Companion** | [SECURITY.md](./SECURITY.md), [PROGRAM.md](./PROGRAM.md), [MATURITY_REPORT.md](./MATURITY_REPORT.md) |

---

## 1. Executive summary

A focused security review of the Velthoryn vesting program was performed using the Solana-specific six-pattern checklist (arbitrary CPI, PDA validation, ownership checks, signer checks, sysvar handling, instruction introspection), manual instruction review, and alignment with the project’s documented threat model.

**Overall:** The program follows Anchor security conventions consistently on token-moving paths. CPI targets are typed, PDAs use canonical seeds, privileged operations require signers, and `claim` / `withdraw` follow check-effects-interactions (CEI) before SPL transfers.

**One high-severity issue** was identified in the interaction between `withdraw` and `close_claim_record`, allowing a beneficiary on single-recipient streams to reset per-user claim accounting and receive duplicate payouts for the same vested tranche. **Remediation has been implemented** in program code and covered by regression tests (EXPLOIT 11 in `security.spec.ts` and `vesting.clock.spec.ts`).

**Post-audit hardening (same release train):** on-chain **Merkle proof length bounds** (VEL-009), **timing-safe admin API auth** for the sync route (VEL-010), and **Trident fuzz smoke** in CI. No new high-severity on-chain issues were found in these changes.

No critical arbitrary-CPI, PDA spoofing, or missing-signer issues were found in the reviewed codebase.

**Extended pass:** Solana DeFi vulnerability pattern review (§6) and DeFi governance/liquidity triage (§7) found no additional fund-flow defects. **Rust toolchain:** `cargo audit` reported zero vulnerabilities (one allowed transitive unmaintained `bincode` warning, VEL-006); `cargo geiger` reported **zero `unsafe`** in the `vesting` crate; `cargo tarpaulin` measured **6.68%** in-crate line coverage because instruction handlers are exercised by TypeScript integration/bankrun tests rather than Rust unit tests (VEL-007). **Code maturity** (Trail of Bits 9-category framework): overall **2.8 / 4.0** — see [MATURITY_REPORT.md](./MATURITY_REPORT.md).

---

## 2. Scope and methodology

### 2.1 In scope

- All 12 program instructions in `programs/vesting/src/`
- Account validation constraints (`#[derive(Accounts)]`)
- Cross-program invocations (SPL Token, Associated Token, System)
- PDA derivations: `tree`, `vault_authority`, `claim`
- Merkle proof verification and vesting schedule math
- Existing exploit tests in `tests/security.spec.ts`

### 2.2 Out of scope

- Web app (`apps/web/`), TypeScript client, indexer, API routes *(original audit; supplemental review VEL-010 for admin sync auth only)*
- Economic / governance policy (e.g. trust in `cancel_authority` for `update_root`)
- Formal verification, long-running fuzz campaigns, mainnet deployment key management
- Third-party dependencies beyond version pins in `Cargo.toml`

**In scope (post-audit):** Trident fuzz harness smoke in CI (`trident-tests/fuzz_vesting/`); on-chain Merkle proof bounds (VEL-009).

### 2.3 Methodology

1. **Solana six-pattern scan** — arbitrary CPI, PDA, ownership, signer, sysvar, instruction introspection
2. **Solana DeFi vulnerability analyst** — Anchor constraints, CPI/CEI ordering, oracle/AMM checklist (N/A where not applicable), SPL paths
3. **DeFi security audit agent** — governance centralization, liquidity/vault authority, upgrade posture, historical exploit alignment
4. Per-instruction review against [SECURITY.md](./SECURITY.md) attack tables
5. **Supply-chain & memory safety** — `cargo audit`, `cargo geiger`, `cargo tarpaulin` on `programs/vesting`
6. Regression tests — **solana-bankrun** EXPLOIT 11; `tests/security.spec.ts` EXPLOIT 1–11
7. **Trident fuzz** — `fuzz_vesting` harness (100×15 instruction flows); CI smoke after `anchor test`
8. **Code maturity** — Trail of Bits 9-category assessment ([MATURITY_REPORT.md](./MATURITY_REPORT.md))

### 2.4 Build / test environment

| Step | Result |
|------|--------|
| `cargo build-sbf` (program) | Success |
| `anchor build --ignore-keys` | Success (local deploy keypair ≠ `declare_id!`; see §12) |
| `cargo audit` (workspace) | **0 vulnerabilities**; 1 allowed warning (bincode unmaintained, transitive) |
| `cargo geiger` (`programs/vesting`) | **0 unsafe** fns/blocks/exprs in `vesting` crate |
| `cargo tarpaulin` (`programs/vesting`) | **6.68%** line coverage (unit tests only; see §11) |
| `ts-mocha` … `--grep 'EXPLOIT 11'` (bankrun) | **1 passing** |
| Trident `fuzz_vesting` (CI smoke) | **Pass** (`FUZZING_METRICS=1`, 100×15 flows) |

---

## 3. Architecture (audit context)

```text
Creator ──► create_campaign / create_stream ──► VestingTree PDA
                      │
                      ▼
              fund_campaign / create_stream CPI
                      │
                      ▼
         Vault (SPL ATA) ◄── authority: vault_authority PDA
                      │
Beneficiary ──► claim (Merkle proof)  OR  withdraw (leaf_count == 1)
                      │
                      ▼
              ClaimRecord PDA (per tree + beneficiary)
```

**Trusted roles:** `creator`, optional `cancel_authority`, optional `pause_authority`.  
**Untrusted:** `beneficiary` and all instruction data (`VestingLeaf`, proofs, `WithdrawArgs`).

---

## 4. Findings summary

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| VEL-001 | **High** | Double payout via `withdraw` → `close_claim_record` → `withdraw` | **Fixed** |
| VEL-002 | Low | Trail of Bits `solana-lints` not enabled in CI | Open |
| VEL-003 | Informational | `update_root` does not reset existing `ClaimRecord` state | Accepted (governance) |
| VEL-004 | Informational | Multiple linear leaves per beneficiary share one `ClaimRecord` | Accepted (design) |
| VEL-005 | Informational | `get_vested_amount` accepts caller-supplied `now` | Accepted (view-only) |
| VEL-006 | Low | Transitive `bincode` 1.3.3 unmaintained (RUSTSEC-2025-0141) | Monitor upstream |
| VEL-007 | Medium | Rust unit-test line coverage 6.68%; instruction handlers untested in-crate | Mitigated by TS integration tests |
| VEL-008 | Informational | `leaf_hash` uses `expect` on borsh serialize | Accepted (infallible layout) |
| VEL-009 | Low | Unbounded Merkle `proof` vector on `claim` (CU griefing) | **Fixed** |
| VEL-010 | Low | Admin sync route used non–timing-safe key compare | **Fixed** (web) |

---

## 5. Detailed findings

### VEL-001 — High — Premature close resets withdraw accounting (double payout)

**Affected instructions:** `withdraw`, `close_claim_record`  
**Files:** `programs/vesting/src/instructions/withdraw.rs`, `close_claim_record.rs`

#### Description

`ClaimRecord.total_entitled` is set on first touch in `claim` but was **not** set in `withdraw`. For stream campaigns (`create_stream`, `leaf_count == 1`), beneficiaries use `withdraw` instead of `claim`.

`close_claim_record` allowed closure when `claimed_amount >= total_entitled`. With `total_entitled == 0`, any non-negative `claimed_amount` satisfied “fully claimed,” so a beneficiary could close the PDA after a **partial** withdraw.

`withdraw` uses `init_if_needed` on `ClaimRecord`. After close, a subsequent `withdraw` re-initialized `claimed_amount` to `0` while vesting math used `vested(now) - claimed_amount`, enabling a **second payout for the same vested tranche**. Global `vesting_tree.total_claimed` still incremented, but a partial stream could pay out far more than the schedule intended before hitting `OverClaim` or draining the vault.

#### Attack scenario

1. `create_stream` with linear vesting; beneficiary calls `withdraw` at ~50% vesting.
2. `close_claim_record` succeeds (`total_entitled == 0`).
3. Second `withdraw` with fresh `ClaimRecord` claims ~50% again (same effective vested amount).

#### Remediation (implemented)

1. **`withdraw.rs`** — on first-touch init, set `cr.total_entitled = leaf.amount` (matches `claim`):

```100:110:programs/vesting/src/instructions/withdraw.rs
    // First-touch init of ClaimRecord
    let cr = &mut ctx.accounts.claim_record;
    if cr.beneficiary == Pubkey::default() {
        cr.tree = tree_key;
        cr.beneficiary = ctx.accounts.beneficiary.key();
        cr.claimed_amount = 0;
        cr.total_entitled = leaf.amount;
        cr.milestone_bitmap = [0u8; 32];
        cr.last_claim_at = 0;
        cr.bump = ctx.bumps.claim_record;
```

2. **`close_claim_record.rs`** — require `total_entitled > 0` before treating the record as fully claimed:

```29:40:programs/vesting/src/instructions/close_claim_record.rs
    // total_entitled must be set (claim/withdraw first-touch); blocks close after
    // withdraw-only records that never stored entitlement (double-withdraw via re-init).
    let fully_claimed =
        cr.total_entitled > 0 && cr.claimed_amount >= cr.total_entitled;
    let post_grace = match tree.cancelled_at {
        Some(c) => {
            let grace_end = c.checked_add(GRACE_PERIOD_SECS).ok_or(VestingError::Overflow)?;
            Clock::get()?.unix_timestamp >= grace_end
        }
        None => false,
    };
    require!(fully_claimed || post_grace, VestingError::CannotClose);
```

**Reference (unchanged on `claim` path)** — `claim` already set entitlement on first touch:

```93:99:programs/vesting/src/instructions/claim.rs
    // First-touch init of ClaimRecord (step 6 per SECURITY.md)
    let cr = &mut ctx.accounts.claim_record;
    if cr.beneficiary == Pubkey::default() {
        cr.tree = tree_key;
        cr.beneficiary = ctx.accounts.beneficiary.key();
        cr.claimed_amount = 0;
        cr.total_entitled = leaf.amount;
```

**Before fix:** `close_claim_record` used `claimed_amount >= total_entitled` without `total_entitled > 0`, so `total_entitled == 0` after a withdraw-only `ClaimRecord` allowed premature close and `init_if_needed` reset on the next `withdraw`.

#### Verification

- **EXPLOIT 11** in `tests/vesting.clock.spec.ts` (bankrun): partial withdraw → `CannotClose` (6027) → second withdraw → `NothingToClaim` (6015). **Passing.**
- Mirror test in `tests/security.spec.ts` for validator-based CI.

#### References

- Internal: [SECURITY.md](./SECURITY.md) §2.3b (`withdraw`), ClaimRecord lifecycle
- Pattern: missing state invariant on `init_if_needed` + account close (CEI adjacent)

---

### VEL-002 — Low — Static Solana lints not in pipeline

**Description:** [Trail of Bits solana-lints](https://github.com/trailofbits/solana-lints) are not configured in `programs/vesting/Cargo.toml` or CI.

**Recommendation:** Add lint configuration and run in CI alongside `anchor build`.

**Status:** Open

---

### VEL-003 — Informational — `update_root` and existing claim state

**Description:** `update_root` may change `merkle_root` and `leaf_count` while existing `ClaimRecord` accounts retain prior `claimed_amount` / `total_entitled`. This is a **governance / operational** risk when `cancel_authority` rotates allocations, not a bypass of CPI or signer checks.

**Recommendation:** Document operator playbook: pause → migrate beneficiaries → or accept that root updates are only safe before claims. Already partially covered in SECURITY.md.

**Status:** Accepted

---

### VEL-004 — Informational — One `ClaimRecord` per beneficiary per tree

**Description:** PDA seeds `[b"claim", tree, beneficiary]` enforce one record per beneficiary per campaign. Multiple **milestone** leaves per beneficiary are supported via `milestone_bitmap` (test T11). Multiple **linear** leaves for the same beneficiary share `claimed_amount`; the second leaf’s schedule math subtracts all prior claims, which can **under-claim** rather than over-claim.

**Recommendation:** Enforce at tree-build time: at most one linear/cliff leaf per beneficiary, or document the shared-record behavior in operator docs.

**Status:** Accepted (design)

---

### VEL-005 — Informational — `get_vested_amount` caller-supplied time

**Description:** `get_vested_amount` takes `now: i64` from the client. No funds move; result is only as trustworthy as the supplied clock.

**Status:** Accepted (view helper)

---

### VEL-006 — Low — Transitive `bincode` advisory (unmaintained)

**Tool:** `cargo audit` (workspace root, 232 crate dependencies)

**Finding:** [RUSTSEC-2025-0141](https://rustsec.org/advisories/RUSTSEC-2025-0141) — `bincode` 1.3.3 marked **unmaintained**, pulled transitively via `anchor-lang` / `anchor-spl` / Solana sysvar crates. **No memory-safety CVE** reported in this scan.

**Recommendation:** Track Anchor/Solana dependency upgrades; no direct `bincode` pin in `programs/vesting/Cargo.toml`.

**Status:** Open (upstream)

---

### VEL-007 — Medium — Low in-crate test coverage (tarpaulin)

**Tool:** `cargo tarpaulin` on `programs/vesting` (12 unit tests in `math/`)

| Module | Lines covered |
|--------|----------------|
| `math/merkle.rs` | 11/11 (100%) |
| `math/schedule.rs` | 16/19 (~84%) |
| All `instructions/*.rs` | **0** (covered by TypeScript `anchor test` / bankrun, not tarpaulin) |
| **Total** | **28/419 (6.68%)** |

**Interpretation:** Security-critical instruction logic is validated by **integration tests** (`tests/security.spec.ts`, `vesting.supplementary.spec.ts`, `vesting.clock.spec.ts`), not Rust unit tests. This is acceptable for Anchor projects but increases regression risk if instruction handlers change without running the full TS suite.

**Recommendation:** Add bankrun EXPLOIT 11 to CI; optionally add `#[cfg(test)]` instruction tests or document “integration-only” coverage in CI gates.

**Status:** Open (process)

---

### VEL-008 — Informational — `leaf_hash` panics on borsh failure

**File:** `programs/vesting/src/math/merkle.rs`

```10:12:programs/vesting/src/math/merkle.rs
pub fn leaf_hash(leaf: &VestingLeaf) -> [u8; 32] {
    let serialized = borsh::to_vec(leaf).expect("borsh: VestingLeaf");
    hashv(&[&[LEAF_PREFIX], &serialized]).to_bytes()
```

`VestingLeaf` is a fixed `AnchorSerialize` layout; borsh failure would indicate program bug, not user input. Prefer `?` + `VestingError` for consistency with no-panic discipline — optional hardening.

**Status:** Accepted

---

### VEL-009 — Low — Unbounded Merkle proof on `claim`

**Affected instruction:** `claim`  
**Files:** `programs/vesting/src/instructions/claim.rs`, `constants.rs`, `math/merkle.rs`, `errors.rs`

#### Description

The `claim` instruction accepted a `Vec<[u8; 32]>` proof of arbitrary length. A malicious client could submit an oversized proof to waste compute units before `InvalidProof`, even though valid trees need at most `ceil(log2(leaf_count))` siblings (and at most 32 for a `u32` leaf index).

#### Remediation (implemented)

**On-chain cap and depth check** (`constants.rs` + `claim.rs`):

```3:4:programs/vesting/src/constants.rs
/// Hard cap on Merkle proof siblings per claim (matches max depth for `u32` leaf indices).
pub const MAX_MERKLE_PROOF_LEN: usize = 32;
```

```15:22:programs/vesting/src/math/merkle.rs
/// Maximum proof siblings required for a tree with `leaf_count` leaves (`ceil(log2(n))`, 0 for n≤1).
pub fn max_proof_len_for_leaf_count(leaf_count: u32) -> usize {
    if leaf_count <= 1 {
        0
    } else {
        (32 - (leaf_count - 1).leading_zeros()) as usize
    }
}
```

```78:91:programs/vesting/src/instructions/claim.rs
    require!(
        proof.len() <= MAX_MERKLE_PROOF_LEN,
        VestingError::ProofTooLong
    );
    require!(
        proof.len() <= max_proof_len_for_leaf_count(tree.leaf_count),
        VestingError::ProofTooLong
    );

    let hash = leaf_hash(&leaf);
    require!(
        verify_merkle_proof(hash, &proof, leaf.leaf_index, tree.merkle_root),
        VestingError::InvalidProof
    );
```

**Error variant** (`errors.rs`): `ProofTooLong` — Anchor code **6029**.

**API validation** (`validators.ts`):

```30:32:apps/web/src/lib/api/validators.ts
  proof: z
    .array(z.array(z.number().int().min(0).max(255)).length(32))
    .max(32),
```

**Regression test** — append 32 dummy siblings to a valid proof; expect `ProofTooLong`:

```294:314:tests/security.spec.ts
    const validProof = tree.proof(0);
    const oversizedProof = [
      ...validProof,
      ...Array.from({ length: 32 }, () => Buffer.alloc(32, 0xaa)),
    ];

    try {
      await issueClaim(
        { program },
        leaf0,
        oversizedProof,
        beneficiary0,
        treePda,
        vaultAuthPda,
        vault,
        mint,
      );
      expect.fail("EXPLOIT 4 SUCCEEDED: oversized proof should have been rejected");
    } catch (e) {
      expectAnchorError(e, ERR.ProofTooLong);
    }
```

#### Verification

- Unit test `max_proof_len_for_leaf_count_values` in `math/merkle.rs`.
- Integration test EXPLOIT 4 (validator).

**Note:** Regenerate `apps/web/src/lib/anchor/idl.json` after deploy so clients map `ProofTooLong`.

**Status:** Fixed

---

### VEL-010 — Low — Timing-unsafe admin API key check (web)

**Scope:** Out of original on-chain audit; tracked here for release completeness.  
**File:** `apps/web/src/app/api/admin/sync/route.ts`

#### Description

The admin sync route compared the `x-admin-key` header to `process.env.ADMIN_API_KEY` with `!==`, enabling timing side-channel guessing on the secret.

#### Remediation (implemented)

**Timing-safe compare** (hash both sides, then `timingSafeEqual` — avoids byte-by-byte short-circuit on the raw secret):

```5:9:apps/web/src/lib/auth.ts
function timingSafeCompare(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a, "utf-8").digest();
  const hashB = createHash("sha256").update(b, "utf-8").digest();
  return timingSafeEqual(hashA, hashB);
}
```

```20:26:apps/web/src/lib/auth.ts
export function verifyAdminKey(request: NextRequest): NextResponse | null {
  const adminKey = request.headers.get("x-admin-key");
  const secret = process.env.ADMIN_API_KEY;
  if (!secret || !adminKey || !timingSafeCompare(adminKey, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
```

**Route** — no direct `!==` on the header:

```5:9:apps/web/src/app/api/admin/sync/route.ts
export async function POST(request: NextRequest) {
  const authError = verifyAdminKey(request);
  if (authError) {
    return authError;
  }
```

#### Verification

- `apps/web/tests/lib/auth.test.ts` (9 tests)
- `apps/web/tests/api/backend.test.ts` admin sync cases (6 tests)

**Status:** Fixed

---

## 6. Solana DeFi vulnerability pattern review

Structured pass per **solana-defi-vulnerability-analyst-agent** (defensive triage; no exploit guidance).

| Area | Assessment | Evidence |
|------|------------|----------|
| **PDA / authority** | **Pass** | `tree`, `vault_authority`, `claim` seeds + bumps; `has_one` / `address` on vault/mint |
| **CPI / ordering** | **Pass** | CEI before SPL transfer on `claim`/`withdraw`; typed `Program<Token>` |
| **Oracle / price** | N/A | No external price feeds |
| **Liquidity / AMM** | N/A | Not an AMM; vault is campaign-scoped SPL ATA |
| **SPL / token** | **Pass** | Mint mismatch constraints; vault bound to `vesting_tree.vault`; Token program typed |
| **MEV / slippage** | N/A | Fixed schedule payouts, not swap paths |
| **Launch / bonding** | N/A | Merkle vesting only |
| **Upgradeability** | **Review** | Standard Solana BPF upgrade model — verify **upgrade authority** on deployed program ID before mainnet promotion (operational; not in repo) |

**`UncheckedAccount` on `vault_authority`:** Intentional PDA signer only; constrained via `seeds = [b"vault_authority", vesting_tree.key()], bump` on every token-moving instruction. **Not** a missing validation issue.

**Arithmetic:** `checked_add` on accounting paths; linear vesting uses `u128` intermediate multiply; `profile.release` enables `overflow-checks = true`.

---

## 7. DeFi governance, liquidity, and tokenomics (defi-security-audit-agent)

| Topic | Finding |
|-------|---------|
| **Liquidity / vault** | Tokens held in vault ATA owned by `vault_authority` PDA; withdrawals only via program CPI with PDA signer |
| **LP / locks** | N/A (not LP-based) |
| **Mint authority** | Campaign `mint` is user-supplied but constrained on fund/claim paths (`MintMismatch`, ATA mint) |
| **Vesting** | Schedules committed in Merkle root; `total_supply` caps global payouts |
| **Governance** | `cancel_authority` / `pause_authority` optional; `update_root` is privileged — **trust assumption** |
| **Upgrade** | Program deployable via BPF loader; document who holds upgrade key on `G6iaig…` |
| **Emergency** | `pause_campaign`, `cancel_campaign`, `withdraw_unvested` after grace — all signer-gated |
| **Bridges** | None |

**Rug-risk framing (public data only):** Protocol is **creator-funded vault + Merkle allowlist**, not a bonding-curve launch. Residual risk is **misconfigured root**, **underfunded vault**, or **compromised cancel/pause keys** — operational, not arbitrary CPI.

---

## 8. Six-pattern Solana checklist (no issues)

| Pattern | Severity | Result | Notes |
|---------|----------|--------|-------|
| Arbitrary CPI | Critical | **Pass** | No raw `invoke` / `invoke_signed`; `Program<'info, Token>` etc. |
| Improper PDA validation | Critical | **Pass** | Anchor `seeds` + `bump`; `vault_authority` constrained |
| Missing ownership check | High | **Pass** | `Account<'info, T>` on deserialized state |
| Missing signer check | Critical | **Pass** | `Signer<'info>` on privileged accounts |
| Sysvar spoofing | High | **Pass** | `Sysvar<'info, Rent>` only; no legacy introspection |
| Instruction introspection | Medium | **N/A** | Not used |

---

## 9. Instruction review matrix (high level)

| Instruction | Moves tokens | Key controls |
|-------------|--------------|--------------|
| `create_campaign` | No | `init` PDA, empty-root checks |
| `create_stream` | Yes (fund) | On-chain `leaf_hash` → root, schedule validation |
| `fund_campaign` | Yes | `has_one` creator/vault, `OverFunded`, not cancelled |
| `claim` | Yes | pause, beneficiary binding, Merkle proof, CEI, `total_entitled` |
| `withdraw` | Yes | `leaf_count == 1`, root hash bind, CEI, **`total_entitled` (fixed)** |
| `cancel_campaign` | No | cancel authority, one-shot `cancelled_at` |
| `update_root` | No | cancel authority, cancellable flag |
| `withdraw_unvested` | Yes | creator, cancelled + grace period |
| `pause_campaign` / `unpause_campaign` | No | pause authority |
| `close_claim_record` | No (rent) | **fully claimed or post-grace (fixed)** |
| `get_vested_amount` | No | view only |

---

## 10. Test coverage (security-relevant)

| Suite | Role |
|-------|------|
| `tests/security.spec.ts` | **EXPLOIT 1–11** (validator): over-claim, wrong beneficiary, forged proof, **oversized proof (VEL-009)**, milestone double-claim, grace/fund/pause/close abuses, **VEL-001** withdraw-close-withdraw |
| `tests/vesting.clock.spec.ts` | Bankrun clock/grace/withdraw; **EXPLOIT 4** (vault drain after grace), **EXPLOIT 11** (VEL-001 regression) |
| `tests/vesting.supplementary.spec.ts` | Streams, milestones, edge cases (~50 tests) |
| `tests/golden_vector.spec.ts` | Cross-language `leaf_hash` (Rust ↔ TypeScript) |
| `trident-tests/fuzz_vesting/` | Fuzz harness: random instruction sequences; invariant `total_claimed <= total_supply`; VEL-001 regression flow |
| `docs/DEVNET_TEST_RESULTS.md` | Historical devnet pass log |

**Naming note:** EXPLOIT 4 in `security.spec.ts` (oversized Merkle proof) differs from EXPLOIT 4 in `vesting.clock.spec.ts` (claim after vault withdrawal). Same label, different files.

**Gap:** Full `anchor test` locally requires `target/deploy/vesting-keypair.json` matching `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` (CI: `PROGRAM_KEYPAIR_JSON` secret).

---

## 11. Dependency and static analysis (tool output)

### 11.1 `cargo audit`

```text
Scanning Cargo.lock for vulnerabilities (232 crate dependencies)
Crate:     bincode 1.3.3  —  Warning: unmaintained (RUSTSEC-2025-0141)
warning: 1 allowed warning found
```

No **vulnerable** crates reported at audit time.

### 11.2 `cargo geiger` (`programs/vesting`)

```text
vesting 0.1.0    0/0    0/0    0/0    0/0    0/0    ?
```

**No `unsafe` Rust** in the first-party `vesting` package. Dependency tree contains `unsafe` in crates such as `libc`, `sha2`, `bytemuck` (expected).

### 11.3 `cargo tarpaulin` (`programs/vesting`)

```text
6.68% coverage, 28/419 lines covered
12 tests passed (math::merkle, math::schedule, test_id)
```

Instruction handlers require **integration** coverage (see VEL-007).

---

## 12. Recommendations (post-audit)

### Before mainnet upgrade

1. **Deploy** program build containing VEL-001 fix to devnet/mainnet per release process.
2. **Run** full `anchor test` in CI (or locally with correct program keypair).
3. **Confirm** no live `ClaimRecord` accounts were created via `withdraw` only with `total_entitled == 0` (unlikely on devnet; if any, treat as migration: close only after manual entitlement review).

### Hardening (non-blocking)

4. Enable **solana-lints** in `Cargo.toml` / CI (VEL-002).
5. ~~Cap Merkle proof depth~~ — **done on-chain** (VEL-009); keep tree builder aligned with `max_proof_len_for_leaf_count`.
6. ~~EXPLOIT 11 in CI~~ — covered by full `anchor test` + bankrun tests in `vesting.clock.spec.ts`.
7. Run **`cargo audit`** in CI on workspace lockfile; fail on vulnerabilities (warnings policy per team).
8. Run **`cargo geiger`** on `programs/vesting` in CI to fail if first-party `unsafe` is introduced.
9. Track **VEL-006** via Anchor/Solana dependency bumps.
10. Add **`proptest`** for Merkle round-trip in CI (SECURITY.md §4.3 Phase 2).
11. Publish **monitoring / incident-response** runbook for `RootUpdated`, large `Claimed`, pause/cancel (see [MATURITY_REPORT.md](./MATURITY_REPORT.md) §2).
12. Regenerate **IDL** after deploy to include `ProofTooLong` (6029).
13. Extend **Trident** to nightly long campaigns with fixed regression seeds.

---

## 13. Conclusion

The Velthoryn vesting program demonstrates solid Anchor hygiene on the primary fund-flow instructions. The only **high-severity** issue in this audit—**VEL-001** (stream withdraw / close accounting)—has been **remediated** and **verified** by EXPLOIT 11. Post-audit hardening added **on-chain proof bounds** (VEL-009), **timing-safe admin auth** (VEL-010), and **Trident fuzz smoke** in CI.

Remaining open items are **low or informational** (VEL-002 lints, VEL-006 upstream `bincode`, VEL-007 in-crate coverage metric, governance trust on `update_root`). They do not block deployment of the remediated build, subject to normal release QA, upgrade-authority review, and keypair-aligned CI runs.

---

## 14. Code maturity assessment (summary)

Full report: [MATURITY_REPORT.md](./MATURITY_REPORT.md) (Trail of Bits 9-category framework, 2026-05-17).

| Category | Rating | Score |
|----------|--------|-------|
| Arithmetic | Satisfactory | 3 |
| Auditing | Moderate | 2 |
| Authentication / access controls | Moderate | 2 |
| Complexity management | Satisfactory | 3 |
| Decentralization | Moderate | 2 |
| Documentation | Strong | 4 |
| Transaction ordering risks | Satisfactory | 3 |
| Low-level manipulation | Strong | 4 |
| Testing & verification | Moderate | 2 |
| **Overall average** | **Moderate–Satisfactory** | **2.8** |

**Top strengths:** documentation, low-level safety (no first-party `unsafe`), structured exploit + golden-vector tests.  
**Top gaps:** operational monitoring/IR not in-repo, governance keys not multisig on-chain, low Rust tarpaulin % mitigated by TS integration tests.

---

## Appendix A — Files changed in remediation / hardening

| File | Change |
|------|--------|
| `programs/vesting/src/instructions/withdraw.rs` | Set `total_entitled` on `ClaimRecord` first touch (VEL-001) |
| `programs/vesting/src/instructions/close_claim_record.rs` | Require `total_entitled > 0` for “fully claimed” close (VEL-001) |
| `programs/vesting/src/constants.rs` | `MAX_MERKLE_PROOF_LEN` (VEL-009) |
| `programs/vesting/src/math/merkle.rs` | `max_proof_len_for_leaf_count` + unit test (VEL-009) |
| `programs/vesting/src/instructions/claim.rs` | Proof length checks before verify (VEL-009) |
| `programs/vesting/src/errors.rs` | `ProofTooLong` (6029) (VEL-009) |
| `apps/web/src/lib/api/validators.ts` | `proof` max 32 (VEL-009) |
| `apps/web/src/app/api/admin/sync/route.ts` | `verifyAdminKey()` (VEL-010) |
| `tests/security.spec.ts` | EXPLOIT 4 (proof bound), EXPLOIT 11 (VEL-001) |
| `tests/vesting.clock.spec.ts` | EXPLOIT 11 (bankrun) |
| `.github/workflows/ci.yml` | Trident fuzz smoke |
| `trident-tests/` | Fuzz harness + `Trident.toml` |

## Appendix B — Auditor tooling

| Tool | Command / scope |
|------|------------------|
| Six-pattern scanner | Manual + `rg` on `programs/vesting` |
| Solana DeFi vulnerability analyst | §6 pattern table |
| DeFi security audit agent | §7 governance / liquidity |
| `cargo audit` | `cargo audit` @ workspace root |
| `cargo geiger` | `cargo geiger` @ `programs/vesting` |
| `cargo tarpaulin` | `cargo tarpaulin` @ `programs/vesting` |
| Build | `cargo build-sbf`, `anchor build --ignore-keys` |
| Integration tests | `pnpm exec ts-mocha` + solana-bankrun |
| Trident | `trident-tests/fuzz_vesting` |
| Code maturity | Trail of Bits 9-category ([MATURITY_REPORT.md](./MATURITY_REPORT.md)) |

---

*This report is a point-in-time technical review prepared by **Daemon Blockint Technologies** and does not constitute a formal certificate or warranty. Re-audit after material program changes.*
