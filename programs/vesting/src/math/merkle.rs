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
        use crate::constants::MAX_MERKLE_PROOF_LEN;
        use proptest::prop_assert;
        use proptest::prop_assert_eq;

        /// Build a tree from `n` leaves and return (root, Vec<(hash, proof, index)>)
        fn build_tree(n: usize) -> ([u8; 32], Vec<([u8; 32], Vec<[u8; 32]>, u32)>) {
            let leaves: Vec<VestingLeaf> = (0..n).map(|i| VestingLeaf {
                leaf_index: i as u32,
                beneficiary: Pubkey::new_unique(),
                amount: 1_000 + i as u64,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 1_000,
                milestone_idx: 0,
            }).collect();
            let hashes: Vec<[u8; 32]> = leaves.iter().map(leaf_hash).collect();

            // Pad to next power of 2
            let mut tree_size = 1;
            while tree_size < n {
                tree_size *= 2;
            }
            let padded: Vec<[u8; 32]> = {
                let mut p = hashes.clone();
                p.resize(tree_size, *p.last().unwrap());
                p
            };

            // Build levels bottom-up
            let mut levels: Vec<Vec<[u8; 32]>> = vec![padded.clone()];
            let mut current = padded;
            while current.len() > 1 {
                let mut next = Vec::new();
                for i in (0..current.len()).step_by(2) {
                    next.push(node_hash(current[i], current[i + 1]));
                }
                levels.push(next.clone());
                current = next;
            }
            let root = current[0];

            // Compute proofs for each leaf
            let entries: Vec<([u8; 32], Vec<[u8; 32]>, u32)> = (0..n).map(|leaf_idx| {
                let mut proof = Vec::new();
                let mut idx = leaf_idx;
                for level in 0..levels.len() - 1 {
                    let sibling = if idx % 2 == 0 {
                        levels[level].get(idx + 1).copied().unwrap_or(levels[level][idx])
                    } else {
                        levels[level][idx - 1]
                    };
                    proof.push(sibling);
                    idx /= 2;
                }
                (hashes[leaf_idx], proof, leaf_idx as u32)
            }).collect();

            (root, entries)
        }

        proptest::proptest! {
            /// Invariant: any tampered root byte causes verification to fail
            #[test]
            fn tampered_root_always_fails(
                leaf_idx in 0u32..16u32,
                tamper_byte_idx in 0usize..32usize,
                tamper_bit in 0u8..8u8,
            ) {
                let (root, entries) = build_tree(4);
                let idx = (leaf_idx % 4) as usize;
                let (hash, proof, index) = &entries[idx];

                // Verify valid first
                prop_assert!(verify_merkle_proof(*hash, proof, *index, root));

                // Tamper the root
                let mut bad_root = root;
                bad_root[tamper_byte_idx] ^= 1 << tamper_bit;
                prop_assert!(!verify_merkle_proof(*hash, proof, *index, bad_root));
            }

            /// Invariant: any tampered proof sibling causes verification to fail
            #[test]
            fn tampered_sibling_always_fails(
                leaf_idx in 0u32..4u32,
                sibling_idx in 0usize..2usize, // 4-leaf tree has 2-level proof
                tamper_byte_idx in 0usize..32usize,
                tamper_bit in 0u8..8u8,
            ) {
                let (root, entries) = build_tree(4);
                let idx = (leaf_idx % 4) as usize;
                let (hash, proof, index) = &entries[idx];

                prop_assert!(proof.len() > sibling_idx, "proof has {} siblings, tried index {}", proof.len(), sibling_idx);

                // Verify valid first
                prop_assert!(verify_merkle_proof(*hash, proof, *index, root));

                // Tamper a sibling
                let mut bad_proof = proof.clone();
                bad_proof[sibling_idx][tamper_byte_idx] ^= 1 << tamper_bit;
                prop_assert!(!verify_merkle_proof(*hash, &bad_proof, *index, root));
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

            /// Invariant: verification works for non-power-of-2 tree sizes
            #[test]
            fn verify_non_power_of_two_tree(leaf_count in 2u32..33u32, leaf_idx in 0u32..32u32) {
                let n = leaf_count as usize;
                let (root, entries) = build_tree(n);
                let idx = (leaf_idx as usize) % n;
                let (hash, proof, index) = &entries[idx];

                // Verify the correct leaf
                prop_assert!(verify_merkle_proof(*hash, proof, *index, root),
                    "valid proof failed for leaf {} in {}-leaf tree", idx, n);

                // Verify a wrong leaf fails
                let wrong_idx = ((idx + 1) % n) as u32;
                let (wrong_hash, _, _) = &entries[wrong_idx as usize];
                prop_assert!(!verify_merkle_proof(*wrong_hash, proof, *index, root),
                    "wrong leaf should fail verification in {}-leaf tree", n);
            }

            /// Invariant: wrong leaf index fails verification
            #[test]
            fn wrong_index_fails(leaf_count in 2u32..17u32, idx_delta in 1u32..16u32) {
                let n = leaf_count as usize;
                let (root, entries) = build_tree(n);
                let idx = 0usize;
                let (hash, proof, _index) = &entries[idx];

                let wrong_index = (idx_delta as usize) % n;
                if wrong_index != idx {
                    prop_assert!(!verify_merkle_proof(*hash, proof, wrong_index as u32, root),
                        "wrong index should fail: hash[0] with index {} in {}-leaf tree", wrong_index, n);
                }
            }

            /// Invariant: larger trees (16, 32, 64 leaves) verify correctly
            #[test]
            fn verify_large_tree(exp in 4u32..7u32, leaf_idx in 0u32..63u32) {
                let n = 2u32.pow(exp) as usize;
                let (root, entries) = build_tree(n);
                let idx = (leaf_idx as usize) % n;
                let (hash, proof, index) = &entries[idx];

                prop_assert!(verify_merkle_proof(*hash, proof, *index, root),
                    "valid proof failed for leaf {} in {}-leaf tree", idx, n);

                // Proof length should equal exp
                prop_assert_eq!(proof.len(), exp as usize,
                    "expected proof len {} for 2^{}={} leaves, got {}",
                    exp, exp, n, proof.len());
            }
        }
    }
}
