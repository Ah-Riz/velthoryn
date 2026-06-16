# Instruction Reference — Vesting Program

**Program ID:** `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`
**IDL:** `target/idl/vesting.json` (copy: `apps/web/src/lib/anchor/idl.json`)
**Framework:** Anchor 1.0 · **Runtime:** Solana BPF

This is the complete reference for every instruction. Each entry lists the signature, the
accounts the caller must provide (with on-chain constraints), the arguments, the happy-path
behavior, the error codes it can return, and a working TypeScript snippet.

> The reference client package `@velthoryn/client` ships the **Merkle** helpers
> (`prepareCampaign`, `verifyProof`, `leafHash`, …) but **not** an Anchor binding. For
> on-chain instruction calls, use `@coral-xyz/anchor` with the IDL, as shown below.

---

## Setup (used by every snippet)

```ts
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import idl from "./vesting.json";                 // target/idl/vesting.json
import { prepareCampaign, ReleaseType } from "@velthoryn/client";

const PROGRAM_ID = new PublicKey("G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu");
const program = new anchor.Program(idl as any, provider);
const NATIVE_SOL_MINT = PublicKey.default;        // all-zeros marker for native-SOL campaigns

/** PDA helpers — the seeds below are authoritative. */
const treePda = (creator: PublicKey, mint: PublicKey, campaignId: bigint) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("tree"), creator.toBuffer(), mint.toBuffer(),
     Buffer.from(campaignId.toString(16).padStart(16, "0"), "hex") /* u64 LE */],
    PROGRAM_ID)[0];
// NOTE: campaignId is u64 little-endian — use `new BN(campaignId).toArrayLike(Buffer, "le", 8)`.
```

---

## Accounts model

| Account | Seeds | Created by | Holds |
|---------|-------|-----------|-------|
| `VestingTree` | `[b"tree", creator, mint, campaign_id]` | `create_campaign` / `create_stream` | Campaign config + `merkle_root` + counters |
| `ClaimRecord` | `[b"claim", vesting_tree, beneficiary]` | lazily by `claim` / `withdraw` / `cancel_stream` | `#[account(zero_copy)]`; `claimed_amount` (sum), `total_entitled`, `milestone_bitmap`, per-leaf ledger (`leaf_claimed_idx`/`leaf_claimed_amt`, `PER_LEAF_CAP=8`) |
| `vault_authority` | `[b"vault_authority", vesting_tree]` | derived (signer PDA for SPL CPI) | — |
| `vault` (ATA) | associated to `vault_authority`, mint = campaign mint | `create_campaign` / `create_stream` | the SPL tokens |

**Native-SOL campaigns** set `mint = NATIVE_SOL_MINT` (all-zeros `PublicKey.default`); the
`VestingTree` PDA itself holds the lamports (no vault ATA, `vault_authority` unused).

**Constants** (`programs/vesting/src/constants.rs`):
- `GRACE_PERIOD_SECS = 604_800` (7 days) — window after `cancel_campaign` during which beneficiaries may still claim before `withdraw_unvested` is allowed.
- `MAX_MERKLE_PROOF_LEN = 32` — hard cap on proof siblings per claim.
- `MAX_TREE_DEPTH = 20` — off-chain tree-depth limit (proof ≤ 640 bytes, fits a tx).

---

## 1. Campaign lifecycle

### `create_campaign(args)` / `create_campaign_native(args)`
Initialize a `VestingTree` PDA with a Merkle root + (for SPL) a vault ATA.

- **Args (`CreateCampaignArgs`):** `campaign_id: u64`, `merkle_root: [u8;32]`, `leaf_count: u32`, `total_supply: u64`, `min_cliff_time: i64`, `cancellable: bool`, `cancel_authority: Option<Pubkey>`, `pause_authority: Option<Pubkey>`.
- **Accounts (SPL):** `creator` (signer, mut), `mint`, `vesting_tree` (init), `vault_authority` (PDA), `vault` (init ATA), `token_program`, `associated_token_program`, `system_program`, `rent`.
- **Native variant:** no `mint`/`vault`/`vault_authority`; `mint` is set to `NATIVE_SOL_MINT`. The tree PDA holds lamports directly.
- **Guards:** `EmptyRoot` (6000), `EmptyCampaign` (6001), `ZeroAmount` (6002), `InvalidSchedule` (6011, `min_cliff_time != 0`), `MissingCancelAuthority` (6003 if `cancellable && cancel_authority.is_none()`).
- **Emits:** `CampaignCreated { tree, creator, mint, total_supply, leaf_count, cancellable }`.

