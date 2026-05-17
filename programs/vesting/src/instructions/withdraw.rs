use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount, Transfer};

use crate::errors::VestingError;
use crate::events::Claimed;
use crate::math::merkle::leaf_hash;
use crate::math::schedule;
use crate::state::{ClaimRecord, VestingLeaf, VestingTree};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct WithdrawArgs {
    pub release_type: u8,
    pub start_time: i64,
    pub cliff_time: i64,
    pub end_time: i64,
    pub milestone_idx: u8,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub beneficiary: Signer<'info>,

    #[account(
        mut,
        constraint = vesting_tree.leaf_count == 1 @ VestingError::NotSingleStream,
        seeds = [b"tree",
                 vesting_tree.creator.as_ref(),
                 vesting_tree.mint.as_ref(),
                 &vesting_tree.campaign_id.to_le_bytes()],
        bump = vesting_tree.bump,
    )]
    pub vesting_tree: Account<'info, VestingTree>,

    #[account(
        init_if_needed,
        payer = beneficiary,
        space = 8 + ClaimRecord::INIT_SPACE,
        seeds = [b"claim",
                 vesting_tree.key().as_ref(),
                 beneficiary.key().as_ref()],
        bump,
    )]
    pub claim_record: Account<'info, ClaimRecord>,

    /// CHECK: PDA — only used as signer for vault CPI.
    #[account(seeds = [b"vault_authority", vesting_tree.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(mut, address = vesting_tree.vault @ VestingError::WrongVault)]
    pub vault: Account<'info, TokenAccount>,

    #[account(address = vesting_tree.mint @ VestingError::MintMismatch)]
    pub mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = beneficiary,
        associated_token::mint = mint,
        associated_token::authority = beneficiary,
    )]
    pub beneficiary_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Withdraw>, args: WithdrawArgs) -> Result<()> {
    let tree = &ctx.accounts.vesting_tree;
    let tree_key = tree.key();

    require!(!tree.paused, VestingError::CampaignPaused);

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
        ctx.accounts.beneficiary.key() == leaf.beneficiary,
        VestingError::UnauthorizedClaimer
    );
    require!(
        leaf.start_time <= leaf.cliff_time && leaf.cliff_time <= leaf.end_time,
        VestingError::InvalidSchedule
    );
    require!(args.release_type <= 2, VestingError::InvalidScheduleType);

    let hash = leaf_hash(&leaf);
    require!(hash == tree.merkle_root, VestingError::InvalidProof);

    // First-touch init of ClaimRecord
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

    // Milestone guard
    if leaf.release_type == 2 {
        let byte_idx = leaf.milestone_idx as usize / 8;
        let bit_idx = leaf.milestone_idx as usize % 8;
        require!(
            cr.milestone_bitmap[byte_idx] & (1 << bit_idx) == 0,
            VestingError::MilestoneAlreadyClaimed
        );
    }

    let now = Clock::get()?.unix_timestamp;
    let effective_now = match tree.cancelled_at {
        Some(c) => now.min(c),
        None => now,
    };

    let claimable = if leaf.release_type == 2 {
        if effective_now >= leaf.cliff_time {
            leaf.amount
        } else {
            0
        }
    } else {
        schedule::vested(&leaf, effective_now).saturating_sub(cr.claimed_amount)
    };

    require!(claimable > 0, VestingError::NothingToClaim);
    require!(
        ctx.accounts.vault.amount >= claimable,
        VestingError::InsufficientVault
    );

    let new_total = tree
        .total_claimed
        .checked_add(claimable)
        .ok_or(VestingError::Overflow)?;
    require!(new_total <= tree.total_supply, VestingError::OverClaim);

    // State mutations BEFORE CPI (CEI pattern)
    cr.claimed_amount = cr
        .claimed_amount
        .checked_add(claimable)
        .ok_or(VestingError::Overflow)?;
    cr.last_claim_at = now;

    if leaf.release_type == 2 {
        let byte_idx = leaf.milestone_idx as usize / 8;
        let bit_idx = leaf.milestone_idx as usize % 8;
        cr.milestone_bitmap[byte_idx] |= 1 << bit_idx;
    }

    ctx.accounts.vesting_tree.total_claimed = new_total;

    // SPL token transfer CPI
    let bump = ctx.bumps.vault_authority;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"vault_authority",
        tree_key.as_ref(),
        &[bump],
    ]];

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
    anchor_spl::token::transfer(cpi_ctx, claimable)?;

    let milestone_idx = if leaf.release_type == 2 {
        Some(leaf.milestone_idx)
    } else {
        None
    };

    emit!(Claimed {
        tree: tree_key,
        beneficiary: ctx.accounts.beneficiary.key(),
        leaf_index: 0,
        amount: claimable,
        total_claimed_by_user: cr.claimed_amount,
        total_claimed_overall: new_total,
        milestone_idx,
    });

    Ok(())
}
