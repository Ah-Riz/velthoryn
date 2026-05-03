use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdateRoot<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    _ctx:            Context<UpdateRoot>,
    _new_root:       [u8; 32],
    _new_leaf_count: u32,
) -> Result<()> {
    Ok(())
}
