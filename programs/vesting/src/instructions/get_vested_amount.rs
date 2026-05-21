use anchor_lang::prelude::*;

use crate::math::schedule;
use crate::state::{milestone_flag_is_set, VestingLeaf};

#[derive(Accounts)]
pub struct GetVestedAmount {}

pub fn handler(
    _ctx: Context<GetVestedAmount>,
    leaf: VestingLeaf,
    cancelled_at: Option<i64>,
    now: i64,
    milestone_released_flags: Option<[u8; 32]>,
) -> Result<u64> {
    if leaf.release_type == 2 {
        // Milestone vesting is gated by the release flag, not time.
        // cancelled_at is irrelevant: a released milestone is fully vested.
        let flags = milestone_released_flags.unwrap_or([0u8; 32]);
        if !milestone_flag_is_set(&flags, leaf.milestone_idx) {
            return Ok(0);
        }
        return Ok(leaf.amount);
    }
    Ok(schedule::get_vested_amount(&leaf, cancelled_at, now))
}
