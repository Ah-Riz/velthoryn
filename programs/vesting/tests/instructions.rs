//! Instruction-level Mollusk tests for the vesting program.
//!
//! Run with:
//!   BPF_OUT_DIR=../../target/deploy cargo test --manifest-path programs/vesting/Cargo.toml --test instructions -- --show-output

mod test_helpers;

use test_helpers::*;

// ---------------------------------------------------------------------------
// Test-specific helpers (not shared across test files)
// ---------------------------------------------------------------------------

/// Build instruction data for `get_vested_amount`: discriminator + leaf + cancelled_at + now + flags.
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

/// Run get_vested_amount through Mollusk and return the result + parsed return value.
fn run_get_vested_amount(
    mollusk: &Mollusk,
    leaf: &VestingLeaf,
    cancelled_at: Option<i64>,
    now: i64,
    milestone_released_flags: Option<[u8; 32]>,
) -> (InstructionResult, u64) {
    let pid = program_id();
    let ix_data = build_get_vested_amount_ix_data(leaf, cancelled_at, now, milestone_released_flags);

    let instruction = Instruction {
        program_id: pid,
        accounts: vec![],
        data: ix_data,
    };

    let result = mollusk.process_instruction(&instruction, &[]);
    let vested = parse_return_u64(&result.return_data);
    (result, vested)
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // =====================================================================
    // create_campaign_native
    // =====================================================================

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
                AccountMeta::new(creator, true),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
                AccountMeta::new_readonly(rent_sysvar_id(), false),
            ],
            data: build_ix_data("create_campaign_native", &args),
        };

        let accounts = vec![
            (creator, creator_acc),
            (tree_pda, Account::new(0, 0, &system_program_id())),
            system_program_account(),
            rent_sysvar_account(),
        ];

        let result = mollusk.process_instruction(&instruction, &accounts);

        assert!(
            result.program_result.is_ok(),
            "Expected success but got: {:?}",
            result.program_result
        );
        println!("compute_units: {}", result.compute_units_consumed);

        let tree_account = result
            .get_account(&tree_pda)
            .expect("VestingTree account should exist after creation");
        let tree_data = deserialize_vesting_tree(&tree_account.data);

        assert_eq!(tree_data.creator, creator);
        assert_eq!(tree_data.mint, NATIVE_SOL_MINT);
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
        args.merkle_root = [0u8; 32];

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
            (tree_pda, Account::new(0, 0, &system_program_id())),
            system_program_account(),
            rent_sysvar_account(),
        ];

        let result = mollusk.process_instruction(&instruction, &accounts);
        expect_error(&result, ERR_EMPTY_ROOT, "empty merkle root");
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
            (tree_pda, Account::new(0, 0, &system_program_id())),
            system_program_account(),
            rent_sysvar_account(),
        ];

        let result = mollusk.process_instruction(&instruction, &accounts);
        expect_error(&result, ERR_EMPTY_CAMPAIGN, "zero leaf count");
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
            (tree_pda, Account::new(0, 0, &system_program_id())),
            system_program_account(),
            rent_sysvar_account(),
        ];

        let result = mollusk.process_instruction(&instruction, &accounts);
        expect_error(&result, ERR_ZERO_AMOUNT, "zero total supply");
    }

    // =====================================================================
    // get_vested_amount
    // =====================================================================

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
        assert_eq!(vested, 500, "Expected 500 at midpoint");
        println!("linear midpoint: vested={}, cu={}", vested, result.compute_units_consumed);
    }

    #[test]
    fn test_get_vested_amount_linear_before_cliff() {
        let mollusk = get_mollusk();

        let leaf = VestingLeaf {
            leaf_index: 0,
            beneficiary: Pubkey::new_unique(),
            amount: 1_000,
            release_type: 1,
            start_time: 1_000,
            cliff_time: 1_000,
            end_time: 2_000,
            milestone_idx: 0,
        };

        let (result, vested) = run_get_vested_amount(&mollusk, &leaf, None, 500, None);

        assert!(result.program_result.is_ok());
        assert_eq!(vested, 0, "Expected 0 before cliff");
    }

    #[test]
    fn test_get_vested_amount_linear_after_end() {
        let mollusk = get_mollusk();

        let leaf = VestingLeaf {
            leaf_index: 0,
            beneficiary: Pubkey::new_unique(),
            amount: 1_000,
            release_type: 1,
            start_time: 1_000,
            cliff_time: 1_000,
            end_time: 2_000,
            milestone_idx: 0,
        };

        let (result, vested) = run_get_vested_amount(&mollusk, &leaf, None, 5_000, None);

        assert!(result.program_result.is_ok());
        assert_eq!(vested, 1_000, "Expected full amount after end");
    }

    #[test]
    fn test_get_vested_amount_linear_cancel_clamp() {
        let mollusk = get_mollusk();

        let leaf = VestingLeaf {
            leaf_index: 0,
            beneficiary: Pubkey::new_unique(),
            amount: 1_000,
            release_type: 1,
            start_time: 1_000,
            cliff_time: 1_000,
            end_time: 2_000,
            milestone_idx: 0,
        };

        let (result, vested) = run_get_vested_amount(&mollusk, &leaf, Some(1_500), 5_000, None);

        assert!(result.program_result.is_ok());
        assert_eq!(vested, 500, "Expected 500 with cancel clamped to 1500");
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

        let (_, vested_before) = run_get_vested_amount(&mollusk, &leaf, None, 999, None);
        assert_eq!(vested_before, 0, "Expected 0 before cliff");

        let (_, vested_after) = run_get_vested_amount(&mollusk, &leaf, None, 1_000, None);
        assert_eq!(vested_after, 1_000, "Expected full amount at cliff");

        println!("cliff: before={} after={}", vested_before, vested_after);
    }

    // =====================================================================
    // pause_campaign / unpause_campaign
    // =====================================================================

    #[test]
    fn test_pause_unpause_campaign() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let campaign_id = 60u64;

        let creator = Pubkey::new_unique();
        let pause_auth = Pubkey::new_unique();
        let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let pause_auth_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());

        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, campaign_id)
            .leaf_count(1)
            .total_supply(10_000)
            .total_claimed(5_000)
            .pause_authority(Some(pause_auth))
            .funded_lamports(1_000_000_000)
            .build();

        // --- Step 1: Pause ---
        let pause_ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(pause_auth, true),
                AccountMeta::new(tree_pda, false),
            ],
            data: anchor_discriminator("pause_campaign").to_vec(),
        };

        let accounts = vec![
            (creator, creator_acc.clone()),
            (pause_auth, pause_auth_acc.clone()),
            (tree_pda, tree_account),
        ];

        let pause_result = mollusk.process_instruction(&pause_ix, &accounts);
        assert!(
            pause_result.program_result.is_ok(),
            "Pause should succeed, got: {:?}",
            pause_result.program_result
        );

        let paused_tree = pause_result
            .get_account(&tree_pda)
            .expect("Tree should exist after pause");
        let paused_data = deserialize_vesting_tree(&paused_tree.data);
        assert!(paused_data.paused, "Tree should be paused after pause_campaign");

        // --- Step 2: Unpause ---
        let unpause_ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(pause_auth, true),
                AccountMeta::new(tree_pda, false),
            ],
            data: anchor_discriminator("unpause_campaign").to_vec(),
        };

        let unpause_accounts = pause_result.resulting_accounts.clone();
        let unpause_result = mollusk.process_instruction(&unpause_ix, &unpause_accounts);
        assert!(
            unpause_result.program_result.is_ok(),
            "Unpause should succeed, got: {:?}",
            unpause_result.program_result
        );

        let unpaused_tree = unpause_result
            .get_account(&tree_pda)
            .expect("Tree should exist after unpause");
        let unpaused_data = deserialize_vesting_tree(&unpaused_tree.data);
        assert!(!unpaused_data.paused, "Tree should NOT be paused after unpause_campaign");
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

        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, campaign_id)
            .leaf_count(1)
            .total_supply(10_000)
            .total_claimed(5_000)
            .pause_authority(Some(pause_auth))
            .funded_lamports(1_000_000_000)
            .build();

        let pause_ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(impostor, true),
                AccountMeta::new(tree_pda, false),
            ],
            data: anchor_discriminator("pause_campaign").to_vec(),
        };

        let accounts = vec![
            (creator, creator_acc),
            (impostor, impostor_acc),
            (tree_pda, tree_account),
        ];

        let result = mollusk.process_instruction(&pause_ix, &accounts);
        expect_error(&result, ERR_UNAUTHORIZED, "pause with wrong authority");
    }

    #[test]
    fn test_pause_not_pausable() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let campaign_id = 62u64;

        let creator = Pubkey::new_unique();
        let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());

        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, campaign_id)
            .leaf_count(1)
            .total_supply(10_000)
            .total_claimed(5_000)
            .funded_lamports(1_000_000_000)
            .build();

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
        expect_error(&result, ERR_NOT_PAUSABLE, "pause with no pause_authority");
    }

    #[test]
    fn test_pause_already_paused() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let campaign_id = 63u64;

        let creator = Pubkey::new_unique();
        let pause_auth = Pubkey::new_unique();

        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, campaign_id)
            .leaf_count(1)
            .total_supply(10_000)
            .total_claimed(5_000)
            .paused(true)
            .pause_authority(Some(pause_auth))
            .funded_lamports(1_000_000_000)
            .build();

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
        expect_error(&result, ERR_ALREADY_PAUSED, "pause when already paused");
    }

    #[test]
    fn test_unpause_when_not_paused() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let campaign_id = 64u64;

        let creator = Pubkey::new_unique();
        let pause_auth = Pubkey::new_unique();

        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, campaign_id)
            .leaf_count(1)
            .total_supply(10_000)
            .total_claimed(5_000)
            .pause_authority(Some(pause_auth))
            .funded_lamports(1_000_000_000)
            .build();

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
        expect_error(&result, ERR_NOT_PAUSED, "unpause when not paused");
    }
}
