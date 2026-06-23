# ADR-003: Issue #29 — defer the on-chain fix, mitigate at the backend

> **⚠ SUPERSEDED (2026-06-16).** The on-chain fix was implemented (Option A in
> `KNOWN_ISSUE_29_DESIGN.md`). See "Supersession" below. This ADR is retained for
> history. The BE guards described here are now obsolete and slated for removal in a
> follow-up post-deploy PR (`apps/web/src/app/api/campaigns/{prepare,import}/route.ts`).

**Status:** Superseded — on-chain fix shipped
**Date:** 2026-06-14 (original) · 2026-06-16 (superseded)
**Owner:** Lana (SC / BE)
**Related:** `docs/KNOWN_ISSUE_29_DESIGN.md`

## Context

A beneficiary can in principle appear in **more than one cliff/linear leaf** of the same
Merkle tree (e.g. two separate allocations). On-chain, a beneficiary has exactly **one**
`ClaimRecord` PDA per campaign (seeded `[b"claim", vesting_tree, beneficiary]`), whose
`claimed_amount` is **cumulative across all of that beneficiary's leaves**, while
`vested()` is computed **per leaf**. So for a beneficiary with two fully-vested linear
leaves of amount A each:

1. Claim leaf 1 → `claimable = vested(leaf1) − claimed_amount(0) = A`; `claimed_amount = A`.
2. Claim leaf 2 → `claimable = vested(leaf2) − claimed_amount(A) = 0` → `NothingToClaim`.

The beneficiary receives A total instead of 2A — an **under-count**, never an over-count.
Two independent guards make overspend impossible regardless: the per-beneficiary
`saturating_sub` on `claimed_amount`, and the global `require!(new_total ≤ total_supply,
OverClaim)`. So this is a **fairness/availability** bug, not a fund-safety bug.

The correct on-chain fix is per-leaf tracking in `ClaimRecord` — but `ClaimRecord` already
ships a `total_entitled` field whose addition was a layout-breaking change, and a full
per-leaf ledger would be a second breaking migration (resize or close+reclaim of every
existing `ClaimRecord`). That is disproportionate to a no-fund-loss limitation that the
ingest layer can prevent outright.

## Decision

**Option B — defer the on-chain fix; mitigate at the backend; document as a known
limitation.**

- The **backend rejects** any campaign ingest that assigns more than one cliff/linear leaf
  to the same beneficiary. This is enforced on both ingest paths:
  - `apps/web/src/app/api/campaigns/prepare/route.ts:70-82` (`cliffLinearSeen` map).
  - `apps/web/src/app/api/campaigns/import/route.ts:92-107` (`cliffLinearSeen` map).
- **Milestone** leaves (release_type 2) are exempt — a beneficiary legitimately has
  multiple milestone leaves (distinct `milestone_idx`), and the on-chain `milestone_bitmap`
  already prevents double-claiming the same milestone.
- The on-chain program is left as-is; no `ClaimRecord` migration.

## Consequences

**Positive**
- No breaking on-chain change, no account-data migration, no mainnet redeploy for this.
- Zero fund-loss risk (the under-count direction is the only possible outcome, proven by
  the `audit_claim3_*` schedule tests + the `OverClaim` guard).
- The BE guard is cheap and centralized on the two ingest routes.

**Negative / trade-offs**
- The **backend is the sole guardrail**. Any ingest path that bypasses `prepare`/`import`
  (a future admin tool, a direct DB write) must independently enforce the rule, or a
  multi-cliff/linear beneficiary will be silently under-served.
- **Frontend validation** is needed so a creator gets a clear error at form-submission time
  rather than a confusing under-claim later — this is a Geral (FE) handoff
  (`docs/KNOWN_ISSUE_29_DESIGN.md`).
- A campaign that genuinely needs to top up an existing beneficiary must do so via **root
  rotation** (`update_root`) with a single merged leaf, not by appending a second leaf.

## If we ever fix it on-chain
Per-leaf claimed tracking in `ClaimRecord` (e.g. a small map `leaf_index → claimed`, or a
per-leaf `ClaimRecord`). This is a layout-breaking change requiring a migration instruction
(resize + fill, or close + re-claim). Revisit only if the BE-guard limitation becomes
operationally painful.

## Supersession (2026-06-16) — on-chain fix shipped

Option A from `KNOWN_ISSUE_29_DESIGN.md` was implemented (the deferral was reversed).

**Chosen design** (differs from the design doc's `Vec<u64>` proposal):
- `ClaimRecord` converted to `#[account(zero_copy)]` (AccountLoader) with a **bounded per-leaf ledger**: `leaf_claimed_idx: [u32; 8]` + `leaf_claimed_amt: [u64; 8]` (+ `version: u8` + explicit pad bytes for `repr(C)`/bytemuck `Pod`). `PER_LEAF_CAP = 8`.
- The `Vec<u64>`+`realloc` proposal was rejected: no realloc pattern existed in the codebase (highest bug-risk), and it would couple account size to `tree.leaf_count` while `update_root` never touches ClaimRecord. The bounded parallel-array is leaf-count-independent, fixed-size, and needs **no change to `update_root`**.
- Claim math: `claimable = vested(leaf) − leaf_prior_claimed(leaf_index)`; milestone still uses the bitmap. `claimed_amount` stays the running sum (events + close read it).
- `total_entitled` now accumulates on first-touch-per-leaf for **all** release types (fixes the old under-count and SC-FIND-06's stale-after-rotation value).
- **Migration:** `zero_copy` lets a shorter legacy v0 account load by discriminator and be grown via `AccountInfo::resize` (solana-account-info 3.x) + rent top-up on next touch (`migrate_legacy_claim_record`). Pre-mainnet this is belt-and-suspenders (devnet accounts are disposable).

**Verification:** 125 SC tests pass / 0 fail / 19 ignored (Mollusk 0.14 set). New regression `test_claim_two_cliff_leaves_same_beneficiary_both_pay` proves both leaves pay in full (1,200 of 1,200 entitled). Claim CU measured 13,214 (within the 15,000 budget; CU_BUDGET.md updated).

**Follow-up (separate PR):** remove the now-obsolete `cliffLinearSeen` guards in `prepare/route.ts:70-84` and `import/route.ts:92-110` once the fix is deployed; keep the milestone duplicate guard.

## References
- `programs/vesting/src/instructions/claim.rs:103-122, 147` — cumulative accounting.
- `apps/web/src/app/api/campaigns/{prepare,import}/route.ts` — BE mitigation.
- `docs/week9/BUG_LIST.md` SC-#29 + MERKLE-FIND-04.
- `docs/KNOWN_ISSUE_29_DESIGN.md` — full design note.
