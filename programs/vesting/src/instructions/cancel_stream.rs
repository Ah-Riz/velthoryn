use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Transfer};
use anchor_lang::system_program::System;

use crate::errors::VestingError;
use crate::events::StreamCancelled;
use crate::instructions::withdraw::WithdrawArgs;
use crate::math::{merkle::leaf_hash, schedule};
use crate::state::{ClaimRecord, VestingLeaf, VestingTree};

/// Tutorial-style cancel: creator-only, single-recipient stream. Unlocked tokens go to the
/// beneficiary and the remaining vault balance goes to the creator in one transaction.
#[derive(Accounts)]
pub struct CancelStream<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    /// CHECK: matched against leaf hash via schedule args + merkle root.
    pub beneficiary: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = vesting_tree.leaf_count == 1 @ VestingError::NotSingleStream,
        seeds = [b"tree",
                 vesting_tree.creator.as_ref(),
                 vesting_tree.mint.as_ref(),
                 &vesting_tree.campaign_id.to_le_bytes()],
        bump = vesting_tree.bump,
        has_one = creator @ VestingError::Unauthorized,
        constraint = vesting_tree.cancellable @ VestingError::NotCancellable,
        constraint = vesting_tree.cancelled_at.is_none() @ VestingError::AlreadyCancelled,
        constraint = vesting_tree.total_claimed < vesting_tree.total_supply @ VestingError::FullyVested,
    )]
    pub vesting_tree: Account<'info, VestingTree>,

    #[account(
        init_if_needed,
        payer = creator,
        space = 8 + ClaimRecord::INIT_SPACE,
        seeds = [b"claim",
                 vesting_tree.key().as_ref(),
                 beneficiary.key().as_ref()],
        bump,
    )]
    pub claim_record: Account<'info, ClaimRecord>,

    pub system_program: Program<'info, System>,

    /// CHECK: PDA signer for vault CPI.
    #[account(seeds = [b"vault_authority", vesting_tree.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(mut, address = vesting_tree.vault @ VestingError::WrongVault)]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: beneficiary ATA — validated in handler.
    #[account(mut)]
    pub beneficiary_ata: UncheckedAccount<'info>,

    /// CHECK: creator ATA — validated in handler.
    #[account(mut)]
    pub creator_ata: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<CancelStream>, args: WithdrawArgs) -> Result<()> {
    let tree = &mut ctx.accounts.vesting_tree;
    let tree_key = tree.key();
    let cancelled_at = Clock::get()?.unix_timestamp;

    let vault_acc = &ctx.accounts.vault;
    let beneficiary_ata = token_account(&ctx.accounts.beneficiary_ata)?;
    require_keys_eq!(beneficiary_ata.mint, vault_acc.mint, VestingError::MintMismatch);
    require_keys_eq!(
        beneficiary_ata.owner,
        ctx.accounts.beneficiary.key(),
        VestingError::UnauthorizedClaimer
    );

    let creator_ata = token_account(&ctx.accounts.creator_ata)?;
    require_keys_eq!(creator_ata.mint, vault_acc.mint, VestingError::MintMismatch);
    require_keys_eq!(
        creator_ata.owner,
        ctx.accounts.creator.key(),
        VestingError::Unauthorized
    );

    let leaf = VestingLeaf {
        leaf_index: 0,
        beneficiary: ctx.accounts.beneficiary.key(),
        amount: tree.total_supply,
        release_type: args.release_type,
        start_time: args.start_time,
        cliff_time: args.cliff_time,
        end_time: args.end_time,
        milestone_idx: args.milestone_idx,
    };

    require!(
        leaf.start_time <= leaf.cliff_time && leaf.cliff_time <= leaf.end_time,
        VestingError::InvalidSchedule
    );
    require!(args.release_type <= 2, VestingError::InvalidScheduleType);
    require!(
        leaf_hash(&leaf) == tree.merkle_root,
        VestingError::InvalidProof
    );

    let cr = &mut ctx.accounts.claim_record;
    if cr.beneficiary == Pubkey::default() {
        cr.tree = tree_key;
        cr.beneficiary = ctx.accounts.beneficiary.key();
        cr.claimed_amount = 0;
        cr.total_entitled = leaf.amount;
        cr.milestone_bitmap = [0u8; 32];
        cr.last_claim_at = 0;
        cr.bump = ctx.bumps.claim_record;
    }

    let vested_at_cancel = schedule::vested(&leaf, cancelled_at);
    let to_beneficiary = vested_at_cancel.saturating_sub(cr.claimed_amount);

    let vault_before = vault_acc.amount;
    require!(vault_before >= to_beneficiary, VestingError::InsufficientVault);

    let to_creator = vault_before.saturating_sub(to_beneficiary);
    require!(to_creator > 0 || to_beneficiary > 0, VestingError::NothingToClaim);

    tree.cancelled_at = Some(cancelled_at);

    let bump = ctx.bumps.vault_authority;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"vault_authority",
        tree_key.as_ref(),
        &[bump],
    ]];

    if to_beneficiary > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.beneficiary_ata.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi_accounts,
            signer_seeds,
        );
        anchor_spl::token::transfer(cpi_ctx, to_beneficiary)?;

        cr.claimed_amount = cr
            .claimed_amount
            .checked_add(to_beneficiary)
            .ok_or(VestingError::Overflow)?;
        cr.last_claim_at = cancelled_at;

        tree.total_claimed = tree
            .total_claimed
            .checked_add(to_beneficiary)
            .ok_or(VestingError::Overflow)?;
    }

    if to_creator > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.creator_ata.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi_accounts,
            signer_seeds,
        );
        anchor_spl::token::transfer(cpi_ctx, to_creator)?;
    }

    emit!(StreamCancelled {
        tree: tree_key,
        cancelled_at,
        amount_to_beneficiary: to_beneficiary,
        amount_to_creator: to_creator,
    });

    Ok(())
}

fn token_account(acc: &AccountInfo) -> Result<TokenAccount> {
    let data = acc.try_borrow_data()?;
    TokenAccount::try_deserialize(&mut &data[..])
}
