# Integration Guide — Vesting Program

**Audience:** a developer integrating the vesting program who has never seen this codebase.
**Goal:** go from zero to a funded campaign with a claiming beneficiary, using only this
guide + the [Instruction Reference](INSTRUCTION_REFERENCE.md).

This guide walks the **creator** flow (prepare → create → fund → register) and the
**beneficiary** flow (fetch proof → claim), for both SPL-token and native-SOL campaigns.

---

## 0. Prerequisites

```bash
# Solana toolchain + a wallet
solana-keygen new -o ~/.config/solana/id.json --no-bip39-passphrase   # creator keypair
# Project deps (in this repo)
pnpm install
```

**You need:**
- The **IDL** — `target/idl/vesting.json` (regenerate with `anchor build`; copy at `apps/web/src/lib/anchor/idl.json`).
- The **reference Merkle client** — `@velthoryn/client` (this repo: `clients/ts/`). It builds the tree, the proofs, and the leaf hashes that must match the on-chain verifier byte-for-byte.
- An **Anchor provider** + the creator's wallet.
- (Optional) the **BE API** for proof serving — `docs/BACKEND_API.md`, `docs/API_TRUST_BOUNDARIES.md`.

```ts
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import BN from "bn.js";
import idl from "./vesting.json";
import {
  prepareCampaign, prepareRootRotation, ReleaseType, type CampaignRecipient,
} from "@velthoryn/client";

const PROGRAM_ID = new PublicKey("G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu");
const program    = new anchor.Program(idl as any, provider);
const creator    = provider.wallet;                 // the campaign creator
const u64le      = (n: BN) => n.toArrayLike(Buffer, "le", 8);
const treePda    = (mint: PublicKey, campaignId: BN) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("tree"), creator.publicKey.toBuffer(), mint.toBuffer(), u64le(campaignId)],
    PROGRAM_ID)[0];
const claimPda = (tree: PublicKey, beneficiary: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("claim"), tree.toBuffer(), beneficiary.toBuffer()], PROGRAM_ID)[0];
const vaultAuthorityPda = (tree: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("vault_authority"), tree.toBuffer()], PROGRAM_ID)[0];
```

---

## 1. Prepare the Merkle tree (off-chain)

`prepareCampaign` builds the tree, computes the root, and pre-computes every beneficiary's
proof. **All leaf fields are `BN`/numbers, not strings.**

```ts
const CAMPAIGN_ID = new BN(1);
const BASE_TS = 1_700_000_000;

const recipients: CampaignRecipient[] = [
  { beneficiary: alicePubkey, amount: new BN(1_000_000),  releaseType: ReleaseType.Cliff,
    startTime: new BN(BASE_TS), cliffTime: new BN(BASE_TS + 31_536_000), endTime: new BN(BASE_TS + 31_536_000),
    milestoneIdx: 0 },
  { beneficiary: bobPubkey,   amount: new BN(2_000_000),  releaseType: ReleaseType.Linear,
    startTime: new BN(BASE_TS), cliffTime: new BN(BASE_TS),               endTime: new BN(BASE_TS + 63_072_000),
    milestoneIdx: 0 },
  { beneficiary: carolPubkey, amount: new BN(500_000),    releaseType: ReleaseType.Milestone,
    startTime: new BN(BASE_TS), cliffTime: new BN(BASE_TS),               endTime: new BN(BASE_TS + 94_608_000),
    milestoneIdx: 3 },
];

const prepared = prepareCampaign(recipients);
// prepared.root          → Buffer (32 bytes)
// prepared.rootHex       → "cf21…"  (send this to the BE)
// prepared.leafCount, prepared.totalSupply, prepared.minCliffTime
// prepared.leaves[i]     → VestingLeaf  (70-byte Borsh layout)
// prepared.proofs[i]     → number[][]   (sibling hashes, leaf→root order)
```

