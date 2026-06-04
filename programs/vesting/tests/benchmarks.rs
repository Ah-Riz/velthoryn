//! Mollusk compute-unit benchmarks for the vesting program.
//!
//! Run with:
//!   BPF_OUT_DIR=../../target/deploy cargo test --manifest-path programs/vesting/Cargo.toml --test benchmarks -- --show-output

mod test_helpers;

use test_helpers::*;
use mollusk_svm_bencher::MolluskComputeUnitBencher;
use mollusk_svm::program::keyed_account_for_system_program;

// ---------------------------------------------------------------------------
// get_vested_amount benchmarks
// ---------------------------------------------------------------------------

#[test]
fn bench_get_vested_amount() {
    let mollusk = get_mollusk();

    let accounts: Vec<(Pubkey, Account)> = vec![];

    // --- Bench 1: Cliff release (type 0) before cliff ---
    let cliff_leaf = VestingLeaf {
        leaf_index: 0,
        beneficiary: Pubkey::new_unique(),
        amount: 1_000_000,
        release_type: 0, // Cliff
        start_time: 1_700_000_000,
        cliff_time: 1_700_000_100,
        end_time: 1_700_001_000,
        milestone_idx: 0,
    };
    let data = build_get_vested_amount_ix_data(&cliff_leaf, None, 1_700_000_050, None);
    let ix = Instruction {
        program_id: program_id(),
        accounts: vec![],
        data,
    };

    // --- Bench 2: Cliff release (type 0) after cliff ---
    let cliff_leaf2 = VestingLeaf {
        leaf_index: 1,
        beneficiary: Pubkey::new_unique(),
        amount: 1_000_000,
        release_type: 0,
        start_time: 1_700_000_000,
        cliff_time: 1_700_000_100,
        end_time: 1_700_001_000,
        milestone_idx: 0,
    };
    let data2 = build_get_vested_amount_ix_data(&cliff_leaf2, None, 1_700_000_200, None);
    let ix2 = Instruction {
        program_id: program_id(),
        accounts: vec![],
        data: data2,
    };

    // --- Bench 3: Linear release (type 1) mid-vesting ---
    let linear_leaf = VestingLeaf {
        leaf_index: 2,
        beneficiary: Pubkey::new_unique(),
        amount: 10_000_000,
        release_type: 1, // Linear
        start_time: 1_700_000_000,
        cliff_time: 1_700_000_000,
        end_time: 1_700_000_100,
        milestone_idx: 0,
    };
    let data3 = build_get_vested_amount_ix_data(&linear_leaf, None, 1_700_000_050, None);
    let ix3 = Instruction {
        program_id: program_id(),
        accounts: vec![],
        data: data3,
    };

    // --- Bench 4: Linear release (type 1) fully vested ---
    let data4 = build_get_vested_amount_ix_data(&linear_leaf, None, 1_700_000_200, None);
    let ix4 = Instruction {
        program_id: program_id(),
        accounts: vec![],
        data: data4,
    };

    // --- Bench 5: Milestone release (type 2) flag not set ---
    let milestone_leaf = VestingLeaf {
        leaf_index: 3,
        beneficiary: Pubkey::new_unique(),
        amount: 5_000_000,
        release_type: 2, // Milestone
        start_time: 1_700_000_000,
        cliff_time: 1_700_000_000,
        end_time: 1_700_001_000,
        milestone_idx: 0,
    };
    let data5 = build_get_vested_amount_ix_data(&milestone_leaf, None, 1_700_000_500, None);
    let ix5 = Instruction {
        program_id: program_id(),
        accounts: vec![],
        data: data5,
    };

    // --- Bench 6: Milestone release (type 2) flag set ---
    let mut flags_set = [0u8; 32];
    flags_set[0] = 1;
    let data6 = build_get_vested_amount_ix_data(&milestone_leaf, None, 1_700_000_500, Some(flags_set));
    let ix6 = Instruction {
        program_id: program_id(),
        accounts: vec![],
        data: data6,
    };

    // --- Bench 7: Linear with cancelled_at clamping ---
    let data7 = build_get_vested_amount_ix_data(
        &linear_leaf,
        Some(1_700_000_025),
        1_700_000_200,
        None,
    );
    let ix7 = Instruction {
        program_id: program_id(),
        accounts: vec![],
        data: data7,
    };

    MolluskComputeUnitBencher::new(mollusk)
        .bench(("get_vested_amount [cliff, before_cliff]", &ix, &accounts))
        .bench(("get_vested_amount [cliff, after_cliff]", &ix2, &accounts))
        .bench(("get_vested_amount [linear, mid-vesting]", &ix3, &accounts))
        .bench(("get_vested_amount [linear, fully_vested]", &ix4, &accounts))
        .bench(("get_vested_amount [milestone, flag_not_set]", &ix5, &accounts))
        .bench(("get_vested_amount [milestone, flag_set]", &ix6, &accounts))
        .bench(("get_vested_amount [linear, cancelled_clamp]", &ix7, &accounts))
        .must_pass(true)
        .out_dir("benches")
        .execute();

    println!("\n=== get_vested_amount benchmarks complete ===");
}

