use fuzz_accounts::*;
use trident_fuzz::fuzzing::*;
mod fuzz_accounts;
mod types;
use types::{
    CreateCampaignArgs, CreateStreamArgs, VestingLeaf, VestingTree, WithdrawArgs,
    vesting::{
        CloseClaimRecordInstruction, CloseClaimRecordInstructionAccounts,
        CloseClaimRecordInstructionData, CreateCampaignInstruction,
        CreateCampaignInstructionAccounts, CreateCampaignInstructionData, CreateStreamInstruction,
        CreateStreamInstructionAccounts, CreateStreamInstructionData, FundCampaignInstruction,
        FundCampaignInstructionAccounts, FundCampaignInstructionData, GetVestedAmountInstruction,
        GetVestedAmountInstructionData, WithdrawInstruction, WithdrawInstructionAccounts,
        WithdrawInstructionData, program_id,
    },
};

const SPL_TOKEN_PROGRAM_ID: Pubkey =
    pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

const TOKEN_DECIMALS: u8 = 6;
const STREAM_AMOUNT: u64 = 1_000_000;
const MINTED_TO_CREATOR: u64 = 10_000_000;

/// Schedule used for stream create + withdraw (must match leaf hash binding).
#[derive(Clone, Copy)]
struct StreamSchedule {
    release_type: u8,
    start_time: i64,
    cliff_time: i64,
    end_time: i64,
    milestone_idx: u8,
}

impl StreamSchedule {
    fn linear() -> Self {
        Self {
            release_type: 0,
            start_time: 0,
            cliff_time: 0,
            end_time: 10_000,
            milestone_idx: 0,
        }
    }

    fn to_withdraw_args(self) -> WithdrawArgs {
        WithdrawArgs::new(
            self.release_type,
            self.start_time,
            self.cliff_time,
            self.end_time,
            self.milestone_idx,
        )
    }
}

#[derive(Clone)]
struct StreamContext {
    campaign_id: u64,
    vesting_tree: Pubkey,
    vault: Pubkey,
    schedule: StreamSchedule,
}

#[derive(FuzzTestMethods)]
struct FuzzTest {
    trident: Trident,
    fuzz_accounts: AccountAddresses,
    creator: Pubkey,
    mint: Pubkey,
    creator_ata: Pubkey,
    beneficiary: Pubkey,
    stream: Option<StreamContext>,
}

fn tree_pda(trident: &Trident, creator: &Pubkey, mint: &Pubkey, campaign_id: u64) -> (Pubkey, u8) {
    let campaign_id_bytes = campaign_id.to_le_bytes();
    let seeds: &[&[u8]] = &[
        b"tree",
        creator.as_ref(),
        mint.as_ref(),
        &campaign_id_bytes,
    ];
    trident.find_program_address(seeds, &program_id())
}

fn vault_authority_pda(trident: &Trident, tree: &Pubkey) -> (Pubkey, u8) {
    let seeds: &[&[u8]] = &[b"vault_authority", tree.as_ref()];
    trident.find_program_address(seeds, &program_id())
}

fn claim_record_pda(trident: &Trident, tree: &Pubkey, beneficiary: &Pubkey) -> (Pubkey, u8) {
    let seeds: &[&[u8]] = &[b"claim", tree.as_ref(), beneficiary.as_ref()];
    trident.find_program_address(seeds, &program_id())
}

#[flow_executor]
impl FuzzTest {
    fn new() -> Self {
        Self {
            trident: Trident::default(),
            fuzz_accounts: AccountAddresses::default(),
            creator: Pubkey::default(),
            mint: Pubkey::default(),
            creator_ata: Pubkey::default(),
            beneficiary: Pubkey::default(),
            stream: None,
        }
    }

    #[init]
    fn start(&mut self) {
        self.stream = None;
        self.fuzz_accounts = AccountAddresses::default();

        self.creator = self.trident.payer().pubkey();
        self.beneficiary = self
            .fuzz_accounts
            .beneficiary
            .insert(&mut self.trident, None);
        self.mint = self.trident.random_pubkey();

        let init_mint_ixs = self.trident.initialize_mint(
            &self.creator,
            &self.mint,
            TOKEN_DECIMALS,
            &self.creator,
            None,
        );
        let _ = self
            .trident
            .process_transaction(&init_mint_ixs, Some("init_mint"));

        self.creator_ata = self.trident.get_associated_token_address(
            &self.mint,
            &self.creator,
            &SPL_TOKEN_PROGRAM_ID,
        );
        let ata_ix = self.trident.initialize_associated_token_account(
            &self.creator,
            &self.mint,
            &self.creator,
        );
        let _ = self
            .trident
            .process_transaction(&[ata_ix], Some("init_creator_ata"));

        let mint_ix = self.trident.mint_to(
            &self.creator_ata,
            &self.mint,
            &self.creator,
            MINTED_TO_CREATOR,
        );
        let _ = self
            .trident
            .process_transaction(&[mint_ix], Some("mint_to_creator"));

        self.trident.warp_to_timestamp(0);
    }

