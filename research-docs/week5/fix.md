# Fix Plan - Security and UX Issues

Prioritized fixes from security audit and comparison with Sablier/Streamflow.

---

## P0 - Critical Security

### FIX-1: Pause + Cancel Exploit (Program Change)

**Problem:** Creator can take all tokens (including vested portion meant for recipients) by combining pause and cancel. Recipients are blocked from claiming during the entire grace period because pause is never lifted.

**Attack Flow:**
1. Creator calls pause_campaign (recipients cannot claim)
2. Creator calls cancel_campaign (grace period 7 days starts, but pause NOT reset)
3. 7 days pass (recipients still cannot claim because paused = true)
4. Creator calls withdraw_unvested (takes everything remaining in vault)

**Root Cause:**
- cancel_campaign does not check or reset the paused flag
- claim instruction is blocked when paused = true, even after cancellation
- withdraw_unvested does not check paused state

**Fix Options:**

- Option A (Recommended): In cancel_campaign handler, add `tree.paused = false` so recipients can claim during grace
- Option B: In claim handler, allow claiming when campaign is cancelled regardless of pause state
- Option C: Both A and B for defense in depth

**Impact:** Smart contract change. Requires redeploy to devnet, IDL regeneration, and test updates.

**Tests needed:**
- Pause then Cancel then Claim should succeed (recipient can claim during grace)
- Cancel should reset paused flag to false
- Pause then Cancel then Wait grace then Withdraw should NOT include vested tokens that recipients could have claimed

**Severity:** HIGH - allows creator to steal recipient funds

---

## P1 - Important UX/Logic

### FIX-2: Sender + Recipient Label Bug (Frontend)

**Problem:** Campaign list page shows "Sender + Recipient" badge for campaigns where the connected wallet is ONLY a recipient. This confuses users about their role.

**Root Cause:** useLocalCampaigns hook saves campaign data to localStorage keyed only by tree address (not wallet-specific). When user switches wallets in the same browser, old localStorage entries cause the campaign to appear in both sender and recipient lists.

**Fix:** Filter localCampaigns.senderCampaigns by verifying `campaign.creator === connectedWalletAddress` before merging into the combined list. Alternatively, namespace localStorage keys with wallet address.

**Impact:** Frontend only. No program change needed.
**Effort:** 1 hour

---

### FIX-3: Multi-leaf Same Beneficiary Warning (Frontend)

**Problem:** If a campaign was created with the same beneficiary address appearing in multiple leaves (before our CSV duplicate validation was added), only the first leaf can be successfully claimed. Subsequent claims fail because the single ClaimRecord PDA is already at max for that leaf.

**Root Cause:** Program design uses 1 ClaimRecord PDA per (tree, beneficiary) pair. This is intentional but the UI should warn users.

**Fix:**
- Already done: CSV parser now rejects duplicate beneficiary addresses
- Additional: Show warning message in campaign detail page when API returns multiple leaves for the same beneficiary
- Message: "This campaign has multiple allocations for your wallet which cannot all be claimed due to program constraints."

**Impact:** Frontend only.
**Effort:** 30 minutes

---

### FIX-4: Claim Sync to DB Reliability (Frontend/Backend)

**Problem:** After a successful on-chain claim, the frontend POSTs the transaction signature to /api/claims/sync to update the database. This request can fail silently due to network issues or RPC lag, leaving the campaign list showing stale "Claimable" status.

**Fix:**
- Add retry logic (3 attempts with exponential backoff) around the claim sync fetch call
- Create a PendingClaimIndexer provider component (similar to existing PendingCampaignIndexer) that stores failed sync signatures in localStorage and retries on next page load
- Fallback already exists: campaign detail page reads totalClaimed from on-chain state directly

**Impact:** Frontend only.
**Effort:** 1 hour

---

## P2 - Nice-to-Have

### FIX-5: Root Rotation Warning (Frontend)

**Problem:** The update_root instruction changes the Merkle root on-chain, which immediately invalidates all existing proofs. Recipients who have not yet claimed will be unable to claim until new proofs are indexed in the database.

**Fix:** Add a confirmation dialog in the RootRotationCard component before submitting the transaction. Warning text: "This will invalidate all existing proofs. Recipients will not be able to claim until new leaf data is indexed. Are you sure?"

**Impact:** Frontend only.
**Effort:** 30 minutes

---

### FIX-6: Clock Manipulation Awareness (Frontend + Documentation)

**Problem:** Solana on-chain clock can drift up to 25 seconds from real time. For vesting schedules with very short durations (under 1 minute), this could cause tokens to appear vested or unvested at unexpected times.

**Fix:**
- Add minimum duration validation in the create stream UI: cliff/end time must be at least 60 seconds after start time
- Add a note in docs/SECURITY.md explaining this limitation

**Impact:** Frontend validation + documentation.
**Effort:** 15 minutes

---

### FIX-7: Pause Authority Griefing Awareness (Documentation + UI)

**Problem:** If pause_authority is set to a different address than the creator or cancel_authority, that pause authority can indefinitely block all claims without the creator or cancel authority being able to intervene (since unpause requires the same pause_authority).

**Fix:**
- Document this trust assumption in docs/SECURITY.md
- In the campaign detail page, show a subtle warning icon when pause_authority differs from creator
- Consider for future program version: add maximum pause duration or allow cancel_authority to force-unpause

**Impact:** Documentation + minor UI indicator.
**Effort:** 15 minutes

---

## Implementation Order

| Priority | Fix | Type | Effort | Dependency |
|----------|-----|------|--------|------------|
| 1 | FIX-1 Pause+Cancel exploit | Program (Rust) | 30 min | Lana approval needed |
| 2 | FIX-2 Role label bug | Frontend | 1 hr | None |
| 3 | FIX-4 Claim sync retry | Frontend | 1 hr | None |
| 4 | FIX-3 Multi-leaf warning | Frontend | 30 min | None |
| 5 | FIX-5 Root rotation dialog | Frontend | 30 min | None |
| 6 | FIX-6 Clock min duration | Frontend + Docs | 15 min | None |
| 7 | FIX-7 Pause authority docs | Docs + UI | 15 min | None |

---

## Summary

- 1 critical security issue (FIX-1) that must be fixed before any mainnet consideration
- 3 important UX fixes (FIX-2, FIX-3, FIX-4) that improve user experience
- 3 nice-to-have improvements (FIX-5, FIX-6, FIX-7) for polish and documentation
- Total estimated effort: approximately 4 hours
- Only FIX-1 requires smart contract modification (Lana's domain)
- All other fixes are frontend-only and can be done in parallel
