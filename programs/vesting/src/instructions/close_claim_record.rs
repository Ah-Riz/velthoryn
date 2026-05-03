use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CloseClaimRecord<'info> {
    #[account(mut)]
    pub beneficiary: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(_ctx: Context<CloseClaimRecord>, _expected_total: u64) -> Result<()> {
    Ok(())
}
