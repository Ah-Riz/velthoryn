# Program Integration

**Audience:** A developer integrating the Velthoryn vesting program who has never seen this codebase.

By the end of this guide you will have: created a campaign, funded its vault, optionally registered it with the backend, and seen a beneficiary claim vested tokens. This covers both SPL-token and native-SOL campaigns.

---

## Concepts

| Term | Meaning |
|------|---------|
| **Campaign** | One vesting distribution: a token, a recipient set, and a schedule. On-chain account = `VestingTree`. |
| **Creator** | The wallet that funds and controls the campaign (cancel / pause / rotate authority). |
| **Beneficiary** | A recipient wallet entitled to a portion of the funds. |
| **Leaf** | One beneficiary's entitlement: `{ amount, releaseType, start/cliff/end, milestoneIdx }`. Hashed into the tree. |
| **Merkle root** | A 32-byte commitment to all leaves, stored on-chain. Lets any recipient prove membership cheaply without the creator revealing the full list. |
| **Release type** | How a leaf unlocks: `Cliff` (all at `cliffTime`), `Linear` (continuously `start -> end`), or `Milestone` (all once the creator flips a flag). |
| **Vault** | Where funds sit until claimed: a token account (SPL) or the `VestingTree` PDA itself (native SOL). |
| **PDA** | Program-Derived Address -- a deterministic address the program controls and signs on behalf of. Every campaign and claim record is a PDA. |
| **Stream** | A single-recipient campaign (`leaf_count == 1`) -- the simplest, most common case. |

