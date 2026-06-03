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

    /// Variant that allows start_time < cliff_time.
    fn leaf_with_start(amount: u64, start: i64, cliff: i64, end: i64, typ: u8) -> VestingLeaf {
        VestingLeaf {
            leaf_index: 0,
            beneficiary: Pubkey::default(),
            amount,
            release_type: typ,
            start_time: start,
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
        // Exact expected: u64::MAX * 500_000 / 1_000_000 = u64::MAX / 2
        // u128 math prevents overflow, so result should be exact
        let expected = (u64::MAX as u128 * 500_000 / 1_000_000) as u64;
        assert!(half >= u64::MAX / 2 - 1, "half {} too far from MAX/2 {}", half, u64::MAX / 2);
        assert_eq!(half, expected, "u128 math should give exact result");
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

    mod proptest_tests {
        use super::*;
        use proptest::prop_assert;
        use proptest::prop_assert_eq;
        use proptest::prop_assume;

        // Helper to sort 3 values so start <= cliff <= end
        fn sort3(a: i64, b: i64, c: i64) -> (i64, i64, i64) {
            let mut v = [a, b, c];
            v.sort();
            (v[0], v[1], v[2])
        }

        proptest::proptest! {
            /// Invariant: vested amount never exceeds total amount
            #[test]
            fn vested_never_exceeds_amount(
                amount in 1u64..u64::MAX,
                start in 0i64..1_000_000i64,
                cliff in 0i64..1_000_000i64,
                end in 0i64..1_000_000i64,
                now in 0i64..2_000_000i64,
            ) {
                let (_start, cliff, end) = sort3(start, cliff, end);
                let l = leaf(amount, cliff, end, 1); // linear
                let v = vested(&l, now);
                prop_assert!(v <= amount, "vested {} > amount {}", v, amount);
            }

            /// Invariant: cliff release is all-or-nothing
            #[test]
            fn cliff_all_or_nothing(
                amount in 1u64..1_000_000u64,
                cliff in 1i64..1_000_000i64,
                now in 0i64..2_000_000i64,
            ) {
                let l = leaf(amount, cliff, cliff + 100, 0);
                let v = vested(&l, now);
                prop_assert!(
                    v == 0 || v == amount,
                    "cliff vested {} is neither 0 nor {}", v, amount
                );
            }

            /// Invariant: linear vesting is monotonically non-decreasing over time
            #[test]
            fn linear_monotonic(
                amount in 1u64..1_000_000u64,
                cliff in 1i64..100_000i64,
                duration in 1i64..100_000i64,
                t1 in 0i64..200_000i64,
                t2_delta in 1i64..200_000i64,
            ) {
                let end = cliff + duration;
                let t2 = t1 + t2_delta;
                let l = leaf(amount, cliff, end, 1);
                let v1 = vested(&l, t1);
                let v2 = vested(&l, t2);
                prop_assert!(v2 >= v1, "vested decreased: t1={} v1={}, t2={} v2={}", t1, v1, t2, v2);
            }

            /// Invariant: cancel clamp — get_vested_amount with cancel <= now is same as vested(cancel)
            #[test]
            fn cancel_clamps_to_cancel_time(
                amount in 1u64..1_000_000u64,
                cliff in 1i64..100_000i64,
                end_delta in 1i64..100_000i64,
                cancel_delta in 0i64..200_000i64,
                now_extra in 0i64..200_000i64,
            ) {
                let end = cliff + end_delta;
                let cancel_at = cliff + cancel_delta;
                let now = cancel_at + now_extra;
                let l = leaf(amount, cliff, end, 1);
                let with_cancel = get_vested_amount(&l, Some(cancel_at), now);
                let at_cancel = vested(&l, cancel_at);
                prop_assert_eq!(with_cancel, at_cancel);
            }

            /// Invariant: vested is 0 before cliff for all release types
            #[test]
            fn zero_before_cliff(
                amount in 1u64..1_000_000u64,
                cliff in 1i64..100_000i64,
                release_type in 0u8..3u8,
                now in 0i64..100_000i64,
            ) {
                prop_assume!(now < cliff);
                let l = leaf(amount, cliff, cliff + 100, release_type);
                let v = vested(&l, now);
                prop_assert_eq!(v, 0, "vested {} > 0 before cliff for type {}", v, release_type);
            }

            /// Invariant: linear vesting at midpoint is approximately half
            #[test]
            fn linear_midpoint_approx_half(
                amount in 100u64..1_000_000u64,
                cliff in 1i64..100_000i64,
                duration in 2i64..100_000i64,
            ) {
                let end = cliff + duration;
                let mid = cliff + duration / 2;
                let l = leaf(amount, cliff, end, 1);
                let v = vested(&l, mid);
                let half = amount / 2;
                // Integer division rounding: bound is ceil(amount / duration)
                let tolerance = (amount / duration as u64) + 1;
                prop_assert!(
                    (v as i128 - half as i128).unsigned_abs() <= tolerance as u128,
                    "midpoint vested {} not ~half {} (amount={}, duration={})", v, half, amount, duration
                );
            }

            /// Invariant: start_time < cliff_time doesn't affect vesting
            /// (start_time is ignored by the vested() function; only cliff/end matter)
            #[test]
            fn start_before_cliff_same_as_start_eq_cliff(
                amount in 1u64..1_000_000u64,
                start in 0i64..50_000i64,
                cliff_delta in 1i64..50_000i64,
                end_delta in 1i64..50_000i64,
                now in 0i64..200_000i64,
            ) {
                let cliff = start + cliff_delta;
                let end = cliff + end_delta;
                let l_start_eq = leaf(amount, cliff, end, 1);
                let l_start_before = leaf_with_start(amount, start, cliff, end, 1);
                let v_eq = vested(&l_start_eq, now);
                let v_before = vested(&l_start_before, now);
                prop_assert_eq!(v_eq, v_before,
                    "start<cliff ({}) should give same result as start=cliff ({}) at now={}",
                    start, cliff, now);
            }

            /// Invariant: vested never exceeds amount even at u64::MAX amounts
            #[test]
            fn vested_never_exceeds_extreme_amount(
                now in 0i64..2_000_000i64,
            ) {
                let amount = u64::MAX;
                let l = leaf(amount, 0, 1_000_000, 1);
                let v = vested(&l, now);
                prop_assert!(v <= amount, "vested {} > u64::MAX at now={}", v, now);
            }

            /// Invariant: vested never exceeds amount for extreme cliff/end ranges
            #[test]
            fn vested_bounded_wide_range(
                amount in 1u64..u64::MAX,
                cliff in 0i64..i64::MAX / 2,
                end_delta in 1i64..100_000i64,
                now_offset in 0i64..200_000i64,
            ) {
                let end = cliff.saturating_add(end_delta);
                let now = cliff.saturating_sub(50_000).saturating_add(now_offset);
                let l = leaf(amount, cliff, end, 1);
                let v = vested(&l, now);
                prop_assert!(v <= amount, "vested {} > amount {}", v, amount);
            }

            /// Invariant: get_vested_amount with cancel never exceeds vested at cancel
            #[test]
            fn cancel_clamp_never_exceeds_uncancelled(
                amount in 1u64..1_000_000u64,
                cliff in 1i64..100_000i64,
                end_delta in 1i64..100_000i64,
                cancel_delta in 0i64..200_000i64,
            ) {
                let end = cliff + end_delta;
                let cancel_at = cliff + cancel_delta;
                let now = cancel_at + 100_000; // well past cancel
                let l = leaf(amount, cliff, end, 1);
                let with_cancel = get_vested_amount(&l, Some(cancel_at), now);
                let at_cancel = vested(&l, cancel_at);
                prop_assert!(with_cancel <= at_cancel,
                    "cancel-clamped {} > vested at cancel time {}", with_cancel, at_cancel);
            }
        }
    }
}
