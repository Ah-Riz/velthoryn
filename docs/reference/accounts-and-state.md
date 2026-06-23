# Accounts & State

The Velora vesting program uses four on-chain account types and one off-chain data structure. All accounts are derived as Program Derived Addresses (PDAs) using deterministic seeds.

**Program ID:** `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`

---

## PDA Derivation

| Account | Seeds | Created By |
|---------|-------|------------|
| `VestingTree` | `["tree", creator, mint, campaign_id.to_le_bytes()]` | `create_campaign` / `create_stream` |
| `ClaimRecord` | `["claim", vesting_tree, beneficiary]` | Lazily by `claim` / `withdraw` / `cancel_stream` |
| `vault_authority` | `["vault_authority", vesting_tree]` | Derived (signer PDA for SPL CPI) |
| `vault` (ATA) | Associated to `vault_authority`, mint = campaign mint | `create_campaign` / `create_stream` |

{% hint style="info" %}
**Native SOL campaigns** set `mint = NATIVE_SOL_MINT` (all-zeros `PublicKey.default`). The `VestingTree` PDA itself holds lamports directly -- no vault ATA is created and `vault_authority` is unused.
{% endhint %}

---

## VestingTree

The primary campaign PDA. Stores all configuration, state flags, and aggregate counters for a vesting campaign.

### Account Layout

| Field | Type | Description |
|-------|------|-------------|
| `creator` | `Pubkey` | Campaign creator. Owns `fund`, `cancel`, `withdraw_unvested`, and `set_milestone_released`. |
| `mint` | `Pubkey` | SPL mint distributed by this campaign. `NATIVE_SOL_MINT` (all zeros) signals native SOL. |
| `vault` | `Pubkey` | ATA holding the campaign's tokens. Owned by `vault_authority`. |
| `vault_authority` | `Pubkey` | PDA = `["vault_authority", tree.key()]`. Signs SPL transfer CPIs. |
| `campaign_id` | `u64` | Caller-supplied identifier. Allows one creator+mint pair to host multiple campaigns. |
| `merkle_root` | `[u8; 32]` | Current Merkle root over the recipient set. Rotated by `update_root`. |
| `leaf_count` | `u32` | Number of leaves in the current Merkle tree. |
| `total_supply` | `u64` | Maximum funding cap for this campaign. |
| `total_claimed` | `u64` | Running sum of all tokens claimed across all beneficiaries. |
| `cancellable` | `bool` | If `false`, `cancel_campaign` is permanently rejected. |
| `cancel_authority` | `Option<Pubkey>` | Required when `cancellable` is `true`. Signs cancel, root rotation, and stream cancel. |
| `cancelled_at` | `Option<i64>` | Set by `cancel_campaign`. Unix timestamp that starts the 7-day grace timer. |
| `paused` | `bool` | Toggled by `pause_campaign` / `unpause_campaign`. Blocks claims when `true`. |
| `pause_authority` | `Option<Pubkey>` | If `None`, pause/unpause instructions are rejected with `NotPausable`. |
| `created_at` | `i64` | Unix seconds at campaign creation. |
| `min_cliff_time` | `i64` | Minimum `cliff_time` across all current leaves. Gates `instant_refund_campaign` eligibility. |
| `milestone_released_flags` | `[u8; 32]` | 256-bit bitmap of released milestones. Set by `set_milestone_released`. Gates milestone claims and blocks instant refund if any bit is set. |
| `instant_refunded` | `bool` | `true` after `instant_refund_campaign`. Permanently blocks `claim` and `set_milestone_released`. |
| `bump` | `u8` | PDA bump seed cache. |

### Helper Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `is_native()` | `bool` | Returns `true` when `mint == NATIVE_SOL_MINT`. Used internally to branch between SPL CPI and native lamport transfer logic. |

---

## ClaimRecord

Per-beneficiary, per-campaign PDA. Uses `#[account(zero_copy)]` with a fixed `repr(C)` layout for efficient access.

### Account Layout

