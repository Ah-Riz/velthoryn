//! Instruction-level Mollusk tests for cleanup instructions:
//!   - withdraw_unvested
//!   - close_claim_record
//!
//! Run with:
//!   BPF_OUT_DIR=../../target/deploy cargo test --manifest-path programs/vesting/Cargo.toml --test cleanup -- --show-output

mod test_helpers;

use test_helpers::*;

/// Grace period in seconds (7 days), matching on-chain constant.
const GRACE_PERIOD_SECS: i64 = 604_800;

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // =====================================================================
    // withdraw_unvested
    // =====================================================================

    // IGNORED: Mollusk 0.13.x limitation — Optional<T> account resolution. withdraw_unvested uses Option<Account> for SPL path. Tests withdraw_unvested happy path. Unblock when Mollusk supports Optional<T> resolution.
    #[ignore]
    #[test]
    fn test_withdraw_unvested_happy() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let campaign_id = 300u64;
        let creator = Pubkey::new_unique();
        let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());

        // cancelled_at far in the past so grace period has expired.
        // Mollusk clock = 0, so cancelled_at = -(GRACE_PERIOD_SECS + 1) means
        // grace_end = -1, and clock(0) >= -1 is true.
        let cancelled_at = Some(-GRACE_PERIOD_SECS - 1);
        let funded_lamports = 5_000_000u64;

        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, campaign_id)
            .cancelled_at(cancelled_at)
            .funded_lamports(funded_lamports)
            .build();

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
            ],
            data: build_withdraw_unvested_ix_data(),
        };

        let accounts = vec![
            (creator, creator_acc),
            (tree_pda, tree_account),
            system_program_account(),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        assert!(
            result.program_result.is_ok(),
            "withdraw_unvested should succeed: {:?}",
            result.program_result
        );

        let creator_after = result
            .get_account(&creator)
            .expect("Creator should exist after withdraw");
        assert!(
            creator_after.lamports > CREATOR_LAMPORTS,
            "Creator should have received the PDA lamports: before={}, after={}",
            CREATOR_LAMPORTS,
            creator_after.lamports
        );

        let tree_after = result.get_account(&tree_pda);
        // The PDA should have been drained (0 lamports) or near-zero
        if let Some(tree_acc) = tree_after {
            println!(
                "withdraw_unvested: tree lamports after drain: {}",
                tree_acc.lamports
            );
        }
        println!("withdraw_unvested compute_units: {}", result.compute_units_consumed);
    }

    // IGNORED: Mollusk 0.13.x limitation — Optional<T> account resolution. withdraw_unvested uses Option<Account> for SPL path. Tests withdraw_unvested error: not cancelled. Unblock when Mollusk supports Optional<T> resolution.
    #[ignore]
    #[test]
    fn test_withdraw_unvested_not_cancelled() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let campaign_id = 301u64;
        let creator = Pubkey::new_unique();
        let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());

        // cancelled_at = None — not cancelled
        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, campaign_id)
            .funded_lamports(5_000_000)
            .build();

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
            ],
            data: build_withdraw_unvested_ix_data(),
        };

        let accounts = vec![
            (creator, creator_acc),
            (tree_pda, tree_account),
            system_program_account(),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_NOT_CANCELLED, "tree not cancelled");
    }

    // IGNORED: Mollusk 0.13.x limitation — Optional<T> account resolution. withdraw_unvested uses Option<Account> for SPL path. Tests withdraw_unvested error: grace period active. Unblock when Mollusk supports Optional<T> resolution.
    #[ignore]
    #[test]
    fn test_withdraw_unvested_grace_period_active() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let campaign_id = 302u64;
        let creator = Pubkey::new_unique();
        let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());

        // cancelled_at = 0 (Mollusk clock default). grace_end = 0 + 604800 = 604800.
        // clock(0) < 604800 → grace period still active.
        let cancelled_at = Some(0);
        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, campaign_id)
            .cancelled_at(cancelled_at)
            .funded_lamports(5_000_000)
            .build();

        let ix = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(creator, true),
                AccountMeta::new(tree_pda, false),
                AccountMeta::new_readonly(system_program_id(), false),
            ],
            data: build_withdraw_unvested_ix_data(),
        };

        let accounts = vec![
            (creator, creator_acc),
            (tree_pda, tree_account),
            system_program_account(),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_GRACE_PERIOD_ACTIVE, "grace period not expired");
    }

    // =====================================================================
    // close_claim_record
    // =====================================================================

    #[test]
    fn test_close_claim_record_fully_claimed() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let campaign_id = 310u64;
        let creator = Pubkey::new_unique();
        let beneficiary = Pubkey::new_unique();
        let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let beneficiary_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());

        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, campaign_id)
            .leaf_count(1)
            .total_supply(1_000_000_000)
            .funded_lamports(1_000_000_000)
            .build();

        let total_entitled = 1_000_000u64;
        let (cr_pda, cr_account) = ClaimRecordConfig::new(beneficiary, tree_pda)
            .claimed_amount(total_entitled)
            .total_entitled(total_entitled)
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

        let accounts = vec![
            (beneficiary, beneficiary_acc),
            (creator, creator_acc),
            (tree_pda, tree_account),
            (cr_pda, cr_account),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        assert!(
            result.program_result.is_ok(),
            "close_claim_record (fully claimed) should succeed: {:?}",
            result.program_result
        );

        // The claim record should have been closed (lamports returned to beneficiary)
        let beneficiary_after = result
            .get_account(&beneficiary)
            .expect("Beneficiary should exist after close");
        assert!(
            beneficiary_after.lamports > CREATOR_LAMPORTS,
            "Beneficiary should have received claim record rent: {}",
            beneficiary_after.lamports
        );
        println!(
            "close_claim_record (fully claimed): beneficiary before={} after={} cu={}",
            CREATOR_LAMPORTS,
            beneficiary_after.lamports,
            result.compute_units_consumed
        );
    }

    #[test]
    fn test_close_claim_record_cannot_close() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let campaign_id = 311u64;
        let creator = Pubkey::new_unique();
        let beneficiary = Pubkey::new_unique();
        let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
        let beneficiary_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());

        // Tree is not cancelled — no grace period path either
        let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, campaign_id)
            .leaf_count(1)
            .total_supply(1_000_000_000)
            .funded_lamports(1_000_000_000)
            .build();

        // ClaimRecord: claimed < total_entitled → not fully claimed
        let (cr_pda, cr_account) = ClaimRecordConfig::new(beneficiary, tree_pda)
            .claimed_amount(500_000)
            .total_entitled(1_000_000)
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

        let accounts = vec![
            (beneficiary, beneficiary_acc),
            (creator, creator_acc),
            (tree_pda, tree_account),
            (cr_pda, cr_account),
        ];

        let result = mollusk.process_instruction(&ix, &accounts);
        expect_error(&result, ERR_CANNOT_CLOSE, "not fully claimed, no cancel");
    }
}
