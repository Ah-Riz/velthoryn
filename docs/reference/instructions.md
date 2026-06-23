# Instruction Reference

The Velora vesting program exposes **18 on-chain handlers** organized across four categories: campaign lifecycle management, beneficiary claiming, single-recipient stream convenience wrappers, and a read-only view function.

**Program ID:** `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`

**Framework:** Anchor 1.0 | **Runtime:** Solana BPF

{% hint style="info" %}
The reference client package `@velthoryn/client` ships Merkle helpers (`prepareCampaign`, `verifyProof`, `leafHash`) but does not include an Anchor binding. Use `@coral-xyz/anchor` with the IDL for on-chain instruction calls.
{% endhint %}

---

## Common Setup

Every code example in this reference assumes the following imports and helpers:

```typescript
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import idl from "./vesting.json";
import { prepareCampaign, ReleaseType } from "@velthoryn/client";

const PROGRAM_ID = new PublicKey("G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu");
const program = new anchor.Program(idl as any, provider);
const NATIVE_SOL_MINT = PublicKey.default; // all-zeros marker for native SOL campaigns

const treePda = (creator: PublicKey, mint: PublicKey, campaignId: bigint) =>
  PublicKey.findProgramAddressSync(
    [
      Buffer.from("tree"),
      creator.toBuffer(),
      mint.toBuffer(),
      new BN(campaignId).toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID
  )[0];
```

---

## Campaign Lifecycle

### `create_campaign` / `create_campaign_native`

Initialize a `VestingTree` PDA with a Merkle root. The SPL variant also creates a vault ATA. The native variant sets `mint = NATIVE_SOL_MINT` and holds lamports directly on the PDA.

**Parameters (`CreateCampaignArgs`)**

| Field | Type | Description |
|-------|------|-------------|
| `campaign_id` | `u64` | Caller-supplied unique identifier for this campaign |
| `merkle_root` | `[u8; 32]` | Merkle root covering all recipient leaves |
| `leaf_count` | `u32` | Total number of leaves in the tree |
| `total_supply` | `u64` | Maximum tokens this campaign will distribute |
| `min_cliff_time` | `i64` | Minimum cliff time across all leaves (gates instant refund) |
| `cancellable` | `bool` | Whether the campaign can be cancelled |
| `cancel_authority` | `Option<Pubkey>` | Required when `cancellable` is true |
| `pause_authority` | `Option<Pubkey>` | Optional authority to pause/unpause claims |

**Accounts (SPL variant)**

| Account | Signer | Mutable | Description |
|---------|--------|---------|-------------|
| `creator` | Yes | Yes | Campaign creator, pays for account initialization |
| `mint` | No | No | SPL token mint for this campaign |
| `vesting_tree` | No | Yes | PDA to be initialized (seeds: `[tree, creator, mint, campaign_id]`) |
| `vault_authority` | No | No | PDA that owns the vault ATA |
| `vault` | No | Yes | Associated token account initialized for the vault |
| `token_program` | No | No | SPL Token Program |
| `associated_token_program` | No | No | Associated Token Program |
| `system_program` | No | No | System Program |
| `rent` | No | No | Rent sysvar |

**Error Codes**

| Code | Name | Condition |
|------|------|-----------|
| 6000 | `EmptyRoot` | Merkle root is all zeros |
| 6001 | `EmptyCampaign` | `leaf_count == 0` |
| 6002 | `ZeroAmount` | `total_supply == 0` |
| 6003 | `MissingCancelAuthority` | `cancellable` is true but `cancel_authority` is None |
| 6011 | `InvalidSchedule` | `min_cliff_time == 0` |

**Emits:** `CampaignCreated { tree, creator, mint, total_supply, leaf_count, cancellable }`