    #[flow]
    fn flow_create_stream(&mut self) {
        let campaign_id: u64 = self.trident.random_from_range(1..u64::MAX);
        let schedule = StreamSchedule::linear();
        let (vesting_tree, _) = tree_pda(&self.trident, &self.creator, &self.mint, campaign_id);
        let (vault_authority, _) = vault_authority_pda(&self.trident, &vesting_tree);
        let vault = self.trident.get_associated_token_address(
            &self.mint,
            &vault_authority,
            &SPL_TOKEN_PROGRAM_ID,
        );

        let args = CreateStreamArgs::new(
            campaign_id,
            self.beneficiary,
            STREAM_AMOUNT,
            schedule.release_type,
            schedule.start_time,
            schedule.cliff_time,
            schedule.end_time,
            schedule.milestone_idx,
            false,
            None,
            None,
        );

        let ix = CreateStreamInstruction::data(CreateStreamInstructionData::new(args))
            .accounts(CreateStreamInstructionAccounts::new(
                self.creator,
                vesting_tree,
                vault_authority,
                vault,
                self.creator_ata,
                self.mint,
            ))
            .instruction();

        let res = self
            .trident
            .process_transaction(&[ix], Some("create_stream"));
        if res.is_success() {
            self.stream = Some(StreamContext {
                campaign_id,
                vesting_tree,
                vault,
                schedule,
            });
        }
    }

    #[flow]
    fn flow_withdraw(&mut self) {
        let Some(ctx) = self.stream.clone() else {
            return;
        };

        let warp_ts = self
            .trident
            .random_from_range(ctx.schedule.start_time..=ctx.schedule.end_time);
        self.trident.warp_to_timestamp(warp_ts);

        let (vault_authority, _) = vault_authority_pda(&self.trident, &ctx.vesting_tree);
        let (claim_record, _) =
            claim_record_pda(&self.trident, &ctx.vesting_tree, &self.beneficiary);
        let beneficiary_ata = self.trident.get_associated_token_address(
            &self.mint,
            &self.beneficiary,
            &SPL_TOKEN_PROGRAM_ID,
        );

        let ix = WithdrawInstruction::data(WithdrawInstructionData::new(
            ctx.schedule.to_withdraw_args(),
        ))
        .accounts(WithdrawInstructionAccounts::new(
            self.beneficiary,
            ctx.vesting_tree,
            claim_record,
            vault_authority,
            ctx.vault,
            beneficiary_ata,
            self.mint,
        ))
        .instruction();

        let _ = self
            .trident
            .process_transaction(&[ix], Some("withdraw"));
    }

