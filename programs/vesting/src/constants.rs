pub const GRACE_PERIOD_SECS: i64 = 7 * 24 * 60 * 60;

/// Hard cap on Merkle proof siblings per claim (matches max depth for `u32` leaf indices).
pub const MAX_MERKLE_PROOF_LEN: usize = 32;
