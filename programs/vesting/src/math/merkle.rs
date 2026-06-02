use anchor_lang::prelude::*;
use solana_keccak_hasher::hashv;

use crate::constants::MAX_MERKLE_PROOF_LEN;
use crate::state::VestingLeaf;

pub const LEAF_PREFIX: u8 = 0x00;
pub const NODE_PREFIX: u8 = 0x01;

pub fn leaf_hash(leaf: &VestingLeaf) -> [u8; 32] {
    let serialized = borsh::to_vec(leaf).expect("borsh: VestingLeaf");
    hashv(&[&[LEAF_PREFIX], &serialized]).to_bytes()
}

/// Maximum proof siblings required for a tree with `leaf_count` leaves (`ceil(log2(n))`, 0 for n≤1).
pub fn max_proof_len_for_leaf_count(leaf_count: u32) -> usize {
    if leaf_count <= 1 {
        0
    } else {
        (32 - (leaf_count - 1).leading_zeros()) as usize
    }
}

pub fn verify_merkle_proof(
    leaf:  [u8; 32],
    proof: &[[u8; 32]],
    mut index: u32,
    root:  [u8; 32],
) -> bool {
    let mut hash = leaf;
    for sibling in proof {
        hash = if index & 1 == 0 {
            hashv(&[&[NODE_PREFIX], &hash, sibling]).to_bytes()
        } else {
            hashv(&[&[NODE_PREFIX], sibling, &hash]).to_bytes()
        };
        index >>= 1;
    }
    hash == root
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

    fn make_leaf(index: u32) -> VestingLeaf {
        VestingLeaf {
            leaf_index: index,
            beneficiary: Pubkey::new_unique(),
            amount: 1_000,
            release_type: 1,
            start_time: 0,
            cliff_time: 0,
            end_time: 1_000,
            milestone_idx: 0,
        }
    }

    fn node_hash(left: [u8; 32], right: [u8; 32]) -> [u8; 32] {
        hashv(&[&[NODE_PREFIX], &left, &right]).to_bytes()
    }

    #[test]
    fn verify_single_leaf() {
        let leaf = make_leaf(0);
        let hash = leaf_hash(&leaf);
        assert!(verify_merkle_proof(hash, &[], 0, hash));
    }

    #[test]
    fn verify_two_leaf() {
        let leaf0 = make_leaf(0);
        let leaf1 = make_leaf(1);
        let h0 = leaf_hash(&leaf0);
        let h1 = leaf_hash(&leaf1);
        let root = node_hash(h0, h1);

        assert!(verify_merkle_proof(h0, &[h1], 0, root));
        assert!(verify_merkle_proof(h1, &[h0], 1, root));
    }

    #[test]
    fn verify_four_leaf() {
        let leaves: Vec<VestingLeaf> = (0..4).map(make_leaf).collect();
        let hashes: Vec<[u8; 32]> = leaves.iter().map(leaf_hash).collect();
        let l1_0 = node_hash(hashes[0], hashes[1]);
        let l1_1 = node_hash(hashes[2], hashes[3]);
        let root = node_hash(l1_0, l1_1);

        assert!(verify_merkle_proof(hashes[0], &[hashes[1], l1_1], 0, root));
        assert!(verify_merkle_proof(hashes[3], &[hashes[2], l1_0], 3, root));
    }

    #[test]
    fn max_proof_len_for_leaf_count_values() {
        assert_eq!(max_proof_len_for_leaf_count(0), 0);
        assert_eq!(max_proof_len_for_leaf_count(1), 0);
        assert_eq!(max_proof_len_for_leaf_count(2), 1);
        assert_eq!(max_proof_len_for_leaf_count(4), 2);
        assert_eq!(max_proof_len_for_leaf_count(1_000_000), 20);
        assert!(max_proof_len_for_leaf_count(u32::MAX) <= MAX_MERKLE_PROOF_LEN);
    }

    #[test]
    fn verify_tampered_proof() {
        let leaf = make_leaf(0);
        let hash = leaf_hash(&leaf);
        let mut bad_root = hash;
        bad_root[0] ^= 0xff;
        assert!(!verify_merkle_proof(hash, &[], 0, bad_root));
    }

    mod proptest_tests {
        use super::*;
        use proptest::prop_assert;
        use proptest::prop_assert_eq;

        proptest::proptest! {
            /// Invariant: any tampered proof byte causes verification to fail
            #[test]
            fn tampered_proof_always_fails(
                leaf_idx in 0u32..16u32,
                tamper_byte_idx in 0usize..32usize,
                tamper_bit in 0u8..8u8,
            ) {
                // Build a 4-leaf tree
                let leaves: Vec<VestingLeaf> = (0..4).map(|i| VestingLeaf {
                    leaf_index: i,
                    beneficiary: Pubkey::new_unique(),
                    amount: 1_000,
                    release_type: 1,
                    start_time: 0,
                    cliff_time: 0,
                    end_time: 1_000,
                    milestone_idx: 0,
                }).collect();
                let hashes: Vec<[u8; 32]> = leaves.iter().map(leaf_hash).collect();
                let l1_0 = node_hash(hashes[0], hashes[1]);
                let l1_1 = node_hash(hashes[2], hashes[3]);
                let root = node_hash(l1_0, l1_1);

                let idx = (leaf_idx % 4) as usize;
                let hash = hashes[idx];
                let proof = match idx {
                    0 => vec![hashes[1], l1_1],
                    1 => vec![hashes[0], l1_1],
                    2 => vec![hashes[3], l1_0],
                    _ => vec![hashes[2], l1_0],
                };

                // Verify valid first
                prop_assert!(verify_merkle_proof(hash, &proof, idx as u32, root));

                // Tamper the root
                let mut bad_root = root;
                bad_root[tamper_byte_idx] ^= 1 << tamper_bit;
                prop_assert!(!verify_merkle_proof(hash, &proof, idx as u32, bad_root));
            }

            /// Invariant: single-leaf tree — leaf hash IS the root
            #[test]
            fn single_leaf_root_equals_hash(extra_byte in 0u8..255u8) {
                let leaf = VestingLeaf {
                    leaf_index: 0,
                    beneficiary: Pubkey::new_from_array([extra_byte; 32]),
                    amount: 1_000,
                    release_type: 0,
                    start_time: 0,
                    cliff_time: 100,
                    end_time: 200,
                    milestone_idx: 0,
                };
                let h = leaf_hash(&leaf);
                prop_assert!(verify_merkle_proof(h, &[], 0, h));
            }

            /// Invariant: max_proof_len_for_leaf_count is correct for powers of 2
            #[test]
            fn proof_len_for_powers_of_two(exp in 0u32..20u32) {
                let n = 2u32.pow(exp);
                let expected = exp as usize;
                prop_assert_eq!(max_proof_len_for_leaf_count(n), expected);
            }

            /// Invariant: proof len is always <= MAX_MERKLE_PROOF_LEN
            #[test]
            fn proof_len_bounded(leaf_count in 0u32..u32::MAX) {
                prop_assert!(max_proof_len_for_leaf_count(leaf_count) <= MAX_MERKLE_PROOF_LEN);
            }
        }
    }
}
