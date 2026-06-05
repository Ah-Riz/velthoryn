//! Shared helpers for Mollusk instruction-level tests.
//!
//! All test files should `use test_helpers::*;` instead of defining
//! helpers inline. This keeps the test suite DRY and consistent.

pub use borsh::{BorshDeserialize, BorshSerialize};
pub use mollusk_svm::Mollusk;
pub use mollusk_svm_result::InstructionResult;
pub use sha2::{Digest, Sha256};
pub use sha3::Keccak256;
pub use solana_account::Account;
pub use solana_instruction::{AccountMeta, Instruction};
pub use solana_pubkey::Pubkey;

pub use mollusk_svm::program::keyed_account_for_system_program;

// ---------------------------------------------------------------------------
// Program & system IDs
// ---------------------------------------------------------------------------

pub fn program_id() -> Pubkey {
    Pubkey::try_from("G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu").unwrap()
}

pub fn system_program_id() -> Pubkey {
    Pubkey::try_from("11111111111111111111111111111111").unwrap()
}

pub fn rent_sysvar_id() -> Pubkey {
    Pubkey::try_from("SysvarRent111111111111111111111111111111111").unwrap()
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Native SOL mint marker — all zeros. Matches on-chain `NATIVE_SOL_MINT`.
pub const NATIVE_SOL_MINT: Pubkey = Pubkey::new_from_array([0u8; 32]);

/// Default lamports for creator/test accounts.
pub const CREATOR_LAMPORTS: u64 = 50_000_000_000; // 50 SOL

// ---------------------------------------------------------------------------
// Anchor discriminators
// ---------------------------------------------------------------------------

/// Compute the first 8 bytes of SHA-256("global:<method>") -- Anchor ix discriminator.
pub fn anchor_discriminator(method: &str) -> [u8; 8] {
    let preimage = format!("global:{}", method);
    let mut hasher = Sha256::new();
    hasher.update(preimage.as_bytes());
    let hash = hasher.finalize();
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&hash[..8]);
    disc
}

/// Compute the first 8 bytes of SHA-256("account:<name>") -- Anchor account discriminator.
pub fn account_discriminator(name: &str) -> [u8; 8] {
    let preimage = format!("account:{}", name);
    let mut hasher = Sha256::new();
    hasher.update(preimage.as_bytes());
    let hash = hasher.finalize();
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&hash[..8]);
    disc
}

// ---------------------------------------------------------------------------
// Mirror types (borsh-serializable, matching on-chain struct layouts)
// ---------------------------------------------------------------------------

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq)]
pub struct VestingTreeData {
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub vault_authority: Pubkey,
    pub campaign_id: u64,
    pub merkle_root: [u8; 32],
    pub leaf_count: u32,
    pub total_supply: u64,
    pub total_claimed: u64,
    pub cancellable: bool,
    pub cancel_authority: Option<Pubkey>,
    pub cancelled_at: Option<i64>,
    pub paused: bool,
    pub pause_authority: Option<Pubkey>,
    pub created_at: i64,
    pub milestone_released_flags: [u8; 32],
    pub min_cliff_time: i64,
    pub instant_refunded: bool,
    pub bump: u8,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq)]
