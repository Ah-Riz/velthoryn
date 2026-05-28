use anchor_lang::prelude::*;

#[error_code]
pub enum VestingError {
    #[msg("Merkle root must not be all-zero")]
    EmptyRoot,
    #[msg("Campaign must contain at least one leaf")]
    EmptyCampaign,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Cancellable campaigns require a cancel_authority")]
    MissingCancelAuthority,
    #[msg("New root must differ from the current root")]
    SameRoot,

    #[msg("Caller is not authorised for this action")]
    Unauthorized,
    #[msg("Vault would exceed the declared total_supply")]
    OverFunded,
    #[msg("Mint of provided account does not match the campaign mint")]
    MintMismatch,
    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Campaign is paused")]
    CampaignPaused,
    #[msg("Signer does not own this leaf")]
    UnauthorizedClaimer,
    #[msg("Leaf has malformed schedule (start <= cliff <= end violated)")]
    InvalidSchedule,
    #[msg("release_type must be 0 (Cliff), 1 (Linear), or 2 (Milestone)")]
    InvalidScheduleType,
    #[msg("Merkle proof did not verify against the stored root")]
    InvalidProof,
    #[msg("This milestone has already been claimed")]
    MilestoneAlreadyClaimed,
    #[msg("Nothing claimable at this time")]
    NothingToClaim,
    #[msg("Vault does not hold enough tokens for this claim")]
    InsufficientVault,
    #[msg("Total claimed would exceed campaign total_supply")]
    OverClaim,
    #[msg("Provided vault account does not match the campaign vault")]
    WrongVault,

    #[msg("Campaign was created as non-cancellable")]
    NotCancellable,
    #[msg("Campaign is already cancelled")]
    AlreadyCancelled,

    #[msg("Campaign was created with no pause_authority")]
    NotPausable,
    #[msg("Campaign is already paused")]
    AlreadyPaused,
    #[msg("Cancelled campaigns cannot be paused, unpaused, or rotated")]
    CampaignCancelled,
    #[msg("Campaign is not paused")]
    NotPaused,
    #[msg("Completed campaigns cannot be paused, unpaused, or cancelled")]
    CampaignCompleted,

    #[msg("Campaign is not cancelled")]
    NotCancelled,
    #[msg("Grace period after cancellation has not expired")]
    GracePeriodActive,

    #[msg("ClaimRecord cannot be closed yet (not fully claimed and grace period active)")]
    CannotClose,
    #[msg("This instruction only works on single-recipient streams")]
    NotSingleStream,

    #[msg("Merkle proof exceeds maximum allowed length for this campaign")]
    ProofTooLong,

    #[msg("Campaign is fully vested; cannot cancel")]
    FullyVested,

    #[msg("Stream schedule has ended; nothing left to claim")]
    StreamExpired,

    #[msg("Milestone has not been released by the creator")]
    MilestoneNotReleased,

    #[msg("Milestone has already been released")]
    MilestoneAlreadyReleased,

    #[msg("Campaign was instant-refunded; no further claims or releases allowed")]
    InstantRefundedCampaign,

    #[msg("Campaign has already started; instant refund is not allowed")]
    CampaignAlreadyStarted,

    #[msg("Native SOL vault still holds lamports after final drain")]
    NativeSolVaultNotEmpty,

    #[msg("Native SOL transfer would drop PDA below rent-exempt minimum")]
    NativeSolRentViolation,

    #[msg("Token-2022 mints are not supported; use classic SPL Token")]
    UnsupportedMint,

    #[msg("Instant refund is only allowed on multi-leaf campaigns")]
    NotMultiLeafCampaign,
}
