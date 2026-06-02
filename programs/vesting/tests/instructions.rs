//! Instruction-level Mollusk tests for the vesting program.
//!
//! Run with:
//!   BPF_OUT_DIR=../../target/deploy cargo test --manifest-path programs/vesting/Cargo.toml --test instructions -- --show-output

use borsh::{BorshDeserialize, BorshSerialize};
use mollusk_svm::Mollusk;
use mollusk_svm_result::InstructionResult;
use sha2::{Digest, Sha256};
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

// ---------------------------------------------------------------------------
// Program ID
// ---------------------------------------------------------------------------

fn program_id() -> Pubkey {
    Pubkey::try_from("G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu").unwrap()
}

// ---------------------------------------------------------------------------
// Well-known program IDs (as solana_pubkey::Pubkey)
// ---------------------------------------------------------------------------

fn system_program_id() -> Pubkey {
    Pubkey::try_from("11111111111111111111111111111111").unwrap()
}

fn rent_sysvar_id() -> Pubkey {
    Pubkey::try_from("SysvarRent111111111111111111111111111111111").unwrap()
}

// ---------------------------------------------------------------------------
// Anchor discriminator helper
// ---------------------------------------------------------------------------

/// Compute the first 8 bytes of SHA-256("global:<method>") — Anchor ix discriminator.
fn anchor_discriminator(method: &str) -> [u8; 8] {
    let preimage = format!("global:{}", method);
    let mut hasher = Sha256::new();
    hasher.update(preimage.as_bytes());
    let hash = hasher.finalize();
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&hash[..8]);
    disc
}

/// Compute the first 8 bytes of SHA-256("account:<name>") — Anchor account discriminator.
fn account_discriminator(name: &str) -> [u8; 8] {
    let preimage = format!("account:{}", name);
    let mut hasher = Sha256::new();
    hasher.update(preimage.as_bytes());
    let hash = hasher.finalize();
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&hash[..8]);
    disc
}

/// Serialize a `VestingTreeData` into account bytes: 8-byte Anchor discriminator + borsh fields.
fn serialize_vesting_tree(tree_data: &VestingTreeData) -> Vec<u8> {
    let mut data = account_discriminator("VestingTree").to_vec();
    data.append(&mut borsh::to_vec(tree_data).expect("Failed to serialize VestingTreeData"));
    data
}

// ---------------------------------------------------------------------------
// Re-declared types (mirror the on-chain structs, without Anchor derive macros)
// ---------------------------------------------------------------------------

/// Native SOL mint marker — all zeros.
const NATIVE_SOL_MINT: Pubkey = Pubkey::new_from_array([0u8; 32]);

/// Borsh-serializable mirror of `CreateCampaignArgs`.
#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
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

/// Borsh-serializable mirror of `VestingLeaf` (passed as instruction data).
#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
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

/// Mirror of the on-chain `VestingTree` account data (without 8-byte discriminator).
#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq)]
struct VestingTreeData {
    creator: Pubkey,
    mint: Pubkey,
    vault: Pubkey,
    vault_authority: Pubkey,
    campaign_id: u64,
    merkle_root: [u8; 32],
    leaf_count: u32,
    total_supply: u64,
    total_claimed: u64,
    cancellable: bool,
    cancel_authority: Option<Pubkey>,
    cancelled_at: Option<i64>,
    paused: bool,
    pause_authority: Option<Pubkey>,
    created_at: i64,
    milestone_released_flags: [u8; 32],
    min_cliff_time: i64,
    instant_refunded: bool,
    bump: u8,
}

/// Deserialize a VestingTree from raw account data (skips 8-byte Anchor discriminator).
fn deserialize_vesting_tree(data: &[u8]) -> VestingTreeData {
    // Anchor accounts are serialized as: 8-byte discriminator + borsh(fields)
    assert!(data.len() > 8, "Account data too short for Anchor discriminator");
    VestingTreeData::deserialize(&mut &data[8..]).expect("Failed to deserialize VestingTree")
}

