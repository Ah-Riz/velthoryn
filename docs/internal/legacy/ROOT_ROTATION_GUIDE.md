# Root Rotation Integration Guide

## 1. What Root Rotation Does

Root rotation replaces the Merkle root stored in the on-chain `VestingTree` PDA. When a root is rotated:

- The new `merkle_root`, `leaf_count`, and `min_cliff_time` are written to the VestingTree account.
- The existing `total_claimed` counter **survives** -- it is not reset. This means you must ensure the new tree accounts for already-claimed amounts if you want to preserve total supply integrity.
- All old proofs become **invalid**. Recipients who have not yet claimed must use the new proofs generated from the updated tree.
- The campaign remains active (not cancelled, not paused) unless a separate cancel/pause instruction is issued.

Root rotation is the canonical way to add, remove, or modify vesting recipients after campaign creation.

---

## 2. On-Chain Instruction

### `update_root`

```
update_root(new_root: [u8; 32], new_leaf_count: u32, new_min_cliff_time: i64)
```

**Accounts:**

| Account         | Mutability | Description                        |
|-----------------|------------|------------------------------------|
| `cancel_authority` | Signer    | Must match the campaign's stored `cancel_authority` |
| `vesting_tree`  | Writable   | The VestingTree PDA whose root is being replaced    |

**Program ID:** `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` (NEVER change this)

---

## 3. Authority Gate

The frontend `canRotateRoot()` helper enforces these preconditions before allowing root rotation:

1. **`cancellable == true`** -- The campaign must have been created with the `cancellable` flag set.
2. **`cancelled_at == None`** -- The campaign must not already be cancelled.
3. **`leaf_count > 1`** -- The campaign must have more than one leaf (single-recipient streams cannot rotate roots). **Note:** This check is frontend-only; the on-chain instruction does not enforce it.
4. **Signer == `cancel_authority`** -- The transaction signer must be the campaign's cancel authority (enforced on-chain).

If the signer check fails on-chain, the instruction reverts with `VestingError::Unauthorized`. The other checks are enforced client-side before the transaction is submitted.

---

## 4. Step-by-Step Integration

### Step 1: Prepare new recipients

Call `prepareRootRotation()` from the TS SDK. This builds a new Merkle tree and pre-computes all proofs.

```ts
import { prepareRootRotation, PublicKey, BN } from "@mancer-scholarship/vesting-ts-sdk";

const newRecipients = [
  {
    beneficiary: new PublicKey("..."),
    amount: new BN(1_000_000_000),
    releaseType: 0, // Linear
    startTime: new BN(Math.floor(Date.now() / 1000)),
    cliffTime: new BN(Math.floor(Date.now() / 1000) + 86400),
    endTime: new BN(Math.floor(Date.now() / 1000) + 86400 * 365),
    milestoneIdx: 0,
  },
  // ... more recipients
];

const prepared = prepareRootRotation(newRecipients);
// prepared.rootHex      -- hex-encoded merkle root (64 chars)
// prepared.leafCount    -- number of leaves
// prepared.minCliffTime -- BN, minimum cliff_time across all leaves
// prepared.leaves       -- VestingLeaf[] with proofs
// prepared.proofs       -- number[][][], proof arrays per leaf
```

### Step 2: Build Anchor transaction

Construct the `update_root` instruction with all three required arguments.

```ts
// Seeds: ["tree", creator, mint, campaign_id.to_le_bytes()]
const campaignIdBytes = new BN(campaign.campaignId).toArrayLike(Buffer, "le", 8);
const [vestingTreePDA] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("tree"),
    new PublicKey(campaign.creator).toBuffer(),
    new PublicKey(campaign.mint).toBuffer(),
    campaignIdBytes,
  ],
  PROGRAM_ID,
);

const instruction = await program.methods
  .updateRoot(
    Array.from(prepared.root),           // [u8; 32]
    prepared.leafCount,                   // u32 (Anchor expects BN or number)
    prepared.minCliffTime,                // i64 (BN)
  )
  .accounts({
    cancelAuthority: cancelAuthorityKeypair.publicKey,
    vestingTree: vestingTreePDA,
  })
  .instruction();
```

