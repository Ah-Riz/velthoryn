use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount, Transfer};

use crate::errors::VestingError;
use crate::events::Claimed;
use crate::math::merkle::leaf_hash;
use crate::math::schedule;
use crate::state::{milestone_flag_is_set, ClaimRecord, VestingLeaf, VestingTree};

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
    pub vault_authority: Option<UncheckedAccount<'info>>,

    #[account(mut, address = vesting_tree.vault @ VestingError::WrongVault)]
    pub vault: Option<Account<'info, TokenAccount>>,

    #[account(address = vesting_tree.mint @ VestingError::MintMismatch)]
    pub mint: Option<Account<'info, Mint>>,

    #[account(
        init_if_needed,
        payer = beneficiary,
        associated_token::mint = mint,
        associated_token::authority = beneficiary,
    )]
    pub beneficiary_ata: Option<Account<'info, TokenAccount>>,

    pub token_program: Option<Program<'info, Token>>,
    pub associated_token_program: Option<Program<'info, AssociatedToken>>,
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
        require!(
            milestone_flag_is_set(&tree.milestone_released_flags, leaf.milestone_idx),
            VestingError::MilestoneNotReleased
        );
        leaf.amount
    } else {
        schedule::vested(&leaf, effective_now).saturating_sub(cr.claimed_amount)
    };

    if claimable == 0 && leaf.release_type != 2 {
        let fully_claimed = cr.claimed_amount >= leaf.amount;
        if effective_now >= leaf.end_time || fully_claimed {
            return Err(VestingError::StreamExpired.into());
        }
    }

    require!(claimable > 0, VestingError::NothingToClaim);

    // Vault balance check — token-agnostic (SPL vs native)
    let is_native = tree.is_native();
    let total_supply = tree.total_supply;

    let vault_balance = if is_native {
        let pda_info = ctx.accounts.vesting_tree.to_account_info();
        let rent_min = Rent::get()?.minimum_balance(pda_info.data_len());
        pda_info.lamports().saturating_sub(rent_min)
    } else {
        let vault = ctx.accounts.vault.as_ref().ok_or(VestingError::WrongVault)?;
        vault.amount
    };
    require!(vault_balance >= claimable, VestingError::InsufficientVault);

    let new_total = tree
        .total_claimed
        .checked_add(claimable)
        .ok_or(VestingError::Overflow)?;
    require!(new_total <= tree.total_supply, VestingError::OverClaim);

    // State mutations BEFORE transfer (CEI pattern)
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

    // Transfer
    if is_native {
        // Native SOL: direct lamport debit from PDA to beneficiary
        let pda_info = ctx.accounts.vesting_tree.to_account_info();
        let beneficiary_info = ctx.accounts.beneficiary.to_account_info();
        let rent_min = Rent::get()?.minimum_balance(pda_info.data_len());

        // On final claim, drain all lamports (including rent) since the PDA
        // will no longer hold any balance.
        let is_final = new_total == total_supply;
        let transfer_amount = if is_final {
            pda_info.lamports()
        } else {
            claimable
        };

        // Ensure we don't drop below rent-exempt minimum unless this is the final drain
        if !is_final {
            require!(
                pda_info.lamports().saturating_sub(transfer_amount) >= rent_min,
                VestingError::NativeSolRentViolation
            );
        }

        **pda_info.try_borrow_mut_lamports()? = pda_info
            .lamports()
            .checked_sub(transfer_amount)
            .ok_or(VestingError::Overflow)?;
        **beneficiary_info.try_borrow_mut_lamports()? = beneficiary_info
            .lamports()
            .checked_add(transfer_amount)
            .ok_or(VestingError::Overflow)?;
    } else {
        // SPL token transfer CPI
        let vault = ctx.accounts.vault.as_ref().ok_or(VestingError::WrongVault)?;
        let beneficiary_ata = ctx
            .accounts
            .beneficiary_ata
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

        let bump = ctx.bumps.vault_authority.expect("bump must exist when vault_authority is Some");
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"vault_authority",
            tree_key.as_ref(),
            &[bump],
        ]];

        let cpi_accounts = Transfer {
            from: vault.to_account_info(),
            to: beneficiary_ata.to_account_info(),
            authority: vault_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            token_program.key(),
            cpi_accounts,
            signer_seeds,
        );
        anchor_spl::token::transfer(cpi_ctx, claimable)?;
    }

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
