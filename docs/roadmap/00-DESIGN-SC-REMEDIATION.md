# SC Remediation — Technical Design

**Phase:** 00 (Pre-requisite)
**Blocks:** P0, F1-F4, P2
**Owner:** Lana (SC/BE lead)
**Estimate:** 2-3 days

---

## Summary

Fix the pause+cancel exploit by resetting `paused = false` inside `cancel_campaign`. Add defense-in-depth by allowing claims on cancelled+paused campaigns in `claim.rs` and `withdraw.rs`. Add 4 new tests covering the exploit sequence. Define trust boundaries for 4 unprotected API routes.

---

## Architecture

### The Exploit

```
pause_campaign  → tree.paused = true
cancel_campaign → tree.cancelled_at = Some(now), paused stays true
claim           → require(!tree.paused) → CampaignPaused ← BUG
unpause         → cancelled_at.is_none() constraint → CampaignCancelled ← also blocked
withdraw_unvested → only checks cancelled_at, not paused ← creator still wins
```

Beneficiary locked out during grace. Creator sweeps everything after 7 days.

### The Fix (two-layer)

**Layer 1 — Primary fix in `cancel_campaign.rs`:**
```rust
// After setting cancelled_at, reset paused
tree.cancelled_at = Some(cancelled_at);
tree.paused = false;  // ← new line
```

**Layer 2 — Defense in depth in `claim.rs` and `withdraw.rs`:**
```rust
// Current:
require!(!tree.paused, VestingError::CampaignPaused);

// Fixed: allow claims when campaign is cancelled (defense in depth)
require!(!tree.paused || tree.cancelled_at.is_some(), VestingError::CampaignPaused);
```

Layer 2 ensures that even if a future code change re-introduces the pause-on-cancel scenario, claims still work. It costs zero additional CU since both fields are already loaded.

### Cancel stream also affected

`cancel_stream.rs:82` has the same `require!(!tree.paused)` check. Apply Layer 2 there too. This is a creator-side operation but the fix ensures consistency.

---

## File Map

### Modified files (SC)

| File | Change |
|------|--------|
| `programs/vesting/src/instructions/cancel_campaign.rs` | Add `tree.paused = false` after setting `cancelled_at` |
| `programs/vesting/src/instructions/claim.rs` | Change pause guard to allow claims when cancelled (line 67) |
| `programs/vesting/src/instructions/withdraw.rs` | Same pause guard change (line 74) |
| `programs/vesting/src/instructions/cancel_stream.rs` | Same pause guard change (line 82) |

### New test cases (added to existing files)

| File | New tests |
|------|-----------|
| `tests/vesting.supplementary.spec.ts` | T69: pause→cancel→claim during grace = success |
| `tests/vesting.supplementary.spec.ts` | T70: cancel on paused campaign resets paused=false |
| `tests/vesting.clock.spec.ts` | Clock test: pause→cancel→claim at precise timestamps |
| `tests/security.spec.ts` | EXPLOIT 12: pause→cancel→claim exploit blocked |

---

## Key Decisions

### D1: Reset paused in cancel_campaign (not just defense-in-depth)

Resetting `paused = false` is the clean fix because:
- Cancelled campaigns should not be pausable (already enforced by `cancelled_at.is_none()` constraint)
- A paused+cancelled campaign is an inconsistent state
- Single-line change, no new error types needed

### D2: Defense-in-depth in claim/withdraw

Adding `|| tree.cancelled_at.is_some()` to the pause guard:
- Belt-and-suspenders approach
- Zero additional CU cost
- Protects against future regressions

### D3: PATCH /api/campaigns/[treeAddress]/status should be removed

This route writes `paused` and `cancelledAt` directly to DB without checking `pauseAuthority` or `cancelAuthority`. Recommendation:
- **Remove the route entirely**
- Status changes should come from on-chain events via the indexer (F2)
- If an immediate UI need exists, it should go through wallet-signed transaction endpoints (F3)

---

## Pseudocode

### cancel_campaign.rs fix