pub struct ClaimRecordData {
    pub beneficiary: Pubkey,
    pub tree: Pubkey,
    pub claimed_amount: u64,
    pub total_entitled: u64,
    pub milestone_bitmap: [u8; 32],
    pub last_claim_at: i64,
    pub bump: u8,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct CreateCampaignArgs {
    pub campaign_id: u64,
    pub merkle_root: [u8; 32],
    pub leaf_count: u32,
    pub total_supply: u64,
    pub min_cliff_time: i64,
    pub cancellable: bool,
    pub cancel_authority: Option<Pubkey>,
    pub pause_authority: Option<Pubkey>,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct CreateStreamArgs {
    pub campaign_id: u64,
    pub beneficiary: Pubkey,
    pub amount: u64,
    pub release_type: u8,
    pub start_time: i64,
    pub cliff_time: i64,
    pub end_time: i64,
    pub milestone_idx: u8,
    pub cancellable: bool,
    pub cancel_authority: Option<Pubkey>,
    pub pause_authority: Option<Pubkey>,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct WithdrawArgs {
    pub release_type: u8,
    pub start_time: i64,
    pub cliff_time: i64,
    pub end_time: i64,
    pub milestone_idx: u8,
}

/// Borsh-serializable mirror of `VestingLeaf`.
#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct VestingLeaf {
    pub leaf_index: u32,
    pub beneficiary: Pubkey,
    pub amount: u64,
    pub release_type: u8,
    pub start_time: i64,
    pub cliff_time: i64,
    pub end_time: i64,
    pub milestone_idx: u8,
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

/// Serialize a `VestingTreeData` into account bytes: 8-byte Anchor discriminator + borsh fields.
pub fn serialize_vesting_tree(tree_data: &VestingTreeData) -> Vec<u8> {
    let mut data = account_discriminator("VestingTree").to_vec();
    data.append(&mut borsh::to_vec(tree_data).expect("Failed to serialize VestingTreeData"));
    data
}

/// Deserialize a VestingTree from raw account data (skips 8-byte Anchor discriminator).
pub fn deserialize_vesting_tree(data: &[u8]) -> VestingTreeData {
    assert!(data.len() > 8, "Account data too short for Anchor discriminator");
    VestingTreeData::deserialize(&mut &data[8..]).expect("Failed to deserialize VestingTree")
}

/// Serialize a `ClaimRecordData` into account bytes: 8-byte Anchor discriminator + borsh fields.
pub fn serialize_claim_record(cr_data: &ClaimRecordData) -> Vec<u8> {
    let mut data = account_discriminator("ClaimRecord").to_vec();
    data.append(&mut borsh::to_vec(cr_data).expect("Failed to serialize ClaimRecordData"));
    data
}

/// Deserialize a ClaimRecord from raw account data (skips 8-byte Anchor discriminator).
pub fn deserialize_claim_record(data: &[u8]) -> ClaimRecordData {
    assert!(data.len() > 8, "Account data too short for Anchor discriminator");
    ClaimRecordData::deserialize(&mut &data[8..]).expect("Failed to deserialize ClaimRecord")
}

/// Build instruction data bytes: discriminator + borsh(args).
pub fn build_ix_data(method: &str, args: &impl BorshSerialize) -> Vec<u8> {
    let mut data = anchor_discriminator(method).to_vec();
    data.append(&mut borsh::to_vec(args).expect("Failed to serialize args"));
    data
}

/// Borsh-serialize a value to a Vec<u8>.
pub fn borsh_serialize<T: BorshSerialize>(val: &T) -> Vec<u8> {
    borsh::to_vec(val).expect("Failed to borsh serialize")
}

// ---------------------------------------------------------------------------
// Keccak-256 Merkle helpers (matches on-chain solana_keccak_hasher::hashv)
// ---------------------------------------------------------------------------

pub const LEAF_PREFIX: u8 = 0x00;
pub const NODE_PREFIX: u8 = 0x01;

/// Compute the leaf hash using Keccak-256, matching the on-chain algorithm:
/// `keccak256(&[0x00, borsh_serialize(leaf)])`
pub fn compute_leaf_hash(leaf: &VestingLeaf) -> [u8; 32] {
    let serialized = borsh_serialize(leaf);
    let mut hasher = Keccak256::new();
    hasher.update(&[LEAF_PREFIX]);
    hasher.update(&serialized);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

/// Compute a node hash using Keccak-256, matching the on-chain algorithm:
/// If index is even: `keccak256(&[0x01, left, right])`
/// If index is odd:  `keccak256(&[0x01, right, left])`
pub fn compute_node_hash(left: [u8; 32], right: [u8; 32], index: u32) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(&[NODE_PREFIX]);
    if index & 1 == 0 {
        hasher.update(&left);
        hasher.update(&right);
    } else {
        hasher.update(&right);
        hasher.update(&left);
    }
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

/// For a single-leaf tree: root == leaf_hash, proof = [].
pub fn build_single_leaf_proof(leaf: &VestingLeaf) -> ([u8; 32], Vec<[u8; 32]>) {
    let root = compute_leaf_hash(leaf);
    (root, vec![])
}

/// Verify a merkle proof using Keccak-256 (matches on-chain verify_merkle_proof).
pub fn verify_merkle_proof(
    leaf: [u8; 32],
    proof: &[[u8; 32]],
    mut index: u32,
    root: [u8; 32],
) -> bool {
    let mut hash = leaf;
    for sibling in proof {
        hash = compute_node_hash(hash, *sibling, index);
        index >>= 1;
    }
    hash == root
}

// ---------------------------------------------------------------------------
// System / Rent account stubs
// ---------------------------------------------------------------------------

/// Build the system_program account using Mollusk's builtin helper.
/// This provides the correct data/lamports/owner for the System Program CPI.
pub fn system_program_account() -> (Pubkey, Account) {
    keyed_account_for_system_program()
}

/// Build a minimal Rent sysvar account (stub).
pub fn rent_sysvar_account() -> (Pubkey, Account) {
    let id = rent_sysvar_id();
    let sysvar_owner = Pubkey::try_from("Sysvar1111111111111111111111111111111111111").unwrap();
    (id, Account {
        lamports: 1,
        data: vec![0u8; 115],
        owner: sysvar_owner,
        executable: false,
        rent_epoch: 0,
    })
}

// ---------------------------------------------------------------------------
// Common test setup
// ---------------------------------------------------------------------------

/// Create a new Mollusk instance for instruction tests.
pub fn get_mollusk() -> Mollusk {
    Mollusk::new(&program_id(), "vesting")
}

pub fn make_creator_account() -> (Pubkey, Account) {
    let creator = Pubkey::new_unique();
    let account = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
    (creator, account)
}

/// Make a funded account with custom lamports.
pub fn make_funded_account(lamports: u64) -> (Pubkey, Account) {
    let key = Pubkey::new_unique();
    let account = Account::new(lamports, 0, &system_program_id());
    (key, account)
}

// ---------------------------------------------------------------------------
// PDA derivation
// ---------------------------------------------------------------------------

pub fn derive_vesting_tree_pda(
    creator: &Pubkey,
    mint: &Pubkey,
    campaign_id: u64,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            b"tree",
            creator.as_ref(),
            mint.as_ref(),
            &campaign_id.to_le_bytes(),
        ],
        &program_id(),
    )
}

pub fn derive_vault_authority_pda(tree: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"vault_authority", tree.as_ref()],
        &program_id(),
    )
}