```ts
const prepared = prepareCampaign(recipients);     // from @velthoryn/client
const [vestingTree] = PublicKey.findProgramAddressSync(
  [Buffer.from("tree"), creator.toBuffer(), mint.toBuffer(), new BN(campaignId).toArrayLike(Buffer, "le", 8)],
  PROGRAM_ID);
await program.methods
  .createCampaign({                               // CreateCampaignArgs — single struct, not positional
    campaignId: new BN(campaignId),
    merkleRoot: [...prepared.root],               // number[32]
    leafCount: prepared.leafCount,                // u32
    totalSupply: new BN(prepared.totalSupply),    // u64
    minCliffTime: new BN(prepared.minCliffTime),  // i64
    cancellable,
    cancelAuthority: cancelAuthority ?? null,     // Option<Pubkey>
    pauseAuthority: pauseAuthority ?? null,       // Option<Pubkey>
  })
  .accounts({ creator, mint, vestingTree /* + vault_authority, vault, token_program, … */ })
  .rpc();
```

### `fund_campaign(amount)` / `fund_campaign_native(amount)`
Deposit tokens (SPL) or lamports (native) into the campaign vault. Fails if the vault would exceed `total_supply`.

- **Args:** `amount: u64`.
- **Accounts:** `creator` (signer, mut), `vesting_tree` (mut, `has_one=creator`, `has_one=vault`), `vault` (mut), `source_ata` (mut, mint + owner checks), `token_program`. Native: no `vault`/`source_ata`; uses `system_program`.
- **Guards:** `ZeroAmount` (6002), `CampaignCancelled` (6023), `Overflow` (6008), `OverFunded` (6006). `Unauthorized` (6005) if `has_one=creator` fails.
- **Emits:** `CampaignFunded { tree, amount, vault_balance_after }`.

```ts
await program.methods
  .fundCampaign(new BN(amount))                    // u64; fails with OverFunded (6006) past total_supply
  .accounts({ creator, vestingTree, vault, sourceAta, tokenProgram: TOKEN_PROGRAM_ID })
  .rpc();
```

### `update_root(new_root, new_leaf_count, new_min_cliff_time)`
Rotate the Merkle root (replace the entire recipient set). Signed by `cancel_authority`.

- **Accounts:** `cancel_authority` (signer), `vesting_tree` (mut).
- **Guards:** `EmptyRoot` (6000), `EmptyCampaign` (6001), `InvalidSchedule` (6011), `SameRoot` (6004), `NotCancellable` (6019), `CampaignCancelled` (6023), `Unauthorized` (6005).
- **Emits:** `RootUpdated { tree, old_root, new_root, new_leaf_count }`.
- **Note:** allowed while `paused` (trusted admin op). See ADR-001 / SC-FIND-05.

```ts
const rotated = prepareCampaign(newRecipients);    // @velthoryn/client — recompute root + counts
await program.methods
  .updateRoot([...rotated.root], rotated.leafCount, new BN(rotated.minCliffTime))
  .accounts({ cancelAuthority, vestingTree })
  .signers([cancelAuthority])
  .rpc();
```

### `cancel_campaign()`
Cancel a campaign; starts the 7-day grace period. Does **not** move funds — beneficiaries may still claim during grace; the creator withdraws the remainder afterward via `withdraw_unvested`.

- **Accounts:** `cancel_authority` (signer), `vesting_tree` (mut).
- **Guards:** `NotCancellable` (6019), `AlreadyCancelled` (6020), `Unauthorized` (6005), `FullyVested` (6031).
- **Emits:** `CampaignCancelled { tree, cancelled_at, claimed_at_cancel }`.

```ts
await program.methods
  .cancelCampaign()                                // no args; starts the 7-day grace period
  .accounts({ cancelAuthority, vestingTree })
  .signers([cancelAuthority])
  .rpc();
```

