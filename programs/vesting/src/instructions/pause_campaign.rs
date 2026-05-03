use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct PauseCampaign<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn pause_handler(_ctx: Context<PauseCampaign>) -> Result<()> {
    Ok(())
}

pub fn unpause_handler(_ctx: Context<PauseCampaign>) -> Result<()> {
    Ok(())
}
