# Integration Guide — for the frontend track

Audience: Geral and anyone building against the on-chain program from TypeScript.

> **Status:** All 12 instruction handlers are fully implemented with real logic. The program is deployed on devnet (latest upgrade slot 461219566) and tested: 57/63 passing on local validator (6 known failures pending fix), 44/56 passing on devnet (12 stale-PDA failures). Merkle leaf hashing is live and byte-verified against the TS encoder.

## What you need

| Thing                    | Where                                                                          |
| ------------------------ | ------------------------------------------------------------------------------ |
| Program ID               | `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`                                |
| IDL (after `anchor build`) | `target/idl/vesting.json`                                                    |
| Generated TS types       | `target/types/vesting.ts` (Anchor 1.0 emits this alongside the IDL)           |
| Merkle helpers (live)    | `apps/web/src/lib/merkle/builder.ts` — `encodeLeaf`, `hashLeaf`, `buildTree`, `getRoot`, `getProof` |
| Frontend scaffold        | `apps/web/` — Next.js 15 App Router, routes: `/`, `/campaign/create`, `/campaign/[id]` |

## Setup

```bash
git clone https://github.com/Ah-Riz/mancerxsuperteam-token-vesting.git
cd mancerxsuperteam-token-vesting
git checkout dev_lana      # Active development branch
pnpm install
anchor build               # produces target/idl/vesting.json + target/types/vesting.ts
```

## Connecting from the dApp

```ts
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "../../target/idl/vesting.json";
import type { Vesting } from "../../target/types/vesting";

const PROGRAM_ID = new PublicKey("G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu");

function getProgram(provider: anchor.AnchorProvider) {
  return new anchor.Program<Vesting>(idl as Vesting, provider);
}
```

The IDL exposes camelCase instruction names: `createCampaign`, `createStream`, `fundCampaign`, `claim`, `withdraw`, `cancelCampaign`, `updateRoot`, `withdrawUnvested`, `pauseCampaign`, `unpauseCampaign`, `closeClaimRecord`, `getVestedAmount`.

## PDA derivations

Every account the program reads/writes is a PDA. Compute them with `PublicKey.findProgramAddressSync`:

```ts
import { derivePda, PROGRAM_ID } from "@/lib/anchor/client";

// VestingTree (one per campaign)
const [vestingTree] = derivePda([
  "tree",
  creator.toBuffer(),
  mint.toBuffer(),
  new anchor.BN(campaignId).toArrayLike(Buffer, "le", 8),
]);

// Vault authority (signs token transfers out of the vault)
const [vaultAuthority] = derivePda(["vault_authority", vestingTree.toBuffer()]);

// ClaimRecord (one per (campaign, beneficiary))
const [claimRecord] = derivePda(["claim", vestingTree.toBuffer(), beneficiary.toBuffer()]);
```

The vault itself is the ATA of `(mint, vaultAuthority)`. Use `getAssociatedTokenAddressSync` from `@solana/spl-token`.

## Calling instructions

All instructions are fully implemented and write state on-chain. The constraint blocks and account lists are final — see `programs/vesting/src/instructions/<name>.rs` for the full details.

### Create a campaign (project authority)

```ts
await program.methods
  .createCampaign({
    campaignId: new anchor.BN(1),
    merkleRoot: Array.from(root),           // Buffer from buildTree → getRoot
    leafCount: recipients.length,
    totalSupply: new anchor.BN(amountTotal),
    cancellable: true,
    cancelAuthority: cancelAuthorityKey,    // PublicKey | null
    pauseAuthority: pauseAuthorityKey,      // PublicKey | null
  })
  .accounts({ creator: provider.wallet.publicKey, mint })
  .rpc();
```

### Claim (recipient)

```ts
await program.methods
  .claim(leaf, proof)   // VestingLeaf object + [[u8; 32], …]
  .accounts({ beneficiary: wallet.publicKey, mint })
  .rpc();
```

### Cancel a campaign (cancel authority)

```ts
await program.methods
  .cancelCampaign()
  .accounts({ authority: cancelAuthorityWallet.publicKey })
  .rpc();
```

### Create a stream (single-recipient atomic campaign + fund)

Combines `createCampaign` + `fundCampaign` in one transaction. No off-chain Merkle tree or IPFS proof hosting needed -- the program computes the root on-chain.

```ts
await program.methods
  .createStream({
    campaignId: new anchor.BN(1),
    beneficiary: recipientWallet.publicKey,
    amount: new anchor.BN(amount),
    releaseType: 1,                  // 0=Cliff 1=Linear 2=Milestone
    startTime: new anchor.BN(startTs),
    cliffTime: new anchor.BN(cliffTs),
    endTime: new anchor.BN(endTs),
    milestoneIdx: 0,
    cancellable: true,
    cancelAuthority: cancelAuthorityKey,
    pauseAuthority: pauseAuthorityKey,
  })
  .accounts({
    creator: provider.wallet.publicKey,
    mint,
    sourceAta: creatorAta,
  })
  .rpc();
```

### Withdraw from a stream (proof-less claim)

For single-recipient campaigns (`leaf_count == 1`). The recipient passes schedule params directly -- no Merkle proof needed.