### `withdraw_unvested()`
**After** the grace period, the creator withdraws the entire remaining vault balance (all unvested tokens).

- **Accounts:** `creator` (signer, mut), `vesting_tree` (mut, `has_one=creator`, `cancelled_at.is_some()`), `vault_authority`, `vault`, `creator_ata`, `token_program`. Native: `system_program`.
- **Guards:** `NotCancelled` (6026), `GracePeriodActive` (6027), `NothingToClaim` (6015).
- **Native behavior:** transfers `balance − rent_min` (preserves rent-exempt so the PDA stays queryable — SC-FIND-02 fix). Emits `UnvestedWithdrawn { tree, amount }`.

```ts
// ONLY after the 7-day grace has elapsed (GracePeriodActive = 6027 until then)
await program.methods
  .withdrawUnvested()
  .accounts({ creator, vestingTree, vaultAuthority, vault, creatorAta,
              tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
  .rpc();
```

### `instant_refund_campaign()`
Multi-leaf campaigns only, **before** `min_cliff_time`: refund the entire vault to the creator immediately (cancels + sets `instant_refunded`).

- **Accounts:** `creator` (signer, mut), `vesting_tree` (mut). Native-SOL adds `system_program`; SPL adds `vault_authority`, `vault`, `creator_ata`, `token_program`.
- **Guards:** `NotMultiLeafCampaign` (6040), `CampaignAlreadyStarted` (6036, `now < min_cliff_time`), `MilestoneAlreadyReleased` (6034, if any flag set), `NothingToClaim` (6015). Plus `NotCancellable`/`AlreadyCancelled`/`Unauthorized`/`FullyVested`.
- **Emits:** `InstantRefunded { tree, cancelled_at, refunded_to, amount }`.
- **After instant refund:** `claim`/`withdraw` are blocked (`InstantRefundedCampaign` 6035).

```ts
// multi-leaf only, before min_cliff_time, no milestone released yet
await program.methods
  .instantRefundCampaign()                         // no args; drains vault/PDA back to creator
  .accounts({ creator, vestingTree, vaultAuthority, vault, creatorAta,
              tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
  .rpc();
```

### `pause_campaign()` / `unpause_campaign()`
Toggle `paused`. Signed by `pause_authority`.

- **Guards (pause):** `NotPausable` (6021), `Unauthorized` (6005), `CampaignCancelled` (6023), `CampaignCompleted` (6025), `AlreadyPaused` (6022).
- **Guards (unpause):** `CampaignCompleted` (6025), `NotPaused` (6024).
- **Emits:** `CampaignPaused` / `CampaignUnpaused`. While paused, `claim`/`withdraw` are blocked (`CampaignPaused` 6009) unless the campaign is also cancelled (grace claims allowed).

```ts
await program.methods
  .pauseCampaign()                                 // no args
  .accounts({ pauseAuthority, vestingTree })
  .signers([pauseAuthority])
  .rpc();
// resume with the same accounts: program.methods.unpauseCampaign()
```

---

## 2. Beneficiary claims

### `claim(leaf, proof)`
The primary claim path for multi-leaf campaigns. The beneficiary proves membership with a Merkle proof.

- **Args:** `leaf: VestingLeaf` (70 bytes: `leaf_index u32, beneficiary, amount u64, release_type u8, start_time i64, cliff_time i64, end_time i64, milestone_idx u8`), `proof: Vec<[u8;32]>`.
- **Accounts:** `beneficiary` (signer, mut), `vesting_tree` (mut), `claim_record` (init_if_needed), `vault_authority`, `vault`, `beneficiary_ata` (init_if_needed), `mint`, `token_program`, `associated_token_program`, `system_program`.
- **Guards (order):** `InstantRefundedCampaign` (6035) → `CampaignPaused` (6009, unless cancelled) → `UnauthorizedClaimer` (6010, `signer == leaf.beneficiary`) → `InvalidSchedule` (6011) → `InvalidScheduleType` (6012) → `ProofTooLong` (6030) → `InvalidProof` (6013) → milestone: `MilestoneAlreadyClaimed` (6014) / `MilestoneNotReleased` (6033) → `StreamExpired` (6032) → `NothingToClaim` (6015) → `InsufficientVault` (6016) → `OverClaim` (6017) → native: `NativeSolRentViolation` (6038).
- **Emits:** `Claimed { tree, beneficiary, leaf_index, amount, total_claimed_by_user, total_claimed_overall, milestone_idx }`.

