use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Transfer};

use crate::errors::VestingError;
use crate::events::InstantRefunded;

#[derive(Accounts)]
pub struct InstantRefundCampaign<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"tree",
                 vesting_tree.creator.as_ref(),
                 vesting_tree.mint.as_ref(),
                 &vesting_tree.campaign_id.to_le_bytes()],
        bump = vesting_tree.bump,
        constraint = vesting_tree.cancellable @ VestingError::NotCancellable,
        constraint = vesting_tree.cancelled_at.is_none() @ VestingError::AlreadyCancelled,
        constraint = vesting_tree.creator == creator.key() @ VestingError::Unauthorized,
        constraint = vesting_tree.total_claimed < vesting_tree.total_supply @ VestingError::FullyVested,
    )]
    pub vesting_tree: Account<'info, crate::state::VestingTree>,

    /// CHECK: PDA — only used as signer for SPL vault CPI.
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

pub fn handler(ctx: Context<InstantRefundCampaign>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    let tree_key;
    let is_native;
    let refund_amount;

    // ---- Validate & mutate state (CEI) ----
    {
        let tree = &mut ctx.accounts.vesting_tree;
        tree_key = tree.key();
        is_native = tree.is_native();

        require!(tree.leaf_count > 1, VestingError::NotMultiLeafCampaign);
        require!(
            now < tree.min_cliff_time,
            VestingError::CampaignAlreadyStarted
        );
        require!(
            tree.milestone_released_flags == [0u8; 32],
            VestingError::MilestoneAlreadyReleased
        );

        refund_amount = if is_native {
            // Refund only funded lamports, keep rent-exempt reserve so the PDA stays alive.
            let pda_info = tree.to_account_info();
            let rent_min = Rent::get()?.minimum_balance(pda_info.data_len());
            pda_info.lamports().saturating_sub(rent_min)
        } else {
            ctx.accounts
                .vault
                .as_ref()
                .ok_or(VestingError::WrongVault)?
                .amount
        };
        require!(refund_amount > 0, VestingError::NothingToClaim);

        tree.cancelled_at = Some(now);
        tree.paused = false;
        tree.instant_refunded = true;
    } // drop mutable borrow before transfers

    // ---- Transfer ----
    if is_native {
        let pda_info = ctx.accounts.vesting_tree.to_account_info();
        let creator_info = ctx.accounts.creator.to_account_info();

        **pda_info.try_borrow_mut_lamports()? = pda_info
            .lamports()
            .checked_sub(refund_amount)
            .ok_or(VestingError::Overflow)?;
        **creator_info.try_borrow_mut_lamports()? = creator_info
            .lamports()
            .checked_add(refund_amount)
            .ok_or(VestingError::Overflow)?;
    } else {
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

        let bump = ctx
            .bumps
            .vault_authority
            .expect("bump must exist when vault_authority is Some");
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault_authority", tree_key.as_ref(), &[bump]]];

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
        anchor_spl::token::transfer(cpi_ctx, refund_amount)?;
    }

    msg!(
        "instant_refund_campaign: tree={} amount={} native={}",
        tree_key,
        refund_amount,
        is_native
    );

    emit!(InstantRefunded {
        tree: tree_key,
        cancelled_at: now,
        refunded_to: ctx.accounts.creator.key(),
        amount: refund_amount,
    });

    Ok(())
}