| Field | Type | Description |
|-------|------|-------------|
| `beneficiary` | `Pubkey` | Must match the `claim` instruction signer. |
| `tree` | `Pubkey` | The `VestingTree` this record belongs to. |
| `claimed_amount` | `u64` | Running sum of all tokens claimed by this beneficiary across all leaves. Used by the `Claimed` event and `close_claim_record`. |
| `total_entitled` | `u64` | Running sum of every touched leaf's `amount` (all release types). Accumulated on first touch per leaf. Used by `close_claim_record` to determine if fully claimed. |
| `milestone_bitmap` | `[u8; 32]` | One bit per milestone index. Prevents double-claiming the same milestone slot. |
| `last_claim_at` | `i64` | Timestamp of most recent claim. For analytics and UX display. |
| `bump` | `u8` | PDA bump seed cache. |
| `version` | `u8` | Layout version. `0` = legacy (pre-Issue #29), `1` = per-leaf ledger active. |
| `leaf_claimed_idx` | `[u32; 8]` | Per-leaf ledger keys. `u32::MAX` indicates an empty slot. Milestone leaves do not consume slots. Max capacity: `PER_LEAF_CAP = 8`. |
| `leaf_claimed_amt` | `[u64; 8]` | Cumulative claimed amount per `leaf_index`. Source of truth for per-leaf claimable delta. |

### Claim Math

For cliff and linear leaves, the claimable amount is computed as:

```
claimable = vested(leaf, now) - leaf_claimed_amt[leaf_index]
```

Milestone leaves use the `milestone_bitmap` instead of the per-leaf ledger.

{% hint style="info" %}
The `update_root` instruction does not require changes to existing `ClaimRecord` accounts. The per-leaf ledger fills lazily as leaves are claimed against any root version.
{% endhint %}

### Legacy Migration

A legacy v0 `ClaimRecord` (121 data bytes, no per-leaf fields) is grown lazily to 224 data bytes via `AccountInfo::resize` plus a rent top-up on its next touch. The `zero_copy` loader reads the short account by discriminator so the handler can resize it transparently.

---

## VestingLeaf (Off-Chain)

`VestingLeaf` is **not** an on-chain account. It is a Borsh-serialized struct that lives off-chain inside the Merkle tree and is passed as an argument to `claim` along with the proof.

### Layout

| Field | Type | Offset | Description |
|-------|------|--------|-------------|
| `leaf_index` | `u32` | 0 | Position in the Merkle tree |
| `beneficiary` | `Pubkey` | 4 | Recipient wallet address |
| `amount` | `u64` | 36 | Token amount for this leaf |
| `release_type` | `u8` | 44 | `0` = Cliff, `1` = Linear, `2` = Milestone |
| `start_time` | `i64` | 45 | Vesting start timestamp |
| `cliff_time` | `i64` | 53 | Cliff timestamp |
| `end_time` | `i64` | 61 | Vesting end timestamp |
| `milestone_idx` | `u8` | 69 | Milestone index (for milestone release type) |

**Total size:** 70 bytes (Borsh little-endian).

{% hint style="warning" %}
**Field order is the wire order.** The TypeScript encoder must serialize bytes identically to the Rust encoder, or every claim will fail proof verification. A golden-vector test gates byte equality between Rust and TypeScript.
{% endhint %}

---

## Vault Authority and Vault ATA

The vault mechanism uses a two-layer PDA structure for secure token custody:

1. **`vault_authority`** is a PDA derived as `["vault_authority", vesting_tree.key()]`. It never holds tokens itself but acts as the signing authority for SPL Transfer CPIs from the vault.

2. **`vault`** is a standard Associated Token Account owned by `vault_authority`, with its mint set to the campaign's SPL mint. All campaign tokens are held here.

When a beneficiary claims tokens, the program invokes `spl_token::transfer` with `vault_authority` as the signer (using `invoke_signed` with the PDA seeds). This ensures tokens can only be released through program logic.

For **native SOL campaigns**, this mechanism is bypassed entirely. The `VestingTree` PDA itself holds lamports, and transfers are done via direct lamport manipulation on the PDA's account data.

---

## Account Sizes and Rent Costs

| Account | Space (bytes) | Approximate Rent (SOL) | Notes |
|---------|---------------|------------------------|-------|
| `VestingTree` | 8 + 315 = 323 | ~0.00224 | 8-byte Anchor discriminator + 315 bytes of data |
| `ClaimRecord` | 8 + 224 = 232 | ~0.00161 | `zero_copy` layout. Legacy 121-byte accounts are resized lazily on next touch. |

{% hint style="info" %}
`ClaimRecord` rent is paid by the beneficiary on first claim via `init_if_needed`. The rent can be reclaimed by calling `close_claim_record` after the beneficiary has fully claimed or after the grace period has elapsed.
{% endhint %}

---

## Constants

Defined in `programs/vesting/src/constants.rs`:

| Constant | Value | Description |
|----------|-------|-------------|
| `GRACE_PERIOD_SECS` | `604,800` (7 days) | Window after `cancel_campaign` during which beneficiaries may still claim before `withdraw_unvested` is allowed. |
| `MAX_MERKLE_PROOF_LEN` | `32` | Hard cap on proof sibling count per claim instruction. |
| `MAX_TREE_DEPTH` | `20` | Off-chain tree depth limit. Proof size is at most 640 bytes, which fits in a single transaction. |
| `PER_LEAF_CAP` | `8` | Maximum number of distinct cliff/linear leaves a single beneficiary can claim within one `ClaimRecord`. |
| `NATIVE_SOL_MINT` | `PublicKey::default` | All-zeros pubkey used as the mint marker for native SOL campaigns. |