```ts
// 1. fetch the leaf + proof (BE: GET /api/campaigns/<tree>/proof?beneficiary=<ben>)
// 2. submit the claim
await program.methods
  .claim(leafStruct, proofAsNumberArrays)            // leaf from the BE; proof = number[][]
  .accounts({ beneficiary: wallet.publicKey, vestingTree, claimRecord,
              vaultAuthority, vault, beneficiaryAta, mint,
              tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId })
  .rpc();
```

> **Issue #29 — FIXED on-chain (2026-06-16; ADR-003 superseded).** `ClaimRecord` now tracks
> `claimable` per leaf (`vested(leaf) − leaf_claimed_amt[leaf_index]`), so a beneficiary may hold
> multiple cliff/linear leaves and be paid each in full (never over-pays). The BE `prepare`/`import`
> guards that rejected this shape remain until a follow-up PR removes them. Multiple milestone
> leaves per beneficiary were always fine (guarded by the milestone bitmap).

### `withdraw(args)`
Single-stream claim (`leaf_count == 1` only). The beneficiary supplies the schedule args
directly; `leaf_hash` is checked against `tree.merkle_root` (no proof array).

- **Args:** `WithdrawArgs { release_type, start_time, cliff_time, end_time, milestone_idx }`.
- **Guards:** same family as `claim` (`InstantRefundedCampaign`, `CampaignPaused`, `UnauthorizedClaimer`, `InvalidSchedule`, `InvalidProof`, milestone, `NothingToClaim`, `InsufficientVault`, `OverClaim`, `NativeSolRentViolation`) + `NotSingleStream` (6029). Includes the `instant_refunded` guard added in Week 9 (SC-FIND-03).
- **Emits:** `Claimed { …, leaf_index: 0 }`.

```ts
await program.methods
  .withdraw({                                      // WithdrawArgs — single struct
    releaseType, startTime, cliffTime, endTime, milestoneIdx,
  })
  .accounts({ beneficiary: wallet.publicKey, vestingTree, claimRecord, vaultAuthority,
              vault, mint, beneficiaryAta, tokenProgram: TOKEN_PROGRAM_ID,
              associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId })
  .rpc();
```

### `cancel_stream(args)`
Creator cancels a single-recipient stream: sends the vested portion to the beneficiary and the remainder back to the creator in one tx.

- **Args:** `WithdrawArgs`.
- **Accounts:** `creator` (signer, mut), `beneficiary` (mut), `vesting_tree` (mut, `leaf_count==1`), `claim_record` (init_if_needed), `vault_authority`, `vault`, `beneficiary_ata`, `creator_ata`, `token_program`.
- **Guards:** `NotSingleStream` (6029), `NotCancellable` (6019), `AlreadyCancelled` (6020), `FullyVested` (6031), `Unauthorized` (6005), `InvalidProof` (6013), `InsufficientVault` (6016), `NothingToClaim` (6015), `OverClaim` (6017).
- **Emits:** `StreamCancelled { tree, cancelled_at, amount_to_beneficiary, amount_to_creator }`.

```ts
await program.methods
  .cancelStream({ releaseType, startTime, cliffTime, endTime, milestoneIdx }) // WithdrawArgs
  .accounts({ creator, beneficiary, vestingTree, claimRecord, systemProgram: SystemProgram.programId,
              vaultAuthority, vault, beneficiaryAta, creatorAta, tokenProgram: TOKEN_PROGRAM_ID })
  .rpc();
```

### `set_milestone_released(milestone_idx)`
Creator releases a milestone (sets a bit in `milestone_released_flags`), enabling beneficiaries to claim that milestone leaf.

- **Args:** `milestone_idx: u8`.
- **Guards:** `InstantRefundedCampaign` (6035), `Unauthorized` (6005), `MilestoneAlreadyReleased` (6034).
- **Emits:** `MilestoneReleased { tree, milestone_idx, released_by }`.