> **Issue #29 — fixed on-chain (2026-06-16; ADR-003 superseded).** The program now supports
> **multiple cliff/linear leaves per beneficiary** (paid each in full via a per-leaf ledger). The
> BE `prepare`/`import` routes still reject this shape until a follow-up PR removes those guards, so
> **via the API today: at most one cliff/linear leaf per beneficiary**; direct on-chain
> construction has no such limit. Multiple milestone leaves per beneficiary are allowed.

---

## 2. Create the campaign on-chain

### 2a. SPL token campaign

```ts
const mint = usdcMint;                              // classic SPL Token mint (no Token-2022)
const [vestingTree] = [treePda(mint, CAMPAIGN_ID)];
const vaultAuthority = vaultAuthorityPda(vestingTree);
const vault = getAssociatedTokenAddressSync(mint, vaultAuthority, true);

await program.methods
  .createCampaign({
    campaignId: CAMPAIGN_ID,                           // BN (u64)
    merkleRoot: Array.from(prepared.root),             // number[32]
    leafCount: prepared.leafCount,                     // u32
    totalSupply: prepared.totalSupply,                 // BN (u64)
    minCliffTime: prepared.minCliffTime,               // BN (i64)
    cancellable: true,
    cancelAuthority: creator.publicKey,                // Option<Pubkey>
    pauseAuthority: creator.publicKey,                 // Option<Pubkey>
  })
  .accounts({
    creator: creator.publicKey, mint, vestingTree, vaultAuthority, vault,
    tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
  })
  .rpc();
```

### 2b. Fund it

```ts
const sourceAta = getAssociatedTokenAddressSync(mint, creator.publicKey);   // creator's ATA

await program.methods
  .fundCampaign(prepared.totalSupply)
  .accounts({
    creator: creator.publicKey, vestingTree, vault, sourceAta,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

> **Shortcut for a single recipient:** use `create_stream` / `create_stream_native` to create
> **and** fund in one tx (the root is the single leaf hash). The beneficiary then claims via
> `withdraw`, not `claim`.

### 2c. Native-SOL campaign

Replace `mint` with `PublicKey.default` (the `NATIVE_SOL_MINT` marker) and use the `_native`
variants. The tree PDA holds the lamports directly:

```ts
await program.methods
  .createCampaignNative({
    campaignId: CAMPAIGN_ID,                           // BN (u64)
    merkleRoot: Array.from(prepared.root),             // number[32]
    leafCount: prepared.leafCount,                     // u32
    totalSupply: prepared.totalSupply,                 // BN (u64)
    minCliffTime: prepared.minCliffTime,               // BN (i64)
    cancellable: true,
    cancelAuthority: creator.publicKey,                // Option<Pubkey>
    pauseAuthority: creator.publicKey,                 // Option<Pubkey>
  })
  .accounts({ creator: creator.publicKey, vestingTree, systemProgram: SystemProgram.programId,
              rent: SYSVAR_RENT_PUBKEY })
  .rpc();

await program.methods
  .fundCampaignNative(prepared.totalSupply)
  .accounts({ creator: creator.publicKey, vestingTree, systemProgram: SystemProgram.programId })
  // native fund moves lamports via system_program::transfer
  .rpc();
```

---

## 3. Register the campaign with the backend (recommended)

The BE indexes events and **serves proofs** so beneficiaries don't need the raw leaves. The
`POST /api/campaigns` route is **Wallet Auth** — the signer must equal `creator` in the body
(`docs/API_TRUST_BOUNDARIES.md`).

```ts
// 1. nonce → sign → bearer token (see docs/API_TRUST_BOUNDARIES.md §Wallet auth flow)
const auth = await buildSolanaAuthHeader(creator);   // GET /api/auth/nonce, then sign

// 2. POST the campaign (leaves + proofs so the BE can serve them)
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
      leafIndex: l.leafIndex, beneficiary: l.beneficiary.toBase58(),
      amount: l.amount.toString(), releaseType: l.releaseType,
      startTime: l.startTime.toString(), cliffTime: l.cliffTime.toString(),
      endTime: l.endTime.toString(), milestoneIdx: l.milestoneIdx,
      proof: prepared.proofs[i],
    })),
  }),
});
```

---

## 4. (Optional) Rotate the root

To add/remove recipients after launch, rebuild the tree and call `update_root` (signed by
`cancel_authority`):

```ts
const rotated = prepareRootRotation(newRecipients);   // same shape, no totalSupply
await program.methods
  .updateRoot(Array.from(rotated.root), rotated.leafCount, rotated.minCliffTime)
  .accounts({ cancelAuthority: creator.publicKey, vestingTree })
  .rpc();