pub fn derive_claim_record_pda(tree: &Pubkey, beneficiary: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"claim", tree.as_ref(), beneficiary.as_ref()],
        &program_id(),
    )
}

// ---------------------------------------------------------------------------
// TreeConfig builder
// ---------------------------------------------------------------------------

/// Builder for VestingTree test accounts.
pub struct TreeConfig {
    creator: Option<Pubkey>,
    mint: Option<Pubkey>,
    campaign_id: u64,
    merkle_root: [u8; 32],
    leaf_count: u32,
    total_supply: u64,
    total_claimed: u64,
    cancellable: bool,
    cancel_authority: Option<Pubkey>,
    cancelled_at: Option<i64>,
    paused: bool,
    pause_authority: Option<Pubkey>,
    milestone_released_flags: [u8; 32],
    min_cliff_time: i64,
    instant_refunded: bool,
    funded_lamports: u64,
}

impl TreeConfig {
    pub fn new(creator: Pubkey, campaign_id: u64) -> Self {
        Self {
            creator: Some(creator),
            mint: Some(NATIVE_SOL_MINT),
            campaign_id,
            merkle_root: valid_merkle_root(),
            leaf_count: 3,
            total_supply: 1_000_000_000,
            total_claimed: 0,
            cancellable: false,
            cancel_authority: None,
            cancelled_at: None,
            paused: false,
            pause_authority: None,
            milestone_released_flags: [0u8; 32],
            min_cliff_time: 1_000_000,
            instant_refunded: false,
            funded_lamports: 1_000_000_000,
        }
    }

    pub fn mint(mut self, mint: Pubkey) -> Self { self.mint = Some(mint); self }
    pub fn merkle_root(mut self, root: [u8; 32]) -> Self { self.merkle_root = root; self }
    pub fn leaf_count(mut self, count: u32) -> Self { self.leaf_count = count; self }
    pub fn total_supply(mut self, supply: u64) -> Self { self.total_supply = supply; self }
    pub fn total_claimed(mut self, claimed: u64) -> Self { self.total_claimed = claimed; self }
    pub fn cancellable(mut self, val: bool) -> Self { self.cancellable = val; self }
    pub fn cancel_authority(mut self, auth: Option<Pubkey>) -> Self { self.cancel_authority = auth; self }
    pub fn cancelled_at(mut self, at: Option<i64>) -> Self { self.cancelled_at = at; self }
    pub fn paused(mut self, val: bool) -> Self { self.paused = val; self }
    pub fn pause_authority(mut self, auth: Option<Pubkey>) -> Self { self.pause_authority = auth; self }
    pub fn milestone_released_flags(mut self, flags: [u8; 32]) -> Self { self.milestone_released_flags = flags; self }
    pub fn min_cliff_time(mut self, time: i64) -> Self { self.min_cliff_time = time; self }
    pub fn instant_refunded(mut self, val: bool) -> Self { self.instant_refunded = val; self }
    pub fn funded_lamports(mut self, lamports: u64) -> Self { self.funded_lamports = lamports; self }

