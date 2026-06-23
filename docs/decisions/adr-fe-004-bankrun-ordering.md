# ADR-FE-004: Bankrun warpToSlot Before setClock

**Status:** Accepted

## Context

Bankrun integration tests use `context.setClock()` to advance simulated time for vesting unlock logic. `setClock()` updates the Solana clock sysvar but does NOT advance the bank's blockhash ring. When two consecutive transactions carry identical instruction data and are submitted at the same slot, they produce the same Ed25519 signature (same message bytes = same signature). The Solana runtime rejects the second transaction as "Transaction already been processed" -- a deterministic (not flaky) failure on the 2nd and 3rd claims in progressive fractional claim tests.

## Decision

Always call `context.warpToSlot(nextSlot)` before `context.setClock()` in the `warpClock()` helper at `tests/utils/bankrun.ts`. The slot increment produces a new blockhash-ring entry, ensuring subsequent transactions have a distinct `recentBlockhash` and therefore a different signature even when instruction data is identical.

## Consequences

**Positive:**
- All bankrun integration tests are deterministic. Progressive fractional claims, multi-checkpoint `withdraw`, and multi-step milestone vesting tests pass consistently across all environments.
- `warpClock()` in `tests/utils/bankrun.ts` is the single authoritative utility for time manipulation. Callers must not call `setClock()` directly.

**Negative:**
- The slot increment (1 slot is approximately 400ms simulated time) has no material effect on vesting math in existing tests.

## Alternatives Considered

- **`MOCHA_RETRIES=2`:** The failure is deterministic, so retrying the same slot produces the same failure. Retries hide the bug rather than fixing it.
- **Add a nonce to instruction data:** Would make transactions unique but pollutes the instruction interface with test-only fields.
- **Random `recentBlockhash`:** Not possible in bankrun; the blockhash must come from the bank's ring.
