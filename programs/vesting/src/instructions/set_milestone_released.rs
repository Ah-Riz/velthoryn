use anchor_lang::prelude::*;

use crate::errors::VestingError;
use crate::events::MilestoneReleased;
use crate::state::{set_milestone_flag, VestingTree};

#[derive(Accounts)]
pub struct SetMilestoneReleased<'info> {
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"tree",
                 vesting_tree.creator.as_ref(),
                 vesting_tree.mint.as_ref(),
                 &vesting_tree.campaign_id.to_le_bytes()],
        bump = vesting_tree.bump,
        has_one = creator @ VestingError::Unauthorized,
    )]
    pub vesting_tree: Account<'info, VestingTree>,
}

pub fn handler(ctx: Context<SetMilestoneReleased>, milestone_idx: u8) -> Result<()> {
    let tree = &mut ctx.accounts.vesting_tree;
    set_milestone_flag(&mut tree.milestone_released_flags, milestone_idx);

    emit!(MilestoneReleased {
        tree: tree.key(),
        milestone_idx,
        released_by: ctx.accounts.creator.key(),
    });

    Ok(())
}