    /// Convenience: set cancellable with a specific authority.
    pub fn cancellable_with(mut self, authority: Pubkey) -> Self {
        self.cancellable = true;
        self.cancel_authority = Some(authority);
        self
    }

    /// Return the PDA and bump for this tree config.
    pub fn pda(&self) -> (Pubkey, u8) {
        derive_vesting_tree_pda(
            self.creator.as_ref().unwrap(),
            self.mint.as_ref().unwrap(),
            self.campaign_id,
        )
    }

    /// Build and return (pubkey, Account, bump).
    pub fn build(&self) -> (Pubkey, Account, u8) {
        let pid = program_id();
        let creator = self.creator.unwrap();
        let mint = self.mint.unwrap();
        let (tree_pda, tree_bump) = derive_vesting_tree_pda(&creator, &mint, self.campaign_id);

        let tree_data = VestingTreeData {
            creator,
            mint,
            vault: Pubkey::default(),
            vault_authority: Pubkey::default(),
            campaign_id: self.campaign_id,
            merkle_root: self.merkle_root,
            leaf_count: self.leaf_count,
            total_supply: self.total_supply,
            total_claimed: self.total_claimed,
            cancellable: self.cancellable,
            cancel_authority: self.cancel_authority,
            cancelled_at: self.cancelled_at,
            paused: self.paused,
            pause_authority: self.pause_authority,
            created_at: 100_000,
            milestone_released_flags: self.milestone_released_flags,
            min_cliff_time: self.min_cliff_time,
            instant_refunded: self.instant_refunded,
            bump: tree_bump,
        };

        let mut account_bytes = serialize_vesting_tree(&tree_data);

        // Pad to the exact expected account size (8-byte discriminator + VestingTree::INIT_SPACE).
        // Anchor allocates the full INIT_SPACE for each field (including max Option size),
        // so the data buffer must be at least this large. If Option fields are None but get
        // mutated to Some during the handler, the serialization would otherwise overflow
        // the shorter buffer. Padding ensures the buffer is always large enough.
        // VestingTree::INIT_SPACE = 315 bytes (32+32+32+32+8+32+4+8+8+1+33+9+1+33+8+32+8+1+1)
        const VESTING_TREE_SPACE: usize = 8 + 315;
        account_bytes.resize(VESTING_TREE_SPACE, 0);

        let tree_account = Account {
            lamports: self.funded_lamports,
            data: account_bytes,
            owner: pid,
            executable: false,
            rent_epoch: 0,
        };

        (tree_pda, tree_account, tree_bump)
    }
}

// ---------------------------------------------------------------------------
// ClaimRecordConfig builder
// ---------------------------------------------------------------------------

/// Builder for ClaimRecord test accounts.
pub struct ClaimRecordConfig {
    beneficiary: Option<Pubkey>,
    tree: Option<Pubkey>,
    claimed_amount: u64,
    total_entitled: u64,
    milestone_bitmap: [u8; 32],
    last_claim_at: i64,
}

impl ClaimRecordConfig {
    pub fn new(beneficiary: Pubkey, tree: Pubkey) -> Self {
        Self {
            beneficiary: Some(beneficiary),
            tree: Some(tree),
            claimed_amount: 0,
            total_entitled: 0,
            milestone_bitmap: [0u8; 32],
            last_claim_at: 0,
        }
    }

    pub fn claimed_amount(mut self, amount: u64) -> Self { self.claimed_amount = amount; self }
    pub fn total_entitled(mut self, amount: u64) -> Self { self.total_entitled = amount; self }

    /// Create a zeroed/fresh claim record for a given tree (beneficiary=Pubkey::default).
    pub fn zero(tree: &Pubkey) -> Self {
        Self {
            beneficiary: Some(Pubkey::default()),
            tree: Some(*tree),
            claimed_amount: 0,
            total_entitled: 0,
            milestone_bitmap: [0u8; 32],
            last_claim_at: 0,
        }
    }

