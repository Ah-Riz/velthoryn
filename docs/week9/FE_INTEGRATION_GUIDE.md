# FE Integration Guide — Velthoryn (Frontend Developer Edition)

**Audience:** A React/Next.js developer integrating the Velthoryn vesting protocol who has never seen this codebase.
**Goal:** Go from zero to a working campaign create + beneficiary claim flow using the frontend abstraction layer.
**Scope:** `apps/web/src/` — hooks, tx-builder, and the component layer. For raw Anchor SDK integration (no React), see [`INTEGRATION_GUIDE.md`](INTEGRATION_GUIDE.md).

---

## What this guide covers

This guide shows the **frontend abstraction layer**: React hooks + server-side tx-builder. The hooks wrap Anchor calls, handle error formatting, and sync results to the indexing backend. You do **not** need to write raw Anchor calls for any standard flow.

| Flow | What you use |
|------|-------------|
| Create campaign (multi-recipient) | `useCreateCampaign` hook |
| Create single-recipient stream | `useCreateStream` hook |
| Read campaign state | `useCampaignDetail` hook |
| Beneficiary proof lookup | `useProofLookup` hook |
| Beneficiary claim (on-chain) | `program.methods.claim()` (no dedicated hook — see §5) |
| Cancel / withdraw / milestone / refund | `tx-builder.ts` functions (server-side) |
| Root rotation | `useUpdateRoot` hook |

---

## 0. Prerequisites

```bash
# Install dependencies
pnpm install

# Env — copy and fill in the required values
cp apps/web/.env.example apps/web/.env.local
```

Required `.env.local` variables for development:

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Yes | Postgres (Supabase or local) |
| `NEXT_PUBLIC_RPC_ENDPOINT` | Yes | e.g. `https://api.devnet.solana.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | |
| `ADMIN_API_KEY` | Yes | Internal admin routes |
| `API_KEY` | Yes | Internal API routes |
| `PINATA_JWT` | Yes | Merkle data uploads |
| `PINATA_GATEWAY_URL` | Yes | |
| `CRON_SECRET` | Yes | `/api/cron/sync` |
| `NEXT_PUBLIC_E2E_MOCK_WALLET` | Test only | `true` enables E2E mock wallet |

```bash
# Start dev server
pnpm --filter web dev          # → http://localhost:3000

# Verify RPC connection
# Open the app, connect a Phantom wallet set to Devnet — campaigns page should load.
```

---

## 1. Provider Setup

All client components that need on-chain access call `useVestingProgram()`. This hook returns an Anchor `Program` instance when a wallet is connected, or `null` when disconnected.

```tsx
"use client";
import { useVestingProgram } from "@/hooks/useVestingProgram";
import { useWallet } from "@solana/wallet-adapter-react";

function MyComponent() {
  const program = useVestingProgram();   // Program<Vesting> | null
  const { publicKey } = useWallet();

  if (!program || !publicKey) {
    return <p>Connect your wallet to continue.</p>;
  }

  // program.methods.claim(...), program.account.vestingTree.fetch(...), etc.
  return <div>Connected: {publicKey.toBase58()}</div>;
}
```

The provider hierarchy is already wired up in `apps/web/src/app/layout.tsx`. You do not need to add `WalletProvider` yourself — it is a root-level provider.

---

## 2. Create a Campaign (Multi-Recipient)

`useCreateCampaign` handles the full 2-transaction flow: `create_campaign` + `fund_campaign`. It also saves a pending index entry to localStorage so the campaign is indexed even if the user closes the tab between the two transactions.

### Step 1: Prepare the Merkle tree (off-chain)

Use `prepareCampaign` from `@velthoryn/client` (`clients/ts/`) to build the tree from a recipient list. This generates the Merkle root and all proofs.

```ts
import { prepareCampaign, ReleaseType } from "@velthoryn/client";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";

const now = Math.floor(Date.now() / 1000);

