use anchor_lang::prelude::*;

use crate::errors::VestingError;
use crate::events::CampaignCancelled;

#[derive(Accounts)]
pub struct CancelCampaign<'info> {
    pub cancel_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"tree",
                 vesting_tree.creator.as_ref(),
                 vesting_tree.mint.as_ref(),
                 &vesting_tree.campaign_id.to_le_bytes()],
        bump = vesting_tree.bump,
        constraint = vesting_tree.cancellable @ VestingError::NotCancellable,
        constraint = vesting_tree.cancelled_at.is_none() @ VestingError::AlreadyCancelled,
        constraint = vesting_tree.cancel_authority == Some(cancel_authority.key()) @ VestingError::Unauthorized,
        constraint = vesting_tree.total_claimed < vesting_tree.total_supply @ VestingError::FullyVested,
    )]
    pub vesting_tree: Account<'info, crate::state::VestingTree>,
}

pub fn handler(ctx: Context<CancelCampaign>) -> Result<()> {
    let tree = &mut ctx.accounts.vesting_tree;
    let cancelled_at = Clock::get()?.unix_timestamp;
    let claimed_at_cancel = tree.total_claimed;

    tree.cancelled_at = Some(cancelled_at);

    emit!(CampaignCancelled {
        tree: tree.key(),
        cancelled_at,
        claimed_at_cancel,
    });

    Ok(())
}
