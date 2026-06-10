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

// ---------------------------------------------------------------------------
// create_stream_native benchmark
// ---------------------------------------------------------------------------

#[test]
fn bench_create_stream_native() {
    let mollusk = get_mollusk();
    let pid = program_id();
    let creator = Pubkey::new_unique();
    let beneficiary = Pubkey::new_unique();

    // Create a funded tree with leaf_count=1 for single-stream
    // create_stream_native CREATES the tree — pass empty/uninitialized account
    let (tree_pda, _) = derive_vesting_tree_pda(&creator, &NATIVE_SOL_MINT, 100);

    let stream_args = CreateStreamArgs {
        campaign_id: 100,
        beneficiary,
        amount: 500_000_000,
        release_type: 1, // Linear
        start_time: 0,
        cliff_time: 0,
        end_time: 2_000_000,
        milestone_idx: 0,
        cancellable: false,
        cancel_authority: None,
        pause_authority: None,
    };

    let data = build_ix_data("create_stream_native", &stream_args);
    let ix = Instruction {
        program_id: pid,
        accounts: vec![
            AccountMeta::new(creator, true),
            AccountMeta::new(tree_pda, false),
            AccountMeta::new_readonly(system_program_id(), false),
            AccountMeta::new_readonly(rent_sysvar_id(), false),
        ],
        data,
    };

    let (rent_key, rent_account) = mollusk.sysvars.keyed_account_for_rent_sysvar();
    let (sys_key, sys_account) = keyed_account_for_system_program();
    let accounts: Vec<(Pubkey, Account)> = vec![
        (creator, Account::new(CREATOR_LAMPORTS, 0, &system_program_id())),
        (tree_pda, Account::new(0, 0, &system_program_id())), // empty — instruction creates it
        (sys_key, sys_account),
        (rent_key, rent_account),
    ];

    MolluskComputeUnitBencher::new(mollusk)
        .bench(("create_stream_native [linear, 1 leaf]", &ix, &accounts))
        .must_pass(true)
        .out_dir("benches")
        .execute();

    println!("\n=== create_stream_native benchmark complete ===");
}

// ---------------------------------------------------------------------------
// fund_campaign_native benchmark
// ---------------------------------------------------------------------------

#[test]
fn bench_fund_campaign_native() {
    let mollusk = get_mollusk();
    let pid = program_id();
    let creator = Pubkey::new_unique();

    let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 200)
        .leaf_count(3)
        .total_supply(2_000_000_000)
        .funded_lamports(500_000_000) // partially funded
        .build();

    let fund_amount = 500_000_000u64;
    let data = build_fund_campaign_native_ix_data(fund_amount);
    let ix = Instruction {
        program_id: pid,
        accounts: vec![
            AccountMeta::new(creator, true),
            AccountMeta::new(tree_pda, false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
        data,
    };

    let accounts: Vec<(Pubkey, Account)> = vec![
        (creator, Account::new(CREATOR_LAMPORTS, 0, &system_program_id())),
        (tree_pda, tree_account),
        system_program_account(),
    ];

    MolluskComputeUnitBencher::new(mollusk)
        .bench(("fund_campaign_native [500M lamports]", &ix, &accounts))
        .must_pass(true)
        .out_dir("benches")
        .execute();

    println!("\n=== fund_campaign_native benchmark complete ===");
}

// ---------------------------------------------------------------------------
// cancel_campaign benchmark
// ---------------------------------------------------------------------------

#[test]
fn bench_cancel_campaign() {
    let mollusk = get_mollusk();
    let pid = program_id();
    let creator = Pubkey::new_unique();
    let cancel_auth = Pubkey::new_unique();

    let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 300)
        .cancellable_with(cancel_auth)
        .leaf_count(3)
        .total_supply(10_000_000)
        .total_claimed(3_000_000)
        .funded_lamports(1_000_000_000)
        .build();

    let data = build_cancel_campaign_ix_data();
    let ix = Instruction {
        program_id: pid,
        accounts: vec![
            AccountMeta::new(cancel_auth, true),
            AccountMeta::new(tree_pda, false),
        ],
        data,
    };

    let accounts: Vec<(Pubkey, Account)> = vec![
        (cancel_auth, Account::new(CREATOR_LAMPORTS, 0, &system_program_id())),
        (tree_pda, tree_account),
    ];

    MolluskComputeUnitBencher::new(mollusk)
        .bench(("cancel_campaign [partially claimed]", &ix, &accounts))
        .must_pass(true)
        .out_dir("benches")
        .execute();

    println!("\n=== cancel_campaign benchmark complete ===");
}

