# ADR-FE-007: Cancel Design -- Instant Settle vs Grace Period

**Status:** Accepted

## Context

Velthoryn supports two cancellation paths. The question was: what determines which path a campaign uses, and should any multi-leaf campaign be able to use instant settle?

### Current SC Constraints

**`cancel_stream` (Instant Settle):**
- Hard constraint in SC: only executes if `vesting_tree.leaf_count == 1`.
- FE gates it: only shows "Instant Settle" if `leafCount === 1`.
- On execution: vested portion goes to beneficiary immediately; unvested goes to creator immediately.

**`cancel_campaign` (Grace Period):**
- Used when `leaf_count > 1`.
- Covers bulk cliff, bulk linear, bulk milestone, and single-beneficiary multi-milestone campaigns (still `leaf_count > 1`).
- After cancel: vested/released amount frozen at cancellation timestamp.
- Beneficiaries have 7 days to claim their vested portion.
- After 7 days: creator can `withdraw_unvested` the remaining balance.

### The Ambiguity

If a bulk campaign has not started yet, all claimable balances are 0. UX expectation: creator presses cancel and funds return immediately. But the current SC still enforces the full 7-day grace period even when every beneficiary has `claimable = 0`. Creator must wait 7 days to reclaim funds from a campaign that never vested a single token.

## Decision

**Keep the current design for launch (Option A):**
- `leaf_count == 1` is the exact boundary for instant settle.
- No SC changes required.
- FE UI copy must be explicit: multi-leaf campaigns always use grace period, including campaigns not yet started.

Option B (special instant-settle path for multi-leaf campaigns) is deferred to post-launch. If implemented, the most reasonable path is a new instruction (`instant_cancel_if_unvested`) rather than patching `cancel_stream`.

## Consequences

**Positive:**
- No SC changes required for launch.
- Clear, simple rule: single-leaf = instant, multi-leaf = grace.
- No new test matrix or regression risk.

**Negative:**
- A creator who funds a bulk campaign and then cancels before any cliff time must still wait 7 days to recover their tokens. This is a known UX friction point.
- FE must add copy clarifying that the 7-day grace applies even if no tokens have vested.

## Alternatives Considered

- **Instant cancel if zero vested/released (Option B1):** Better UX for early cancellations but requires a new SC instruction. The "zero claimable leaves" check requires iterating all leaves or a new SC design. Not trivial -- adds surface area and regression risk.
- **Single-beneficiary multi-milestone instant-settle (Option B2):** Allow instant settle for campaigns where `leaf_count > 1` but all leaves belong to one beneficiary. Requires additional on-chain logic and does not generalize to multi-beneficiary cases.
- **Configurable grace period:** Allow creators to set the grace period (1 day to 30 days) at campaign creation. Deferred to post-launch roadmap.