    /// Regression: partial withdraw must not allow close → second full withdraw (VEL-001).
    #[flow]
    fn flow_withdraw_close_withdraw(&mut self) {
        let Some(ctx) = self.stream.clone() else {
            return;
        };

        let mid = (ctx.schedule.start_time + ctx.schedule.end_time) / 2;
        self.trident.warp_to_timestamp(mid);

        let (vault_authority, _) = vault_authority_pda(&self.trident, &ctx.vesting_tree);
        let (claim_record, _) =
            claim_record_pda(&self.trident, &ctx.vesting_tree, &self.beneficiary);
        let beneficiary_ata = self.trident.get_associated_token_address(
            &self.mint,
            &self.beneficiary,
            &SPL_TOKEN_PROGRAM_ID,
        );

        let withdraw_ix = WithdrawInstruction::data(WithdrawInstructionData::new(
            ctx.schedule.to_withdraw_args(),
        ))
        .accounts(WithdrawInstructionAccounts::new(
            self.beneficiary,
            ctx.vesting_tree,
            claim_record,
            vault_authority,
            ctx.vault,
            beneficiary_ata,
            self.mint,
        ))
        .instruction();

        let w1 = self
            .trident
            .process_transaction(&[withdraw_ix], Some("withdraw_partial"));
        if !w1.is_success() {
            return;
        }

        let close_ix = CloseClaimRecordInstruction::data(CloseClaimRecordInstructionData::new())
            .accounts(CloseClaimRecordInstructionAccounts::new(
                self.beneficiary,
                ctx.vesting_tree,
                claim_record,
            ))
            .instruction();

        let close_res = self
            .trident
            .process_transaction(&[close_ix], Some("close_claim_record"));
        // After VEL-001 fix, close must fail when not fully claimed.
        assert!(
            !close_res.is_success(),
            "close_claim_record must not succeed after partial withdraw"
        );

        let withdraw_ix2 = WithdrawInstruction::data(WithdrawInstructionData::new(
            ctx.schedule.to_withdraw_args(),
        ))
        .accounts(WithdrawInstructionAccounts::new(
            self.beneficiary,
            ctx.vesting_tree,
            claim_record,
            vault_authority,
            ctx.vault,
            beneficiary_ata,
            self.mint,
        ))
        .instruction();

        let w2 = self
            .trident
            .process_transaction(&[withdraw_ix2], Some("withdraw_after_close_blocked"));
        assert!(
            !w2.is_success(),
            "second withdraw must not pay duplicate tranche after blocked close"
        );
    }

    #[flow]
    fn flow_create_campaign_and_fund(&mut self) {
        let campaign_id: u64 = self.trident.random_from_range(1..u64::MAX);
        let (vesting_tree, _) = tree_pda(&self.trident, &self.creator, &self.mint, campaign_id);
        let (vault_authority, _) = vault_authority_pda(&self.trident, &vesting_tree);
        let vault = self.trident.get_associated_token_address(
            &self.mint,
            &vault_authority,
            &SPL_TOKEN_PROGRAM_ID,
        );

        let mut merkle_root = [0u8; 32];
        merkle_root[0] = 1;

        let create_ix = CreateCampaignInstruction::data(CreateCampaignInstructionData::new(
            CreateCampaignArgs::new(
                campaign_id,
                merkle_root,
                1,
                STREAM_AMOUNT,
                false,
                None,
                None,
            ),
        ))
        .accounts(CreateCampaignInstructionAccounts::new(
            self.creator,
            vesting_tree,
            vault_authority,
            vault,
            self.mint,
        ))
        .instruction();

        let create_res = self
            .trident
            .process_transaction(&[create_ix], Some("create_campaign"));
        if !create_res.is_success() {
            return;
        }

        let fund_amount = self.trident.random_from_range(1..=STREAM_AMOUNT);
        let fund_ix = FundCampaignInstruction::data(FundCampaignInstructionData::new(fund_amount))
            .accounts(FundCampaignInstructionAccounts::new(
                self.creator,
                vesting_tree,
                vault,
                self.creator_ata,
            ))
            .instruction();

        let _ = self
            .trident
            .process_transaction(&[fund_ix], Some("fund_campaign"));
    }

    #[flow]
    fn flow_get_vested_amount(&mut self) {
        let Some(ctx) = self.stream.clone() else {
            return;
        };

        let leaf = VestingLeaf::new(
            0,
            self.beneficiary,
            STREAM_AMOUNT,
            ctx.schedule.release_type,
            ctx.schedule.start_time,
            ctx.schedule.cliff_time,
            ctx.schedule.end_time,
            ctx.schedule.milestone_idx,
        );

        let now = self
            .trident
            .random_from_range(ctx.schedule.start_time..=ctx.schedule.end_time + 1000);

        let ix = GetVestedAmountInstruction::data(GetVestedAmountInstructionData::new(
            leaf,
            None,
            now,
        ))
        .instruction();

        let _ = self
            .trident
            .process_transaction(&[ix], Some("get_vested_amount"));
    }

    #[end]
    fn end(&mut self) {
        let Some(ctx) = self.stream.clone() else {
            return;
        };

        if let Some(tree) = self
            .trident
            .get_account_with_type::<VestingTree>(&ctx.vesting_tree, 8)
        {
            assert!(
                tree.total_claimed <= tree.total_supply,
                "total_claimed must not exceed total_supply"
            );
            if let Ok(vault_acct) = self.trident.get_token_account(ctx.vault) {
                let _ = vault_acct.account.amount;
            }
        }
    }
}

fn main() {
    // Default smoke: 100 iterations × 15 flows. Raise for longer campaigns.
    FuzzTest::fuzz(100, 15);
}