/// Build instruction data bytes: discriminator + borsh(args).
fn build_ix_data(method: &str, args: &impl BorshSerialize) -> Vec<u8> {
    let mut data = anchor_discriminator(method).to_vec();
    data.append(&mut borsh::to_vec(args).expect("Failed to serialize args"));
    data
}

/// Borsh-serialize a value to a Vec<u8>.
fn borsh_serialize<T: BorshSerialize>(val: &T) -> Vec<u8> {
    borsh::to_vec(val).expect("Failed to borsh serialize")
}

/// Build a minimal system_program account (stub).
/// The owner must be the NativeLoader1111111111111111111111111111111 so the
/// runtime recognises it as a valid built-in program.
fn system_program_account() -> (Pubkey, Account) {
    let id = system_program_id();
    let native_loader = Pubkey::try_from("NativeLoader1111111111111111111111111111111").unwrap();
    (id, Account {
        lamports: 0,
        data: vec![],
        owner: native_loader,
        executable: true,
        rent_epoch: 0,
    })
}

/// Build a minimal Rent sysvar account (stub).
/// The owner must be the sysvar program ID, otherwise Anchor's Sysvar validation fails
/// with AccountSysvarMismatch (3015).
fn rent_sysvar_account() -> (Pubkey, Account) {
    let id = rent_sysvar_id();
    let sysvar_owner = Pubkey::try_from("Sysvar1111111111111111111111111111111111111").unwrap();
    (id, Account {
        lamports: 1,
        data: vec![0u8; 115], // Rent sysvar is ~115 bytes bincode-serialized
        owner: sysvar_owner,
        executable: false,
        rent_epoch: 0,
    })
}

// ---------------------------------------------------------------------------
// Common test setup
// ---------------------------------------------------------------------------

const CREATOR_LAMPORTS: u64 = 50_000_000_000; // 50 SOL

fn get_mollusk() -> Mollusk {
    Mollusk::new(&program_id(), "vesting")
}

fn make_creator_account() -> (Pubkey, Account) {
    let creator = Pubkey::new_unique();
    let account = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
    (creator, account)
}

fn derive_vesting_tree_pda(
    creator: &Pubkey,
    mint: &Pubkey,
    campaign_id: u64,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            b"tree",
            creator.as_ref(),
            mint.as_ref(),
            &campaign_id.to_le_bytes(),
        ],
        &program_id(),
    )
}

fn valid_merkle_root() -> [u8; 32] {
    // Any non-zero 32-byte array is a valid root for our purposes.
    let mut root = [0u8; 32];
    root[0] = 0x01;
    root
}

fn default_create_args(campaign_id: u64) -> CreateCampaignArgs {
    CreateCampaignArgs {
        campaign_id,
        merkle_root: valid_merkle_root(),
        leaf_count: 3,
        total_supply: 1_000_000_000,
        min_cliff_time: 1_000_000, // must be non-zero (validated by program)
        cancellable: false,
        cancel_authority: None,
        pause_authority: None,
    }
}

// ---------------------------------------------------------------------------
// Anchor error codes from VestingError enum
// ---------------------------------------------------------------------------

/// Helper: extract Anchor error code from a Mollusk failure result.
/// Anchor errors are encoded as `InstructionError::Custom(code)`.
/// The code is the enum variant index + 6000.
fn extract_anchor_error_code(raw_err: &solana_instruction::error::InstructionError) -> Option<u32> {
    match raw_err {
        solana_instruction::error::InstructionError::Custom(code) => Some(*code),
        _ => None,
    }
}

