# Hooks Reference

Complete reference for all 21 frontend hooks in `apps/web/src/hooks/` and the server-side transaction builder in `apps/web/src/lib/api/tx-builder.ts`.

**Program ID:** `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`

For the on-chain instruction reference (raw Anchor SDK), see the smart contract documentation. For architecture context, see [Frontend Architecture](./architecture.md).

---

## Action Hooks

Action hooks perform on-chain transactions and return the transaction signature(s). All require a connected wallet; they throw `Error("Wallet not connected")` if called without one.

---

### useCreateCampaign

**File:** `src/hooks/useCreateCampaign.ts`

Creates and funds a multi-recipient campaign. Internally calls `create_campaign` + `fund_campaign` (two separate transactions). Saves a pending index entry to `localStorage` so the campaign is indexed on next page load.

```ts
import { useCreateCampaign } from "@/hooks/useCreateCampaign";

const {
  createCampaign,          // create only (no fund)
  fundCampaign,            // fund only (for previously created campaigns)
  createAndFundCampaign,   // create + fund in sequence (recommended)
  formatVestingError,      // converts AnchorError to string
} = useCreateCampaign();
```

#### createCampaign(params)

| Param | Type | Description |
|---|---|---|
| `mintAddress` | `string` | SPL mint address; `PublicKey.default.toBase58()` for native SOL |
| `campaignId` | `string` | Unique per creator -- use `Date.now().toString()` or a UUID |
| `prepared` | `PreparedBulkCampaign` | Output of `prepareCampaign()` from `@velthoryn/client` |
| `cancellable` | `boolean` | Whether `cancel_campaign` / `update_root` are enabled |

**Returns:** `Promise<{ sig: string; treeAddress: string; totalSupply: string; indexWarning: string | null }>`

#### createAndFundCampaign(createParams, options?)

Calls `createCampaign` then `fundCampaign` in sequence. `options.autoWrap = true` wraps native SOL to wSOL before funding.

**Returns:** `Promise<{ createSig: string; fundSig: string; treeAddress: string; totalSupply: string; indexWarning: string | null }>`

#### Usage

```tsx
const { createAndFundCampaign, formatVestingError } = useCreateCampaign();

try {
  const result = await createAndFundCampaign({
    mintAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    campaignId: Date.now().toString(),
    prepared,
    cancellable: true,
  });
  console.log("Campaign PDA:", result.treeAddress);
  if (result.indexWarning) console.warn("Index failed:", result.indexWarning);
} catch (err) {
  toast.error(formatVestingError(err));
}
```

---

### useCreateStream

**File:** `src/hooks/useCreateStream.ts`

Creates and funds a single-recipient stream in one transaction. The recipient claims via `withdraw` (no Merkle proof needed).

```ts
import { useCreateStream } from "@/hooks/useCreateStream";
const { createStream, formatVestingError } = useCreateStream();
```

#### createStream(params)

| Param | Type | Description |
|---|---|---|
| `mintAddress` | `string` | SPL mint or `PublicKey.default.toBase58()` for native SOL |
| `campaignId` | `string` | Unique campaign ID |
| `beneficiary` | `string` | Recipient wallet address (base58) |
| `amount` | `string` | Token amount in base units |
| `releaseType` | `number` | `0` = Cliff, `1` = Linear, `2` = Milestone |
| `startTime` | `number` | Unix timestamp (seconds) |
| `cliffTime` | `number` | First unlock (cliff) or start of ramp (linear) |
| `endTime` | `number` | Full vest timestamp |
| `milestoneIdx` | `number` | Milestone index (only for `releaseType = 2`) |
| `cancellable` | `boolean` | Whether cancellation is enabled |

**Returns:** `Promise<{ sig: string; treeAddress: string }>`

---

### useUpdateRoot

**File:** `src/hooks/useUpdateRoot.ts`

Calls `update_root` on-chain to replace the Merkle root, then saves the new root version to the backend API. Automatically evicts the proof cache so all `useProofLookup` queries refetch.

```ts
import { useUpdateRoot } from "@/hooks/useUpdateRoot";
const { updateRoot } = useUpdateRoot();
```

#### updateRoot(params)

