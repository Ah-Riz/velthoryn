use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Transfer};

use crate::constants::GRACE_PERIOD_SECS;
use crate::errors::VestingError;
use crate::events::UnvestedWithdrawn;
use crate::state::VestingTree;

#[derive(Accounts)]
pub struct WithdrawUnvested<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"tree",
                 vesting_tree.creator.as_ref(),
                 vesting_tree.mint.as_ref(),
                 &vesting_tree.campaign_id.to_le_bytes()],
        bump = vesting_tree.bump,
        has_one = creator @ VestingError::Unauthorized,
        constraint = vesting_tree.cancelled_at.is_some() @ VestingError::NotCancelled,
    )]
    pub vesting_tree: Account<'info, VestingTree>,

    /// CHECK: PDA — only used as signer.
    #[account(seeds = [b"vault_authority", vesting_tree.key().as_ref()], bump)]
    pub vault_authority: Option<UncheckedAccount<'info>>,

    #[account(mut, address = vesting_tree.vault @ VestingError::WrongVault)]
    pub vault: Option<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = creator_ata.mint == vesting_tree.mint @ VestingError::MintMismatch,
        constraint = creator_ata.owner == creator.key() @ VestingError::Unauthorized,
    )]
    pub creator_ata: Option<Account<'info, TokenAccount>>,

    pub token_program: Option<Program<'info, Token>>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<WithdrawUnvested>) -> Result<()> {
    let cancelled = ctx
        .accounts
        .vesting_tree
        .cancelled_at
        .ok_or(VestingError::NotCancelled)?;
    let grace_end = cancelled.checked_add(GRACE_PERIOD_SECS).ok_or(VestingError::Overflow)?;
    require!(
        Clock::get()?.unix_timestamp >= grace_end,
        VestingError::GracePeriodActive
    );

    let tree = &ctx.accounts.vesting_tree;

    if tree.is_native() {
        // Native SOL: drain all remaining lamports from the PDA to the creator.
        // After grace period, the PDA no longer needs to hold any funds.
        let pda_info = ctx.accounts.vesting_tree.to_account_info();
        let creator_info = ctx.accounts.creator.to_account_info();
        let amount = pda_info.lamports();
        require!(amount > 0, VestingError::NothingToClaim);

        **pda_info.try_borrow_mut_lamports()? = pda_info
            .lamports()
            .checked_sub(amount)
            .ok_or(VestingError::Overflow)?;
        **creator_info.try_borrow_mut_lamports()? = creator_info
            .lamports()
            .checked_add(amount)
            .ok_or(VestingError::Overflow)?;

        emit!(UnvestedWithdrawn {
            tree: ctx.accounts.vesting_tree.key(),
            amount,
        });
    } else {
        // SPL path: existing code unchanged
        let vault = ctx.accounts.vault.as_ref().ok_or(VestingError::WrongVault)?;
        let creator_ata = ctx
            .accounts
            .creator_ata
            .as_ref()
            .ok_or(VestingError::MintMismatch)?;
        let vault_authority = ctx
            .accounts
            .vault_authority
            .as_ref()
            .ok_or(VestingError::WrongVault)?;
        let token_program = ctx
            .accounts
            .token_program
            .as_ref()
            .ok_or(VestingError::MintMismatch)?;

        let amount = vault.amount;
        require!(amount > 0, VestingError::NothingToClaim);

        let tree_key = ctx.accounts.vesting_tree.key();
        let bump = ctx.bumps.vault_authority.expect("bump must exist when vault_authority is Some");
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"vault_authority",
            tree_key.as_ref(),
            &[bump],
        ]];

        let cpi_accounts = Transfer {
            from: vault.to_account_info(),
            to: creator_ata.to_account_info(),
            authority: vault_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            token_program.key(),
            cpi_accounts,
            signer_seeds,
        );
        anchor_spl::token::transfer(cpi_ctx, amount)?;

        emit!(UnvestedWithdrawn {
            tree: ctx.accounts.vesting_tree.key(),
            amount,
        });
    }

    Ok(())
}
