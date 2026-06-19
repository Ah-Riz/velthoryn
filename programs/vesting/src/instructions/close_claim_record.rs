use anchor_lang::prelude::*;

use crate::constants::GRACE_PERIOD_SECS;
use crate::errors::VestingError;
use crate::events::ClaimRecordClosed;
use crate::state::{migrate_legacy_claim_record, ClaimRecord};

#[derive(Accounts)]
pub struct CloseClaimRecord<'info> {
    #[account(mut)]
    pub beneficiary: Signer<'info>,

    pub vesting_tree: Account<'info, crate::state::VestingTree>,

    // `AccountLoader` does not auto-deref fields in `#[derive(Accounts)]` constraints,
    // so the beneficiary / tree ownership checks are re-established in the handler.
    #[account(
        mut,
        close = beneficiary,
        seeds = [b"claim", vesting_tree.key().as_ref(), beneficiary.key().as_ref()],
        bump,
    )]
    pub claim_record: AccountLoader<'info, ClaimRecord>,
}

pub fn handler(ctx: Context<CloseClaimRecord>) -> Result<()> {
    // Grow any legacy (pre-Issue-#29) ClaimRecord to the current size before load.
    migrate_legacy_claim_record(&ctx.accounts.claim_record, &ctx.accounts.beneficiary)?;

    let cr = ctx.accounts.claim_record.load()?;
    let tree = &ctx.accounts.vesting_tree;

    // Ownership checks (moved out of account constraints for AccountLoader).
    require_keys_eq!(
        cr.beneficiary,
        ctx.accounts.beneficiary.key(),
        VestingError::Unauthorized
    );
    require_keys_eq!(cr.tree, tree.key(), VestingError::WrongVault);

    // total_entitled must be set (claim/withdraw first-touch); blocks close after
    // withdraw-only records that never stored entitlement (double-withdraw via re-init).
    let fully_claimed = cr.total_entitled > 0 && cr.claimed_amount >= cr.total_entitled;
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
