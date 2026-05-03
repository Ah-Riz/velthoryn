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
    pub bump:             u8,
}