// ---------------------------------------------------------------------------
// set_milestone_released benchmark
// ---------------------------------------------------------------------------

#[test]
fn bench_set_milestone_released() {
    let mollusk = get_mollusk();
    let pid = program_id();
    let creator = Pubkey::new_unique();

    let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 400)
        .leaf_count(3)
        .total_supply(10_000_000)
        .funded_lamports(10_000_000)
        .build();

    let data = build_set_milestone_released_ix_data(0);
    let ix = Instruction {
        program_id: pid,
        accounts: vec![
            AccountMeta::new(creator, true),
            AccountMeta::new(tree_pda, false),
        ],
        data,
    };

    let accounts: Vec<(Pubkey, Account)> = vec![
        (creator, Account::new(CREATOR_LAMPORTS, 0, &system_program_id())),
        (tree_pda, tree_account),
    ];

    MolluskComputeUnitBencher::new(mollusk)
        .bench(("set_milestone_released [idx=0]", &ix, &accounts))
        .must_pass(true)
        .out_dir("benches")
        .execute();

    println!("\n=== set_milestone_released benchmark complete ===");
}

// ---------------------------------------------------------------------------
// update_root benchmark
// ---------------------------------------------------------------------------

#[test]
fn bench_update_root() {
    let mollusk = get_mollusk();
    let pid = program_id();
    let creator = Pubkey::new_unique();
    let cancel_auth = Pubkey::new_unique();

    let old_root = valid_merkle_root();
    let mut new_root = [0u8; 32];
    new_root[0] = 0xAA;

    let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 500)
        .merkle_root(old_root)
        .cancellable_with(cancel_auth)
        .leaf_count(3)
        .min_cliff_time(1_000_000)
        .funded_lamports(1_000_000_000)
        .build();

    let data = build_update_root_ix_data(new_root, 5, 2_000_000);
    let ix = Instruction {
        program_id: pid,
        accounts: vec![
            AccountMeta::new(cancel_auth, true),
            AccountMeta::new(tree_pda, false),
        ],
        data,
    };

    let accounts: Vec<(Pubkey, Account)> = vec![
        (cancel_auth, Account::new(CREATOR_LAMPORTS, 0, &system_program_id())),
        (tree_pda, tree_account),
    ];

    MolluskComputeUnitBencher::new(mollusk)
        .bench(("update_root [new root + 5 leaves]", &ix, &accounts))
        .must_pass(true)
        .out_dir("benches")
        .execute();

    println!("\n=== update_root benchmark complete ===");
}

// ---------------------------------------------------------------------------
// pause_campaign + unpause_campaign benchmark
// ---------------------------------------------------------------------------

#[test]
fn bench_pause_unpause() {
    let mollusk = get_mollusk();
    let pid = program_id();
    let creator = Pubkey::new_unique();
    let pause_auth = Pubkey::new_unique();

    let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 600)
        .leaf_count(3)
        .total_supply(10_000_000)
        .funded_lamports(1_000_000_000)
        .pause_authority(Some(pause_auth))
        .build();

    let pause_data = anchor_discriminator("pause_campaign").to_vec();
    let pause_ix = Instruction {
        program_id: pid,
        accounts: vec![
            AccountMeta::new(pause_auth, true),
            AccountMeta::new(tree_pda, false),
        ],
        data: pause_data,
    };

    let pause_accounts: Vec<(Pubkey, Account)> = vec![
        (pause_auth, Account::new(CREATOR_LAMPORTS, 0, &system_program_id())),
        (tree_pda, tree_account),
    ];

    // For unpause: build a paused tree
    let (_, paused_tree_account, _) = TreeConfig::new(creator, 601)
        .leaf_count(3)
        .total_supply(10_000_000)
        .funded_lamports(1_000_000_000)
        .pause_authority(Some(pause_auth))
        .paused(true)
        .build();

    let (tree_pda2, _, _) = TreeConfig::new(creator, 601)
        .leaf_count(3)
        .total_supply(10_000_000)
        .funded_lamports(1_000_000_000)
        .pause_authority(Some(pause_auth))
        .paused(true)
        .build();

    let unpause_data = anchor_discriminator("unpause_campaign").to_vec();
    let unpause_ix = Instruction {
        program_id: pid,
        accounts: vec![
            AccountMeta::new(pause_auth, true),
            AccountMeta::new(tree_pda2, false),
        ],
        data: unpause_data,
    };

    let unpause_accounts: Vec<(Pubkey, Account)> = vec![
        (pause_auth, Account::new(CREATOR_LAMPORTS, 0, &system_program_id())),
        (tree_pda2, paused_tree_account),
    ];

    MolluskComputeUnitBencher::new(mollusk)
        .bench(("pause_campaign [3 leaves]", &pause_ix, &pause_accounts))
        .bench(("unpause_campaign [3 leaves]", &unpause_ix, &unpause_accounts))
        .must_pass(true)
        .out_dir("benches")
        .execute();

    println!("\n=== pause/unpause benchmarks complete ===");
}

