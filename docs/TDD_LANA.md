# TDD — Mancer Vesting Protocol (Lana's Scope)

**Author:** Lana — smart-contract / backend lead  
**Status:** Week 4 implementation spec  
**Companion docs:** `docs/PRD_LANA.md`, `docs/SECURITY.md`, `docs/PROGRAM.md`

This document is the implementation blueprint. Every section maps to a stub in the codebase that needs to be filled.

---

## §1 Tech Stack (pinned)

### Rust / Anchor

| Crate | Version | Reason |
|---|---|---|
| `anchor-lang` | `1.0.0` | Stable major release (April 2026). Declarative account validation — the #1 source of Solana exploits is hand-rolled account checks. |
| `anchor-spl` | `1.0.0` | SPL Token CPIs for `fund_campaign`, `claim`, `withdraw_unvested`. **Not yet in `Cargo.toml` — must be added.** |
| `solana-keccak-hasher` | `2.2` | Already in deps. Used by `leaf_hash()`. Same crate for `verify_merkle_proof`. |
| `solana-program` | `2.1` (transitive) | Via anchor. |

**`Cargo.toml` change required:**
```toml
[dependencies]
anchor-lang = { version = "1.0.0", features = ["init-if-needed"] }
anchor-spl  = "1.0.0"
solana-keccak-hasher = "2.2"

[features]
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]
```

Without `anchor-spl`, no instruction that touches tokens can compile. Without `anchor-spl/idl-build` in the feature, the IDL build fails.

### TypeScript

| Package | Version | Reason |
|---|---|---|
| `@coral-xyz/anchor` | `^0.32.1` | IDL consumption, program interaction — **this is the version in root `package.json`; upgrade to `^1.0.0` when Anchor 1.0 client lands** |
| `@solana/web3.js` | `^1.95.0` | Keypair, PublicKey, Connection |
| `@solana/spl-token` | `^0.4.6` | ATA derivation, `getAccount` in tests |
| `js-sha3` | `^0.9.3` | keccak256 — must produce byte-identical output to on-chain `hashv` |
| `bn.js` | `^5.2.1` | u64 / i64 without precision loss |
| `merkletreejs` | `^0.4.0` | Listed in deps; our `VestingMerkleTree` is hand-rolled for index-based proofs but this is available |

Test deps: `mocha`, `ts-mocha`, `chai`, `typescript`.

**`clients/ts/package.json` has zero runtime dependencies today** — all packages above must be added before the TS client compiles. The root `package.json` has dev deps for testing, but the client package needs its own `dependencies` block with at minimum: `js-sha3`, `bn.js`, `@coral-xyz/anchor`, `@solana/web3.js`, `@solana/spl-token`.

---

## §2 Merkle Algorithm Spec

This section is the contract between the Rust on-chain verifier and the TypeScript tree builder. Any divergence causes every claim to fail with `InvalidProof` in production.

### 2.1 Hash function

**Algorithm:** keccak256  
**On-chain:** `solana_keccak_hasher::hashv(&[...slices])` — produces `[u8; 32]`  
**Off-chain (TS):** `keccak_256.array(Buffer)` from `js-sha3` — produces `number[]` (32 elements)

### 2.2 Domain-separation prefixes

```
LEAF_PREFIX = 0x00   // prepended to leaf payload before hashing
NODE_PREFIX = 0x01   // prepended to child pair before hashing
```

**Why:** Without prefixes, a leaf hash could equal an internal node hash (second-preimage attack). An attacker could construct a fake "leaf" whose hash matches an internal node, letting them forge proofs. The prefix byte makes the input domains disjoint.

These constants are defined directly in `programs/vesting/src/math/merkle.rs` (not imported from `constants.rs`, even though `constants.rs` also defines them). Use the local definitions when implementing `verify_merkle_proof` in that file.

### 2.3 Leaf hash

```
leaf_hash(leaf) = keccak256([LEAF_PREFIX] ++ borsh_serialize(leaf))
```

`borsh_serialize(leaf)` is the Borsh little-endian binary encoding of `VestingLeaf`, in **Rust struct field declaration order** (see §2.5 wire format). Total payload = 1 (prefix) + 70 (leaf) = 71 bytes into the hash function. In Rust, this is `borsh::to_vec(leaf).unwrap()` — not the older `try_to_vec()` method.

`leaf_hash()` in `math/merkle.rs` is already **LIVE** and correct.

### 2.4 Node hash

```
node_hash(left, right) = keccak256([NODE_PREFIX] ++ left ++ right)
```

Left and right are determined by the leaf's position (index) at each tree level:

```
if index & 1 == 0:   // current node is the LEFT child
    hash = node_hash(current, sibling)
else:                // current node is the RIGHT child
    hash = node_hash(sibling, current)
index >>= 1          // move up one level
```

### 2.5 VestingLeaf wire format (Borsh LE, 70 bytes)