{% hint style="info" %}
**Most integrators have one recipient.** Jump to the [Quickstart](#quickstart-single-recipient-stream) for the one-transaction `create_stream` path. The full multi-recipient Merkle flow (sections 1-7) is for distributing to many wallets at once.
{% endhint %}

---

## 0. Prerequisites

```bash
# Solana toolchain + a wallet
solana-keygen new -o ~/.config/solana/id.json --no-bip39-passphrase

# Project dependencies
pnpm install
```

**You need:**

- The **IDL** -- `target/idl/vesting.json` (regenerate with `anchor build`; copy at `apps/web/src/lib/anchor/idl.json`).
- The **reference Merkle client** -- `@velthoryn/client` (this repo: `clients/ts/`). It builds the tree, the proofs, and the leaf hashes that must match the on-chain verifier byte-for-byte.
- An **Anchor provider** + the creator's wallet.
- (Optional) The **backend API** for proof serving -- see `docs/BACKEND_API.md` and `docs/API_TRUST_BOUNDARIES.md`.

```typescript
import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Keypair, ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import BN from "bn.js";
import idl from "./vesting.json";
import {
  prepareCampaign, prepareRootRotation, ReleaseType, type CampaignRecipient,
} from "@velthoryn/client";

const PROGRAM_ID = new PublicKey("G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu");

const provider = anchor.AnchorProvider.env();
const program  = new anchor.Program(idl as any, provider);
const creator  = provider.wallet as anchor.Wallet;

// PDA helpers -- these seeds are authoritative.
const u64le = (n: BN) => n.toArrayLike(Buffer, "le", 8);

const treePda = (mint: PublicKey, campaignId: BN) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("tree"), creator.publicKey.toBuffer(), mint.toBuffer(), u64le(campaignId)],
    PROGRAM_ID,
  )[0];

const claimPda = (tree: PublicKey, beneficiary: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("claim"), tree.toBuffer(), beneficiary.toBuffer()],
    PROGRAM_ID,
  )[0];

const vaultAuthorityPda = (tree: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), tree.toBuffer()],
    PROGRAM_ID,
  )[0];
```

---

## Quickstart: Single-Recipient Stream

If you have **one** recipient (e.g. paying a single contractor or grantee), you do not need a Merkle tree at all. `create_stream` builds a 1-leaf campaign **and** funds it in a single transaction; the recipient then claims via `withdraw` (no proof array).

```typescript
const now   = Math.floor(Date.now() / 1000);
const start = new BN(now);
const cliff = new BN(now);                       // unlock begins immediately
const end   = new BN(now + 365 * 86_400);        // 1-year linear vest

const vestingTree    = treePda(usdcMint, new BN(1));
const vaultAuthority = vaultAuthorityPda(vestingTree);
const vault          = getAssociatedTokenAddressSync(usdcMint, vaultAuthority, true);
const sourceAta      = getAssociatedTokenAddressSync(usdcMint, creator.publicKey);

// 1. Create + fund in one transaction (SPL)
await program.methods
  .createStream({
    campaignId: new BN(1),
    beneficiary: alicePubkey,
    amount: new BN(1_000_000),
    releaseType: ReleaseType.Linear,
    startTime: start,
    cliffTime: cliff,
    endTime: end,
    milestoneIdx: 0,
    cancellable: true,
    cancelAuthority: creator.publicKey,
    pauseAuthority: creator.publicKey,
  })
  .accounts({
    creator: creator.publicKey, mint: usdcMint,
    vestingTree, vaultAuthority, vault, sourceAta,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .rpc();

// 2. Beneficiary claims whatever has vested so far
await program.methods
  .withdraw({
    releaseType: ReleaseType.Linear,
    startTime: start,
    cliffTime: cliff,
    endTime: end,
    milestoneIdx: 0,
  })
  .accounts({
    beneficiary: alicePubkey,
    vestingTree,
    claimRecord: claimPda(vestingTree, alicePubkey),
    vaultAuthority, vault, mint: usdcMint,
    beneficiaryAta: getAssociatedTokenAddressSync(usdcMint, alicePubkey),
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

{% hint style="info" %}
**Native SOL:** Use `createStreamNative({...})` instead -- drop `mint`/`vault`/`sourceAta`/token programs and add `systemProgram`. For **many** recipients, continue to section 1.
{% endhint %}

---

## 1. Prepare the Merkle tree (off-chain)

`prepareCampaign` builds the tree, computes the root, and pre-computes every beneficiary's proof. All leaf fields are `BN`/numbers, not strings.

### Release types

| Value | Name | When the amount unlocks |
|-------|------|-------------------------|
| `Cliff` (0) | Cliff | The full amount at `cliffTime` (nothing before). |
| `Linear` (1) | Linear | Continuously from `startTime` to `endTime` (vesting effectively begins at `cliffTime`). |
| `Milestone` (2) | Milestone | The full amount, but only after the creator calls `set_milestone_released(milestoneIdx)`. |

```typescript
const CAMPAIGN_ID = new BN(1);
const BASE_TS = 1_700_000_000;  // Unix timestamp in seconds

const recipients: CampaignRecipient[] = [
  {
    beneficiary: alicePubkey,
    amount: new BN(1_000_000),
    releaseType: ReleaseType.Cliff,
    startTime: new BN(BASE_TS),
    cliffTime: new BN(BASE_TS + 31_536_000),
    endTime: new BN(BASE_TS + 31_536_000),
    milestoneIdx: 0,
  },
  {
    beneficiary: bobPubkey,
    amount: new BN(2_000_000),
    releaseType: ReleaseType.Linear,
    startTime: new BN(BASE_TS),
    cliffTime: new BN(BASE_TS),
    endTime: new BN(BASE_TS + 63_072_000),
    milestoneIdx: 0,
  },
  {
    beneficiary: carolPubkey,
    amount: new BN(500_000),
    releaseType: ReleaseType.Milestone,
    startTime: new BN(BASE_TS),
    cliffTime: new BN(BASE_TS),
    endTime: new BN(BASE_TS + 94_608_000),
    milestoneIdx: 3,
  },
];

const prepared = prepareCampaign(recipients);
// prepared.root          -> Buffer (32 bytes)
// prepared.rootHex       -> "cf21..."  (send this to the backend)
// prepared.leafCount     -> number
// prepared.totalSupply   -> BN (sum of all amounts)
// prepared.minCliffTime  -> BN (earliest cliff; campaign cannot be instant-refunded after this)
// prepared.leaves[i]     -> VestingLeaf (70-byte Borsh layout)
// prepared.proofs[i]     -> number[][] (sibling hashes, leaf-to-root order)
```

### Off-chain proof verification

Before submitting a `claim` transaction, verify the proof locally to avoid wasted fees:

```typescript
import { encodeLeaf, leafHash, verifyProof } from "@/lib/merkle/builder";

const leafHashBuf = leafHash(leaf);
const isValid = verifyProof(leafHashBuf, proof, leaf.leafIndex, onChainRoot);
if (!isValid) {
  // Proof is stale or invalid -- refresh before submitting
}
```

### Anchor IDL compatibility

Anchor expects proofs as `number[][]`. Use `proofAsArrays` to convert:

```typescript
import { proofAsArrays } from "@/lib/merkle/builder";

const proofBuffers: Buffer[] = getProof(tree, leaf);
const proofForAnchor = proofAsArrays(proofBuffers);  // number[][]
```

{% hint style="warning" %}
**MAX_TREE_DEPTH = 20.** Trees deeper than 20 levels (more than 1,048,576 recipients) risk exceeding Solana's 1,232-byte transaction size limit. The SDK enforces this limit in the tree builder.
{% endhint %}

---

## 2. Create the campaign on-chain

### 2a. SPL token campaign

```typescript
const mint = usdcMint;
const vestingTree    = treePda(mint, CAMPAIGN_ID);
const vaultAuthority = vaultAuthorityPda(vestingTree);
const vault          = getAssociatedTokenAddressSync(mint, vaultAuthority, true);

await program.methods
  .createCampaign({
    campaignId: CAMPAIGN_ID,
    merkleRoot: Array.from(prepared.root),
    leafCount: prepared.leafCount,
    totalSupply: prepared.totalSupply,
    minCliffTime: prepared.minCliffTime,
    cancellable: true,
    cancelAuthority: creator.publicKey,
    pauseAuthority: creator.publicKey,
  })
  .accounts({
    creator: creator.publicKey, mint, vestingTree, vaultAuthority, vault,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .rpc();
```

### 2b. Native SOL campaign

Replace `mint` with `PublicKey.default` (the `NATIVE_SOL_MINT` marker) and use the `_native` variants. The tree PDA holds the lamports directly:

```typescript
await program.methods
  .createCampaignNative({
    campaignId: CAMPAIGN_ID,
    merkleRoot: Array.from(prepared.root),
    leafCount: prepared.leafCount,
    totalSupply: prepared.totalSupply,
    minCliffTime: prepared.minCliffTime,
    cancellable: true,
    cancelAuthority: creator.publicKey,
    pauseAuthority: creator.publicKey,
  })
  .accounts({
    creator: creator.publicKey,
    vestingTree,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .rpc();
```

---

## 3. Fund the campaign

### SPL token funding

```typescript
const sourceAta = getAssociatedTokenAddressSync(mint, creator.publicKey);

await program.methods
  .fundCampaign(prepared.totalSupply)
  .accounts({
    creator: creator.publicKey, vestingTree, vault, sourceAta,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

### Native SOL funding

```typescript
await program.methods
  .fundCampaignNative(prepared.totalSupply)
  .accounts({
    creator: creator.publicKey,
    vestingTree,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

{% hint style="info" %}
Deposits are capped at `totalSupply`. Calling `fundCampaign` multiple times is fine as long as the total does not exceed supply.
{% endhint %}

---

## 4. Register with the backend (optional)

The backend indexes events and serves proofs so beneficiaries do not need the raw leaves. The `POST /api/campaigns` route uses Wallet Auth -- the request body is signed by the creator's keypair. See `docs/API_TRUST_BOUNDARIES.md` for the full auth flow.

```typescript
// 1. Obtain bearer token via wallet auth
const auth = await buildSolanaAuthHeader(creator);

// 2. POST the campaign with leaves and proofs
await fetch(`${API_BASE}/api/campaigns`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: auth },
  body: JSON.stringify({
    treeAddress: vestingTree.toBase58(),
    creator: creator.publicKey.toBase58(),
    mint: mint.toBase58(),
    campaignId: CAMPAIGN_ID.toNumber(),
    merkleRoot: prepared.rootHex,
    leafCount: prepared.leafCount,
    totalSupply: prepared.totalSupply.toString(),
    cancellable: true,
    cancelAuthority: creator.publicKey.toBase58(),
    pauseAuthority: creator.publicKey.toBase58(),
    createdAt: Math.floor(Date.now() / 1000),
    leaves: prepared.leaves.map((l, i) => ({
      leafIndex: l.leafIndex,
      beneficiary: l.beneficiary.toBase58(),
      amount: l.amount.toString(),
      releaseType: l.releaseType,
      startTime: l.startTime.toString(),
      cliffTime: l.cliffTime.toString(),
      endTime: l.endTime.toString(),
      milestoneIdx: l.milestoneIdx,
      proof: prepared.proofs[i],
    })),
  }),
});
```

### Root rotation (update recipients after launch)

To add or remove recipients after launch, rebuild the tree and call `update_root` (signed by `cancel_authority`):

```typescript
const rotated = prepareRootRotation(newRecipients);

await program.methods
  .updateRoot(Array.from(rotated.root), rotated.leafCount, rotated.minCliffTime)
  .accounts({ cancelAuthority: creator.publicKey, vestingTree })
  .rpc();
```

{% hint style="warning" %}
Root rotation invalidates all old proofs. Re-POST the leaves to the backend so it serves the new proofs.
{% endhint %}

---

## 5. Release milestones

Milestone beneficiaries can only claim after the creator releases each milestone:

```typescript
await program.methods
  .setMilestoneReleased(3)  // milestone_idx (u8)
  .accounts({ creator: creator.publicKey, vestingTree })
  .rpc();
```

---

## 6. Beneficiary claim flow

### 6a. Fetch the proof from the backend

If you registered the campaign with the backend (section 4), beneficiaries fetch their proof via the API. Otherwise, build the proof client-side from `prepared.proofs[i]`.

```typescript
const API_BASE = "https://velthoryn.site";
const ben = alicePubkey;

const r = await fetch(
  `${API_BASE}/api/campaigns/${vestingTree.toBase58()}/proof?beneficiary=${ben.toBase58()}`
);
const { leaf, proof } = await r.json();
```

### 6b. Submit the claim

```typescript
const claimRecord    = claimPda(vestingTree, ben);
const beneficiaryAta = getAssociatedTokenAddressSync(mint, ben);

await program.methods
  .claim(
    {
      leafIndex: leaf.leafIndex,
      beneficiary: new PublicKey(leaf.beneficiary),
      amount: new BN(leaf.amount),
      releaseType: leaf.releaseType,
      startTime: new BN(leaf.startTime),
      cliffTime: new BN(leaf.cliffTime),
      endTime: new BN(leaf.endTime),
      milestoneIdx: leaf.milestoneIdx,
    },
    proof,
  )
  .accounts({
    beneficiary: ben, vestingTree, claimRecord, vaultAuthority, vault,
    beneficiaryAta, mint,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

The program re-derives the root from the leaf + proof and compares it to the stored root. The `ClaimRecord` PDA is created on the beneficiary's first claim and tracks cumulative `claimed_amount` plus the milestone bitmap.

**How often to call:** `claim` pays `vested(leaf) - already_claimed` in one shot. For a **linear** stream, the beneficiary re-calls periodically (e.g. weekly) as more vests. For a **cliff** or **milestone** leaf, one call after the unlock suffices. Calling again before more tokens vest returns `NothingToClaim` (6015).

---

## 7. Cancellation + unvested withdrawal

```typescript
const creatorAta = getAssociatedTokenAddressSync(usdcMint, creator.publicKey);

// Creator cancels -> starts 7-day grace (beneficiaries may still claim during grace)
await program.methods
  .cancelCampaign()
  .accounts({ cancelAuthority: creator.publicKey, vestingTree })
  .rpc();

// After grace period, creator withdraws remaining unvested tokens
await program.methods
  .withdrawUnvested()
  .accounts({
    creator: creator.publicKey, vestingTree, vaultAuthority, vault,
    creatorAta, tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

For single-recipient streams, use `cancelStream` instead -- it resolves atomically with no grace period. See [Clawback & Grace Period](clawback.md) for full details.

---

## Compute budget & errors

Always set a compute unit limit and priority fee. Build the transaction, prepend compute-budget instructions, then send:

```typescript
const tx = await program.methods
  .claim(leaf, proof)
  .accounts({ /* ... */ })
  .transaction();

tx.instructions.unshift(
  ComputeBudgetProgram.setComputeUnitLimit({ units: 15_000 }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100 }),
);

await provider.sendAndConfirm(tx);
```

Per-instruction compute unit numbers are documented in `docs/CU_BUDGET.md`.

Common error codes (6000-6041):

| Code | Name | Meaning |
|------|------|---------|
| 6013 | `InvalidProof` | Wrong or forged Merkle proof |
| 6015 | `NothingToClaim` | Too early or fully claimed |
| 6009 | `CampaignPaused` | Campaign is currently paused |
| 6033 | `MilestoneNotReleased` | Creator has not released this milestone |
| 6041 | `PerLeafCapExceeded` | Beneficiary exceeded max leaves per wallet |

Full error table: see the [Instruction Reference](../reference/instructions.md).

---

## Native-SOL specifics

- `mint = PublicKey.default` (all-zeros pubkey); no vault ATA -- the tree PDA holds lamports directly.
- On the **final** claim, the PDA is drained (rent included) and closed.
- `withdraw_unvested` (native) preserves the rent-exempt minimum so the tree stays queryable by indexers.
- Transfer logic uses direct lamport manipulation (zero CPI overhead) instead of SPL token transfers.

---

## Further reading

- [Instruction Reference](../reference/instructions.md) -- every instruction, account, error code
- [Frontend Integration](frontend-integration.md) -- React hooks and UI integration
- [Native SOL Vesting](native-sol-vesting.md) -- dual-path architecture deep dive
- [Clawback & Grace Period](clawback.md) -- cancellation flows and grace period behavior
- [ADRs](../reference/adrs.md) -- Merkle design, keccak-256 + domain separation decisions
