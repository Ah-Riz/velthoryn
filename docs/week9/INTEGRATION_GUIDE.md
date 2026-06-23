# Integration Guide — Vesting Program

> **Looking for the repo-wide code map or the REST API reference?** Start at the hub:
> [`docs/INTEGRATION.md`](../INTEGRATION.md). This file is the deep on-chain + Merkle walkthrough.

**Audience:** a developer integrating the vesting program who has never seen this codebase.
**Goal:** go from zero to a funded campaign with a claiming beneficiary, using only this
guide + the [Instruction Reference](INSTRUCTION_REFERENCE.md).

## What you're building

This program lets a **creator** lock up SPL tokens (or native SOL) and release them to one or
more **beneficiaries** on a schedule — all at once after a cliff, continuously over time, or on
discrete milestones. Recipients are committed via a single 32-byte **Merkle root**, so you can
onboard thousands of wallets in one on-chain transaction instead of one account per recipient.

By the end of this guide you will have: created a campaign, funded its vault, (optionally)
registered it with the backend, and seen a beneficiary claim vested tokens.

This guide walks the **creator** flow (prepare → create → fund → register) and the
**beneficiary** flow (fetch proof → claim), for both SPL-token and native-SOL campaigns.

## Concepts

| Term | Meaning |
|------|---------|
| **Campaign** | One vesting distribution: a token, a recipient set, and a schedule. On-chain account = `VestingTree`. |
| **Creator** | The wallet that funds and controls the campaign (cancel / pause / rotate authority). |
| **Beneficiary** | A recipient wallet entitled to a portion of the funds. |
| **Leaf** | One beneficiary's entitlement: `{ amount, releaseType, start/cliff/end, milestoneIdx }`. Hashed into the tree. |
| **Merkle root** | A 32-byte commitment to ALL leaves, stored on-chain. Lets any recipient prove membership cheaply without the creator revealing the full list. |
| **Release type** | How a leaf unlocks: `Cliff` (all at `cliffTime`), `Linear` (continuously `start→end`), or `Milestone` (all once the creator flips a flag). See the table in §1. |
| **Vault** | Where funds sit until claimed: a token account (SPL) or the `VestingTree` PDA itself (native SOL). |
| **PDA** | Program-Derived Address — a deterministic address the program controls and signs on behalf of. Every campaign and claim record is a PDA. |
| **Stream** | A single-recipient campaign (`leaf_count == 1`) — the simplest, most common case. |