### Step 3: Send and confirm transaction

```ts
const tx = new Transaction().add(instruction);
const signature = await sendAndConfirmTransaction(connection, tx, [cancelAuthorityKeypair]);
console.log("Root rotated:", signature);
```

### Step 4: POST to indexing API

After the on-chain transaction confirms, POST to the backend API so the new root version and leaves are indexed in the database.

```
POST /api/campaigns/:treeAddress/root-versions
```

See **Section 5** for the exact payload shape.

---

## 5. JSON Payload Shape (API POST)

```json
{
  "merkleRoot": "a1b2c3d4e5f6... (64-char hex string)",
  "leafCount": 42,
  "minCliffTime": 1717000000,
  "leaves": [
    {
      "leafIndex": 0,
      "beneficiary": "Base58PublicKey...",
      "amount": "1000000000",
      "releaseType": 0,
      "startTime": "1716900000",
      "cliffTime": "1716986400",
      "endTime": "1748448000",
      "milestoneIdx": 0,
      "proof": [[1,2,3,...,32], [4,5,6,...,32], ...]
    }
  ],
  "ipfsCid": "Qm... (optional)"
}
```

**Field notes:**

- `merkleRoot` -- 64-character lowercase hex string matching the on-chain root.
- `leafCount` -- Total number of leaves in the new tree. Must be >= 1.
- `minCliffTime` -- Unix timestamp (seconds). Minimum `cliffTime` across all leaves. This is the 3rd on-chain argument to `update_root`.
- `leaves` -- Array of leaf objects with pre-computed proofs. Each proof is a 32-element array of 32-byte arrays (sibling hashes top to bottom).
- `ipfsCid` -- Optional IPFS CID for the campaign metadata backup.

The backend validates all proofs against the provided `merkleRoot` before inserting into the database. If any proof fails verification, the request is rejected with a 400 error.

---

## 6. BUG FIX for Geral

**File:** `useUpdateRoot.ts` (line ~32)

The frontend hook was missing the third argument (`minCliffTime`) when calling `program.methods.updateRoot()`:

**Before (broken):**

```ts
program.methods.updateRoot(
  Array.from(prepared.root),
  params.payload.leafCount,            // only 2 args -- missing minCliffTime
)
```

**After (fixed):**

```ts
program.methods.updateRoot(
  Array.from(prepared.root),
  params.payload.leafCount,
  params.payload.minCliffTime,          // 3rd argument: minimum cliff time (i64)
)
```

Without this fix, the Anchor transaction builder receives the wrong instruction data and the on-chain `update_root` call will either fail with a deserialization error or, worse, encode the wrong arguments.

---

## 7. Edge Cases

### SameRoot
If the new `merkle_root` equals the current on-chain root, the `update_root` instruction **reverts** with `VestingError::SameRoot`. The on-chain code enforces `new_root != ctx.accounts.vesting_tree.merkle_root`. You must supply a different root to rotate.

### NotCancellable
If the campaign was created with `cancellable: false`, `update_root` reverts with `VestingError::Unauthorized`. Root rotation is only available for cancellable campaigns.

### CampaignCancelled
If the campaign has already been cancelled (`cancelled_at` is set on-chain), `update_root` reverts with `VestingError::Unauthorized`. You cannot rotate the root of a cancelled campaign.

### InvalidSchedule
The backend validates `startTime <= cliffTime <= endTime` for each leaf during `prepareCampaign` / `prepareRootRotation`. If any leaf violates this invariant, the preparation step throws an error before any transaction is built.

### EmptyRoot
`prepareRootRotation()` throws if the recipients array is empty. The frontend enforces `leaf_count > 1` via `canRotateRoot()` before submitting the transaction.

---

## 8. Event Emitted

When `update_root` succeeds, the program emits:

```
RootUpdated {
  tree: Pubkey,           // The VestingTree PDA
  old_root: [u8; 32],     // Previous merkle root
  new_root: [u8; 32],     // New merkle root
  new_leaf_count: u32,     // New total leaf count
}
```

The backend indexer listens for this event and records it in the `root_update_events` table for audit trail purposes. The event can also be used by frontend clients to confirm that a rotation completed on-chain before posting to the indexing API.
