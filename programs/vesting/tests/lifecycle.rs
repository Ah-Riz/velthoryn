//! End-to-end lifecycle integration tests for the vesting program.
//!
//! Tests full campaign lifecycle sequences across multiple instruction calls.
//! NOTE: Instructions that use `init_if_needed` (claim, withdraw, cancel_stream)
//! are not tested here because Mollusk 0.13 doesn't fully support that Anchor
//! constraint for PDA accounts. Those instructions are tested via unit/proptest
//! coverage of their core logic (merkle proofs, vesting math, bitmap checks).
//!
//! Run with:
//!   BPF_OUT_DIR=../../target/deploy cargo test --manifest-path programs/vesting/Cargo.toml --test lifecycle -- --show-output

mod test_helpers;

use test_helpers::*;

#[cfg(test)]
mod tests {
    use super::*;

    /// Lifecycle 1: create_campaign → pause → unpause → verify state
    #[test]
    fn test_lifecycle_create_pause_unpause() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let creator = Pubkey::new_unique();
        let pause_auth = Pubkey::new_unique();
        let campaign_id = 100u64;

        // --- Step 1: create_campaign_native ---
        let args = CreateCampaignArgs {
            campaign_id,
            merkle_root: valid_merkle_root(),
            leaf_count: 3,
            total_supply: 1_000_000_000,
            min_cliff_time: 1_000_000,
            cancellable: false,
            cancel_authority: None,
            pause_authority: Some(pause_auth),
        };

        let (tree_pda, _) = derive_vesting_tree_pda(&creator, &NATIVE_SOL_MINT, campaign_id);

