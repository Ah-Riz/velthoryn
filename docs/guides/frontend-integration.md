# Frontend Integration

**Audience:** React/Next.js developers building UI against the Velthoryn vesting protocol.

This guide covers the frontend abstraction layer: React hooks, server-side tx-builder, and component patterns. You do **not** need to write raw Anchor calls for any standard flow. For raw Anchor SDK integration without React, see [Program Integration](integration.md).

| Flow | What you use |
|------|-------------|
| Create campaign (multi-recipient) | `useCreateCampaign` hook |
| Create single-recipient stream | `useCreateStream` hook |
| Read campaign state | `useCampaignDetail` hook |
| Beneficiary proof lookup | `useProofLookup` hook |
| Beneficiary claim (on-chain) | `program.methods.claim()` inline |
| Cancel / withdraw / milestone / refund | `tx-builder.ts` functions (server-side) |
| Root rotation | `useUpdateRoot` hook |

---

## 1. Install dependencies

```bash
git clone https://github.com/Ah-Riz/mancerxsuperteam-token-vesting.git
cd mancerxsuperteam-token-vesting
pnpm install
```

Copy and fill in the required environment variables:

```bash
cp apps/web/.env.example apps/web/.env.local
```

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Yes | Postgres (Supabase or local) |
| `NEXT_PUBLIC_RPC_ENDPOINT` | Yes | e.g. `https://api.devnet.solana.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `ADMIN_API_KEY` | Yes | Internal admin routes |
| `API_KEY` | Yes | Internal API routes |
| `PINATA_JWT` | Yes | Merkle data uploads |
| `PINATA_GATEWAY_URL` | Yes | Pinata gateway |
| `CRON_SECRET` | Yes | `/api/cron/sync` |
| `NEXT_PUBLIC_E2E_MOCK_WALLET` | Test only | `true` enables E2E mock wallet |

```bash
pnpm --filter web dev   # starts dev server at http://localhost:3000
```

---

## 2. Set up providers

The wallet and Anchor provider hierarchy is already wired up in `apps/web/src/app/layout.tsx`. You do not need to add `WalletProvider` yourself -- it is a root-level provider.

All client components that need on-chain access use `useVestingProgram()`:

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

  return <div>Connected: {publicKey.toBase58()}</div>;
}
```

### PDA derivations

Every account the program uses is a PDA. Three derivation patterns cover all cases:

```typescript
import { derivePda, BN } from "@/lib/anchor/client";

// VestingTree (campaign PDA)
const [vestingTree] = derivePda([
  "tree",
  creator.toBuffer(),
  mint.toBuffer(),
  new BN(campaignId).toArrayLike(Buffer, "le", 8),
]);

// Vault authority (signs token transfers out of the vault)
const [vaultAuthority] = derivePda(["vault_authority", vestingTree.toBuffer()]);

// ClaimRecord (per-beneficiary PDA, created lazily on first claim)
const [claimRecord] = derivePda(["claim", vestingTree.toBuffer(), beneficiary.toBuffer()]);
```

The vault itself is the ATA of `(mint, vaultAuthority)`:

```typescript
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
const vault = getAssociatedTokenAddressSync(mint, vaultAuthority, true);
```

Server-side helpers are available in `tx-builder.ts`:

```typescript
import { deriveVestingTree, deriveVaultAuthority, deriveClaimRecord } from "@/lib/api/tx-builder";

const tree     = deriveVestingTree(creator, mint, 1n);
const vaultAuth = deriveVaultAuthority(tree);
const claim    = deriveClaimRecord(tree, beneficiary);
```

---

## 3. Create a campaign (UI flow)

### Multi-recipient campaign

`useCreateCampaign` handles the full 2-transaction flow: `create_campaign` + `fund_campaign`. It also saves a pending index entry to localStorage so the campaign is indexed even if the user closes the tab between the two transactions.

**Step 1: Prepare the Merkle tree**

```typescript
import { prepareCampaign, ReleaseType } from "@velthoryn/client";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";

const now = Math.floor(Date.now() / 1000);

const prepared = prepareCampaign([
  {
    beneficiary: new PublicKey("Alice..."),
    amount: new BN(1_000_000),
    releaseType: ReleaseType.Linear,
    startTime: new BN(now),
    cliffTime: new BN(now),
    endTime: new BN(now + 365 * 86_400),
    milestoneIdx: 0,
  },
  {
    beneficiary: new PublicKey("Bob..."),
    amount: new BN(500_000),
    releaseType: ReleaseType.Cliff,
    startTime: new BN(now),
    cliffTime: new BN(now + 180 * 86_400),
    endTime: new BN(now + 180 * 86_400),
    milestoneIdx: 0,
  },
]);
// prepared.root, prepared.leafCount, prepared.totalSupply, prepared.minCliffTime, prepared.proofs
```

**Step 2: Create and fund using the hook**