```ts
await program.methods
  .setMilestoneReleased(milestoneIdx)              // u8 (0–255)
  .accounts({ creator, vestingTree })
  .rpc();
```

### `close_claim_record()`
Reclaim the rent of a `ClaimRecord` PDA. Allowed only when fully claimed **or** after the grace period.

- **Accounts:** `beneficiary` (signer, mut), `vesting_tree` (read), `claim_record` (mut, `close=beneficiary`, `has_one=beneficiary`, `seeds=[claim, tree, beneficiary]`).
- **Guards:** `Unauthorized` (6005), `WrongVault` (6018), `CannotClose` (6028).
- **Emits:** `ClaimRecordClosed { tree, beneficiary }`.

```ts
await program.methods
  .closeClaimRecord()                              // rent refunded to beneficiary; fully claimed or post-grace
  .accounts({ beneficiary: wallet.publicKey, vestingTree, claimRecord })
  .rpc();
```

---

## 3. Convenience: single-recipient streams

### `create_stream(args)` / `create_stream_native(args)`
Create a 1-recipient campaign **and** fund it in one transaction (root = `leaf_hash` of the single leaf).

- **Args (`CreateStreamArgs`):** `campaign_id, beneficiary, amount, release_type, start_time, cliff_time, end_time, milestone_idx, cancellable, cancel_authority, pause_authority`.
- **Guards:** `ZeroAmount`, `InvalidSchedule`, `InvalidScheduleType`, `MissingCancelAuthority`.
- **Emits:** `CampaignCreated` then `CampaignFunded`. Beneficiary later claims via `withdraw` (not `claim`).

```ts
await program.methods
  .createStream({                                  // CreateStreamArgs — single struct; create + fund in one tx
    campaignId: new BN(campaignId), beneficiary, amount: new BN(amount),
    releaseType, startTime: new BN(startTime), cliffTime: new BN(cliffTime),
    endTime: new BN(endTime), milestoneIdx, cancellable,
    cancelAuthority: cancelAuthority ?? null, pauseAuthority: pauseAuthority ?? null,
  })
  .accounts({ creator, mint, vestingTree, vaultAuthority, vault, sourceAta,
              tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY })
  .rpc();
// createStreamNative({...}) drops mint/vault/source_ata/token_program/ata_program; uses system_program.
```

---

## 4. View function

### `get_vested_amount(leaf, cancelled_at, now, milestone_released_flags) → u64`
Read-only computation (no accounts). Returns the vested amount for a leaf at time `now`,
clamping to `cancelled_at` if supplied. For milestone leaves, returns `leaf.amount` only if
the corresponding flag is set. Use this to preview a claim before submitting.

```ts
// view fn: no accounts; args = leaf, Option<cancelled_at>, now, Option<[u8;32] flags>
const vestedNow = await program.methods
  .getVestedAmount(leafStruct, cancelledAt ?? null, new BN(now), milestoneReleasedFlags ?? null)
  .view();                                         // returns u64 as BN
```

---

## Error codes (`VestingError`, Anchor codes 6000–6041)