// ---------------------------------------------------------------------------
// claim (native SOL) benchmark
// ---------------------------------------------------------------------------
// IGNORED: Mollusk 0.13.x limitation — claim uses init_if_needed for ClaimRecord PDA. Cannot benchmark in Mollusk bencher mode. Unblock when Mollusk supports init_if_needed.
#[ignore]
#[test]
fn bench_claim_native() {
    let mollusk = get_mollusk();
    let pid = program_id();
    let creator = Pubkey::new_unique();
    let beneficiary = Pubkey::new_unique();

    let leaf = VestingLeaf {
        leaf_index: 0,
        beneficiary,
        amount: 1_000_000,
        release_type: 1, // Linear
        start_time: 0,
        cliff_time: 0,
        end_time: 2_000_000,
        milestone_idx: 0,
    };
    let (root, proof) = build_single_leaf_proof(&leaf);

    let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 700)
        .merkle_root(root)
        .leaf_count(1)
        .total_supply(1_000_000)
        .funded_lamports(2_000_000_000)
        .build();

    let (cr_pda, _) = derive_claim_record_pda(&tree_pda, &beneficiary);
    let accounts = build_claim_accounts_native(tree_pda, tree_account, beneficiary, cr_pda);

    // Build the full instruction with account metas
    let claim_data = build_claim_ix_data(&leaf, &proof);
    let ix = Instruction {
        program_id: pid,
        accounts: vec![
            AccountMeta::new(beneficiary, true),
            AccountMeta::new(tree_pda, false),
            AccountMeta::new(cr_pda, false),
            // Option accounts as None (key = pid signals None to Anchor)
            AccountMeta::new_readonly(Pubkey::default(), false), // vault_authority
            AccountMeta::new_readonly(Pubkey::default(), false), // vault
            AccountMeta::new_readonly(Pubkey::default(), false), // beneficiary_ata
            AccountMeta::new_readonly(Pubkey::default(), false), // mint
            AccountMeta::new_readonly(Pubkey::default(), false), // token_program
            AccountMeta::new_readonly(Pubkey::default(), false), // associated_token_program
            AccountMeta::new_readonly(system_program_id(), false), // system_program
        ],
        data: claim_data,
    };

    MolluskComputeUnitBencher::new(mollusk)
        .bench(("claim [native SOL, single leaf, linear]", &ix, &accounts))
        .must_pass(true)
        .out_dir("benches")
        .execute();

    println!("\n=== claim (native) benchmark complete ===");
}

// ---------------------------------------------------------------------------
// close_claim_record benchmark
// ---------------------------------------------------------------------------

#[test]
fn bench_close_claim_record() {
    let mollusk = get_mollusk();
    let pid = program_id();
    let creator = Pubkey::new_unique();
    let beneficiary = Pubkey::new_unique();

    let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 800)
        .leaf_count(1)
        .total_supply(1_000_000_000)
        .funded_lamports(1_000_000_000)
        .build();

    let total_entitled = 1_000_000u64;
    let (cr_pda, cr_account) = ClaimRecordConfig::new(beneficiary, tree_pda)
        .claimed_amount(total_entitled)
        .total_entitled(total_entitled)
        .build();

    let data = build_close_claim_record_ix_data();
    let ix = Instruction {
        program_id: pid,
        accounts: vec![
            AccountMeta::new(beneficiary, true),
            AccountMeta::new_readonly(tree_pda, false),
            AccountMeta::new(cr_pda, false),
        ],
        data,
    };

    let accounts: Vec<(Pubkey, Account)> = vec![
        (beneficiary, Account::new(CREATOR_LAMPORTS, 0, &system_program_id())),
        (creator, Account::new(0, 0, &system_program_id())),
        (tree_pda, tree_account),
        (cr_pda, cr_account),
    ];

    MolluskComputeUnitBencher::new(mollusk)
        .bench(("close_claim_record [fully claimed]", &ix, &accounts))
        .must_pass(true)
        .out_dir("benches")
        .execute();

    println!("\n=== close_claim_record benchmark complete ===");
}
