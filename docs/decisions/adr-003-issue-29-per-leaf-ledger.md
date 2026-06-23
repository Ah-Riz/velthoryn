# ADR-003: Issue #29 -- Per-Leaf Ledger in ClaimRecord

**Status:** Accepted

{% hint style="info" %}
This ADR was originally titled "defer the on-chain fix, mitigate at the backend" (2026-06-14). The on-chain fix was subsequently implemented on 2026-06-16. This document is retained for historical context.
{% endhint %}

## Context

A beneficiary can appear in more than one cliff/linear leaf of the same Merkle tree (e.g., two separate allocations). On-chain, a beneficiary has exactly one `ClaimRecord` PDA per campaign (seeded `[b"claim", vesting_tree, beneficiary]`), whose `claimed_amount` is cumulative across all leaves, while `vested()` is computed per leaf.

For a beneficiary with two fully-vested linear leaves of amount A each:
1. Claim leaf 1: `claimable = vested(leaf1) - claimed_amount(0) = A`; `claimed_amount = A`.
2. Claim leaf 2: `claimable = vested(leaf2) - claimed_amount(A) = 0` -> `NothingToClaim`.

The beneficiary receives A instead of 2A -- an under-count, never an over-count. Two independent guards make overspend impossible: the per-beneficiary `saturating_sub` on `claimed_amount`, and the global `require!(new_total <= total_supply, OverClaim)`.

This is a fairness/availability bug, not a fund-safety bug.

## Decision

**Original decision (2026-06-14):** Defer the on-chain fix. Mitigate at the backend by rejecting any campaign ingest that assigns more than one cliff/linear leaf to the same beneficiary. Milestone leaves (release_type 2) are exempt because `milestone_bitmap` prevents double-claiming.

**Revised decision (2026-06-16):** The on-chain fix was implemented. `ClaimRecord` is now `#[account(zero_copy)]` with a bounded per-leaf ledger:
- `leaf_claimed_idx: [u32; 8]` + `leaf_claimed_amt: [u64; 8]` (+ `version: u8` + explicit pad bytes for `repr(C)`/bytemuck `Pod`).
- `PER_LEAF_CAP = 8`.
- Claim math: `claimable = vested(leaf) - leaf_prior_claimed(leaf_index)`.
- `total_entitled` now accumulates on first-touch-per-leaf for all release types.

The `Vec<u64>` + realloc proposal was rejected: no realloc pattern existed in the codebase, and it would couple account size to `tree.leaf_count` while `update_root` never touches ClaimRecord.

## Consequences

**Positive:**
- Both leaves now pay in full (verified: 1,200 of 1,200 entitled in regression test).
- No breaking on-chain change for the bounded-array approach; fixed-size accounts.
- No change needed to `update_root`.
- Backend guards (`cliffLinearSeen`) are now obsolete and slated for removal.

**Negative:**
- Per-leaf cap of 8 means a beneficiary with more than 8 distinct leaves in one campaign would hit a limit. This is unlikely in practice.
- `zero_copy` requires explicit `repr(C)` layout and bytemuck `Pod`, which is more complex than standard Borsh serialization.
- Legacy v0 accounts require migration via `AccountInfo::resize` on next touch.

## Alternatives Considered

- **Backend-only mitigation (original Option B):** Reject multi-leaf cliff/linear at ingest. Simple but makes the backend the sole guardrail; any bypass path silently under-serves beneficiaries.
- **`Vec<u64>` + realloc (Option A variant):** Dynamic per-leaf tracking. Rejected due to no existing realloc pattern, coupling to `leaf_count`, and higher bug risk.
- **Separate ClaimRecord per leaf:** One PDA per `(tree, beneficiary, leaf_index)`. Correct but expensive in rent and requires changes to every claim/close path.
