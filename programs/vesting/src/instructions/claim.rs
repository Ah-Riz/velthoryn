use anchor_lang::prelude::*;

use crate::state::VestingLeaf;

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub beneficiary: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    _ctx:   Context<Claim>,
    _leaf:  VestingLeaf,
    _proof: Vec<[u8; 32]>,
) -> Result<()> {
    Ok(())
}
