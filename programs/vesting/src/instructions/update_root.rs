use anchor_lang::prelude::*;

use crate::errors::VestingError;
use crate::events::RootUpdated;

#[derive(Accounts)]
pub struct UpdateRoot<'info> {
    pub cancel_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"tree",
                 vesting_tree.creator.as_ref(),
                 vesting_tree.mint.as_ref(),
                 &vesting_tree.campaign_id.to_le_bytes()],
        bump = vesting_tree.bump,
        constraint = vesting_tree.cancellable @ VestingError::NotCancellable,
        constraint = vesting_tree.cancelled_at.is_none() @ VestingError::CampaignCancelled,
        constraint = vesting_tree.cancel_authority == Some(cancel_authority.key()) @ VestingError::Unauthorized,
    )]
    pub vesting_tree: Account<'info, crate::state::VestingTree>,
}

pub fn handler(
    ctx: Context<UpdateRoot>,
    new_root: [u8; 32],
    new_leaf_count: u32,
    new_min_cliff_time: i64,
) -> Result<()> {
    require!(new_root != [0u8; 32], VestingError::EmptyRoot);
    require!(new_leaf_count > 0, VestingError::EmptyCampaign);
    require!(new_min_cliff_time != 0, VestingError::InvalidSchedule);
    require!(
        new_root != ctx.accounts.vesting_tree.merkle_root,
        VestingError::SameRoot
    );

    let tree = &mut ctx.accounts.vesting_tree;
    let old_root = tree.merkle_root;

    tree.merkle_root = new_root;
    tree.leaf_count = new_leaf_count;
    tree.min_cliff_time = new_min_cliff_time;

    emit!(RootUpdated {
        tree: tree.key(),
        old_root,
        new_root,
        new_leaf_count,
    });

    Ok(())
}