```tsx
"use client";
import { useCreateCampaign } from "@/hooks/useCreateCampaign";
import { useState } from "react";

function CreateCampaignPage() {
  const { createAndFundCampaign, formatVestingError } = useCreateCampaign();
  const [status, setStatus] = useState<string>("");

  async function handleSubmit() {
    try {
      setStatus("Sending create transaction...");
      const result = await createAndFundCampaign(
        {
          mintAddress: "USDC_MINT_ADDRESS",
          campaignId: Date.now().toString(),
          prepared,
          cancellable: true,
        },
        { autoWrap: false },
      );
      // result.createSig, result.fundSig, result.treeAddress, result.totalSupply
      setStatus(`Campaign created: ${result.treeAddress}`);
    } catch (err) {
      setStatus(formatVestingError(err));
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

{% hint style="info" %}
**Native SOL:** Pass `mintAddress: PublicKey.default.toBase58()` and `autoWrap: false`. The hook automatically routes to `create_campaign_native` + `fund_campaign_native`.
{% endhint %}

### Single-recipient stream

For one recipient, use `useCreateStream` -- it creates and funds in one transaction with no Merkle tree:

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
      amount: "1000000",
      releaseType: 1,                     // 0=Cliff, 1=Linear, 2=Milestone
      startTime: now,
      cliffTime: now,
      endTime: now + 365 * 86_400,
      milestoneIdx: 0,
      cancellable: true,
    });
    // result.treeAddress -> the VestingTree PDA for this stream
  }
}
```

### Display campaign state

```tsx
"use client";
import { useCampaignDetail } from "@/hooks/useCampaignDetail";

function CampaignPage({ treeAddress }: { treeAddress: string }) {
  const { data: campaign, isLoading, error } = useCampaignDetail(treeAddress);

  if (isLoading) return <p>Loading...</p>;
  if (error || !campaign) return <p>Campaign not found.</p>;

  return (
    <div>
      <p>Creator: {campaign.creator}</p>
      <p>Total Supply: {campaign.totalSupply}</p>
      <p>Total Claimed: {campaign.totalClaimed}</p>
      <p>Paused: {campaign.paused ? "Yes" : "No"}</p>
      <p>Cancelled At: {campaign.cancelledAt ?? "Active"}</p>
    </div>
  );
}
```

`useCampaignDetail` refreshes every 10 seconds. TanStack Query key: `["campaign", treeAddress]`.

---

## 4. Claim tokens (UI flow)

### Multi-recipient: proof lookup + claim

**Step 1: Look up the Merkle proof**

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

  if (isLoading) return <p>Checking eligibility...</p>;
  if (!proofData) return <p>You are not a beneficiary of this campaign.</p>;

  return <p>You are entitled to {proofData.leaf.amount} tokens.</p>;
}
```

**Step 2: Submit the claim**

```tsx
"use client";
import { useVestingProgram } from "@/hooks/useVestingProgram";
import { useProofLookup } from "@/hooks/useProofLookup";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { deriveClaimRecord, deriveVaultAuthority } from "@/lib/api/tx-builder";
import { formatVestingError } from "@/lib/anchor/errors";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";

