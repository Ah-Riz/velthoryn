use anchor_lang::prelude::*;

use crate::constants::GRACE_PERIOD_SECS;
use crate::errors::VestingError;
use crate::events::ClaimRecordClosed;

#[derive(Accounts)]
pub struct CloseClaimRecord<'info> {
    #[account(mut)]
    pub beneficiary: Signer<'info>,

    pub vesting_tree: Account<'info, crate::state::VestingTree>,

    #[account(
        mut,
        close = beneficiary,
        has_one = beneficiary @ VestingError::Unauthorized,
        constraint = claim_record.tree == vesting_tree.key() @ VestingError::WrongVault,
        seeds = [b"claim", vesting_tree.key().as_ref(), beneficiary.key().as_ref()],
        bump = claim_record.bump,
    )]
    pub claim_record: Account<'info, crate::state::ClaimRecord>,
}

pub fn handler(ctx: Context<CloseClaimRecord>) -> Result<()> {
    let cr = &ctx.accounts.claim_record;
    let tree = &ctx.accounts.vesting_tree;

    // total_entitled must be set (claim/withdraw first-touch); blocks close after
    // withdraw-only records that never stored entitlement (double-withdraw via re-init).
    let fully_claimed =
        cr.total_entitled > 0 && cr.claimed_amount >= cr.total_entitled;
    let post_grace = match tree.cancelled_at {
        Some(c) => {
            let grace_end = c.checked_add(GRACE_PERIOD_SECS).ok_or(VestingError::Overflow)?;
            Clock::get()?.unix_timestamp >= grace_end
        }
        None => false,
    };
    require!(fully_claimed || post_grace, VestingError::CannotClose);

    emit!(ClaimRecordClosed {
        tree: tree.key(),
        beneficiary: ctx.accounts.beneficiary.key(),
    });

    Ok(())
}