```typescript
const prepared = prepareCampaign(recipients);
const [vestingTree] = PublicKey.findProgramAddressSync(
  [Buffer.from("tree"), creator.toBuffer(), mint.toBuffer(),
   new BN(campaignId).toArrayLike(Buffer, "le", 8)],
  PROGRAM_ID
);

await program.methods
  .createCampaign({
    campaignId: new BN(campaignId),
    merkleRoot: [...prepared.root],
    leafCount: prepared.leafCount,
    totalSupply: new BN(prepared.totalSupply),
    minCliffTime: new BN(prepared.minCliffTime),
    cancellable,
    cancelAuthority: cancelAuthority ?? null,
    pauseAuthority: pauseAuthority ?? null,
  })
  .accounts({ creator, mint, vestingTree })
  .rpc();
```

---

### `fund_campaign` / `fund_campaign_native`

Deposit tokens (SPL) or lamports (native) into the campaign vault. Fails if the vault balance would exceed `total_supply`.

**Parameters**

| Field | Type | Description |
|-------|------|-------------|
| `amount` | `u64` | Number of tokens or lamports to deposit |

**Accounts (SPL variant)**

| Account | Signer | Mutable | Description |
|---------|--------|---------|-------------|
| `creator` | Yes | Yes | Must match `vesting_tree.creator` |
| `vesting_tree` | No | Yes | Campaign PDA (`has_one = creator`) |
| `vault` | No | Yes | Campaign vault ATA |
| `source_ata` | No | Yes | Creator's token account (mint + owner checked) |
| `token_program` | No | No | SPL Token Program |

**Error Codes**

| Code | Name | Condition |
|------|------|-----------|
| 6002 | `ZeroAmount` | `amount == 0` |
| 6005 | `Unauthorized` | Signer does not match `creator` |
| 6006 | `OverFunded` | Vault balance + amount would exceed `total_supply` |
| 6008 | `Overflow` | Arithmetic overflow |
| 6023 | `CampaignCancelled` | Campaign has been cancelled |

**Emits:** `CampaignFunded { tree, amount, vault_balance_after }`

```typescript
await program.methods
  .fundCampaign(new BN(amount))
  .accounts({ creator, vestingTree, vault, sourceAta, tokenProgram: TOKEN_PROGRAM_ID })
  .rpc();
```

---

### `update_root`

Rotate the Merkle root to replace the entire recipient set. Signed by `cancel_authority`.

**Parameters**

| Field | Type | Description |
|-------|------|-------------|
| `new_root` | `[u8; 32]` | New Merkle root |
| `new_leaf_count` | `u32` | New leaf count |
| `new_min_cliff_time` | `i64` | Updated minimum cliff time for the new leaf set |

**Accounts**

| Account | Signer | Mutable | Description |
|---------|--------|---------|-------------|
| `cancel_authority` | Yes | No | Must match `vesting_tree.cancel_authority` |
| `vesting_tree` | No | Yes | Campaign PDA |

**Error Codes**

| Code | Name | Condition |
|------|------|-----------|
| 6000 | `EmptyRoot` | New root is all zeros |
| 6001 | `EmptyCampaign` | `new_leaf_count == 0` |
| 6004 | `SameRoot` | New root matches current root |
| 6005 | `Unauthorized` | Signer mismatch |
| 6011 | `InvalidSchedule` | Invalid `new_min_cliff_time` |
| 6019 | `NotCancellable` | Campaign is not cancellable |
| 6023 | `CampaignCancelled` | Campaign is cancelled |

{% hint style="info" %}
Root rotation is allowed while the campaign is paused (trusted admin operation).
{% endhint %}

**Emits:** `RootUpdated { tree, old_root, new_root, new_leaf_count }`

```typescript
const rotated = prepareCampaign(newRecipients);
await program.methods
  .updateRoot([...rotated.root], rotated.leafCount, new BN(rotated.minCliffTime))
  .accounts({ cancelAuthority, vestingTree })
  .signers([cancelAuthority])
  .rpc();
```

---

### `cancel_campaign`