// ---------------------------------------------------------------------------
// create_campaign_native benchmark
// ---------------------------------------------------------------------------

#[test]
fn bench_create_campaign_native() {
    let mollusk = get_mollusk();
    let pid = program_id();
    let creator = Pubkey::new_unique();

    // --- Scenario 1: 100 leaves, cancellable ---
    let campaign_args = CreateCampaignArgs {
        campaign_id: 1,
        merkle_root: [1u8; 32],
        leaf_count: 100,
        total_supply: 1_000_000_000,
        min_cliff_time: 1_700_000_000,
        cancellable: true,
        cancel_authority: Some(creator),
        pause_authority: None,
    };

    let (tree_pubkey, _) = derive_vesting_tree_pda(&creator, &NATIVE_SOL_MINT, campaign_args.campaign_id);
    let data = build_ix_data("create_campaign_native", &campaign_args);

    let ix = Instruction {
        program_id: pid,
        accounts: vec![
            AccountMeta::new(creator, true),
            AccountMeta::new(tree_pubkey, false),
            AccountMeta::new_readonly(system_program_id(), false),
            AccountMeta::new_readonly(rent_sysvar_id(), false),
        ],
        data,
    };

    let creator_account = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
    let (rent_key, rent_account) = mollusk.sysvars.keyed_account_for_rent_sysvar();
    let (sys_key, system_account) = keyed_account_for_system_program();

    let accounts: Vec<(Pubkey, Account)> = vec![
        (creator, creator_account.clone()),
        (tree_pubkey, Account::new(0, 0, &system_program_id())),
        (sys_key, system_account.clone()),
        (rent_key, rent_account.clone()),
    ];

    // --- Scenario 2: 10,000 leaves, non-cancellable ---
    let large_args = CreateCampaignArgs {
        campaign_id: 2,
        merkle_root: [2u8; 32],
        leaf_count: 10_000,
        total_supply: 100_000_000_000,
        min_cliff_time: 1_700_000_000,
        cancellable: false,
        cancel_authority: None,
        pause_authority: Some(creator),
    };

    let (tree_pubkey2, _) = derive_vesting_tree_pda(&creator, &NATIVE_SOL_MINT, large_args.campaign_id);
    let data2 = build_ix_data("create_campaign_native", &large_args);

    let ix2 = Instruction {
        program_id: pid,
        accounts: vec![
            AccountMeta::new(creator, true),
            AccountMeta::new(tree_pubkey2, false),
            AccountMeta::new_readonly(system_program_id(), false),
            AccountMeta::new_readonly(rent_sysvar_id(), false),
        ],
        data: data2,
    };

    let accounts2: Vec<(Pubkey, Account)> = vec![
        (creator, creator_account),
        (tree_pubkey2, Account::new(0, 0, &system_program_id())),
        (sys_key, system_account),
        (rent_key, rent_account),
    ];

    MolluskComputeUnitBencher::new(mollusk)
        .bench(("create_campaign_native [100 leaves, cancellable]", &ix, &accounts))
        .bench(("create_campaign_native [10k leaves, non-cancellable]", &ix2, &accounts2))
        .must_pass(true)
        .out_dir("benches")
        .execute();

    println!("\n=== create_campaign benchmarks complete ===");
}

// ---------------------------------------------------------------------------
// Helper: get_vested_amount ix data (local copy for bench convenience)
// ---------------------------------------------------------------------------

fn build_get_vested_amount_ix_data(
    leaf: &VestingLeaf,
    cancelled_at: Option<i64>,
    now: i64,
    milestone_released_flags: Option<[u8; 32]>,
) -> Vec<u8> {
    let mut ix_data = anchor_discriminator("get_vested_amount").to_vec();
    ix_data.extend_from_slice(&borsh_serialize(leaf));
    ix_data.extend_from_slice(&borsh_serialize(&cancelled_at));
    ix_data.extend_from_slice(&now.to_le_bytes());
    ix_data.extend_from_slice(&borsh_serialize(&milestone_released_flags));
    ix_data
}