**This is the canonical byte layout. TS encoder must match field-by-field.**

| Field | Rust type | Borsh encoding | Offset | Size |
|---|---|---|---|---|
| `leaf_index` | `u32` | 4-byte LE unsigned | 0 | 4 |
| `beneficiary` | `Pubkey` | 32 bytes raw | 4 | 32 |
| `amount` | `u64` | 8-byte LE unsigned | 36 | 8 |
| `release_type` | `u8` | 1 byte | 44 | 1 |
| `start_time` | `i64` | 8-byte LE signed | 45 | 8 |
| `cliff_time` | `i64` | 8-byte LE signed | 53 | 8 |
| `end_time` | `i64` | 8-byte LE signed | 61 | 8 |
| `milestone_idx` | `u8` | 1 byte | 69 | 1 |
| **Total** | | | | **70** |

Rust Borsh serializes struct fields in **declaration order**. The `VestingLeaf` struct in `state/leaf.rs` must declare fields in exactly this order. Do not reorder.

### 2.6 `verify_merkle_proof` — implementation spec

File: `programs/vesting/src/math/merkle.rs`  
Status: **STUB** — currently returns `false`

```rust
pub fn verify_merkle_proof(
    leaf:      [u8; 32],
    proof:     &[[u8; 32]],
    mut index: u32,
    root:      [u8; 32],
) -> bool {
    let mut hash = leaf;
    for sibling in proof {
        hash = if index & 1 == 0 {
            hashv(&[&[NODE_PREFIX], &hash, sibling]).to_bytes()
        } else {
            hashv(&[&[NODE_PREFIX], sibling, &hash]).to_bytes()
        };
        index >>= 1;
    }
    hash == root
}
```

`hashv` is `solana_keccak_hasher::hashv` — already imported in the file.

**Empty proof (single-leaf tree):** loop doesn't execute; `hash == root` checks that `leaf_hash == root` directly. Correct.

**Odd-leaf tree:** the tree builder duplicates the last leaf as its own sibling. The verifier doesn't need special handling — the proof already encodes the sibling correctly.

### 2.7 Off-chain tree building (TS spec)

File: `clients/ts/src/merkle.ts` (to create)

```
Input:  VestingLeaf[] (sorted by leafIndex, leafIndex must equal position)
Output: root (32 bytes), proof for any leaf (ordered list of sibling hashes)

Layer 0: [leafHash(leaf[0]), leafHash(leaf[1]), ..., leafHash(leaf[n-1])]
Layer k+1:
  for i = 0, 2, 4, ...:
    left  = layer[k][i]
    right = layer[k][i+1] if it exists, else layer[k][i]  // duplicate odd
    layer[k+1][i/2] = nodeHash(left, right)
Root = layer[last][0]

Proof for index i at layer k:
  sibling_index = i ^ 1 (XOR with 1 flips last bit — the partner)
  if sibling_index >= layer[k].length: sibling = layer[k][i]  // duplicate-odd case
  else: sibling = layer[k][sibling_index]
  next_index = i >> 1
```

**Validation the constructor must enforce:**  
`leaves[i].leafIndex === i` for all i. If not, throw — the on-chain verifier uses `leaf.leaf_index` to walk the proof, so any mismatch silently fails proof verification.

---

## §3 Schedule Math Spec

File: `programs/vesting/src/math/schedule.rs`  
Status: **STUB** — both functions return `0`

### 3.1 `vested(leaf, now) -> u64`

```rust
pub fn vested(leaf: &VestingLeaf, now: i64) -> u64 {
    match leaf.release_type {
        0 /* Cliff */ => {
            if now >= leaf.cliff_time { leaf.amount } else { 0 }
        }
        1 /* Linear */ => {
            // Check end_time BEFORE cliff_time. When cliff_time == end_time,
            // this branch fires first and returns leaf.amount, avoiding
            // division by zero in the proportional branch.
            if now >= leaf.end_time   { return leaf.amount; }
            if now <= leaf.cliff_time { return 0; }
            let elapsed  = (now - leaf.cliff_time) as u128;
            let duration = (leaf.end_time - leaf.cliff_time) as u128;
            ((leaf.amount as u128 * elapsed) / duration) as u64
        }
        2 /* Milestone */ => {
            // Each milestone leaf unlocks its full amount at cliff_time.
            // Double-claim prevention is in ClaimRecord.milestone_bitmap,
            // not here.
            if now >= leaf.cliff_time { leaf.amount } else { 0 }
        }
        _ => 0,
    }
}
```

**Why `u128` for linear math:** `u64::MAX * i64::MAX as u64` overflows u64 but fits in u128. Without the cast, a beneficiary with a very large grant and a long vesting window gets a corrupted claim amount.

### 3.2 `get_vested_amount(leaf, cancelled_at, now) -> u64`

