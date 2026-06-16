use anchor_lang::prelude::*;

use crate::constants::{EMPTY_LEAF_SLOT, PER_LEAF_CAP};
use crate::errors::VestingError;
use crate::state::leaf::VestingLeaf;

/// One `ClaimRecord` per `(tree, beneficiary)`, seeded `[b"claim", tree, beneficiary]`.
///
/// Layout history:
///   v0 (legacy): beneficiary, tree, claimed_amount, total_entitled, milestone_bitmap,
///                last_claim_at, bump. (121 data bytes.)
///   v1 (Issue #29 fix): adds `version` + per-leaf ledger so a beneficiary holding
///       multiple cliff/linear leaves is paid correctly and independently. `claimed_amount`
///       remains the running SUM across all leaves (events + `close_claim_record` read it);
///       the per-leaf ledger is the source of truth for the per-leaf `claimable` delta.
///
/// `zero_copy` is used (not Borsh) so legacy v0 accounts — which are shorter — can be
/// loaded by discriminator and grown via `realloc` on first post-fix touch (see
/// `instructions::claim` migration). Access is via `AccountLoader<ClaimRecord>`.
#[account(zero_copy)]
pub struct ClaimRecord {
    pub beneficiary:      Pubkey,
    pub tree:             Pubkey,
    /// Running SUM of tokens transferred to this beneficiary across ALL leaves
    /// (read by the `Claimed` event and by `close_claim_record`).
    pub claimed_amount:   u64,
    /// Running SUM of `leaf.amount` across every leaf the beneficiary has TOUCHED
    /// (all release types). Accumulated on first-touch-per-leaf. Used by
    /// `close_claim_record` to gate close without trusting caller-supplied values.
    pub total_entitled:   u64,
    pub milestone_bitmap: [u8; 32],
    pub last_claim_at:    i64,
    pub bump:             u8,
    /// Layout version. 0 = legacy (pre Issue-#29). 1 = per-leaf tracking active.
    pub version:          u8,
    // Explicit padding so bytemuck `Pod` (which forbids implicit padding) accepts the
    // repr(C) layout. Field order is otherwise preserved so a legacy v0 ClaimRecord's
    // first 121 bytes still map exactly onto this struct for lazy migration.
    pub _pad_leaf_idx:    [u8; 2],
    /// Parallel arrays, length `PER_LEAF_CAP`. Slot `i` is occupied iff
    /// `leaf_claimed_idx[i] != EMPTY_LEAF_SLOT`; the key is the Merkle-verified
    /// `leaf.leaf_index`. Milestone leaves do NOT consume slots.
    pub leaf_claimed_idx: [u32; PER_LEAF_CAP],
    pub _pad_leaf_amt:    [u8; 4],
    pub leaf_claimed_amt: [u64; PER_LEAF_CAP],
}

/// Result of locating a `leaf_index` in the per-leaf ledger.
pub enum LeafSlot {
    Occupied(usize),
    Empty(usize),
    Full,
}

impl ClaimRecord {
    /// Initialise the per-leaf ledger to empty and mark `version = 1`. Used on
    /// first-touch and after legacy `realloc` (`realloc` zero-fills the new bytes,
    /// which would otherwise leave `leaf_claimed_idx` as `0` — a valid leaf_index
    /// — falsely marking slot 0 occupied).
    pub fn init_per_leaf_ledger(&mut self) {
        self.version = 1;
        self.leaf_claimed_idx = [EMPTY_LEAF_SLOT; PER_LEAF_CAP];
        self.leaf_claimed_amt = [0u64; PER_LEAF_CAP];
    }

    /// True if this is a pre-fix (v0) account that still needs migration.
    pub fn needs_migration(&self) -> bool {
        self.version == 0
    }