Cancel a campaign and start the 7-day grace period. Does not move funds. Beneficiaries may still claim during the grace window; the creator withdraws the remainder afterward via `withdraw_unvested`.

**Parameters:** None

**Accounts**

| Account | Signer | Mutable | Description |
|---------|--------|---------|-------------|
| `cancel_authority` | Yes | No | Must match `vesting_tree.cancel_authority` |
| `vesting_tree` | No | Yes | Campaign PDA |

**Error Codes**

| Code | Name | Condition |
|------|------|-----------|
| 6005 | `Unauthorized` | Signer mismatch |
| 6019 | `NotCancellable` | Campaign is not cancellable |
| 6020 | `AlreadyCancelled` | Campaign is already cancelled |
| 6031 | `FullyVested` | All tokens have been claimed |

**Emits:** `CampaignCancelled { tree, cancelled_at, claimed_at_cancel }`

```typescript
await program.methods
  .cancelCampaign()
  .accounts({ cancelAuthority, vestingTree })
  .signers([cancelAuthority])
  .rpc();
```

---

### `withdraw_unvested`

After the 7-day grace period, the creator withdraws the entire remaining vault balance.

**Parameters:** None

**Accounts (SPL variant)**

| Account | Signer | Mutable | Description |
|---------|--------|---------|-------------|
| `creator` | Yes | Yes | Must match `vesting_tree.creator` |
| `vesting_tree` | No | Yes | Must have `cancelled_at` set |
| `vault_authority` | No | No | Vault authority PDA |
| `vault` | No | Yes | Campaign vault ATA |
| `creator_ata` | No | Yes | Creator's token account to receive funds |
| `token_program` | No | No | SPL Token Program |

**Error Codes**

| Code | Name | Condition |
|------|------|-----------|
| 6015 | `NothingToClaim` | No tokens remaining in vault |
| 6026 | `NotCancelled` | Campaign has not been cancelled |
| 6027 | `GracePeriodActive` | 7-day grace period has not elapsed |

{% hint style="warning" %}
For native SOL campaigns, the transfer preserves the rent-exempt minimum so the PDA remains queryable after withdrawal.
{% endhint %}

**Emits:** `UnvestedWithdrawn { tree, amount }`

```typescript
await program.methods
  .withdrawUnvested()
  .accounts({
    creator, vestingTree, vaultAuthority, vault, creatorAta,
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  })
  .rpc();
```

---

### `instant_refund_campaign`

Multi-leaf campaigns only, **before** `min_cliff_time`. Refunds the entire vault to the creator immediately, cancels the campaign, and sets the `instant_refunded` flag.

**Parameters:** None

**Accounts (SPL variant)**

| Account | Signer | Mutable | Description |
|---------|--------|---------|-------------|
| `creator` | Yes | Yes | Campaign creator |
| `vesting_tree` | No | Yes | Campaign PDA |
| `vault_authority` | No | No | Vault authority PDA |
| `vault` | No | Yes | Campaign vault ATA |
| `creator_ata` | No | Yes | Creator's token account |
| `token_program` | No | No | SPL Token Program |

**Error Codes**

| Code | Name | Condition |
|------|------|-----------|
| 6015 | `NothingToClaim` | No tokens in vault |
| 6034 | `MilestoneAlreadyReleased` | A milestone flag has been set |
| 6035 | `InstantRefundedCampaign` | Already instant refunded |
| 6036 | `CampaignAlreadyStarted` | `now >= min_cliff_time` (campaign has started) |
| 6040 | `NotMultiLeafCampaign` | `leaf_count == 1` (use `cancel_stream` instead) |

{% hint style="warning" %}
After an instant refund, all `claim`, `withdraw`, and `set_milestone_released` calls are permanently blocked with error `InstantRefundedCampaign` (6035).
{% endhint %}

**Emits:** `InstantRefunded { tree, cancelled_at, refunded_to, amount }`