        let create_ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
                AccountMeta::new_readonly(rent_sysvar_id(), false),
            ],
            data: build_ix_data("create_campaign_native", &args),
        };

        let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let create_accounts = vec![
            (creator, creator_acc),
            (tree_pda, Account::new(0, 0, &system_program_id())),
            system_program_account(),
            rent_sysvar_account(),
        ];

        let create_result = mollusk.process_instruction(&create_ix, &create_accounts);
        assert!(create_result.program_result.is_ok(), "create_campaign failed: {:?}", create_result.program_result);

        // Verify tree was created
        let tree_after_create = create_result.get_account(&tree_pda).expect("tree should exist");
        let tree_data = deserialize_vesting_tree(&tree_after_create.data);
        assert_eq!(tree_data.campaign_id, campaign_id);
        assert_eq!(tree_data.leaf_count, 3);
        assert_eq!(tree_data.total_supply, 1_000_000_000);
        assert!(!tree_data.paused);
        assert_eq!(tree_data.pause_authority, Some(pause_auth));

        // --- Step 2: Pause ---
        let pause_auth_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let pause_ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(pause_auth, true),
                AccountMeta::new(tree_pda, false),
            ],
            data: anchor_discriminator("pause_campaign").to_vec(),
        };

        let pause_accounts = vec![
            (pause_auth, pause_auth_acc),
            (tree_pda, tree_after_create.clone()),
        ];

        let pause_result = mollusk.process_instruction(&pause_ix, &pause_accounts);
        assert!(pause_result.program_result.is_ok(), "pause failed: {:?}", pause_result.program_result);

        let tree_paused = pause_result.get_account(&tree_pda).expect("tree after pause");
        let tree_data_paused = deserialize_vesting_tree(&tree_paused.data);
        assert!(tree_data_paused.paused, "tree should be paused");

        // --- Step 3: Unpause ---
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
        assert!(unpause_result.program_result.is_ok(), "unpause failed: {:?}", unpause_result.program_result);

        let tree_unpaused = unpause_result.get_account(&tree_pda).expect("tree after unpause");
        let tree_data_unpaused = deserialize_vesting_tree(&tree_unpaused.data);
        assert!(!tree_data_unpaused.paused, "tree should NOT be paused after unpause");

        println!("Lifecycle create→pause→unpause: OK");
    }

    /// Lifecycle 2: create (cancellable) → cancel_campaign → verify state
    #[test]
    fn test_lifecycle_cancel_campaign() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let creator = Pubkey::new_unique();
        let cancel_auth = Pubkey::new_unique();
        let campaign_id = 200u64;

        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, campaign_id)
            .total_supply(1_000_000)
            .total_claimed(100_000) // partially claimed
            .cancellable_with(cancel_auth)
            .funded_lamports(2_000_000)
            .build();

        // --- Step 1: cancel_campaign ---
        let cancel_ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(cancel_auth, true),
                AccountMeta::new(tree_pda, false),
            ],
            data: build_cancel_campaign_ix_data(),
        };

        let cancel_auth_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let cancel_accounts = vec![
            (cancel_auth, cancel_auth_acc),
            (tree_pda, tree_account),
        ];

        let cancel_result = mollusk.process_instruction(&cancel_ix, &cancel_accounts);
        assert!(cancel_result.program_result.is_ok(), "cancel_campaign failed: {:?}", cancel_result.program_result);

        // Verify cancelled state
        let tree_cancelled = cancel_result.get_account(&tree_pda).expect("tree after cancel");
        let tree_data = deserialize_vesting_tree(&tree_cancelled.data);
        assert!(tree_data.cancelled_at.is_some(), "tree should be cancelled");
        assert!(!tree_data.paused, "paused should be cleared");
        assert_eq!(tree_data.total_claimed, 100_000, "total_claimed unchanged");

        // --- Step 2: Try to pause cancelled campaign (should fail) ---
        let pause_auth = Pubkey::new_unique();
        // Rebuild tree with pause_authority + cancelled state
        let (tree_pda2, tree_account2, _) = TreeConfig::new(creator, campaign_id + 1)
            .total_supply(1_000_000)
            .total_claimed(100_000)
            .cancellable_with(cancel_auth)
            .pause_authority(Some(pause_auth))
            .cancelled_at(Some(-100_000))
            .funded_lamports(2_000_000)
            .build();

        let pause_ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(pause_auth, true),
                AccountMeta::new(tree_pda2, false),
            ],
            data: anchor_discriminator("pause_campaign").to_vec(),
        };

        let pause_auth_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let pause_accounts = vec![
            (pause_auth, pause_auth_acc),
            (tree_pda2, tree_account2),
        ];

        let pause_result = mollusk.process_instruction(&pause_ix, &pause_accounts);
        expect_error(&pause_result, ERR_CAMPAIGN_CANCELLED, "pause cancelled campaign");

        println!("Lifecycle cancel_campaign: OK");
    }

    /// Lifecycle 3: verify withdraw_unvested is blocked on active campaign
    /// NOTE: withdraw_unvested requires Optional SPL account handling (vault_authority,
    /// vault, creator_ata, token_program) that Mollusk 0.13 doesn't fully resolve for
    /// native SOL campaigns. The NotCancelled constraint is checked AFTER account
    /// resolution, so we can't reach it. Full E2E test via solana-test-validator.
    #[test]
    fn test_lifecycle_withdraw_unvested_limitation() {
        // This is a documentation test — the NotCancelled error is verified by the
        // program's constraint: `constraint = vesting_tree.cancelled_at.is_some() @ VestingError::NotCancelled`
        // The withdraw_unvested handler also checks GracePeriodActive.
        // These paths are covered by unit tests in the program's test suite.
        // Mollusk can't test them due to Optional account resolution limitations.
        println!("withdraw_unvested: requires solana-test-validator for full E2E (Mollusk 0.13 Optional<T> limitation)");
    }

    /// Lifecycle 4: set_milestone_released → verify flags updated
    #[test]
    fn test_lifecycle_set_milestone_released() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let creator = Pubkey::new_unique();

        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 400)
            .total_supply(1_000)
            .funded_lamports(2_000_000)
            .build();

        // --- Step 1: Set milestone 0 ---
        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(tree_pda, false),
            ],
            data: build_set_milestone_released_ix_data(0),
        };

        let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let accounts = vec![
            (creator, creator_acc),
            (tree_pda, tree_account),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        assert!(result.program_result.is_ok(), "set_milestone_released failed: {:?}", result.program_result);

        let tree_after = result.get_account(&tree_pda).expect("tree after milestone");
        let tree_data = deserialize_vesting_tree(&tree_after.data);
        assert_eq!(tree_data.milestone_released_flags[0], 1, "milestone 0 flag should be set");
        assert_eq!(tree_data.milestone_released_flags[1], 0, "other flags should be zero");

        // --- Step 2: Set milestone 5 (byte 0 bit 5) ---
        let ix2 = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(tree_pda, false),
            ],
            data: build_set_milestone_released_ix_data(5),
        };

        let accounts2 = result.resulting_accounts.clone();
        let result2 = mollusk.process_instruction(&ix2, &accounts2);
        assert!(result2.program_result.is_ok(), "set milestone 5 failed: {:?}", result2.program_result);

        let tree_after2 = result2.get_account(&tree_pda).expect("tree after milestone 5");
        let tree_data2 = deserialize_vesting_tree(&tree_after2.data);
        // byte 0 should have bits 0 and 5 set = 0b00100001 = 33
        assert_eq!(tree_data2.milestone_released_flags[0], 0b00100001,
            "byte 0 should have bits 0 and 5 set");

        // --- Step 3: Try setting milestone 0 again (already released) ---
        let ix3 = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(tree_pda, false),
            ],
            data: build_set_milestone_released_ix_data(0),
        };

        let accounts3 = result2.resulting_accounts.clone();
        let result3 = mollusk.process_instruction(&ix3, &accounts3);
        expect_error(&result3, ERR_MILESTONE_ALREADY_RELEASED, "duplicate milestone release");

        println!("Lifecycle milestone_released: OK");
    }

    /// Lifecycle 5: update_root → verify new root, leaf_count, min_cliff_time
    #[test]
    fn test_lifecycle_update_root() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let creator = Pubkey::new_unique();
        let cancel_auth = Pubkey::new_unique();

        let old_root = valid_merkle_root();
        let mut new_root = [0u8; 32];
        new_root[0] = 0x42;

        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 500)
            .merkle_root(old_root)
            .total_supply(1_000_000)
            .cancellable_with(cancel_auth)
            .funded_lamports(2_000_000)
            .build();

        // --- Step 1: update_root ---
        let update_ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(cancel_auth, true),
                AccountMeta::new(tree_pda, false),
            ],
            data: build_update_root_ix_data(new_root, 10, 2_000_000),
        };

        let cancel_auth_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let accounts = vec![
            (cancel_auth, cancel_auth_acc),
            (tree_pda, tree_account),
        ];

        let result = mollusk.process_instruction(&update_ix, &accounts);
        assert!(result.program_result.is_ok(), "update_root failed: {:?}", result.program_result);

        let tree_after = result.get_account(&tree_pda).expect("tree after update");
        let tree_data = deserialize_vesting_tree(&tree_after.data);
        assert_eq!(tree_data.merkle_root, new_root, "merkle_root should be updated");
        assert_eq!(tree_data.leaf_count, 10, "leaf_count should be updated");
        assert_eq!(tree_data.min_cliff_time, 2_000_000, "min_cliff_time should be updated");
        // total_claimed should NOT be reset
        assert_eq!(tree_data.total_claimed, 0, "total_claimed should be unchanged");

        // --- Step 2: Try update_root with same root (should fail) ---
        let update_ix2 = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(cancel_auth, true),
                AccountMeta::new(tree_pda, false),
            ],
            data: build_update_root_ix_data(new_root, 10, 2_000_000),
        };

        let accounts2 = result.resulting_accounts.clone();
        let result2 = mollusk.process_instruction(&update_ix2, &accounts2);
        expect_error(&result2, ERR_SAME_ROOT, "update with same root");

        println!("Lifecycle update_root: OK");
    }

    /// Lifecycle 6: fund_campaign_native → verify lamport increase
    #[test]
    fn test_lifecycle_fund_campaign_native() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let creator = Pubkey::new_unique();

        let rent_reserve = 500_000u64;
        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 600)
            .total_supply(1_000_000)
            .funded_lamports(rent_reserve) // start with just rent
            .build();

        let fund_amount = 500_000u64;

        let fund_ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
            ],
            data: build_fund_campaign_native_ix_data(fund_amount),
        };

        let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let accounts = vec![
            (creator, creator_acc),
            (tree_pda, tree_account),
            system_program_account(),
        ];

        let result = mollusk.process_instruction(&fund_ix, &accounts);
        assert!(result.program_result.is_ok(), "fund_campaign_native failed: {:?}", result.program_result);

        // Verify tree PDA lamports increased
        let tree_after = result.get_account(&tree_pda).expect("tree after fund");
        assert_eq!(tree_after.lamports, rent_reserve + fund_amount,
            "tree PDA should have rent + fund_amount lamports");

        // --- Step 2: Try over-funding (exceeds total_supply) ---
        // funded = rent_reserve + 500k - rent_minimum ≈ 500k (since rent_minimum is ~350k for tree data)
        // Adding 600k would exceed 1M total_supply. But we need to account for rent.
        // Let's fund most of total_supply first, then try to overfund.
        let overfund_ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
            ],
            data: build_fund_campaign_native_ix_data(1_000_000_000), // way over total_supply
        };

        let creator_acc2 = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let accounts2 = vec![
            (creator, creator_acc2),
            (tree_pda, tree_after.clone()),
            system_program_account(),
        ];

        let result2 = mollusk.process_instruction(&overfund_ix, &accounts2);
        expect_error(&result2, ERR_OVER_FUNDED, "over-fund campaign");

        println!("Lifecycle fund_campaign_native: OK");
    }

    /// Lifecycle 7: create_stream_native → verify tree + lamports
    #[test]
    fn test_lifecycle_create_stream_native() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let creator = Pubkey::new_unique();
        let beneficiary = Pubkey::new_unique();

        let stream_amount = 1_000_000_000u64;
        let args = CreateStreamArgs {
            campaign_id: 700,
            beneficiary,
            amount: stream_amount,
            release_type: 1, // Linear
            start_time: 0,
            cliff_time: 0,
            end_time: 2_000_000,
            milestone_idx: 0,
            cancellable: false,
            cancel_authority: None,
            pause_authority: None,
        };

        let (tree_pda, _) = derive_vesting_tree_pda(&creator, &NATIVE_SOL_MINT, args.campaign_id);

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

        let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let accounts = vec![
            (creator, creator_acc),
            (tree_pda, Account::new(0, 0, &system_program_id())),
            system_program_account(),
            rent_sysvar_account(),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        assert!(result.program_result.is_ok(), "create_stream_native failed: {:?}", result.program_result);

        // Verify tree fields
        let tree_after = result.get_account(&tree_pda).expect("tree after stream");
        let tree_data = deserialize_vesting_tree(&tree_after.data);
        assert_eq!(tree_data.leaf_count, 1, "leaf_count should be 1");
        assert_eq!(tree_data.total_supply, stream_amount, "total_supply should be stream amount");
        assert_eq!(tree_data.total_claimed, 0);
        assert_eq!(tree_data.creator, creator);
        assert_eq!(tree_data.mint, NATIVE_SOL_MINT);

        // Verify PDA has lamports (rent + stream amount)
        assert!(tree_after.lamports >= stream_amount,
            "tree PDA should have at least stream_amount lamports, got {}", tree_after.lamports);

        // Verify creator was charged
        let creator_after = result.get_account(&creator).expect("creator after stream");
        assert!(creator_after.lamports < CREATOR_LAMPORTS, "creator should have been charged");

        println!(
            "Lifecycle create_stream_native: tree lamports={}, creator spent={}",
            tree_after.lamports,
            CREATOR_LAMPORTS - creator_after.lamports,
        );
    }

    /// Lifecycle 8: close_claim_record for fully claimed record
    #[test]
    fn test_lifecycle_close_claim_record() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let creator = Pubkey::new_unique();
        let beneficiary = Pubkey::new_unique();

        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 800)
            .total_supply(1_000)
            .total_claimed(1_000) // fully claimed
            .funded_lamports(0)
            .build();

        // Pre-create claim record with claimed_amount == total_entitled
        let (cr_pda, cr_account) = ClaimRecordConfig::new(beneficiary, tree_pda)
            .claimed_amount(500)
            .total_entitled(500)
            .build();

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(beneficiary, true),
                AccountMeta::new_readonly(tree_pda, false),
                AccountMeta::new(cr_pda, false),
            ],
            data: build_close_claim_record_ix_data(),
        };

        let b_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let accounts = vec![
            (beneficiary, b_acc),
            (tree_pda, tree_account),
            (cr_pda, cr_account),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        assert!(result.program_result.is_ok(), "close_claim_record failed: {:?}", result.program_result);

        // Beneficiary should have received rent from the closed account
        let b_after = result.get_account(&beneficiary).expect("beneficiary after close");
        assert!(b_after.lamports > CREATOR_LAMPORTS, "beneficiary should have received rent lamports");

        println!("Lifecycle close_claim_record: OK");
    }
}
