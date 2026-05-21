use crate::state::VestingLeaf;

/// Returns the time-based vested amount. For release_type 2 (Milestone), this
/// returns `leaf.amount` once `now >= cliff_time` — but the caller MUST
/// independently check `milestone_released_flags` before treating this as
/// claimable. The flag gate is enforced at the instruction level, not here.
pub fn vested(leaf: &VestingLeaf, now: i64) -> u64 {
    match leaf.release_type {
        0 if now >= leaf.cliff_time => leaf.amount,
        0 => 0,
        1 => {
            if now >= leaf.end_time {
                return leaf.amount;
            }
            if now <= leaf.cliff_time {
                return 0;
            }
            let elapsed = (now - leaf.cliff_time) as u128;
            let duration = (leaf.end_time - leaf.cliff_time) as u128;
            ((leaf.amount as u128 * elapsed) / duration) as u64
        }
        2 if now >= leaf.cliff_time => leaf.amount,
        2 => 0,
        _ => 0,
    }
}

pub fn get_vested_amount(
    leaf: &VestingLeaf,
    cancelled_at: Option<i64>,
    now: i64,
) -> u64 {
    let effective_now = match cancelled_at {
        Some(c) => now.min(c),
        None => now,
    };
    vested(leaf, effective_now)
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::Pubkey;

    fn leaf(amount: u64, cliff: i64, end: i64, typ: u8) -> VestingLeaf {
        VestingLeaf {
            leaf_index: 0,
            beneficiary: Pubkey::default(),
            amount,
            release_type: typ,
            start_time: cliff,
            cliff_time: cliff,
            end_time: end,
            milestone_idx: 0,
        }
    }

    #[test]
    fn cliff_before_after() {
        let l = leaf(1_000, 100, 200, 0);
        assert_eq!(vested(&l, 99), 0);
        assert_eq!(vested(&l, 100), 1_000);
        assert_eq!(vested(&l, 999), 1_000);
    }

    #[test]
    fn linear_curve() {
        let l = leaf(1_000, 100, 200, 1);
        assert_eq!(vested(&l, 50), 0);
        assert_eq!(vested(&l, 100), 0);
        assert_eq!(vested(&l, 150), 500);
        assert_eq!(vested(&l, 200), 1_000);
        assert_eq!(vested(&l, 999), 1_000);
    }

    #[test]
    fn linear_quarter() {
        let l = leaf(10_000, 1_000, 2_000, 1);
        // 25% elapsed (250 of 1000 duration)
        assert_eq!(vested(&l, 1_250), 2_500);
        // 50% elapsed
        assert_eq!(vested(&l, 1_500), 5_000);
        // 75% elapsed
        assert_eq!(vested(&l, 1_750), 7_500);
    }

    #[test]
    fn linear_no_overflow_at_max_amount() {
        let l = leaf(u64::MAX, 0, 1_000_000, 1);
        let half = vested(&l, 500_000);
        assert!(half >= u64::MAX / 2 - 1);
    }

    #[test]
    fn linear_degenerate_cliff_eq_end() {
        let l = leaf(1_000, 100, 100, 1);
        assert_eq!(vested(&l, 99), 0);
        assert_eq!(vested(&l, 100), 1_000);
    }

    #[test]
    fn cancel_clamp() {
        let l = leaf(1_000, 100, 200, 1);
        assert_eq!(get_vested_amount(&l, Some(150), 999), 500);
        assert_eq!(get_vested_amount(&l, None, 999), 1_000);
    }
}