```rust
pub fn get_vested_amount(
    leaf:         &VestingLeaf,
    cancelled_at: Option<i64>,
    now:          i64,
) -> u64 {
    let effective_now = match cancelled_at {
        Some(c) => now.min(c),
        None    => now,
    };
    vested(leaf, effective_now)
}
```

After a campaign is cancelled, `effective_now` is clamped to `cancelled_at`. Every future `claim` call runs the schedule math against this frozen timestamp, ensuring recipients see exactly what was vested at cancellation — no more, no less.

### 3.3 Unit tests to add inside `schedule.rs`

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::Pubkey;

    fn leaf(amount: u64, cliff: i64, end: i64, typ: u8) -> VestingLeaf {
        VestingLeaf {
            leaf_index: 0, beneficiary: Pubkey::default(),
            amount, release_type: typ,
            start_time: cliff, cliff_time: cliff, end_time: end,
            milestone_idx: 0,
        }
    }

    #[test] fn cliff_before_after() {
        let l = leaf(1_000, 100, 200, 0);
        assert_eq!(vested(&l, 99), 0);
        assert_eq!(vested(&l, 100), 1_000);
        assert_eq!(vested(&l, 999), 1_000);
    }

    #[test] fn linear_curve() {
        let l = leaf(1_000, 100, 200, 1);
        assert_eq!(vested(&l, 50), 0);
        assert_eq!(vested(&l, 100), 0);
        assert_eq!(vested(&l, 150), 500);
        assert_eq!(vested(&l, 200), 1_000);
        assert_eq!(vested(&l, 999), 1_000);
    }

    #[test] fn linear_no_overflow_at_max_amount() {
        let l = leaf(u64::MAX, 0, 1_000_000, 1);
        let half = vested(&l, 500_000);
        // Allow ±1 for integer truncation
        assert!(half >= u64::MAX / 2 - 1);
    }

    #[test] fn linear_degenerate_cliff_eq_end() {
        // cliff == end: treated as cliff, no div-by-zero
        let l = leaf(1_000, 100, 100, 1);
        assert_eq!(vested(&l, 99),  0);
        assert_eq!(vested(&l, 100), 1_000);
    }

    #[test] fn cancel_clamp() {
        let l = leaf(1_000, 100, 200, 1);
        // Cancelled at t=150 → 50% vested; now=999 but clamped to 150
        assert_eq!(get_vested_amount(&l, Some(150), 999), 500);
        // No cancel → full amount at t=999
        assert_eq!(get_vested_amount(&l, None, 999), 1_000);
    }
}
```

---

## §4 Instruction Implementation Spec

Each section covers one instruction. For each: required accounts (full constraint block), validation order, state mutations, event. These expand the minimal stubs in `programs/vesting/src/instructions/`.

All instructions import from `anchor_spl::token::{Token, TokenAccount, Mint, Transfer}` and `anchor_spl::associated_token::AssociatedToken` where needed.

---

### 4.1 `create_campaign`

**Purpose:** Creator registers a Merkle root and opens an empty vault.

**Accounts block:**
```rust
#[derive(Accounts)]
#[instruction(args: CreateCampaignArgs)]
pub struct CreateCampaign<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + VestingTree::INIT_SPACE,
        seeds = [b"tree",
                 creator.key().as_ref(),
                 mint.key().as_ref(),
                 &args.campaign_id.to_le_bytes()],
        bump,
    )]
    pub vesting_tree: Account<'info, VestingTree>,

    /// CHECK: PDA — never deserialized, only used as vault token-account authority.
    #[account(seeds = [b"vault_authority", vesting_tree.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = creator,
        associated_token::mint      = mint,
        associated_token::authority = vault_authority,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    pub token_program:            Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program:           Program<'info, System>,
    pub rent:                     Sysvar<'info, Rent>,
}
```

**Validation order:**
1. `args.merkle_root != [0u8; 32]` → `EmptyRoot`
2. `args.leaf_count > 0` → `EmptyCampaign`
3. `args.total_supply > 0` → `ZeroAmount`
4. `if args.cancellable { args.cancel_authority.is_some() }` → `MissingCancelAuthority`

**State mutations:** Populate all `VestingTree` fields. `total_claimed = 0`, `cancelled_at = None`, `paused = false`, `created_at = Clock::get()?.unix_timestamp`, `bump = ctx.bumps.vesting_tree`.

**Event:** `CampaignCreated { tree, creator, mint, total_supply, leaf_count, cancellable }`

---

### 4.2 `fund_campaign`

**Purpose:** Creator transfers tokens into the vault. Separated from `create_campaign` so the source ATA isn't required at campaign creation time.

**Accounts block:**
```rust
#[derive(Accounts)]
pub struct FundCampaign<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        has_one = creator @ VestingError::Unauthorized,
        has_one = vault   @ VestingError::WrongVault,
        seeds = [b"tree",
                 creator.key().as_ref(),
                 vesting_tree.mint.as_ref(),
                 &vesting_tree.campaign_id.to_le_bytes()],
        bump = vesting_tree.bump,
    )]
    pub vesting_tree: Account<'info, VestingTree>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = source_ata.mint  == vesting_tree.mint @ VestingError::MintMismatch,
        constraint = source_ata.owner == creator.key()      @ VestingError::Unauthorized,
    )]
    pub source_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
