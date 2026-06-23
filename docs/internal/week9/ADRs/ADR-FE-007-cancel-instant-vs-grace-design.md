# ADR-FE-007: Cancel Design — Instant Settle vs Grace Period

**Status:** Active
**Date:** 2026-05-26 (decided); documented 2026-06-19
**Owner:** Geral + Lana (joint)

## Context

Velthoryn supports two cancellation paths. The question was: what determines which path
a campaign uses, and should any multi-leaf campaign be able to use instant settle?

### Current SC constraints (at time of decision)

**`cancel_stream` (Instant Settle)**
- Hard constraint in SC: only executes if `vesting_tree.leaf_count == 1`.
- FE also gates it: only shows "Instant Settle" if `leafCount === 1`.
- On execution: vested portion → beneficiary immediately; unvested → creator immediately.
- Single milestone case: if released, beneficiary gets amount; if unreleased, beneficiary gets 0.

**`cancel_campaign` (Grace Period)**
- Used when `leaf_count > 1`.
- Covers: bulk cliff, bulk linear, bulk milestone.
- **Also covers**: single beneficiary / multi-milestone campaigns (e.g. 3 milestone leaves for one wallet), because they are still `leaf_count > 1`.
- After cancel: vested/released amount frozen at cancellation timestamp.
- Beneficiaries have **7 days** to claim their vested portion.
- After 7 days: creator can `withdraw_unvested` the remaining balance.

### The ambiguity

If a bulk campaign has **not started yet**, all claimable balances are 0. UX expectation:
creator presses cancel → funds return immediately.

But current SC still enforces the full 7-day grace period even when every beneficiary has
`claimable = 0`. Creator must wait 7 days to reclaim funds from a campaign that never
vested a single token.

## Options Considered

**Option A — Keep current design:**
- `leaf_count == 1` → Instant Settle
- `leaf_count > 1` → Grace Period (always, regardless of vested state)

*Pro:* No SC changes. No new test matrix.
*Con:* Poor UX for "cancel before cliff" bulk campaigns.

**Option B — Add special instant-settle path for multi-leaf:**
Two sub-options:
1. Instant cancel if zero vested/released leaves across the entire campaign.
2. Single-beneficiary multi-milestone campaigns can always instant-settle.

*Pro:* Better UX for creators who cancel early.
*Con:* Requires new SC instruction (current `cancel_stream` only supports `leaf_count == 1`).
The "zero claimable leaves" check requires iterating all leaves or a new SC design.
Not trivial — adds SC surface area + regression risk before launch.

## Decision

**Option A for launch.**

- Keep `leaf_count == 1` as the exact boundary for instant settle.
- No SC changes required.
- FE UI copy must be explicit: multi-leaf campaigns always use grace period, including
  campaigns not yet started.

Option B deferred to post-launch. If implemented later, the most reasonable path is a new
instruction (`instant_cancel_if_unvested`) rather than patching `cancel_stream`, because
`cancel_stream` currently encodes the single-leaf assumption at the SC level.

## Consequences

**For FE:**
- Show "Instant Settle" UI only when `leafCount === 1`.
- Show "Cancel with 7-day Grace" for all other campaigns.
- Add copy clarifying that cancellation freezes vesting at the current moment and the
  7-day grace applies even if no tokens have vested yet.

**For users:**
- A creator who funds a bulk campaign and then cancels before any cliff time must still
  wait 7 days to recover their tokens. This is a known UX friction point.

**Future maintainers:**
- If adding an "instant cancel when unvested" path, it requires a new SC instruction and
  a new test matrix — do not try to wedge it into the existing `cancel_stream` path.

## References

- `programs/vesting/src/instructions/cancel_stream.rs` — single-leaf constraint
- `programs/vesting/src/instructions/cancel_campaign.rs` — 7-day grace enforcement
- `apps/web/src/app/(app)/campaign/[id]/page.tsx` — FE leafCount gate
- `apps/web/src/lib/api/tx-builder.ts` — `cancelStreamBuilder` vs `cancelCampaignBuilder`
- [ADR-003](ADR-003-issue-29-deferred-on-chain-fix.md) — related deferred on-chain work
- `research-docs/week6/talk-to-lana.md` — original design discussion (gitignored)