```ts
await program.methods
  .withdraw({
    releaseType: 1,                  // must match the stream's release_type
    startTime: new anchor.BN(startTs),
    cliffTime: new anchor.BN(cliffTs),
    endTime: new anchor.BN(endTs),
    milestoneIdx: 0,
  })
  .accounts({ beneficiary: wallet.publicKey, mint })
  .rpc();
```

Account lists for other instructions follow the same pattern -- see `programs/vesting/src/instructions/<name>.rs` for the full constraint blocks.

## Building Merkle proofs

The Merkle helpers are live in `apps/web/src/lib/merkle/builder.ts`. They are byte-identical to `math::merkle::leaf_hash()` on the Rust side (golden-vector test passes).

```ts
import {
  buildTree, getRoot, getProof, encodeLeaf,
  type VestingLeaf,
} from "@/lib/merkle/builder";

const leaves: VestingLeaf[] = recipients.map((r) => ({
  leafIndex:    r.index,
  beneficiary:  r.wallet,           // base58 string
  amount:       BigInt(r.amount),
  releaseType:  1,                  // 0=Cliff 1=Linear 2=Milestone
  startTs:      BigInt(r.startTs),
  cliffTs:      BigInt(r.cliffTs),
  endTs:        BigInt(r.endTs),
  milestoneIdx: 0,
}));

const tree  = buildTree(leaves);
const root  = getRoot(tree);        // Buffer — pass as merkleRoot in createCampaign
const proof = getProof(tree, leaves[i]); // Buffer[] — pass to claim
```

`clients/ts/src/index.ts` exports `encodeLeaf`, `leafHash`, `nodeHash`, `VestingLeaf`, `VestingMerkleTree`, `MAX_TREE_DEPTH`, `verifyProof`, `proofAsArrays`, `CampaignRecipient`, `PreparedCampaign`, and related types. The Merkle builder in `apps/web/src/lib/merkle/builder.ts` wraps these for the frontend.

### `prepareCampaign()` — recommended way to prepare campaign data

```ts
import { prepareCampaign, type CampaignRecipient, type PreparedCampaign } from "@/lib/merkle/builder";

const recipients: CampaignRecipient[] = [
  { index: 0, wallet: "recipient_pubkey_base58", amount: BigInt(1_000_000), releaseType: 1, startTs: BigInt(startTs), cliffTs: BigInt(cliffTs), endTs: BigInt(endTs), milestoneIdx: 0 },
  // ... more recipients
];

const prepared: PreparedCampaign = prepareCampaign(recipients);
// prepared.root       — Buffer, pass as merkleRoot in createCampaign
// prepared.proofs     — Map<number, Buffer[]>, proof for each leaf index
// prepared.leafCount  — number, pass as leafCount in createCampaign
// prepared.totalSupply — BigInt, pass as totalSupply in createCampaign
```

### `verifyProof()` — off-chain pre-verification

Before submitting a `claim` transaction, verify the proof locally to avoid wasted fees on invalid proofs:

```ts
import { encodeLeaf, leafHash, verifyProof } from "@/lib/merkle/builder";

const leafHashBuf = leafHash(leaf);
const isValid = verifyProof(leafHashBuf, proof, leaf.leafIndex, onChainRoot);
if (!isValid) {
  // Proof is stale or invalid — refresh from IPFS before submitting
}
```

### `proofAsArrays()` — Anchor IDL compatibility

Anchor's IDL expects proofs as `number[][]` (arrays of 32-element number arrays), not `Buffer[]`. Use `proofAsArrays` to convert:

```ts
import { proofAsArrays } from "@/lib/merkle/builder";

const proofBuffers: Buffer[] = getProof(tree, leaf); // from builder
const proofForAnchor = proofAsArrays(proofBuffers);   // number[][]
// Pass proofForAnchor to program.methods.claim(leaf, proofForAnchor)
```

### `MAX_TREE_DEPTH` — tree size limit

`MAX_TREE_DEPTH = 20`. Trees deeper than 20 levels (more than 1,048,576 recipients) risk exceeding Solana's 1,232-byte transaction size limit. The SDK enforces this limit in the tree builder.

Subscribe via `program.addEventListener("Claimed", (event, slot) => …)`. Available events:

`CampaignCreated`, `CampaignFunded`, `Claimed`, `CampaignCancelled`, `RootUpdated`, `UnvestedWithdrawn`, `CampaignPaused`, `CampaignUnpaused`, `ClaimRecordClosed`.

Field shapes in `programs/vesting/src/events.rs`.

## Devnet

Program is deployed on devnet at `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` (latest upgrade slot 461219566, ~447KB allocation).

```bash
solana config set --url devnet
solana program show G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu
```

For local dev, `anchor test` boots an embedded validator (Anchor 1.0 LiteSVM) with the program preloaded. Point your frontend at `http://127.0.0.1:8899`.

## Where to ask

- On-chain bugs / instruction questions → Lana (`programs/vesting/`).
- Merkle / leaf encoding → Lana (`apps/web/src/lib/merkle/builder.ts`).
- Frontend / UI questions → Geral (`apps/web/`).
- IDL / TS types regen → re-run `anchor build`.