```

**Validation order:**
1. `amount > 0` → `ZeroAmount`
2. `vesting_tree.cancelled_at.is_none()` → `CampaignCancelled`
3. `vault.amount.checked_add(amount) <= total_supply` → `OverFunded`; also propagate `Overflow`

**State mutations:** None to program accounts. SPL `token::transfer` CPI: `source_ata → vault`.

**Event:** `CampaignFunded { tree, amount, vault_balance_after }`

---

### 4.3 `claim` (hot path)

**Purpose:** Beneficiary withdraws currently-vested tokens. Can be called multiple times for linear schedules; once per milestone.

**Accounts block:**
```rust
#[derive(Accounts)]
#[instruction(leaf: VestingLeaf, _proof: Vec<[u8; 32]>)]
pub struct Claim<'info> {
    #[account(mut)]
    pub beneficiary: Signer<'info>,

    #[account(
        mut,
        seeds = [b"tree",
                 vesting_tree.creator.as_ref(),
                 vesting_tree.mint.as_ref(),
                 &vesting_tree.campaign_id.to_le_bytes()],
        bump = vesting_tree.bump,
    )]
    pub vesting_tree: Account<'info, VestingTree>,

    #[account(
        init_if_needed,
        payer = beneficiary,
        space = 8 + ClaimRecord::INIT_SPACE,
        seeds = [b"claim",
                 vesting_tree.key().as_ref(),
                 beneficiary.key().as_ref()],
        bump,
    )]
    pub claim_record: Account<'info, ClaimRecord>,

    /// CHECK: PDA — only used as signer for vault CPI.
    #[account(seeds = [b"vault_authority", vesting_tree.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(mut, address = vesting_tree.vault @ VestingError::WrongVault)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = beneficiary,
        associated_token::mint      = mint,
        associated_token::authority = beneficiary,
    )]
    pub beneficiary_ata: Account<'info, TokenAccount>,

    #[account(address = vesting_tree.mint @ VestingError::MintMismatch)]
    pub mint: Account<'info, Mint>,

    pub token_program:            Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program:           Program<'info, System>,
}
```

**Validation order — must be exact:**

1. `!vesting_tree.paused` → `CampaignPaused`
2. `beneficiary.key() == leaf.beneficiary` → `UnauthorizedClaimer` *(before proof — avoid leaking tree structure)*
3. `leaf.start_time <= leaf.cliff_time && leaf.cliff_time <= leaf.end_time` → `InvalidSchedule`
4. `leaf.release_type <= 2` → `InvalidScheduleType`
5. `verify_merkle_proof(leaf_hash(&leaf), &proof, leaf.leaf_index, vesting_tree.merkle_root)` → `InvalidProof`
6. **First-touch init** of `ClaimRecord` (detect `cr.beneficiary == Pubkey::default()`; populate identity fields)
7. Milestone guard: if `release_type == 2`, check bitmap bit `milestone_idx` → `MilestoneAlreadyClaimed`
8. `effective_now = vesting_tree.cancelled_at.map(|c| now.min(c)).unwrap_or(now)`
9. Compute `claimable`:
   - Cliff/Linear: `schedule::vested(&leaf, effective_now).saturating_sub(cr.claimed_amount)`
   - Milestone: `if effective_now >= leaf.cliff_time { leaf.amount } else { 0 }`
10. `claimable > 0` → `NothingToClaim`
11. `vault.amount >= claimable` → `InsufficientVault`
12. `vesting_tree.total_claimed.checked_add(claimable) <= total_supply` → `OverClaim` / `Overflow`

**State mutations (BEFORE the CPI — check-effects-interactions pattern):**
- `cr.claimed_amount += claimable` (checked)
- `cr.last_claim_at = now`
- If milestone: set bit `milestone_idx` in `cr.milestone_bitmap`
- `vesting_tree.total_claimed = new_total`
- SPL `token::transfer_with_signer` CPI: `vault → beneficiary_ata`, authority = `vault_authority` PDA

**Signer seeds for vault CPI:**
```rust
let tree_key = ctx.accounts.vesting_tree.key();
let bump     = ctx.bumps.vault_authority;
let seeds: &[&[&[u8]]] = &[&[b"vault_authority", tree_key.as_ref(), &[bump]]];
```

**First-touch init pattern:**
```rust
let cr = &mut ctx.accounts.claim_record;
if cr.beneficiary == Pubkey::default() {
    cr.tree             = ctx.accounts.vesting_tree.key();
    cr.beneficiary      = ctx.accounts.beneficiary.key();
    cr.claimed_amount   = 0;
    cr.milestone_bitmap = [0u8; 32];
    cr.last_claim_at    = 0;
    cr.bump             = ctx.bumps.claim_record;
}
```
`init_if_needed` skips the constructor on re-entry. The `Pubkey::default()` check detects first touch without clobbering existing state.

**Event:** `Claimed { tree, beneficiary, leaf_index, amount: claimable, total_claimed_by_user, total_claimed_overall, milestone_idx: Option<u8> }`

---

### 4.4 `cancel_campaign`

**Purpose:** Freeze the vesting curve at `now`. Recipients keep earned tokens; unvested goes back to creator after grace period.

> **Stub discrepancy:** the current stub in `instructions/cancel_campaign.rs` declares `authority: Signer<'info>`. Rename this field to `cancel_authority` when expanding — all constraint references below use that name.