```typescript
await program.methods
  .instantRefundCampaign()
  .accounts({
    creator, vestingTree, vaultAuthority, vault, creatorAta,
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  })
  .rpc();
```

---

### `pause_campaign` / `unpause_campaign`

Toggle the `paused` flag on a campaign. Signed by `pause_authority`. While paused, `claim` and `withdraw` are blocked unless the campaign is also cancelled (grace claims are allowed).

**Parameters:** None

**Accounts**

| Account | Signer | Mutable | Description |
|---------|--------|---------|-------------|
| `pause_authority` | Yes | No | Must match `vesting_tree.pause_authority` |
| `vesting_tree` | No | Yes | Campaign PDA |

**Error Codes (pause)**

| Code | Name | Condition |
|------|------|-----------|
| 6005 | `Unauthorized` | Signer mismatch |
| 6021 | `NotPausable` | No `pause_authority` was set on this campaign |
| 6022 | `AlreadyPaused` | Campaign is already paused |
| 6023 | `CampaignCancelled` | Campaign is cancelled |
| 6025 | `CampaignCompleted` | All tokens fully claimed |

**Error Codes (unpause)**

| Code | Name | Condition |
|------|------|-----------|
| 6024 | `NotPaused` | Campaign is not paused |
| 6025 | `CampaignCompleted` | All tokens fully claimed |

**Emits:** `CampaignPaused { tree }` / `CampaignUnpaused { tree }`

```typescript
await program.methods
  .pauseCampaign()
  .accounts({ pauseAuthority, vestingTree })
  .signers([pauseAuthority])
  .rpc();

// Resume:
await program.methods
  .unpauseCampaign()
  .accounts({ pauseAuthority, vestingTree })
  .signers([pauseAuthority])
  .rpc();
```

---

## Claiming

### `claim`

The primary claim path for multi-leaf campaigns. The beneficiary proves membership with a Merkle proof.

**Parameters**

| Field | Type | Description |
|-------|------|-------------|
| `leaf` | `VestingLeaf` | 70-byte leaf struct (see [Accounts & State](accounts-and-state.md)) |
| `proof` | `Vec<[u8; 32]>` | Merkle proof sibling hashes |

**Accounts**

| Account | Signer | Mutable | Description |
|---------|--------|---------|-------------|
| `beneficiary` | Yes | Yes | Must match `leaf.beneficiary` |
| `vesting_tree` | No | Yes | Campaign PDA |
| `claim_record` | No | Yes | Initialized on first claim (PDA seeds: `[claim, tree, beneficiary]`) |
| `vault_authority` | No | No | Vault authority PDA |
| `vault` | No | Yes | Campaign vault ATA |
| `beneficiary_ata` | No | Yes | Beneficiary's token account (initialized if needed) |
| `mint` | No | No | SPL token mint |
| `token_program` | No | No | SPL Token Program |
| `associated_token_program` | No | No | Associated Token Program |
| `system_program` | No | No | System Program |

**Error Codes (checked in order)**

| Code | Name | Condition |
|------|------|-----------|
| 6035 | `InstantRefundedCampaign` | Campaign was instant refunded |
| 6009 | `CampaignPaused` | Campaign is paused (unless cancelled -- grace claims allowed) |
| 6010 | `UnauthorizedClaimer` | Signer does not match `leaf.beneficiary` |
| 6011 | `InvalidSchedule` | Schedule time constraints violated |
| 6012 | `InvalidScheduleType` | `release_type` not in `{0, 1, 2}` |
| 6030 | `ProofTooLong` | Proof exceeds `MAX_MERKLE_PROOF_LEN` (32) |
| 6013 | `InvalidProof` | Merkle proof verification failed |
| 6014 | `MilestoneAlreadyClaimed` | Milestone bit already set in claim record |
| 6033 | `MilestoneNotReleased` | Creator has not released this milestone |
| 6032 | `StreamExpired` | Schedule ended with 0 claimable |
| 6015 | `NothingToClaim` | Claimable amount is 0 |
| 6016 | `InsufficientVault` | Vault balance less than claimable amount |
| 6017 | `OverClaim` | Would exceed `total_supply` |
| 6038 | `NativeSolRentViolation` | Native SOL transfer would break rent exemption |

