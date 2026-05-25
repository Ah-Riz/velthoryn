use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Transfer};
use anchor_lang::system_program::System;

use crate::errors::VestingError;
use crate::events::StreamCancelled;
use crate::instructions::withdraw::WithdrawArgs;
use crate::math::{merkle::leaf_hash, schedule};
use crate::state::{milestone_flag_is_set, ClaimRecord, VestingLeaf, VestingTree};

/// Tutorial-style cancel: creator-only, single-recipient stream. Unlocked tokens go to the
/// beneficiary and the remaining vault balance goes to the creator in one transaction.
#[derive(Accounts)]
pub struct CancelStream<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    /// CHECK: matched against leaf hash via schedule args + merkle root.
    #[account(mut)]
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
    pub vault_authority: Option<UncheckedAccount<'info>>,

    #[account(mut, address = vesting_tree.vault @ VestingError::WrongVault)]
    pub vault: Option<Account<'info, TokenAccount>>,

    /// CHECK: beneficiary ATA — validated in handler.
    #[account(mut)]
    pub beneficiary_ata: Option<UncheckedAccount<'info>>,

    /// CHECK: creator ATA — validated in handler.
    #[account(mut)]
    pub creator_ata: Option<UncheckedAccount<'info>>,

    pub token_program: Option<Program<'info, Token>>,
}

pub fn handler(ctx: Context<CancelStream>, args: WithdrawArgs) -> Result<()> {
    let tree_key;
    let is_native;
    let cancelled_at = Clock::get()?.unix_timestamp;
    let to_beneficiary;
    let to_creator;
    let to_creator_actual;

    // --- Validation & state computation (mutable borrow of vesting_tree) ---
    {
        let tree = &mut ctx.accounts.vesting_tree;
        tree_key = tree.key();
        is_native = tree.is_native();

        require!(!tree.paused, VestingError::CampaignPaused);

        // SPL-only validations — skip for native SOL
        if !is_native {
            let vault_acc = ctx.accounts.vault.as_ref().ok_or(VestingError::WrongVault)?;

            let beneficiary_ata = token_account(
                ctx.accounts
                    .beneficiary_ata
                    .as_ref()
                    .ok_or(VestingError::MintMismatch)?
                    .to_account_info()
                    .as_ref(),
            )?;
            require_keys_eq!(
                beneficiary_ata.mint,
                vault_acc.mint,
                VestingError::MintMismatch
            );
            require_keys_eq!(
                beneficiary_ata.owner,
                ctx.accounts.beneficiary.key(),
                VestingError::UnauthorizedClaimer
            );

            let creator_ata = token_account(
                ctx.accounts
                    .creator_ata
                    .as_ref()
                    .ok_or(VestingError::MintMismatch)?
                    .to_account_info()
                    .as_ref(),
            )?;
            require_keys_eq!(
                creator_ata.mint,
                vault_acc.mint,
                VestingError::MintMismatch
            );
            require_keys_eq!(
                creator_ata.owner,
                ctx.accounts.creator.key(),
                VestingError::Unauthorized
            );
        }

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

        if leaf.release_type == 2 {
            let byte_idx = leaf.milestone_idx as usize / 8;
            let bit_idx = leaf.milestone_idx as usize % 8;
            require!(
                cr.milestone_bitmap[byte_idx] & (1 << bit_idx) == 0,
                VestingError::MilestoneAlreadyClaimed
            );
        }

        to_beneficiary = if leaf.release_type == 2 {
            if milestone_flag_is_set(&tree.milestone_released_flags, leaf.milestone_idx) {
                leaf.amount.saturating_sub(cr.claimed_amount)
            } else {
                0
            }
        } else {
            let vested_at_cancel = schedule::vested(&leaf, cancelled_at);
            vested_at_cancel.saturating_sub(cr.claimed_amount)
        };

        // Vault balance — token-agnostic
        let vault_before = if is_native {
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
        require!(vault_before >= to_beneficiary, VestingError::InsufficientVault);

        to_creator = vault_before.saturating_sub(to_beneficiary);
        require!(to_creator > 0 || to_beneficiary > 0, VestingError::NothingToClaim);

        // For native SOL, creator also receives the rent refund on cancel
        to_creator_actual = if is_native {
            tree.to_account_info().lamports().saturating_sub(to_beneficiary)
        } else {
            to_creator
        };

        // State mutations BEFORE transfers (CEI pattern)
        tree.cancelled_at = Some(cancelled_at);

        if to_beneficiary > 0 {
            cr.claimed_amount = cr
                .claimed_amount
                .checked_add(to_beneficiary)
                .ok_or(VestingError::Overflow)?;
            cr.last_claim_at = cancelled_at;

            tree.total_claimed = tree
                .total_claimed
                .checked_add(to_beneficiary)
                .ok_or(VestingError::Overflow)?;
            require!(
                tree.total_claimed <= tree.total_supply,
                VestingError::OverClaim
            );

            if leaf.release_type == 2 {
                let byte_idx = leaf.milestone_idx as usize / 8;
                let bit_idx = leaf.milestone_idx as usize % 8;
                cr.milestone_bitmap[byte_idx] |= 1 << bit_idx;
            }
        }
    } // mutable borrow on tree dropped here

    // Transfers
    if is_native {
        // Native SOL: direct lamport manipulation
        let pda_info = ctx.accounts.vesting_tree.to_account_info();
        let beneficiary_info = ctx.accounts.beneficiary.to_account_info();
        let creator_info = ctx.accounts.creator.to_account_info();

        // Total to drain from PDA: vested portion (to_beneficiary) + remaining (to_creator).
        // On cancel we drain everything including rent because the PDA no longer needs to
        // hold funds after cancellation.
        let total_drain = pda_info.lamports();

        // Debit PDA
        **pda_info.try_borrow_mut_lamports()? = pda_info
            .lamports()
            .checked_sub(total_drain)
            .ok_or(VestingError::Overflow)?;

        // Credit beneficiary (vested portion)
        if to_beneficiary > 0 {
            **beneficiary_info.try_borrow_mut_lamports()? = beneficiary_info
                .lamports()
                .checked_add(to_beneficiary)
                .ok_or(VestingError::Overflow)?;
        }

        // Credit creator (remaining unvested + rent-exempt minimum)
        let to_creator_total = total_drain.saturating_sub(to_beneficiary);
        if to_creator_total > 0 {
            **creator_info.try_borrow_mut_lamports()? = creator_info
                .lamports()
                .checked_add(to_creator_total)
                .ok_or(VestingError::Overflow)?;
        }
    } else {
        // SPL path: existing code unchanged
        let vault = ctx.accounts.vault.as_ref().ok_or(VestingError::WrongVault)?;
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

        if to_beneficiary > 0 {
            let beneficiary_ata = ctx
                .accounts
                .beneficiary_ata
                .as_ref()
                .ok_or(VestingError::MintMismatch)?;

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
            anchor_spl::token::transfer(cpi_ctx, to_beneficiary)?;
        }

        if to_creator > 0 {
            let creator_ata = ctx
                .accounts
                .creator_ata
                .as_ref()
                .ok_or(VestingError::MintMismatch)?;

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
            anchor_spl::token::transfer(cpi_ctx, to_creator)?;
        }
    }

    emit!(StreamCancelled {
        tree: tree_key,
        cancelled_at,
        amount_to_beneficiary: to_beneficiary,
        amount_to_creator: to_creator_actual,
    });

    Ok(())
}

fn token_account(acc: &AccountInfo) -> Result<TokenAccount> {
    let data = acc.try_borrow_data()?;
    TokenAccount::try_deserialize(&mut &data[..])
}
