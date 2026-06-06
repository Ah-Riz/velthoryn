# Lana — Week 8 Personal Workplan

## Context

Week 8 is the halfway checkpoint. V1 is feature-complete (27/27 features, 14/14 AC, devnet deployed). This week: **stabilize, fix bugs, profile performance, write honest status report**. Geral handles frontend independently — Lana owns BE/DB/SC/Merkle only.

A critical bug was found: root rotation (`update_root`) is broken because the FE hook never passes `minCliffTime`. Lana fixes the BE/SDK side and writes an integration guide so Geral can fix the FE hook.

---

## L1. Fix Root Rotation Integration Bug + Write Guide

### Problem
`useUpdateRoot.ts:32` calls `program.methods.updateRoot(root, leafCount)` — missing the 3rd arg `new_min_cliff_time`. On-chain rejects with `InvalidSchedule` (error 6038) when it defaults to 0.

### Fix scope (4 sub-tasks)

#### L1a. Add `prepareRootRotation()` to TS SDK
**File:** `clients/ts/src/prepare.ts`

Add a new exported function that:
1. Takes `newRecipients` array (same shape as `prepareCampaign` input)
2. Reuses existing `buildTree()` from `merkle.ts` and `hashLeaf()` from `leaf.ts`
3. Reuses existing `computeMinCliffTime()` (already exported from `prepare.ts`)
4. Returns `{ merkleRoot: string, leafCount: number, minCliffTime: number, leaves: PreparedLeaf[] }`

Pattern to follow: the existing `prepareCampaign()` function in the same file. Just skip the campaign-creation specific fields (creator, mint, etc.).

#### L1b. Add `minCliffTime` to API validator
**File:** `apps/web/src/lib/api/validators.ts`

In `createRootVersionRequestSchema`, add:
```ts
minCliffTime: z.number().int().positive()
```

#### L1c. Update BE route to persist `minCliffTime`
**File:** `apps/web/app/api/campaigns/[treeAddress]/root-versions/route.ts`

- Extract `minCliffTime` from validated body
- Pass it through to the on-chain instruction call (if the route sends on-chain) or store in DB `root_versions` table
- Check if `root_versions` schema needs a new `minCliffTime` column — if so, create migration `apps/web/db/migrations/0009_add_min_cliff_time.sql`

#### L1d. Write `ROOT_ROTATION_GUIDE.md`
**File:** `docs/ROOT_ROTATION_GUIDE.md` (new file)

Contents:
1. **What root rotation does** — replaces Merkle root in VestingTree PDA; existing `total_claimed` survives; old proofs become invalid
2. **On-chain instruction** — `update_root(new_root: [u8;32], new_leaf_count: u32, new_min_cliff_time: i64)`, accounts: `cancel_authority` (signer) + `vesting_tree` (writable)
3. **Authority gate** — `canRotateRoot()` rules: `cancellable=true`, `cancelledAt=null`, `leafCount > 1`, signer = `cancelAuthority`
4. **Step-by-step integration:**
   - Step 1: Prepare new recipients → call `prepareRootRotation(newRecipients)` from TS SDK
   - Step 2: Build Anchor tx → `program.methods.updateRoot(root, leafCount, minCliffTime).accounts({...})`
   - Step 3: Send + confirm tx
   - Step 4: POST to `/api/campaigns/:treeAddress/root-versions` for indexing
5. **JSON payload shape** for the API POST
6. **⚠️ BUG FIX for Geral:** `useUpdateRoot.ts:32` — change `program.methods.updateRoot(Array.from(...), params.payload.leafCount)` → `program.methods.updateRoot(Array.from(...), params.payload.leafCount, params.payload.minCliffTime)`
7. **Edge cases:** SameRoot, NotCancellable, CampaignCancelled, InvalidSchedule, EmptyRoot
8. **Event emitted:** `RootUpdated { tree, old_root, new_root, new_leaf_count }`

### Verification
- `cd clients/ts && npm run build` — SDK compiles
- `cd apps/web && npx vitest run tests/api/backend.test.ts` — API tests pass (existing root-versions tests at line 753)
- Read through guide for completeness — Geral should be able to fix the hook without asking questions

---

## L2. Bug Audit & Fix (SC + BE + DB)

### Scope
Sweep all known issues from Weeks 4–7:

| Area | Files | What to check |
|------|-------|---------------|
| **SC** | `programs/vesting/src/instructions/*.rs`, `math/*.rs` | Edge cases in schedule math, proof verification, authority checks |
| **BE** | `apps/web/app/api/**/*.ts` | Error handling, input validation, race conditions in concurrent claims |
| **DB** | `apps/web/db/migrations/`, `apps/web/src/lib/db/schema.ts` | RLS policy gaps, missing indexes, constraint violations |
| **Merkle** | `clients/ts/src/merkle.ts`, `leaf.ts` | Parity with Rust `merkle.rs`, proof generation at odd leaf counts |

### Approach
1. Run full test suite — identify any failures or skips
2. Review Week 4–7 test files for `skip`/`todo`/`FIXME` markers
3. Check `apps/web/tests/` for skipped Vitest tests (13 skipped noted)
4. For each issue: fix if straightforward, document as known limitation if not
5. Run `cargo clippy` on SC code — fix warnings

### Output
- `week8/KNOWN_ISSUES.md` — table of: issue, area, status (fixed/documented), rationale

### Verification
- `anchor test` — all TS integration tests pass
- `cd apps/web && npx vitest run` — 553+ passing, no new failures
- `cargo clippy --all-targets` — zero warnings
- `cd programs/vesting && cargo test` — all Rust unit + proptest pass

---

## L3. End-to-End BE Verification (devnet)

