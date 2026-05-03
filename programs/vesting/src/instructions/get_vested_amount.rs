use anchor_lang::prelude::*;

use crate::state::VestingLeaf;

#[derive(Accounts)]
pub struct GetVestedAmount<'info> {
    pub viewer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    _ctx:          Context<GetVestedAmount>,
    _leaf:         VestingLeaf,
    _cancelled_at: Option<i64>,
    _now:          i64,
) -> Result<u64> {
    Ok(0)
}
