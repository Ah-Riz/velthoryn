use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::errors::VestingError;
use crate::events::CampaignCreated;
use crate::state::{VestingTree, NATIVE_SOL_MINT};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct CreateCampaignArgs {
    pub campaign_id: u64,
    pub merkle_root: [u8; 32],
    pub leaf_count: u32,
    pub total_supply: u64,
    pub min_cliff_time: i64,
    pub cancellable: bool,
    pub cancel_authority: Option<Pubkey>,
    pub pause_authority: Option<Pubkey>,
}

#[derive(Accounts)]
#[instruction(args: CreateCampaignArgs)]
pub struct CreateCampaign<'info> {
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

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<CreateCampaign>, args: CreateCampaignArgs) -> Result<()> {
    require!(args.merkle_root != [0u8; 32], VestingError::EmptyRoot);
    require!(args.leaf_count > 0, VestingError::EmptyCampaign);
    require!(args.total_supply > 0, VestingError::ZeroAmount);
    require!(args.min_cliff_time != 0, VestingError::InvalidSchedule);
    if args.cancellable {
        require!(
            args.cancel_authority.is_some(),
            VestingError::MissingCancelAuthority
        );
    }

    let tree = &mut ctx.accounts.vesting_tree;
    tree.creator = ctx.accounts.creator.key();
    tree.mint = ctx.accounts.mint.key();
    tree.vault = ctx.accounts.vault.key();
    tree.vault_authority = ctx.accounts.vault_authority.key();
    tree.campaign_id = args.campaign_id;
    tree.merkle_root = args.merkle_root;
    tree.leaf_count = args.leaf_count;
    tree.total_supply = args.total_supply;
    tree.total_claimed = 0;
    tree.cancellable = args.cancellable;
    tree.cancel_authority = args.cancel_authority;
    tree.cancelled_at = None;
    tree.paused = false;
    tree.pause_authority = args.pause_authority;
    tree.created_at = Clock::get()?.unix_timestamp;
    tree.milestone_released_flags = [0u8; 32];
    tree.min_cliff_time = args.min_cliff_time;
    tree.instant_refunded = false;
    tree.bump = ctx.bumps.vesting_tree;

    emit!(CampaignCreated {
        tree: tree.key(),
        creator: tree.creator,
        mint: tree.mint,
        total_supply: args.total_supply,
        leaf_count: args.leaf_count,
        cancellable: args.cancellable,
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// Native SOL path — no SPL token accounts, no mint, no vault ATA.
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(args: CreateCampaignArgs)]
pub struct CreateCampaignNative<'info> {
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
    ctx: Context<CreateCampaignNative>,
    args: CreateCampaignArgs,
) -> Result<()> {
    require!(args.merkle_root != [0u8; 32], VestingError::EmptyRoot);
    require!(args.leaf_count > 0, VestingError::EmptyCampaign);
    require!(args.total_supply > 0, VestingError::ZeroAmount);
    require!(args.min_cliff_time != 0, VestingError::InvalidSchedule);
    if args.cancellable {
        require!(
            args.cancel_authority.is_some(),
            VestingError::MissingCancelAuthority
        );
    }

    let tree = &mut ctx.accounts.vesting_tree;
    tree.creator = ctx.accounts.creator.key();
    tree.mint = NATIVE_SOL_MINT;
    tree.vault = Pubkey::default();
    tree.vault_authority = Pubkey::default();
    tree.campaign_id = args.campaign_id;
    tree.merkle_root = args.merkle_root;
    tree.leaf_count = args.leaf_count;
    tree.total_supply = args.total_supply;
    tree.total_claimed = 0;
    tree.cancellable = args.cancellable;
    tree.cancel_authority = args.cancel_authority;
    tree.cancelled_at = None;
    tree.paused = false;
    tree.pause_authority = args.pause_authority;
    tree.created_at = Clock::get()?.unix_timestamp;
    tree.milestone_released_flags = [0u8; 32];
    tree.min_cliff_time = args.min_cliff_time;
    tree.instant_refunded = false;
    tree.bump = ctx.bumps.vesting_tree;

    emit!(CampaignCreated {
        tree: tree.key(),
        creator: tree.creator,
        mint: tree.mint,
        total_supply: args.total_supply,
        leaf_count: args.leaf_count,
        cancellable: args.cancellable,
    });

    Ok(())
}
