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

    /// Odd-count tree: duplicate last leaf at layer 0 (matches clients/ts merkle.ts).
    #[test]
    fn verify_three_leaf() {
        let leaves: Vec<VestingLeaf> = (0..3).map(make_leaf).collect();
        let hashes: Vec<[u8; 32]> = leaves.iter().map(leaf_hash).collect();
        let l1_0 = node_hash(hashes[0], hashes[1]);
        let l1_1 = node_hash(hashes[2], hashes[2]);
        let root = node_hash(l1_0, l1_1);

        assert!(verify_merkle_proof(hashes[0], &[hashes[1], l1_1], 0, root));
        assert!(verify_merkle_proof(hashes[1], &[hashes[0], l1_1], 1, root));
        assert!(verify_merkle_proof(hashes[2], &[hashes[2], l1_0], 2, root));

        let mut bad_root = root;
        bad_root[0] ^= 0xff;
        assert!(!verify_merkle_proof(hashes[2], &[hashes[2], l1_0], 2, bad_root));
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
}
