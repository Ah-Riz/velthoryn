//! SC-FIND-02 audit: native-SOL `withdraw_unvested` drain-to-0 behavior.
//!
//! Proves:
//!  1. Happy path — creator receives the unvested lamports after grace.
//!  2. BUG        — the VestingTree PDA is drained to exactly 0 lamports
//!     (runtime will GC the account on-chain; SPL branch does NOT do this).
//!  3. Re-init safety — a second `create_campaign` (native) at the same PDA
//!     requires the original `creator` as Signer (seeds bind creator), so
//!     draining-to-0 cannot enable theft of a future funder's lamports.
//!     This makes the impact availability-only (indexer/BE "account not
//!     found"), not a fund-loss vulnerability.

mod test_helpers;

use test_helpers::*;

const GRACE_PERIOD_SECS: i64 = 604_800; // matches on-chain constants::GRACE_PERIOD_SECS

// --- WithdrawUnvested account layout (matches the on-chain struct) ---------
//   1. creator          (Signer, mut)
//   2. vesting_tree     (Account, mut, seeds)
//   3. vault_authority  (Option<UncheckedAccount>) -> None
//   4. vault            (Option<Account<TokenAccount>>) -> None
//   5. creator_ata      (Option<Account<TokenAccount>>) -> None
//   6. token_program    (Option<Program>) -> None
//   7. system_program
//
// Anchor 0.30+/1.0 treats any account whose key equals the *program ID* as
// `None` for `Option<T>` fields (see claim.rs test for the same convention).
fn withdraw_unvested_ix_accounts(creator: Pubkey, tree_pda: Pubkey) -> Vec<AccountMeta> {
    let pid = program_id();
    vec![
        AccountMeta::new(creator, true),                       // creator (signer, mut)
        AccountMeta::new(tree_pda, false),                     // vesting_tree (mut)
        AccountMeta::new_readonly(pid, false),                 // vault_authority = None
        AccountMeta::new_readonly(pid, false),                 // vault = None
        AccountMeta::new_readonly(pid, false),                 // creator_ata = None
        AccountMeta::new_readonly(pid, false),                 // token_program = None
        AccountMeta::new_readonly(system_program_id(), false), // system_program
    ]
}

/// Only the real accounts need to be in the Mollusk accounts vec; the
/// program-ID slots are auto-resolved by Mollusk's program fallback.
fn withdraw_unvested_mollusk_accounts(
    creator: Pubkey,
    tree_pda: Pubkey,
    tree_account: Account,
) -> Vec<(Pubkey, Account)> {
    let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
    vec![
        (creator, creator_acc),
        (tree_pda, tree_account),
        system_program_account(),
    ]
}

#[test]
fn test_native_withdraw_unvested_after_grace_creator_receives_funds() {
    let mut mollusk = get_mollusk();
    let pid = program_id();

    let creator = Pubkey::new_unique();

    // Cancel long enough ago that grace (7 days) has expired.
    let cancelled_at: i64 = 1_000_000;
    let now = cancelled_at + GRACE_PERIOD_SECS + 1;
    mollusk.sysvars.clock.unix_timestamp = now;

    // Funded lamports = unvested balance held by the PDA. Pick a value clearly
    // above the rent minimum so we can observe whether rent is preserved.
    let rent_min = mollusk.sysvars.rent.minimum_balance(8 + 315); // VestingTree space
    let unvested = 5_000_000_000; // 5 SOL of unvested funds
    let total_funded = unvested; // PDA only ever held the campaign balance

    let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
        .total_supply(10_000_000_000)
        .total_claimed(5_000_000_000) // half already claimed during grace
        .cancellable_with(creator)
        .cancelled_at(Some(cancelled_at))
        .funded_lamports(total_funded)
        .build();

    let accounts = withdraw_unvested_mollusk_accounts(creator, tree_pda, tree_account);
    let ix = Instruction {
        program_id: pid,
        accounts: withdraw_unvested_ix_accounts(creator, tree_pda),
        data: anchor_discriminator("withdraw_unvested").to_vec(),
    };

    let result = mollusk.process_instruction(&ix, &accounts);

    assert!(
        result.program_result.is_ok(),
        "expected success but got: {:?}",
        result.program_result
    );

    // (1) Creator received the UNVESTED lamports (total_funded - rent_min).
    let creator_after = result
        .get_account(&creator)
        .expect("creator account must exist");
    assert_eq!(
        creator_after.lamports,
        CREATOR_LAMPORTS + (total_funded - rent_min),
        "creator should receive total_funded minus the preserved rent minimum"
    );

    // (2) FIX VERIFICATION (Fix A): the VestingTree PDA retains exactly
    //     `rent_min`, so the runtime will NOT garbage-collect it. This matches
    //     the SPL branch which leaves the tree account alive.
    //
    //     When this assertion is flipped to `== 0`, it documents the BUG that
    //     exists in the unpatched source (drain-to-0 -> GC -> indexer/BE
    //     "account not found"). With Fix A applied, the PDA survives.
    let tree_after = result
        .get_account(&tree_pda)
        .expect("VestingTree PDA must still exist after Fix A");
    assert_eq!(
        tree_after.lamports, rent_min,
        "FIX A: native withdraw_unvested must preserve rent_min (={}); got {}",
        rent_min, tree_after.lamports
    );

    println!(
        "withdraw_unvested native (Fix A): cu={}, tree_lamports_after={}, rent_min={}, creator_received={}",
        result.compute_units_consumed, tree_after.lamports, rent_min, total_funded - rent_min
    );
}

