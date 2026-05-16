use trident_fuzz::fuzzing::*;

/// Storage for all account addresses used in fuzz testing.
///
/// This struct serves as a centralized repository for account addresses,
/// enabling their reuse across different instruction flows and test scenarios.
///
/// Docs: https://ackee.xyz/trident/docs/latest/trident-api-macro/trident-types/fuzz-accounts/
#[derive(Default)]
pub struct AccountAddresses {
    pub cancel_authority: AddressStorage,

    pub vesting_tree: AddressStorage,

    pub beneficiary: AddressStorage,

    pub claim_record: AddressStorage,

    pub vault_authority: AddressStorage,

    pub vault: AddressStorage,

    pub beneficiary_ata: AddressStorage,

    pub mint: AddressStorage,

    pub token_program: AddressStorage,

    pub associated_token_program: AddressStorage,

    pub system_program: AddressStorage,

    pub creator: AddressStorage,

    pub rent: AddressStorage,

    pub source_ata: AddressStorage,

    pub pause_authority: AddressStorage,

    pub creator_ata: AddressStorage,
}
