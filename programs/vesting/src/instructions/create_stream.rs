use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount, Transfer};

use crate::errors::VestingError;
use crate::events::{CampaignCreated, CampaignFunded};
use crate::math::merkle::leaf_hash;
use crate::state::{VestingLeaf, VestingTree, NATIVE_SOL_MINT};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct CreateStreamArgs {
    pub campaign_id: u64,
    pub beneficiary: Pubkey,
    pub amount: u64,
    pub release_type: u8,
    pub start_time: i64,
    pub cliff_time: i64,
    pub end_time: i64,
    pub milestone_idx: u8,
    pub cancellable: bool,
    pub cancel_authority: Option<Pubkey>,
    pub pause_authority: Option<Pubkey>,
}

#[derive(Accounts)]
#[instruction(args: CreateStreamArgs)]
pub struct CreateStream<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    /// Classic SPL Token mints only — Token-2022 mints are rejected to avoid
    /// silent transfer-fee deductions. The constraint verifies the mint account
    /// is owned by the classic Token program rather than Token-2022.
    #[account(
        constraint = *mint.to_account_info().owner == token_program.key() @ VestingError::UnsupportedMint,
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = creator,
        space = 8 + VestingTree::INIT_SPACE,
        seeds = [b"tree",
                 creator.key().as_ref(),
                 mint.key().as_ref(),
                 &args.campaign_id.to_le_bytes()],
        bump,
    )]
    pub vesting_tree: Account<'info, VestingTree>,

    /// CHECK: PDA — never deserialized, only used as vault token-account authority.
    #[account(seeds = [b"vault_authority", vesting_tree.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = vault_authority,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = source_ata.mint == mint.key() @ VestingError::MintMismatch,
        constraint = source_ata.owner == creator.key() @ VestingError::Unauthorized,
    )]
    pub source_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<CreateStream>, args: CreateStreamArgs) -> Result<()> {
    require!(args.amount > 0, VestingError::ZeroAmount);
    require!(
        args.start_time <= args.cliff_time && args.cliff_time <= args.end_time,
        VestingError::InvalidSchedule
    );
    require!(args.release_type <= 2, VestingError::InvalidScheduleType);
    if args.cancellable {
        require!(
            args.cancel_authority.is_some(),
            VestingError::MissingCancelAuthority
        );
    }

    let leaf = VestingLeaf {
        leaf_index: 0,
        beneficiary: args.beneficiary,
        amount: args.amount,
        release_type: args.release_type,
        start_time: args.start_time,
        cliff_time: args.cliff_time,
        end_time: args.end_time,
        milestone_idx: args.milestone_idx,
    };

    let merkle_root = leaf_hash(&leaf);

    let tree = &mut ctx.accounts.vesting_tree;
    tree.creator = ctx.accounts.creator.key();
    tree.mint = ctx.accounts.mint.key();
    tree.vault = ctx.accounts.vault.key();
    tree.vault_authority = ctx.accounts.vault_authority.key();
    tree.campaign_id = args.campaign_id;
    tree.merkle_root = merkle_root;
    tree.leaf_count = 1;
    tree.total_supply = args.amount;
    tree.total_claimed = 0;
    tree.cancellable = args.cancellable;
    tree.cancel_authority = args.cancel_authority;
    tree.cancelled_at = None;
    tree.paused = false;
    tree.pause_authority = args.pause_authority;
    tree.created_at = Clock::get()?.unix_timestamp;
    tree.milestone_released_flags = [0u8; 32];
    tree.min_cliff_time = 0;
    tree.instant_refunded = false;
    tree.bump = ctx.bumps.vesting_tree;

    emit!(CampaignCreated {
        tree: tree.key(),
        creator: tree.creator,
        mint: tree.mint,
        total_supply: args.amount,
        leaf_count: 1,
        cancellable: args.cancellable,
    });

    // Transfer tokens from creator to vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.source_ata.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.creator.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    anchor_spl::token::transfer(cpi_ctx, args.amount)?;

    let vault_balance_after = ctx.accounts.vault.amount;

    emit!(CampaignFunded {
        tree: tree.key(),
        amount: args.amount,
        vault_balance_after,
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// Native SOL path — no SPL token accounts, no mint, no vault ATA.
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(args: CreateStreamArgs)]
pub struct CreateStreamNative<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + VestingTree::INIT_SPACE,
        seeds = [
            b"tree",
            creator.key().as_ref(),
            NATIVE_SOL_MINT.as_ref(),
            &args.campaign_id.to_le_bytes(),
        ],
        bump,
    )]
    pub vesting_tree: Account<'info, VestingTree>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler_native(
    ctx: Context<CreateStreamNative>,
    args: CreateStreamArgs,
) -> Result<()> {
    // Same validation as the SPL handler
    require!(args.amount > 0, VestingError::ZeroAmount);
    require!(
        args.start_time <= args.cliff_time && args.cliff_time <= args.end_time,
        VestingError::InvalidSchedule
    );
    require!(args.release_type <= 2, VestingError::InvalidScheduleType);
    if args.cancellable {
        require!(
            args.cancel_authority.is_some(),
            VestingError::MissingCancelAuthority
        );
    }

    let leaf = VestingLeaf {
        leaf_index: 0,
        beneficiary: args.beneficiary,
        amount: args.amount,
        release_type: args.release_type,
        start_time: args.start_time,
        cliff_time: args.cliff_time,
        end_time: args.end_time,
        milestone_idx: args.milestone_idx,
    };

    let merkle_root = leaf_hash(&leaf);

    // Capture identifiers needed after we drop the mutable borrow.
    let tree_key;
    let creator_key = ctx.accounts.creator.key();

    {
        let tree = &mut ctx.accounts.vesting_tree;
        tree.creator = creator_key;
        tree.mint = NATIVE_SOL_MINT;
        tree.vault = Pubkey::default();
        tree.vault_authority = Pubkey::default();
        tree.campaign_id = args.campaign_id;
        tree.merkle_root = merkle_root;
        tree.leaf_count = 1;
        tree.total_supply = args.amount;
        tree.total_claimed = 0;
        tree.cancellable = args.cancellable;
        tree.cancel_authority = args.cancel_authority;
        tree.cancelled_at = None;
        tree.paused = false;
        tree.pause_authority = args.pause_authority;
        tree.created_at = Clock::get()?.unix_timestamp;
        tree.milestone_released_flags = [0u8; 32];
        tree.min_cliff_time = 0;
        tree.instant_refunded = false;
        tree.bump = ctx.bumps.vesting_tree;

        tree_key = tree.key();

        emit!(CampaignCreated {
            tree: tree_key,
            creator: tree.creator,
            mint: tree.mint,
            total_supply: args.amount,
            leaf_count: 1,
            cancellable: args.cancellable,
        });
    } // mutable borrow on `vesting_tree` dropped here

    // Transfer native SOL from creator to the vesting-tree PDA
    let cpi_accounts = anchor_lang::system_program::Transfer {
        from: ctx.accounts.creator.to_account_info(),
        to: ctx.accounts.vesting_tree.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.system_program.key(),
        cpi_accounts,
    );
    anchor_lang::system_program::transfer(cpi_ctx, args.amount)?;

    // After the transfer, the PDA's lamport balance reflects the funded amount.
    let vault_balance_after = ctx.accounts.vesting_tree.to_account_info().lamports();

    emit!(CampaignFunded {
        tree: tree_key,
        amount: args.amount,
        vault_balance_after,
    });

    Ok(())
}
