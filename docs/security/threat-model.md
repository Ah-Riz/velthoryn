# Threat Model

Security design for the Velthoryn vesting program. Covers trust boundaries, vulnerability map, exploit remediations, and what Anchor enforces automatically vs. what must be manually coded.

**Program ID:** `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`
**Framework:** Anchor 1.0.0
**Tests passing:** 265 (12 instructions, 31 error variants)

---

## Trust Boundary Diagram

```
+=========================================================================+
|                    ON-CHAIN (program enforced)                           |
|                                                                         |
|  +-----------------+   seeds+bump   +----------------------------------+|
|  |  VestingTree    |<--------------|  Program (Anchor 1.0)              ||
|  |  PDA            |               |  Discriminator on every account    ||
|  |  merkle_root <--+-- update_root |  Signer<'info> on every privilege  ||
|  |  cancelled_at   |               |  Account<'info,T> ownership checks ||
|  |  paused         |               +----------------------------------+||
|  +--------+--------+                                                    |
|           | vault field                                                 |
|           v                                                             |
|  +-----------------+   PDA signer   +----------------------------------+|
|  |  Vault          |<--------------|  VaultAuthority (PDA, zero data)   ||
|  |  SPL Token ATA  |   token CPI   |  seeds=[b"vault_authority",tree]  ||
|  +-----------------+               +----------------------------------+||
|                                                                         |
|  +-----------------+                                                    |
|  |  ClaimRecord    |  tracks claimed_amount and milestone_bitmap per    |
|  |  PDA            |  (tree, beneficiary) -- prevents double-spend      |
|  +-----------------+                                                    |
+=========================================================================+
                |                         |
                | TRUSTED                 | UNTRUSTED -- verified on-chain
                v                         v
+=========================+  +============================================+
|  OFF-CHAIN (not trusted)|  |  Leaf + proof submitted by beneficiary     |
|                         |  |                                            |
|  IPFS / R2 leaf JSON    |  |  Program does NOT trust these values.      |
|  TS Merkle tree builder |  |  Every field of VestingLeaf is hashed and  |
|  Frontend / SDK         |  |  verified against merkle_root before use.  |
|  creator keypair        |  |  leaf.beneficiary checked against signer.  |
+=========================+  +============================================+
```

---

## Actors

| Actor | Trust level | What they control |
|---|---|---|
| **Creator** | Trusted at setup; untrusted post-deploy | `campaign_id`, `merkle_root`, `total_supply`, `cancellable` flag |
| **Cancel / pause authority** | Trusted (holds a keypair or multisig) | `cancel_campaign`, `update_root`, `pause_campaign` |
| **Beneficiary** | Untrusted | Their own signing key; the `VestingLeaf` and proof they submit |
| **Anonymous / attacker** | Fully untrusted | Network access; can craft any transaction |

## Assets

| Asset | Location | Value |
|---|---|---|
| **Vault tokens** | SPL Token ATA owned by `vault_authority` PDA | Full campaign supply -- up to millions of USD |
| **VestingTree state** | Program PDA | Controls who can claim, when, and how much |
| **ClaimRecord state** | Program PDA | Records what each beneficiary has already received |

## Attacker Goals

1. Drain vault tokens (steal from creator or other beneficiaries)
2. Claim more tokens than the vesting schedule allows
3. Claim someone else's tokens
4. Prevent legitimate beneficiaries from claiming
5. Forge a Merkle proof to inject a fake recipient
6. Corrupt `VestingTree` state to change the root or `total_supply`

---

## What Anchor Enforces Automatically

These protections require no custom handler code:

| Protection | Mechanism |
|---|---|
| Account ownership | `Account<'info, T>` rejects accounts not owned by this program |
| 8-byte discriminator | Deserialization fails if discriminator does not match (prevents type-cosplay) |
| Signer enforcement | `Signer<'info>` enforces that the account signed the transaction |
| Program ID validation | `Program<'info, T>` enforces the exact program ID (prevents fake token program) |
| PDA derivation | `seeds` + `bump` derives and verifies the expected PDA address |
| Field binding | `has_one = field` enforces `account.field == named_account.key()` |
| Address binding | `address = expr` enforces an exact pubkey match |
| Init uniqueness | `init` fails with `AccountAlreadyInitialized` if the account already exists |
| Account close | `close = target` zeroes account data and transfers lamports atomically |

## What Must Be Manually Coded

Failure to implement these is a vulnerability:

- Pause check before processing any claim logic
- Beneficiary-to-leaf binding (`beneficiary.key() == leaf.beneficiary`) before proof verification
- Merkle proof verification against the stored root
- Check-effects-interactions order: all state mutations before the SPL token CPI
- Checked arithmetic on every path that modifies `total_claimed` or `claimed_amount`
- Milestone bitmap check and set in the correct order
- Grace period enforcement in `withdraw_unvested` (requires `Clock::get()`)
- First-touch detection in `ClaimRecord` initialization

---

## Vulnerability Map

### Remediated Findings