    /// Find the slot for `leaf_index`: `Occupied(i)` if already tracked, `Empty(i)`
    /// for the first free slot, or `Full` if `PER_LEAF_CAP` is exhausted.
    /// Linear scan over `PER_LEAF_CAP` (8) — fixed, cheap CU.
    pub fn find_leaf_slot(&self, leaf_index: u32) -> LeafSlot {
        let mut first_empty: Option<usize> = None;
        for i in 0..PER_LEAF_CAP {
            if self.leaf_claimed_idx[i] == leaf_index {
                return LeafSlot::Occupied(i);
            }
            if self.leaf_claimed_idx[i] == EMPTY_LEAF_SLOT && first_empty.is_none() {
                first_empty = Some(i);
            }
        }
        match first_empty {
            Some(i) => LeafSlot::Empty(i),
            None => LeafSlot::Full,
        }
    }

    /// Cumulative tokens already claimed for `leaf_index` (0 if untracked).
    pub fn leaf_prior_claimed(&self, leaf_index: u32) -> u64 {
        match self.find_leaf_slot(leaf_index) {
            LeafSlot::Occupied(i) => self.leaf_claimed_amt[i],
            _ => 0,
        }
    }

    /// Record `claimable` against `leaf_index`, creating a slot if needed.
    /// Returns `PerLeafCapExceeded` if the ledger is full and the leaf is new.
    pub fn record_leaf_claim(&mut self, leaf_index: u32, claimable: u64) -> Result<()> {
        match self.find_leaf_slot(leaf_index) {
            LeafSlot::Occupied(i) => {
                self.leaf_claimed_amt[i] = self
                    .leaf_claimed_amt[i]
                    .checked_add(claimable)
                    .ok_or(VestingError::Overflow)?;
            }
            LeafSlot::Empty(i) => {
                self.leaf_claimed_idx[i] = leaf_index;
                self.leaf_claimed_amt[i] = claimable;
            }
            LeafSlot::Full => {
                return Err(VestingError::PerLeafCapExceeded.into());
            }
        }
        Ok(())
    }

    /// True iff this leaf has already contributed to `total_entitled` (i.e. was
    /// touched before). Milestone leaves use the bitmap; cliff/linear use the ledger.
    pub fn leaf_already_counted(&self, leaf: &VestingLeaf) -> bool {
        if leaf.release_type == 2 {
            let byte_idx = leaf.milestone_idx as usize / 8;
            let bit_idx = leaf.milestone_idx as usize % 8;
            self.milestone_bitmap[byte_idx] & (1 << bit_idx) != 0
        } else {
            matches!(self.find_leaf_slot(leaf.leaf_index), LeafSlot::Occupied(_))
        }
    }
}

/// Grow a legacy (pre-Issue-#29, shorter) `ClaimRecord` up to the current layout
/// size before it is loaded.
///
/// With `zero_copy`, entry deserialization only validates the 8-byte discriminator,
/// so a shorter legacy account still reaches the handler. We `realloc` it here
/// (and top up rent-exempt lamports from the beneficiary), after which `load_mut`
/// succeeds. The realloc zero-fills the appended bytes, so the caller will observe
/// `version == 0` and must run `init_per_leaf_ledger` (and attribute any legacy
/// `claimed_amount`) afterwards.
///
/// Accounts already at the current size are a no-op.
pub fn migrate_legacy_claim_record<'info>(
    loader: &AccountLoader<'info, ClaimRecord>,
    payer: &Signer<'info>,
) -> Result<()> {
    let info = loader.to_account_info();
    let new_len = 8 + std::mem::size_of::<ClaimRecord>();
    if info.data_len() >= new_len {
        return Ok(());
    }

    let rent = Rent::get()?;
    let new_min = rent.minimum_balance(new_len);
    // `resize` grows the account data and zero-fills the appended bytes (the BPF
    // realloc syscall is wrapped here in solana-account-info 3.x), enforcing the
    // per-instruction 10 KB data-increase limit.
    info.resize(new_len)?;

    // CEI ordering: fund the rent delta before any field writes via load_mut.
    let delta = new_min.saturating_sub(info.lamports());
    if delta > 0 {
        let payer_info = payer.to_account_info();
        **payer_info.try_borrow_mut_lamports()? = payer_info
            .lamports()
            .checked_sub(delta)
            .ok_or(VestingError::Overflow)?;
        **info.try_borrow_mut_lamports()? = info
            .lamports()
            .checked_add(delta)
            .ok_or(VestingError::Overflow)?;
    }

    Ok(())
}