    pub fn build(&self) -> (Pubkey, Account) {
        let beneficiary = self.beneficiary.unwrap();
        let tree = self.tree.unwrap();
        let (cr_pda, cr_bump) = derive_claim_record_pda(&tree, &beneficiary);

        let cr_data = ClaimRecordData {
            beneficiary,
            tree,
            claimed_amount: self.claimed_amount,
            total_entitled: self.total_entitled,
            milestone_bitmap: self.milestone_bitmap,
            last_claim_at: self.last_claim_at,
            bump: cr_bump,
        };

        let account_bytes = serialize_claim_record(&cr_data);

        let cr_account = Account {
            lamports: 1_000_000, // rent-exempt minimum
            data: account_bytes,
            owner: program_id(),
            executable: false,
            rent_epoch: 0,
        };

        (cr_pda, cr_account)
    }
}

// ---------------------------------------------------------------------------
// Error handling helpers
// ---------------------------------------------------------------------------

/// Extract Anchor error code from a Mollusk failure result.
pub fn extract_anchor_error_code(raw_err: &solana_instruction::error::InstructionError) -> Option<u32> {
    match raw_err {
        solana_instruction::error::InstructionError::Custom(code) => Some(*code),
        _ => None,
    }
}

/// Assert that a Mollusk result failed with a specific Anchor error code.
pub fn expect_error(result: &InstructionResult, expected_code: u32, context: &str) {
    assert!(
        result.program_result.is_err(),
        "Expected error for {}, but got success",
        context
    );
    let err_code = result
        .raw_result
        .as_ref()
        .err()
        .and_then(|e| extract_anchor_error_code(e));
    assert_eq!(
        err_code,
        Some(expected_code),
        "Expected error code {} for {}, got: {:?}",
        expected_code,
        context,
        err_code
    );
}

// ---------------------------------------------------------------------------
// Error code constants (from VestingError enum, base = 6000)
// ---------------------------------------------------------------------------

pub const ERR_EMPTY_ROOT: u32 = 6000;
pub const ERR_EMPTY_CAMPAIGN: u32 = 6001;
pub const ERR_ZERO_AMOUNT: u32 = 6002;
pub const ERR_MISSING_CANCEL_AUTH: u32 = 6003;
pub const ERR_SAME_ROOT: u32 = 6004;
pub const ERR_UNAUTHORIZED: u32 = 6005;
pub const ERR_OVER_FUNDED: u32 = 6006;
pub const ERR_MINT_MISMATCH: u32 = 6007;
pub const ERR_OVERFLOW: u32 = 6008;
pub const ERR_CAMPAIGN_PAUSED: u32 = 6009;
pub const ERR_UNAUTHORIZED_CLAIMER: u32 = 6010;
pub const ERR_INVALID_SCHEDULE: u32 = 6011;
pub const ERR_INVALID_SCHEDULE_TYPE: u32 = 6012;
pub const ERR_INVALID_PROOF: u32 = 6013;
pub const ERR_MILESTONE_ALREADY_CLAIMED: u32 = 6014;
pub const ERR_NOTHING_TO_CLAIM: u32 = 6015;
pub const ERR_INSUFFICIENT_VAULT: u32 = 6016;
pub const ERR_OVER_CLAIM: u32 = 6017;
pub const ERR_WRONG_VAULT: u32 = 6018;
pub const ERR_NOT_CANCELLABLE: u32 = 6019;
pub const ERR_ALREADY_CANCELLED: u32 = 6020;
pub const ERR_NOT_PAUSABLE: u32 = 6021;
pub const ERR_ALREADY_PAUSED: u32 = 6022;
pub const ERR_CAMPAIGN_CANCELLED: u32 = 6023;
pub const ERR_NOT_PAUSED: u32 = 6024;
pub const ERR_CAMPAIGN_COMPLETED: u32 = 6025;
pub const ERR_NOT_CANCELLED: u32 = 6026;
pub const ERR_GRACE_PERIOD_ACTIVE: u32 = 6027;
pub const ERR_CANNOT_CLOSE: u32 = 6028;
pub const ERR_NOT_SINGLE_STREAM: u32 = 6029;
pub const ERR_PROOF_TOO_LONG: u32 = 6030;
pub const ERR_FULLY_VESTED: u32 = 6031;
pub const ERR_STREAM_EXPIRED: u32 = 6032;
pub const ERR_MILESTONE_NOT_RELEASED: u32 = 6033;
pub const ERR_MILESTONE_ALREADY_RELEASED: u32 = 6034;
pub const ERR_INSTANT_REFUNDED: u32 = 6035;
pub const ERR_CAMPAIGN_ALREADY_STARTED: u32 = 6036;
pub const ERR_NATIVE_SOL_VAULT_NOT_EMPTY: u32 = 6037;
pub const ERR_NATIVE_SOL_RENT_VIOLATION: u32 = 6038;
pub const ERR_UNSUPPORTED_MINT: u32 = 6039;
pub const ERR_NOT_MULTI_LEAF_CAMPAIGN: u32 = 6040;