// Anchor error codes (from VestingError enum, base = 6000):
// EmptyRoot           = 6000
// EmptyCampaign       = 6001
// ZeroAmount          = 6002
// MissingCancelAuthority = 6003
// SameRoot            = 6004
// Unauthorized        = 6005
// ...
// NotPausable         = 6021
// AlreadyPaused       = 6022
// NotPaused           = 6024

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // =========================================================================
    // create_campaign_native
    // =========================================================================

    #[test]
    fn test_create_campaign_native_happy_path() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let (creator, creator_acc) = make_creator_account();
        let campaign_id = 42u64;
        let args = default_create_args(campaign_id);

        let (tree_pda, _bump) = derive_vesting_tree_pda(&creator, &NATIVE_SOL_MINT, campaign_id);

        let instruction = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),            // creator (signer, mut)
                AccountMeta::new(tree_pda, false),         // vesting_tree (init, mut)
                AccountMeta::new_readonly(system_program_id(), false), // system_program
                AccountMeta::new_readonly(rent_sysvar_id(), false),    // rent
            ],
            data: build_ix_data("create_campaign_native", &args),
        };

        // VestingTree PDA must be owned by system_program so Anchor's `init`
        // CPI (create_account) succeeds. The program changes owner to itself.
        let accounts = vec![
            (creator, creator_acc),
            (tree_pda, Account::new(0, 0, &system_program_id())),
            system_program_account(),
            rent_sysvar_account(),
        ];

        let result = mollusk.process_instruction(&instruction, &accounts);

        // Assert success
        assert!(
            result.program_result.is_ok(),
            "Expected success but got: {:?}",
            result.program_result
        );
        println!(
            "compute_units: {}",
            result.compute_units_consumed
        );

        // Verify the VestingTree account was written correctly
        let tree_account = result
            .get_account(&tree_pda)
            .expect("VestingTree account should exist after creation");
        let tree_data = deserialize_vesting_tree(&tree_account.data);

        assert_eq!(tree_data.creator, creator);
        assert_eq!(tree_data.mint, NATIVE_SOL_MINT);
        // vault and vault_authority should be Pubkey::default() for native
        assert_eq!(tree_data.vault, Pubkey::default());
        assert_eq!(tree_data.vault_authority, Pubkey::default());
        assert_eq!(tree_data.campaign_id, campaign_id);
        assert_eq!(tree_data.merkle_root, args.merkle_root);
        assert_eq!(tree_data.leaf_count, args.leaf_count);
        assert_eq!(tree_data.total_supply, args.total_supply);
        assert_eq!(tree_data.total_claimed, 0);
        assert!(!tree_data.cancellable);
        assert!(tree_data.cancel_authority.is_none());
        assert!(tree_data.cancelled_at.is_none());
        assert!(!tree_data.paused);
        assert!(tree_data.pause_authority.is_none());
        // created_at = Clock::get().unix_timestamp; Mollusk defaults to 0
        assert_eq!(tree_data.created_at, 0, "created_at should be Mollusk clock default (0)");
        assert_eq!(tree_data.milestone_released_flags, [0u8; 32]);
        assert_eq!(tree_data.min_cliff_time, args.min_cliff_time);
        assert!(!tree_data.instant_refunded);
    }

    #[test]
    fn test_create_campaign_native_empty_root() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let (creator, creator_acc) = make_creator_account();
        let campaign_id = 43u64;

        let mut args = default_create_args(campaign_id);
        args.merkle_root = [0u8; 32]; // empty root

        let (tree_pda, _bump) = derive_vesting_tree_pda(&creator, &NATIVE_SOL_MINT, campaign_id);

        let instruction = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
                AccountMeta::new_readonly(rent_sysvar_id(), false),
            ],
            data: build_ix_data("create_campaign_native", &args),
        };

        let accounts = vec![
            (creator, creator_acc),
            (tree_pda, Account::new(0, 0, &system_program_id())), // tree PDA must be system-owned for init
            system_program_account(),
            rent_sysvar_account(),
        ];

        let result = mollusk.process_instruction(&instruction, &accounts);

        assert!(
            result.program_result.is_err(),
            "Expected error for empty merkle root"
        );

        let err_code = result
            .raw_result
            .as_ref()
            .err()
            .and_then(|e| extract_anchor_error_code(e));
        assert_eq!(
            err_code,
            Some(6000),
            "Expected EmptyRoot error (6000), got: {:?}",
            err_code
        );
        println!("Got expected EmptyRoot error: {:?}", result.program_result);
    }

    #[test]
    fn test_create_campaign_native_zero_leaf_count() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let (creator, creator_acc) = make_creator_account();
        let campaign_id = 44u64;

        let mut args = default_create_args(campaign_id);
        args.leaf_count = 0;

        let (tree_pda, _bump) = derive_vesting_tree_pda(&creator, &NATIVE_SOL_MINT, campaign_id);

        let instruction = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
                AccountMeta::new_readonly(rent_sysvar_id(), false),
            ],
            data: build_ix_data("create_campaign_native", &args),
        };

        let accounts = vec![
            (creator, creator_acc),
            (tree_pda, Account::new(0, 0, &system_program_id())), // tree PDA must be system-owned for init
            system_program_account(),
            rent_sysvar_account(),
        ];

        let result = mollusk.process_instruction(&instruction, &accounts);

        assert!(
            result.program_result.is_err(),
            "Expected error for zero leaf count"
        );

        let err_code = result
            .raw_result
            .as_ref()
            .err()
            .and_then(|e| extract_anchor_error_code(e));
        assert_eq!(
            err_code,
            Some(6001),
            "Expected EmptyCampaign error (6001), got: {:?}",
            err_code
        );
        println!("Got expected EmptyCampaign error: {:?}", result.program_result);
    }

    #[test]
    fn test_create_campaign_native_zero_amount() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let (creator, creator_acc) = make_creator_account();
        let campaign_id = 45u64;

        let mut args = default_create_args(campaign_id);
        args.total_supply = 0;

        let (tree_pda, _bump) = derive_vesting_tree_pda(&creator, &NATIVE_SOL_MINT, campaign_id);

        let instruction = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
                AccountMeta::new_readonly(rent_sysvar_id(), false),
            ],
            data: build_ix_data("create_campaign_native", &args),
        };

        let accounts = vec![
            (creator, creator_acc),
            (tree_pda, Account::new(0, 0, &system_program_id())), // tree PDA must be system-owned for init
            system_program_account(),
            rent_sysvar_account(),
        ];

        let result = mollusk.process_instruction(&instruction, &accounts);

        assert!(
            result.program_result.is_err(),
            "Expected error for zero total supply"
        );

        let err_code = result
            .raw_result
            .as_ref()
            .err()
            .and_then(|e| extract_anchor_error_code(e));
        assert_eq!(
            err_code,
            Some(6002),
            "Expected ZeroAmount error (6002), got: {:?}",
            err_code
        );
        println!("Got expected ZeroAmount error: {:?}", result.program_result);
    }

    // =========================================================================
    // get_vested_amount
    // =========================================================================

    /// Helper: parse the u64 return value from an Anchor `get_vested_amount` result.
    /// Anchor return data format: 8-byte type discriminator + borsh u64 (8 bytes LE) = 16 bytes.
    fn parse_return_u64(return_data: &[u8]) -> u64 {
        // Anchor prefixes return data with the sha256 discriminator of "global:return_u64"
        // followed by the borsh-encoded value. Total is 16 bytes for u64.
        assert!(
            return_data.len() >= 8,
            "Return data too short: {} bytes, expected at least 8",
            return_data.len()
        );
        // Take the last 8 bytes as the borsh-encoded little-endian u64.
        u64::from_le_bytes(
            return_data[return_data.len() - 8..]
                .try_into()
                .expect("Slice should be exactly 8 bytes"),
        )
    }

    /// Build instruction data for `get_vested_amount`: discriminator + leaf + cancelled_at + now + flags.
    fn build_get_vested_amount_ix_data(
        leaf: &VestingLeaf,
        cancelled_at: Option<i64>,
        now: i64,
        milestone_released_flags: Option<[u8; 32]>,
    ) -> Vec<u8> {
        let mut ix_data = anchor_discriminator("get_vested_amount").to_vec();
        ix_data.extend_from_slice(&borsh_serialize(leaf));
        // borsh Option<i64>: 0 for None, 1 + 8 bytes for Some(val)
        ix_data.extend_from_slice(&borsh_serialize(&cancelled_at));
        // borsh i64
        ix_data.extend_from_slice(&now.to_le_bytes());
        // borsh Option<[u8; 32]>: 0 for None, 1 + 32 bytes for Some(val)
        ix_data.extend_from_slice(&borsh_serialize(&milestone_released_flags));
        ix_data
    }

    /// Run get_vested_amount through Mollusk and return the result + parsed return value.
    fn run_get_vested_amount(
        mollusk: &Mollusk,
        leaf: &VestingLeaf,
        cancelled_at: Option<i64>,
        now: i64,
        milestone_released_flags: Option<[u8; 32]>,
    ) -> (mollusk_svm_result::InstructionResult, u64) {
        let pid = program_id();
        let ix_data = build_get_vested_amount_ix_data(leaf, cancelled_at, now, milestone_released_flags);

        let instruction = Instruction {
            program_id: pid,
            accounts: vec![], // GetVestedAmount has an empty Accounts struct
            data: ix_data,
        };

        let result = mollusk.process_instruction(&instruction, &[]);
        let vested = parse_return_u64(&result.return_data);
        (result, vested)
    }

    #[test]
    fn test_get_vested_amount_linear_midpoint() {
        let mollusk = get_mollusk();

        let leaf = VestingLeaf {
            leaf_index: 0,
            beneficiary: Pubkey::new_unique(),
            amount: 1_000,
            release_type: 1, // Linear
            start_time: 1_000,
            cliff_time: 1_000,
            end_time: 2_000,
            milestone_idx: 0,
        };

        let (result, vested) = run_get_vested_amount(&mollusk, &leaf, None, 1_500, None);

        assert!(
            result.program_result.is_ok(),
            "get_vested_amount should succeed: {:?}",
            result.program_result
        );

        // At now=1500 with cliff=1000, end=2000, amount=1000:
        // elapsed = 1500 - 1000 = 500, duration = 2000 - 1000 = 1000
        // vested = 1000 * 500 / 1000 = 500
        assert_eq!(vested, 500, "Expected 500 at midpoint");
        println!("linear midpoint: vested={}", vested);
        println!("  compute_units: {}", result.compute_units_consumed);
    }

    #[test]
    fn test_get_vested_amount_linear_before_cliff() {
        let mollusk = get_mollusk();

        let leaf = VestingLeaf {
            leaf_index: 0,
            beneficiary: Pubkey::new_unique(),
            amount: 1_000,
            release_type: 1, // Linear
            start_time: 1_000,
            cliff_time: 1_000,
            end_time: 2_000,
            milestone_idx: 0,
        };

        let (result, vested) = run_get_vested_amount(&mollusk, &leaf, None, 500, None);

        assert!(
            result.program_result.is_ok(),
            "get_vested_amount should succeed: {:?}",
            result.program_result
        );

        assert_eq!(vested, 0, "Expected 0 before cliff");
        println!("linear before cliff: vested={}", vested);
    }

    #[test]
    fn test_get_vested_amount_linear_after_end() {
        let mollusk = get_mollusk();

        let leaf = VestingLeaf {
            leaf_index: 0,
            beneficiary: Pubkey::new_unique(),
            amount: 1_000,
            release_type: 1, // Linear
            start_time: 1_000,
            cliff_time: 1_000,
            end_time: 2_000,
            milestone_idx: 0,
        };

        let (result, vested) = run_get_vested_amount(&mollusk, &leaf, None, 5_000, None);

        assert!(
            result.program_result.is_ok(),
            "get_vested_amount should succeed: {:?}",
            result.program_result
        );

        assert_eq!(vested, 1_000, "Expected full amount after end");
        println!("linear after end: vested={}", vested);
    }

    #[test]
    fn test_get_vested_amount_linear_cancel_clamp() {
        let mollusk = get_mollusk();

        let leaf = VestingLeaf {
            leaf_index: 0,
            beneficiary: Pubkey::new_unique(),
            amount: 1_000,
            release_type: 1, // Linear
            start_time: 1_000,
            cliff_time: 1_000,
            end_time: 2_000,
            milestone_idx: 0,
        };

        // Campaign cancelled at 1500, but now=5000. Vested should be clamped to cancel time.
        let (result, vested) = run_get_vested_amount(&mollusk, &leaf, Some(1_500), 5_000, None);

        assert!(
            result.program_result.is_ok(),
            "get_vested_amount should succeed: {:?}",
            result.program_result
        );

        // effective_now = min(5000, 1500) = 1500 => 50% vested = 500
        assert_eq!(vested, 500, "Expected 500 with cancel clamped to 1500");
        println!("linear cancel clamp: vested={}", vested);
    }

    #[test]
    fn test_get_vested_amount_cliff_before_after() {
        let mollusk = get_mollusk();

        let leaf = VestingLeaf {
            leaf_index: 0,
            beneficiary: Pubkey::new_unique(),
            amount: 1_000,
            release_type: 0, // Cliff
            start_time: 1_000,
            cliff_time: 1_000,
            end_time: 2_000,
            milestone_idx: 0,
        };

        // Before cliff
        let (_, vested_before) = run_get_vested_amount(&mollusk, &leaf, None, 999, None);
        assert_eq!(vested_before, 0, "Expected 0 before cliff");

        // At/after cliff
        let (_, vested_after) = run_get_vested_amount(&mollusk, &leaf, None, 1_000, None);
        assert_eq!(vested_after, 1_000, "Expected full amount at cliff");

        println!("cliff: before={} after={}", vested_before, vested_after);
    }

    // =========================================================================
    // pause_campaign / unpause_campaign
    // =========================================================================

    /// Helper: build a pre-funded VestingTree account for pause/unpause tests.
    fn build_vesting_tree_for_pause(
        creator: &Pubkey,
        campaign_id: u64,
        pause_authority: &Pubkey,
    ) -> (Pubkey, Account, u8) {
        let pid = program_id();
        let (tree_pda, tree_bump) = derive_vesting_tree_pda(creator, &NATIVE_SOL_MINT, campaign_id);

        let tree_data = VestingTreeData {
            creator: *creator,
            mint: NATIVE_SOL_MINT,
            vault: Pubkey::default(),
            vault_authority: Pubkey::default(),
            campaign_id,
            merkle_root: valid_merkle_root(),
            leaf_count: 1,
            total_supply: 10_000,
            total_claimed: 5_000, // partially claimed so not "completed"
            cancellable: false,
            cancel_authority: None,
            cancelled_at: None,
            paused: false,
            pause_authority: Some(*pause_authority),
            created_at: 100_000,
            milestone_released_flags: [0u8; 32],
            min_cliff_time: 1_000_000,
            instant_refunded: false,
            bump: tree_bump,
        };

        let account_bytes = serialize_vesting_tree(&tree_data);

        let tree_account = Account {
            lamports: 1_000_000_000,
            data: account_bytes,
            owner: pid,
            executable: false,
            rent_epoch: 0,
        };

        (tree_pda, tree_account, tree_bump)
    }

    #[test]
    fn test_pause_unpause_campaign() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let campaign_id = 60u64;

        let creator = Pubkey::new_unique();
        let pause_auth = Pubkey::new_unique();
        let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let pause_auth_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());

        let (tree_pda, tree_account, _bump) =
            build_vesting_tree_for_pause(&creator, campaign_id, &pause_auth);

        // --- Step 1: Pause the campaign ---
        let pause_ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(pause_auth, true),    // pause_authority (signer)
                AccountMeta::new(tree_pda, false),     // vesting_tree (mut)
            ],
            data: anchor_discriminator("pause_campaign").to_vec(),
        };

        let accounts = vec![
            (creator, creator_acc.clone()),
            (pause_auth, pause_auth_acc.clone()),
            (tree_pda, tree_account.clone()),
        ];

        let pause_result = mollusk.process_instruction(&pause_ix, &accounts);

        assert!(
            pause_result.program_result.is_ok(),
            "Pause should succeed, got: {:?}",
            pause_result.program_result
        );
        println!("Pause succeeded, compute_units: {}", pause_result.compute_units_consumed);

        // Verify paused=true in the resulting account data
        let paused_tree = pause_result
            .get_account(&tree_pda)
            .expect("Tree should exist after pause");
        let paused_data = deserialize_vesting_tree(&paused_tree.data);
        assert!(
            paused_data.paused,
            "Tree should be paused after pause_campaign"
        );

        // --- Step 2: Unpause the campaign ---
        let unpause_ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(pause_auth, true),    // pause_authority (signer)
                AccountMeta::new(tree_pda, false),     // vesting_tree (mut)
            ],
            data: anchor_discriminator("unpause_campaign").to_vec(),
        };

        // Feed the post-pause accounts into the unpause call
        let unpause_accounts = pause_result.resulting_accounts.clone();

        let unpause_result = mollusk.process_instruction(&unpause_ix, &unpause_accounts);

        assert!(
            unpause_result.program_result.is_ok(),
            "Unpause should succeed, got: {:?}",
            unpause_result.program_result
        );
        println!(
            "Unpause succeeded, compute_units: {}",
            unpause_result.compute_units_consumed
        );

        // Verify paused=false in the resulting account data
        let unpaused_tree = unpause_result
            .get_account(&tree_pda)
            .expect("Tree should exist after unpause");
        let unpaused_data = deserialize_vesting_tree(&unpaused_tree.data);
        assert!(
            !unpaused_data.paused,
            "Tree should NOT be paused after unpause_campaign"
        );
    }

    #[test]
    fn test_pause_unauthorized_wrong_authority() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let campaign_id = 61u64;

        let creator = Pubkey::new_unique();
        let pause_auth = Pubkey::new_unique();
        let impostor = Pubkey::new_unique();

        let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let impostor_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());

        let (tree_pda, tree_account, _bump) =
            build_vesting_tree_for_pause(&creator, campaign_id, &pause_auth);

        let pause_ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(impostor, true),       // wrong authority (signer)
                AccountMeta::new(tree_pda, false),     // vesting_tree (mut)
            ],
            data: anchor_discriminator("pause_campaign").to_vec(),
        };

        let accounts = vec![
            (creator, creator_acc),
            (impostor, impostor_acc),
            (tree_pda, tree_account),
        ];

        let result = mollusk.process_instruction(&pause_ix, &accounts);

        assert!(
            result.program_result.is_err(),
            "Expected error when wrong authority tries to pause"
        );

        // The constraint `pause_authority == Some(pause_authority.key())` fires Unauthorized
        let err_code = result
            .raw_result
            .as_ref()
            .err()
            .and_then(|e| extract_anchor_error_code(e));
        assert_eq!(
            err_code,
            Some(6005),
            "Expected Unauthorized error (6005), got: {:?}",
            err_code
        );
        println!(
            "Got expected Unauthorized error: {:?}",
            result.program_result
        );
    }

    #[test]
    fn test_pause_not_pausable() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let campaign_id = 62u64;

        let creator = Pubkey::new_unique();
        let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());

        let (tree_pda, tree_bump) = derive_vesting_tree_pda(&creator, &NATIVE_SOL_MINT, campaign_id);

        // Build tree with NO pause_authority
        let tree_data = VestingTreeData {
            creator,
            mint: NATIVE_SOL_MINT,
            vault: Pubkey::default(),
            vault_authority: Pubkey::default(),
            campaign_id,
            merkle_root: valid_merkle_root(),
            leaf_count: 1,
            total_supply: 10_000,
            total_claimed: 5_000,
            cancellable: false,
            cancel_authority: None,
            cancelled_at: None,
            paused: false,
            pause_authority: None, // <-- no pause authority
            created_at: 100_000,
            milestone_released_flags: [0u8; 32],
            min_cliff_time: 1_000_000,
            instant_refunded: false,
            bump: tree_bump,
        };

        let account_bytes = serialize_vesting_tree(&tree_data);

        let tree_account = Account {
            lamports: 1_000_000_000,
            data: account_bytes,
            owner: pid,
            executable: false,
            rent_epoch: 0,
        };

        let pause_ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(tree_pda, false),
            ],
            data: anchor_discriminator("pause_campaign").to_vec(),
        };

        let accounts = vec![
            (creator, creator_acc),
            (tree_pda, tree_account),
        ];

        let result = mollusk.process_instruction(&pause_ix, &accounts);

        assert!(
            result.program_result.is_err(),
            "Expected error when trying to pause a non-pausable campaign"
        );

        // NotPausable = 6021
        let err_code = result
            .raw_result
            .as_ref()
            .err()
            .and_then(|e| extract_anchor_error_code(e));
        assert_eq!(
            err_code,
            Some(6021),
            "Expected NotPausable error (6021), got: {:?}",
            err_code
        );
        println!(
            "Got expected NotPausable error: {:?}",
            result.program_result
        );
    }

    #[test]
    fn test_pause_already_paused() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let campaign_id = 63u64;

        let creator = Pubkey::new_unique();
        let pause_auth = Pubkey::new_unique();

        // Build tree already paused
        let (tree_pda, tree_bump) = derive_vesting_tree_pda(&creator, &NATIVE_SOL_MINT, campaign_id);

        let tree_data = VestingTreeData {
            creator,
            mint: NATIVE_SOL_MINT,
            vault: Pubkey::default(),
            vault_authority: Pubkey::default(),
            campaign_id,
            merkle_root: valid_merkle_root(),
            leaf_count: 1,
            total_supply: 10_000,
            total_claimed: 5_000, // not completed
            cancellable: false,
            cancel_authority: None,
            cancelled_at: None,
            paused: true, // <-- already paused
            pause_authority: Some(pause_auth),
            created_at: 100_000,
            milestone_released_flags: [0u8; 32],
            min_cliff_time: 1_000_000,
            instant_refunded: false,
            bump: tree_bump,
        };

        let account_bytes = serialize_vesting_tree(&tree_data);

        let tree_account = Account {
            lamports: 1_000_000_000,
            data: account_bytes,
            owner: pid,
            executable: false,
            rent_epoch: 0,
        };

        let pause_auth_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());

        let pause_ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(pause_auth, true),
                AccountMeta::new(tree_pda, false),
            ],
            data: anchor_discriminator("pause_campaign").to_vec(),
        };

        let accounts = vec![
            (pause_auth, pause_auth_acc),
            (tree_pda, tree_account),
        ];

        let result = mollusk.process_instruction(&pause_ix, &accounts);

        assert!(
            result.program_result.is_err(),
            "Expected AlreadyPaused error"
        );

        let err_code = result
            .raw_result
            .as_ref()
            .err()
            .and_then(|e| extract_anchor_error_code(e));
        assert_eq!(
            err_code,
            Some(6022),
            "Expected AlreadyPaused error (6022), got: {:?}",
            err_code
        );
        println!(
            "Got expected AlreadyPaused error: {:?}",
            result.program_result
        );
    }

    #[test]
    fn test_unpause_when_not_paused() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let campaign_id = 64u64;

        let creator = Pubkey::new_unique();
        let pause_auth = Pubkey::new_unique();

        let (tree_pda, tree_account, _bump) =
            build_vesting_tree_for_pause(&creator, campaign_id, &pause_auth);

        let pause_auth_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());

        let unpause_ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(pause_auth, true),
                AccountMeta::new(tree_pda, false),
            ],
            data: anchor_discriminator("unpause_campaign").to_vec(),
        };

        let accounts = vec![
            (pause_auth, pause_auth_acc),
            (tree_pda, tree_account),
        ];

        let result = mollusk.process_instruction(&unpause_ix, &accounts);

        assert!(
            result.program_result.is_err(),
            "Expected NotPaused error"
        );

        let err_code = result
            .raw_result
            .as_ref()
            .err()
            .and_then(|e| extract_anchor_error_code(e));
        assert_eq!(
            err_code,
            Some(6024),
            "Expected NotPaused error (6024), got: {:?}",
            err_code
        );
        println!(
            "Got expected NotPaused error: {:?}",
            result.program_result
        );
    }
}
