//! Mollusk compute-unit benchmarks for the vesting program.
//!
//! Run with:
//!   BPF_OUT_DIR=../../target/deploy cargo test --manifest-path programs/vesting/Cargo.toml --test benchmarks -- --show-output

use borsh::BorshSerialize;
use mollusk_svm::Mollusk;
use mollusk_svm_bencher::MolluskComputeUnitBencher;
use mollusk_svm::program::keyed_account_for_system_program;
use sha2::{Digest, Sha256};
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn program_id() -> Pubkey {
    Pubkey::try_from("G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu").unwrap()
}

fn get_mollusk() -> Mollusk {
    Mollusk::new(&program_id(), "vesting")
}

/// Compute the Anchor instruction discriminator: sha256("global:{method}")[..8].
fn anchor_discriminator(method: &str) -> [u8; 8] {
    let preimage = format!("global:{}", method);
    let mut hasher = Sha256::new();
    hasher.update(preimage.as_bytes());
    let hash = hasher.finalize();
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&hash[..8]);
    disc
}

/// Native SOL mint marker — matches the on-chain `Pubkey::new_from_array([0u8; 32])`.
const NATIVE_SOL_MINT: Pubkey = Pubkey::new_from_array([0u8; 32]);

// Well-known sysvar / program pubkeys.
fn system_program_id() -> Pubkey {
    Pubkey::try_from("11111111111111111111111111111111").unwrap()
}

fn rent_sysvar_id() -> Pubkey {
    Pubkey::try_from("SysvarRent111111111111111111111111111111111").unwrap()
}

// ---------------------------------------------------------------------------
// VestingLeaf construction
// ---------------------------------------------------------------------------

/// Mirrors the on-chain `VestingLeaf` for off-chain serialization.
#[derive(BorshSerialize)]
struct VestingLeaf {
    leaf_index: u32,
    beneficiary: Pubkey,
    amount: u64,
    release_type: u8,
    start_time: i64,
    cliff_time: i64,
    end_time: i64,
    milestone_idx: u8,
}

// ---------------------------------------------------------------------------
// CreateCampaignArgs construction
// ---------------------------------------------------------------------------

/// Mirrors the on-chain `CreateCampaignArgs` for off-chain serialization.
#[derive(BorshSerialize)]
struct CreateCampaignArgs {
    campaign_id: u64,
    merkle_root: [u8; 32],
    leaf_count: u32,
    total_supply: u64,
    min_cliff_time: i64,
    cancellable: bool,
    cancel_authority: Option<Pubkey>,
    pause_authority: Option<Pubkey>,
}

// ---------------------------------------------------------------------------
// Build get_vested_amount instruction data
// ---------------------------------------------------------------------------

fn build_get_vested_amount_ix_data(leaf: &VestingLeaf, cancelled_at: Option<i64>, now: i64, milestone_released_flags: Option<[u8; 32]>) -> Vec<u8> {
    let mut data = Vec::new();
    data.extend_from_slice(&anchor_discriminator("get_vested_amount"));
    leaf.serialize(&mut data).unwrap();
    cancelled_at.serialize(&mut data).unwrap();
    now.serialize(&mut data).unwrap();
    milestone_released_flags.serialize(&mut data).unwrap();
    data
}

// ---------------------------------------------------------------------------
// Build create_campaign_native instruction data
// ---------------------------------------------------------------------------

fn build_create_campaign_native_ix_data(args: &CreateCampaignArgs) -> Vec<u8> {
    let mut data = Vec::new();
    data.extend_from_slice(&anchor_discriminator("create_campaign_native"));
    args.serialize(&mut data).unwrap();
    data
}

// ---------------------------------------------------------------------------
// Compute the VestingTree PDA (same seeds as on-chain init).
// ---------------------------------------------------------------------------

fn vesting_tree_pda_native(creator: &Pubkey, campaign_id: u64) -> (Pubkey, u8) {
    // Seeds: ["tree", creator, NATIVE_SOL_MINT (all zeros), campaign_id.to_le_bytes()]
    let seeds = [
        b"tree".as_ref(),
        creator.as_ref(),
        NATIVE_SOL_MINT.as_ref(),
        &campaign_id.to_le_bytes(),
    ];
    Pubkey::find_program_address(&seeds, &program_id())
}

// ---------------------------------------------------------------------------
// get_vested_amount benchmarks
// ---------------------------------------------------------------------------

