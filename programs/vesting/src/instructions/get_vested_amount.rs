use anchor_lang::prelude::*;

use crate::math::schedule;
use crate::state::VestingLeaf;

#[derive(Accounts)]
pub struct GetVestedAmount {}

pub fn handler(
    _ctx: Context<GetVestedAmount>,
    leaf: VestingLeaf,
    cancelled_at: Option<i64>,
    now: i64,
) -> Result<u64> {
    Ok(schedule::get_vested_amount(&leaf, cancelled_at, now))
}