**Accounts block:**
```rust
#[derive(Accounts)]
pub struct CancelCampaign<'info> {
    pub cancel_authority: Signer<'info>,

    #[account(
        mut,
        constraint = vesting_tree.cancellable                                      @ VestingError::NotCancellable,
        constraint = vesting_tree.cancelled_at.is_none()                           @ VestingError::AlreadyCancelled,
        constraint = vesting_tree.cancel_authority == Some(cancel_authority.key()) @ VestingError::Unauthorized,
    )]
    pub vesting_tree: Account<'info, VestingTree>,
}
```

**State mutations:** `vesting_tree.cancelled_at = Some(Clock::get()?.unix_timestamp)`

**Event:** `CampaignCancelled { tree, cancelled_at, claimed_at_cancel: vesting_tree.total_claimed }`

---

### 4.5 `update_root`

**Purpose:** Per-recipient clawback. Rotate the Merkle root to exclude/modify individual recipients without cancelling the campaign.

**Accounts block:**
```rust
#[derive(Accounts)]
pub struct UpdateRoot<'info> {
    pub cancel_authority: Signer<'info>,

    #[account(
        mut,
        constraint = vesting_tree.cancellable                                      @ VestingError::NotCancellable,
        constraint = vesting_tree.cancelled_at.is_none()                           @ VestingError::CampaignCancelled,
        constraint = vesting_tree.cancel_authority == Some(cancel_authority.key()) @ VestingError::Unauthorized,
    )]
    pub vesting_tree: Account<'info, VestingTree>,
}
```

**Validation order:**
1. `new_root != [0u8; 32]` → `EmptyRoot`
2. `new_leaf_count > 0` → `EmptyCampaign`
3. `new_root != vesting_tree.merkle_root` → `SameRoot`

**State mutations:** `vesting_tree.merkle_root = new_root; vesting_tree.leaf_count = new_leaf_count`

**Event:** `RootUpdated { tree, old_root, new_root, new_leaf_count }`

**Note on existing ClaimRecords:** They survive rotation unchanged. A kicked recipient's `claimed_amount` is preserved but they can no longer provide a valid proof. A recipient with a reduced amount gets `NothingToClaim` because `saturating_sub(cr.claimed_amount)` yields 0 or less.

---

### 4.6 `pause_campaign` / `unpause_campaign`

**Purpose:** Emergency stop on `claim`. Same accounts struct shared by both handlers.

> **Stub discrepancy:** the current stub in `instructions/pause_campaign.rs` declares `authority: Signer<'info>`. Rename this field to `pause_authority` when expanding. There is also no `UnpauseCampaign` type alias yet — add it as shown below.

**Accounts block:**
```rust
#[derive(Accounts)]
pub struct PauseCampaign<'info> {
    pub pause_authority: Signer<'info>,

    #[account(
        mut,
        constraint = vesting_tree.pause_authority.is_some()                      @ VestingError::NotPausable,
        constraint = vesting_tree.pause_authority == Some(pause_authority.key()) @ VestingError::Unauthorized,
        constraint = vesting_tree.cancelled_at.is_none()                         @ VestingError::CampaignCancelled,
    )]
    pub vesting_tree: Account<'info, VestingTree>,
}

pub type UnpauseCampaign<'info> = PauseCampaign<'info>;
```

**`pause_handler`:** `require!(!tree.paused, AlreadyPaused)` → `tree.paused = true` → emit `CampaignPaused`

**`unpause_handler`:** `require!(tree.paused, NotPaused)` → `tree.paused = false` → emit `CampaignUnpaused`

---

### 4.7 `withdraw_unvested`

**Purpose:** Creator sweeps vault after cancel + grace period.