```ts
interface UpdateRootParams {
  treeAddress: string;
  payload: {
    merkleRoot: string;      // 32-byte root as hex
    leafCount: number;
    minCliffTime: string;    // Unix timestamp as string
    leaves: Array<{
      leafIndex: number; beneficiary: string; amount: string;
      releaseType: number; startTime: string; cliffTime: string;
      endTime: string; milestoneIdx: number; proof: number[][];
    }>;
  };
}
```

**Returns:** `Promise<{ sig: string; version: number | null; indexWarning: string | null }>`

{% hint style="info" %}
The signer must be `cancel_authority` for the campaign -- the hook reads `useWallet().publicKey`.
{% endhint %}

---

### useWrapSol

**File:** `src/hooks/useWrapSol.ts`

Wraps or unwraps native SOL to/from wSOL (Wrapped SOL ATA). Used when the selected token in the create flow is native SOL.

```ts
import { useWrapSol } from "@/hooks/useWrapSol";
const { wrapSol, unwrapSol } = useWrapSol();

await wrapSol({ amountLamports: 1_000_000_000n });   // 1 SOL
await unwrapSol();                                    // close wSOL ATA, reclaim lamports
```

---

## Query Hooks

All query hooks use TanStack Query v5 (`useQuery`). They are read-only and do not mutate state. Each hook is enabled only when its required parameters are non-null.

---

### useCampaignDetail

**File:** `src/hooks/useCampaignDetail.ts`
**Query Key:** `["campaign", treeAddress]`
**Stale Time:** 10 seconds

Fetches the full campaign from `/api/campaigns/[treeAddress]`, including analytics, recipients, vesting curve, and root version history.

```ts
import { useCampaignDetail } from "@/hooks/useCampaignDetail";
const { data: campaign, isLoading } = useCampaignDetail(treeAddress);
```

**Key fields on `CampaignDetail`:**

| Field | Type | Description |
|---|---|---|
| `treeAddress` | `string` | Campaign PDA |
| `creator` | `string` | Creator wallet |
| `mint` | `string` | Token mint |
| `leafCount` | `number` | Number of beneficiaries |
| `totalSupply` | `number` | Total tokens locked |
| `totalClaimed` | `number` | Sum of all claims |
| `paused` | `boolean` | Pause state |
| `cancelledAt` | `number \| null` | Unix timestamp of cancel |
| `instantRefunded` | `boolean` | Set by `instant_refund_campaign` |
| `instantRefundEligible` | `boolean` | `true` if `now < min_cliff_time` and multi-leaf |
| `gracePeriod` | `{ end, remaining, isExpired } \| null` | Non-null after cancel |
| `analytics` | `object` | `{ uniqueClaimers, claimCount, percentClaimed, rootVersionCount }` |
| `singleLeaf` | `object \| null` | Non-null for `leaf_count == 1` streams |
| `vestingCurve` | `object \| null` | `{ minStartTime, maxEndTime, samples }` for chart rendering |

---

### useCampaignList

**File:** `src/hooks/useCampaignList.ts`
**Query Key:** `["campaigns", creator]`

Lists campaigns created by a wallet address. Pass `undefined` to list all.

```ts
const { data: campaigns } = useCampaignList(publicKey?.toBase58());
```

---

### useBeneficiaryCampaigns

**File:** `src/hooks/useBeneficiaryCampaigns.ts`
**Query Key:** `["beneficiaryCampaigns", address]`

Lists campaigns where the wallet is a beneficiary.

```ts
const { data: campaigns } = useBeneficiaryCampaigns(publicKey?.toBase58());
```

---

### useProofLookup

**File:** `src/hooks/useProofLookup.ts`
**Query Key:** `["proof", treeAddress, beneficiary]`
**Stale Time:** 30 seconds
**Retry:** Disabled on 404 (beneficiary not in tree)

Fetches the Merkle leaf and proof for a beneficiary.

```ts
const { data: proofData } = useProofLookup(treeAddress, beneficiary);
// proofData?.leaf   -> ProofLeaf (leafIndex, beneficiary, amount, releaseType, ...)
// proofData?.proof  -> number[][] -- pass directly to program.methods.claim()
// null              -> beneficiary not found in tree (404)
```

