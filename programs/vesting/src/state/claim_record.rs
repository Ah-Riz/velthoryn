use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ClaimRecord {
    pub beneficiary:      Pubkey,
    pub tree:             Pubkey,
    pub claimed_amount:   u64,
    pub milestone_bitmap: [u8; 32],
    pub last_claim_at:    i64,
    pub bump:             u8,
}