**Accounts block:**
```rust
#[derive(Accounts)]
pub struct WithdrawUnvested<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        has_one = creator @ VestingError::Unauthorized,
        has_one = vault   @ VestingError::WrongVault,
        constraint = vesting_tree.cancelled_at.is_some() @ VestingError::NotCancelled,
    )]
    pub vesting_tree: Account<'info, VestingTree>,

    /// CHECK: PDA — only used as signer.
    #[account(seeds = [b"vault_authority", vesting_tree.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = creator_ata.mint  == vesting_tree.mint @ VestingError::MintMismatch,
        constraint = creator_ata.owner == creator.key()      @ VestingError::Unauthorized,
    )]
    pub creator_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
```

**Validation:**
```rust
let cancelled = vesting_tree.cancelled_at.ok_or(VestingError::NotCancelled)?;
require!(
    Clock::get()?.unix_timestamp >= cancelled + GRACE_PERIOD_SECS,
    VestingError::GracePeriodActive
);
```

**State mutations:** SPL `token::transfer_with_signer` CPI: `vault → creator_ata` for `vault.amount`. No program-account state changes.

**Event:** `UnvestedWithdrawn { tree, amount }`

---

### 4.8 `close_claim_record`

**Purpose:** Reclaim `ClaimRecord` rent (~0.0015 SOL) once fully claimed or after grace period.

**Accounts block:**
```rust
#[derive(Accounts)]
pub struct CloseClaimRecord<'info> {
    #[account(mut)]
    pub beneficiary: Signer<'info>,

    pub vesting_tree: Account<'info, VestingTree>,

    #[account(
        mut,
        close = beneficiary,
        has_one = beneficiary @ VestingError::Unauthorized,
        constraint = claim_record.tree == vesting_tree.key() @ VestingError::WrongVault,
        seeds = [b"claim", vesting_tree.key().as_ref(), beneficiary.key().as_ref()],
        bump = claim_record.bump,
    )]
    pub claim_record: Account<'info, ClaimRecord>,
}
```

**Parameter:** `expected_total: u64` — the sum of `leaf.amount` across every leaf the beneficiary owns. Frontend computes this from the off-chain tree before submitting.

**Validation:**
```rust
let fully_claimed = cr.claimed_amount >= expected_total;
let post_grace    = match tree.cancelled_at {
    Some(c) => Clock::get()?.unix_timestamp >= c + GRACE_PERIOD_SECS,
    None    => false,
};
require!(fully_claimed || post_grace, VestingError::CannotClose);
```

**State mutations:** Anchor `close = beneficiary` zeroes data and transfers lamports. No other mutations.

**Event:** `ClaimRecordClosed { tree, beneficiary }`

---

### 4.9 `get_vested_amount`

**Purpose:** Read-only helper for Phase 2 DeFi integrations (lending protocols check vested balance without claiming).

> **Stub discrepancy:** the current stub in `instructions/get_vested_amount.rs` has `viewer: Signer<'info>` in its accounts struct. This must be removed — the instruction takes no accounts at all. An empty struct `{}` is the correct form.

**Accounts block:**
```rust
#[derive(Accounts)]
pub struct GetVestedAmount {}
```

**Handler:** `Ok(schedule::get_vested_amount(&leaf, cancelled_at, now))`

Result returned via Anchor's `set_return_data` / `simulateTransaction`. Off-chain callers pay no fees (simulation). On-chain callers (other programs) read return data via `get_return_data`.

---

## §5 TS Client Spec

Files to create in `clients/ts/src/`. The Merkle helpers in `apps/web/src/lib/merkle/builder.ts` are already live — these files must produce **byte-identical** output (same algorithm, different package path for test consumption).

### 5.1 `clients/ts/src/leaf.ts`

```typescript
import { keccak_256 } from "js-sha3";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

export const LEAF_PREFIX = Buffer.from([0x00]);
export const NODE_PREFIX = Buffer.from([0x01]);

export enum ReleaseType {
  Cliff     = 0,
  Linear    = 1,
  Milestone = 2,
}

export interface VestingLeaf {
  leafIndex:    number;      // u32
  beneficiary:  PublicKey;   // 32 bytes
  amount:       BN;          // u64
  releaseType:  ReleaseType; // u8
  startTime:    BN;          // i64
  cliffTime:    BN;          // i64
  endTime:      BN;          // i64
  milestoneIdx: number;      // u8
}

// Manual Borsh LE encoding — must match Rust struct field order exactly.
export function encodeLeaf(leaf: VestingLeaf): Buffer {
  const buf = Buffer.alloc(70);
  let off = 0;
  buf.writeUInt32LE(leaf.leafIndex, off);             off += 4;
  leaf.beneficiary.toBuffer().copy(buf, off);         off += 32;
  buf.writeBigUInt64LE(BigInt(leaf.amount.toString()), off); off += 8;
  buf.writeUInt8(leaf.releaseType, off);              off += 1;
  buf.writeBigInt64LE(BigInt(leaf.startTime.toString()), off); off += 8;
  buf.writeBigInt64LE(BigInt(leaf.cliffTime.toString()), off); off += 8;
  buf.writeBigInt64LE(BigInt(leaf.endTime.toString()), off);   off += 8;
  buf.writeUInt8(leaf.milestoneIdx, off);
  return buf;
}

export function leafHash(leaf: VestingLeaf): Buffer {
  return Buffer.from(
    keccak_256.array(Buffer.concat([LEAF_PREFIX, encodeLeaf(leaf)]))
  );
}

export function nodeHash(left: Buffer, right: Buffer): Buffer {
  return Buffer.from(
    keccak_256.array(Buffer.concat([NODE_PREFIX, left, right]))
  );
}
```

