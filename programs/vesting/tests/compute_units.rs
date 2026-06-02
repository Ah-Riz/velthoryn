//! Mollusk compute-unit benchmarks for the vesting program.
//!
//! Run with:
//!   BPF_OUT_DIR=../../target/deploy cargo test --manifest-path programs/vesting/Cargo.toml --test compute_units -- --show-output

use mollusk_svm::Mollusk;
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

fn program_id() -> Pubkey {
    Pubkey::try_from("G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu").unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get_mollusk() -> Mollusk {
        Mollusk::new(&program_id(), "vesting")
    }

    #[test]
    fn test_mollusk_loads_program() {
        let mollusk = get_mollusk();
        let pid = program_id();
        let dummy = Pubkey::new_unique();

        // Send a bare-minimum instruction to verify the program loaded and executes.
        // It will fail (wrong discriminator/accounts), but we get CU consumption data.
        let instruction = Instruction {
            program_id: pid,
            accounts: vec![
                AccountMeta::new(dummy, true),
            ],
            data: vec![0u8; 8], // wrong discriminator
        };

        let accounts = vec![
            (dummy, Account::new(5_000_000_000, 0, &pid)),
        ];

        let result = mollusk.process_instruction(&instruction, &accounts);
        println!("Program result: {:?}", result.program_result);
        println!("Compute units consumed: {:?}", result.compute_units_consumed);

        // Even a failed instruction should report CU usage
        assert!(result.compute_units_consumed > 0, "Program should consume compute units");
    }
}