// ---------------------------------------------------------------------------
// Convenience builders for args
// ---------------------------------------------------------------------------

/// Any non-zero 32-byte array is a valid root for our purposes.
pub fn valid_merkle_root() -> [u8; 32] {
    let mut root = [0u8; 32];
    root[0] = 0x01;
    root
}

/// Default CreateCampaignArgs for a native SOL campaign.
pub fn default_create_args(campaign_id: u64) -> CreateCampaignArgs {
    CreateCampaignArgs {
        campaign_id,
        merkle_root: valid_merkle_root(),
        leaf_count: 3,
        total_supply: 1_000_000_000,
        min_cliff_time: 1_000_000,
        cancellable: false,
        cancel_authority: None,
        pause_authority: None,
    }
}

/// Default CreateStreamArgs for a native SOL stream.
pub fn default_stream_args(campaign_id: u64, beneficiary: Pubkey) -> CreateStreamArgs {
    CreateStreamArgs {
        campaign_id,
        beneficiary,
        amount: 1_000_000_000,
        release_type: 1, // Linear
        start_time: 0,
        cliff_time: 0,
        end_time: 2_000_000,
        milestone_idx: 0,
        cancellable: false,
        cancel_authority: None,
        pause_authority: None,
    }
}

/// Default WithdrawArgs for a linear stream.
pub fn default_withdraw_args() -> WithdrawArgs {
    WithdrawArgs {
        release_type: 1, // Linear
        start_time: 0,
        cliff_time: 0,
        end_time: 2_000_000,
        milestone_idx: 0,
    }
}

/// Parse the u64 return value from an Anchor return data.
pub fn parse_return_u64(return_data: &[u8]) -> u64 {
    assert!(
        return_data.len() >= 8,
        "Return data too short: {} bytes",
        return_data.len()
    );
    u64::from_le_bytes(
        return_data[return_data.len() - 8..]
            .try_into()
            .expect("Slice should be exactly 8 bytes"),
    )
}

// ---------------------------------------------------------------------------
// Multi-leaf Merkle tree builder
// ---------------------------------------------------------------------------

/// Build a complete Merkle tree from a list of leaves.
/// Returns (root_hash, Vec<(leaf_hash, proof_siblings)>).
/// Each proof is the list of sibling hashes needed to verify that leaf.
pub fn build_merkle_tree(leaves: &[VestingLeaf]) -> ([u8; 32], Vec<([u8; 32], Vec<[u8; 32]>)>) {
    assert!(!leaves.is_empty(), "Need at least one leaf");

    let leaf_count = leaves.len();

    // Compute proofs using the level-by-level approach
    let root = {
        let mut level_hashes: Vec<Vec<[u8; 32]>> = Vec::new();
        let mut current: Vec<[u8; 32]> = leaves.iter().map(|l| compute_leaf_hash(l)).collect();
        // Pad to power of 2
        let mut tree_size = 1;
        while tree_size < leaf_count {
            tree_size *= 2;
        }
        current.resize(tree_size, current[leaf_count - 1]);
        level_hashes.push(current.clone());

        while current.len() > 1 {
            let mut next = Vec::new();
            for i in (0..current.len()).step_by(2) {
                let left = current[i];
                let right = current.get(i + 1).copied().unwrap_or(left);
                next.push(compute_node_hash(left, right, (i / 2) as u32));
            }
            current = next;
            level_hashes.push(current.clone());
        }
        current[0]
    };

    let proofs_out: Vec<([u8; 32], Vec<[u8; 32]>)> = (0..leaf_count)
        .map(|leaf_idx| {
            let leaf_hash = compute_leaf_hash(&leaves[leaf_idx]);
            let proof = compute_proof_for_leaf(leaves, leaf_idx);
            (leaf_hash, proof)
        })
        .collect();

    (root, proofs_out)
}

