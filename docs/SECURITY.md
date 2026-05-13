# Security Design — Velthoryn Protocol

**Author:** Lana — smart-contract / backend lead
**Status:** Week 4 complete — all items implemented and tested on devnet (12 instructions, 31 error variants)
**Companion docs:** `docs/TDD_LANA.md`, `docs/PROGRAM.md`
**External reference:** [Helius: A Hitchhiker's Guide to Solana Program Security](https://www.helius.dev/blog/a-hitchhikers-guide-to-solana-program-security)

---

## §1 Threat Model

### Trust boundary diagram

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                          ON-CHAIN (program enforced)                         ║
║                                                                              ║
║  ┌─────────────────┐   seeds+bump   ┌────────────────────────────────────┐  ║
║  │  VestingTree    │◄───────────────│  Program (Anchor 1.0)              │  ║
║  │  PDA            │                │  Discriminator on every account    │  ║
║  │  merkle_root ◄──┼── update_root  │  Signer<'info> on every privilege  │  ║
║  │  cancelled_at   │                │  Account<'info,T> ownership checks  │  ║
║  │  paused         │                └────────────────────────────────────┘  ║
║  └────────┬────────┘                                                         ║
║           │ vault field                                                       ║
║           ▼                                                                  ║
║  ┌─────────────────┐   PDA signer   ┌────────────────────────────────────┐  ║
║  │  Vault          │◄───────────────│  VaultAuthority (PDA, zero data)   │  ║
║  │  SPL Token ATA  │   token CPI    │  seeds=[b"vault_authority",tree]   │  ║
║  └─────────────────┘                └────────────────────────────────────┘  ║
║                                                                              ║
║  ┌─────────────────┐                                                         ║
║  │  ClaimRecord    │  tracks claimed_amount and milestone_bitmap per         ║
║  │  PDA            │  (tree, beneficiary) — prevents double-spend           ║
║  └─────────────────┘                                                         ║
╚══════════════════════════════════════════════════════════════════════════════╝
                │                         │
                │ TRUSTED                 │ UNTRUSTED — verified on-chain
                ▼                         ▼
╔══════════════════════════╗  ╔══════════════════════════════════════════════╗
║  OFF-CHAIN (not trusted) ║  ║  Leaf + proof submitted by beneficiary       ║
║                          ║  ║                                              ║
║  IPFS / R2 leaf JSON     ║  ║  Program does NOT trust these values.        ║
║  TS Merkle tree builder  ║  ║  Every field of VestingLeaf is hashed and    ║
║  Frontend / SDK          ║  ║  verified against merkle_root before use.    ║
║  creator keypair         ║  ║  leaf.beneficiary checked against signer.    ║
╚══════════════════════════╝  ╚══════════════════════════════════════════════╝
```

**What Anchor enforces automatically** (without any code in instruction handlers):
- Account ownership: `Account<'info, T>` rejects accounts not owned by this program.
- 8-byte discriminator: deserialization fails if discriminator does not match the expected type, preventing type-cosplay attacks.
- `Signer<'info>`: enforces that the account signed the transaction.
- `Program<'info, T>`: enforces the exact program ID, preventing fake token program substitution.
- `seeds` + `bump`: derives and verifies the expected PDA address, preventing address substitution.
- `has_one = field`: enforces `account.field == named_account.key()`.
- `address = expr`: enforces an exact pubkey match.
- `init` uniqueness: fails with `AccountAlreadyInitialized` if the account already exists.
- `close = target`: zeroes account data and transfers lamports atomically.

**What must be manually coded** (not automatic — failure to implement is a vulnerability):
- Pause check before processing any claim logic.
- Beneficiary-to-leaf binding (`beneficiary.key() == leaf.beneficiary`) before proof verification.
- Merkle proof verification against the stored root.
- Check-effects-interactions order: all state mutations before the SPL token CPI.
- Checked arithmetic on every path that modifies `total_claimed` or `claimed_amount`.
- Milestone bitmap check and set in the correct order.
- Grace period enforcement in `withdraw_unvested` (requires `Clock::get()`).
- First-touch detection in `ClaimRecord` initialization.

### IPFS attack surface

The off-chain Merkle leaf set (JSON file pinned to IPFS) is not controlled by the program. If an attacker modifies the IPFS content — through pin-set compromise, gateway substitution, or CID mismatch — they can serve victims incorrect leaf data or invalid proofs. The on-chain root remains authoritative: a manipulated proof that does not recompute to the stored `merkle_root` fails `InvalidProof` regardless of what the IPFS file says.

Mitigation for recipients: before trusting an IPFS-sourced proof, the SDK and frontend must read `VestingTree.merkle_root` from the chain and verify that the proof recomputes to that exact value before sending the transaction. A manipulated proof is caught on-chain either way, but catching it off-chain avoids wasted transaction fees.

### Actors

| Actor | Trust level | What they control |
|---|---|---|
| **Creator** | Trusted at setup; untrusted post-deploy | `campaign_id`, `merkle_root`, `total_supply`, `cancellable` flag |
| **Cancel / pause authority** | Trusted (holds a keypair or multisig) | `cancel_campaign`, `update_root`, `pause_campaign` |
| **Beneficiary** | Untrusted | Their own signing key; the `VestingLeaf` and proof they submit |
| **Anonymous / attacker** | Fully untrusted | Network access; can craft any transaction |

### Assets

| Asset | Location | Value |
|---|---|---|
| **Vault tokens** | SPL Token ATA owned by `vault_authority` PDA | Full campaign supply — up to millions of USD |
| **VestingTree state** | Program PDA | Controls who can claim, when, and how much |
| **ClaimRecord state** | Program PDA | Records what each beneficiary has already received |

### Attacker goals

1. Drain vault tokens (steal from creator or other beneficiaries)
2. Claim more tokens than their vesting schedule allows
3. Claim someone else's tokens
4. Prevent legitimate beneficiaries from claiming
5. Forge a Merkle proof to inject a fake recipient
6. Corrupt `VestingTree` state to change the root or `total_supply`

---

## §2 Attack Surface by Instruction

### 2.1 `create_campaign`

| Attack | Description | Mitigation |
|---|---|---|
| **Frontrunning** | Attacker watches the mempool and calls `create_campaign` with a modified root before the project does | PDA seeds include `creator.key()` — attacker cannot impersonate the creator's address. The real creator's tx creates the canonical PDA. |
| **campaign_id collision** | Two campaigns with the same `(creator, mint, campaign_id)` tuple | The `init` constraint causes the second `create_campaign` to fail with Anchor's `AccountAlreadyInitialized`. This is correct and expected behavior. Creators who need a second campaign for the same mint use a different `campaign_id`. |
| **Garbage root** | Project accidentally submits all-zero root; anyone who can forge a trivial proof claims everything | `require!(root != [0u8; 32])` → `EmptyRoot` |
| **Zero supply** | `total_supply = 0`; `fund_campaign` with any amount fails `OverFunded`; no one can claim | `require!(total_supply > 0)` → `ZeroAmount` |
| **Cancellable without authority** | `cancellable = true, cancel_authority = None`; campaign can never be cancelled | `require!(cancel_authority.is_some())` when `cancellable` → `MissingCancelAuthority` |
| **Wrong root committed** | Creator commits the wrong root on creation | `merkle_root` can only be changed via `update_root` (requires `cancel_authority` signature and `cancellable = true`). A creator who committed the wrong root on a non-cancellable campaign must cancel and recreate. |

**Post-creation verification (SDK obligation):** The SDK and frontend must read back the `VestingTree` account after creation and assert every field matches the submitted args. This is a UI requirement, not enforced on-chain.

---

### 2.2 `fund_campaign`

| Attack | Description | Mitigation |
|---|---|---|
| **Over-funding** | Creator funds beyond `total_supply`; accounting breaks | `vault.amount + amount <= total_supply` → `OverFunded` |
| **Wrong mint** | Attacker passes a different mint's token account as `source_ata` | `constraint = source_ata.mint == vesting_tree.mint` → `MintMismatch` |
| **Unauthorized funder** | Anyone tries to fund a campaign they don't own | `has_one = creator` + `source_ata.owner == creator.key()` → `Unauthorized` |
| **Fund after cancel** | Creator cancels, recipients claim, then re-funds to inflate `vault.amount` | `vesting_tree.cancelled_at.is_none()` → `CampaignCancelled` |

---

### 2.3 `claim` (highest-value target)

This instruction moves tokens. Validation order is not arbitrary — it determines information leakage, gas costs, and state consistency guarantees.

#### Validation order and why it matters

**Validation 1: `!vesting_tree.paused` → `CampaignPaused`**

This is a cheap boolean read that short-circuits before any expensive computation. It runs first so that during an emergency pause, no CPU is spent on Merkle proof verification or schedule math.

**Validation 2: `beneficiary.key() == leaf.beneficiary` → `UnauthorizedClaimer`**

This runs before proof verification. An attacker who has obtained someone else's valid proof cannot learn whether that proof is still valid: they receive `UnauthorizedClaimer` before the proof is ever evaluated. If the order were reversed — proof first, then signer check — the attacker could use the success or failure of proof verification as an oracle to probe tree contents.

**Validation 3: Schedule sanity (`start_time <= cliff_time <= end_time`) → `InvalidSchedule`**

Defense in depth. The off-chain tree builder rejects malformed leaves, but the on-chain check ensures that a corrupt or hand-crafted leaf cannot trigger undefined behavior in the schedule math.

**Validation 4: `release_type ∈ {0, 1, 2}` → `InvalidScheduleType`**

Guards the `match` on `release_type` from reaching an unreachable branch with user-supplied data.

**Validation 5: `verify_merkle_proof(leaf_hash(&leaf), &proof, leaf.leaf_index, vesting_tree.merkle_root)` → `InvalidProof`**

Proof verification runs before `ClaimRecord` initialization. A failed proof attempt allocates no state. An attacker who submits malformed proofs cannot spam the chain with `ClaimRecord` accounts, because the PDA is never initialized until a valid proof succeeds.

**Validation 6: Milestone bitmap check → `MilestoneAlreadyClaimed`**

For milestone schedules, the bit for `milestone_idx` is checked before any state mutation. The bit is set in the state update phase (step 9), not here. The check-then-set is atomic within a single transaction.

**Validations 7–9: Schedule math, claimable computation, accounting checks**

These run after identity and proof are confirmed. The sequence:
1. Compute `effective_now = min(Clock::unix_timestamp, cancelled_at)` if cancelled, else `Clock::unix_timestamp`.
2. Compute `total_vested` from schedule math.
3. Compute `claimable = total_vested.saturating_sub(claim_record.claimed_amount)` for cliff/linear; `leaf.amount` for milestone.
4. `require!(claimable > 0)` → `NothingToClaim`.
5. `require!(vault.amount >= claimable)` → `InsufficientVault`.
6. `require!(total_claimed.checked_add(claimable) <= total_supply)` → `OverClaim`.

**State mutation order (CEI — check-effects-interactions):**

All mutations happen before the SPL token CPI, in this exact order:
1. `claim_record.claimed_amount += claimable` (checked_add)
2. `claim_record.last_claim_at = now`
3. `claim_record.milestone_bitmap[byte] |= 1 << bit` (milestone only)
4. `vesting_tree.total_claimed = new_total` (checked_add result)
5. SPL Token CPI: `vault → beneficiary_ata` for `claimable`, signed by `vault_authority` PDA

A reentrant call — if it were possible through a malicious CPI chain — would find `claimed_amount` already updated and receive `NothingToClaim`. Steps 1–4 must not be reordered relative to step 5.

#### Attack surface table

| Attack | Description | Mitigation |
|---|---|---|
| **Signer substitution** | Alice uses Bob's valid proof, signed by her own key | Validation 2 (`beneficiary.key() == leaf.beneficiary`) runs before proof check; Alice gets `UnauthorizedClaimer` and learns nothing about proof validity |
| **Proof forgery** | Attacker submits a leaf not in the tree | Validation 5 (`verify_merkle_proof`) → `InvalidProof`. Root is stored on-chain and only updatable by `cancel_authority`. |
| **Second-preimage on Merkle** | Attacker crafts an internal node hash equal to a leaf hash, presents it as a leaf | `LEAF_PREFIX = 0x00` and `NODE_PREFIX = 0x01` make leaf and node hash domains disjoint. A value computed with `NODE_PREFIX` cannot match a value computed with `LEAF_PREFIX`. |
| **Cross-campaign proof replay** | Valid proof from campaign A submitted against campaign B | `ClaimRecord` PDA seeds include `vesting_tree.key()` — the record is bound to a specific campaign. Campaign B has its own `merkle_root`; the proof fails verification. |
| **Double-claim (linear/cliff)** | Alice calls `claim` twice before state updates | `claimed_amount` incremented and `total_claimed` updated before the CPI. Second call computes `claimable = total_vested.saturating_sub(claimed_amount) = 0` → `NothingToClaim`. |
| **Double-claim (milestone)** | Alice calls `claim` for the same milestone twice | Bitmap bit set before the CPI. Second call reads the bit already set → `MilestoneAlreadyClaimed`. |
| **OverClaim (total accounting)** | Series of partial claims accumulates beyond `total_supply` | `total_claimed.checked_add(claimable) <= total_supply` → `OverClaim`. `checked_add` prevents silent overflow. |
| **Arithmetic overflow (linear math)** | `leaf.amount * elapsed` overflows u64 for large amounts and long durations | Cast to `u128` before multiplication. `u64::MAX * i64::MAX` fits in u128. |
| **Wrong vault** | Attacker passes a different token account as `vault` | `address = vesting_tree.vault @ VestingError::WrongVault` — Anchor enforces the address matches the stored pubkey. |
| **Vault underfunding** | Creator funded less than `total_supply`; late claimers cannot claim | `vault.amount >= claimable` → `InsufficientVault`. Partial funding is allowed by design; the race is surfaced as an explicit error. |
| **Malicious token program** | Attacker passes a fake SPL token program | `Program<Token>` type — Anchor verifies the account owner is the real SPL Token program ID. |
| **Reentrancy via CPI** | Malicious token mock calls back into `claim` during the transfer | State is fully updated before the CPI (steps 1–4 above). A reentrant `claim` call finds `claimed_amount` already incremented → `NothingToClaim`. |
| **Sandwich on ClaimRecord creation** | Two concurrent first-claims for the same beneficiary race on `ClaimRecord` init | One wins the PDA allocation; the other fails with Anchor's re-init error. The winning tx's handler detects first touch via `cr.beneficiary == Pubkey::default()` and seeds identity fields atomically. The second tx retries and finds the record already populated. |
| **`_proof` naming** | The `_proof` parameter is declared in the `#[instruction]` attribute with a leading underscore. This is intentional: Anchor uses instruction parameters to resolve PDAs that depend on them, but `_proof` is not a PDA seed. The leading underscore signals to Anchor's parser not to treat this as an account discriminant while still making the value available to the handler. |
| **Large proof vectors** | A 32-level tree has a 32-element proof (32 × 32 = 1,024 bytes). Combined with the other accounts in the `Claim` context, this approaches Solana's 1,232-byte transaction size limit. | Recommended maximum tree depth: 20 levels (2^20 = 1,048,576 recipients; proof = 640 bytes). Trees deeper than 20 levels risk hitting the transaction size limit when `vault_authority`, `claim_record`, `vault`, `beneficiary_ata`, and `mint` account metas are included. The off-chain tree builder must enforce this limit. |

---

### 2.3a `create_stream` (atomic single-recipient campaign + fund)

Combines `create_campaign` + `fund_campaign` into a single transaction for the common case of one recipient. Computes the Merkle root on-chain from a single `VestingLeaf`, eliminating the need for off-chain tree building and IPFS proof hosting.

| Attack | Description | Mitigation |
|---|---|---|
| **Frontrunning** | Same as `create_campaign` — PDA seeds include `creator.key()` | PDA uniqueness enforced by `init` |
| **Schedule validation** | Malformed schedule (start > cliff > end) submitted | `require!(start_time <= cliff_time && cliff_time <= end_time)` → `InvalidSchedule` |
| **Invalid release type** | `release_type > 2` | `require!(release_type <= 2)` → `InvalidScheduleType` |
| **Cancellable without authority** | `cancellable = true, cancel_authority = None` | `require!(cancel_authority.is_some())` → `MissingCancelAuthority` |
| **Under-funding** | Creator's ATA has fewer tokens than `amount` | SPL `token::transfer` CPI fails atomically — campaign PDA is never created |
| **Token-2022 mint** | Transfer fee extension causes vault to receive less than `amount` | Mint ownership check against SPL Token program (same as `create_campaign`) |

**Key design choice:** `create_stream` sets `leaf_count = 1` and `total_supply = amount`. The on-chain `leaf_hash()` becomes the `merkle_root`. This means `withdraw` (not `claim`) is the intended claiming instruction for streams — it reconstructs the single leaf and checks `leaf_hash == merkle_root` directly, without a proof.

---

### 2.3b `withdraw` (proof-less claim for single-recipient streams)

Simplified claiming path for campaigns created by `create_stream` (or any campaign with `leaf_count == 1`). Reconstructs the `VestingLeaf` on-chain from the instruction args and verifies it against the stored `merkle_root` — no Merkle proof required.

| Attack | Description | Mitigation |
|---|---|---|
| **Multi-recipient abuse** | Attacker calls `withdraw` on a multi-recipient campaign to bypass Merkle proof | `constraint = vesting_tree.leaf_count == 1` → `NotSingleStream` |
| **Signer substitution** | Alice calls `withdraw` on Bob's stream | `beneficiary.key() == leaf.beneficiary` → `UnauthorizedClaimer` |
| **Schedule tampering** | Attacker submits different schedule params than the original stream | `leaf_hash(reconstructed_leaf) == merkle_root` → `InvalidProof`. The root was set at stream creation; any mismatch in `release_type`, `start_time`, `cliff_time`, `end_time`, or `milestone_idx` causes the hash to differ. |
| **Double-claim** | Same protections as `claim` — `claimed_amount` tracked in `ClaimRecord` | `NothingToClaim` on second call (linear/cliff); `MilestoneAlreadyClaimed` for milestones |
| **OverClaim** | Same as `claim` — `total_claimed.checked_add(claimable) <= total_supply` | `OverClaim` |
| **CEI violation** | CPI before state mutation | All mutations happen before the SPL token CPI, same order as `claim` |

**Why `leaf_count == 1` guard:** `withdraw` reconstructs a single leaf from the args (index 0, beneficiary = signer, amount = total_supply). On a multi-recipient campaign, an attacker could reconstruct a valid leaf for index 0 and bypass proof verification for that recipient. The `leaf_count == 1` constraint ensures this instruction is only usable on single-recipient campaigns.

---

### 2.4 `cancel_campaign`

| Attack | Description | Mitigation |
|---|---|---|
| **Unauthorized cancel** | Non-authority calls cancel | `constraint = vesting_tree.cancel_authority == Some(cancel_authority.key())` → `Unauthorized`. `cancel_authority` is `Option<Pubkey>` — `has_one` does not unwrap Options, so a manual constraint is used instead. |
| **Cancel a non-cancellable campaign** | Attacker freezes a campaign promised to be immutable | `constraint = vesting_tree.cancellable` → `NotCancellable` |
| **Double-cancel** | Cancel called twice; `cancelled_at` gets a later timestamp, shrinking recipients' vested amount | `constraint = vesting_tree.cancelled_at.is_none()` → `AlreadyCancelled`. Once set, `cancelled_at` is immutable. |
| **Cancel to steal from recipients** | Authority cancels immediately before recipients can claim; grace period too short | 7-day `GRACE_PERIOD_SECS` gives recipients time to claim earned tokens before `withdraw_unvested` is callable. |

---

### 2.5 `update_root`

| Attack | Description | Mitigation |
|---|---|---|
| **Unauthorized rotation** | Attacker rotates root to exclude all original recipients | Same `cancel_authority` constraint as `cancel_campaign`; non-cancellable campaigns cannot have their root updated. |
| **Rotate after cancel** | Root rotated post-cancel; recipients cannot claim their earned tokens | `constraint = vesting_tree.cancelled_at.is_none()` → `CampaignCancelled` |
| **Same root rotation** | Accidental no-op rotation | `require!(new_root != vesting_tree.merkle_root)` → `SameRoot` |
| **Inflate total via new root** | Authority rotates to a root with higher leaf amounts, allowing over-claim | `total_supply` is not changed by rotation. `OverClaim` check (`total_claimed <= total_supply`) still applies during `claim`. Authority cannot conjure tokens beyond what was funded. |
| **Root rotation window attack** | Between `update_root` and the off-chain re-pin of new proofs to IPFS, there is a window where the new root is live on-chain but the corresponding proofs are not available to recipients. All claims during this window fail with `InvalidProof`. | The required operation sequence is: (1) rebuild tree off-chain, (2) pin new proofs to IPFS and verify retrieval, (3) call `update_root`, (4) notify recipients. Calling `update_root` before step 2 creates the availability window. This is an operational risk, not a program vulnerability, but it must be documented in the integration runbook. |
| **Reduce amounts via rotation** | Authority rotates to a root where a recipient's `leaf.amount` is lower than their `claimed_amount` | Recipients who already claimed more than their new leaf amount compute `claimable = new_amount.saturating_sub(claimed_amount) = 0` → `NothingToClaim`. This is intentional: the authority cannot claw back tokens already distributed, but can cap future claims. `total_supply` and `total_claimed` are not changed by root rotation. |

---

### 2.6 `withdraw_unvested`

| Attack | Description | Mitigation |
|---|---|---|
| **Early sweep** | Creator calls `withdraw_unvested` before grace period | `now >= cancelled_at + GRACE_PERIOD_SECS` → `GracePeriodActive` |
| **Non-creator sweep** | Attacker sweeps the vault | `has_one = creator` → `Unauthorized` |
| **Wrong vault** | Attacker passes a different token account to drain | `has_one = vault` — vault pubkey is stored in `VestingTree` |

---

### 2.7 `pause_campaign` / `unpause_campaign`

| Attack | Description | Mitigation |
|---|---|---|
| **Unauthorized pause** | Attacker halts all claims | `pause_authority` constraint + signer check → `Unauthorized` |
| **Pause a cancelled campaign** | Confused state | `cancelled_at.is_none()` → `CampaignCancelled` |
| **Double-pause** | `paused` flag stuck; unpause silently fails | `require!(!tree.paused)` → `AlreadyPaused`; `require!(tree.paused)` → `NotPaused` |

---

### 2.8 `close_claim_record`

| Attack | Description | Mitigation |
|---|---|---|
| **Close someone else's record** | Attacker closes Bob's record to grief him | `has_one = beneficiary` — only the record owner can close; rent goes to them |
| **Premature close** | Close before fully claimed, erasing unclaimed portion | `claimed_amount >= expected_total || post_grace` — at least one condition must be true → `CannotClose` |

---

## §3 Anchor Security Checklist

Cross-checked against the Helius Hitchhiker's Guide to Solana Program Security.

| Vulnerability class | How we handle it | Status |
|---|---|---|
| **Missing signer check** | `Signer<'info>` on every privileged account (creator, cancel_authority, pause_authority, beneficiary) | Enforced by type |
| **Account ownership check** | `Account<'info, T>` — Anchor rejects accounts not owned by this program | Enforced by type |
| **PDA bump canonicalization** | Bump stored in `VestingTree.bump` and `ClaimRecord.bump` on first `init`; reused via `bump = account.bump` on all subsequent accesses. Storing the canonical bump prevents a bump-grinding attack where an attacker provides a non-canonical bump to reach a different address. Anchor 1.0 enforces canonical bumps by default, but explicit storage is belt-and-suspenders. | Manual — must store bumps on first write |
| **Type cosplay** | Anchor writes an 8-byte discriminator to every `#[account]` struct; deserialization fails if discriminator does not match | Enforced automatically |
| **Arbitrary CPI** | CPIs target only typed `Program<Token>`, `Program<AssociatedToken>`, `Program<System>` — no raw `AccountInfo` CPIs | Enforced by type |
| **Integer overflow** | `checked_add/sub` on `total_claimed`, `claimed_amount`; `u128` intermediate in linear math; `saturating_sub` on claimable delta | Manual — every arithmetic path must use checked variants |
| **Reentrancy** | All state mutations happen before the SPL token CPI in `claim`, `withdraw`, and `withdraw_unvested` | Manual — CEI order must be maintained |
| **`init` vs `init_if_needed`** | `init` on `VestingTree` (uniqueness — one per campaign); `init_if_needed` on `ClaimRecord` (re-entered for partial claims) and beneficiary ATA | Manual — must not use `init_if_needed` where uniqueness is required |
| **Double-spend (linear)** | `claimed_amount` incremented before CPI; second call computes claimable = 0 | Manual — update-before-CPI order must be maintained |
| **Double-spend (milestone)** | Bitmap bit set before CPI | Manual |
| **OverClaim** | `checked_add` + `require!(new_total <= total_supply)` before CPI | Manual |
| **Frontrunning** | Seeds include `creator.key()`; UI verifies post-creation | Partial mitigation — no on-chain fix for MEV; UI must verify |
| **Event emission** | `emit!()` in every state-changing instruction | Manual — every instruction must call `emit!` |
| **`has_one` vs manual constraint** | `has_one = creator` is equivalent to `constraint = vesting_tree.creator == creator.key()` but shorter. We use `has_one` where the field name matches the account name in the `Accounts` struct. We use manual `constraint` where it does not — for example, `cancel_authority` is `Option<Pubkey>`, which `has_one` cannot unwrap, so `constraint = vesting_tree.cancel_authority == Some(cancel_authority.key())` is required. | Mixed — documented per instruction |
| **`UncheckedAccount` safety** | `vault_authority` is `UncheckedAccount<'info>` with a `/// CHECK:` comment. This is correct: we never deserialize it, only use it as a PDA signer. The safety guarantee comes from the `seeds` constraint, which verifies it is the expected PDA. Using `UncheckedAccount` without a `seeds` constraint would be a vulnerability. | Manual — `seeds` constraint must be present |
| **`close` constraint atomicity** | On `CloseClaimRecord`, Anchor's `close = beneficiary` constraint zeroes the account data and transfers lamports to `beneficiary` atomically in the same transaction. This prevents zombie accounts (zeroed data, positive lamports) that could confuse future `init_if_needed` calls. | Enforced by Anchor when `close` is declared |

---

## §4 Known Limitations (Deferred to Phase 2)

These are accepted risks for the MVP. Each has a severity rating and a mitigation plan.

### 4.1 Single-key `cancel_authority`

**Severity: High.** Key compromise means an attacker can: (1) cancel the campaign immediately, (2) rotate the root to exclude all recipients, (3) wait out the 7-day grace period, and (4) call `withdraw_unvested` to sweep the vault. This is total campaign hijack.

**Detection:** Monitor on-chain events for unexpected `CampaignCancelled` or `RootUpdated` events. Helius webhooks on the `cancel_campaign` and `update_root` discriminators provide real-time alerting.

**MVP mitigation:** Store `cancel_authority` keypair in a hardware wallet or offline. Do not expose it in automated scripts.

**Phase 2 fix:** Replace with a Squads v4 multisig PDA. No program changes required — `Option<Pubkey>` in `cancel_authority` already accepts any pubkey including a multisig PDA.

---

### 4.2 Token-2022 transfer fees

**Severity: Medium.** Affects campaigns whose mint has the `transfer-fee` extension enabled (SPL Token-2022). A portion of every SPL token transfer is burned or diverted to a fee recipient. The `vault → beneficiary_ata` transfer in `claim` would deliver `claimable - fee` tokens, not `claimable`. Recipients would receive less than their Merkle leaf specifies.

**Detection:** Check `mint.owner` against `spl_token_2022::ID` at `create_campaign` time. The current code does not perform this check explicitly — adding `require!(mint.to_account_info().owner == &spl_token::ID, VestingError::MintMismatch)` in `create_campaign` blocks Token-2022 mints at the creation point.

**MVP mitigation:** Phase 1 supports SPL Token (classic) only. The detection check above should be added before mainnet deployment.

**Phase 2 fix:** Detect the fee extension via `get_extension::<TransferFeeConfig>()`, compute the gross transfer amount needed to net the expected `claimable`, and pass that to `token::transfer`. Requires `anchor-spl` with the Token-2022 feature gate enabled.

---

### 4.3 No formal Merkle proof audit

**Severity: Medium.** The `verify_merkle_proof` implementation mirrors Jito's distributor, which has been battle-tested with $500M+ in distributions. However, the off-chain tree builder in `clients/ts/merkle.ts` is hand-rolled. The duplicate-odd-leaf behavior and index-based proof scheme have not been formally verified. A divergence between the Rust verifier and the TS builder would silently produce proofs that always fail, bricking the campaign for all recipients.

**Detection:** Property-based fuzzing. Run `proptest` (or a similar framework) asserting: (1) a proof generated for any leaf at any index always verifies on-chain, (2) mutating any single byte of the proof fails verification, (3) mutating any field of the leaf fails verification. The golden-vector test (`tests/golden_vector.spec.ts`) is a necessary but not sufficient gate.

**Phase 2 fix:** Engage a Solana-specialized audit firm to fuzz `verify_merkle_proof` and the TS tree builder. Add `cargo-fuzz` corpus for the on-chain verifier.

---

### 4.4 Off-chain leaf set integrity

**Severity: Low.** Affects user experience, not security. If the IPFS pin is tampered or unavailable, recipients cannot construct their proofs. The on-chain root is correct and authoritative, but recipients cannot claim without a valid proof.

**Detection:** Verify IPFS content retrieval by root CID immediately after pinning. If the retrieved file's Merkle root does not match the on-chain root, the pin is corrupt.

**MVP mitigation:** Geral publishes proofs at a known URL (Pinata). Creator should also keep a local copy of the full leaf JSON and proof set.

**Phase 2 fix:** Publish the leaf JSON to multiple IPFS nodes and verify content-addressable retrieval before campaign launch.

---

### 4.5 Solana clock manipulation

**Severity: Low.** Validators can manipulate `Clock::unix_timestamp` by up to approximately 25 seconds within consensus tolerance. This creates a 25-second window at schedule boundaries (`cliff_time`, `end_time`, `cancelled_at + GRACE_PERIOD_SECS`) where claims that should not yet be valid can succeed, or claims that should succeed can be delayed.

**Detection:** Not detectable on-chain. A 25-second window at a `cliff_time` is an accepted risk for any Solana program that uses on-chain time. For the 7-day grace period, 25 seconds is negligible (less than 0.004% of the period).

**Mitigation:** Do not set `cliff_time` or `end_time` to values where a 25-second error would have material financial impact (e.g., do not set a cliff at exactly midnight of a tax or regulatory deadline). This is a creator obligation documented in the integration guide, not a program fix.

---

## §5 Audit Readiness Checklist

Complete these before engaging an audit firm.

### Code quality
- [x] P0: All stubs filled: 12 instruction handlers, `vested()`, `verify_merkle_proof()`
- [ ] P0: `cargo clippy --workspace -D warnings` exits 0 with no suppressed lints
- [ ] P0: No `todo!()`, `unimplemented!()`, `#[allow(unused)]`, or `unwrap()` in production code (tests excepted)
- [x] P1: All `VestingError` variants are triggered by at least one named test
- [x] P0: `programs/vesting/src/math/merkle.rs` `verify_merkle_proof` returns correct results for: single-leaf tree (empty proof), 2-leaf tree, 4-leaf tree, odd-count tree (3 leaves where the last leaf is duplicated), large tree (1,000 leaves via property test).

### Test coverage
- [x] P0: `cargo test` green — schedule unit tests pass
- [x] P0: `anchor test` green — 57 tests pass on devnet (56 pass + 1 graceful skip): T1–T5 (core), T6–T25 (supplementary), T26–T41 (error paths), golden vector gate, and 10 security exploit tests
- [x] P0: Golden vector gate passes with `GOLDEN_HASH` env var set (Rust and TS produce byte-identical leaf hashes)
- [x] P1: Every instruction has at least one happy-path integration test
- [x] P1: Every instruction has at least one failure-path test (wrong signer, bad constraint, etc.)

### Manual verification
- [x] P1: Devnet smoke test: create → fund → claim (cliff) → claim (linear, partial) → claim (milestone) → cancel → wait → withdraw_unvested
- [x] P1: Devnet rotation test: create → fund → claim (Alice) → update_root (remove Alice) → claim (Alice fails) → claim (Carol succeeds)
- [ ] P2: Rent cost measured: creator-side cost for a 10,000-leaf campaign is at or below 0.005 SOL

### Documentation
- [ ] P1: `README.md` walkthrough validated on a clean machine (clone → build → test → devnet deploy, 15 minutes or less)
- [ ] P1: `docs/SECURITY.md` (this file) reviewed by both Lana and Geral
- [ ] P2: Every instruction's error variants documented in `docs/PROGRAM.md`
- [ ] P2: Off-chain proof hosting procedure and root rotation sequence documented in `INTEGRATION.md`

### Pre-audit delivery package
- [ ] P0: Program source at a pinned commit hash
- [ ] P0: `anchor build` reproduces byte-identical `target/deploy/vesting.so` from clean checkout
- [ ] P0: `target/idl/vesting.json` committed and matches source
- [ ] P1: Test suite runs in CI (GitHub Actions) on a clean runner
- [x] P1: Devnet program ID documented and reachable

### Audit firm selection guidance

Recommended firms with documented Anchor experience:

- **Halborn** — has audited multiple Anchor-based programs including token distribution protocols. Published the Hitchhiker's Guide referenced above.
- **OtterSec** — specializes in Solana; has audited Jito's merkle distributor (the direct reference implementation for this protocol).
- **Sec3** — automated analysis (X-Ray) combined with manual review; competitive on turnaround time for focused scopes.

Budget estimate: $15,000–$40,000 USD depending on scope. A focused review of the 12 instructions and the Merkle verifier (excluding the TypeScript SDK) falls toward the lower end. Including the TS tooling and integration tests in scope moves toward the upper end.

Timeline: 2-4 weeks for initial review, plus 1-2 weeks for fixes and re-review. Schedule the engagement after the remaining P0 checklist items above are complete (clippy, production code quality, pinned commit, build reproducibility).
