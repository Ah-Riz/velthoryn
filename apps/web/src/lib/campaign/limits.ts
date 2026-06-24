/**
 * Maximum number of cliff/linear (release_type 0 or 1) leaves a single
 * beneficiary may hold in one campaign.
 *
 * Mirrors the on-chain `PER_LEAF_CAP` constant in
 * `programs/vesting/src/state/claim_record.rs` (ADR-003). The ClaimRecord
 * PDA stores per-leaf claim state in a bounded ledger of this size, so a
 * beneficiary with more cliff/linear leaves than this would build off-chain
 * but fail on-chain with `PerLeafCapExceeded` at claim time. We cap at ingest
 * so campaigns never reach that broken state.
 *
 * Milestone leaves (release_type 2) use a bitmap and do NOT consume ledger
 * slots, so they are exempt from this cap.
 */
export const MAX_CLIFF_LINEAR_LEAVES_PER_BENEFICIARY = 8;