/// Compute the Merkle proof (sibling path) for a specific leaf index.
fn compute_proof_for_leaf(leaves: &[VestingLeaf], leaf_idx: usize) -> Vec<[u8; 32]> {
    let leaf_count = leaves.len();
    let mut tree_size = 1;
    while tree_size < leaf_count {
        tree_size *= 2;
    }

    // Build all hashes at each level
    let mut level_hashes: Vec<Vec<[u8; 32]>> = Vec::new();
    let mut current: Vec<[u8; 32]> = leaves.iter().map(|l| compute_leaf_hash(l)).collect();
    current.resize(tree_size, current[leaf_count - 1]);
    level_hashes.push(current.clone());

    while current.len() > 1 {
        let mut next = Vec::new();
        for i in (0..current.len()).step_by(2) {
            let left = current[i];
            let right = current.get(i + 1).copied().unwrap_or(left);
            next.push(compute_node_hash(left, right, (i / 2) as u32));
        }
        current = next;
        level_hashes.push(current.clone());
    }

    // Walk up from leaf to root, collecting siblings
    let mut proof = Vec::new();
    let mut idx = leaf_idx;
    for level in 0..level_hashes.len() - 1 {
        let sibling = if idx % 2 == 0 {
            level_hashes[level].get(idx + 1).copied().unwrap_or(level_hashes[level][idx])
        } else {
            level_hashes[level][idx - 1]
        };
        proof.push(sibling);
        idx /= 2;
    }

    proof
}

// ---------------------------------------------------------------------------
// Instruction-specific account builders
// ---------------------------------------------------------------------------

/// Zero-keyed account placeholder for `Option<T>` accounts that should be `None`.
pub fn zero_account() -> (Pubkey, Account) {
    (Pubkey::default(), Account::default())
}

/// Build the FULL accounts list for a native SOL `claim` instruction.
///
/// The `Claim` accounts struct has 10 fields (positional in Anchor):
///   1. beneficiary      (Signer, mut)
///   2. vesting_tree      (Account, mut)
///   3. claim_record      (init_if_needed)
///   4. vault_authority   (Option<UncheckedAccount>) -> None for native SOL
///   5. vault             (Option<Account<TokenAccount>>) -> None
///   6. beneficiary_ata   (Option<Account<TokenAccount>>) -> None
///   7. mint              (Option<Account<Mint>>) -> None
///   8. token_program     (Option<Program>) -> None
///   9. associated_token_program (Option<Program>) -> None
///  10. system_program
///
/// Anchor resolves accounts positionally; every field needs an entry.
/// `Option` accounts use `Pubkey::default()` to indicate `None`.
pub fn build_claim_accounts_native(
    tree_pda: Pubkey,
    tree_account: Account,
    beneficiary: Pubkey,
    claim_record_pda: Pubkey,
) -> Vec<(Pubkey, Account)> {
    let beneficiary_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
    let claim_record_acc = Account::new(0, 0, &system_program_id()); // system-owned for init

    vec![
        (beneficiary, beneficiary_acc),
        (tree_pda, tree_account),
        (claim_record_pda, claim_record_acc),
        zero_account(), // vault_authority = None
        zero_account(), // vault = None
        zero_account(), // beneficiary_ata = None
        zero_account(), // mint = None
        zero_account(), // token_program = None
        zero_account(), // associated_token_program = None
        system_program_account(),
    ]
}

/// Build the FULL accounts list for a native SOL `withdraw` instruction.
/// Same field order as `Claim` (withdraw has the same accounts struct layout).
pub fn build_withdraw_accounts_native(
    tree_pda: Pubkey,
    tree_account: Account,
    beneficiary: Pubkey,
    claim_record_pda: Pubkey,
) -> Vec<(Pubkey, Account)> {
    build_claim_accounts_native(tree_pda, tree_account, beneficiary, claim_record_pda)
}