const prepared = prepareCampaign([
  {
    beneficiary: new PublicKey("Alice..."),
    amount: new BN(1_000_000),              // in token base units (lamports / smallest denomination)
    releaseType: ReleaseType.Linear,
    startTime: new BN(now),
    cliffTime: new BN(now),
    endTime: new BN(now + 365 * 86_400),    // 1 year linear
    milestoneIdx: 0,
  },
  {
    beneficiary: new PublicKey("Bob..."),
    amount: new BN(500_000),
    releaseType: ReleaseType.Cliff,
    startTime: new BN(now),
    cliffTime: new BN(now + 180 * 86_400), // cliff in 6 months
    endTime: new BN(now + 180 * 86_400),
    milestoneIdx: 0,
  },
]);

// prepared.root           → Buffer (32 bytes) — stored on-chain
// prepared.rootHex        → hex string         — for API POST
// prepared.leafCount      → number
// prepared.totalSupply    → BN (sum of all amounts)
// prepared.minCliffTime   → BN (earliest cliff)
// prepared.leaves[i]      → VestingLeaf (70-byte Borsh layout)
// prepared.proofs[i]      → number[][]
```

In practice, `prepareCampaign` is called from the bulk CSV processor (`lib/campaign/bulk.ts`) and returns a `PreparedBulkCampaign` object. If you are building a form UI, call `prepareCampaign` in the form's submit handler after validating inputs.

### Step 2: Create + fund using the hook

```tsx
"use client";
import { useCreateCampaign } from "@/hooks/useCreateCampaign";
import { useState } from "react";

function CreateCampaignPage() {
  const { createAndFundCampaign, formatVestingError } = useCreateCampaign();
  const [status, setStatus] = useState<string>("");

  async function handleSubmit() {
    try {
      setStatus("Sending create transaction…");
      const result = await createAndFundCampaign(
        {
          mintAddress: "USDC_MINT_ADDRESS",   // SPL mint; PublicKey.default.toBase58() for native SOL
          campaignId: Date.now().toString(),   // must be unique per creator
          prepared,                            // PreparedBulkCampaign from Step 1
          cancellable: true,
        },
        { autoWrap: false },                  // set true if mintAddress is native SOL
      );

      // result.createSig   → transaction signature for create_campaign
      // result.fundSig     → transaction signature for fund_campaign
      // result.treeAddress → the VestingTree PDA (use this as the campaign ID everywhere)
      // result.totalSupply → total tokens locked (as string, for display)
      // result.indexWarning → non-null if BE indexing failed (campaign is on-chain; retry later)
      setStatus(`Campaign created: ${result.treeAddress}`);
    } catch (err) {
      setStatus(formatVestingError(err));     // converts Anchor/program errors to human-readable strings
    }
  }

  return (
    <div>
      <button onClick={handleSubmit}>Create Campaign</button>
      <p>{status}</p>
    </div>
  );
}
```

> **Native SOL:** Pass `mintAddress: PublicKey.default.toBase58()` and `autoWrap: false`. The hook automatically routes to `create_campaign_native` + `fund_campaign_native`.

### Step 3: Display campaign state

```tsx
"use client";
import { useCampaignDetail } from "@/hooks/useCampaignDetail";

function CampaignPage({ treeAddress }: { treeAddress: string }) {
  const { data: campaign, isLoading, error } = useCampaignDetail(treeAddress);

  if (isLoading) return <p>Loading…</p>;
  if (error || !campaign) return <p>Campaign not found.</p>;

  return (
    <div>
      <p>Creator: {campaign.creator}</p>
      <p>Total Supply: {campaign.totalSupply}</p>
      <p>Total Claimed: {campaign.totalClaimed}</p>
      <p>Paused: {campaign.paused ? "Yes" : "No"}</p>
      <p>Cancelled At: {campaign.cancelledAt ?? "Active"}</p>
      <p>Recipients: {campaign.analytics.uniqueClaimers} claimers / {campaign.leafCount} leaves</p>
    </div>
  );
}
```

`useCampaignDetail` refreshes every 10 seconds (stale time). TanStack Query key: `["campaign", treeAddress]`.

---

## 3. Create a Single-Recipient Stream

For one recipient, use `useCreateStream` — it creates and funds in one transaction and requires no Merkle tree. The recipient later claims via `withdraw` (no proof array).

```tsx
"use client";
import { useCreateStream } from "@/hooks/useCreateStream";