```rust
pub fn cancel_campaign(ctx: Context<CancelCampaign>) -> Result<()> {
    let tree = &mut ctx.accounts.vesting_tree;

    // Existing: record cancellation time
    let cancelled_at = Clock::get()?.unix_timestamp;
    tree.cancelled_at = Some(cancelled_at);

    // NEW: reset paused state so beneficiaries can claim during grace
    tree.paused = false;

    emit!(CampaignCancelled {
        tree: tree.key(),
        cancelled_at,
        claimed_at_cancel: tree.total_claimed,
    });
    Ok(())
}
```

### claim.rs defense-in-depth

```rust
// Line 67 - change from:
require!(!tree.paused, VestingError::CampaignPaused);
// to:
require!(
    !tree.paused || tree.cancelled_at.is_some(),
    VestingError::CampaignPaused
);
```

### Test: pause→cancel→claim

```typescript
it("T69: pause → cancel → claim during grace = success", async () => {
  // 1. Pause campaign
  await program.methods.pauseCampaign().accounts({...}).rpc();

  // 2. Cancel while paused
  await program.methods.cancelCampaign().accounts({...}).rpc();

  // 3. Verify paused reset
  const tree = await program.account.vestingTree.fetch(treeAddress);
  assert.equal(tree.paused, false);
  assert.ok(tree.cancelledAt);

  // 4. Advance time to mid-grace (3 days)
  await advanceTime(3 * 86400);

  // 5. Beneficiary claims - should succeed
  await program.methods.claim(proof, leaf).accounts({...}).rpc();

  // 6. Verify amount = vested at cancelled_at, not current time
  const expected = vestedAt(schedule, tree.cancelledAt.toNumber());
  assert.equal(beneficiaryBalance, expected);
});
```

---

## API Route Trust Boundaries

| Route | Current Auth | Recommended Auth | Lana's Role |
|-------|-------------|-----------------|-------------|
| `POST /api/campaigns` | None | Wallet signature (creator) | Define: verify creator owns the funding wallet |
| `POST /api/campaigns/.../root-versions` | None | Wallet signature (creator or delegate) | Define: verify authority matches campaign's root rotation config |
| `PATCH /api/campaigns/.../status` | None | **Remove route** | Define: status must come from on-chain indexer |
| `POST /api/claims/sync` | None | Admin key (existing pattern) | Define: acceptable as-is for trusted indexer |

---

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Fix changes CU cost enough to affect tx budget | Low | Low | `paused` field already loaded; boolean write is negligible CU |
| Paused reset breaks frontend that reads paused state | Low | Medium | Frontend should already handle cancelled state as superseding paused |
| Removing PATCH status route breaks existing FE flow | Medium | High | Coordinate with Geral; F3 clawback endpoints replace this route |
| Defense-in-depth logic is confusing to future auditors | Low | Low | Add inline comment explaining the two-layer protection |

---

## Testing Strategy

- **Unit (Rust):** Existing schedule.rs and merkle.rs tests unaffected. No new Rust unit tests needed.
- **Integration (TypeScript):** 4 new tests in existing test files covering pause→cancel→claim, cancel resets paused, clock-based precision, and exploit blocked.
- **Regression:** All 86 existing tests must pass unchanged.
- **Manual:** Redeploy to devnet and verify pause→cancel→claim flow via explorer.

---

## Requirement Trace

| Requirement | Where in this design |
|-------------|---------------------|
| US-1.1 Cancel resets paused | cancel_campaign.rs fix + D1 |
| US-1.2 Claim during grace after pause+cancel | claim.rs defense-in-depth + D2 |
| US-1.3 Cancel validations unchanged | cancel_campaign.rs — only new line is `tree.paused = false` |
| US-1.4 Unpause after cancel rejected | Already enforced by `cancelled_at.is_none()` constraint |
| US-1.5 withdraw.rs handles pause+cancel | withdraw.rs defense-in-depth |
| US-2.1 Pause→cancel→claim test | T69 in vesting.supplementary.spec.ts |
| US-2.2 Cancel resets paused test | T70 in vesting.supplementary.spec.ts |
| US-2.3 Grace period sweep safety | EXPLOIT 12 in security.spec.ts |
| US-2.4 Existing tests unchanged | Regression requirement — zero changes to existing tests |
| US-3.1 SC test matrix | Full re-run after fix |
| US-3.2 Clock tests with pause+cancel | New bankrun test in vesting.clock.spec.ts |
| US-4.1 Trust boundary definitions | API Route Trust Boundaries table |