| Code | Variant | Meaning |
|------|---------|---------|
| 6000 | `EmptyRoot` | Merkle root is all-zero |
| 6001 | `EmptyCampaign` | `leaf_count == 0` |
| 6002 | `ZeroAmount` | `amount == 0` |
| 6003 | `MissingCancelAuthority` | `cancellable` set but no `cancel_authority` |
| 6004 | `SameRoot` | `update_root` root unchanged |
| 6005 | `Unauthorized` | Signer mismatch (`has_one`/authority) |
| 6006 | `OverFunded` | Vault would exceed `total_supply` |
| 6007 | `MintMismatch` | Account mint ≠ campaign mint |
| 6008 | `Overflow` | Arithmetic overflow |
| 6009 | `CampaignPaused` | Campaign is paused (claims blocked) |
| 6010 | `UnauthorizedClaimer` | Signer ≠ `leaf.beneficiary` |
| 6011 | `InvalidSchedule` | `start ≤ cliff ≤ end` violated, or `min_cliff_time == 0` |
| 6012 | `InvalidScheduleType` | `release_type ∉ {0,1,2}` |
| 6013 | `InvalidProof` | Merkle proof did not verify against stored root |
| 6014 | `MilestoneAlreadyClaimed` | Milestone bit already set in `claim_record` |
| 6015 | `NothingToClaim` | Claimable amount is 0 |
| 6016 | `InsufficientVault` | Vault balance < claimable |
| 6017 | `OverClaim` | `total_claimed + claimable > total_supply` |
| 6018 | `WrongVault` | Provided vault ≠ campaign vault |
| 6019 | `NotCancellable` | Campaign created non-cancellable |
| 6020 | `AlreadyCancelled` | Campaign already cancelled |
| 6021 | `NotPausable` | No `pause_authority` set |
| 6022 | `AlreadyPaused` | Already paused |
| 6023 | `CampaignCancelled` | Cancelled campaigns can't be paused/rotated |
| 6024 | `NotPaused` | Not paused |
| 6025 | `CampaignCompleted` | Fully claimed; can't pause/cancel |
| 6026 | `NotCancelled` | Not cancelled |
| 6027 | `GracePeriodActive` | Grace period (7d) not yet elapsed |
| 6028 | `CannotClose` | ClaimRecord not closeable (not fully claimed, grace active) |
| 6029 | `NotSingleStream` | Instruction needs `leaf_count == 1` |
| 6030 | `ProofTooLong` | Proof exceeds `MAX_MERKLE_PROOF_LEN` or tree depth |
| 6031 | `FullyVested` | Fully claimed; can't cancel |
| 6032 | `StreamExpired` | Schedule ended with 0 claimable |
| 6033 | `MilestoneNotReleased` | Milestone not released by creator |
| 6034 | `MilestoneAlreadyReleased` | Milestone already released |
| 6035 | `InstantRefundedCampaign` | Instant-refunded; claims/releases blocked |
| 6036 | `CampaignAlreadyStarted` | `now ≥ min_cliff_time`; instant refund blocked |
| 6037 | `NativeSolVaultNotEmpty` | Native vault holds lamports after final drain |
| 6038 | `NativeSolRentViolation` | Native transfer would break rent-exempt |
| 6039 | `UnsupportedMint` | Token-2022 not supported |
| 6040 | `NotMultiLeafCampaign` | Instant refund needs `leaf_count > 1` |
| 6041 | `PerLeafCapExceeded` | Beneficiary exceeds the per-leaf claim slot capacity (`PER_LEAF_CAP`) — Issue #29 fix |

---

## Events

| Event | Fields |
|-------|--------|
| `CampaignCreated` | `tree, creator, mint, total_supply, leaf_count, cancellable` |
| `CampaignFunded` | `tree, amount, vault_balance_after` |
| `Claimed` | `tree, beneficiary, leaf_index, amount, total_claimed_by_user, total_claimed_overall, milestone_idx: Option<u8>` |
| `CampaignCancelled` | `tree, cancelled_at, claimed_at_cancel` |
| `RootUpdated` | `tree, old_root, new_root, new_leaf_count` |
| `UnvestedWithdrawn` | `tree, amount` |
| `CampaignPaused` | `tree` |
| `CampaignUnpaused` | `tree` |
| `ClaimRecordClosed` | `tree, beneficiary` |
| `MilestoneReleased` | `tree, milestone_idx, released_by` |
| `StreamCancelled` | `tree, cancelled_at, amount_to_beneficiary, amount_to_creator` |
| `InstantRefunded` | `tree, cancelled_at, refunded_to, amount` |

---

## Compute budget
Per-instruction CU + recommended `setComputeUnitLimit` values: see `docs/CU_BUDGET.md`.
Rule of thumb: `claim`/`create_campaign` ~15,000 CU; `withdraw`/`fund` ≤ 20,000. Always set a
priority fee (`setComputeUnitPrice`, ~100 µ-lamports/CU for medium priority).

## Further reading
- Integration walkthrough + runnable snippets: `docs/week9/INTEGRATION_GUIDE.md`.
- Architecture decisions: `docs/week9/ADRs/`.
- Known limitations: `docs/KNOWN_ISSUE_29_DESIGN.md`, `docs/week9/BUG_LIST.md`.