### 5.2 `clients/ts/src/merkle.ts`

```typescript
import { leafHash, nodeHash, VestingLeaf } from "./leaf";

export class VestingMerkleTree {
  readonly leaves:     VestingLeaf[];
  readonly leafHashes: Buffer[];
  readonly layers:     Buffer[][];

  constructor(leaves: VestingLeaf[]) {
    if (leaves.length === 0) throw new Error("empty leaf set");
    leaves.forEach((l, i) => {
      if (l.leafIndex !== i)
        throw new Error(`leaf at position ${i} has leafIndex=${l.leafIndex}`);
    });

    this.leaves     = leaves;
    this.leafHashes = leaves.map(leafHash);
    this.layers     = [this.leafHashes.slice()];

    while (this.layers[this.layers.length - 1].length > 1) {
      const prev = this.layers[this.layers.length - 1];
      const next: Buffer[] = [];
      for (let i = 0; i < prev.length; i += 2) {
        const l = prev[i];
        const r = i + 1 < prev.length ? prev[i + 1] : prev[i]; // duplicate odd
        next.push(nodeHash(l, r));
      }
      this.layers.push(next);
    }
  }

  get root():      Buffer   { return this.layers[this.layers.length - 1][0]; }
  get rootHex():   string   { return this.root.toString("hex"); }
  get rootBytes(): number[] { return Array.from(this.root); }

  proof(index: number): Buffer[] {
    const out: Buffer[] = [];
    let i = index;
    for (let layer = 0; layer < this.layers.length - 1; layer++) {
      const arr     = this.layers[layer];
      const sibling = (i ^ 1) < arr.length ? i ^ 1 : i; // duplicate-odd
      out.push(arr[sibling]);
      i = Math.floor(i / 2);
    }
    return out;
  }

  proofAsBytes(index: number): number[][] {
    return this.proof(index).map(b => Array.from(b));
  }

  verify(index: number): boolean {
    const proof = this.proof(index);
    let hash = this.leafHashes[index];
    let i    = index;
    for (const sibling of proof) {
      hash = (i & 1) === 0 ? nodeHash(hash, sibling) : nodeHash(sibling, hash);
      i >>>= 1;
    }
    return hash.equals(this.root);
  }
}
```

### 5.3 `clients/ts/src/index.ts`

Replace `export {};` with:
```typescript
export * from "./leaf";
export * from "./merkle";
```

---

## §6 Test Plan

### Layer 1 — Rust unit tests (`cargo test`)

Location: `programs/vesting/src/math/schedule.rs` (inline `#[cfg(test)]` module)

Tests: `cliff_before_after`, `linear_curve`, `linear_no_overflow_at_max_amount`, `linear_degenerate_cliff_eq_end`, `cancel_clamp`. Full implementations in §3.3.

Also: `golden_leaf_hex` in `math/merkle.rs` (already scaffolded) — prints the Rust keccak hash for the canonical test leaf. Run with `-- --nocapture`.

---

### Layer 2 — Golden vector gate (`tests/golden_vector.spec.ts`)

**Purpose:** Byte-equality between Rust `leaf_hash()` and TS `leafHash()`. If this fails, every single claim in the protocol fails proof verification.

**Workflow:**
1. Run `cargo test --manifest-path programs/vesting/Cargo.toml -- --nocapture 2>&1 | grep RUST_GOLDEN_HEX`
2. Copy the hex
3. Run `GOLDEN_HASH=<hex> anchor test`

**Test structure:**
```typescript
describe("golden vector", () => {
  // These values must match the Rust golden test in math/merkle.rs exactly.
  // The Rust test uses cliff_time: 0 (not 1_700_000_000).
  // Run: cargo test -- --nocapture 2>&1 | grep RUST_GOLDEN_HEX
  // to get the expected hex before running this test.
  const leaf: VestingLeaf = {
    leafIndex: 0,
    beneficiary: new PublicKey("11111111111111111111111111111112"),
    amount: new BN(1_000_000),
    releaseType: ReleaseType.Linear,
    startTime: new BN(0),
    cliffTime: new BN(0),
    endTime: new BN(1_800_000_000),
    milestoneIdx: 0,
  };

  it("encodeLeaf is 70 bytes", () => {
    assert.equal(encodeLeaf(leaf).length, 70);
  });

  it("leafHash is deterministic and 32 bytes", () => {
    assert.deepEqual(leafHash(leaf), leafHash(leaf));
    assert.equal(leafHash(leaf).length, 32);
  });

  it("matches Rust golden hash", () => {
    const expected = process.env.GOLDEN_HASH ?? "";
    if (!expected) {
      console.log("TS hex:", leafHash(leaf).toString("hex"));
      return; // First run: print, then set env var
    }
    assert.equal(leafHash(leaf).toString("hex"), expected);
  });
});
```

