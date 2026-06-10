# Frontend Integration Guide

> **Audience:** Frontend developers integrating against the Velthoryn on-chain vesting program.
>
> **Program ID:** `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`
> **Devnet:** Deployed at slot ~464782646 (~512 KB allocation)
> **Status:** All 18 instructions live. 127+ integration tests pass. Merkle hashing byte-verified cross-language.

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Connecting to the Program](#2-connecting-to-the-program)
3. [PDA Derivations](#3-pda-derivations)
4. [Reading On-Chain State](#4-reading-on-chain-state)
5. [Vesting Schedule Math (Client-Side)](#5-vesting-schedule-math-client-side)
6. [Building Merkle Proofs](#6-building-merkle-proofs)
7. [Instruction Reference](#7-instruction-reference)
8. [Events (Real-Time Updates)](#8-events-real-time-updates)
9. [Error Handling](#9-error-handling)
10. [Constants](#10-constants)
11. [Complete Flows](#11-complete-flows)
12. [Architecture Overview](#12-architecture-overview)
13. [Devnet & Local Dev](#13-devnet--local-dev)

---

## 1. Quick Start

### What You Need

| Item | Location |
|------|----------|
| Program ID | `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` |
| IDL (Anchor JSON) | `apps/web/src/lib/anchor/idl.json` |
| Anchor client helpers | `apps/web/src/lib/anchor/client.ts` |
| PDA derivation helpers | `apps/web/src/lib/api/tx-builder.ts` |
| Merkle tree builder | `apps/web/src/lib/merkle/builder.ts` |
| Vesting schedule math | `apps/web/src/lib/vesting/schedule.ts` |
| Error formatting | `apps/web/src/lib/anchor/errors.ts` |
| TS client SDK | `clients/ts/` (standalone `@velthoryn/client` package) |

> **⚠️ Do NOT use `target/types/vesting.ts` directly** — it may contain a stale program address. Always use `apps/web/src/lib/anchor/idl.json`.

### Install

```bash
git clone https://github.com/Ah-Riz/mancerxsuperteam-token-vesting.git
cd mancerxsuperteam-token-vesting
pnpm install
```

### Minimum Imports

```ts
import { getProvider, getProgram, derivePda, PROGRAM_ID } from "@/lib/anchor/client";
import { formatVestingError, isRetryableError } from "@/lib/anchor/errors";
import { buildTree, getRoot, getProof, hashLeaf, type VestingLeaf } from "@/lib/merkle/builder";
import { vested, getVestedAmount, type ReleaseType } from "@/lib/vesting/schedule";
```

---

## 2. Connecting to the Program

### Client-Side (Wallet)

```ts
import { getProvider, getProgram } from "@/lib/anchor/client";
import { Connection } from "@solana/web3.js";

// In your React component / wallet context:
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const provider = getProvider(connection, walletAdapter); // walletAdapter from @solana/wallet-adapter-react
const program = getProgram(provider);

// Now you can call instructions:
await program.methods.createCampaign(args).accounts({ ... }).rpc();
```

### Server-Side (API Route)

For building unsigned transactions server-side, use the tx-builder:

```ts
import {
  buildCancelCampaignTx,
  buildWithdrawUnvestedTx,
  buildCancelStreamTx,
  buildMilestoneReleaseTx,
  buildInstantRefundCampaignTx,
  deriveVestingTree,
  deriveVaultAuthority,
  deriveClaimRecord,
  type PreparedTransaction,
} from "@/lib/api/tx-builder";
```

All `build*Tx` functions return a `PreparedTransaction`:

```ts
interface PreparedTransaction {
  transaction: string;                  // base58-encoded serialized unsigned tx
  signers: string[];                    // labels of required signers
  instruction: string;                  // instruction name
  accounts: Record<string, string>;     // account addresses involved
}
```

Send the base58 transaction to the client, have the wallet sign + send it.

---

## 3. PDA Derivations

Every account the program uses is a PDA. Here are all three:

### VestingTree (Campaign PDA)

```ts
import { derivePda, BN } from "@/lib/anchor/client";

const [vestingTree, treeBump] = derivePda([
  "tree",
  creator.toBuffer(),
  mint.toBuffer(),
  new BN(campaignId).toArrayLike(Buffer, "le", 8),
]);
```

| Seed | Type | Notes |
|------|------|-------|
| `"tree"` | UTF-8 bytes | Fixed prefix |
| `creator` | Pubkey (32 bytes) | Campaign funder |
| `mint` | Pubkey (32 bytes) | SPL token mint. **Native SOL campaigns use `PublicKey.default` (32 zero bytes)** |
| `campaign_id` | u64 LE (8 bytes) | Caller-supplied, lets one creator+mint pair have multiple campaigns |

### Vault Authority

```ts
const [vaultAuthority] = derivePda(["vault_authority", vestingTree.toBuffer()]);
```

The vault itself is the **ATA** of `(mint, vaultAuthority)`:

```ts
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
const vault = getAssociatedTokenAddressSync(mint, vaultAuthority, true);
```

### ClaimRecord (Per-Beneficiary PDA)

```ts
const [claimRecord] = derivePda(["claim", vestingTree.toBuffer(), beneficiary.toBuffer()]);
```

Created lazily on first `claim` or `withdraw`. Before that, the account doesn't exist on-chain.

### Server-Side Helpers

```ts
import { deriveVestingTree, deriveVaultAuthority, deriveClaimRecord } from "@/lib/api/tx-builder";

const tree = deriveVestingTree(creator, mint, 1n);
const vaultAuth = deriveVaultAuthority(tree);
const claim = deriveClaimRecord(tree, beneficiary);
```

---

## 4. Reading On-Chain State

### Fetch VestingTree Account

```ts
const treeAccount = await program.account.vestingTree.fetch(vestingTree);

// Available fields:
treeAccount.creator                // PublicKey — campaign funder
treeAccount.mint                   // PublicKey — SPL mint (or PublicKey.default for native SOL)
treeAccount.vault                  // PublicKey — vault ATA address
treeAccount.vaultAuthority         // PublicKey — PDA that signs token transfers
treeAccount.campaignId             // BN — caller-supplied ID
treeAccount.merkleRoot             // Uint8Array (32 bytes) — current Merkle root
treeAccount.leafCount              // number — tree size
treeAccount.totalSupply            // BN — cap on funding
treeAccount.totalClaimed           // BN — sum claimed across all beneficiaries
treeAccount.cancellable            // boolean
treeAccount.cancelAuthority        // PublicKey | null
treeAccount.cancelledAt            // BN | null — set by cancel_campaign
treeAccount.paused                 // boolean
treeAccount.pauseAuthority         // PublicKey | null
treeAccount.createdAt              // BN — unix seconds
treeAccount.minCliffTime           // BN — minimum cliff across current leaves
treeAccount.milestoneReleasedFlags // Uint8Array (32 bytes) — bitmap of released milestones
treeAccount.instantRefunded        // boolean — true after instant_refund_campaign
treeAccount.bump                   // number — PDA bump
```

### Fetch ClaimRecord

```ts
const claimRecord = await program.account.claimRecord.fetch(claimRecord);

claimRecord.beneficiary     // PublicKey
claimRecord.tree            // PublicKey
claimRecord.claimedAmount   // BN — cumulative claimed by this beneficiary
claimRecord.totalEntitled   // BN — total leaf amount (set on first claim)
claimRecord.milestoneBitmap // Uint8Array (32 bytes) — claimed milestone bits
claimRecord.lastClaimAt     // BN — last claim timestamp
claimRecord.bump            // number
```

> **Note:** `claimRecord` will throw if the account doesn't exist yet (the user hasn't claimed). Handle this gracefully.

### Check if Native SOL Campaign

```ts
import { PublicKey } from "@solana/web3.js";

function isNativeSolCampaign(treeAccount: any): boolean {
  return treeAccount.mint.equals(PublicKey.default);
}
```

---

## 5. Vesting Schedule Math (Client-Side)

The file `apps/web/src/lib/vesting/schedule.ts` mirrors the on-chain math exactly. Use it to show real-time vesting progress without RPC calls.

### Schedule Types

```ts
type ReleaseType = 0 | 1 | 2;

// 0 = Cliff     — All-or-nothing at cliffTime
// 1 = Linear    — Proportional between cliffTime and endTime
// 2 = Milestone — All-or-nothing at cliffTime, BUT requires creator release flag
```

### Compute Vested Amount

```ts
import { vested, getVestedAmount, type VestingSchedule } from "@/lib/vesting/schedule";

const schedule: VestingSchedule = {
  amount: BigInt(1_000_000_000),  // token amount (raw, with decimals)
  releaseType: 1,                  // Linear
  startTime: BigInt(1700000000),
  cliffTime: BigInt(1702000000),
  endTime: BigInt(1735689600),
};

const now = BigInt(Math.floor(Date.now() / 1000));

// Plain vested amount:
const vestedAmt = vested(schedule, now);

// With cancellation (clamped to cancel time):
const cancelledAt = BigInt(1720000000); // or null
const claimableAmt = getVestedAmount(schedule, cancelledAt, now);
```

### ⚠️ Milestone Important Note

For `releaseType === 2` (Milestone), `vested()` returns the full `amount` once `now >= cliffTime`. But the tokens are **not claimable** until the creator calls `set_milestone_released`. Your UI must check the `milestoneReleasedFlags` bitmap:

```ts
function isMilestoneReleased(milestoneReleasedFlags: Uint8Array, milestoneIdx: number): boolean {
  const byteIndex = Math.floor(milestoneIdx / 8);
  const bitIndex = milestoneIdx % 8;
  return (milestoneReleasedFlags[byteIndex] & (1 << bitIndex)) !== 0;
}
```

---

## 6. Building Merkle Proofs

Required for multi-recipient campaigns (`claim` instruction). Single-recipient campaigns use `withdraw` (no proof needed).

### Define Leaves

```ts
import { type VestingLeaf } from "@/lib/merkle/builder";

const leaves: VestingLeaf[] = recipients.map((r, i) => ({
  leafIndex:    i,                      // u32 — position in tree
  beneficiary:  r.walletBase58,         // base58 string
  amount:       BigInt(r.amount),       // raw token amount
  releaseType:  r.releaseType as 0|1|2, // 0=Cliff 1=Linear 2=Milestone
  startTs:      BigInt(r.startTs),
  cliffTs:      BigInt(r.cliffTs),
  endTs:        BigInt(r.endTs),
  milestoneIdx: r.milestoneIdx ?? 0,
}));
```

### Build Tree & Get Root

```ts
import { buildTree, getRoot, getProof, hashLeaf } from "@/lib/merkle/builder";

const tree = buildTree(leaves);
const root = getRoot(tree);             // Buffer (32 bytes)

// Pass root to createCampaign:
// merkleRoot: Array.from(root)
```

### Get Proof for a Recipient (for `claim`)

```ts
const proofBuffers: Buffer[] = getProof(tree, leaves[0]); // sibling hashes

// Anchor IDL expects number[][] — convert:
const proofForAnchor: number[][] = proofBuffers.map(buf => Array.from(buf));

// Call claim:
await program.methods
  .claim(anchorLeaf, proofForAnchor)
  .accounts({ beneficiary: wallet.publicKey, mint })
  .rpc();
```

### Verify Proof Off-Chain (Pre-Flight Check)

```ts
import { verifyProof } from "@/lib/merkle/builder";

const leafHashBuf = hashLeaf(leaves[0]);
const onChainRoot = treeAccount.merkleRoot; // Uint8Array from fetched account

const isValid = verifyProof(
  leafHashBuf,
  proofBuffers,
  leaves[0].leafIndex,
  Buffer.from(onChainRoot),
);
```

### Tree Size Limits

- **Max depth:** 20 levels (= 1,048,576 leaves max)
- Beyond this, proofs exceed Solana's 1,232-byte transaction size limit
- The builder throws if you exceed this

### Converting Leaf to Anchor Format

Anchor uses camelCase with `BN` objects. Use the adapter:

```ts
import { toAnchorLeaf } from "@/lib/anchor/adapters";

// Takes a VestingLeaf (from builder) and returns the Anchor-compatible object:
const anchorLeaf = toAnchorLeaf(leaf);
// anchorLeaf = { leafIndex: 0, beneficiary: PublicKey, amount: BN, releaseType: 1, ... }
```

---

## 7. Instruction Reference

All 18 instructions. SPL and native SOL variants are separate entry points.

### Campaign Lifecycle

#### `createCampaign` — Initialize a Multi-Recipient Campaign

```ts
import { buildTree, getRoot } from "@/lib/merkle/builder";

const tree = buildTree(leaves);
const root = getRoot(tree);

await program.methods
  .createCampaign({
    campaignId: new BN(1),
    merkleRoot: Array.from(root),           // number[] (32 bytes)
    leafCount: leaves.length,
    totalSupply: new BN(totalAmount),
    cancellable: true,
    cancelAuthority: cancelAuthorityPubkey,  // PublicKey | null
    pauseAuthority: pauseAuthorityPubkey,    // PublicKey | null
    minCliffTime: minCliffTs,                // i64 — minimum cliff across all leaves
  })
  .accounts({
    creator: wallet.publicKey,
    mint: mintPubkey,
  })
  .rpc();
```

**Accounts:** `creator` (signer, writable), `mint`, `vestingTree` (init), `vaultAuthority` (init), `vault` (init), `tokenProgram`, `associatedTokenProgram`, `systemProgram`, `rent`

#### `createCampaignNative` — Same for Native SOL

Same args, same accounts except `mint = SystemProgram.programId`. Use `PublicKey.default` as the mint in PDA derivation.

#### `fundCampaign` — Deposit SPL Tokens

```ts
await program.methods
  .fundCampaign(new BN(amount))
  .accounts({
    creator: wallet.publicKey,
    vestingTree,
    vaultAuthority,
    vault,
    creatorAta,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

> Deposit is capped at `totalSupply`. Calling `fundCampaign` multiple times is fine as long as total doesn't exceed supply.

#### `fundCampaignNative` — Deposit Native SOL

```ts
await program.methods
  .fundCampaignNative(new BN(amount))
  .accounts({
    creator: wallet.publicKey,
    vestingTree,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Recipient Actions

#### `claim` — Recipient Claims Vested Tokens (Multi-Recipient)

```ts
import { getProof } from "@/lib/merkle/builder";
import { toAnchorLeaf } from "@/lib/anchor/adapters";

const proofBuffers = getProof(tree, recipientLeaf);
const proofForAnchor = proofBuffers.map(buf => Array.from(buf));
const anchorLeaf = toAnchorLeaf(recipientLeaf);

await program.methods
  .claim(anchorLeaf, proofForAnchor)
  .accounts({
    beneficiary: wallet.publicKey,
    mint: mintPubkey,
  })
  .rpc();
```

**Accounts:** `beneficiary` (signer, writable), `vestingTree`, `vaultAuthority`, `vault`, `claimRecord` (init if needed), `beneficiaryAta` (init if needed), `tokenProgram`, `associatedTokenProgram`, `systemProgram`

> The `claim` instruction auto-derives most accounts. Anchor resolves remaining accounts from the IDL's `#[derive(Accounts)]` constraints. You typically only need to pass `beneficiary` and `mint` explicitly.

#### `withdraw` — Recipient Claims from Single-Recipient Stream (No Proof)

```ts
await program.methods
  .withdraw({
    releaseType: 1,                    // must match the stream's release_type
    startTime: new BN(startTs),
    cliffTime: new BN(cliffTs),
    endTime: new BN(endTs),
    milestoneIdx: 0,
  })
  .accounts({
    beneficiary: wallet.publicKey,
    mint: mintPubkey,
  })
  .rpc();
```

Works only when `leaf_count == 1`. The program reconstructs the leaf from args and the stored root.

### Stream (Single-Recipient) Creation

#### `createStream` — Atomic Create + Fund

Combines `createCampaign` + `fundCampaign` in one transaction. No Merkle tree needed.

```ts
await program.methods
  .createStream({
    campaignId: new BN(1),
    beneficiary: recipientPubkey,
    amount: new BN(1_000_000),
    releaseType: 1,                      // 0=Cliff 1=Linear 2=Milestone
    startTime: new BN(startTs),
    cliffTime: new BN(cliffTs),
    endTime: new BN(endTs),
    milestoneIdx: 0,
    cancellable: true,
    cancelAuthority: cancelAuthPubkey,   // or null
    pauseAuthority: pauseAuthPubkey,     // or null
  })
  .accounts({
    creator: wallet.publicKey,
    mint: mintPubkey,
    sourceAta: creatorAta,               // creator's token account to fund from
  })
  .rpc();
```

#### `createStreamNative` — Same for Native SOL

Same args. Accounts use `systemProgram` instead of token accounts.

### Cancellation & Clawback

#### `cancelCampaign` — Freeze Vesting + Start 7-Day Grace

```ts
await program.methods
  .cancelCampaign()
  .accounts({
    cancelAuthority: cancelAuthWallet.publicKey,
    vestingTree,
  })
  .rpc();
```

**What happens:**
- Sets `cancelledAt = current_timestamp`
- Clears `paused = false` (recipients can still claim vested tokens)
- Vesting curve is **frozen** at the cancel time — no more tokens vest
- After 7 days, creator can call `withdrawUnvested` to sweep remainder

#### `cancelStream` — Atomic Cancel for Single-Recipient Streams

```ts
await program.methods
  .cancelStream({
    releaseType: 1,
    startTime: new BN(startTs),
    cliffTime: new BN(cliffTs),
    endTime: new BN(endTs),
    milestoneIdx: 0,
  })
  .accounts({
    creator: creatorWallet.publicKey,
    beneficiary: beneficiaryPubkey,
    vestingTree,
    mint: mintPubkey,
  })
  .rpc();
```

**What happens (all in one transaction):**
- Computes vested amount at cancel time
- Transfers vested tokens to beneficiary
- Transfers remaining vault balance to creator
- No grace period — everything resolves atomically

#### `instantRefundCampaign` — Full Refund Before Vesting Starts

```ts
await program.methods
  .instantRefundCampaign()
  .accounts({
    creator: creatorWallet.publicKey,
    vestingTree,
    mint: mintPubkey,
  })
  .rpc();
```

**Conditions:**
- `now < minCliffTime` (no one has vested yet)
- No milestone flags set
- Multi-leaf campaigns only (`leaf_count > 1`)

#### `withdrawUnvested` — Sweep Remaining Tokens After Grace Period

```ts
await program.methods
  .withdrawUnvested()
  .accounts({
    creator: creatorWallet.publicKey,
    vestingTree,
    vaultAuthority,
    vault,
    creatorAta,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

**Condition:** `cancelledAt + 7 days <= now` (throws `GracePeriodActive` otherwise)

### Campaign Management

#### `updateRoot` — Rotate Merkle Root (Add/Remove Recipients)

```ts
const newTree = buildTree(updatedLeaves);
const newRoot = getRoot(newTree);

await program.methods
  .updateRoot(
    Array.from(newRoot),             // number[] (32 bytes)
    updatedLeaves.length,            // new leaf count
    newMinCliffTs,                   // new minimum cliff time
  )
  .accounts({
    cancelAuthority: cancelAuthWallet.publicKey,
    vestingTree,
  })
  .rpc();
```

#### `setMilestoneReleased` — Release a Milestone

```ts
await program.methods
  .setMilestoneReleased(milestoneIdx)  // u8 (0-255)
  .accounts({
    creator: creatorWallet.publicKey,
    vestingTree,
  })
  .rpc();
```

Sets the corresponding bit in `milestoneReleasedFlags`. Recipients with that `milestoneIdx` can now claim.

#### `pauseCampaign` / `unpauseCampaign` — Temporarily Block Claims

```ts
// Pause:
await program.methods.pauseCampaign()
  .accounts({ pauseAuthority: pauseAuthWallet.publicKey, vestingTree })
  .rpc();

// Unpause:
await program.methods.unpauseCampaign()
  .accounts({ pauseAuthority: pauseAuthWallet.publicKey, vestingTree })
  .rpc();
```

#### `closeClaimRecord` — Reclaim Rent

```ts
await program.methods
  .closeClaimRecord()
  .accounts({
    beneficiary: wallet.publicKey,
    vestingTree,
    claimRecord,
  })
  .rpc();
```

**Condition:** Fully claimed (`claimedAmount >= totalEntitled`) or campaign cancelled and grace period passed.

### View Function

#### `getVestedAmount` — Read-Only Vesting Computation

```ts
const result = await program.methods
  .getVestedAmount(
    anchorLeaf,
    cancelledAt ? new BN(cancelledAt) : null,   // Option<i64>
    new BN(Math.floor(Date.now() / 1000)),       // current time
    milestoneFlags ? Array.from(milestoneFlags) : null, // Option<[u8; 32]>
  )
  .accounts({})
  .view();

console.log("Vested:", result.toString());
```

> This is a view (read-only) call — no transaction submitted. Use it to verify client-side math matches on-chain.

---

## 8. Events (Real-Time Updates)

Subscribe to on-chain events for real-time dashboard updates:

```ts
const listenerId = program.addEventListener("Claimed", (event, slot) => {
  console.log(`Claimed ${event.amount} by ${event.beneficiary}`);
  console.log(`Tree: ${event.tree}, Leaf index: ${event.leafIndex}`);
  console.log(`Total claimed by user: ${event.totalClaimedByUser}`);
  console.log(`Total claimed overall: ${event.totalClaimedOverall}`);
  if (event.milestoneIdx !== null) {
    console.log(`Milestone: ${event.milestoneIdx}`);
  }
});
```

### All Events

| Event | Fields | When |
|-------|--------|------|
| `CampaignCreated` | `tree`, `creator`, `mint`, `totalSupply`, `leafCount`, `cancellable` | Campaign initialized |
| `CampaignFunded` | `tree`, `amount`, `vaultBalanceAfter` | Tokens deposited |
| `Claimed` | `tree`, `beneficiary`, `leafIndex`, `amount`, `totalClaimedByUser`, `totalClaimedOverall`, `milestoneIdx` | Recipient claims tokens |
| `CampaignCancelled` | `tree`, `cancelledAt`, `claimedAtCancel` | Campaign cancelled (grace starts) |
| `StreamCancelled` | `tree`, `cancelledAt`, `amountToBeneficiary`, `amountToCreator` | Single-stream cancelled atomically |
| `RootUpdated` | `tree`, `oldRoot`, `newRoot`, `newLeafCount` | Merkle root rotated |
| `UnvestedWithdrawn` | `tree`, `amount` | Creator sweeps after grace |
| `InstantRefunded` | `tree`, `cancelledAt`, `refundedTo`, `amount` | Pre-cliff instant refund |
| `MilestoneReleased` | `tree`, `milestoneIdx`, `releasedBy` | Creator releases milestone |
| `CampaignPaused` | `tree` | Claims paused |
| `CampaignUnpaused` | `tree` | Claims resumed |
| `ClaimRecordClosed` | `tree`, `beneficiary` | Rent reclaimed |

### Cleanup

```ts
program.removeEventListener(listenerId);
```

### Post-transaction indexer sync (dApp)

After a wallet-signed transaction (claim, cancel, pause, milestone release), the UI triggers backend indexing so dashboards update without waiting for cron:

```ts
await fetch("/api/events/sync", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ signature: txSig }),
});
```

This route is **public** (rate-limited). Operator backfill uses admin-only `POST /api/claims/sync`. See [`API_TRUST_BOUNDARIES.md`](API_TRUST_BOUNDARIES.md).

---

## 9. Error Handling

### User-Facing Error Messages

```ts
import { formatVestingError, isRetryableError } from "@/lib/anchor/errors";

try {
  await program.methods.claim(leaf, proof).accounts({ ... }).rpc();
} catch (err) {
  const userMessage = formatVestingError(err);
  // Example outputs:
  // "Nothing to claim yet. Wait for more tokens to vest or you already claimed everything unlocked."
  // "You are not the beneficiary of this stream."
  // "Campaign is paused. Contact the creator."

  if (isRetryableError(err)) {
    // Show "Try again" — network issue or expired blockhash
  }

  showToast(userMessage);
}
```

### All Error Codes

| Code | Name | User Meaning |
|------|------|-------------|
| 6000 | `EmptyRoot` | Merkle root cannot be empty |
| 6001 | `EmptyCampaign` | Campaign must have at least one recipient |
| 6002 | `ZeroAmount` | Amount must be greater than zero |
| 6003 | `MissingCancelAuthority` | Cancellable campaigns require a cancel authority |
| 6004 | `SameRoot` | New root must differ from current root |
| 6005 | `Unauthorized` | Not authorized for this action |
| 6006 | `OverFunded` | Deposit exceeds total supply |
| 6007 | `MintMismatch` | Token mint doesn't match campaign |
| 6008 | `Overflow` | Amount overflow |
| 6009 | `CampaignPaused` | Campaign is paused |
| 6010 | `UnauthorizedClaimer` | Not the beneficiary |
| 6011 | `InvalidSchedule` | Invalid schedule: start ≤ cliff ≤ end |
| 6012 | `InvalidScheduleType` | Release type must be 0, 1, or 2 |
| 6013 | `InvalidProof` | Merkle proof failed / schedule params mismatch |
| 6014 | `MilestoneAlreadyClaimed` | This milestone was already claimed |
| 6015 | `NothingToClaim` | Nothing claimable right now |
| 6016 | `InsufficientVault` | Vault has insufficient tokens |
| 6017 | `OverClaim` | Claim would exceed total supply |
| 6018 | `WrongVault` | Vault doesn't match campaign |
| 6019 | `NotCancellable` | Campaign was created as non-cancellable |
| 6020 | `AlreadyCancelled` | Already cancelled |
| 6021 | `NotPausable` | No pause authority set |
| 6022 | `AlreadyPaused` | Already paused |
| 6023 | `CampaignCancelled` | Campaign is cancelled |
| 6024 | `NotPaused` | Not paused |
| 6025 | `CampaignCompleted` | Fully claimed |
| 6026 | `NotCancelled` | Must be cancelled first |
| 6027 | `GracePeriodActive` | Grace period hasn't ended |
| 6028 | `CannotClose` | Claim record can't be closed yet |
| 6029 | `NotSingleStream` | Only for single-recipient streams |
| 6030 | `ProofTooLong` | Merkle proof exceeds size limit |
| 6031 | `FullyVested` | Fully vested, can't cancel |
| 6032 | `StreamExpired` | Stream ended, nothing left |
| 6033 | `MilestoneNotReleased` | Creator hasn't released this milestone |
| 6034 | `MilestoneAlreadyReleased` | Milestone already released |
| 6035 | `InstantRefundedCampaign` | Campaign was instant-refunded |
| 6036 | `CampaignAlreadyStarted` | Too late for instant refund |
| 6037 | `NativeSolVaultNotEmpty` | SOL vault still has lamports |
| 6038 | `NativeSolRentViolation` | Transfer would violate rent minimum |
| 6039 | `UnsupportedMint` | Token-2022 mints not supported |
| 6040 | `NotMultiLeafCampaign` | Instant refund only for multi-leaf |

---

## 10. Constants

```ts
// In your frontend code:
const GRACE_PERIOD_SECS = 604_800n;       // 7 days — must match SC constants.rs
const MAX_MERKLE_PROOF_LEN = 32;          // Max proof siblings
const MAX_TREE_DEPTH = 20;                // Max tree levels (~1M leaves)
const NATIVE_SOL_MINT = PublicKey.default; // All-zeros pubkey signals native SOL
```

### Computing Grace Period End Time

```ts
function gracePeriodEnd(cancelledAt: bigint): bigint {
  return cancelledAt + 604_800n; // 7 days
}

function isGracePeriodOver(cancelledAt: bigint): boolean {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return now >= gracePeriodEnd(cancelledAt);
}
```

---

## 11. Complete Flows

### Flow 1: Bulk Send (Campaign Creator)

```
1. Collect recipient data (wallets, amounts, schedules)
2. Build Merkle tree:
   const leaves = recipients.map(...)
   const tree = buildTree(leaves)
   const root = getRoot(tree)
3. Create campaign on-chain:
   program.methods.createCampaign({ merkleRoot: Array.from(root), ... })
4. Fund campaign:
   program.methods.fundCampaign(amount)
5. Distribute proofs to recipients (API, IPFS, or client-side generation)
6. Recipients claim:
   program.methods.claim(leaf, proof)
```

### Flow 2: Single Stream (Creator)

```
1. program.methods.createStream({ beneficiary, amount, releaseType, ... })
   // Creates + funds in one transaction
2. Recipient claims periodically:
   program.methods.withdraw({ releaseType, startTime, cliffTime, endTime, ... })
```

### Flow 3: Cancel + Clawback (Creator)

```
1. Cancel:
   program.methods.cancelCampaign()  // or cancelStream() for single
2. Wait for grace period (7 days for multi-leaf, immediate for single-stream)
3. Withdraw unvested:
   program.methods.withdrawUnvested()
```

### Flow 4: Milestone Vesting (Creator → Recipient)

```
1. Create campaign/stream with releaseType: 2
2. When milestone is ready:
   program.methods.setMilestoneReleased(milestoneIdx)
3. Recipient claims:
   program.methods.claim(leaf, proof)  // or withdraw()
   // Program checks milestoneReleasedFlags bit
```

### Flow 5: Instant Refund (Creator, Pre-Cliff Only)

```
1. Check: now < minCliffTime AND no milestones released
2. program.methods.instantRefundCampaign()
   // Full refund to creator in one transaction
```

### Flow 6: Root Rotation (Update Recipients)

```
1. Build new Merkle tree with updated leaves
2. program.methods.updateRoot(newRoot, newLeafCount, newMinCliffTime)
3. Distribute new proofs to recipients
```

---

## 12. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (dApp)                    │
│                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ Wallet       │  │ Merkle       │  │ Vesting    │ │
│  │ Adapter      │  │ Builder      │  │ Schedule   │ │
│  │              │  │ (builder.ts) │  │ (sched.ts) │ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘ │
│         │                 │                 │         │
│  ┌──────┴─────────────────┴─────────────────┴──────┐ │
│  │          Anchor Client (client.ts)               │ │
│  │   getProvider() → getProgram() → derivePda()    │ │
│  └──────────────────────┬──────────────────────────┘ │
└─────────────────────────┼────────────────────────────┘
                          │ JSON RPC
                          ▼
┌─────────────────────────────────────────────────────┐
│              Solana (Devnet / Mainnet)                │
│                                                       │
│  Program: G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu
│                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ VestingTree  │  │ ClaimRecord  │  │ Vault ATA  │ │
│  │ (campaign)   │  │ (per user)   │  │ (tokens)   │ │
│  └──────────────┘  └──────────────┘  └────────────┘ │
└─────────────────────────────────────────────────────┘
```

### File Map for FE Developers

```
apps/web/src/lib/
├── anchor/
│   ├── client.ts        ← Provider, program, PDA helper, PROGRAM_ID
│   ├── idl.json         ← Anchor IDL (use this, NOT target/idl/)
│   ├── errors.ts        ← formatVestingError(), isRetryableError()
│   └── adapters.ts      ← toAnchorLeaf() — VestingLeaf → Anchor format
├── merkle/
│   ├── builder.ts       ← buildTree, getRoot, getProof, hashLeaf, verifyProof
│   └── verify.ts        ← verifyLeafProof(), verifyAllLeaves()
├── vesting/
│   ├── schedule.ts      ← vested(), getVestedAmount() — mirrors on-chain math
│   ├── display.ts       ← UI formatting helpers
│   ├── list.ts          ← Campaign listing
│   ├── milestone.ts     ← Milestone helpers
│   └── verify-onchain.ts ← Dev-only: compare client vs on-chain vesting
├── api/
│   ├── tx-builder.ts    ← Server-side tx builders + PDA helpers
│   └── serialize.ts     ← serializeBigInt() for API-safe JSON
├── components/
│   ├── ui/              ← StatCard, ProgressBar, Spinner, SectionHeader, FieldRow, DetailRow
│   └── campaign/
│       └── CampaignCard.tsx ← Shared portfolio/dashboard campaign card
├── campaign/
│   ├── authority.ts     ← Authority management
│   ├── root-rotation.ts ← Root rotation helpers
│   ├── bulk.ts          ← Bulk operations
│   └── milestone-ids.ts ← Milestone ID helpers
└── indexer/
    ├── events.ts        ← Event indexer
    └── claim-events.ts  ← Claim event processing

clients/ts/              ← Standalone SDK (@velthoryn/client)
├── src/
│   ├── index.ts         ← Public API exports
│   ├── leaf.ts          ← encodeLeaf(), leafHash(), nodeHash()
│   ├── merkle.ts        ← VestingMerkleTree, verifyProof(), proofAsArrays()
│   └── prepare.ts       ← prepareCampaign(), computeMinCliffTime()
```

---

## 13. Devnet & Local Dev

### Devnet

```bash
solana config set --url devnet
solana program show G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu
```

RPC: `https://api.devnet.solana.com`

### Local Validator

```bash
anchor test   # boots embedded validator with program preloaded
```

Point your frontend at `http://127.0.0.1:8899`.

### Deploy Scripts

| Script | Purpose |
|--------|---------|
| `scripts/test-localnet.sh` | Full build + deploy + test on local validator |
| `scripts/test-devnet.sh` | Run tests against devnet |

---

## Appendix: Common Gotchas

1. **Milestone claims require TWO checks:** time gate (`now >= cliffTime`) AND `milestoneReleasedFlags` bit. Your UI must show both conditions.

2. **Native SOL campaigns use `PublicKey.default` as mint.** When deriving the VestingTree PDA, pass `SystemProgram.programId` or `new PublicKey(0)` as the mint buffer.

3. **ClaimRecord doesn't exist until first claim.** `program.account.claimRecord.fetch()` will throw. Use try/catch or `connection.getAccountInfo()` first.

4. **`cancelledAt` freezes the vesting curve.** When displaying vesting progress for a cancelled campaign, always pass `cancelledAt` to `getVestedAmount()`.

5. **Root rotation invalidates old proofs.** After `updateRoot`, recipients need fresh proofs matching the new root. Store proofs server-side and regenerate on rotation.

6. **`GRACE_PERIOD_SECS` is not in the IDL.** It's hardcoded in the program at 604,800 seconds (7 days). The frontend must know this to display "Withdraw unvested available in X days".

7. **Token-2022 is NOT supported.** Only classic SPL Token mints work. Passing a Token-2022 mint throws `UnsupportedMint` (6039).

8. **`withdraw` only works on single-recipient streams.** Multi-recipient campaigns must use `claim` with proofs. The program enforces `leafCount == 1`.

---

## Where to Ask

| Topic | Owner |
|-------|-------|
| On-chain program / instruction questions | Lana (`programs/vesting/`) |
| Merkle / leaf encoding | Lana (`apps/web/src/lib/merkle/`) |
| Backend API / DB / tests | Lana (`apps/web/src/app/api/`) |
| Frontend / UI | Geral (`apps/web/`) |
| IDL / TS types regeneration | `anchor build` |
