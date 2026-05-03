use crate::state::VestingLeaf;

pub fn vested(_leaf: &VestingLeaf, _now: i64) -> u64 {
    0
}

pub fn get_vested_amount(
    _leaf:         &VestingLeaf,
    _cancelled_at: Option<i64>,
    _now:          i64,
) -> u64 {
    0
}