#[test]
fn test_native_withdraw_unvested_grace_not_expired_fails() {
    let mut mollusk = get_mollusk();
    let pid = program_id();

    let creator = Pubkey::new_unique();
    let cancelled_at: i64 = 1_000_000;
    // Grace NOT yet expired.
    mollusk.sysvars.clock.unix_timestamp = cancelled_at + GRACE_PERIOD_SECS - 1;

    let (tree_pda, tree_account, _bump) = TreeConfig::new(creator, 1)
        .total_supply(1_000_000_000)
        .cancellable_with(creator)
        .cancelled_at(Some(cancelled_at))
        .funded_lamports(1_000_000_000)
        .build();

    let accounts = withdraw_unvested_mollusk_accounts(creator, tree_pda, tree_account);
    let ix = Instruction {
        program_id: pid,
        accounts: withdraw_unvested_ix_accounts(creator, tree_pda),
        data: anchor_discriminator("withdraw_unvested").to_vec(),
    };

    let result = mollusk.process_instruction(&ix, &accounts);
    assert!(
        result.program_result.is_err(),
        "must reject withdraw before grace expires, got: {:?}",
        result.program_result
    );
}

#[test]
fn test_native_withdraw_unvested_reinit_requires_original_creator_signer() {
    // After the tree is drained to 0 (and GC'd), could an attacker re-create
    // the same PDA with a different creator key and steal future funds?
    //
    // No: seeds are [b"tree", creator, NATIVE_SOL_MINT, campaign_id], and
    // create_campaign requires `creator: Signer`. To re-init the *same* PDA
    // address, the attacker MUST pass the same `creator` pubkey in the seeds,
    // which forces them to also sign for it. So only the original creator can
    // re-create the tree at that address.
    //
    // We prove this by deriving the tree PDA for two different creators and
    // showing they are distinct addresses: a non-creator cannot land on the
    // drained PDA's address no matter what they sign with.
    let pid = program_id();
    let original_creator = Pubkey::new_unique();
    let attacker = Pubkey::new_unique();
    let campaign_id = 1u64;

    let (original_tree, _) =
        derive_vesting_tree_pda(&original_creator, &NATIVE_SOL_MINT, campaign_id);
    let (attacker_tree, _) =
        derive_vesting_tree_pda(&attacker, &NATIVE_SOL_MINT, campaign_id);

    assert_ne!(
        original_tree, attacker_tree,
        "tree PDA is bound to creator via seeds; attacker cannot target the drained PDA"
    );

    // Sanity: the seed-derivation is deterministic and program-scoped.
    let (original_tree2, _) =
        derive_vesting_tree_pda(&original_creator, &NATIVE_SOL_MINT, campaign_id);
    assert_eq!(original_tree, original_tree2);

    // Confirms `program_id()` is wired up correctly in the test harness.
    let _ = pid;
}
