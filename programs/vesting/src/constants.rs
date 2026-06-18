pub const GRACE_PERIOD_SECS: i64 = 7 * 24 * 60 * 60;

/// Hard cap on Merkle proof siblings per claim (matches max depth for `u32` leaf indices).
pub const MAX_MERKLE_PROOF_LEN: usize = 32;

/// Maximum number of distinct cliff/linear leaves a single beneficiary may claim
/// against within one `ClaimRecord`. Milestone leaves do NOT consume slots — they
/// use `milestone_bitmap`. This bounds the Issue #29 per-leaf ledger so the account
/// stays a fixed size (no per-claim `realloc`). Must be a `const` for the
/// `ClaimRecord` fixed-size arrays.
pub const PER_LEAF_CAP: usize = 8;

/// Sentinel stored in `ClaimRecord::leaf_claimed_idx` to mark an empty slot.
/// (Zero is a valid leaf_index, so a non-zero sentinel is required.)
pub const EMPTY_LEAF_SLOT: u32 = u32::MAX;