| ID | Severity | Issue | Status |
|---|---|---|---|
| **VEL-001** | HIGH | Double payout on stream campaigns via `withdraw -> close_claim_record -> withdraw` | **Fixed** -- `total_entitled` set on first-touch in `withdraw`; `close_claim_record` requires `total_entitled > 0` |
| **VEL-012** | HIGH | Pause+Cancel Lockout -- grace-period claims blocked after pause then cancel | **Fixed** -- `cancel_campaign` resets `paused = false`; defense-in-depth in `claim`/`withdraw` |
| **VEL-009** | LOW | Unbounded Merkle proof length in `claim` (CU griefing) | **Fixed** -- `MAX_MERKLE_PROOF_LEN = 32` + `max_proof_len_for_leaf_count()` enforced on-chain |
| **VEL-010** | LOW | Timing-unsafe admin API key comparison (`===` on strings) | **Fixed** -- `verifyAdminKey` uses SHA-256 + `crypto.timingSafeEqual` |
| **VEL-011** | MED | `StreamExpired` blocks multi-leaf claims after claiming larger leaf | **Fixed** -- removed `fully_claimed` sub-condition in `claim.rs` |
| **VEL-015** | MED | `milestoneIdx > 255` silently truncated by `writeUInt8` in leaf encoder | **Fixed** -- `.max(255)` validation in Zod schemas |
| **VEL-013** | LOW | Duplicate `(beneficiary, milestoneIdx)` causes permanent unclaimability | **Fixed** -- prepare route rejects duplicates with 400 |
| **VEL-014** | LOW | `total_entitled` stale after first claim -- `close_claim_record` check imprecise | **Fixed** -- accumulates for each milestone claim |
| **Issue #29** | MED | Multi-leaf cliff/linear cumulative `claimed_amount` undercount | **Fixed** -- `ClaimRecord` is now `#[account(zero_copy)]` with a per-leaf ledger |

### Resolved: Pause+Cancel Exploit (VEL-012)

**Severity:** High (beneficiary lockout)
**Description:** `cancel_campaign` did not reset `paused`, locking beneficiaries out of grace-period claims. A paused-then-cancelled campaign blocked `claim` via `CampaignPaused` while `unpause_campaign` was blocked by `cancelled_at`.
**Fix:** `cancel_campaign` now resets `paused = false`. Defense-in-depth in `claim` and `withdraw` allows operations on cancelled campaigns regardless of pause state (`!paused || cancelled_at.is_some()`).
**Tests:** T69, T70, EXPLOIT 12, clock test (pause -> cancel -> claim precise vesting math).

---

## Attack Surface by Instruction

### create_campaign

| Attack | Mitigation |
|---|---|
| Frontrunning | PDA seeds include `creator.key()` -- attacker cannot impersonate the creator |
| campaign_id collision | `init` constraint causes `AccountAlreadyInitialized` on second attempt |
| Garbage root (all-zero) | `require!(root != [0u8; 32])` -> `EmptyRoot` |
| Zero supply | `require!(total_supply > 0)` -> `ZeroAmount` |
| Cancellable without authority | `require!(cancel_authority.is_some())` -> `MissingCancelAuthority` |

### fund_campaign

| Attack | Mitigation |
|---|---|
| Over-funding | `vault.amount + amount <= total_supply` -> `OverFunded` |
| Wrong mint | `constraint = source_ata.mint == vesting_tree.mint` -> `MintMismatch` |
| Unauthorized funder | `has_one = creator` + `source_ata.owner == creator.key()` |
| Fund after cancel | `vesting_tree.cancelled_at.is_none()` -> `CampaignCancelled` |

### claim (highest-value target)

**Validation order** (not arbitrary -- determines information leakage, gas costs, and state consistency):

1. **Pause guard** -- cheap boolean read, short-circuits before expensive computation
2. **Beneficiary binding** -- runs before proof verification (prevents oracle probing)
3. **Schedule sanity** -- `start_time <= cliff_time <= end_time`
4. **Release type validation** -- `release_type in {0, 1, 2}`
5. **Merkle proof verification** -- runs before `ClaimRecord` initialization (prevents PDA spam)
6. **Milestone bitmap check** -- check before any state mutation

**State mutation order (CEI):** All mutations happen before the SPL token CPI:
1. `claim_record.claimed_amount += claimable` (checked_add)
2. `claim_record.last_claim_at = now`
3. `claim_record.milestone_bitmap[byte] |= 1 << bit` (milestone only)
4. `vesting_tree.total_claimed = new_total` (checked_add result)
5. SPL Token CPI: `vault -> beneficiary_ata` for `claimable`

| Attack | Mitigation |
|---|---|
| Signer substitution | `beneficiary.key() == leaf.beneficiary` before proof check |
| Proof forgery | `verify_merkle_proof` against on-chain root |
| Second-preimage on Merkle | `LEAF_PREFIX = 0x00` and `NODE_PREFIX = 0x01` make leaf and node hash domains disjoint |
| Cross-campaign proof replay | `ClaimRecord` PDA seeds include `vesting_tree.key()` |
| Double-claim (linear/cliff) | `claimed_amount` incremented before CPI |
| Double-claim (milestone) | Bitmap bit set before CPI |
| OverClaim | `checked_add` + `require!(new_total <= total_supply)` |
| Arithmetic overflow | Cast to `u128` before multiplication |
| Wrong vault | `address = vesting_tree.vault` enforced by Anchor |
| Malicious token program | `Program<Token>` type verified by Anchor |
| Reentrancy via CPI | State fully updated before CPI (CEI) |
| Large proof vectors | `proof.len() > 32` -> `ProofTooLong` (6029) |

