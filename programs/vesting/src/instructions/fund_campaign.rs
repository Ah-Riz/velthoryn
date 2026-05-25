use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Transfer};

use crate::errors::VestingError;
use crate::events::CampaignFunded;

#[derive(Accounts)]
pub struct FundCampaign<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        has_one = creator @ VestingError::Unauthorized,
        has_one = vault @ VestingError::WrongVault,
        seeds = [b"tree",
                 creator.key().as_ref(),
                 vesting_tree.mint.as_ref(),
                 &vesting_tree.campaign_id.to_le_bytes()],
        bump = vesting_tree.bump,
    )]
    pub vesting_tree: Account<'info, crate::state::VestingTree>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = source_ata.mint == vesting_tree.mint @ VestingError::MintMismatch,
        constraint = source_ata.owner == creator.key() @ VestingError::Unauthorized,
    )]
    pub source_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<FundCampaign>, amount: u64) -> Result<()> {
    require!(amount > 0, VestingError::ZeroAmount);
    require!(
        ctx.accounts.vesting_tree.cancelled_at.is_none(),
        VestingError::CampaignCancelled
    );

    let new_balance = ctx
        .accounts
        .vault
        .amount
        .checked_add(amount)
        .ok_or(VestingError::Overflow)?;
    require!(
        new_balance <= ctx.accounts.vesting_tree.total_supply,
        VestingError::OverFunded
    );

    let cpi_accounts = Transfer {
        from: ctx.accounts.source_ata.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.creator.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    anchor_spl::token::transfer(cpi_ctx, amount)?;

    let vault_balance_after = new_balance;

    emit!(CampaignFunded {
        tree: ctx.accounts.vesting_tree.key(),
        amount,
        vault_balance_after,
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// Native SOL path — transfers lamports from creator to the vesting-tree PDA.
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct FundCampaignNative<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        has_one = creator @ VestingError::Unauthorized,
        seeds = [
            b"tree",
            creator.key().as_ref(),
            vesting_tree.mint.as_ref(),
            &vesting_tree.campaign_id.to_le_bytes(),
        ],
        bump = vesting_tree.bump,
    )]
    pub vesting_tree: Account<'info, crate::state::VestingTree>,

    pub system_program: Program<'info, System>,
}

pub fn handler_native(ctx: Context<FundCampaignNative>, amount: u64) -> Result<()> {
    require!(amount > 0, VestingError::ZeroAmount);
    require!(
        ctx.accounts.vesting_tree.cancelled_at.is_none(),
        VestingError::CampaignCancelled
    );

    // For native SOL, compute funded amount from PDA lamports minus rent.
    let pda_info = ctx.accounts.vesting_tree.to_account_info();
    let rent_min = Rent::get()?.minimum_balance(pda_info.data_len());
    let currently_funded = pda_info.lamports().saturating_sub(rent_min);
    let new_balance = currently_funded
        .checked_add(amount)
        .ok_or(VestingError::Overflow)?;
    require!(
        new_balance <= ctx.accounts.vesting_tree.total_supply,
        VestingError::OverFunded
    );

    // Transfer SOL from creator to PDA via system_program::transfer
    let cpi_accounts = anchor_lang::system_program::Transfer {
        from: ctx.accounts.creator.to_account_info(),
        to: ctx.accounts.vesting_tree.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.system_program.key(), cpi_accounts);
    anchor_lang::system_program::transfer(cpi_ctx, amount)?;

    emit!(CampaignFunded {
        tree: ctx.accounts.vesting_tree.key(),
        amount,
        vault_balance_after: ctx.accounts.vesting_tree.to_account_info().lamports(),
    });

    Ok(())
}