> **Most integrators have ONE recipient.** Jump to the [Quickstart](#quickstart-single-recipient-stream)
> for the one-transaction `create_stream` path. The full multi-recipient Merkle flow (§1–§7) is
> for distributing to many wallets at once.

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

// Anchor provider. Either set env (ANCHOR_PROVIDER_URL = RPC, ANCHOR_WALLET = keypair path)
// or build one from a Connection + your wallet adapter.
const provider = anchor.AnchorProvider.env();
const program  = new anchor.Program(idl as any, provider);
const creator  = provider.wallet as anchor.Wallet;   // the campaign creator

// Test identities used in the snippets below — in production these are your real wallets:
const alicePubkey = Keypair.generate().publicKey;    // beneficiary
const bobPubkey   = Keypair.generate().publicKey;    // beneficiary
const carolPubkey = Keypair.generate().publicKey;    // beneficiary
const usdcMint    = Keypair.generate().publicKey;    // the SPL mint being vested

// PDA helpers — these seeds are authoritative (same as INSTRUCTION_REFERENCE §Setup;
// `creator.publicKey` is closed over here for brevity).
const u64le = (n: BN) => n.toArrayLike(Buffer, "le", 8);
const treePda = (mint: PublicKey, campaignId: BN) =>
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

## Quickstart: single-recipient stream (most common)

If you have **one** recipient (e.g. paying a single contractor or grantee), you do not need a
Merkle tree at all. `create_stream` builds a 1-leaf campaign **and** funds it in a single
transaction; the recipient then claims via `withdraw` (no proof array). This covers the
majority of real usage.

```ts
const now   = Math.floor(Date.now() / 1000);
const start = new BN(now);
const cliff = new BN(now);                       // unlock begins immediately
const end   = new BN(now + 365 * 86_400);        // 1-year linear vest

const vestingTree = treePda(usdcMint, new BN(1));
const vaultAuthority = vaultAuthorityPda(vestingTree);
const vault = getAssociatedTokenAddressSync(usdcMint, vaultAuthority, true);
const sourceAta = getAssociatedTokenAddressSync(usdcMint, creator.publicKey);

// 1. create + fund in one tx (SPL)
await program.methods
  .createStream({
    campaignId: new BN(1), beneficiary: alicePubkey, amount: new BN(1_000_000),
    releaseType: ReleaseType.Linear, startTime: start, cliffTime: cliff, endTime: end,
    milestoneIdx: 0, cancellable: true,
    cancelAuthority: creator.publicKey, pauseAuthority: creator.publicKey,
  })
  .accounts({
    creator: creator.publicKey, mint: usdcMint, vestingTree, vaultAuthority, vault, sourceAta,
    tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
  })
  .rpc();

// 2. beneficiary claims whatever has vested so far (re-call periodically for a linear stream)
await program.methods
  .withdraw({
    releaseType: ReleaseType.Linear, startTime: start, cliffTime: cliff,
    endTime: end, milestoneIdx: 0,
  })
  .accounts({
    beneficiary: alicePubkey, vestingTree, claimRecord: claimPda(vestingTree, alicePubkey),
    vaultAuthority, vault, mint: usdcMint,
    beneficiaryAta: getAssociatedTokenAddressSync(usdcMint, alicePubkey),
    tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

> **Native SOL:** use `createStreamNative({...})` — drop `mint`/`vault`/`sourceAta`/token
> programs and add `systemProgram`. For **many** recipients, continue to §1.

---

## 1. Prepare the Merkle tree (off-chain)

`prepareCampaign` builds the tree, computes the root, and pre-computes every beneficiary's
proof. **All leaf fields are `BN`/numbers, not strings.**

**Release types** (the `ReleaseType` enum):

| Value | Name | When the amount unlocks |
|-------|------|-------------------------|
| `Cliff` (0) | Cliff | The full amount at `cliffTime` (nothing before). |
| `Linear` (1) | Linear | Continuously from `startTime` → `endTime` (vesting effectively begins at `cliffTime`). |
| `Milestone` (2) | Milestone | The full amount, but only after the creator calls `set_milestone_released(milestoneIdx)`. |

```ts
const CAMPAIGN_ID = new BN(1);
// BASE_TS is a Unix timestamp in SECONDS. For a real campaign pick a value in the FUTURE;
// claiming before a leaf's cliffTime returns NothingToClaim (6015).
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
// prepared.leafCount, prepared.totalSupply
// prepared.minCliffTime  → the earliest cliff across all leaves; the campaign cannot be
//                          instant-refunded after this timestamp (BN).
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

// Verify the vault holds the full supply, and the create+fund tx logs show
// the CampaignCreated + CampaignFunded events:
//   const bal = await provider.connection.getTokenAccountBalance(vault);
//   console.log(bal.value.amount);            // → prepared.totalSupply.toString()
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
`POST /api/campaigns` route is **Wallet Auth** — the request body is signed by the creator's
keypair, and the signer must equal `creator` in the body (`docs/API_TRUST_BOUNDARIES.md`).

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

> Assumes you completed §3 (BE registration). If you skipped it, build the proof client-side
> instead — `const proof = prepared.proofs[i]` (the leaf's index from §1) — and skip this fetch.

```ts
const API_BASE = "https://www.velthoryn.site";    // or your own BE origin
const ben = alicePubkey;                            // the claiming beneficiary's wallet

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

**How often to call:** `claim` pays `vested(leaf) − already_claimed` in one shot. For a
**linear** stream the beneficiary re-calls periodically (e.g. weekly) as more vests; it's
idempotent, so calling again before more vests returns `NothingToClaim` (6015). For a **cliff**
or **milestone** leaf, one call after the unlock suffices.

---

## 7. Cancellation + unvested withdrawal

```ts
const creatorAta = getAssociatedTokenAddressSync(usdcMint, creator.publicKey);  // SPL only

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

- **Always set a CU limit + priority fee** — build the tx, prepend the compute-budget instructions, then send:
  ```ts
  const tx = await program.methods
    .claim(leaf, proof)
    .accounts({ /* … */ })
    .transaction();                                 // build, don't send yet
  tx.instructions.unshift(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 15_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100 }),
  );
  await provider.sendAndConfirm(tx);
  ```
  Per-instruction CU numbers: `docs/CU_BUDGET.md`.
- **Decode errors** by code 6000–6041 → see the [Instruction Reference error table](INSTRUCTION_REFERENCE.md#error-codes-vestingerror-anchor-codes-60006041).
  Common ones: `InvalidProof` (6013, wrong/forged proof), `NothingToClaim` (6015, too early or fully claimed), `CampaignPaused` (6009), `MilestoneNotReleased` (6033), `PerLeafCapExceeded` (6041, Issue #29).

## Native-SOL specifics
- `mint = PublicKey.default`; no vault ATA — the tree PDA holds lamports.
- On the **final** claim, the PDA is drained (rent included) and closed.
- `withdraw_unvested` (native) preserves the rent-exempt minimum so the tree stays queryable by indexers (SC-FIND-02 fix).

## Further reading
- [Instruction Reference](INSTRUCTION_REFERENCE.md) — every instruction, account, error code.
- [ADRs](ADRs/) — Merkle design, keccak-256 + domain separation, Issue #29.
- `docs/CU_BUDGET.md`, `docs/API_TRUST_BOUNDARIES.md`, `docs/KNOWN_ISSUE_29_DESIGN.md`.