---

### Layer 3 — Integration tests (`tests/vesting.spec.ts`)

**Setup utilities needed** (`tests/utils/setup.ts` and `tests/utils/time.ts`):
- `setup()` → provider, program, creator keypair, cancel/pause authorities, mint
- `airdrop(provider, pubkey, sol)`
- `fundCreatorAta(ctx, amount)` → mints tokens to creator
- `makeBeneficiary(ctx)` → new keypair with SOL
- `deriveTreePda(programId, creator, mint, campaignId)`
- `deriveVaultAuthority(programId, tree)`
- `deriveClaimRecord(programId, tree, beneficiary)`
- `vaultAta(mint, vaultAuthority)` → ATA address
- `past(secs)` / `future(secs)` → `BN` timestamps

**T1 — Linear mid-stream:**
- 1 beneficiary, linear leaf, `cliff = past(500)`, `end = future(500)` → ~50% elapsed
- Claim; assert transferred amount is 450_000–550_000 (±5%)
- Passing confirms: verify_merkle_proof, linear math, SPL CPI, ClaimRecord init

**T2 — Invalid proof:**
- 2 beneficiaries (need a real multi-leaf proof)
- Flip one byte in beneficiary[0]'s proof
- Expect `InvalidProof`
- Passing confirms: proof rejection path in claim

**T3 — Pause / unpause:**
- Cliff leaf, `cliff = past(10)` → immediately claimable
- `pause_campaign` → claim fails with `CampaignPaused`
- `unpause_campaign` → claim succeeds
- Passing confirms: pause toggle + claim guard

**T4 — Cancel clamp:**
- Linear leaf, `cliff = past(500)`, `end = future(500)`
- `cancel_campaign`
- Wait 1.5s (so `now > cancelled_at` is observable)
- Claim → amount ≤ 600_000 (pre-cancel vested, not full 1M)
- Passing confirms: `cancelled_at` clamp in effective_now calculation

**T5 — Root rotation:**
- 3 beneficiaries: Alice (idx 0), Bob (idx 1), Carol (idx 2)
- Alice claims against original tree (succeeds)
- Rebuild tree without Bob: Alice (idx 0), Carol (idx 1)
- `update_root(new_root, 2)`
- Bob's old proof → `InvalidProof`
- Carol's new proof (idx 1 in new tree) → success, balance = 3000
- Passing confirms: update_root, root rotation semantics, ClaimRecord persistence across rotation

**Additional tests (T6–T20)** — lower priority, same shape:
- T6: Claim before cliff → `NothingToClaim`
- T7: Claim at/after `end_time` → full amount
- T8: Double-claim (linear) → `NothingToClaim` on second call
- T9: Unauthorized claimer (Alice signs with Bob's leaf) → `UnauthorizedClaimer`
- T10: Milestone bitmap — claim milestone, second claim same idx → `MilestoneAlreadyClaimed`
- T11: Two milestones for one beneficiary, both claimable
- T12: `withdraw_unvested` before grace → `GracePeriodActive`
- T13: `close_claim_record` after full claim → refunds rent
- T14: `update_root` with same root → `SameRoot`
- T15: `update_root` from non-authority → `Unauthorized`
- T16: `update_root` after cancel → `CampaignCancelled`

---

## §7 Build Order

Execute in sequence (each step must compile/pass before the next):

1. Add `anchor-spl = "1.0.0"` to `programs/vesting/Cargo.toml` + update `idl-build` feature
2. Fill `math/schedule.rs` (`vested`, `get_vested_amount`, unit tests) → `cargo test` green
3. Fill `verify_merkle_proof` in `math/merkle.rs`
4. Expand + fill instructions in order: `create_campaign` → `fund_campaign` → `cancel_campaign` → `pause_campaign` → `claim` → `update_root` → `withdraw_unvested` → `close_claim_record` → `get_vested_amount`
5. `anchor build` → IDL must list all 10 instructions
6. Create `clients/ts/src/leaf.ts`, `merkle.ts`, update `index.ts`
7. Create `tests/utils/setup.ts`, `tests/utils/time.ts`
8. Create `tests/golden_vector.spec.ts`; run Rust golden hex test; set `GOLDEN_HASH`
9. Expand `tests/vesting.spec.ts` with T1–T5
10. `anchor test` → all green
