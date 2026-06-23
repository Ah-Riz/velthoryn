# Root Rotation

Operations guide for Merkle root rotation in Velthoryn campaigns. Root rotation replaces the entire recipient set atomically on-chain.

---

## What Root Rotation Does

Root rotation replaces the Merkle root stored in the on-chain `VestingTree` PDA. When a root is rotated:

- The new `merkle_root`, `leaf_count`, and `min_cliff_time` are written to the VestingTree account.
- The existing `total_claimed` counter **survives** -- it is not reset. The new tree must account for already-claimed amounts to preserve total supply integrity.
- All old proofs become **invalid**. Recipients who have not yet claimed must use the new proofs generated from the updated tree.
- The campaign remains active unless a separate cancel/pause instruction is issued.

Root rotation is the canonical way to add, remove, or modify vesting recipients after campaign creation.

---

## On-Chain Instruction

### update_root

```
update_root(new_root: [u8; 32], new_leaf_count: u32, new_min_cliff_time: i64)
```

**Accounts:**

| Account | Mutability | Description |
|---|---|---|
| `cancel_authority` | Signer | Must match the campaign's stored `cancel_authority` |
| `vesting_tree` | Writable | The VestingTree PDA whose root is being replaced |

**Program ID:** `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`

---

## Authority Gate

The frontend `canRotateRoot()` helper enforces these preconditions:

1. **`cancellable == true`** -- campaign must be created with the `cancellable` flag.
2. **`cancelled_at == None`** -- campaign must not already be cancelled.
3. **`leaf_count > 1`** -- campaign must have more than one leaf (frontend-only check; not enforced on-chain).
4. **Signer == `cancel_authority`** -- enforced on-chain; fails with `VestingError::Unauthorized`.

---

## Step-by-Step Integration

### Step 1: Prepare New Recipients

Build a new Merkle tree and pre-compute all proofs:

```ts
import { prepareRootRotation, PublicKey, BN } from "@mancer-scholarship/vesting-ts-sdk";

const newRecipients = [
  {
    beneficiary: new PublicKey("..."),
    amount: new BN(1_000_000_000),
    releaseType: 0,
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

### Step 2: Build Anchor Transaction

```ts
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
    Array.from(prepared.root),
    prepared.leafCount,
    prepared.minCliffTime,
  )
  .accounts({
    cancelAuthority: cancelAuthorityKeypair.publicKey,
    vestingTree: vestingTreePDA,
  })
  .instruction();
```

### Step 3: Send and Confirm Transaction

```ts
const tx = new Transaction().add(instruction);
const signature = await sendAndConfirmTransaction(
  connection, tx, [cancelAuthorityKeypair]
);
```

### Step 4: POST to Indexing API

After the on-chain transaction confirms, POST the new root version and leaves to the backend:

```
POST /api/campaigns/:treeAddress/root-versions
```

---

## API Payload Shape

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
      "proof": [[1,2,3,...,32], [4,5,6,...,32]]
    }
  ],
  "ipfsCid": "Qm... (optional)"
}
```

**Field notes:**
- `merkleRoot` -- 64-character lowercase hex string matching the on-chain root.
- `leafCount` -- Total number of leaves in the new tree (must be >= 1).
- `minCliffTime` -- Unix timestamp (seconds). Minimum `cliffTime` across all leaves.
- `leaves` -- Array of leaf objects with pre-computed proofs.
- `ipfsCid` -- Optional IPFS CID for the campaign metadata backup.

The backend validates all proofs against the provided `merkleRoot` before inserting into the database. If any proof fails verification, the request is rejected with a 400 error.

---

## Edge Cases

### SameRoot

If the new `merkle_root` equals the current on-chain root, the instruction reverts with `VestingError::SameRoot`. You must supply a different root to rotate.

### NotCancellable

If the campaign was created with `cancellable: false`, `update_root` reverts with `VestingError::Unauthorized`. Root rotation is only available for cancellable campaigns.

### CampaignCancelled

If the campaign has already been cancelled, `update_root` reverts with `VestingError::Unauthorized`.

### InvalidSchedule

The backend validates `startTime <= cliffTime <= endTime` for each leaf during preparation. If any leaf violates this invariant, the preparation step throws an error before any transaction is built.

### EmptyRoot

`prepareRootRotation()` throws if the recipients array is empty. The frontend enforces `leaf_count > 1` via `canRotateRoot()`.

---

## Event Emitted

When `update_root` succeeds, the program emits:

```
RootUpdated {
  tree: Pubkey,
  old_root: [u8; 32],
  new_root: [u8; 32],
  new_leaf_count: u32,
}
```

The backend indexer records this event in the `root_update_events` table. Frontend clients can use it to confirm rotation completed before posting to the indexing API.

{% hint style="warning" %}
**Operational sequence:** (1) Rebuild tree off-chain, (2) pin new proofs to IPFS and verify retrieval, (3) call `update_root`, (4) notify recipients. Calling `update_root` before step 2 creates a window where the new root is live but proofs are unavailable.
{% endhint %}
