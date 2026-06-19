# Integration Guide — start here

**Audience:** a developer new to this repo who wants to **read the code** across any layer
(Smart Contract / Merkle / Backend / Database) or **call the REST API**. This page is the hub: it
orients you, maps the code by layer, and gives a quick API reference. For deep, runnable end-to-end
walkthroughs it links out to companion docs — it deliberately does not duplicate them.

> **What this system is:** a **creator** locks SPL tokens (or native SOL) in an on-chain program and
> releases them to one or more **beneficiaries** on a schedule (cliff / linear / milestone).
> Recipients are committed via a single 32-byte **Merkle root**, so thousands of wallets onboard in
> one transaction. A **backend** (Next.js + Postgres) indexes on-chain events and **serves Merkle
> proofs** so beneficiaries don't need the raw leaf list.

| | |
|---|---|
| **Program ID** | `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` (immutable — see [`docs/PROGRAM.md`](PROGRAM.md)) |
| **Network** | devnet — verify with `solana program show G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` |
| **IDL** | `target/idl/vesting.json` after `anchor build`; FE copy at `apps/web/src/lib/anchor/idl.json` |
| **First-run setup** | [`LOCAL_DEV.md`](LOCAL_DEV.md) (keypair, validator, first green test) |

---

## What do you want to do?