// then re-POST the leaves to the BE so it serves the new proofs
```

---

## 5. Release milestones

Milestone beneficiaries can only claim after the creator releases each milestone:

```ts
await program.methods
  .setMilestoneReleased(3)                            // milestone_idx
  .accounts({ creator: creator.publicKey, vestingTree })
  .rpc();
```

---

## 6. Beneficiary claim flow

### 6a. Fetch the proof (from the BE)

```ts
const r = await fetch(`${API_BASE}/api/campaigns/${vestingTree.toBase58()}/proof?beneficiary=${ben.toBase58()}`);
const { leaf, proof } = await r.json();               // leaf = {leafIndex, beneficiary, …}, proof = number[][]
```

### 6b. Submit the claim

```ts
const [claimRecord] = [claimPda(vestingTree, ben)];
const beneficiaryAta = getAssociatedTokenAddressSync(mint, ben);

await program.methods
  .claim(
    {
      leafIndex: leaf.leafIndex, beneficiary: new PublicKey(leaf.beneficiary),
      amount: new BN(leaf.amount), releaseType: leaf.releaseType,
      startTime: new BN(leaf.startTime), cliffTime: new BN(leaf.cliffTime),
      endTime: new BN(leaf.endTime), milestoneIdx: leaf.milestoneIdx,
    },
    proof,                                            // number[][]
  )
  .accounts({
    beneficiary: ben, vestingTree, claimRecord, vaultAuthority, vault,
    beneficiaryAta, mint,
    tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

The program re-derives the root from the leaf + proof and compares it to the stored root;
the `ClaimRecord` PDA is created on the beneficiary's first claim and tracks cumulative
`claimed_amount` (+ milestone bitmap).

---

## 7. Cancellation + unvested withdrawal

```ts
// creator cancels → starts 7-day grace (beneficiaries may still claim during grace)
await program.methods.cancelCampaign()
  .accounts({ cancelAuthority: creator.publicKey, vestingTree }).rpc();

// after grace, creator withdraws everything left (unvested)
await program.methods.withdrawUnvested()
  .accounts({ creator: creator.publicKey, vestingTree, vaultAuthority, vault,
              creatorAta, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
```

---

## Compute budget & errors

- **Always set a CU limit + priority fee** before `.rpc()`:
  ```ts
  .prepend([{ // ComputeBudgetProgram.setComputeUnitLimit({ units: 15_000 })
              ...ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100 }) }])
  ```
  Per-instruction numbers: `docs/CU_BUDGET.md`.
- **Decode errors** by code 6000–6040 → see the [Instruction Reference error table](INSTRUCTION_REFERENCE.md#error-codes-vestingerror-anchor-codes-60006040).
  Common ones: `InvalidProof` (6013, wrong/forged proof), `NothingToClaim` (6015, too early or fully claimed), `CampaignPaused` (6009), `MilestoneNotReleased` (6033).

## Native-SOL specifics
- `mint = PublicKey.default`; no vault ATA — the tree PDA holds lamports.
- On the **final** claim, the PDA is drained (rent included) and closed.
- `withdraw_unvested` (native) preserves the rent-exempt minimum so the tree stays queryable by indexers (SC-FIND-02 fix).

## Further reading
- [Instruction Reference](INSTRUCTION_REFERENCE.md) — every instruction, account, error code.
- [ADRs](ADRs/) — Merkle design, keccak-256 + domain separation, Issue #29.
- `docs/CU_BUDGET.md`, `docs/API_TRUST_BOUNDARIES.md`, `docs/KNOWN_ISSUE_29_DESIGN.md`.
