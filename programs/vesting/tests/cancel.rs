//! Mollusk instruction-level tests for `cancel_campaign` and `cancel_stream`
//! instructions (native SOL).
//!
//! Run with:
//!   BPF_OUT_DIR=../../target/deploy cargo test --manifest-path programs/vesting/Cargo.toml --test cancel -- --show-output

mod test_helpers;

use test_helpers::*;

// ===========================================================================
// cancel_campaign — native SOL tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // =====================================================================
    // cancel_campaign
    // =====================================================================

    #[test]
    fn test_cancel_campaign_happy() {
        let mollusk = get_mollusk();
        let pid = program_id();

        let creator = Pubkey::new_unique();
        let cancel_auth = Pubkey::new_unique();

        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .leaf_count(3)
            .total_supply(10_000)
            .total_claimed(3_000)
            .cancellable_with(cancel_auth)
            .funded_lamports(1_000_000_000)
            .build();

        let cancel_auth_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(cancel_auth, true),
                AccountMeta::new(tree_pda, false),
            ],
            data: build_cancel_campaign_ix_data(),
        };

        let accounts = vec![
            (creator, Account::new(0, 0, &system_program_id())),
            (cancel_auth, cancel_auth_acc),
            (tree_pda, tree_account),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);

        assert!(
            result.program_result.is_ok(),
            "Expected success but got: {:?}",
            result.program_result
        );
        println!("cancel_campaign cu={}", result.compute_units_consumed);

        let tree_acc = result
            .get_account(&tree_pda)
            .expect("VestingTree should exist after cancel");
        let tree_data = deserialize_vesting_tree(&tree_acc.data);

        assert!(
            tree_data.cancelled_at.is_some(),
            "cancelled_at should be set"
        );
        assert!(
            !tree_data.paused,
            "paused should be cleared after cancel"
        );
    }

    #[test]
    fn test_cancel_campaign_not_cancellable() {
        let mollusk = get_mollusk();
        let pid = program_id();

        let creator = Pubkey::new_unique();
        let cancel_auth = Pubkey::new_unique();

        // cancellable = false (default)
        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .leaf_count(3)
            .total_supply(10_000)
            .total_claimed(3_000)
            .cancel_authority(Some(cancel_auth)) // authority set but cancellable=false
            .funded_lamports(1_000_000_000)
            .build();

        let cancel_auth_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(cancel_auth, true),
                AccountMeta::new(tree_pda, false),
            ],
            data: build_cancel_campaign_ix_data(),
        };

        let accounts = vec![
            (creator, Account::new(0, 0, &system_program_id())),
            (cancel_auth, cancel_auth_acc),
            (tree_pda, tree_account),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_NOT_CANCELLABLE, "cancellable=false");
    }

    #[test]
    fn test_cancel_campaign_already_cancelled() {
        let mollusk = get_mollusk();
        let pid = program_id();

        let creator = Pubkey::new_unique();
        let cancel_auth = Pubkey::new_unique();

        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .leaf_count(3)
            .total_supply(10_000)
            .total_claimed(3_000)
            .cancellable_with(cancel_auth)
            .cancelled_at(Some(100_000)) // Already cancelled
            .funded_lamports(1_000_000_000)
            .build();

        let cancel_auth_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(cancel_auth, true),
                AccountMeta::new(tree_pda, false),
            ],
            data: build_cancel_campaign_ix_data(),
        };

        let accounts = vec![
            (creator, Account::new(0, 0, &system_program_id())),
            (cancel_auth, cancel_auth_acc),
            (tree_pda, tree_account),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_ALREADY_CANCELLED, "already cancelled");
    }

    #[test]
    fn test_cancel_campaign_unauthorized() {
        let mollusk = get_mollusk();
        let pid = program_id();

        let creator = Pubkey::new_unique();
        let cancel_auth = Pubkey::new_unique();
        let impostor = Pubkey::new_unique();

        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .leaf_count(3)
            .total_supply(10_000)
            .total_claimed(3_000)
            .cancellable_with(cancel_auth)
            .funded_lamports(1_000_000_000)
            .build();

        let impostor_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(impostor, true),
                AccountMeta::new(tree_pda, false),
            ],
            data: build_cancel_campaign_ix_data(),
        };

        let accounts = vec![
            (creator, Account::new(0, 0, &system_program_id())),
            (impostor, impostor_acc),
            (tree_pda, tree_account),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_UNAUTHORIZED, "wrong cancel authority");
    }

    #[test]
    fn test_cancel_campaign_fully_vested() {
        let mollusk = get_mollusk();
        let pid = program_id();

        let creator = Pubkey::new_unique();
        let cancel_auth = Pubkey::new_unique();

        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .leaf_count(3)
            .total_supply(10_000)
            .total_claimed(10_000) // Fully claimed
            .cancellable_with(cancel_auth)
            .funded_lamports(1_000_000_000)
            .build();

        let cancel_auth_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(cancel_auth, true),
                AccountMeta::new(tree_pda, false),
            ],
            data: build_cancel_campaign_ix_data(),
        };

        let accounts = vec![
            (creator, Account::new(0, 0, &system_program_id())),
            (cancel_auth, cancel_auth_acc),
            (tree_pda, tree_account),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_FULLY_VESTED, "total_claimed == total_supply");
    }

    // =====================================================================
    // cancel_stream — native SOL tests
    // =====================================================================

    // Mollusk 0.13 doesn't support Anchor's init_if_needed for PDA accounts
    #[ignore]
    #[test]
    fn test_cancel_stream_happy() {
        let mut mollusk = get_mollusk();
        let pid = program_id();

        // Set clock so we're at 50% vesting
        mollusk.sysvars.clock.unix_timestamp = 1_000_000i64;

        let creator = Pubkey::new_unique();
        let beneficiary = Pubkey::new_unique();

        let leaf = VestingLeaf {
            leaf_index: 0,
            beneficiary,
            amount: 1_000,
            release_type: 1, // Linear
            start_time: 0,
            cliff_time: 0,
            end_time: 2_000_000,
            milestone_idx: 0,
        };
        let (root, _proof) = build_single_leaf_proof(&leaf);

        let total_funded = 1_000 + 500_000; // supply + rent buffer
        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(root)
            .leaf_count(1)
            .total_supply(1_000)
            .cancellable_with(creator)
            .funded_lamports(total_funded)
            .build();

        let (cr_pda, _) = derive_claim_record_pda(&tree_pda, &beneficiary);

        let args = WithdrawArgs {
            release_type: 1,
            start_time: 0,
            cliff_time: 0,
            end_time: 2_000_000,
            milestone_idx: 0,
        };

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(beneficiary, false), // UncheckedAccount, mut
                AccountMeta::new(tree_pda, false),
                AccountMeta::new(cr_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
            ],
            data: build_cancel_stream_ix_data(&args),
        };

        let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let beneficiary_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let cr_acc = Account::new(0, 0, &system_program_id()); // system-owned for init

        let accounts = vec![
            (creator, creator_acc),
            (beneficiary, beneficiary_acc),
            (tree_pda, tree_account),
            (cr_pda, cr_acc),
            system_program_account(),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);

        assert!(
            result.program_result.is_ok(),
            "Expected success but got: {:?}",
            result.program_result
        );
        println!("cancel_stream cu={}", result.compute_units_consumed);

        // At 50% vesting: beneficiary gets 500, creator gets remaining 500 + rent (total_funded - 500)
        let ben_acc = result
            .get_account(&beneficiary)
            .expect("beneficiary should exist");
        assert_eq!(
            ben_acc.lamports,
            CREATOR_LAMPORTS + 500,
            "beneficiary should get 500 (50% vested)"
        );

        let creator_acc_result = result
            .get_account(&creator)
            .expect("creator should exist");
        let creator_expected = CREATOR_LAMPORTS + (total_funded - 500);
        assert_eq!(
            creator_acc_result.lamports,
            creator_expected,
            "creator should get remaining {} (unvested + rent)",
            total_funded - 500
        );

        // Verify tree state
        let tree_acc = result
            .get_account(&tree_pda)
            .expect("VestingTree should exist");
        let tree_data = deserialize_vesting_tree(&tree_acc.data);
        assert!(tree_data.cancelled_at.is_some(), "cancelled_at should be set");
        assert!(!tree_data.paused, "paused should be cleared");
        assert_eq!(tree_data.total_claimed, 500, "total_claimed = vested portion");
    }

    // Mollusk 0.13 doesn't support Anchor's init_if_needed for PDA accounts
    #[ignore]
    #[test]
    fn test_cancel_stream_fully_vested_all_to_beneficiary() {
        let mut mollusk = get_mollusk();
        let pid = program_id();

        // Set clock past end_time so fully vested
        mollusk.sysvars.clock.unix_timestamp = 3_000_000i64;

        let creator = Pubkey::new_unique();
        let beneficiary = Pubkey::new_unique();

        let leaf = VestingLeaf {
            leaf_index: 0,
            beneficiary,
            amount: 1_000,
            release_type: 1,
            start_time: 0,
            cliff_time: 0,
            end_time: 2_000_000,
            milestone_idx: 0,
        };
        let (root, _proof) = build_single_leaf_proof(&leaf);

        let total_funded = 1_000 + 500_000;
        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(root)
            .leaf_count(1)
            .total_supply(1_000)
            .cancellable_with(creator)
            .funded_lamports(total_funded)
            .build();

        let (cr_pda, _) = derive_claim_record_pda(&tree_pda, &beneficiary);

        let args = WithdrawArgs {
            release_type: 1,
            start_time: 0,
            cliff_time: 0,
            end_time: 2_000_000,
            milestone_idx: 0,
        };

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(beneficiary, false),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new(cr_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
            ],
            data: build_cancel_stream_ix_data(&args),
        };

        let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let beneficiary_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let cr_acc = Account::new(0, 0, &system_program_id());

        let accounts = vec![
            (creator, creator_acc),
            (beneficiary, beneficiary_acc),
            (tree_pda, tree_account),
            (cr_pda, cr_acc),
            system_program_account(),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);

        assert!(
            result.program_result.is_ok(),
            "Expected success but got: {:?}",
            result.program_result
        );

        // Fully vested: beneficiary gets 1000, creator gets remaining (rent buffer)
        let ben_acc = result.get_account(&beneficiary).unwrap();
        assert_eq!(
            ben_acc.lamports,
            CREATOR_LAMPORTS + 1_000,
            "beneficiary gets full 1000"
        );

        let creator_acc_result = result.get_account(&creator).unwrap();
        assert_eq!(
            creator_acc_result.lamports,
            CREATOR_LAMPORTS + 500_000,
            "creator gets rent buffer only (500_000)"
        );
    }

    // Mollusk 0.13 doesn't support Anchor's init_if_needed for PDA accounts
    #[ignore]
    #[test]
    fn test_cancel_stream_nothing_vested_all_to_creator() {
        let mollusk = get_mollusk();
        let pid = program_id();

        // Default clock: unix_timestamp = 0. Cliff is at 1_000_000, so nothing vested.
        let creator = Pubkey::new_unique();
        let beneficiary = Pubkey::new_unique();

        let leaf = VestingLeaf {
            leaf_index: 0,
            beneficiary,
            amount: 1_000,
            release_type: 1, // Linear
            start_time: 0,
            cliff_time: 1_000_000,
            end_time: 2_000_000,
            milestone_idx: 0,
        };
        let (root, _proof) = build_single_leaf_proof(&leaf);

        let total_funded = 1_000 + 500_000;
        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(root)
            .leaf_count(1)
            .total_supply(1_000)
            .cancellable_with(creator)
            .funded_lamports(total_funded)
            .build();

        let (cr_pda, _) = derive_claim_record_pda(&tree_pda, &beneficiary);

        let args = WithdrawArgs {
            release_type: 1,
            start_time: 0,
            cliff_time: 1_000_000,
            end_time: 2_000_000,
            milestone_idx: 0,
        };

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(beneficiary, false),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new(cr_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
            ],
            data: build_cancel_stream_ix_data(&args),
        };

        let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let beneficiary_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let cr_acc = Account::new(0, 0, &system_program_id());

        let accounts = vec![
            (creator, creator_acc),
            (beneficiary, beneficiary_acc),
            (tree_pda, tree_account),
            (cr_pda, cr_acc),
            system_program_account(),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);

        assert!(
            result.program_result.is_ok(),
            "Expected success but got: {:?}",
            result.program_result
        );

        // Nothing vested: beneficiary gets 0, creator gets everything (1_000 + 500_000)
        let ben_acc = result.get_account(&beneficiary).unwrap();
        assert_eq!(ben_acc.lamports, CREATOR_LAMPORTS, "beneficiary gets nothing");

        let creator_acc_result = result.get_account(&creator).unwrap();
        assert_eq!(
            creator_acc_result.lamports,
            CREATOR_LAMPORTS + total_funded,
            "creator gets all funded lamports"
        );

        // Verify tree state: cancelled_at set but total_claimed = 0
        let tree_acc = result.get_account(&tree_pda).unwrap();
        let tree_data = deserialize_vesting_tree(&tree_acc.data);
        assert!(tree_data.cancelled_at.is_some());
        assert_eq!(tree_data.total_claimed, 0, "nothing was vested to claim");
    }

    // Mollusk 0.13 doesn't support Anchor's init_if_needed for PDA accounts
    #[ignore]
    #[test]
    fn test_cancel_stream_not_single_stream() {
        let mut mollusk = get_mollusk();
        let pid = program_id();

        mollusk.sysvars.clock.unix_timestamp = 1_000_000i64;

        let creator = Pubkey::new_unique();
        let beneficiary = Pubkey::new_unique();

        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(valid_merkle_root())
            .leaf_count(3) // NOT 1
            .total_supply(3_000)
            .cancellable_with(creator)
            .funded_lamports(3_000 + 500_000)
            .build();

        let (cr_pda, _) = derive_claim_record_pda(&tree_pda, &beneficiary);

        let args = WithdrawArgs {
            release_type: 1,
            start_time: 0,
            cliff_time: 0,
            end_time: 2_000_000,
            milestone_idx: 0,
        };

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(beneficiary, false),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new(cr_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
            ],
            data: build_cancel_stream_ix_data(&args),
        };

        let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let beneficiary_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let cr_acc = Account::new(0, 0, &system_program_id());

        let accounts = vec![
            (creator, creator_acc),
            (beneficiary, beneficiary_acc),
            (tree_pda, tree_account),
            (cr_pda, cr_acc),
            system_program_account(),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_NOT_SINGLE_STREAM, "leaf_count=3");
    }

    // Mollusk 0.13 doesn't support Anchor's init_if_needed for PDA accounts
    #[ignore]
    #[test]
    fn test_cancel_stream_not_cancellable() {
        let mut mollusk = get_mollusk();
        let pid = program_id();

        mollusk.sysvars.clock.unix_timestamp = 1_000_000i64;

        let creator = Pubkey::new_unique();
        let beneficiary = Pubkey::new_unique();

        let leaf = VestingLeaf {
            leaf_index: 0,
            beneficiary,
            amount: 1_000,
            release_type: 1,
            start_time: 0,
            cliff_time: 0,
            end_time: 2_000_000,
            milestone_idx: 0,
        };
        let (root, _proof) = build_single_leaf_proof(&leaf);

        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(root)
            .leaf_count(1)
            .total_supply(1_000)
            .funded_lamports(1_000 + 500_000)
            // cancellable = false (default)
            .build();

        let (cr_pda, _) = derive_claim_record_pda(&tree_pda, &beneficiary);

        let args = WithdrawArgs {
            release_type: 1,
            start_time: 0,
            cliff_time: 0,
            end_time: 2_000_000,
            milestone_idx: 0,
        };

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(beneficiary, false),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new(cr_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
            ],
            data: build_cancel_stream_ix_data(&args),
        };

        let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let beneficiary_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let cr_acc = Account::new(0, 0, &system_program_id());

        let accounts = vec![
            (creator, creator_acc),
            (beneficiary, beneficiary_acc),
            (tree_pda, tree_account),
            (cr_pda, cr_acc),
            system_program_account(),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_NOT_CANCELLABLE, "cancellable=false");
    }

    // Mollusk 0.13 doesn't support Anchor's init_if_needed for PDA accounts
    #[ignore]
    #[test]
    fn test_cancel_stream_already_cancelled() {
        let mut mollusk = get_mollusk();
        let pid = program_id();

        mollusk.sysvars.clock.unix_timestamp = 1_000_000i64;

        let creator = Pubkey::new_unique();
        let beneficiary = Pubkey::new_unique();

        let leaf = VestingLeaf {
            leaf_index: 0,
            beneficiary,
            amount: 1_000,
            release_type: 1,
            start_time: 0,
            cliff_time: 0,
            end_time: 2_000_000,
            milestone_idx: 0,
        };
        let (root, _proof) = build_single_leaf_proof(&leaf);

        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(root)
            .leaf_count(1)
            .total_supply(1_000)
            .cancellable_with(creator)
            .cancelled_at(Some(500_000)) // Already cancelled
            .funded_lamports(1_000 + 500_000)
            .build();

        let (cr_pda, _) = derive_claim_record_pda(&tree_pda, &beneficiary);

        let args = WithdrawArgs {
            release_type: 1,
            start_time: 0,
            cliff_time: 0,
            end_time: 2_000_000,
            milestone_idx: 0,
        };

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(beneficiary, false),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new(cr_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
            ],
            data: build_cancel_stream_ix_data(&args),
        };

        let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let beneficiary_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let cr_acc = Account::new(0, 0, &system_program_id());

        let accounts = vec![
            (creator, creator_acc),
            (beneficiary, beneficiary_acc),
            (tree_pda, tree_account),
            (cr_pda, cr_acc),
            system_program_account(),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_ALREADY_CANCELLED, "already cancelled");
    }

    // Mollusk 0.13 doesn't support Anchor's init_if_needed for PDA accounts
    #[ignore]
    #[test]
    fn test_cancel_stream_unauthorized() {
        let mut mollusk = get_mollusk();
        let pid = program_id();

        mollusk.sysvars.clock.unix_timestamp = 1_000_000i64;

        let creator = Pubkey::new_unique();
        let impostor = Pubkey::new_unique();
        let beneficiary = Pubkey::new_unique();

        let leaf = VestingLeaf {
            leaf_index: 0,
            beneficiary,
            amount: 1_000,
            release_type: 1,
            start_time: 0,
            cliff_time: 0,
            end_time: 2_000_000,
            milestone_idx: 0,
        };
        let (root, _proof) = build_single_leaf_proof(&leaf);

        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(root)
            .leaf_count(1)
            .total_supply(1_000)
            .cancellable_with(creator) // authority is creator, not impostor
            .funded_lamports(1_000 + 500_000)
            .build();

        let (cr_pda, _) = derive_claim_record_pda(&tree_pda, &beneficiary);

        let args = WithdrawArgs {
            release_type: 1,
            start_time: 0,
            cliff_time: 0,
            end_time: 2_000_000,
            milestone_idx: 0,
        };

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(impostor, true), // Wrong signer
                AccountMeta::new(beneficiary, false),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new(cr_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
            ],
            data: build_cancel_stream_ix_data(&args),
        };

        let impostor_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let beneficiary_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let cr_acc = Account::new(0, 0, &system_program_id());

        let accounts = vec![
            (creator, Account::new(0, 0, &system_program_id())),
            (impostor, impostor_acc),
            (beneficiary, beneficiary_acc),
            (tree_pda, tree_account),
            (cr_pda, cr_acc),
            system_program_account(),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        // has_one = creator constraint fails
        expect_error(&result, ERR_UNAUTHORIZED, "wrong creator");
    }

    // Mollusk 0.13 doesn't support Anchor's init_if_needed for PDA accounts
    #[ignore]
    #[test]
    fn test_cancel_stream_fully_vested() {
        let mut mollusk = get_mollusk();
        let pid = program_id();

        mollusk.sysvars.clock.unix_timestamp = 1_000_000i64;

        let creator = Pubkey::new_unique();
        let beneficiary = Pubkey::new_unique();

        let leaf = VestingLeaf {
            leaf_index: 0,
            beneficiary,
            amount: 1_000,
            release_type: 1,
            start_time: 0,
            cliff_time: 0,
            end_time: 2_000_000,
            milestone_idx: 0,
        };
        let (root, _proof) = build_single_leaf_proof(&leaf);

        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(root)
            .leaf_count(1)
            .total_supply(1_000)
            .total_claimed(1_000) // Fully claimed already
            .cancellable_with(creator)
            .funded_lamports(1_000 + 500_000)
            .build();

        let (cr_pda, _) = derive_claim_record_pda(&tree_pda, &beneficiary);

        let args = WithdrawArgs {
            release_type: 1,
            start_time: 0,
            cliff_time: 0,
            end_time: 2_000_000,
            milestone_idx: 0,
        };

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(beneficiary, false),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new(cr_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
            ],
            data: build_cancel_stream_ix_data(&args),
        };

        let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let beneficiary_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let cr_acc = Account::new(0, 0, &system_program_id());

        let accounts = vec![
            (creator, creator_acc),
            (beneficiary, beneficiary_acc),
            (tree_pda, tree_account),
            (cr_pda, cr_acc),
            system_program_account(),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_FULLY_VESTED, "total_claimed == total_supply");
    }

    // Mollusk 0.13 doesn't support Anchor's init_if_needed for PDA accounts
    #[ignore]
    #[test]
    fn test_cancel_stream_invalid_proof() {
        let mut mollusk = get_mollusk();
        let pid = program_id();

        mollusk.sysvars.clock.unix_timestamp = 1_000_000i64;

        let creator = Pubkey::new_unique();
        let beneficiary = Pubkey::new_unique();

        // Tree root is arbitrary, not matching the leaf hash
        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(valid_merkle_root())
            .leaf_count(1)
            .total_supply(1_000)
            .cancellable_with(creator)
            .funded_lamports(1_000 + 500_000)
            .build();

        let (cr_pda, _) = derive_claim_record_pda(&tree_pda, &beneficiary);

        let args = WithdrawArgs {
            release_type: 1,
            start_time: 0,
            cliff_time: 0,
            end_time: 2_000_000,
            milestone_idx: 0,
        };

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(beneficiary, false),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new(cr_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
            ],
            data: build_cancel_stream_ix_data(&args),
        };

        let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let beneficiary_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let cr_acc = Account::new(0, 0, &system_program_id());

        let accounts = vec![
            (creator, creator_acc),
            (beneficiary, beneficiary_acc),
            (tree_pda, tree_account),
            (cr_pda, cr_acc),
            system_program_account(),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_INVALID_PROOF, "leaf_hash != root");
    }
}
