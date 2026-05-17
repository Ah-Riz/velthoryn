# BE-SC Merkle Pipeline + Vercel Deployment

> **Owner**: Lana (SC/BE). **Do not touch**: frontend pages/components (Geral's domain).
> **Repo**: Velthoryn — Solana Anchor monorepo, 65 tests passing, devnet deployed at `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`.

---

## Context

V1 ships 4 features. The SC already implements all of them. The gap is the BE-SC merkle wiring and deployment.

| V1 Feature | SC | BE | Gap |
|---|---|---|---|
| Bulk Send (1-to-many merkle) | Done | API routes + DB schema exist | E2E merkle pipeline verification |
| Dashboard (transparency) | 9 event types, public accounts | 7 API routes built | Verify with real data, deploy |
| Cliff / Linear / Milestone | `schedule.rs`, `claim.rs`, `withdraw.rs` | Leaf schema has `releaseType`, `cliffTime` | Verify proofs for all 3 types |
| Clawback (cancel + 7-day grace) | `cancelCampaign`, `withdraw_unvested` | DB has `cancelledAt` | Verify cancel state in API |

### VestingLeaf (70 bytes — must match Rust `state/leaf.rs` exactly)

| Field | Type | Offset | Size |
|---|---|---|---|
| leaf_index | u32 LE | 0 | 4 |
| beneficiary | Pubkey | 4 | 32 |
| amount | u64 LE | 36 | 8 |
| release_type | u8 (0=Cliff, 1=Linear, 2=Milestone) | 44 | 1 |
| start_time | i64 LE | 45 | 8 |
| cliff_time | i64 LE | 53 | 8 |
| end_time | i64 LE | 61 | 8 |
| milestone_idx | u8 | 69 | 1 |

Hash: `keccak256(0x00 || borsh(leaf))`. Node: `keccak256(0x01 || left || right)`.

### API Routes (all built)

| Route | Method | Purpose |
|---|---|---|
| `/api/campaigns` | POST | Create campaign + root version + leaves. Verifies first leaf proof. |
| `/api/campaigns` | GET | List with filters, pagination. |
| `/api/campaigns/[treeAddress]` | GET | Campaign detail + analytics. |
| `/api/campaigns/[treeAddress]/proof` | GET | Leaf + merkle proof for beneficiary. |
| `/api/campaigns/[treeAddress]/claims` | GET | Claim history. |
| `/api/campaigns/[treeAddress]/root-versions` | GET | Root version history. |
| `/api/beneficiary/[address]/campaigns` | GET | All campaigns for address. |
| `/api/admin/sync` | POST | Indexer: backfill claim_events. Auth: x-admin-key. |

---

## Phase 1 — Merkle Builder Parity

**Goal**: Confirm `clients/ts/` and `apps/web/` merkle builders produce byte-identical output. Fix if they don't.

**Files**:
- `clients/ts/src/merkle.ts` — hand-rolled binary tree (byte-verified against Rust)
- `clients/ts/src/leaf.ts` — encodeLeaf, leafHash, nodeHash
- `clients/ts/src/prepare.ts` — prepareCampaign
- `apps/web/src/lib/merkle/builder.ts` — uses merkletreejs

**Steps**:
1. Read both implementations. Compare hashing logic (even/odd index, odd-layer duplication, sort behavior).
2. Write `scripts/test-merkle-parity.ts` that feeds identical 3-leaf input to both, compares root and all proofs byte-for-byte.
3. If divergence: fix `apps/web/src/lib/merkle/builder.ts`. Preferred fix — import from `clients/ts/` via workspace. Fallback — port the hand-rolled `VestingMerkleTree` into `apps/web/`.
4. Verify `clients/ts/` proofs pass Rust's `verify_merkle_proof` logic by checking existing golden-vector tests still pass.

**Test Gate**:
```bash
npx tsx scripts/test-merkle-parity.ts
# Expected: 3 roots match, 3x3 proof sets match, all verifications pass
# Must exit 0
```

**Do not proceed to Phase 2 until this passes.**

---

## Phase 2 — DB Schema Sync

**Goal**: Supabase tables match `schema.ts`. No missing columns, no stale migrations.

**Files**:
- `apps/web/src/lib/db/schema.ts` — Drizzle schema (campaigns, root_versions, leaves, claim_events)
- `apps/web/src/lib/db/index.ts` — Postgres connection
- `apps/web/drizzle.config.ts` — Drizzle Kit config
- `.env` — DATABASE_URL

**Steps**:
1. Run `cd apps/web && npx drizzle-kit push` to sync schema to Supabase.
2. If that fails or you want a migration file: `npx drizzle-kit generate` then apply.
3. Verify tables exist: connect to Supabase and confirm `campaigns`, `root_versions`, `leaves`, `claim_events` have all columns from schema.ts.
4. Check indexes: `uq_creator_mint_campaign`, `uq_campaign_version`, `uq_root_version_leaf`, `idx_*` indexes all present.

**Test Gate**:
```bash
cd apps/web && npx drizzle-kit push
# Expected: schema synced, no errors

# Verify manually:
npx tsx -e "
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL);
const tables = await sql\`SELECT tablename FROM pg_tables WHERE schemaname = 'public'\`;
console.log(tables);
const cols = await sql\`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'leaves' ORDER BY ordinal_position\`;
console.log(cols);
await sql.end();
"
# Expected: 4 tables, leaves has 10 columns matching schema.ts
```

**Do not proceed to Phase 3 until this passes.**

---

## Phase 3 — E2E Merkle Pipeline Test

**Goal**: Multi-leaf campaign flows through BE API: prepare → POST → GET proof → verify.

**Files**:
- `scripts/test-be-merkle-pipeline.ts` (new — write this)
- `clients/ts/src/prepare.ts` — prepareCampaign
- `clients/ts/src/merkle.ts` — verifyProof
- `apps/web/src/app/api/campaigns/route.ts` — POST endpoint
- `apps/web/src/app/api/campaigns/[treeAddress]/proof/route.ts` — GET proof

**Steps**:
1. Write `scripts/test-be-merkle-pipeline.ts` using `@coral-xyz/anchor` BN and `@solana/web3.js` PublicKey.
2. Pipeline:
   - Define 3 recipients: one Cliff, one Linear, one Milestone (use real timestamps — `cliff_time` in the future for cliff type, etc.)
   - Call `prepareCampaign(recipients)` to build tree + proofs
   - POST to `http://localhost:3000/api/campaigns` with the full payload (treeAddress = derived PDA as hex string, merkleRoot = rootHex, etc.)
   - For each recipient: GET `http://localhost:3000/api/campaigns/${treeAddress}/proof?beneficiary=${base58}`
   - Verify each returned proof using `verifyProof(leafHashBuf, proofBuffers, leafIndex, rootBuf)`
   - Assert returned leaf data matches input (amount, releaseType, timestamps)
3. Print step-by-step PASS/FAIL. Exit 0 on all-pass.

**Test Gate**:
```bash
# Terminal 1:
cd apps/web && pnpm dev

# Terminal 2:
npx tsx scripts/test-be-merkle-pipeline.ts
# Expected:
# [1/4] prepareCampaign .......... PASS (3 leaves, root=0x...)
# [2/4] POST /api/campaigns ..... PASS (201)
# [3/4] GET proof x3 ............ PASS (all 3 found)
# [4/4] verifyProof x3 .......... PASS (all 3 verify)
# ALL PASS

# Must exit 0
```

**Do not proceed to Phase 4 until this passes.**

---

## Phase 4 — Build Fix & Local Verification

**Goal**: `apps/web/` builds cleanly. All existing tests still pass.

**Files**:
- `apps/web/next.config.ts`
- `apps/web/package.json`
- `apps/web/tsconfig.json`
- `pnpm-workspace.yaml`

**Steps**:
1. `cd apps/web && pnpm build` — fix any errors.
2. Common issues to watch for:
   - `clients/ts/` import: if `apps/web/` imports from `clients/ts/`, ensure workspace link works in build. If not, the `apps/web/src/lib/merkle/builder.ts` must be self-contained (which it is — it uses merkletreejs).
   - `crypto` module: `apps/web/src/lib/auth.ts` uses `node:crypto` — this works in Next.js API routes (Node runtime) but would fail in edge runtime. Confirm routes use default Node runtime.
   - IDL import: `apps/web/src/lib/anchor/client.ts` imports `./idl.json` — ensure this file exists (it should be copied from `target/idl/vesting.json` or committed).
3. Run existing test suites:
   - `pnpm test:localnet` — expect 65/65
   - `cd apps/web && pnpm test` — expect 38/38
4. Create `apps/web/.env.example`:
   ```
   DATABASE_URL=
   NEXT_PUBLIC_RPC_ENDPOINT=
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   ADMIN_API_KEY=
   API_KEY=
   PINATA_JWT=
   PINATA_GATEWAY_URL=
   ```

**Test Gate**:
```bash
cd apps/web && pnpm build
# Expected: build succeeds, no errors

cd /path/to/repo/root && pnpm test:localnet
# Expected: 65/65 pass

cd apps/web && pnpm test
# Expected: 38/38 pass
```

**Do not proceed to Phase 5 until ALL three pass.**

---

## Phase 5 — Vercel Deployment

**Goal**: `apps/web/` live on Vercel with all API routes responding.

**Steps**:
1. In Vercel dashboard: new project → import Git repo → set root directory to `apps/web/`
2. Framework preset: Next.js
3. Build command: `pnpm build` (or leave default — Next.js auto-detected)
4. Output directory: `.next/`
5. Set environment variables (all from `.env`):
   - `DATABASE_URL` — Supabase Postgres connection string
   - `NEXT_PUBLIC_RPC_ENDPOINT` — `https://devnet.helius-rpc.com/?api-key=...`
   - `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key
   - `ADMIN_API_KEY` — for `/api/admin/sync` auth
   - `API_KEY` — for general API auth
   - `PINATA_JWT` — IPFS pinning
   - `PINATA_GATEWAY_URL` — `https://gateway.pinata.cloud`
6. Deploy. Check build logs for errors.
7. After deploy, verify routes:

**Test Gate**:
```bash
# Replace YOUR_APP with actual Vercel URL

# 1. List campaigns (empty is fine)
curl -s https://YOUR_APP.vercel.app/api/campaigns | jq .
# Expected: { "campaigns": [], "total": 0, "page": 1, "limit": 20 }

# 2. Nonexistent campaign → 404
curl -s -w "\n%{http_code}" https://YOUR_APP.vercel.app/api/campaigns/nonexistent123
# Expected: 404

# 3. Proof lookup → 400 (missing beneficiary param)
curl -s -w "\n%{http_code}" https://YOUR_APP.vercel.app/api/campaigns/someaddr/proof
# Expected: 400

# 4. Beneficiary campaigns → empty
curl -s "https://YOUR_APP.vercel.app/api/beneficiary/11111111111111111111111111111111/campaigns" | jq .
# Expected: { "campaigns": [] } or 400 (invalid address)
```

**Deployment is not complete until all 4 curl checks pass.**

---

## Phase 6 — Post-Deploy E2E Against Live BE

**Goal**: Run the pipeline test against the deployed Vercel URL (not localhost).

**Steps**:
1. Update `scripts/test-be-merkle-pipeline.ts` to accept a `--url` flag (default `http://localhost:3000`, override with Vercel URL).
2. Run against deployed BE:

**Test Gate**:
```bash
npx tsx scripts/test-be-merkle-pipeline.ts --url https://YOUR_APP.vercel.app
# Expected: same output as Phase 3, all PASS
# Must exit 0
```

**This is the final gate. When this passes, the BE-SC-Merkle pipeline is ready for user testing.**

---

## Summary Checklist

| Phase | Gate | Pass? |
|---|---|---|
| 1 — Merkle builder parity | `test-merkle-parity.ts` exits 0 | [ ] |
| 2 — DB schema sync | `drizzle-kit push` succeeds, tables verified | [ ] |
| 3 — E2E pipeline (local) | `test-be-merkle-pipeline.ts` exits 0 | [ ] |
| 4 — Build + regression | `pnpm build` + 65/65 SC tests + 38/38 FE tests | [ ] |
| 5 — Vercel deploy | 4 curl checks pass | [ ] |
| 6 — E2E pipeline (live) | `test-be-merkle-pipeline.ts --url VERCEL` exits 0 | [ ] |

## Key File Paths

```
# SC (don't modify unless you find a real bug)
programs/vesting/src/math/merkle.rs
programs/vesting/src/instructions/claim.rs
programs/vesting/src/state/leaf.rs

# TS client (source of truth for merkle)
clients/ts/src/leaf.ts
clients/ts/src/merkle.ts
clients/ts/src/prepare.ts

# Web app merkle (must match client)
apps/web/src/lib/merkle/builder.ts

# API routes (your domain)
apps/web/src/app/api/campaigns/route.ts
apps/web/src/app/api/campaigns/[treeAddress]/proof/route.ts
apps/web/src/app/api/campaigns/[treeAddress]/route.ts
apps/web/src/app/api/beneficiary/[address]/campaigns/route.ts

# DB
apps/web/src/lib/db/schema.ts
apps/web/src/lib/db/index.ts
apps/web/drizzle.config.ts

# Config
apps/web/next.config.ts
pnpm-workspace.yaml
.env
```