function ClaimButton({ treeAddress, mint }: { treeAddress: string; mint: string }) {
  const program = useVestingProgram();
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { data: proofData } = useProofLookup(treeAddress, publicKey?.toBase58());

  async function handleClaim() {
    if (!program || !publicKey || !proofData) return;

    const vestingTree    = new PublicKey(treeAddress);
    const mintKey        = new PublicKey(mint);
    const vaultAuthority = deriveVaultAuthority(vestingTree);
    const vault          = getAssociatedTokenAddressSync(mintKey, vaultAuthority, true);
    const claimRecord    = deriveClaimRecord(vestingTree, publicKey);
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
          beneficiary: publicKey, vestingTree, claimRecord, vaultAuthority,
          vault, beneficiaryAta, mint: mintKey,
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

### Single-recipient: withdraw (no proof needed)

For single-recipient streams created with `useCreateStream`, the beneficiary provides the schedule args directly:

```tsx
"use client";
import { useVestingProgram } from "@/hooks/useVestingProgram";
import { useCampaignDetail } from "@/hooks/useCampaignDetail";
import { deriveClaimRecord, deriveVaultAuthority } from "@/lib/api/tx-builder";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
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

    try {
      const tx = await program.methods
        .withdraw({
          releaseType:  campaign.releaseType,
          startTime:    new BN(campaign.startDate.toString()),
          cliffTime:    new BN(campaign.cliffDate.toString()),
          endTime:      new BN(campaign.endDate.toString()),
          milestoneIdx: 0,
        })
        .accounts({
          beneficiary: publicKey, vestingTree, claimRecord, vaultAuthority,
          vault, mint: mintKey, beneficiaryAta,
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

  return <button onClick={handleWithdraw}>Withdraw Vested Tokens</button>;
}
```

{% hint style="warning" %}
`NotSingleStream` (6029) is thrown if `leaf_count > 1`. Use the multi-recipient `claim` flow with proofs for those campaigns. `NothingToClaim` (6015) means the cliff time has not been reached -- gate the button accordingly.
{% endhint %}

---

## 5. Cancel a campaign (UI flow)

All creator operations (cancel, withdraw, milestone release, instant refund) follow the same pattern: build the unsigned transaction server-side, then sign and send client-side.

### Generic prepared transaction sender

```tsx
import { type PreparedTransaction } from "@/lib/api/tx-builder";
import { Transaction } from "@solana/web3.js";
import bs58 from "bs58";

async function sendPreparedTx(
  prepared: PreparedTransaction,
  sendTransaction: (tx: Transaction, connection: any) => Promise<string>,
  connection: any,
) {
  const tx = Transaction.from(bs58.decode(prepared.transaction));
  const sig = await sendTransaction(tx, connection);
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}
```

### Cancel a campaign (7-day grace period)

```tsx
import { buildCancelCampaignTx } from "@/lib/api/tx-builder";

const prepared = await buildCancelCampaignTx({
  vestingTree: new PublicKey(treeAddress),
  cancelAuthority: publicKey!,
});
const sig = await sendPreparedTx(prepared, sendTransaction, connection);
```

### Withdraw unvested tokens (after grace period)

```tsx
import { buildWithdrawUnvestedTx } from "@/lib/api/tx-builder";

const creatorAta = getAssociatedTokenAddressSync(new PublicKey(mint), publicKey!);
const prepared = await buildWithdrawUnvestedTx({
  vestingTree: new PublicKey(treeAddress),
  creator: publicKey!,
  creatorAta,
  mint: new PublicKey(mint),
});
const sig = await sendPreparedTx(prepared, sendTransaction, connection);
```

{% hint style="warning" %}
`GracePeriodActive` (error 6027) is returned if 7 days have not elapsed since `cancelledAt`. Check `campaign.gracePeriod.isExpired` before enabling the button.
{% endhint %}

### Release a milestone

```tsx
import { buildMilestoneReleaseTx } from "@/lib/api/tx-builder";

const prepared = await buildMilestoneReleaseTx({
  vestingTree: new PublicKey(treeAddress),
  creator: publicKey!,
  milestoneIdx: 3,
});
const sig = await sendPreparedTx(prepared, sendTransaction, connection);
```

### Instant refund (before vesting starts)

```tsx
import { buildInstantRefundCampaignTx } from "@/lib/api/tx-builder";

const creatorAta = getAssociatedTokenAddressSync(new PublicKey(mint), publicKey!);
const prepared = await buildInstantRefundCampaignTx({
  vestingTree: new PublicKey(treeAddress),
  creator: publicKey!,
  mint: new PublicKey(mint),
  creatorAta,
});
const sig = await sendPreparedTx(prepared, sendTransaction, connection);
```

{% hint style="info" %}
Instant refund conditions: `now < minCliffTime`, no milestone flags set, multi-leaf campaigns only (`leaf_count > 1`).
{% endhint %}

---

## 6. Admin operations

### Root rotation (update recipient set)

```tsx
import { useUpdateRoot } from "@/hooks/useUpdateRoot";
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
```

The hook automatically evicts the proof cache so `useProofLookup` refetches with the new root.

### Pause and unpause

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

### Error handling

All Anchor/program errors bubble up as `AnchorError` with a numeric code. Use `formatVestingError` to convert them to user-readable strings:

```typescript
import { formatVestingError, isRetryableError } from "@/lib/anchor/errors";

try {
  await createAndFundCampaign({ /* ... */ });
} catch (err) {
  const message = formatVestingError(err);
  if (isRetryableError(err)) {
    // Show "Try again" -- network issue or expired blockhash
  }
  toast.error(message);
}
```

Common frontend errors:

| Code | Name | When it happens |
|------|------|-----------------|
| 6009 | `CampaignPaused` | Claiming while `campaign.paused === true` |
| 6013 | `InvalidProof` | Stale proof after root rotation -- evict cache + refetch |
| 6015 | `NothingToClaim` | Too early (before cliff) or fully claimed |
| 6027 | `GracePeriodActive` | `withdraw_unvested` before 7 days elapsed |
| 6033 | `MilestoneNotReleased` | Beneficiary claimed before creator released |
| 6036 | `CampaignAlreadyStarted` | Instant refund attempted after `min_cliff_time` |

---

## Further reading

- [Program Integration](integration.md) -- raw Anchor SDK walkthrough (no React)
- [Clawback & Grace Period](clawback.md) -- cancellation flows and grace period behavior
- [Native SOL Vesting](native-sol-vesting.md) -- dual-path architecture for SOL campaigns
- [Instruction Reference](../reference/instructions.md) -- every on-chain instruction with accounts and error codes
