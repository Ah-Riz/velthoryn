# Integration Guide — for the frontend track

Audience: Geral and anyone building against the on-chain program from TypeScript.

> **Status (Week 4):** All 10 instruction handlers compile but return `Ok(())` — calls succeed without writing state. Merkle leaf hashing is live and byte-verified against the TS encoder. Real instruction logic lands Week 4; devnet is already deployed and reachable.

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
git checkout test          # Week 3 work is merged into test; not yet on main
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

The IDL exposes camelCase instruction names: `createCampaign`, `fundCampaign`, `claim`, `cancelCampaign`, `updateRoot`, `withdrawUnvested`, `pauseCampaign`, `unpauseCampaign`, `closeClaimRecord`, `getVestedAmount`.

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

**Today** all calls succeed but do nothing on-chain. Week 4 will make them write state.

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

Account lists for other instructions are isomorphic — see `programs/vesting/src/instructions/<name>.rs` for the full constraint blocks Week 4 will land.

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

`clients/ts/src/index.ts` is currently an empty package placeholder; the real exports live in `apps/web/src/lib/merkle/builder.ts` for now.

## Events (for indexer / UI)

Subscribe via `program.addEventListener("Claimed", (event, slot) => …)`. Available events:

`CampaignCreated`, `CampaignFunded`, `Claimed`, `CampaignCancelled`, `RootUpdated`, `UnvestedWithdrawn`, `CampaignPaused`, `CampaignUnpaused`, `ClaimRecordClosed`.

Field shapes in `programs/vesting/src/events.rs`.

## Devnet

Program is deployed on devnet at `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` (last deployed slot 460511260).

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
