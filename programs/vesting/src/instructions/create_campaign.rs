use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct CreateCampaignArgs {
    pub campaign_id:      u64,
    pub merkle_root:      [u8; 32],
    pub leaf_count:       u32,
    pub total_supply:     u64,
    pub cancellable:      bool,
    pub cancel_authority: Option<Pubkey>,
    pub pause_authority:  Option<Pubkey>,
}

#[derive(Accounts)]
pub struct CreateCampaign<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(_ctx: Context<CreateCampaign>, _args: CreateCampaignArgs) -> Result<()> {
    Ok(())
}
