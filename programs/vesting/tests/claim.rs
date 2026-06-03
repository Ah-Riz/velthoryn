//! Mollusk instruction-level tests for the `claim` instruction (native SOL).
//!
//! NOTE: Mollusk 0.13 does not fully support `init_if_needed` CPI for PDA accounts.
//! All claim tests pre-create the ClaimRecord via `ClaimRecordConfig` to bypass this.
//!
//! Run with:
//!   BPF_OUT_DIR=../../target/deploy cargo test --manifest-path programs/vesting/Cargo.toml --test claim -- --show-output

mod test_helpers;

use test_helpers::*;

// ---------------------------------------------------------------------------
// Claim-specific account helpers
// ---------------------------------------------------------------------------

/// Build the full 10-account `AccountMeta` list for a native SOL `claim` instruction.
/// Optional accounts use `Pubkey::default()` (zero key) to indicate `None`.
/// These zero-keyed accounts must NOT be included in the Mollusk accounts list,
/// because Anchor treats missing accounts for `Option<T>` fields as `None`.
fn claim_ix_accounts(beneficiary: Pubkey, tree_pda: Pubkey, cr_pda: Pubkey) -> Vec<AccountMeta> {
    vec![
        AccountMeta::new(beneficiary, true),
        AccountMeta::new(tree_pda, false),
        AccountMeta::new(cr_pda, false),
        // Positions 4-9: optional accounts — zero pubkey means None in Anchor
        AccountMeta::new_readonly(Pubkey::default(), false), // vault_authority
        AccountMeta::new_readonly(Pubkey::default(), false), // vault
        AccountMeta::new_readonly(Pubkey::default(), false), // beneficiary_ata
        AccountMeta::new_readonly(Pubkey::default(), false), // mint
        AccountMeta::new_readonly(Pubkey::default(), false), // token_program
        AccountMeta::new_readonly(Pubkey::default(), false), // associated_token_program
        // Position 10: system_program (required, non-optional)
        AccountMeta::new_readonly(system_program_id(), false),
    ]
}

/// Build the Mollusk accounts list for a native SOL claim.
/// Only includes the 4 real accounts; zero-keyed optional accounts are omitted
/// so Anchor treats them as None.
fn claim_mollusk_accounts(
    beneficiary: Pubkey,
    beneficiary_lamports: u64,
    tree_pda: Pubkey,
    tree_account: Account,
    cr_pda: Pubkey,
    cr_account: Account,
) -> Vec<(Pubkey, Account)> {
    let beneficiary_acc = Account::new(beneficiary_lamports, 0, &system_program_id());
    vec![
        (beneficiary, beneficiary_acc),
        (tree_pda, tree_account),
        (cr_pda, cr_account),
        system_program_account(),
    ]
}