function CreateStreamPage() {
  const { createStream, formatVestingError } = useCreateStream();
  const now = Math.floor(Date.now() / 1000);

  async function handleSubmit() {
    const result = await createStream({
      mintAddress: "TOKEN_MINT",
      campaignId: Date.now().toString(),
      beneficiary: "RECIPIENT_WALLET",
      amount: "1000000",                     // string; base units
      releaseType: 1,                        // 0=Cliff, 1=Linear, 2=Milestone
      startTime: now,
      cliffTime: now,
      endTime: now + 365 * 86_400,
      milestoneIdx: 0,
      cancellable: true,
    });
    // result.treeAddress → the VestingTree PDA for this stream
  }
}
```

---

## 4. Beneficiary: Read Vesting State

### 4a. Look up the Merkle proof

`useProofLookup` fetches the leaf + proof for a beneficiary from the backend. Returns `null` if the beneficiary is not in the tree.

```tsx
"use client";
import { useProofLookup } from "@/hooks/useProofLookup";
import { useWallet } from "@solana/wallet-adapter-react";

function ClaimSection({ treeAddress }: { treeAddress: string }) {
  const { publicKey } = useWallet();
  const { data: proofData, isLoading } = useProofLookup(
    treeAddress,
    publicKey?.toBase58(),
  );

  if (isLoading) return <p>Checking eligibility…</p>;
  if (!proofData) return <p>You are not a beneficiary of this campaign.</p>;

  // proofData.leaf.amount     → entitlement (base units)
  // proofData.leaf.releaseType → 0|1|2
  // proofData.leaf.cliffTime  → Unix timestamp
  // proofData.proof           → number[][] — pass directly to claim
  return <p>You are entitled to {proofData.leaf.amount} tokens.</p>;
}
```

QueryKey: `["proof", treeAddress, beneficiary]` — stale after 30 s, no retry on 404.

### 4b. Read the on-chain claim record

`useClaimRecord` reads the `ClaimRecord` PDA to show how much has already been claimed.

```tsx
"use client";
import { useClaimRecord } from "@/hooks/useClaimRecord";

function ClaimedSoFar({ treeAddress, beneficiary }: { treeAddress: string; beneficiary: string }) {
  const { data: record } = useClaimRecord(treeAddress, beneficiary);

  if (!record) return <p>No claims yet.</p>;

  return (
    <p>
      Claimed: {record.claimedAmount.toString()} /
      Entitled: {record.totalEntitled.toString()}
    </p>
  );
}
```

QueryKey: `["claimRecord", treeAddress, beneficiary]`. Returns `null` if the PDA does not exist yet (no claims made).

---

## 5. Beneficiary: Submit a Claim

There is no dedicated claim hook — claims are submitted inline via `program.methods.claim()`. Use `useVestingProgram()` to get the program instance, `useProofLookup` for the leaf/proof, and `deriveClaimRecord` + `deriveVaultAuthority` from `tx-builder.ts` for the accounts.

```tsx
"use client";
import { useVestingProgram } from "@/hooks/useVestingProgram";
import { useProofLookup } from "@/hooks/useProofLookup";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  deriveClaimRecord,
  deriveVaultAuthority,
} from "@/lib/api/tx-builder";
import { formatVestingError } from "@/lib/anchor/errors";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";

