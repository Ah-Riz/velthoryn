use anchor_lang::prelude::*;
use solana_keccak_hasher::hashv;
use crate::state::VestingLeaf;

pub const LEAF_PREFIX: u8 = 0x00;
pub const NODE_PREFIX: u8 = 0x01;

pub fn leaf_hash(leaf: &VestingLeaf) -> [u8; 32] {
    let serialized = borsh::to_vec(leaf).expect("borsh: VestingLeaf");
    hashv(&[&[LEAF_PREFIX], &serialized]).to_bytes()
}

pub fn verify_merkle_proof(
    _leaf:  [u8; 32],
    _proof: &[[u8; 32]],
    _index: u32,
    _root:  [u8; 32],
) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn golden_leaf_hex() {
        let leaf = VestingLeaf {
            leaf_index:    0,
            beneficiary:   Pubkey::default(),
            amount:        1_000_000,
            release_type:  1,
            start_time:    1_700_000_000,
            cliff_time:    0,
            end_time:      1_731_536_000,
            milestone_idx: 0,
        };
        let h = leaf_hash(&leaf);
        println!("RUST_GOLDEN_HEX={}", hex::encode(h));
    }
}
