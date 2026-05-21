use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct VestingTree {
    pub creator:          Pubkey,
    pub mint:             Pubkey,
    pub vault:            Pubkey,
    pub vault_authority:  Pubkey,
    pub campaign_id:      u64,
    pub merkle_root:      [u8; 32],
    pub leaf_count:       u32,
    pub total_supply:     u64,
    pub total_claimed:    u64,
    pub cancellable:      bool,
    pub cancel_authority: Option<Pubkey>,
    pub cancelled_at:     Option<i64>,
    pub paused:           bool,
    pub pause_authority:  Option<Pubkey>,
    pub created_at:       i64,
    /// Creator-controlled release flags for milestone leaves (bit = milestone_idx).
    pub milestone_released_flags: [u8; 32],
    pub bump:             u8,
}

pub fn milestone_flag_is_set(flags: &[u8; 32], milestone_idx: u8) -> bool {
    let byte_idx = milestone_idx as usize / 8;
    let bit_idx = milestone_idx as usize % 8;
    flags[byte_idx] & (1 << bit_idx) != 0
}

pub fn set_milestone_flag(flags: &mut [u8; 32], milestone_idx: u8) {
    let byte_idx = milestone_idx as usize / 8;
    let bit_idx = milestone_idx as usize % 8;
    flags[byte_idx] |= 1 << bit_idx;
}
