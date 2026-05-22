#![allow(unexpected_cfgs)]
#![allow(clippy::diverging_sub_expression)]

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;
use state::VestingLeaf;

declare_id!("G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu");

#[program]
pub mod vesting {
    use super::*;

    pub fn create_campaign(
        ctx: Context<CreateCampaign>,
        args: CreateCampaignArgs,
    ) -> Result<()> {
        instructions::create_campaign::handler(ctx, args)
    }

    pub fn create_stream(ctx: Context<CreateStream>, args: CreateStreamArgs) -> Result<()> {
        instructions::create_stream::handler(ctx, args)
    }

    pub fn fund_campaign(ctx: Context<FundCampaign>, amount: u64) -> Result<()> {
        instructions::fund_campaign::handler(ctx, amount)
    }

    pub fn claim(
        ctx: Context<Claim>,
        leaf: VestingLeaf,
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        instructions::claim::handler(ctx, leaf, proof)
    }

    pub fn cancel_campaign(ctx: Context<CancelCampaign>) -> Result<()> {
        instructions::cancel_campaign::handler(ctx)
    }

    pub fn cancel_stream(ctx: Context<CancelStream>, args: WithdrawArgs) -> Result<()> {
        instructions::cancel_stream::handler(ctx, args)
    }

    pub fn set_milestone_released(
        ctx: Context<SetMilestoneReleased>,
        milestone_idx: u8,
    ) -> Result<()> {
        instructions::set_milestone_released::handler(ctx, milestone_idx)
    }

    pub fn update_root(
        ctx: Context<UpdateRoot>,
        new_root: [u8; 32],
        new_leaf_count: u32,
    ) -> Result<()> {
        instructions::update_root::handler(ctx, new_root, new_leaf_count)
    }

    pub fn withdraw(ctx: Context<Withdraw>, args: WithdrawArgs) -> Result<()> {
        instructions::withdraw::handler(ctx, args)
    }

    pub fn withdraw_unvested(ctx: Context<WithdrawUnvested>) -> Result<()> {
        instructions::withdraw_unvested::handler(ctx)
    }

    pub fn pause_campaign(ctx: Context<PauseCampaign>) -> Result<()> {
        instructions::pause_campaign::pause_handler(ctx)
    }

    pub fn unpause_campaign(ctx: Context<PauseCampaign>) -> Result<()> {
        instructions::pause_campaign::unpause_handler(ctx)
    }

    pub fn close_claim_record(
        ctx: Context<CloseClaimRecord>,
    ) -> Result<()> {
        instructions::close_claim_record::handler(ctx)
    }

    pub fn get_vested_amount(
        ctx: Context<GetVestedAmount>,
        leaf: VestingLeaf,
        cancelled_at: Option<i64>,
        now: i64,
        milestone_released_flags: Option<[u8; 32]>,
    ) -> Result<u64> {
        instructions::get_vested_amount::handler(ctx, leaf, cancelled_at, now, milestone_released_flags)
    }
}