#[test]
fn bench_get_vested_amount() {
    let mollusk = get_mollusk();
    let pid = program_id();

    // GetVestedAmount has an empty accounts context (GetVestedAmount {}),
    // so we pass zero accounts and zero AccountMeta entries.
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
        program_id: pid,
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
        program_id: pid,
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
        program_id: pid,
        accounts: vec![],
        data: data3,
    };

    // --- Bench 4: Linear release (type 1) fully vested ---
    let data4 = build_get_vested_amount_ix_data(&linear_leaf, None, 1_700_000_200, None);
    let ix4 = Instruction {
        program_id: pid,
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
        program_id: pid,
        accounts: vec![],
        data: data5,
    };

    // --- Bench 6: Milestone release (type 2) flag set ---
    let mut flags_set = [0u8; 32];
    flags_set[0] = 1; // milestone 0 released
    let data6 = build_get_vested_amount_ix_data(
        &milestone_leaf,
        None,
        1_700_000_500,
        Some(flags_set),
    );
    let ix6 = Instruction {
        program_id: pid,
        accounts: vec![],
        data: data6,
    };

    // --- Bench 7: Linear with cancelled_at clamping ---
    let data7 = build_get_vested_amount_ix_data(
        &linear_leaf,
        Some(1_700_000_025), // cancelled halfway through
        1_700_000_200,       // now is past end
        None,
    );
    let ix7 = Instruction {
        program_id: pid,
        accounts: vec![],
        data: data7,
    };

    MolluskComputeUnitBencher::new(mollusk)
        .bench((
            "get_vested_amount [cliff, before_cliff]",
            &ix,
            &accounts,
        ))
        .bench((
            "get_vested_amount [cliff, after_cliff]",
            &ix2,
            &accounts,
        ))
        .bench((
            "get_vested_amount [linear, mid-vesting]",
            &ix3,
            &accounts,
        ))
        .bench((
            "get_vested_amount [linear, fully_vested]",
            &ix4,
            &accounts,
        ))
        .bench((
            "get_vested_amount [milestone, flag_not_set]",
            &ix5,
            &accounts,
        ))
        .bench((
            "get_vested_amount [milestone, flag_set]",
            &ix6,
            &accounts,
        ))
        .bench((
            "get_vested_amount [linear, cancelled_clamp]",
            &ix7,
            &accounts,
        ))
        .must_pass(true)
        .out_dir("benches")
        .execute();

    // Print inline summary for CI / developer convenience.
    println!("\n=== get_vested_amount benchmarks complete ===");
    println!("Results written to benches/compute_units.md");
}

// ---------------------------------------------------------------------------
// create_campaign_native benchmark
// ---------------------------------------------------------------------------

#[test]
fn bench_create_campaign_native() {
    let mollusk = get_mollusk();
    let pid = program_id();

    let creator = Pubkey::new_unique();

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

    let (tree_pubkey, _tree_bump) = vesting_tree_pda_native(&creator, campaign_args.campaign_id);

    let data = build_create_campaign_native_ix_data(&campaign_args);

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

    // Creator account with enough lamports to pay for the PDA allocation.
    let creator_account = Account::new(
        50_000_000_000, // 50 SOL
        0,
        &system_program_id(),
    );

    // VestingTree PDA -- zero lamports, will be initialized by the instruction.
    // Rent sysvar is required by Anchor's `init` constraint -- use Mollusk's
    // built-in sysvar factory so the owner and serialized data are correct.
    let (rent_key, rent_account) = mollusk.sysvars.keyed_account_for_rent_sysvar();

    // System program must be provided as a transaction account since Mollusk
    // only auto-stubs the instruction's own program_id, not CPI targets.
    // Use Mollusk's factory so the owner is NATIVE_LOADER (not self-referential).
    let (sys_key, system_account) = keyed_account_for_system_program();

    let accounts: Vec<(Pubkey, Account)> = vec![
        (creator, creator_account.clone()),
        // VestingTree PDA must be owned by system_program so that Anchor's
        // `init` CPI (create_account + allocate) succeeds. The program will
        // change the owner to itself during initialization.
        (tree_pubkey, Account::new(0, 0, &system_program_id())),
        (sys_key, system_account.clone()),
        (rent_key, rent_account.clone()),
    ];

    // Also bench with large leaf count to check CU scaling.
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

    let (tree_pubkey2, _tree_bump2) = vesting_tree_pda_native(&creator, large_args.campaign_id);
    let data2 = build_create_campaign_native_ix_data(&large_args);
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
        (creator, creator_account.clone()),
        (tree_pubkey2, Account::new(0, 0, &system_program_id())),
        (sys_key, system_account),
        (rent_key, rent_account),
    ];

    MolluskComputeUnitBencher::new(mollusk)
        .bench((
            "create_campaign_native [100 leaves, cancellable]",
            &ix,
            &accounts,
        ))
        .bench((
            "create_campaign_native [10k leaves, non-cancellable]",
            &ix2,
            &accounts2,
        ))
        .must_pass(true)
        .out_dir("benches")
        .execute();

    println!("\n=== create_campaign benchmarks complete ===");
    println!("Results written to benches/compute_units.md");
}
