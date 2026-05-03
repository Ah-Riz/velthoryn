use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct FundCampaign<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(_ctx: Context<FundCampaign>, _amount: u64) -> Result<()> {
    Ok(())
}
