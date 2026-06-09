use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ClaimRecord {
    pub beneficiary:      Pubkey,
    pub tree:             Pubkey,
    pub claimed_amount:   u64,
    /// Total entitled across all claimed leaves. Set on first claim,
    /// then accumulated for each subsequent milestone claim.
    /// Used by close_claim_record to verify full vesting without trusting
    /// a caller-supplied value.
    ///
    /// NOTE: Adding this field is a layout-breaking change. Existing
    /// on-chain ClaimRecords predating this field cannot be deserialized
    /// correctly and require a migration (e.g. resize + fill or close + re-claim).
    pub total_entitled:   u64,
    pub milestone_bitmap: [u8; 32],
    pub last_claim_at:    i64,
    pub bump:             u8,
}