### Flow to verify
Run each step against devnet, log request/response:

| # | Endpoint | Method | Expected |
|---|----------|--------|----------|
| 1 | `/api/campaigns/prepare` | POST | Returns `{ merkleRoot, leafCount, minCliffTime, leaves[] }` |
| 2 | `/api/campaigns/` | POST | Creates campaign on-chain, returns `treeAddress` |
| 3 | `/api/campaigns/[addr]/proof?beneficiary=X` | GET | Returns valid Merkle proof |
| 4 | `/api/campaigns/[addr]/claims` | POST | Claim succeeds, DB updated |
| 5 | `/api/campaigns/[addr]/cancel` | POST | Campaign cancelled, grace period starts |
| 6 | `/api/campaigns/[addr]/withdraw-unvested` | POST | Unvested tokens returned |

### Also verify
- DB state consistency after each step (query `campaigns`, `root_versions`, `leaves`, `claims` tables)
- Native SOL path works identically (steps 1-6 with `create_campaign_native`)
- `/api/health` returns healthy

### Output
- `week8/E2E_BE_VERIFICATION.md` — step-by-step log with pass/fail, screenshots or curl output

### Verification
- All 6 steps complete without errors
- DB queries return expected state after each step

---

## L4. Performance Profiling

### 4a. CU Budget Audit
- Run existing benchmark scripts or write quick bankrun tests for all 18 instructions
- Record: instruction name, CU consumed, CU limit, % utilized
- Reference: `docs/CU_BUDGET.md` (existing)

### 4b. Transaction Cost Analysis
- Compute cost per instruction: `CU_consumed × lamports_per_cu` (devnet rates)
- Compare against Jito target: ~$0.42 per campaign creation
- For `create_campaign` + `fund_campaign` combined

### 4c. API Latency
- Measure p50/p95 for key endpoints using `curl -w "@curl-format.txt"` or simple `time` wrapper
- Endpoints: `/api/campaigns/`, `/api/campaigns/[addr]/proof`, `/api/campaigns/[addr]/claims`

### 4d. Merkle Tree Scale
- Run existing benchmark data: `10000.ts`, `15000.ts` in project root
- Or use `test-be-merkle-pipeline.ts` script
- Measure: tree build time, proof gen time, memory usage at 1K / 5K / 10K / 15K leaves

### Output
- `week8/PERFORMANCE_REPORT.md` — tables for CU budget, costs, latency, merkle scale
- Update `docs/CU_BUDGET.md` if findings differ

### Verification
- All 18 instructions benchmarked
- Cost comparison against Jito target documented
- At least 4 merkle tree sizes profiled

---

## L5. Status Report — Lana's Sections

### Sections to write

**1. What's Working Well**
- SC: 18 instructions, 41 error variants, 12 events — all functional on devnet
- Tests: 230+ tests (127 TS integration + 103 Rust), 98.02% coverage
- Merkle: Rust↔TS parity verified, anti-second-preimage defense, scale tested to 15K leaves
- CI: 3 workflows green, 5 testing frameworks integrated
- BE: 25+ API routes with rate limiting, auth, versioning

**2. What's Not**
- Mollusk 0.14 upgrade blocked upstream — 18 instruction tests stay ignored
- Sentry DSN not configured — error tracking not live
- Root rotation integration bug (now fixed in L1)
- API auth gap on `POST root-versions` (accepts unauthenticated writes)

**3. Known Bugs / Limitations**
- From L2 audit — reference `week8/KNOWN_ISSUES.md`

**4. Performance Findings**
- From L4 profiling — reference `week8/PERFORMANCE_REPORT.md`

**5. Phase 3 Recommendations**
- External audit engagement ($15-40K budget)
- Mollusk 0.14 migration when unblocked
- Formal CU budget audit with mainnet cluster params
- Sentry live DSN + k6 load testing
- Wallet signature auth on root-versions route
- Mainnet deploy following `MAINNET_CHECKLIST.md`

**6. Honest Assessment**
- Backend/SC readiness: production-grade for devnet, needs external audit before mainnet
- Merkle pipeline: robust, cost-competitive with Jito
- API: feature-complete, needs auth hardening

### Output
- Google Doc section (paste into shared doc)
- Or `week8/STATUS_REPORT_LANA.md` for review before sharing

---

## L6. PR + Submit

1. All fixes on `dev_lana` branch
2. Single PR with clear conventional commits:
   - `fix(sdk): add prepareRootRotation helper for root rotation`
   - `fix(api): add minCliffTime to root-versions schema`
   - `docs: add ROOT_ROTATION_GUIDE.md for FE integration`
   - `fix: [any L2 bug fixes]`
   - `docs: add week 8 reports (KNOWN_ISSUES, PERFORMANCE, STATUS)`
3. Push to `dev_lana`, create PR to `test`
4. Share Google Doc with BD + Marketing

---

## Execution Checklist

```
□ L1a  prepareRootRotation() in TS SDK
□ L1b  minCliffTime in API validator
□ L1c  BE route persist minCliffTime
□ L1d  ROOT_ROTATION_GUIDE.md written
□ L1✓  All tests pass after L1 changes

□ L2   Bug audit complete
□ L2✓  KNOWN_ISSUES.md written

□ L3   E2E devnet walkthrough complete
□ L3✓  E2E_BE_VERIFICATION.md written

□ L4a  CU budget table filled
□ L4b  Cost analysis vs Jito
□ L4c  API latency measured
□ L4d  Merkle scale profiled
□ L4✓  PERFORMANCE_REPORT.md written

□ L5   Status report written
□ L5✓  STATUS_REPORT_LANA.md or Google Doc

□ L6   PR to dev_lana
□ L6✓  Shared with team
```
