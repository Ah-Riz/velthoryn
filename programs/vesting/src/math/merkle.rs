use anchor_lang::prelude::*;
use solana_keccak_hasher::hashv;

#[cfg(test)]
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

    // =========================================================================
    // Merkle forgery / second-preimage regression suite
    // (Week 9 detection — retained: proves no proof-forgery path exists.)
    // =========================================================================
    /// Build a complete n-leaf tree (handles odd-layer duplicate-last-node padding)
    /// identically to the off-chain TS builder (clients/ts/src/merkle.ts).
    fn build_audit_tree(n: usize) -> ([u8; 32], Vec<[u8; 32]>, Vec<Vec<[u8; 32]>>) {
        let leaves: Vec<VestingLeaf> = (0..n)
            .map(|i| VestingLeaf {
                leaf_index: i as u32,
                beneficiary: Pubkey::new_unique(),
                amount: 1_000 + i as u64,
                release_type: 1,
                start_time: 0,
                cliff_time: 0,
                end_time: 1_000,
                milestone_idx: 0,
            })
            .collect();
        let hashes: Vec<[u8; 32]> = leaves.iter().map(leaf_hash).collect();

        let mut layers: Vec<Vec<[u8; 32]>> = vec![hashes.clone()];
        let mut current = hashes.clone();
        while current.len() > 1 {
            // odd-layer duplicate-last-node padding (matches TS builder)
            let working = if current.len() % 2 == 1 {
                let mut w = current.clone();
                w.push(*current.last().unwrap());
                w
            } else {
                current.clone()
            };
            let mut next = Vec::new();
            for chunk in working.chunks(2) {
                next.push(node_hash(chunk[0], chunk[1]));
            }
            layers.push(next.clone());
            current = next;
        }
        let root = current[0];
        (root, hashes, layers)
    }

    /// Compute a proof for `idx` from a layered tree (matches TS `proof()`).
    fn proof_for(layers: &[Vec<[u8; 32]>], idx: usize) -> Vec<[u8; 32]> {
        let mut proof = Vec::new();
        let mut i = idx;
        for layer in 0..layers.len() - 1 {
            let cur = &layers[layer];
            let sibling_idx = if i % 2 == 0 {
                if i + 1 >= cur.len() {
                    cur.len() - 1 // duplicate last
                } else {
                    i + 1
                }
            } else {
                i - 1
            };
            proof.push(cur[sibling_idx]);
            i /= 2;
        }
        proof
    }

    #[test]
    fn audit_claim2_shortened_proof_never_verifies() {
        // 8-leaf tree -> depth 3. Drop top-level sibling -> depth 2 / 1.
        let (root, hashes, layers) = build_audit_tree(8);
        for idx in 0..8u32 {
            let full = proof_for(&layers, idx as usize);
            assert_eq!(full.len(), 3);
            for trunc_len in [1usize, 2] {
                let short = &full[..trunc_len];
                let verifies = verify_merkle_proof(hashes[idx as usize], short, idx, root);
                assert!(
                    !verifies,
                    "FORGERY: truncated proof (len={}, leaf={}) verified against 8-leaf root!",
                    trunc_len, idx
                );
            }
        }
    }

    #[test]
    fn audit_claim2_padded_proof_never_verifies() {
        // 8-leaf tree -> depth 3. Append bogus trailing siblings -> must fail.
        let (root, hashes, layers) = build_audit_tree(8);
        let valid_proof = proof_for(&layers, 0);
        let mut padded = valid_proof.clone();
        padded.push([0xab; 32]); // extra trailing sibling
        assert!(
            !verify_merkle_proof(hashes[0], &padded, 0, root),
            "FORGERY: padded proof verified!"
        );
        let mut all_zero = valid_proof.clone();
        all_zero.push([0u8; 32]);
        assert!(!verify_merkle_proof(hashes[0], &all_zero, 0, root));
    }

    #[test]
    fn audit_claim2_single_leaf_empty_proof_is_root() {
        // n=1: leaf hash IS the root, proof = []. Only empty proof verifies.
        let (root, hashes, _layers) = build_audit_tree(1);
        assert_eq!(root, hashes[0]);
        assert!(verify_merkle_proof(hashes[0], &[], 0, root));
        let bogus = [0x42u8; 32];
        assert!(!verify_merkle_proof(hashes[0], &[bogus], 0, root));
    }

    #[test]
    fn audit_claim2_index_shift_short_proof_cannot_coincide() {
        // For depth d, any proof of length < d recomputes to a layer hash,
        // never the root, regardless of index. Brute-force small trees.
        for n in [2usize, 3, 4, 5, 7, 8, 16] {
            let (root, hashes, layers) = build_audit_tree(n);
            let depth = layers.len() - 1;
            for idx in 0..n as u32 {
                let full = proof_for(&layers, idx as usize);
                assert_eq!(full.len(), depth);
                for trunc in 0..depth {
                    let short = &full[..trunc];
                    assert!(
                        !verify_merkle_proof(hashes[idx as usize], short, idx, root),
                        "FORGERY: n={} leaf={} trunc={} verified!",
                        n, idx, trunc
                    );
                }
            }
        }
    }

    #[test]
    fn audit_claim2_wrong_position_proof_fails() {
        // Leaf A's hash with leaf B's proof (different path) -> must fail.
        let (root, hashes, layers) = build_audit_tree(8);
        let proof_a = proof_for(&layers, 0);
        assert!(!verify_merkle_proof(hashes[1], &proof_a, 0, root));
        let proof_b = proof_for(&layers, 1);
        assert!(!verify_merkle_proof(hashes[0], &proof_b, 1, root));
        assert!(!verify_merkle_proof(hashes[0], &proof_a, 3, root));
    }

    #[test]
    fn audit_claim2_second_preimage_node_as_leaf_fails() {
        // A node hash (NODE_PREFIX=0x01) is 32 bytes, same length as a leaf hash.
        // Try to verify a *computed node hash* as if it were a leaf with an empty
        // proof against the root. Domain separation makes this fail.
        let (root, hashes, layers) = build_audit_tree(4);
        let _ = hashes;
        // The internal level-1 node from leaves 0,1:
        let internal_node = layers[1][0];
        // An attacker who submits internal_node as a "leaf" with proof=[] and
        // claims index 0 must NOT verify (otherwise second-preimage forgery).
        assert!(
            !verify_merkle_proof(internal_node, &[], 0, root),
            "SECOND-PREIMAGE: a node hash verified as a leaf against the root!"
        );
    }

    #[test]
    fn distinct_indices_yield_distinct_hashes() {
        // leaf_index is serialized into the leaf hash, so two leaves at distinct
        // positions ALWAYS hash differently — even with identical beneficiary/amount/
        // schedule. This binds every leaf to its tree position, which is why a proof
        // for leaf A cannot be replayed at leaf B's index (cf. wrong_position_proof_fails
        // and the per-position ClaimRecord accounting behind Issue #29).
        let base = |idx: u32| VestingLeaf {
            leaf_index:    idx,
            beneficiary:   Pubkey::new_from_array([0xAB; 32]), // identical across leaves
            amount:        5_000,
            release_type:  1,
            start_time:    0,
            cliff_time:    0,
            end_time:      1_000,
            milestone_idx: 0,
        };
        let h0 = leaf_hash(&base(0));
        let h1 = leaf_hash(&base(1));
        let h2 = leaf_hash(&base(2));
        assert_ne!(h0, h1, "leaves at indices 0 and 1 must hash differently");
        assert_ne!(h0, h2, "leaves at indices 0 and 2 must hash differently");
        assert_ne!(h1, h2, "leaves at indices 1 and 2 must hash differently");
    }

    #[test]
    fn max_depth_boundary_proof_length() {
        // MAX_TREE_DEPTH (on- and off-chain) = 20; claim.rs caps proofs at
        // MAX_MERKLE_PROOF_LEN = 32. 2^20 leaves -> depth exactly 20 (the off-chain
        // builder's max); one more leaf -> depth 21 (the builder rejects >2^20 leaves,
        // but on-chain only the 32-sibling cap applies). Either stays within the cap.
        assert_eq!(max_proof_len_for_leaf_count(1 << 20), 20);
        assert_eq!(max_proof_len_for_leaf_count((1 << 20) + 1), 21);
        assert!(max_proof_len_for_leaf_count(1 << 20) <= MAX_MERKLE_PROOF_LEN);
        assert!(max_proof_len_for_leaf_count(u32::MAX) <= MAX_MERKLE_PROOF_LEN);
    }
}
