use anchor_lang::prelude::*;

#[event]
pub struct CampaignCreated {
    pub tree:         Pubkey,
    pub creator:      Pubkey,
    pub mint:         Pubkey,
    pub total_supply: u64,
    pub leaf_count:   u32,
    pub cancellable:  bool,
}

#[event]
pub struct CampaignFunded {
    pub tree:                Pubkey,
    pub amount:              u64,
    pub vault_balance_after: u64,
}

#[event]
pub struct Claimed {
    pub tree:                  Pubkey,
    pub beneficiary:           Pubkey,
    pub leaf_index:            u32,
    pub amount:                u64,
    pub total_claimed_by_user: u64,
    pub total_claimed_overall: u64,
    pub milestone_idx:         Option<u8>,
}

#[event]
pub struct CampaignCancelled {
    pub tree:              Pubkey,
    pub cancelled_at:      i64,
    pub claimed_at_cancel: u64,
}

#[event]
pub struct RootUpdated {
    pub tree:           Pubkey,
    pub old_root:       [u8; 32],
    pub new_root:       [u8; 32],
    pub new_leaf_count: u32,
}

#[event]
pub struct UnvestedWithdrawn {
    pub tree:   Pubkey,
    pub amount: u64,
}

#[event]
pub struct CampaignPaused { pub tree: Pubkey }

#[event]
pub struct CampaignUnpaused { pub tree: Pubkey }

#[event]
pub struct ClaimRecordClosed {
    pub tree:        Pubkey,
    pub beneficiary: Pubkey,
}

#[event]
pub struct MilestoneReleased {
    pub tree:          Pubkey,
    pub milestone_idx: u8,
    pub released_by:   Pubkey,
}

#[event]
pub struct StreamCancelled {
    pub tree:                 Pubkey,
    pub cancelled_at:         i64,
    pub amount_to_beneficiary: u64,
    pub amount_to_creator:    u64,
}

#[event]
pub struct InstantRefunded {
    pub tree:         Pubkey,
    pub cancelled_at: i64,
    pub refunded_to:  Pubkey,
    pub amount:       u64,
}