---

### useClaimRecord

**File:** `src/hooks/useClaimRecord.ts`
**Query Key:** `["claimRecord", treeAddress, beneficiary]`
**Stale Time:** 10 seconds

Reads the on-chain `ClaimRecord` PDA. Returns `null` if the beneficiary has never claimed.

```ts
const { data: record } = useClaimRecord(treeAddress, beneficiary);
// record?.claimedAmount.toString()   -> total claimed so far (base units)
// record?.totalEntitled.toString()   -> total entitled across all leaves
// record?.milestoneBitmap            -> number[] -- bit i set if milestone i claimed
// null                               -> PDA doesn't exist (no claims yet)
```

---

### useVestingProgress

**File:** `src/hooks/useVestingProgress.ts`
**Query Key:** `["vestingProgress", address]`

Returns a beneficiary's vesting summary across all campaigns: total entitled, total claimed, currently claimable, and per-campaign breakdown.

```ts
const { data: progress } = useVestingProgress(publicKey?.toBase58());
// progress?.totalEntitled, progress?.totalClaimed, progress?.totalClaimable
// progress?.campaigns -> per-campaign breakdown
```

---

### useMintDecimals

**File:** `src/hooks/useMintDecimals.ts`
**Query Key:** `["mintDecimals", mintAddress]`

Returns `decimals: number` for an SPL mint (e.g., `6` for USDC).

```ts
const { data: decimals } = useMintDecimals(mint);
const displayAmount = amount / 10 ** (decimals ?? 6);
```

---

### useMintPrices

**File:** `src/hooks/useMintPrices.ts`

Fetches USD prices for a list of SPL mints from the CoinGecko price proxy (`/api/prices`).

---

### useCampaignTimeline

**File:** `src/hooks/useCampaignTimeline.ts`
**Query Key:** `["campaignTimeline", treeAddress]`

Returns chronological on-chain events for a campaign (creates, funds, claims, cancels, milestone releases).

---

### useClaimHistory

**File:** `src/hooks/useClaimHistory.ts`

Returns paginated claim events for a campaign or beneficiary. Parameters: `{ treeAddress?, beneficiary?, page, pageSize }`.

---

### useNeedsActionCount

**File:** `src/hooks/useNeedsActionCount.ts`

Returns a count of outstanding creator actions (campaigns needing attention). Used for the sidebar amber dot badge.

---

### useLocalCampaigns

**File:** `src/hooks/useLocalCampaigns.ts`

Reads pending campaign state from `localStorage`. Used by `PendingCampaignIndexer` to retry failed indexing on next load. Returns `{ pendingFundings, pendingIndexes }`.

---

### useVestingProgram

**File:** `src/hooks/useVestingProgram.ts`

Returns `Program<Vesting> | null` -- the Anchor program instance. Returns `null` when wallet is disconnected.

```ts
const program = useVestingProgram();
if (!program) return; // wallet not connected
const tree = await program.account.vestingTree.fetch(treePda);
```

---

### useWalletTokens

**File:** `src/hooks/useWalletTokens.ts`

Returns the wallet's SPL token accounts (via `WalletTokensProvider` context). Used by `TokenPickerModal` to show wallet balances.

---

## Utility Hooks

| Hook | File | Purpose |
|---|---|---|
| `useMintInfo` | `hooks/useMintInfo.ts` | Fetches token name + symbol from BE |
| `useTokenMetadata` | `hooks/useTokenMetadata.ts` | Fetches token metadata URI + off-chain JSON |
| `useRecentActivity` | `hooks/useRecentActivity.ts` | Recent cross-campaign activity for a wallet |
| `useWalletTokens` | `hooks/useWalletTokens.ts` | Reads `WalletTokensProvider` context |

---

## tx-builder.ts Reference

**File:** `apps/web/src/lib/api/tx-builder.ts`
**Context:** Server-only (no `"use client"`). All functions run in Next.js Route Handlers or Server Actions.

See [ADR-FE-005](../decisions/adr-fe-005-server-side-tx.md) for why transaction building is server-side.

### PreparedTransaction Interface

