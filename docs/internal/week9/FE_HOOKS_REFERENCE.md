# FE Hooks Reference — Velthoryn

**Program ID:** `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`
**Path:** `apps/web/src/hooks/` (21 files) + `apps/web/src/lib/api/tx-builder.ts`
**Last updated:** 2026-06-19 (Week 9)

This is the complete reference for every frontend hook and the server-side transaction builder. For the on-chain instruction reference (raw Anchor SDK), see [`INSTRUCTION_REFERENCE.md`](INSTRUCTION_REFERENCE.md).

---

## Contents

- [Action Hooks](#action-hooks) — hooks that mutate on-chain state or make write API calls
- [Query Hooks](#query-hooks) — TanStack Query hooks that fetch read-only data
- [tx-builder.ts Reference](#tx-builderts-reference) — server-side transaction builders
- [Utility Hooks](#utility-hooks)

---

## Action Hooks

Action hooks perform on-chain transactions and return the transaction signature(s). All require a connected wallet; they throw `Error("Wallet not connected")` if called without one.

---

### `useCreateCampaign()`

**File:** `src/hooks/useCreateCampaign.ts`

Creates and funds a multi-recipient campaign. Internally calls `create_campaign` + `fund_campaign` (two separate transactions). Saves a pending index entry to `localStorage` so the campaign is indexed on next page load if the user closes the tab mid-flow.

```ts
import { useCreateCampaign } from "@/hooks/useCreateCampaign";

const {
  createCampaign,          // create only (no fund)
  fundCampaign,            // fund only (for previously created campaigns)
  createAndFundCampaign,   // create + fund in sequence (recommended)
  formatVestingError,      // converts AnchorError → string
} = useCreateCampaign();
```

#### `createCampaign(params)`

| Param | Type | Description |
|-------|------|-------------|
| `mintAddress` | `string` | SPL mint address; `PublicKey.default.toBase58()` for native SOL |
| `campaignId` | `string` | Unique per creator — use `Date.now().toString()` or a UUID |
| `prepared` | `PreparedBulkCampaign` | Output of `prepareCampaign()` from `@velthoryn/client` |
| `cancellable` | `boolean` | Whether `cancel_campaign` / `update_root` are enabled |

Returns `Promise<CreateCampaignResult>`:

```ts
{ sig: string; treeAddress: string; totalSupply: string; indexWarning: string | null }
```

#### `createAndFundCampaign(createParams, options?)`

Calls `createCampaign` then `fundCampaign` in sequence. `options.autoWrap = true` wraps native SOL to wSOL before funding (only needed if `mintAddress` is native SOL).

Returns `Promise<CreateAndFundCampaignResult>`:

```ts
{ createSig: string; fundSig: string; treeAddress: string; totalSupply: string; indexWarning: string | null }
```

#### Usage

```tsx
const { createAndFundCampaign, formatVestingError } = useCreateCampaign();

try {
  const result = await createAndFundCampaign({
    mintAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC devnet
    campaignId: Date.now().toString(),
    prepared,         // PreparedBulkCampaign from prepareCampaign()
    cancellable: true,
  });
  console.log("Campaign PDA:", result.treeAddress);
  if (result.indexWarning) console.warn("Index failed:", result.indexWarning);
} catch (err) {
  toast.error(formatVestingError(err));
}
```

---

### `useCreateStream()`

**File:** `src/hooks/useCreateStream.ts`

Creates and funds a **single-recipient** stream in one transaction. The recipient claims via `withdraw` (no Merkle proof needed).

```ts
import { useCreateStream } from "@/hooks/useCreateStream";
const { createStream, formatVestingError } = useCreateStream();
```

#### `createStream(params)`

| Param | Type | Description |
|-------|------|-------------|
| `mintAddress` | `string` | SPL mint or `PublicKey.default.toBase58()` for native SOL |
| `campaignId` | `string` | Unique campaign ID |
| `beneficiary` | `string` | Recipient wallet address (base58) |
| `amount` | `string` | Token amount in base units |
| `releaseType` | `number` | `0` = Cliff, `1` = Linear, `2` = Milestone |
| `startTime` | `number` | Unix timestamp (seconds) |
| `cliffTime` | `number` | Unix timestamp — first unlock for Cliff; start of ramp for Linear |
| `endTime` | `number` | Unix timestamp — full vest |
| `milestoneIdx` | `number` | Milestone index (only matters for `releaseType = 2`) |
| `cancellable` | `boolean` | |

Returns `Promise<{ sig: string; treeAddress: string }>`.

---

### `useUpdateRoot()`

**File:** `src/hooks/useUpdateRoot.ts`

Calls `update_root` on-chain to replace the Merkle root, then saves the new root version to the backend API. Automatically evicts the proof cache so all `useProofLookup` queries refetch.

```ts
import { useUpdateRoot } from "@/hooks/useUpdateRoot";
const { updateRoot } = useUpdateRoot();
```

#### `updateRoot(params)`

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

Returns `Promise<{ sig: string; version: number | null; indexWarning: string | null }>`.

> The signer must be `cancel_authority` for the campaign — the hook reads `useWallet().publicKey`.

---

### `useWrapSol()`

**File:** `src/hooks/useWrapSol.ts`

Wraps or unwraps native SOL ↔ wSOL (Wrapped SOL ATA). Used when the selected token in the create flow is native SOL.

```ts
import { useWrapSol } from "@/hooks/useWrapSol";
const { wrapSol, unwrapSol } = useWrapSol();

await wrapSol({ amountLamports: 1_000_000_000n });   // 1 SOL
await unwrapSol();                                    // close wSOL ATA, reclaim lamports
```

---

## Query Hooks

All query hooks use TanStack Query v5 (`useQuery`). They are read-only — they do not mutate state. Each hook is enabled only when its required parameters are non-null.

---

### `useCampaignDetail(treeAddress)`

**File:** `src/hooks/useCampaignDetail.ts`
**QueryKey:** `["campaign", treeAddress]`
**Stale time:** 10 s

Fetches the full campaign from `/api/campaigns/[treeAddress]`, including analytics, recipients, vesting curve, and root version history.

```ts
import { useCampaignDetail } from "@/hooks/useCampaignDetail";

const { data: campaign, isLoading } = useCampaignDetail(treeAddress);
```

Key fields on `CampaignDetail`:

| Field | Type | Description |
|-------|------|-------------|
| `treeAddress` | `string` | Campaign PDA |
| `creator` | `string` | Creator wallet |
| `mint` | `string` | Token mint (`PublicKey.default` for native SOL) |
| `leafCount` | `number` | Number of beneficiaries |
| `totalSupply` | `number` | Total tokens locked |
| `totalClaimed` | `number` | Sum of all claims so far |
| `paused` | `boolean` | |
| `cancelledAt` | `number \| null` | Unix timestamp of cancel |
| `instantRefunded` | `boolean` | Set by `instant_refund_campaign` |
| `instantRefundEligible` | `boolean` | `true` if `now < min_cliff_time` and multi-leaf |
| `gracePeriod` | `{ end, remaining, isExpired } \| null` | Non-null after cancel |
| `analytics` | `{ uniqueClaimers, claimCount, percentClaimed, rootVersionCount }` | |
| `singleLeaf` | `object \| null` | Non-null for leaf_count == 1 streams |
| `vestingCurve` | `{ minStartTime, maxEndTime, samples } \| null` | For chart rendering |

---

### `useCampaignList(creator?)`

**File:** `src/hooks/useCampaignList.ts`
**QueryKey:** `["campaigns", creator]`

Lists campaigns created by a wallet address (from the indexer API). Pass `undefined` to list all.

```ts
const { data: campaigns } = useCampaignList(publicKey?.toBase58());
```

---

### `useBeneficiaryCampaigns(address?)`

**File:** `src/hooks/useBeneficiaryCampaigns.ts`
**QueryKey:** `["beneficiaryCampaigns", address]`

Lists campaigns where the wallet is a beneficiary. Fetches from `/api/beneficiary/[address]/campaigns`.

```ts
const { data: campaigns } = useBeneficiaryCampaigns(publicKey?.toBase58());
```

---

### `useProofLookup(treeAddress, beneficiary)`

**File:** `src/hooks/useProofLookup.ts`
**QueryKey:** `["proof", treeAddress, beneficiary]`
**Stale time:** 30 s
**Retry:** disabled on 404 (beneficiary not in tree)

Fetches the Merkle leaf + proof for a beneficiary from `/api/campaigns/[treeAddress]/proof?beneficiary=`.

```ts
const { data: proofData } = useProofLookup(treeAddress, beneficiary);
// proofData?.leaf   → ProofLeaf (leafIndex, beneficiary, amount, releaseType, …)
// proofData?.proof  → number[][] — pass directly to program.methods.claim()
// null              → beneficiary not found in tree (404)
```

---

### `useClaimRecord(treeAddress, beneficiary)`

**File:** `src/hooks/useClaimRecord.ts`
**QueryKey:** `["claimRecord", treeAddress, beneficiary]`
**Stale time:** 10 s

Reads the on-chain `ClaimRecord` PDA. Returns `null` if the beneficiary has never claimed (PDA not yet created).

```ts
const { data: record } = useClaimRecord(treeAddress, beneficiary);
// record?.claimedAmount.toString()   → total claimed so far (base units)
// record?.totalEntitled.toString()   → total entitled across all leaves
// record?.milestoneBitmap            → number[] — bit i set if milestone i claimed
// null                               → PDA doesn't exist (no claims yet)
```

---

### `useVestingProgress(address?)`

**File:** `src/hooks/useVestingProgress.ts`
**QueryKey:** `["vestingProgress", address]`

Returns a beneficiary's vesting summary across all campaigns: total entitled, total claimed, currently claimable, and per-campaign breakdown.

```ts
const { data: progress } = useVestingProgress(publicKey?.toBase58());
// progress?.totalEntitled, progress?.totalClaimed, progress?.totalClaimable
// progress?.campaigns → per-campaign breakdown
```

---

### `useMintDecimals(mintAddress?)`

**File:** `src/hooks/useMintDecimals.ts`
**QueryKey:** `["mintDecimals", mintAddress]`

Returns `decimals: number` for an SPL mint (e.g. `6` for USDC). Used to convert between base units and display amounts.

```ts
const { data: decimals } = useMintDecimals(mint);
const displayAmount = amount / 10 ** (decimals ?? 6);
```

---

### `useMintPrices(mints)`

**File:** `src/hooks/useMintPrices.ts`

Fetches USD prices for a list of SPL mints from the CoinGecko price proxy (`/api/prices`).

---

### `useCampaignTimeline(treeAddress?)`

**File:** `src/hooks/useCampaignTimeline.ts`
**QueryKey:** `["campaignTimeline", treeAddress]`

Returns chronological on-chain events for a campaign (creates, funds, claims, cancels, milestone releases). Used by the Activity tab.

---

### `useClaimHistory(params)`

**File:** `src/hooks/useClaimHistory.ts`

Returns paginated claim events for a campaign or beneficiary. Parameters: `{ treeAddress?, beneficiary?, page, pageSize }`.

---

### `useNeedsActionCount(address?)`

**File:** `src/hooks/useNeedsActionCount.ts`

Returns a count of outstanding creator actions (campaigns needing attention: cancelled with unvested funds, milestones to release, etc.). Used for the sidebar amber dot badge.

---

### `useLocalCampaigns()`

**File:** `src/hooks/useLocalCampaigns.ts`

Reads pending campaign state from `localStorage`. Used by `PendingCampaignIndexer` to retry failed indexing on next load. Returns `{ pendingFundings, pendingIndexes }`.

---

### `useVestingProgram()`

**File:** `src/hooks/useVestingProgram.ts`

Returns `Program<Vesting> | null` — the Anchor program instance. Returns `null` when wallet is disconnected.

```ts
const program = useVestingProgram();
if (!program) return; // wallet not connected
const tree = await program.account.vestingTree.fetch(treePda);
```

---

### `useWalletTokens()`

**File:** `src/hooks/useWalletTokens.ts`

Returns the wallet's SPL token accounts (via `WalletTokensProvider` context). Used by `TokenPickerModal` to show wallet balances.

---

## tx-builder.ts Reference

**File:** `apps/web/src/lib/api/tx-builder.ts`
**Context:** Server-only (no `"use client"`). All functions run in Next.js Route Handlers or Server Actions. See [ADR-FE-005](ADRs/ADR-FE-005-server-side-tx-building.md) for why this is server-side.

All builder functions return `Promise<PreparedTransaction>`:

```ts
interface PreparedTransaction {
  transaction: string;             // base58-encoded unsigned serialized Transaction
  signers: string[];               // labels of required signers (e.g. ["creator"])
  instruction: string;             // instruction name (e.g. "cancel_campaign")
  accounts: Record<string, string>;// key account addresses as base58
}
```

**How to execute a PreparedTransaction client-side:**

```ts
import bs58 from "bs58";
import { Transaction } from "@solana/web3.js";

const prepared = await buildCancelCampaignTx({ vestingTree, cancelAuthority: publicKey! });

const tx = Transaction.from(bs58.decode(prepared.transaction));
const sig = await sendTransaction(tx, connection);
await connection.confirmTransaction(sig, "confirmed");
```

---

### PDA Derivation

All three derivers mirror the on-chain seed layout exactly.

#### `deriveVestingTree(creator, mint, campaignId)`

```ts
import { deriveVestingTree } from "@/lib/api/tx-builder";
const pda = deriveVestingTree(creator, mint, BigInt(campaignId));
// Seeds: ["tree", creator, mint, campaignId as u64 LE]
```

#### `deriveVaultAuthority(vestingTree)`

```ts
const vaultAuthority = deriveVaultAuthority(vestingTree);
// Seeds: ["vault_authority", vestingTree]
```

#### `deriveClaimRecord(vestingTree, beneficiary)`

```ts
const claimRecord = deriveClaimRecord(vestingTree, beneficiary);
// Seeds: ["claim", vestingTree, beneficiary]
```

---

### `buildCancelCampaignTx(params)`

**On-chain instruction:** `cancel_campaign`
**Required signer:** `cancelAuthority`

```ts
const prepared = await buildCancelCampaignTx({
  vestingTree: new PublicKey(treeAddress),
  cancelAuthority: new PublicKey(cancelAuthorityAddress),
});
```

Fails on-chain with `NotCancellable` (6019) if campaign was created with `cancellable: false`.

---

### `buildWithdrawUnvestedTx(params)`

**On-chain instruction:** `withdraw_unvested`
**Required signer:** `creator`

```ts
const creatorAta = getAssociatedTokenAddressSync(mint, creator);
const prepared = await buildWithdrawUnvestedTx({
  vestingTree: new PublicKey(treeAddress),
  creator,
  creatorAta,
  mint,
});
```

Fails with `GracePeriodActive` (6027) if less than 7 days have elapsed since `cancelledAt`.

---

### `buildCancelStreamTx(params)`

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
    releaseType: 1,                  // must match the leaf's schedule
    startTime: leaf.startTime.toString(),
    cliffTime: leaf.cliffTime.toString(),
    endTime: leaf.endTime.toString(),
    milestoneIdx: leaf.milestoneIdx,
  },
});
```

---

### `buildMilestoneReleaseTx(params)`

**On-chain instruction:** `set_milestone_released`
**Required signer:** `creator`

```ts
const prepared = await buildMilestoneReleaseTx({
  vestingTree: new PublicKey(treeAddress),
  creator: publicKey!,
  milestoneIdx: 3,                   // 0–255; must match leaf's milestoneIdx
});
```

---

### `buildInstantRefundCampaignTx(params)`

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

---

## Utility Hooks (minor)

| Hook | File | Purpose |
|------|------|---------|
| `useMintInfo` | `hooks/useMintInfo.ts` | Fetches token name + symbol from BE |
| `useTokenMetadata` | `hooks/useTokenMetadata.ts` | Fetches token metadata URI + off-chain JSON |
| `useRecentActivity` | `hooks/useRecentActivity.ts` | Recent cross-campaign activity for a wallet |
| `useWalletTokens` | `hooks/useWalletTokens.ts` | Reads `WalletTokensProvider` context |

---

## Further Reading

- [FE Integration Guide](FE_INTEGRATION_GUIDE.md) — step-by-step flows using these hooks
- [FE Architecture](FE_ARCHITECTURE.md) — provider hierarchy, data flow, state management
- [Instruction Reference](INSTRUCTION_REFERENCE.md) — on-chain instruction signatures (raw Anchor SDK)
- [ADR-FE-005](ADRs/ADR-FE-005-server-side-tx-building.md) — why tx-builder.ts is server-side