// ===========================================================================
// claim -- native SOL tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // =====================================================================
    // Happy-path tests
    // =====================================================================

    #[test]
    fn test_claim_happy_path() {
        let mut mollusk = get_mollusk();
        let pid = program_id();

        // Set clock to end_time so the leaf is fully vested
        mollusk.sysvars.clock.unix_timestamp = 2_000_000i64;

        let beneficiary = Pubkey::new_unique();
        let other_beneficiary = Pubkey::new_unique();
        let leaves = vec![
            VestingLeaf {
                leaf_index: 0,
                beneficiary,
                amount: 1_000,
                release_type: 1, // Linear
                start_time: 0,
                cliff_time: 0,
                end_time: 2_000_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 1,
                beneficiary: other_beneficiary,
                amount: 500,
                release_type: 0, // Cliff
                start_time: 0,
                cliff_time: 1_000,
                end_time: 2_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 2,
                beneficiary: Pubkey::new_unique(),
                amount: 300,
                release_type: 1, // Linear
                start_time: 0,
                cliff_time: 0,
                end_time: 1_000_000,
                milestone_idx: 0,
            },
        ];
        let (root, proofs) = build_merkle_tree(&leaves);
        let proof = &proofs[0].1;

        let creator = Pubkey::new_unique();
        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(root)
            .leaf_count(3)
            .total_supply(1_800)
            .funded_lamports(1_800 + 500_000)
            .build();

        let (cr_pda, cr_account) = ClaimRecordConfig::new(beneficiary, tree_pda)
            .total_entitled(leaves[0].amount)
            .build();

        let ix = Instruction {
            program_id: pid,
            accounts: claim_ix_accounts(beneficiary, tree_pda, cr_pda),
            data: build_claim_ix_data(&leaves[0], proof),
        };

        let accounts = claim_mollusk_accounts(
            beneficiary, CREATOR_LAMPORTS, tree_pda, tree_account, cr_pda, cr_account,
        );

        let result = mollusk.process_instruction(&ix, &accounts);

        assert!(
            result.program_result.is_ok(),
            "Expected success but got: {:?}",
            result.program_result
        );
        println!("claim happy path cu={}", result.compute_units_consumed);

        // Verify tree total_claimed updated
        let tree_acc = result.get_account(&tree_pda).unwrap();
        let tree_data = deserialize_vesting_tree(&tree_acc.data);
        assert_eq!(tree_data.total_claimed, 1_000);

        // Verify claim record updated
        let cr_acc = result.get_account(&cr_pda).unwrap();
        let cr_data = deserialize_claim_record(&cr_acc.data);
        assert_eq!(cr_data.claimed_amount, 1_000);
        assert_eq!(cr_data.total_entitled, 1_000);

        // Verify beneficiary received lamports
        let ben_acc = result.get_account(&beneficiary).unwrap();
        assert_eq!(ben_acc.lamports, CREATOR_LAMPORTS + 1_000);
    }

    #[test]
    fn test_claim_partial() {
        let mut mollusk = get_mollusk();
        let pid = program_id();

        // Set clock to midpoint
        mollusk.sysvars.clock.unix_timestamp = 1_000_000i64;

        let beneficiary = Pubkey::new_unique();
        let leaves = vec![
            VestingLeaf {
                leaf_index: 0,
                beneficiary,
                amount: 1_000,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 2_000_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 1,
                beneficiary: Pubkey::new_unique(),
                amount: 500,
                release_type: 0,
                start_time: 0,
                cliff_time: 1_000,
                end_time: 2_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 2,
                beneficiary: Pubkey::new_unique(),
                amount: 300,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 1_000_000,
                milestone_idx: 0,
            },
        ];
        let (root, proofs) = build_merkle_tree(&leaves);
        let proof = &proofs[0].1;

        let creator = Pubkey::new_unique();
        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(root)
            .leaf_count(3)
            .total_supply(1_800)
            .funded_lamports(1_800 + 500_000)
            .build();

        let (cr_pda, cr_account) = ClaimRecordConfig::new(beneficiary, tree_pda)
            .total_entitled(leaves[0].amount)
            .build();

        let ix = Instruction {
            program_id: pid,
            accounts: claim_ix_accounts(beneficiary, tree_pda, cr_pda),
            data: build_claim_ix_data(&leaves[0], proof),
        };

        let accounts = claim_mollusk_accounts(
            beneficiary, CREATOR_LAMPORTS, tree_pda, tree_account, cr_pda, cr_account,
        );

        let result = mollusk.process_instruction(&ix, &accounts);
        assert!(result.program_result.is_ok(), "Expected success: {:?}", result.program_result);

        let tree_acc = result.get_account(&tree_pda).unwrap();
        let tree_data = deserialize_vesting_tree(&tree_acc.data);
        assert_eq!(tree_data.total_claimed, 500, "50% of 1000 = 500");

        let cr_acc = result.get_account(&cr_pda).unwrap();
        let cr_data = deserialize_claim_record(&cr_acc.data);
        assert_eq!(cr_data.claimed_amount, 500);

        let ben_acc = result.get_account(&beneficiary).unwrap();
        assert_eq!(ben_acc.lamports, CREATOR_LAMPORTS + 500);
    }

    // =====================================================================
    // Double-claim / noop tests
    // =====================================================================

    #[test]
    fn test_claim_double_noop() {
        let mut mollusk = get_mollusk();
        let pid = program_id();

        mollusk.sysvars.clock.unix_timestamp = 2_000_000i64;

        let beneficiary = Pubkey::new_unique();
        let leaves = vec![
            VestingLeaf {
                leaf_index: 0,
                beneficiary,
                amount: 1_000,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 2_000_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 1,
                beneficiary: Pubkey::new_unique(),
                amount: 500,
                release_type: 0,
                start_time: 0,
                cliff_time: 1_000,
                end_time: 2_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 2,
                beneficiary: Pubkey::new_unique(),
                amount: 300,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 1_000_000,
                milestone_idx: 0,
            },
        ];
        let (root, proofs) = build_merkle_tree(&leaves);
        let proof = &proofs[0].1;

        let creator = Pubkey::new_unique();
        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(root)
            .leaf_count(3)
            .total_supply(1_800)
            .funded_lamports(1_800 + 500_000)
            .build();

        let (cr_pda, cr_account) = ClaimRecordConfig::new(beneficiary, tree_pda)
            .total_entitled(leaves[0].amount)
            .build();

        let ix = Instruction {
            program_id: pid,
            accounts: claim_ix_accounts(beneficiary, tree_pda, cr_pda),
            data: build_claim_ix_data(&leaves[0], proof),
        };

        let accounts = claim_mollusk_accounts(
            beneficiary, CREATOR_LAMPORTS, tree_pda, tree_account, cr_pda, cr_account,
        );

        // First claim should succeed
        let result1 = mollusk.process_instruction(&ix, &accounts);
        assert!(result1.program_result.is_ok(), "First claim should succeed");

        // Second claim: fully claimed at/past end_time => StreamExpired
        let result2 = mollusk.process_instruction(&ix, &result1.resulting_accounts);
        assert!(result2.program_result.is_err(), "Second claim should fail");
        expect_error(&result2, ERR_STREAM_EXPIRED, "second claim fully vested");
    }

    // =====================================================================
    // Authorization & validation tests
    // =====================================================================

    #[test]
    fn test_claim_unauthorized_claimer() {
        let mut mollusk = get_mollusk();
        let pid = program_id();

        mollusk.sysvars.clock.unix_timestamp = 2_000_000i64;

        let beneficiary = Pubkey::new_unique();
        let impostor = Pubkey::new_unique();
        let leaves = vec![
            VestingLeaf {
                leaf_index: 0,
                beneficiary,
                amount: 1_000,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 2_000_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 1,
                beneficiary: Pubkey::new_unique(),
                amount: 500,
                release_type: 0,
                start_time: 0,
                cliff_time: 1_000,
                end_time: 2_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 2,
                beneficiary: Pubkey::new_unique(),
                amount: 300,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 1_000_000,
                milestone_idx: 0,
            },
        ];
        let (root, proofs) = build_merkle_tree(&leaves);
        let proof = &proofs[0].1;

        let creator = Pubkey::new_unique();
        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(root)
            .leaf_count(3)
            .total_supply(1_800)
            .funded_lamports(1_800 + 500_000)
            .build();

        // CR PDA derived for impostor (the signer), not the leaf's beneficiary
        let (cr_pda, cr_account) = ClaimRecordConfig::new(impostor, tree_pda)
            .total_entitled(leaves[0].amount)
            .build();

        let ix = Instruction {
            program_id: pid,
            accounts: claim_ix_accounts(impostor, tree_pda, cr_pda),
            data: build_claim_ix_data(&leaves[0], proof),
        };

        let accounts = claim_mollusk_accounts(
            impostor, CREATOR_LAMPORTS, tree_pda, tree_account, cr_pda, cr_account,
        );

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_UNAUTHORIZED_CLAIMER, "wrong beneficiary signs");
    }

    #[test]
    fn test_claim_invalid_proof() {
        let mut mollusk = get_mollusk();
        let pid = program_id();

        mollusk.sysvars.clock.unix_timestamp = 2_000_000i64;

        let beneficiary = Pubkey::new_unique();
        let leaves = vec![
            VestingLeaf {
                leaf_index: 0,
                beneficiary,
                amount: 1_000,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 2_000_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 1,
                beneficiary: Pubkey::new_unique(),
                amount: 500,
                release_type: 0,
                start_time: 0,
                cliff_time: 1_000,
                end_time: 2_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 2,
                beneficiary: Pubkey::new_unique(),
                amount: 300,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 1_000_000,
                milestone_idx: 0,
            },
        ];
        let (root, _proofs) = build_merkle_tree(&leaves);

        // Tamper the root
        let creator = Pubkey::new_unique();
        let mut bad_root = root;
        bad_root[0] ^= 0xFF;

        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(bad_root)
            .leaf_count(3)
            .total_supply(1_800)
            .funded_lamports(1_800 + 500_000)
            .build();

        let (cr_pda, cr_account) = ClaimRecordConfig::new(beneficiary, tree_pda)
            .total_entitled(leaves[0].amount)
            .build();

        // Valid proof for real root (won't verify against bad_root)
        let (_, proofs) = build_merkle_tree(&leaves);
        let proof = &proofs[0].1;

        let ix = Instruction {
            program_id: pid,
            accounts: claim_ix_accounts(beneficiary, tree_pda, cr_pda),
            data: build_claim_ix_data(&leaves[0], proof),
        };

        let accounts = claim_mollusk_accounts(
            beneficiary, CREATOR_LAMPORTS, tree_pda, tree_account, cr_pda, cr_account,
        );

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_INVALID_PROOF, "tampered root");
    }

    #[test]
    fn test_claim_invalid_schedule_start_gt_cliff() {
        let mut mollusk = get_mollusk();
        let pid = program_id();

        mollusk.sysvars.clock.unix_timestamp = 2_000_000i64;

        let beneficiary = Pubkey::new_unique();
        let leaves = vec![
            VestingLeaf {
                leaf_index: 0,
                beneficiary,
                amount: 1_000,
                release_type: 1,
                start_time: 100, // start > cliff
                cliff_time: 50,
                end_time: 2_000_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 1,
                beneficiary: Pubkey::new_unique(),
                amount: 500,
                release_type: 0,
                start_time: 0,
                cliff_time: 1_000,
                end_time: 2_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 2,
                beneficiary: Pubkey::new_unique(),
                amount: 300,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 1_000_000,
                milestone_idx: 0,
            },
        ];
        let (root, proofs) = build_merkle_tree(&leaves);
        let proof = &proofs[0].1;

        let creator = Pubkey::new_unique();
        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(root)
            .leaf_count(3)
            .total_supply(1_800)
            .funded_lamports(1_800 + 500_000)
            .build();

        let (cr_pda, cr_account) = ClaimRecordConfig::new(beneficiary, tree_pda)
            .total_entitled(leaves[0].amount)
            .build();

        let ix = Instruction {
            program_id: pid,
            accounts: claim_ix_accounts(beneficiary, tree_pda, cr_pda),
            data: build_claim_ix_data(&leaves[0], proof),
        };

        let accounts = claim_mollusk_accounts(
            beneficiary, CREATOR_LAMPORTS, tree_pda, tree_account, cr_pda, cr_account,
        );

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_INVALID_SCHEDULE, "start > cliff");
    }

    #[test]
    fn test_claim_invalid_schedule_cliff_gt_end() {
        let mut mollusk = get_mollusk();
        let pid = program_id();

        mollusk.sysvars.clock.unix_timestamp = 2_000_000i64;

        let beneficiary = Pubkey::new_unique();
        let leaves = vec![
            VestingLeaf {
                leaf_index: 0,
                beneficiary,
                amount: 1_000,
                release_type: 1,
                start_time: 0,
                cliff_time: 5_000_000, // cliff > end
                end_time: 2_000_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 1,
                beneficiary: Pubkey::new_unique(),
                amount: 500,
                release_type: 0,
                start_time: 0,
                cliff_time: 1_000,
                end_time: 2_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 2,
                beneficiary: Pubkey::new_unique(),
                amount: 300,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 1_000_000,
                milestone_idx: 0,
            },
        ];
        let (root, proofs) = build_merkle_tree(&leaves);
        let proof = &proofs[0].1;

        let creator = Pubkey::new_unique();
        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(root)
            .leaf_count(3)
            .total_supply(1_800)
            .funded_lamports(1_800 + 500_000)
            .build();

        let (cr_pda, cr_account) = ClaimRecordConfig::new(beneficiary, tree_pda)
            .total_entitled(leaves[0].amount)
            .build();

        let ix = Instruction {
            program_id: pid,
            accounts: claim_ix_accounts(beneficiary, tree_pda, cr_pda),
            data: build_claim_ix_data(&leaves[0], proof),
        };

        let accounts = claim_mollusk_accounts(
            beneficiary, CREATOR_LAMPORTS, tree_pda, tree_account, cr_pda, cr_account,
        );

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_INVALID_SCHEDULE, "cliff > end");
    }

    #[test]
    fn test_claim_invalid_schedule_type() {
        let mut mollusk = get_mollusk();
        let pid = program_id();

        mollusk.sysvars.clock.unix_timestamp = 2_000_000i64;

        let beneficiary = Pubkey::new_unique();
        let leaves = vec![
            VestingLeaf {
                leaf_index: 0,
                beneficiary,
                amount: 1_000,
                release_type: 3, // Invalid
                start_time: 0,
                cliff_time: 0,
                end_time: 2_000_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 1,
                beneficiary: Pubkey::new_unique(),
                amount: 500,
                release_type: 0,
                start_time: 0,
                cliff_time: 1_000,
                end_time: 2_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 2,
                beneficiary: Pubkey::new_unique(),
                amount: 300,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 1_000_000,
                milestone_idx: 0,
            },
        ];
        let (root, proofs) = build_merkle_tree(&leaves);
        let proof = &proofs[0].1;

        let creator = Pubkey::new_unique();
        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(root)
            .leaf_count(3)
            .total_supply(1_800)
            .funded_lamports(1_800 + 500_000)
            .build();

        let (cr_pda, cr_account) = ClaimRecordConfig::new(beneficiary, tree_pda)
            .total_entitled(leaves[0].amount)
            .build();

        let ix = Instruction {
            program_id: pid,
            accounts: claim_ix_accounts(beneficiary, tree_pda, cr_pda),
            data: build_claim_ix_data(&leaves[0], proof),
        };

        let accounts = claim_mollusk_accounts(
            beneficiary, CREATOR_LAMPORTS, tree_pda, tree_account, cr_pda, cr_account,
        );

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_INVALID_SCHEDULE_TYPE, "release_type=3");
    }

    #[test]
    fn test_claim_proof_too_long() {
        let mut mollusk = get_mollusk();
        let pid = program_id();

        mollusk.sysvars.clock.unix_timestamp = 2_000_000i64;

        let beneficiary = Pubkey::new_unique();
        let leaves = vec![
            VestingLeaf {
                leaf_index: 0,
                beneficiary,
                amount: 1_000,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 2_000_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 1,
                beneficiary: Pubkey::new_unique(),
                amount: 500,
                release_type: 0,
                start_time: 0,
                cliff_time: 1_000,
                end_time: 2_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 2,
                beneficiary: Pubkey::new_unique(),
                amount: 300,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 1_000_000,
                milestone_idx: 0,
            },
        ];
        let (root, _proofs) = build_merkle_tree(&leaves);

        let creator = Pubkey::new_unique();
        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(root)
            .leaf_count(3)
            .total_supply(1_800)
            .funded_lamports(1_800 + 500_000)
            .build();

        let (cr_pda, cr_account) = ClaimRecordConfig::new(beneficiary, tree_pda)
            .total_entitled(leaves[0].amount)
            .build();

        // 33-element proof (MAX_MERKLE_PROOF_LEN + 1)
        let oversized_proof: Vec<[u8; 32]> = (0..33).map(|i| {
            let mut hash = [0u8; 32];
            hash[0] = i;
            hash
        }).collect();

        let ix = Instruction {
            program_id: pid,
            accounts: claim_ix_accounts(beneficiary, tree_pda, cr_pda),
            data: build_claim_ix_data(&leaves[0], &oversized_proof),
        };

        let accounts = claim_mollusk_accounts(
            beneficiary, CREATOR_LAMPORTS, tree_pda, tree_account, cr_pda, cr_account,
        );

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_PROOF_TOO_LONG, "33-element proof");
    }

    #[test]
    fn test_claim_campaign_paused() {
        let mut mollusk = get_mollusk();
        let pid = program_id();

        mollusk.sysvars.clock.unix_timestamp = 2_000_000i64;

        let beneficiary = Pubkey::new_unique();
        let leaves = vec![
            VestingLeaf {
                leaf_index: 0,
                beneficiary,
                amount: 1_000,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 2_000_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 1,
                beneficiary: Pubkey::new_unique(),
                amount: 500,
                release_type: 0,
                start_time: 0,
                cliff_time: 1_000,
                end_time: 2_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 2,
                beneficiary: Pubkey::new_unique(),
                amount: 300,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 1_000_000,
                milestone_idx: 0,
            },
        ];
        let (root, proofs) = build_merkle_tree(&leaves);
        let proof = &proofs[0].1;

        let creator = Pubkey::new_unique();
        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(root)
            .leaf_count(3)
            .total_supply(1_800)
            .paused(true)
            .cancelled_at(None)
            .funded_lamports(1_800 + 500_000)
            .build();

        let (cr_pda, cr_account) = ClaimRecordConfig::new(beneficiary, tree_pda)
            .total_entitled(leaves[0].amount)
            .build();

        let ix = Instruction {
            program_id: pid,
            accounts: claim_ix_accounts(beneficiary, tree_pda, cr_pda),
            data: build_claim_ix_data(&leaves[0], proof),
        };

        let accounts = claim_mollusk_accounts(
            beneficiary, CREATOR_LAMPORTS, tree_pda, tree_account, cr_pda, cr_account,
        );

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_CAMPAIGN_PAUSED, "paused=true, cancelled_at=None");
    }

    #[test]
    fn test_claim_instant_refunded() {
        let mut mollusk = get_mollusk();
        let pid = program_id();

        mollusk.sysvars.clock.unix_timestamp = 2_000_000i64;

        let beneficiary = Pubkey::new_unique();
        let leaves = vec![
            VestingLeaf {
                leaf_index: 0,
                beneficiary,
                amount: 1_000,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 2_000_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 1,
                beneficiary: Pubkey::new_unique(),
                amount: 500,
                release_type: 0,
                start_time: 0,
                cliff_time: 1_000,
                end_time: 2_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 2,
                beneficiary: Pubkey::new_unique(),
                amount: 300,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 1_000_000,
                milestone_idx: 0,
            },
        ];
        let (root, proofs) = build_merkle_tree(&leaves);
        let proof = &proofs[0].1;

        let creator = Pubkey::new_unique();
        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(root)
            .leaf_count(3)
            .total_supply(1_800)
            .instant_refunded(true)
            .funded_lamports(1_800 + 500_000)
            .build();

        let (cr_pda, cr_account) = ClaimRecordConfig::new(beneficiary, tree_pda)
            .total_entitled(leaves[0].amount)
            .build();

        let ix = Instruction {
            program_id: pid,
            accounts: claim_ix_accounts(beneficiary, tree_pda, cr_pda),
            data: build_claim_ix_data(&leaves[0], proof),
        };

        let accounts = claim_mollusk_accounts(
            beneficiary, CREATOR_LAMPORTS, tree_pda, tree_account, cr_pda, cr_account,
        );

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_INSTANT_REFUNDED, "instant_refunded=true");
    }

    #[test]
    fn test_claim_nothing_to_claim_before_cliff() {
        let mollusk = get_mollusk();
        let pid = program_id();

        // Default clock: unix_timestamp = 0. Cliff is at 1_000_000, nothing vested.
        let beneficiary = Pubkey::new_unique();
        let leaves = vec![
            VestingLeaf {
                leaf_index: 0,
                beneficiary,
                amount: 1_000,
                release_type: 1,
                start_time: 0,
                cliff_time: 1_000_000,
                end_time: 2_000_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 1,
                beneficiary: Pubkey::new_unique(),
                amount: 500,
                release_type: 0,
                start_time: 0,
                cliff_time: 1_000,
                end_time: 2_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 2,
                beneficiary: Pubkey::new_unique(),
                amount: 300,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 1_000_000,
                milestone_idx: 0,
            },
        ];
        let (root, proofs) = build_merkle_tree(&leaves);
        let proof = &proofs[0].1;

        let creator = Pubkey::new_unique();
        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(root)
            .leaf_count(3)
            .total_supply(1_800)
            .funded_lamports(1_800 + 500_000)
            .build();

        let (cr_pda, cr_account) = ClaimRecordConfig::new(beneficiary, tree_pda)
            .total_entitled(leaves[0].amount)
            .build();

        let ix = Instruction {
            program_id: pid,
            accounts: claim_ix_accounts(beneficiary, tree_pda, cr_pda),
            data: build_claim_ix_data(&leaves[0], proof),
        };

        let accounts = claim_mollusk_accounts(
            beneficiary, CREATOR_LAMPORTS, tree_pda, tree_account, cr_pda, cr_account,
        );

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_NOTHING_TO_CLAIM, "before cliff");
    }

    // =====================================================================
    // Milestone tests
    // =====================================================================

    #[test]
    fn test_claim_milestone_not_released() {
        let mut mollusk = get_mollusk();
        let pid = program_id();

        mollusk.sysvars.clock.unix_timestamp = 2_000_000i64;

        let beneficiary = Pubkey::new_unique();
        let leaves = vec![
            VestingLeaf {
                leaf_index: 0,
                beneficiary,
                amount: 1_000,
                release_type: 2, // Milestone
                start_time: 0,
                cliff_time: 0,
                end_time: 2_000_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 1,
                beneficiary: Pubkey::new_unique(),
                amount: 500,
                release_type: 0,
                start_time: 0,
                cliff_time: 1_000,
                end_time: 2_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 2,
                beneficiary: Pubkey::new_unique(),
                amount: 300,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 1_000_000,
                milestone_idx: 0,
            },
        ];
        let (root, proofs) = build_merkle_tree(&leaves);
        let proof = &proofs[0].1;

        let creator = Pubkey::new_unique();
        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(root)
            .leaf_count(3)
            .total_supply(1_800)
            .funded_lamports(1_800 + 500_000)
            .build();

        let (cr_pda, cr_account) = ClaimRecordConfig::new(beneficiary, tree_pda)
            .total_entitled(leaves[0].amount)
            .build();

        let ix = Instruction {
            program_id: pid,
            accounts: claim_ix_accounts(beneficiary, tree_pda, cr_pda),
            data: build_claim_ix_data(&leaves[0], proof),
        };

        let accounts = claim_mollusk_accounts(
            beneficiary, CREATOR_LAMPORTS, tree_pda, tree_account, cr_pda, cr_account,
        );

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_MILESTONE_NOT_RELEASED, "milestone flag not set");
    }

    #[test]
    fn test_claim_milestone_already_claimed() {
        let mut mollusk = get_mollusk();
        let pid = program_id();

        mollusk.sysvars.clock.unix_timestamp = 2_000_000i64;

        let beneficiary = Pubkey::new_unique();
        let leaves = vec![
            VestingLeaf {
                leaf_index: 0,
                beneficiary,
                amount: 1_000,
                release_type: 2, // Milestone
                start_time: 0,
                cliff_time: 0,
                end_time: 2_000_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 1,
                beneficiary: Pubkey::new_unique(),
                amount: 500,
                release_type: 0,
                start_time: 0,
                cliff_time: 1_000,
                end_time: 2_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 2,
                beneficiary: Pubkey::new_unique(),
                amount: 300,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 1_000_000,
                milestone_idx: 0,
            },
        ];
        let (root, proofs) = build_merkle_tree(&leaves);
        let proof = &proofs[0].1;

        let creator = Pubkey::new_unique();
        let mut flags = [0u8; 32];
        flags[0] = 0x01; // Set milestone 0 as released

        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(root)
            .leaf_count(3)
            .total_supply(1_800)
            .milestone_released_flags(flags)
            .funded_lamports(1_800 + 500_000)
            .build();

        let (cr_pda, cr_account) = ClaimRecordConfig::new(beneficiary, tree_pda)
            .total_entitled(leaves[0].amount)
            .build();

        let ix = Instruction {
            program_id: pid,
            accounts: claim_ix_accounts(beneficiary, tree_pda, cr_pda),
            data: build_claim_ix_data(&leaves[0], proof),
        };

        let accounts = claim_mollusk_accounts(
            beneficiary, CREATOR_LAMPORTS, tree_pda, tree_account, cr_pda, cr_account,
        );

        // First claim should succeed (milestone is released, bitmap bit is clear)
        let result1 = mollusk.process_instruction(&ix, &accounts);
        assert!(
            result1.program_result.is_ok(),
            "First milestone claim should succeed: {:?}",
            result1.program_result
        );

        // Second claim: bitmap bit is now set
        let result2 = mollusk.process_instruction(&ix, &result1.resulting_accounts);
        expect_error(&result2, ERR_MILESTONE_ALREADY_CLAIMED, "milestone already claimed");
    }

    // =====================================================================
    // Paused but cancelled -- grace period claim allowed
    // =====================================================================

    #[test]
    fn test_claim_paused_but_cancelled_grace_period() {
        let mut mollusk = get_mollusk();
        let pid = program_id();

        mollusk.sysvars.clock.unix_timestamp = 2_000_000i64;

        let beneficiary = Pubkey::new_unique();
        let leaves = vec![
            VestingLeaf {
                leaf_index: 0,
                beneficiary,
                amount: 1_000,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 2_000_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 1,
                beneficiary: Pubkey::new_unique(),
                amount: 500,
                release_type: 0,
                start_time: 0,
                cliff_time: 1_000,
                end_time: 2_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 2,
                beneficiary: Pubkey::new_unique(),
                amount: 300,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 1_000_000,
                milestone_idx: 0,
            },
        ];
        let (root, proofs) = build_merkle_tree(&leaves);
        let proof = &proofs[0].1;

        let creator = Pubkey::new_unique();
        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(root)
            .leaf_count(3)
            .total_supply(1_800)
            .paused(true)
            .cancelled_at(Some(1_500_000))
            .funded_lamports(1_800 + 500_000)
            .build();

        let (cr_pda, cr_account) = ClaimRecordConfig::new(beneficiary, tree_pda)
            .total_entitled(leaves[0].amount)
            .build();

        let ix = Instruction {
            program_id: pid,
            accounts: claim_ix_accounts(beneficiary, tree_pda, cr_pda),
            data: build_claim_ix_data(&leaves[0], proof),
        };

        let accounts = claim_mollusk_accounts(
            beneficiary, CREATOR_LAMPORTS, tree_pda, tree_account, cr_pda, cr_account,
        );

        // effective_now = min(2_000_000, 1_500_000) = 1_500_000 => 75% vested = 750
        let result = mollusk.process_instruction(&ix, &accounts);
        assert!(
            result.program_result.is_ok(),
            "Paused+cancelled grace claim should succeed: {:?}",
            result.program_result
        );

        let tree_acc = result.get_account(&tree_pda).unwrap();
        let tree_data = deserialize_vesting_tree(&tree_acc.data);
        assert_eq!(tree_data.total_claimed, 750);
    }

    // =====================================================================
    // Insufficient vault edge case
    // =====================================================================

    #[test]
    fn test_claim_insufficient_vault() {
        let mut mollusk = get_mollusk();
        let pid = program_id();

        mollusk.sysvars.clock.unix_timestamp = 2_000_000i64;

        let beneficiary = Pubkey::new_unique();
        let leaves = vec![
            VestingLeaf {
                leaf_index: 0,
                beneficiary,
                amount: 1_000_000,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 2_000_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 1,
                beneficiary: Pubkey::new_unique(),
                amount: 500,
                release_type: 0,
                start_time: 0,
                cliff_time: 1_000,
                end_time: 2_000,
                milestone_idx: 0,
            },
            VestingLeaf {
                leaf_index: 2,
                beneficiary: Pubkey::new_unique(),
                amount: 300,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 1_000_000,
                milestone_idx: 0,
            },
        ];
        let (root, proofs) = build_merkle_tree(&leaves);
        let proof = &proofs[0].1;

        let creator = Pubkey::new_unique();
        // Fund tree with very little -- not enough for claim
        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
            .merkle_root(root)
            .leaf_count(3)
            .total_supply(1_000_800)
            .funded_lamports(100_000)
            .build();

        let (cr_pda, cr_account) = ClaimRecordConfig::new(beneficiary, tree_pda)
            .total_entitled(leaves[0].amount)
            .build();

        let ix = Instruction {
            program_id: pid,
            accounts: claim_ix_accounts(beneficiary, tree_pda, cr_pda),
            data: build_claim_ix_data(&leaves[0], proof),
        };

        let accounts = claim_mollusk_accounts(
            beneficiary, CREATOR_LAMPORTS, tree_pda, tree_account, cr_pda, cr_account,
        );

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_INSUFFICIENT_VAULT, "insufficient lamports in tree PDA");
    }
}