### cancel_campaign

| Attack | Mitigation |
|---|---|
| Unauthorized cancel | `cancel_authority` constraint + signer check |
| Cancel non-cancellable | `constraint = vesting_tree.cancellable` -> `NotCancellable` |
| Double-cancel | `cancelled_at.is_none()` -> `AlreadyCancelled` |

### update_root

| Attack | Mitigation |
|---|---|
| Unauthorized rotation | `cancel_authority` constraint; non-cancellable campaigns blocked |
| Rotate after cancel | `cancelled_at.is_none()` -> `CampaignCancelled` |
| Same root rotation | `new_root != merkle_root` -> `SameRoot` |
| Inflate total via new root | `total_supply` is not changed by rotation; `OverClaim` still applies |

### withdraw_unvested

| Attack | Mitigation |
|---|---|
| Early sweep | `now >= cancelled_at + GRACE_PERIOD_SECS` -> `GracePeriodActive` |
| Non-creator sweep | `has_one = creator` |
| Wrong vault | `has_one = vault` |

### pause_campaign / unpause_campaign

| Attack | Mitigation |
|---|---|
| Unauthorized pause | `pause_authority` constraint + signer check |
| Pause a cancelled campaign | `cancelled_at.is_none()` |
| Double-pause | `require!(!tree.paused)` -> `AlreadyPaused` |

### close_claim_record

| Attack | Mitigation |
|---|---|
| Close someone else's record | `has_one = beneficiary` -- only record owner can close |
| Premature close | `total_entitled > 0 && claimed_amount >= total_entitled` OR `post_grace` |
| Close -> re-init double payout (VEL-001) | `total_entitled > 0` guard prevents closing a record never properly initialized |

---

## Anchor Security Checklist

Cross-checked against the Helius Hitchhiker's Guide to Solana Program Security.

| Vulnerability class | How we handle it | Status |
|---|---|---|
| Missing signer check | `Signer<'info>` on every privileged account | Enforced by type |
| Account ownership check | `Account<'info, T>` rejects foreign accounts | Enforced by type |
| PDA bump canonicalization | Bump stored on first `init`; reused via `bump = account.bump` | Manual |
| Type cosplay | 8-byte discriminator | Enforced automatically |
| Arbitrary CPI | CPIs target only typed `Program<Token>` etc. | Enforced by type |
| Integer overflow | `checked_add/sub`, `u128` intermediate, `saturating_sub` | Manual |
| Reentrancy | All state mutations before SPL token CPI | Manual |
| `init` vs `init_if_needed` | `init` on `VestingTree`; `init_if_needed` on `ClaimRecord` | Manual |
| Double-spend (linear) | `claimed_amount` incremented before CPI; `total_entitled` on first-touch | Manual |
| Double-spend (milestone) | Bitmap bit set before CPI | Manual |
| OverClaim | `checked_add` + `require!(new_total <= total_supply)` | Manual |
| Event emission | `emit!()` in every state-changing instruction | Manual |

---

## IPFS Attack Surface

The off-chain Merkle leaf set (JSON pinned to IPFS) is not controlled by the program. If an attacker modifies the IPFS content, they can serve invalid proofs. The on-chain root remains authoritative: a manipulated proof that does not recompute to the stored `merkle_root` fails `InvalidProof`.

**Mitigation for recipients:** The SDK and frontend must read `VestingTree.merkle_root` from the chain and verify that the proof recomputes to that exact value before sending the transaction.

---

## Known Limitations (Deferred to Phase 2)

### Single-key cancel_authority

**Severity: High.** Key compromise means total campaign hijack: cancel, rotate root, wait grace, sweep vault.

**Phase 2 fix:** Replace with Squads v4 multisig PDA. No program changes required -- `Option<Pubkey>` already accepts any pubkey. See [Multisig Setup](../operations/multisig-setup.md).

### Token-2022 Transfer Fees

**Severity: Medium.** Mints with the `transfer-fee` extension deliver `claimable - fee` tokens, not `claimable`.

**Phase 2 fix:** Detect the fee extension, compute gross transfer amount. Phase 1 supports SPL Token (classic) only.

### No Formal Merkle Proof Audit

**Severity: Medium.** The `verify_merkle_proof` implementation mirrors Jito's distributor. The off-chain TS builder is hand-rolled.

**Phase 2 fix:** Engage a Solana-specialized audit firm for fuzzing. Add `cargo-fuzz` corpus.

### Solana Clock Manipulation

**Severity: Low.** Validators can manipulate `Clock::unix_timestamp` by approximately 25 seconds. For the 7-day grace period, this is negligible (less than 0.004%).