/// Build the FULL accounts list for a native SOL `cancel_stream` instruction.
///
/// The `CancelStream` accounts struct has 11 fields:
///   1. creator           (Signer, mut)
///   2. beneficiary       (UncheckedAccount, mut)
///   3. vesting_tree      (Account, mut)
///   4. claim_record      (init_if_needed)
///   5. system_program    (Program)
///   6. vault_authority   (Option<UncheckedAccount>) -> None
///   7. vault             (Option<Account<TokenAccount>>) -> None
///   8. beneficiary_ata   (Option<UncheckedAccount>) -> None
///   9. creator_ata       (Option<UncheckedAccount>) -> None
///  10. token_program     (Option<Program>) -> None
pub fn build_cancel_stream_accounts_native(
    tree_pda: Pubkey,
    tree_account: Account,
    creator: Pubkey,
    beneficiary: Pubkey,
    claim_record_pda: Pubkey,
) -> Vec<(Pubkey, Account)> {
    let creator_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
    let beneficiary_acc = Account::new(CREATOR_LAMPORTS, 0, &system_program_id());
    let claim_record_acc = Account::new(0, 0, &system_program_id()); // system-owned for init

    vec![
        (creator, creator_acc),
        (beneficiary, beneficiary_acc),
        (tree_pda, tree_account),
        (claim_record_pda, claim_record_acc),
        system_program_account(),
        zero_account(), // vault_authority = None
        zero_account(), // vault = None
        zero_account(), // beneficiary_ata = None
        zero_account(), // creator_ata = None
        zero_account(), // token_program = None
    ]
}

/// Build instruction data for `claim`: discriminator + leaf + proof.
pub fn build_claim_ix_data(leaf: &VestingLeaf, proof: &[[u8; 32]]) -> Vec<u8> {
    let mut data = anchor_discriminator("claim").to_vec();
    data.extend_from_slice(&borsh_serialize(leaf));
    // Borsh Vec<[u8; 32]>: u32 length prefix + N * 32 bytes
    let proof_len = proof.len() as u32;
    data.extend_from_slice(&proof_len.to_le_bytes());
    for p in proof {
        data.extend_from_slice(p);
    }
    data
}

/// Build instruction data for `withdraw`: discriminator + args.
pub fn build_withdraw_ix_data(args: &WithdrawArgs) -> Vec<u8> {
    build_ix_data("withdraw", args)
}

/// Build instruction data for `cancel_campaign`: discriminator only (no args).
pub fn build_cancel_campaign_ix_data() -> Vec<u8> {
    anchor_discriminator("cancel_campaign").to_vec()
}

/// Build instruction data for `cancel_stream`: discriminator + args.
pub fn build_cancel_stream_ix_data(args: &WithdrawArgs) -> Vec<u8> {
    build_ix_data("cancel_stream", args)
}

/// Build instruction data for `create_stream_native`: discriminator + args.
pub fn build_create_stream_native_ix_data(args: &CreateStreamArgs) -> Vec<u8> {
    build_ix_data("create_stream_native", args)
}

/// Build instruction data for `fund_campaign_native`: discriminator + amount.
pub fn build_fund_campaign_native_ix_data(amount: u64) -> Vec<u8> {
    let mut data = anchor_discriminator("fund_campaign_native").to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    data
}

/// Build instruction data for `set_milestone_released`: discriminator + milestone_idx.
pub fn build_set_milestone_released_ix_data(milestone_idx: u8) -> Vec<u8> {
    let mut data = anchor_discriminator("set_milestone_released").to_vec();
    data.extend_from_slice(&milestone_idx.to_le_bytes());
    data
}

/// Build instruction data for `update_root`: discriminator + new_root + new_leaf_count + new_min_cliff_time.
pub fn build_update_root_ix_data(new_root: [u8; 32], new_leaf_count: u32, new_min_cliff_time: i64) -> Vec<u8> {
    let mut data = anchor_discriminator("update_root").to_vec();
    data.extend_from_slice(&new_root);
    data.extend_from_slice(&new_leaf_count.to_le_bytes());
    data.extend_from_slice(&new_min_cliff_time.to_le_bytes());
    data
}

/// Build instruction data for `withdraw_unvested`: discriminator only (no args).
pub fn build_withdraw_unvested_ix_data() -> Vec<u8> {
    anchor_discriminator("withdraw_unvested").to_vec()
}

/// Build instruction data for `close_claim_record`: discriminator only (no args).
pub fn build_close_claim_record_ix_data() -> Vec<u8> {
    anchor_discriminator("close_claim_record").to_vec()
}

/// Build instruction data for `instant_refund_campaign`: discriminator only (no args).
pub fn build_instant_refund_campaign_ix_data() -> Vec<u8> {
    anchor_discriminator("instant_refund_campaign").to_vec()
}
