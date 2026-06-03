//! Instruction-level Mollusk tests for `create_stream_native`.
//!
//! Run with:
//!   BPF_OUT_DIR=../../target/deploy cargo test --manifest-path programs/vesting/Cargo.toml --test stream -- --show-output

mod test_helpers;

use test_helpers::*;

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // =====================================================================
    // create_stream_native — happy paths
    // =====================================================================

    #[test]
    fn test_create_stream_native_happy() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let (creator, creator_acc) = make_creator_account();
        let beneficiary = Pubkey::new_unique();
        let campaign_id = 100u64;
        let args = default_stream_args(campaign_id, beneficiary);

        let (tree_pda, _bump) = derive_vesting_tree_pda(&creator, &NATIVE_SOL_MINT, campaign_id);

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
                AccountMeta::new_readonly(rent_sysvar_id(), false),
            ],
            data: build_create_stream_native_ix_data(&args),
        };

        let accounts = vec![
            (creator, creator_acc),
            (tree_pda, Account::new(0, 0, &system_program_id())),
            system_program_account(),
            rent_sysvar_account(),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        assert!(
            result.program_result.is_ok(),
            "Expected success but got: {:?}",
            result.program_result
        );
        println!("compute_units: {}", result.compute_units_consumed);

        // Verify tree account was created with correct fields
        let tree_account = result
            .get_account(&tree_pda)
            .expect("VestingTree should exist after create_stream_native");
        let tree_data = deserialize_vesting_tree(&tree_account.data);

        assert_eq!(tree_data.creator, creator);
        assert_eq!(tree_data.mint, NATIVE_SOL_MINT);
        assert_eq!(tree_data.vault, Pubkey::default());
        assert_eq!(tree_data.vault_authority, Pubkey::default());
        assert_eq!(tree_data.campaign_id, campaign_id);
        assert_eq!(tree_data.leaf_count, 1, "single-leaf stream should have leaf_count=1");
        assert_eq!(tree_data.total_supply, args.amount);
        assert_eq!(tree_data.total_claimed, 0);
        assert!(!tree_data.cancellable);
        assert!(tree_data.cancel_authority.is_none());
        assert!(tree_data.cancelled_at.is_none());
        assert!(!tree_data.paused);
        assert!(tree_data.pause_authority.is_none());
        assert_eq!(tree_data.created_at, 0, "created_at should be Mollusk clock default (0)");
        assert_eq!(tree_data.milestone_released_flags, [0u8; 32]);
        assert_eq!(tree_data.min_cliff_time, 0, "min_cliff_time should be 0 for single-leaf stream");
        assert!(!tree_data.instant_refunded);

        // Verify merkle_root matches the leaf hash of the constructed leaf
        let expected_leaf = VestingLeaf {
            leaf_index: 0,
            beneficiary: args.beneficiary,
            amount: args.amount,
            release_type: args.release_type,
            start_time: args.start_time,
            cliff_time: args.cliff_time,
            end_time: args.end_time,
            milestone_idx: args.milestone_idx,
        };
        let expected_root = compute_leaf_hash(&expected_leaf);
        assert_eq!(tree_data.merkle_root, expected_root, "merkle_root should equal leaf_hash for single-leaf");

        // Verify lamports transferred to tree PDA
        // The PDA should hold rent-exempt reserve + the stream amount
        assert!(
            tree_account.lamports > 0,
            "Tree PDA should hold lamports after funding"
        );
        println!("tree_pda lamports after: {}", tree_account.lamports);
    }

    #[test]
    fn test_create_stream_native_cliff() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let (creator, creator_acc) = make_creator_account();
        let beneficiary = Pubkey::new_unique();
        let campaign_id = 101u64;

        let mut args = default_stream_args(campaign_id, beneficiary);
        args.release_type = 0; // Cliff
        args.cliff_time = 1_000_000;
        args.start_time = 0;
        args.end_time = 2_000_000;

        let (tree_pda, _bump) = derive_vesting_tree_pda(&creator, &NATIVE_SOL_MINT, campaign_id);

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
                AccountMeta::new_readonly(rent_sysvar_id(), false),
            ],
            data: build_create_stream_native_ix_data(&args),
        };

        let accounts = vec![
            (creator, creator_acc),
            (tree_pda, Account::new(0, 0, &system_program_id())),
            system_program_account(),
            rent_sysvar_account(),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        assert!(
            result.program_result.is_ok(),
            "Cliff stream should succeed: {:?}",
            result.program_result
        );

        let tree_account = result
            .get_account(&tree_pda)
            .expect("VestingTree should exist");
        let tree_data = deserialize_vesting_tree(&tree_account.data);

        assert_eq!(tree_data.leaf_count, 1);
        assert_eq!(tree_data.total_supply, args.amount);
        assert_eq!(tree_data.merkle_root, compute_leaf_hash(&VestingLeaf {
            leaf_index: 0,
            beneficiary: args.beneficiary,
            amount: args.amount,
            release_type: 0,
            start_time: 0,
            cliff_time: 1_000_000,
            end_time: 2_000_000,
            milestone_idx: args.milestone_idx,
        }));
        println!("cliff stream compute_units: {}", result.compute_units_consumed);
    }

    #[test]
    fn test_create_stream_native_cancellable() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let (creator, creator_acc) = make_creator_account();
        let beneficiary = Pubkey::new_unique();
        let campaign_id = 102u64;
        let cancel_auth = Pubkey::new_unique();

        let mut args = default_stream_args(campaign_id, beneficiary);
        args.cancellable = true;
        args.cancel_authority = Some(cancel_auth);

        let (tree_pda, _bump) = derive_vesting_tree_pda(&creator, &NATIVE_SOL_MINT, campaign_id);

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
                AccountMeta::new_readonly(rent_sysvar_id(), false),
            ],
            data: build_create_stream_native_ix_data(&args),
        };

        let accounts = vec![
            (creator, creator_acc),
            (tree_pda, Account::new(0, 0, &system_program_id())),
            system_program_account(),
            rent_sysvar_account(),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        assert!(
            result.program_result.is_ok(),
            "Cancellable stream should succeed: {:?}",
            result.program_result
        );

        let tree_account = result
            .get_account(&tree_pda)
            .expect("VestingTree should exist");
        let tree_data = deserialize_vesting_tree(&tree_account.data);

        assert!(tree_data.cancellable, "tree should be marked cancellable");
        assert_eq!(tree_data.cancel_authority, Some(cancel_auth), "cancel_authority should match");
        println!("cancellable stream compute_units: {}", result.compute_units_consumed);
    }

    // =====================================================================
    // create_stream_native — error cases
    // =====================================================================

    #[test]
    fn test_create_stream_native_zero_amount() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let (creator, creator_acc) = make_creator_account();
        let beneficiary = Pubkey::new_unique();
        let campaign_id = 103u64;

        let mut args = default_stream_args(campaign_id, beneficiary);
        args.amount = 0;

        let (tree_pda, _bump) = derive_vesting_tree_pda(&creator, &NATIVE_SOL_MINT, campaign_id);

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
                AccountMeta::new_readonly(rent_sysvar_id(), false),
            ],
            data: build_create_stream_native_ix_data(&args),
        };

        let accounts = vec![
            (creator, creator_acc),
            (tree_pda, Account::new(0, 0, &system_program_id())),
            system_program_account(),
            rent_sysvar_account(),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_ZERO_AMOUNT, "amount=0");
    }

    #[test]
    fn test_create_stream_native_invalid_schedule() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let (creator, creator_acc) = make_creator_account();
        let beneficiary = Pubkey::new_unique();
        let campaign_id = 104u64;

        // start > cliff violates the start <= cliff <= end constraint
        let mut args = default_stream_args(campaign_id, beneficiary);
        args.start_time = 500_000;
        args.cliff_time = 100_000; // cliff < start
        args.end_time = 2_000_000;

        let (tree_pda, _bump) = derive_vesting_tree_pda(&creator, &NATIVE_SOL_MINT, campaign_id);

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
                AccountMeta::new_readonly(rent_sysvar_id(), false),
            ],
            data: build_create_stream_native_ix_data(&args),
        };

        let accounts = vec![
            (creator, creator_acc),
            (tree_pda, Account::new(0, 0, &system_program_id())),
            system_program_account(),
            rent_sysvar_account(),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_INVALID_SCHEDULE, "start > cliff");
    }

    #[test]
    fn test_create_stream_native_invalid_schedule_type() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let (creator, creator_acc) = make_creator_account();
        let beneficiary = Pubkey::new_unique();
        let campaign_id = 105u64;

        let mut args = default_stream_args(campaign_id, beneficiary);
        args.release_type = 3; // Only 0, 1, 2 are valid

        let (tree_pda, _bump) = derive_vesting_tree_pda(&creator, &NATIVE_SOL_MINT, campaign_id);

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
                AccountMeta::new_readonly(rent_sysvar_id(), false),
            ],
            data: build_create_stream_native_ix_data(&args),
        };

        let accounts = vec![
            (creator, creator_acc),
            (tree_pda, Account::new(0, 0, &system_program_id())),
            system_program_account(),
            rent_sysvar_account(),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_INVALID_SCHEDULE_TYPE, "release_type=3");
    }

    #[test]
    fn test_create_stream_native_missing_cancel_auth() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let (creator, creator_acc) = make_creator_account();
        let beneficiary = Pubkey::new_unique();
        let campaign_id = 106u64;

        let mut args = default_stream_args(campaign_id, beneficiary);
        args.cancellable = true;
        args.cancel_authority = None; // Required when cancellable=true

        let (tree_pda, _bump) = derive_vesting_tree_pda(&creator, &NATIVE_SOL_MINT, campaign_id);

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
                AccountMeta::new_readonly(rent_sysvar_id(), false),
            ],
            data: build_create_stream_native_ix_data(&args),
        };

        let accounts = vec![
            (creator, creator_acc),
            (tree_pda, Account::new(0, 0, &system_program_id())),
            system_program_account(),
            rent_sysvar_account(),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_MISSING_CANCEL_AUTH, "cancellable=true with no cancel_authority");
    }
}