All builder functions return `Promise<PreparedTransaction>`:

```ts
interface PreparedTransaction {
  transaction: string;             // base58-encoded unsigned serialized Transaction
  signers: string[];               // labels of required signers (e.g. ["creator"])
  instruction: string;             // instruction name (e.g. "cancel_campaign")
  accounts: Record<string, string>;// key account addresses as base58
}
```

### Executing a PreparedTransaction Client-Side

```ts
import bs58 from "bs58";
import { Transaction } from "@solana/web3.js";

const prepared = await buildCancelCampaignTx({
  vestingTree,
  cancelAuthority: publicKey!,
});

const tx = Transaction.from(bs58.decode(prepared.transaction));
const sig = await sendTransaction(tx, connection);
await connection.confirmTransaction(sig, "confirmed");
```

---

### PDA Derivation

All three derivers mirror the on-chain seed layout exactly.

#### deriveVestingTree(creator, mint, campaignId)

```ts
import { deriveVestingTree } from "@/lib/api/tx-builder";
const pda = deriveVestingTree(creator, mint, BigInt(campaignId));
// Seeds: ["tree", creator, mint, campaignId as u64 LE]
```

#### deriveVaultAuthority(vestingTree)

```ts
const vaultAuthority = deriveVaultAuthority(vestingTree);
// Seeds: ["vault_authority", vestingTree]
```

#### deriveClaimRecord(vestingTree, beneficiary)

```ts
const claimRecord = deriveClaimRecord(vestingTree, beneficiary);
// Seeds: ["claim", vestingTree, beneficiary]
```

---

### Builder Functions

#### buildCancelCampaignTx

**On-chain instruction:** `cancel_campaign`
**Required signer:** `cancelAuthority`

```ts
const prepared = await buildCancelCampaignTx({
  vestingTree: new PublicKey(treeAddress),
  cancelAuthority: new PublicKey(cancelAuthorityAddress),
});
```

Fails on-chain with `NotCancellable` (6019) if campaign was created with `cancellable: false`.

#### buildWithdrawUnvestedTx

**On-chain instruction:** `withdraw_unvested`
**Required signer:** `creator`

```ts
const prepared = await buildWithdrawUnvestedTx({
  vestingTree: new PublicKey(treeAddress),
  creator,
  creatorAta,
  mint,
});
```

Fails with `GracePeriodActive` (6027) if less than 7 days have elapsed since `cancelledAt`.

#### buildCancelStreamTx

**On-chain instruction:** `cancel_stream` (single-recipient streams only)
**Required signer:** `creator`

```ts
const prepared = await buildCancelStreamTx({
  vestingTree,
  creator,
  beneficiary,
  beneficiaryAta,
  creatorAta,
  mint,
  withdrawArgs: {
    releaseType: 1,
    startTime: leaf.startTime.toString(),
    cliffTime: leaf.cliffTime.toString(),
    endTime: leaf.endTime.toString(),
    milestoneIdx: leaf.milestoneIdx,
  },
});
```

#### buildMilestoneReleaseTx

**On-chain instruction:** `set_milestone_released`
**Required signer:** `creator`

```ts
const prepared = await buildMilestoneReleaseTx({
  vestingTree: new PublicKey(treeAddress),
  creator: publicKey!,
  milestoneIdx: 3,
});
```

#### buildInstantRefundCampaignTx

**On-chain instruction:** `instant_refund_campaign`
**Required signer:** `creator`

```ts
// SPL campaign:
const prepared = await buildInstantRefundCampaignTx({
  vestingTree, creator: publicKey!, mint,
  creatorAta: getAssociatedTokenAddressSync(mint, publicKey!),
});

// Native SOL campaign (omit creatorAta):
const prepared = await buildInstantRefundCampaignTx({
  vestingTree, creator: publicKey!, mint: PublicKey.default,
});
```

Fails with `CampaignAlreadyStarted` (6036) if `now >= min_cliff_time`.

---

### Constants

```ts
import { GRACE_PERIOD_SECS } from "@/lib/api/tx-builder";
// GRACE_PERIOD_SECS = 604800n   (7 days in seconds, mirrors SC constants.rs)
```