**Emits:** `Claimed { tree, beneficiary, leaf_index, amount, total_claimed_by_user, total_claimed_overall, milestone_idx }`

```typescript
// 1. Fetch leaf + proof from the API
// GET /api/campaigns/<tree>/proof?beneficiary=<wallet>

// 2. Submit the claim
await program.methods
  .claim(leafStruct, proofAsNumberArrays)
  .accounts({
    beneficiary: wallet.publicKey, vestingTree, claimRecord,
    vaultAuthority, vault, beneficiaryAta, mint,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

---

### `withdraw`

Simplified claim path for single-recipient streams (`leaf_count == 1`). The beneficiary supplies schedule args directly; `leaf_hash` is checked against the stored `merkle_root` without a proof array.

**Parameters (`WithdrawArgs`)**

| Field | Type | Description |
|-------|------|-------------|
| `release_type` | `u8` | `0` = Cliff, `1` = Linear, `2` = Milestone |
| `start_time` | `i64` | Vesting start timestamp |
| `cliff_time` | `i64` | Cliff timestamp |
| `end_time` | `i64` | Vesting end timestamp |
| `milestone_idx` | `u8` | Milestone index (for milestone type) |

**Accounts**

| Account | Signer | Mutable | Description |
|---------|--------|---------|-------------|
| `beneficiary` | Yes | Yes | Must match the stream beneficiary |
| `vesting_tree` | No | Yes | Campaign PDA (`leaf_count == 1`) |
| `claim_record` | No | Yes | Initialized on first withdrawal |
| `vault_authority` | No | No | Vault authority PDA |
| `vault` | No | Yes | Campaign vault ATA |
| `mint` | No | No | SPL token mint |
| `beneficiary_ata` | No | Yes | Beneficiary's token account |
| `token_program` | No | No | SPL Token Program |
| `associated_token_program` | No | No | Associated Token Program |
| `system_program` | No | No | System Program |

**Error Codes:** Same family as `claim` plus `NotSingleStream` (6029) when `leaf_count != 1`.

**Emits:** `Claimed { ..., leaf_index: 0 }`

```typescript
await program.methods
  .withdraw({
    releaseType, startTime, cliffTime, endTime, milestoneIdx,
  })
  .accounts({
    beneficiary: wallet.publicKey, vestingTree, claimRecord, vaultAuthority,
    vault, mint, beneficiaryAta, tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

---

### `cancel_stream`

Creator cancels a single-recipient stream. Sends the vested portion to the beneficiary and the remainder back to the creator in a single transaction.

**Parameters:** `WithdrawArgs` (same as `withdraw`)

**Accounts**

| Account | Signer | Mutable | Description |
|---------|--------|---------|-------------|
| `creator` | Yes | Yes | Must match `vesting_tree.creator` |
| `beneficiary` | No | Yes | Stream recipient |
| `vesting_tree` | No | Yes | Campaign PDA (`leaf_count == 1`) |
| `claim_record` | No | Yes | Initialized if needed |
| `vault_authority` | No | No | Vault authority PDA |
| `vault` | No | Yes | Campaign vault ATA |
| `beneficiary_ata` | No | Yes | Beneficiary's token account |
| `creator_ata` | No | Yes | Creator's token account for remainder |
| `token_program` | No | No | SPL Token Program |

**Error Codes**

| Code | Name | Condition |
|------|------|-----------|
| 6005 | `Unauthorized` | Signer does not match creator |
| 6013 | `InvalidProof` | Leaf hash mismatch |
| 6015 | `NothingToClaim` | No tokens to distribute |
| 6016 | `InsufficientVault` | Vault balance insufficient |
| 6017 | `OverClaim` | Would exceed total supply |
| 6019 | `NotCancellable` | Campaign is not cancellable |
| 6020 | `AlreadyCancelled` | Campaign already cancelled |
| 6029 | `NotSingleStream` | `leaf_count != 1` |
| 6031 | `FullyVested` | All tokens already claimed |

**Emits:** `StreamCancelled { tree, cancelled_at, amount_to_beneficiary, amount_to_creator }`

```typescript
await program.methods
  .cancelStream({ releaseType, startTime, cliffTime, endTime, milestoneIdx })
  .accounts({
    creator, beneficiary, vestingTree, claimRecord,
    systemProgram: SystemProgram.programId,
    vaultAuthority, vault, beneficiaryAta, creatorAta,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

---

### `set_milestone_released`

Creator releases a milestone by setting a bit in `milestone_released_flags`, enabling beneficiaries to claim that milestone leaf.

**Parameters**

| Field | Type | Description |
|-------|------|-------------|
| `milestone_idx` | `u8` | Index of the milestone to release (0-255) |

**Accounts**

| Account | Signer | Mutable | Description |
|---------|--------|---------|-------------|
| `creator` | Yes | No | Must match `vesting_tree.creator` |
| `vesting_tree` | No | Yes | Campaign PDA |

**Error Codes**

| Code | Name | Condition |
|------|------|-----------|
| 6005 | `Unauthorized` | Signer mismatch |
| 6034 | `MilestoneAlreadyReleased` | Milestone bit already set |
| 6035 | `InstantRefundedCampaign` | Campaign was instant refunded |

**Emits:** `MilestoneReleased { tree, milestone_idx, released_by }`

```typescript
await program.methods
  .setMilestoneReleased(milestoneIdx)
  .accounts({ creator, vestingTree })
  .rpc();
```

---

### `close_claim_record`

Reclaim the rent of a `ClaimRecord` PDA. Allowed only when the beneficiary has fully claimed their entitlement or after the grace period has elapsed.

**Parameters:** None

**Accounts**

| Account | Signer | Mutable | Description |
|---------|--------|---------|-------------|
| `beneficiary` | Yes | Yes | Must match `claim_record.beneficiary`; receives rent refund |
| `vesting_tree` | No | No | Campaign PDA (read-only) |
| `claim_record` | No | Yes | PDA to close (seeds: `[claim, tree, beneficiary]`) |

**Error Codes**

| Code | Name | Condition |
|------|------|-----------|
| 6005 | `Unauthorized` | Signer mismatch |
| 6018 | `WrongVault` | Provided vault does not match campaign |
| 6028 | `CannotClose` | Not fully claimed and grace period not elapsed |

**Emits:** `ClaimRecordClosed { tree, beneficiary }`

```typescript
await program.methods
  .closeClaimRecord()
  .accounts({ beneficiary: wallet.publicKey, vestingTree, claimRecord })
  .rpc();
```

---

## Single-Recipient Streams

### `create_stream` / `create_stream_native`

Create a single-recipient campaign **and** fund it in one transaction. The on-chain program computes the Merkle root from the single leaf. The beneficiary later claims via `withdraw` (not `claim`).

**Parameters (`CreateStreamArgs`)**

| Field | Type | Description |
|-------|------|-------------|
| `campaign_id` | `u64` | Unique campaign identifier |
| `beneficiary` | `Pubkey` | Recipient wallet address |
| `amount` | `u64` | Total tokens to vest |
| `release_type` | `u8` | `0` = Cliff, `1` = Linear, `2` = Milestone |
| `start_time` | `i64` | Vesting start timestamp |
| `cliff_time` | `i64` | Cliff timestamp |
| `end_time` | `i64` | Vesting end timestamp |
| `milestone_idx` | `u8` | Milestone index (for milestone type) |
| `cancellable` | `bool` | Whether the stream can be cancelled |
| `cancel_authority` | `Option<Pubkey>` | Required when `cancellable` is true |
| `pause_authority` | `Option<Pubkey>` | Optional pause authority |

**Accounts (SPL variant)**

| Account | Signer | Mutable | Description |
|---------|--------|---------|-------------|
| `creator` | Yes | Yes | Stream creator |
| `mint` | No | No | SPL token mint |
| `vesting_tree` | No | Yes | PDA to initialize |
| `vault_authority` | No | No | Vault authority PDA |
| `vault` | No | Yes | Vault ATA to initialize and fund |
| `source_ata` | No | Yes | Creator's token account (funding source) |
| `token_program` | No | No | SPL Token Program |
| `associated_token_program` | No | No | Associated Token Program |
| `system_program` | No | No | System Program |
| `rent` | No | No | Rent sysvar |

**Error Codes**

| Code | Name | Condition |
|------|------|-----------|
| 6002 | `ZeroAmount` | `amount == 0` |
| 6003 | `MissingCancelAuthority` | `cancellable` is true but no `cancel_authority` |
| 6011 | `InvalidSchedule` | Schedule time constraints violated |
| 6012 | `InvalidScheduleType` | Invalid `release_type` value |

**Emits:** `CampaignCreated` followed by `CampaignFunded`

```typescript
await program.methods
  .createStream({
    campaignId: new BN(campaignId),
    beneficiary,
    amount: new BN(amount),
    releaseType,
    startTime: new BN(startTime),
    cliffTime: new BN(cliffTime),
    endTime: new BN(endTime),
    milestoneIdx,
    cancellable,
    cancelAuthority: cancelAuthority ?? null,
    pauseAuthority: pauseAuthority ?? null,
  })
  .accounts({
    creator, mint, vestingTree, vaultAuthority, vault, sourceAta,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .rpc();
```

---

## View Function

### `get_vested_amount`

Read-only computation with no accounts. Returns the vested amount for a leaf at a given time, clamping to `cancelled_at` if supplied. Use this to preview a claim before submitting.

**Parameters**

| Field | Type | Description |
|-------|------|-------------|
| `leaf` | `VestingLeaf` | Leaf struct to evaluate |
| `cancelled_at` | `Option<i64>` | Campaign cancellation timestamp (clamps the vesting curve) |
| `now` | `i64` | Current timestamp for calculation |
| `milestone_released_flags` | `Option<[u8; 32]>` | Milestone bitmap; returns full amount only if flag is set |

**Returns:** `u64` -- the vested amount at time `now`

```typescript
const vestedNow = await program.methods
  .getVestedAmount(leafStruct, cancelledAt ?? null, new BN(now), milestoneReleasedFlags ?? null)
  .view();
```

---

## On-Chain Events

All events carry the `tree` pubkey plus relevant deltas. Indexers should subscribe to these for real-time state tracking.

| Event | Fields |
|-------|--------|
| `CampaignCreated` | `tree`, `creator`, `mint`, `total_supply`, `leaf_count`, `cancellable` |
| `CampaignFunded` | `tree`, `amount`, `vault_balance_after` |
| `Claimed` | `tree`, `beneficiary`, `leaf_index`, `amount`, `total_claimed_by_user`, `total_claimed_overall`, `milestone_idx` |
| `CampaignCancelled` | `tree`, `cancelled_at`, `claimed_at_cancel` |
| `RootUpdated` | `tree`, `old_root`, `new_root`, `new_leaf_count` |
| `UnvestedWithdrawn` | `tree`, `amount` |
| `CampaignPaused` | `tree` |
| `CampaignUnpaused` | `tree` |
| `ClaimRecordClosed` | `tree`, `beneficiary` |
| `MilestoneReleased` | `tree`, `milestone_idx`, `released_by` |
| `StreamCancelled` | `tree`, `cancelled_at`, `amount_to_beneficiary`, `amount_to_creator` |
| `InstantRefunded` | `tree`, `cancelled_at`, `refunded_to`, `amount` |