function ClaimButton({ treeAddress, mint }: { treeAddress: string; mint: string }) {
  const program = useVestingProgram();
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { data: proofData } = useProofLookup(treeAddress, publicKey?.toBase58());

  async function handleClaim() {
    if (!program || !publicKey || !proofData) return;

    const vestingTree = new PublicKey(treeAddress);
    const mintKey = new PublicKey(mint);
    const vaultAuthority = deriveVaultAuthority(vestingTree);
    const vault = getAssociatedTokenAddressSync(mintKey, vaultAuthority, true);
    const claimRecord = deriveClaimRecord(vestingTree, publicKey);
    const beneficiaryAta = getAssociatedTokenAddressSync(mintKey, publicKey);

    const leaf = proofData.leaf;
    const leafStruct = {
      leafIndex: leaf.leafIndex,
      beneficiary: new PublicKey(leaf.beneficiary),
      amount: new BN(leaf.amount),
      releaseType: leaf.releaseType,
      startTime: new BN(leaf.startTime),
      cliffTime: new BN(leaf.cliffTime),
      endTime: new BN(leaf.endTime),
      milestoneIdx: leaf.milestoneIdx,
    };

    try {
      const tx = await program.methods
        .claim(leafStruct, proofData.proof)
        .accounts({
          beneficiary: publicKey,
          vestingTree,
          claimRecord,
          vaultAuthority,
          vault,
          beneficiaryAta,
          mint: mintKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
    } catch (err) {
      console.error(formatVestingError(err));
    }
  }

  if (!proofData) return null;
  return <button onClick={handleClaim}>Claim Tokens</button>;
}
```

> **Why no dedicated claim hook?** The claim instruction requires the beneficiary's ATA to be created on-chain if it does not exist (`init_if_needed`). The FE handles this implicitly via the Anchor client, so no additional wrapping is needed.

---

## 5b. Single-Stream Beneficiary: Submit a Withdraw

For single-recipient streams created with `useCreateStream`, there is no Merkle proof array. The beneficiary provides the schedule args directly — the program derives the leaf hash from those args and checks it against `vestingTree.merkleRoot`.

> **No proof needed.** Read the schedule args from `useCampaignDetail`
> (`releaseType`, `startDate`, `cliffDate`, `endDate`). There is no `useProofLookup` call.

```tsx
"use client";
import { useVestingProgram } from "@/hooks/useVestingProgram";
import { useCampaignDetail } from "@/hooks/useCampaignDetail";
import {
  deriveClaimRecord,
  deriveVaultAuthority,
} from "@/lib/api/tx-builder";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { formatVestingError } from "@/lib/anchor/errors";
import BN from "bn.js";

function WithdrawButton({ treeAddress, mint }: { treeAddress: string; mint: string }) {
  const program = useVestingProgram();
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { data: campaign } = useCampaignDetail(treeAddress);

  async function handleWithdraw() {
    if (!program || !publicKey || !campaign) return;

    const vestingTree    = new PublicKey(treeAddress);
    const mintKey        = new PublicKey(mint);
    const vaultAuthority = deriveVaultAuthority(vestingTree);
    const vault          = getAssociatedTokenAddressSync(mintKey, vaultAuthority, true);
    const claimRecord    = deriveClaimRecord(vestingTree, publicKey);
    const beneficiaryAta = getAssociatedTokenAddressSync(mintKey, publicKey);

    const withdrawArgs = {
      releaseType:  campaign.releaseType,
      startTime:    new BN(campaign.startDate.toString()),
      cliffTime:    new BN(campaign.cliffDate.toString()),
      endTime:      new BN(campaign.endDate.toString()),
      milestoneIdx: 0,  // non-milestone streams always 0
    };

    try {
      const tx = await program.methods
        .withdraw(withdrawArgs)
        .accounts({
          beneficiary:            publicKey,
          vestingTree,
          claimRecord,
          vaultAuthority,
          vault,
          mint:                   mintKey,
          beneficiaryAta,
          tokenProgram:           TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram:          SystemProgram.programId,
        })
        .transaction();

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
    } catch (err) {
      console.error(formatVestingError(err));
    }
  }

  return <button onClick={handleWithdraw}>Withdraw Vested Tokens</button>;
}
```

> **`NotSingleStream` (6029)** — thrown if `leaf_count > 1`. Use §5 (`claim` with proof) for multi-recipient campaigns.
>
> **`NothingToClaim` (6015)** — vested amount is zero (cliff time not reached). Gate the button with `campaign.cliffDate < BigInt(Date.now() / 1000)`.

---

## 6. Creator Admin Operations

All creator operations (cancel, withdraw, milestone release, instant refund) follow the same pattern: **build the unsigned transaction server-side, then sign and send client-side.**

### The server→client pattern

```tsx
import {
  buildCancelCampaignTx,
  type PreparedTransaction,
} from "@/lib/api/tx-builder";
import { PublicKey, Transaction } from "@solana/web3.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { formatVestingError } from "@/lib/anchor/errors";

// Generic function you can reuse for ALL tx-builder operations:
async function sendPreparedTx(
  prepared: PreparedTransaction,
  sendTransaction: ReturnType<typeof useWallet>["sendTransaction"],
  connection: ReturnType<typeof useConnection>["connection"],
) {
  const tx = Transaction.from(bs58.decode(prepared.transaction));
  const sig = await sendTransaction(tx, connection);
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}
```

### 6a. Cancel a campaign

```tsx
const { publicKey, sendTransaction } = useWallet();
const { connection } = useConnection();

const prepared = await buildCancelCampaignTx({
  vestingTree: new PublicKey(treeAddress),
  cancelAuthority: publicKey!,
});
const sig = await sendPreparedTx(prepared, sendTransaction, connection);
```

### 6b. Withdraw unvested tokens (after 7-day grace)

```tsx
import { buildWithdrawUnvestedTx } from "@/lib/api/tx-builder";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

const creatorAta = getAssociatedTokenAddressSync(new PublicKey(mint), publicKey!);
const prepared = await buildWithdrawUnvestedTx({
  vestingTree: new PublicKey(treeAddress),
  creator: publicKey!,
  creatorAta,
  mint: new PublicKey(mint),
});
const sig = await sendPreparedTx(prepared, sendTransaction, connection);
```

> `GracePeriodActive` (error 6027) is returned if 7 days have not elapsed since `cancelledAt`. Check `campaign.gracePeriod.isExpired` before enabling the button.

### 6c. Release a milestone

```tsx
import { buildMilestoneReleaseTx } from "@/lib/api/tx-builder";

const prepared = await buildMilestoneReleaseTx({
  vestingTree: new PublicKey(treeAddress),
  creator: publicKey!,
  milestoneIdx: 3,          // must match milestoneIdx in the recipient's leaf
});
const sig = await sendPreparedTx(prepared, sendTransaction, connection);
```

### 6d. Instant refund (before `min_cliff_time`, multi-leaf campaigns only)

```tsx
import { buildInstantRefundCampaignTx } from "@/lib/api/tx-builder";

// SPL token campaign:
const creatorAta = getAssociatedTokenAddressSync(new PublicKey(mint), publicKey!);
const prepared = await buildInstantRefundCampaignTx({
  vestingTree: new PublicKey(treeAddress),
  creator: publicKey!,
  mint: new PublicKey(mint),
  creatorAta,            // required for SPL; omit for native SOL
});
const sig = await sendPreparedTx(prepared, sendTransaction, connection);
```

> Error `CampaignAlreadyStarted` (6036): `now >= min_cliff_time`. Check `campaign.instantRefundEligible` before enabling the button.

### 6e. Root rotation (update recipient set)

```tsx
import { useUpdateRoot, type UpdateRootParams } from "@/hooks/useUpdateRoot";
import { prepareCampaign } from "@velthoryn/client";

const { updateRoot } = useUpdateRoot();

const newPrepared = prepareCampaign(newRecipientList);
const result = await updateRoot({
  treeAddress,
  payload: {
    merkleRoot: newPrepared.rootHex,
    leafCount: newPrepared.leafCount,
    minCliffTime: newPrepared.minCliffTime.toString(),
    leaves: newPrepared.leaves.map((l, i) => ({
      leafIndex: l.leafIndex,
      beneficiary: l.beneficiary.toBase58(),
      amount: l.amount.toString(),
      releaseType: l.releaseType,
      startTime: l.startTime.toString(),
      cliffTime: l.cliffTime.toString(),
      endTime: l.endTime.toString(),
      milestoneIdx: l.milestoneIdx,
      proof: newPrepared.proofs[i],
    })),
  },
});
// result.sig       → on-chain tx signature
// result.version   → new root version number in DB
// result.indexWarning → non-null if BE indexing failed
```

After rotation, all old proofs are invalid. The hook automatically evicts the proof cache (`["proof", treeAddress]`) so `useProofLookup` refetches with the new root.

### 6f. Pause and unpause

Pause/unpause has no dedicated hook or tx-builder function — these are called inline via `program.methods`:

```tsx
const vestingTree = new PublicKey(treeAddress);

// Pause (signer = pause_authority)
const pauseIx = await program.methods
  .pauseCampaign()
  .accounts({ pauseAuthority: publicKey, vestingTree })
  .instruction();

// Unpause
const unpauseIx = await program.methods
  .unpauseCampaign()
  .accounts({ pauseAuthority: publicKey, vestingTree })
  .instruction();

const tx = new Transaction().add(paused ? unpauseIx : pauseIx);
const sig = await sendTransaction(tx, connection);
await connection.confirmTransaction(sig, "confirmed");
```

> `Unauthorized` (6005) if signer ≠ `pause_authority`. `AlreadyPaused` (6022) / `NotPaused` (6024) guard double-toggling.

---

## 7. Campaign Lifecycle State in UI

The `CampaignLifecycle` type drives all UI branching. Import from `apps/web/src/lib/vesting/list.ts`.

```ts
type CampaignLifecycle =
  | "active"
  | "paused"
  | "claimable"
  | "claimed"
  | "cancelled_grace"
  | "cancelled_expired"
  | "instant_refunded"
  | "settled";
```

Branch the UI by state:

```tsx
import { isGracePeriodVisible } from "@/lib/vesting/list";

function CampaignActions({ campaign }: { campaign: CampaignDetail }) {
  const lifecycle = campaign.paused
    ? "paused"
    : campaign.instantRefunded
    ? "instant_refunded"
    : campaign.cancelledAt && isGracePeriodVisible(campaign)
    ? "cancelled_grace"
    : campaign.cancelledAt
    ? "cancelled_expired"
    : "active";

  switch (lifecycle) {
    case "active":
      return <ClaimButton />;
    case "paused":
      return <p>Campaign is paused. Claiming is disabled.</p>;
    case "cancelled_grace":
      return (
        <>
          <ClaimButton />
          <p>Grace period ends: {campaign.gracePeriod?.end}</p>
        </>
      );
    case "cancelled_expired":
      return <WithdrawUnvestedButton />;
    case "instant_refunded":
      return <p>Campaign was instantly refunded. No claims possible.</p>;
    default:
      return null;
  }
}
```

`isGracePeriodVisible(campaign)` returns `true` only when ALL three conditions hold: `cancelledAt != null`, `instantRefunded === false`, `streamSettled === false`.

---

## 8. Error Handling

All Anchor/program errors bubble up as `AnchorError` with a `error.code` number. Use `formatVestingError` to convert them to user-readable strings.

```ts
import { formatVestingError } from "@/lib/anchor/errors";

try {
  await createAndFundCampaign({ ... });
} catch (err) {
  const message = formatVestingError(err);
  // message → "Campaign is paused" / "Nothing to claim" / etc.
  toast.error(message);
}
```

Common errors a FE developer will hit:

| Code | Name | When it happens |
|------|------|-----------------|
| 6009 | `CampaignPaused` | Claiming while `campaign.paused === true` |
| 6013 | `InvalidProof` | Stale proof after root rotation — evict cache + refetch |
| 6015 | `NothingToClaim` | Too early (before cliff) or fully claimed |
| 6027 | `GracePeriodActive` | `withdraw_unvested` before 7 days have elapsed |
| 6033 | `MilestoneNotReleased` | Beneficiary tried to claim before creator released |
| 6036 | `CampaignAlreadyStarted` | Instant refund attempted after `min_cliff_time` |
| 6041 | `PerLeafCapExceeded` | Beneficiary exceeded `PER_LEAF_CAP = 8` claim slots |

Full error table (6000–6041): [`INSTRUCTION_REFERENCE.md` §Error codes](INSTRUCTION_REFERENCE.md#error-codes-vestingerror-anchor-codes-60006041).

---

## 9. Further Reading

- [FE Hooks Reference](FE_HOOKS_REFERENCE.md) — all 21 hooks + tx-builder functions with full signatures
- [FE Architecture](FE_ARCHITECTURE.md) — provider hierarchy, data flow diagrams, directory structure
- [Instruction Reference](INSTRUCTION_REFERENCE.md) — every on-chain instruction (raw Anchor SDK level)
- [Integration Guide](INTEGRATION_GUIDE.md) — raw Anchor SDK walkthrough (no React hooks)
- [FE E2E Guide](FE_E2E_GUIDE.md) — how to run Playwright tests against this frontend
- [ADRs](ADRs/) — decisions behind the 8-state lifecycle, shadcn/ui migration, E2E mock wallet, and server-side tx building