| Goal | Read this | Then the deep dive |
|------|-----------|--------------------|
| Read / call the **on-chain program** (SC) | [§A](#a-smart-contract-sc) | [`week9/INTEGRATION_GUIDE.md`](week9/INTEGRATION_GUIDE.md), [`week9/INSTRUCTION_REFERENCE.md`](week9/INSTRUCTION_REFERENCE.md), [`PROGRAM.md`](PROGRAM.md) |
| Read / use the **Merkle client** (MERKLE) | [§B](#b-merkle-merkle) | [`week9/INTEGRATION_GUIDE.md` §1](week9/INTEGRATION_GUIDE.md), [`week9/ADRs/`](week9/ADRs/) |
| Read the **backend** (BE) | [§C](#c-backend-be) | [`BACKEND_API.md`](BACKEND_API.md), [`API_TRUST_BOUNDARIES.md`](API_TRUST_BOUNDARIES.md) |
| Read the **database** (DB) | [§D](#d-database-db) | [`BACKEND_API.md` §2](BACKEND_API.md) |
| **Call the REST API** | [§E](#e-use-the-api) | [`BACKEND_API.md` §3](BACKEND_API.md), [`API_TRUST_BOUNDARIES.md`](API_TRUST_BOUNDARIES.md) |

> **Single-recipient case (most common):** one beneficiary needs no Merkle tree at all — `create_stream`
> creates + funds in one tx and the recipient claims via `withdraw` (no proof). See the Quickstart in
> [`week9/INTEGRATION_GUIDE.md`](week9/INTEGRATION_GUIDE.md).

---

## A. Smart contract (SC)

**Where the code lives:** `programs/vesting/`

```
programs/vesting/src/
  instructions/   # one file per instruction handler (15 files)
  math/           # schedule.rs (vesting curve) + merkle.rs (leaf_hash / verify)
  state/          # account structs: VestingTree, ClaimRecord (#[zero_copy]), etc.
  events.rs       # CampaignCreated / Funded / Claimed / Cancelled / RootUpdated / …
  lib.rs          # instruction dispatch (#[program])
```

**Instructions** (15 files): `create_campaign`, `create_stream`, `fund_campaign`, `claim`, `withdraw`,
`cancel_campaign`, `cancel_stream`, `instant_refund_campaign`, `set_milestone_released`, `update_root`,
`withdraw_unvested`, `pause_campaign`, `close_claim_record`, `get_vested_amount`. Most have `*_native`
variants for SOL. Every account the program touches is a **PDA** (`tree`, `vault_authority`, `claim`).

**Read next:**
- Runnable create → fund → claim → cancel snippets (SPL **and** native SOL): [`week9/INTEGRATION_GUIDE.md`](week9/INTEGRATION_GUIDE.md)
- Every instruction's accounts, args, and error codes (6000–6041): [`week9/INSTRUCTION_REFERENCE.md`](week9/INSTRUCTION_REFERENCE.md)
- State layouts + program ID: [`PROGRAM.md`](PROGRAM.md) · Error reference: [`ERROR_MAP.md`](ERROR_MAP.md)

---

## B. Merkle (MERKLE)

**Canonical client:** `clients/ts/src/` (published as `@velthoryn/client`)

| File | Exports you'll use |
|------|--------------------|
| `index.ts` | package barrel |
| `prepare.ts` | `prepareCampaign(recipients) → { root, rootHex, leafCount, totalSupply, minCliffTime, leaves, proofs }`; `prepareRootRotation(recipients)` |
| `leaf.ts` | `encodeLeaf`, `leafHash`, `VestingLeaf` (70-byte Borsh layout) |
| `merkle.ts` | `buildTree`, `getRoot`, `getProof`, `nodeHash`, `verifyProof`, `proofAsArrays`, `MAX_TREE_DEPTH` (= 20) |

The leaf hash is **byte-identical** to `math::merkle::leaf_hash()` on-chain (keccak-256, domain-separated — golden-vector tested).

**FE wrapper** (re-exports + dApp conveniences): `apps/web/src/lib/merkle/{builder,verify}.ts`

**Read next:** tree-building walk-through [`week9/INTEGRATION_GUIDE.md` §1](week9/INTEGRATION_GUIDE.md) ·
design decisions [`week9/ADRs/ADR-001-merkle-compressed-vesting.md`](week9/ADRs/ADR-001-merkle-compressed-vesting.md),
[`ADR-002-keccak-256-domain-separation.md`](week9/ADRs/ADR-002-keccak-256-domain-separation.md).

---

## C. Backend (BE)

**Stack:** Next.js 15 (App Router) Route Handlers + Drizzle ORM + Postgres (Supabase) + Redis (nonce store).
**Where the code lives:** `apps/web/src/app/api/` (26 route files) + `apps/web/src/lib/api/` (route wrapper,
auth middleware, serialization) + `apps/web/src/lib/db/` (schema + queries).

Route handlers grouped by purpose:

| Group | Routes (`apps/web/src/app/api/`) |
|-------|----------------------------------|
| Campaign write/lookup | `campaigns/` (GET list, POST create), `campaigns/[treeAddress]/` (GET detail), `campaigns/prepare`, `campaigns/import` |
| Beneficiary | `beneficiary/[address]/campaigns`, `beneficiary/[address]/vesting-progress` |
| Creator actions | `campaigns/[treeAddress]/{cancel,cancel-stream,instant-refund,withdraw-unvested,milestones/[idx],root-versions}` |
| Read analytics | `campaigns/[treeAddress]/{proof,claims,timeline}`, `activity/[address]` |
| Indexing / sync | `events/sync` (public), `claims/sync` + `admin/sync` (admin), `cron/sync` (Vercel cron) |
| Auth + ops | `auth/nonce`, `health`, `simulate-vesting`, `schedule-templates`, `waitlist` |

The BE never holds funds — it indexes events and **serves proofs**. Wallet-state (`paused`, `cancelledAt`)
flows only from indexed on-chain events (the old `PATCH …/status` route is **Removed** — do not use).

**Read next:** data flows + file structure [`BACKEND_API.md` §4–§5](BACKEND_API.md) · auth tier per route
[`API_TRUST_BOUNDARIES.md`](API_TRUST_BOUNDARIES.md) · route wrapper `apps/web/src/lib/api/route-wrapper.ts`.

---

## D. Database (DB)

**Schema (source of truth):** `apps/web/src/lib/db/schema.ts` (Drizzle, Postgres).
**Migrations / config:** `apps/web/drizzle.config.ts`. u64/i64 use native Postgres `bigint`; proofs + metadata are JSONB.

**4 core tables:**

| Table | Purpose |
|-------|---------|
| `campaigns` | On-chain campaign index — `tree_address`, `creator`, `mint`, `merkle_root`, `total_supply`, `total_claimed`, authorities, flags, `min_cliff_time`. |
| `root_versions` | Merkle root history per campaign — `version`, `merkle_root`, `leaf_count`, `ipfs_cid`. |
| `leaves` | Per-recipient leaf + proof — `beneficiary`, `amount`, schedule fields, `proof` (JSONB `number[][]`). |
| `claim_events` | `Claimed` event log — per-claim `amount` + cumulative totals, `signature` (idempotency key), `slot`, `block_time`. |

**7 event-log tables** (each indexed from its on-chain event, `signature`-unique): `cancel_events`,
`pause_events`, `root_update_events`, `withdraw_events`, `milestone_events`, `stream_cancel_events`,
`instant_refund_events`. **2 operational tables:** `waitlist`, `sync_state` (indexer checkpoint).

> `BACKEND_API.md §2` documents the 4 core tables in full column detail; the event-log + operational
> tables live in `schema.ts` and were added by the indexer (F2/F3 phases).

**Read next:** [`BACKEND_API.md §2`](BACKEND_API.md) for full DDL.

---

## E. Use the API

Base URL: `https://velthoryn.vercel.app` (or your own BE origin). All routes return `X-API-Version: 1`.
u64/i64 values serialize as **decimal strings** (`serializeBigInt()` in `apps/web/src/lib/api/serialize.ts`).

### Auth tiers (3)

| Tier | How it's enforced | Used by |
|------|-------------------|---------|
| **Public** | rate-limited per IP (default 60/min); no auth | reads: lists, detail, proof, claims, timeline |
| **Wallet Auth** | `Authorization: Bearer <b64(sig)>.<b64(msg)>` — ed25519 over a nonce; signer must match the on-chain authority | writes: create, cancel, refund, root-rotation, milestones |
| **Admin** | `x-admin-key` or cron `Bearer` secret (timing-safe) | indexing: `admin/sync`, `claims/sync`, `cron/sync` |

### Core routes (the ones integrators call)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/campaigns/prepare` | Public | Build the Merkle tree server-side; returns `merkleRoot`, `leafCount`, `minCliffTime`, proofs |
| `POST` | `/api/campaigns` | Wallet Auth | Register a campaign + leaves after the on-chain `create_campaign`/`create_stream` tx |
| `GET`  | `/api/campaigns/:treeAddress/proof?beneficiary=<b58>` | Public | Fetch a beneficiary's leaf + Merkle proof (sub-ms) |
| `GET`  | `/api/campaigns/:treeAddress` | Public | Campaign detail + analytics + grace-period state |
| `GET`  | `/api/campaigns` | Public | Paginated list (`?creator=&mint=&status=&page=&limit=`) |
| `GET`  | `/api/campaigns/:treeAddress/claims` | Public | Claim history (`?beneficiary=&fromSlot=&limit=`) |
| `GET`  | `/api/beneficiary/:address/campaigns` | Public | All campaigns where `:address` is a beneficiary (+ their leaf) |
| `POST` | `/api/campaigns/:treeAddress/root-versions` | Wallet Auth | Record a new root version after on-chain `update_root` |
| `POST` | `/api/campaigns/:treeAddress/instant-refund` | Wallet Auth | Build instant-refund tx for an unstarted multi-leaf campaign |

**Full table (all 26 routes incl. admin/sync/cron):** [`API_TRUST_BOUNDARIES.md`](API_TRUST_BOUNDARIES.md).
**Full request/response shapes:** [`BACKEND_API.md §3`](BACKEND_API.md).

### Example 1 — fetch a proof (Public read)

```bash
curl "https://velthoryn.vercel.app/api/campaigns/<treeAddress>/proof?beneficiary=<base58>"
# → { leaf: { leafIndex, beneficiary, amount, releaseType, startTime, cliffTime, endTime, milestoneIdx },
#     proof: number[][], merkleRoot, treeAddress }
```

### Example 2 — register a campaign after the on-chain tx (Wallet Auth write)

```ts
// 1. nonce → sign → bearer header  (GET /api/auth/nonce, then ed25519-sign {nonce,timestamp,wallet})
const auth = await buildSolanaAuthHeader(creator);   // see API_TRUST_BOUNDARIES.md §Wallet auth flow

// 2. POST the campaign (full leaves + proofs so the BE can serve them)
await fetch(`${API_BASE}/api/campaigns`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: auth },
  body: JSON.stringify({
    treeAddress, creator, mint, campaignId, merkleRoot: prepared.rootHex,
    leafCount: prepared.leafCount, totalSupply: prepared.totalSupply.toString(),
    cancellable: true, cancelAuthority, pauseAuthority, createdAt: Math.floor(Date.now()/1000),
    leaves: prepared.leaves.map((l, i) => ({ /* leafIndex…milestoneIdx */ proof: prepared.proofs[i] })),
  }),
});
// → 201 { ok: true, campaignId }
```

### Example 3 — beneficiary claim flow (API serves the proof; the claim itself is an on-chain tx)

```ts
// 1. fetch proof from the API (Example 1)
// 2. submit the on-chain claim with that leaf + proof (see week9/INTEGRATION_GUIDE.md §6b)
await program.methods.claim(leaf, proof).accounts({ beneficiary, vestingTree, /* … */ }).rpc();
// 3. the BE indexer picks up the Claimed event and updates claim_events + analytics
```

**Wallet-auth header format + server checks:** [`API_TRUST_BOUNDARIES.md` §Wallet auth flow](API_TRUST_BOUNDARIES.md).

---

## Compute budget & errors

- **Always prepend CU limit + priority fee** to mutating txs — per-instruction CU numbers in [`CU_BUDGET.md`](CU_BUDGET.md).
- **Decode errors** by code 6000–6041 — table in [`week9/INSTRUCTION_REFERENCE.md`](week9/INSTRUCTION_REFERENCE.md);
  common ones: `InvalidProof` (6013), `NothingToClaim` (6015), `CampaignPaused` (6009),
  `MilestoneNotReleased` (6033), `PerLeafCapExceeded` (6041).

---

## Further reading

- [`week9/INTEGRATION_GUIDE.md`](week9/INTEGRATION_GUIDE.md) — full end-to-end walkthrough (prepare → create → fund → register → claim → cancel), SPL + native SOL.
- [`week9/INSTRUCTION_REFERENCE.md`](week9/INSTRUCTION_REFERENCE.md) — every instruction, account, error code.
- [`BACKEND_API.md`](BACKEND_API.md) — schema, routes, data flows. · [`API_TRUST_BOUNDARIES.md`](API_TRUST_BOUNDARIES.md) — auth tier per route.
- [`PROGRAM.md`](PROGRAM.md) · [`STREAM_MODEL.md`](STREAM_MODEL.md) · [`ERROR_MAP.md`](ERROR_MAP.md) · [`CU_BUDGET.md`](CU_BUDGET.md) · [`week9/ADRs/`](week9/ADRs/).
