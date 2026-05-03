use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct VestingLeaf {
    pub leaf_index:    u32,
    pub beneficiary:   Pubkey,
    pub amount:        u64,
    pub release_type:  u8,
    pub start_time:    i64,
    pub cliff_time:    i64,
    pub end_time:      i64,
    pub milestone_idx: u8,
}
