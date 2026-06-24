# Velthoryn Protocol — Known Gaps & Design Constraints

**Scope:** On-chain program (`programs/vesting/`) and frontend (`apps/web/`)
**Last updated:** 2026-06-24
**Author:** Internal audit — Geral / Claude Code

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ✅ SOLVED | Fixed in code, verified |
| 🔶 MITIGATED | Frontend guard added; on-chain fix still required for full protection |
| 🔴 OPEN — Critical | Exploitable or causes silent data loss without on-chain change |
| 🟡 OPEN — Moderate | UX/trust degradation, workaround exists |
| ⚪ CAP | Hard protocol limit by design, not a bug |
| 📋 DEFERRED | Documented in ADR, accepted for launch, queued for post-launch |

---

## Quick Summary Table

| ID | Title | Status | Requires On-chain |
|----|-------|--------|-------------------|
| [G-S1](#g-s1) | Allocation editor 60-recipient silent cap | ✅ SOLVED | No |
| [G-S2](#g-s2) | `hasAnyClaim` uses DB indexer (lag) | ✅ SOLVED | No |
| [G-S3](#g-s3) | Submit button visible when locked | ✅ SOLVED | No |
| [G-S4](#g-s4) | releaseType change silently corrupts schedule | ✅ SOLVED | No |
| [G-M1](#g-m1) | Root rotation rug pull (pre-first-claim) | 🔶 MITIGATED | Yes |
| [G-01](#g-01) | No hybrid cliff+linear in one leaf | 🔴 OPEN | Yes |
| [G-02](#g-02) | `cancel_stream` zero warning / no notice period | 🔴 OPEN | Yes |
| [G-03](#g-03) | Milestone approval — trust-me-bro model | 🔴 OPEN | Yes |
| [G-04](#g-04) | Zero cancel cooldown | 🔴 OPEN | Yes |
| [G-05](#g-05) | Grace period inconsistency (7d vs atomic) | 🟡 OPEN | Yes |
| [G-06](#g-06) | 7-day grace period too short | 🟡 OPEN | Yes |
| [G-07](#g-07) | Linear `cliffTime` naming misleading | 🟡 OPEN | No (docs+UI) |
| [G-08](#g-08) | `total_supply` immutable — no top-up | 🟡 OPEN | Yes |
| [G-09](#g-09) | Root rotation trust model undocumented to recipients | 🟡 OPEN | No (docs + UI) |
| [G-10](#g-10) | Allocation Editor: schedule fields invisible / uneditable | 🟡 OPEN | No |
| [G-11](#g-11) | Allocation Editor: new rows allow release type mismatch | 🟡 OPEN | No |
| [G-C1](#g-c1) | PER_LEAF_CAP = 8 cliff/linear leaves max | ⚪ CAP | — |
| [G-C2](#g-c2) | Max 256 milestones per beneficiary | ⚪ CAP | — |
| [G-C3](#g-c3) | No bulk claim instruction | ⚪ CAP | — |
| [G-C4](#g-c4) | `startTime` stored but never used in math | ⚪ CAP | — |
| [G-D1](#g-d1) | Multi-leaf instant cancel deferred | 📋 DEFERRED | Yes |

---

## Solved Gaps

### G-S1
**Allocation editor 60-recipient silent cap** — ✅ SOLVED

**What was wrong:**
`AllocationEditor` fetched leaf data by looping `N` sequential calls to
`/api/campaigns/[treeAddress]/proof?beneficiary=X&all=true`.
That endpoint has `rateLimit: { requests: 60, window: 60 }`.
After 60 calls the 61st returned HTTP 429, but the code did `if (!res.ok) continue` — silently
dropping the remaining 940 recipients. The editor loaded exactly 60 rows every time.

**Fix applied:**
Created `/api/campaigns/[treeAddress]/leaves` — a single DB query that returns all leaves for the
latest root version. `AllocationEditor` now makes one call regardless of recipient count.

**Files changed:**
- `apps/web/src/app/api/campaigns/[treeAddress]/leaves/route.ts` — new endpoint
- `apps/web/src/app/(app)/campaign/[id]/allocations/page.tsx` — replaced loop with single fetch

---

### G-S2
**`hasAnyClaim` uses DB indexer (lag vulnerability)** — ✅ SOLVED

**What was wrong:**
```typescript
const hasAnyClaim = (detail?.analytics.claimCount ?? 0) > 0;
```
`claimCount` comes from the DB indexer. If the indexer lags (common under high load), `claimCount`
could be `0` while on-chain `total_claimed > 0`. An admin could accidentally submit a root
rotation inside this window, excluding recipients who had already claimed.

**Fix applied:**
`OnChainTreeState` now includes `totalClaimed: BN`, fetched directly from the `VestingTree` PDA.
`hasAnyClaim` uses on-chain as primary, DB as fallback:
```typescript
const hasAnyClaim =
  (treeState?.totalClaimed?.gtn(0) ?? false) ||
  (detail?.analytics.claimCount ?? 0) > 0;
```
A fresh on-chain re-check also runs inside `handleSubmit` immediately before sending the
`update_root` transaction, closing the remaining race window.

**Files changed:**
- `apps/web/src/app/(app)/campaign/[id]/allocations/page.tsx`

---

### G-S3
**Submit button visible when `lockedReason` is set** — ✅ SOLVED

**What was wrong:**
`canRotate` (wallet authority check) and `lockedReason` (semantic lock — e.g. "claims exist") were
decoupled in `AllocationEditor`. When `canRotate = true` but `lockedReason` was set, the lock
header showed amber ("Locked: claims already exist") but the **Update Allocations button was still
rendered and clickable**.

**Fix applied:**
```tsx
// Before
{canRotate && <Button ... />}

// After
{canRotate && !lockedReason && <Button ... />}
{(!canRotate || lockedReason) && <p>{lockedReason}</p>}
```

**Files changed:**
- `apps/web/src/components/campaign/detail/AllocationEditor.tsx`

---

### G-S4
**`releaseType` change silently corrupts vesting schedule** — ✅ SOLVED

**What was wrong:**
The `AllocationEditor` showed a `<select>` for `releaseType` on all rows including existing DB
rows. The schedule fields (`startTime`, `cliffTime`, `endTime`, `milestoneIdx`) are hidden in the
UI — changing `releaseType` left stale schedule data for the new type.

Concrete consequences:
- Cliff → Linear: `endTime = cliffTime` → degenerate linear (vests instantly at cliffTime)
- Any → Milestone: admin must call `set_milestone_released` separately or recipients can never claim
- Multi-leaf Milestone → Cliff/Linear: rejected by prepare API (Known Issue #29 guard)

**Fix applied:**
Rows that came from the DB are stored in `existingRowIds: Set<string>`. For those rows,
`releaseType` renders as a read-only colored badge with a tooltip explaining how to change it
(remove → re-add with correct schedule). Only newly added rows show the editable `<select>`.

**Files changed:**
- `apps/web/src/components/campaign/detail/AllocationEditor.tsx`

---

## Partially Mitigated

### G-M1
**Root rotation rug pull (admin can redirect allocations before first claim)** — 🔶 MITIGATED (frontend), on-chain fix required

**The problem:**
`update_root.rs` has no constraint preventing an admin from replacing the entire Merkle tree with
one that only contains the admin's own wallet. On-chain guards:
```rust
constraint = vesting_tree.cancellable @ VestingError::NotCancellable,
constraint = vesting_tree.cancelled_at.is_none() @ VestingError::CampaignCancelled,
constraint = vesting_tree.cancel_authority == Some(cancel_authority.key()) @ VestingError::Unauthorized,
```
None of these prevent the new tree from being structured arbitrarily. The program accepts any
valid Merkle root regardless of what changed inside it.

This is intentional in the current `cancellable = true` trust model, but it means:
- `cancellable = true` campaigns give the admin unilateral rug-pull capability via direct RPC call
- Frontend guards (`hasAnyClaim`, pre-submit re-check) are bypassable by anyone who calls
  `update_root` directly

**Frontend mitigations applied (G-S2 + G-S3):**
1. `hasAnyClaim` now reads on-chain `totalClaimed` — immune to indexer lag
2. Pre-submit re-check fetches fresh on-chain state immediately before TX
3. Submit button hidden when any lock reason present

**Why this is not fully fixed:**
A malicious admin with `cancel_authority` can call `update_root` via any Solana client (Anchor,
web3.js, CLI) — all frontend checks are bypassed entirely.

**Comparison with Sablier V2:**
Sablier separates "cancel" (stop + return unvested) from "edit" (modify amounts/schedule).
Sablier schedules are immutable after creation. Cancellation only returns *unvested* tokens;
*vested* tokens always belong to the recipient. Velthoryn's `update_root` has no such guarantee.

**Required on-chain fix:**
```rust
// In update_root.rs handler(), add:
require!(tree.total_claimed == 0, VestingError::ClaimsExist);
```
Effect: once any recipient claims any amount, the tree is permanently frozen — no root rotation
possible. This mirrors the Sablier model: `cancellable = true` becomes "cancel only" after
the first claim lands, not "edit anything forever".

**Note:** This is a breaking change to the protocol and requires a program upgrade + redeploy.
Discuss before implementing.

---

## Open Gaps — Critical

### G-01
**No hybrid cliff+linear in one leaf** — 🔴 OPEN

**Description:**
The most common equity vesting schedule in the industry is "25% at 1-year cliff, then 75% linear
over 3 years." This cannot be expressed in a single `VestingLeaf` because:
- `releaseType = 0` (Cliff): releases 100% at `cliffTime`, ignores `endTime`
- `releaseType = 1` (Linear): releases 0% before `cliffTime`, then linearly to `endTime`

There is no `releaseType` that does "X% at cliff + (100-X)% linear."

**Workaround:** Create two campaigns for the same mint/creator — one Cliff (25%), one Linear (75%).
Beneficiary must claim from both. This adds UX friction and doubles campaign management overhead.

**Comparison:** Streamflow natively supports `cliffAmount` (tokens unlocked at cliff date) + linear
stream for the remainder in a single contract. Velthoryn has no equivalent.

**Required fix:**
New `releaseType = 3` (Hybrid) with an additional `cliffAmount: u64` field in `VestingLeaf`.
Requires: new leaf layout (bumps from 70 to 78 bytes), new `encodeLeaf`, new `schedule::vested`
branch, updated `prepareCampaign`, updated CSV parser, updated UI. Major version change.

---

### G-02
**`cancel_stream` executes with zero warning** — 🔴 OPEN

**Description:**
`cancel_stream` (single-leaf campaigns, `leaf_count == 1`) is atomic — no grace period, no notice
period. The creator calls the instruction and tokens split instantly. The beneficiary has no
advance warning; they discover the cancellation only when they try to claim or notice their
wallet balance changed.

For real-world use cases (employee equity vesting, DAO contributor grants) this is problematic.
An employee could be terminated and have their stream cancelled without any prior notification
via on-chain mechanism.

**Current state:** ADR-FE-007 documents this as a known asymmetry (cancel_campaign has 7d grace,
cancel_stream has none). Deferred to post-launch.

**Frontend-only mitigation (not implemented):** Could email/notify beneficiaries when their
stream is cancelled, but this requires off-chain infrastructure and is not protective.

**Required on-chain fix:**
Add a two-step cancel for `cancel_stream`:
1. `request_cancel_stream` — sets a `cancel_requested_at` timestamp, emits event
2. `execute_cancel_stream` — only callable after `cancel_requested_at + NOTICE_PERIOD` seconds

This matches the Sablier V2 "recipient-protected cancellation" model. The notice period could be
a creator-configurable parameter set at stream creation (e.g., 48 hours minimum).

---

### G-03
**Milestone approval is a trust-me-bro model** — 🔴 OPEN

**Description:**
Milestone vesting requires the campaign creator to manually call `set_milestone_released` to flip
a bit in `milestone_released_flags` before any beneficiary can claim that milestone.

From `claim.rs:171-175`:
```rust
require!(
    milestone_flag_is_set(&tree.milestone_released_flags, leaf.milestone_idx),
    VestingError::MilestoneNotReleased
);
```

This means:
- A beneficiary who completes 100% of a milestone deliverable has zero on-chain recourse if the
  creator refuses to call `set_milestone_released`
- No dispute mechanism exists
- No third-party verifier or oracle integration exists
- No time-based fallback (e.g., "auto-release after 30 days if not disputed")

The `cliffTime` in a milestone CSV is purely advisory — it represents the *intended* release
schedule, not a guaranteed on-chain trigger.

**Required fix options (in order of complexity):**
1. **(Minimal)** Add a time-based auto-release: if `now >= cliffTime + DISPUTE_WINDOW` and
   creator has not explicitly *blocked* the milestone, it auto-releases. Creator action is now
   opt-out (block) rather than opt-in (approve).
2. **(Medium)** Add a multi-sig or DAO governance mechanism for milestone approval.
3. **(Full)** Integrate an oracle (e.g., Pyth, Chainlink) to trigger milestone release based on
   verifiable off-chain events.

---

### G-04
**Zero cancel cooldown — rug vector** — 🔴 OPEN

**Description:**
There is no minimum lock period before `cancel_stream` or `cancel_campaign` can be called.
A creator can fund a campaign with real tokens, allow recipients to see it, and cancel it
1 minute later. No on-chain mechanism prevents this.

This is distinct from G-02 (no notice) — G-04 is about the ability to cancel immediately
after creation at all.

**Required on-chain fix:**
Add `min_lock_period: i64` to `VestingTree`, set at creation. Enforce in `cancel_stream` and
`cancel_campaign`:
```rust
require!(
    now >= tree.created_at + tree.min_lock_period,
    VestingError::CancelCooldownActive
);
```
The `min_lock_period` could default to 0 (current behavior) or be enforced as a minimum
(e.g., `min_lock_period >= 24 * 60 * 60` = 1 day minimum).

---

## Open Gaps — Moderate

### G-05
**Grace period inconsistency: 7 days vs atomic** — 🟡 OPEN

**Description:**
```
cancel_campaign (leaf_count > 1): 7-day grace period → beneficiaries can claim vested tokens
cancel_stream   (leaf_count == 1): atomic → immediate split, no grace period
```
This is logically inverted. A single-beneficiary stream is in a weaker position (one person, no
collective action, likely a long-term grant) but gets *less* protection than bulk campaigns.

**Reference:** ADR-FE-007 documents this as accepted for launch. A `GRACE_PERIOD_SECS` constant
(`7 * 24 * 60 * 60 = 604800`) is defined in `constants.rs` but only used for `cancel_campaign`.

**Required fix:**
Implement a notice/grace period for `cancel_stream` (see G-02 above). The same `GRACE_PERIOD_SECS`
constant could be reused or a shorter stream-specific grace period added.

---

### G-06
**7-day grace period is too short for real-world use** — 🟡 OPEN

**Description:**
`GRACE_PERIOD_SECS = 7 * 24 * 60 * 60` (7 days) is the window during which beneficiaries can
claim their vested amount after `cancel_campaign` is called.

Industry comparison:
- Streamflow: 14 days minimum recommended
- Valhalla: 30 days
- Sablier: configurable, defaults 30 days
- Juicebox: no cancel capability

Solana notification infrastructure is immature — most users don't monitor wallet events daily.
7 days is insufficient for users who check infrequently (vacation, illness, timezone differences
in global teams). If a beneficiary misses the window, their vested tokens become unclaimable.

**Required fix:**
Change `GRACE_PERIOD_SECS` from 7 days to at least 14 days (recommendation: 30 days). This is a
1-line change in `constants.rs` but requires a program redeploy. Alternatively, make the grace
period creator-configurable at campaign creation time with an enforced minimum.

---

### G-07
**Linear `cliffTime` naming is misleading** — 🟡 OPEN (docs + UI)

**Description:**
In a Linear (`releaseType = 1`) leaf, `cliffTime` is not a "cliff" in the traditional equity
vesting sense. The standard industry meaning of "cliff" is "a portion of tokens unlock immediately
at this date." In Velthoryn Linear:

```rust
1 => {
    if now >= leaf.end_time { return leaf.amount; }
    if now <= leaf.cliff_time { return 0; }  // 0%, not partial unlock
    // ... linear interpolation from cliffTime to endTime
}
```

`cliffTime` in Linear means "**vesting start time** — the date before which 0 tokens are
accessible." The distinction matters when explaining the protocol to users and auditors.

`startTime` makes this more confusing: it is stored in the leaf but **never read** by
`schedule::vested()` — proptest `start_before_cliff_same_as_start_eq_cliff` explicitly proves
this. It exists only in the leaf byte layout for potential future use.

**Fix:** No on-chain change needed.
- Rename UI label: "Cliff Date" → "Vesting Start" for Linear and Milestone types
- Update CSV column header documentation and campaign creation wizard copy
- Add a glossary section to the public docs clarifying the behavioral difference

---

### G-09
**Root rotation trust model undocumented to recipients** — 🟡 OPEN (docs + UI)

**Description:**
When a campaign has `cancellable = true`, a recipient's allocation is **not guaranteed on-chain
until the first claim is made** (or until G-M1's `total_claimed == 0` guard is added on-chain).
Before that event, the cancel authority can silently change any recipient's wallet, amount, or
remove them entirely from the Merkle tree. Neither the campaign detail page, the allocation editor,
nor any public documentation communicates this trust boundary to recipients.

**Connection to user research (Week 2 BD validation):**
Ferdinand's pain point: *"Ga dibilang ada vesting dan tiba-tiba ada vesting jadi kecewa aja"* —
recipients are already upset about undisclosed vesting terms. Undisclosed mutability is the same
class of problem, but worse: the allocation itself (not just the schedule) can change without
notification. The BD report's core finding is that *"both project teams and contributors are
operating on faith rather than verifiable on-chain guarantees"* — G-09 is the gap between that
promise and reality.

**Comparison with Sablier / Streamflow:**
Sablier guarantees allocation from block 0 of stream creation — no editability window.
Velthoryn's `cancellable = true` model is closer to a *pre-launch allocation proposal*
than a *finalized vesting grant* until the first claim locks the tree.

**Required fix (no on-chain change needed):**
1. **Campaign detail page:** Add disclosure banner for `cancellable = true` campaigns:
   > *"Allocations for this campaign may be updated by the cancel authority until the first
   > claim is made. After any recipient claims, the allocation list is permanently frozen."*
2. **Campaign creation wizard:** Add a "What does Cancellable mean?" tooltip that includes
   the above disclosure alongside the cancel authority field.
3. **Public docs:** Add a "Trust Model" section to `docs/operations/root-rotation.md` that
   explicitly states the pre-first-claim mutability window and compares it to Sablier's model.

**Note:** G-09 becomes partially self-healing once G-M1's on-chain fix is in place, because the
UI disclosure will match reality more precisely. But documentation is independently valuable
regardless of G-M1 status.

---

### G-10
**Allocation Editor — per-recipient schedule fields invisible and uneditable** — 🟡 OPEN

**Description:**
The Allocation Editor table renders three columns: Recipient Wallet, Amount, Type. The per-leaf
schedule fields (`cliffTime`, `endTime`, `startTime`) are loaded from the DB (`/leaves` endpoint)
and silently passed through when rebuilding the Merkle root — they are never displayed and cannot
be modified through the editor.

**Consequences:**
1. **Cannot fix wrong dates:** If a recipient was created with the wrong cliff date (e.g.,
   `2025-06-01` instead of `2026-06-01`), there is no path to correct it via the Allocation
   Editor. The admin must cancel the entire campaign and recreate it.
2. **Blind signing:** The cancel authority performing a root rotation cannot verify each
   recipient's schedule before submitting the new root. They could unknowingly re-commit
   stale or incorrect schedule data alongside the intended allocation changes.
3. **Partial coverage:** The root rotation use case (fix typos, add team members) is
   well-served for wallet + amount edits but is architecturally blind to schedule errors.
   This asymmetry is invisible to users.

**Architecture note:** Schedule fields ARE hashed into the leaf, so changing them via root
rotation is fully supported by the program — this is a UI omission, not a protocol limitation.

**Required fix (UI only, no on-chain change):**
- Add a collapsible sub-row or tooltip per table row showing `cliffTime` and `endTime` as
  human-readable dates (read-only for existing rows).
- For new rows: allow editing all schedule fields with validation (`startTime ≤ cliffTime ≤ endTime`).
- For existing rows: show schedule read-only with a tooltip explaining "to change the schedule,
  remove this row and add it again with the correct dates" — mirrors the existing `releaseType`
  lock pattern (G-S4).

---

### G-11
**Allocation Editor — new rows allow release type mismatch with existing campaign** — 🟡 OPEN

**Description:**
When adding a new recipient row in the Allocation Editor, the `releaseType` select shows all
three options (Cliff / Linear / Milestone) regardless of the original campaign type. A campaign
created as "Cliff" can have a new "Linear" recipient added through the editor. The prepare API
does not validate cross-leaf type consistency.

**Consequences:**
1. **Mixed-type trees:** A tree with Cliff + Linear recipients has semantically conflicting
   schedule fields. For Cliff, `endTime` should equal `cliffTime` (instantaneous release).
   For Linear, `endTime` is the stream end date. A mixed tree has no coherent type identity.
2. **Silent Milestone failure:** Adding a `releaseType = 2` (Milestone) leaf to a non-milestone
   campaign requires the creator to call `set_milestone_released` before the recipient can claim.
   For a campaign not designed as milestone-based, this step is almost certainly missed,
   leaving the new recipient permanently unable to claim.
3. **Recipient confusion:** Campaign pages surface a single "type" label. A mixed-type tree
   has no correct label.

**Required fix (frontend only):**
In `AllocationEditor`: when `existingRowIds` is non-empty, infer the dominant `releaseType`
from existing rows. For new rows:
- Default the type selector to the dominant type.
- If a different type is selected: show an inline warning explaining the risk.
- If `releaseType = 2` (Milestone) is selected in a non-milestone campaign: show a blocking
  error explaining that `set_milestone_released` must be called before the recipient can claim.

---

### G-08
**`total_supply` is immutable — no top-up after creation** — 🟡 OPEN

**Description:**
`VestingTree.total_supply` is set at `create_campaign` and `fund_campaign` time. There is no
instruction to increase it. If a DAO wants to add more tokens to a running grant program
(e.g., a new funding round for the same contributor), they must either:
1. Create an entirely new campaign with a new mint/creator/campaignId
2. Cancel and recreate

This is particularly limiting for:
- Long-running contributor programs where budget grows over time
- DAO treasury vesting that receives periodic top-ups

**Required fix:**
New `top_up_campaign` instruction that:
1. Transfers additional tokens into the vault
2. Increases `total_supply` by the top-up amount
3. Does NOT change `merkle_root` (allocation ratios unchanged)
4. Requires the creator to sign

This is additive (no breaking changes) and relatively safe to implement.

---

## Design Caps

### G-C1
**PER_LEAF_CAP = 8: max 8 cliff/linear leaf slots per ClaimRecord** — ⚪ CAP

From `constants.rs`:
```rust
pub const PER_LEAF_CAP: usize = 8;
```
A single beneficiary can hold at most 8 distinct cliff/linear leaf indices within one `ClaimRecord`
per tree. The 9th cliff/linear leaf for the same beneficiary returns `VestingError::PerLeafCapExceeded`.

Milestone leaves are **not** affected — they use `milestone_bitmap` (256 bits) instead of the
per-leaf ledger.

Note: the prepare API already blocks multiple cliff/linear leaves per beneficiary via the
"Known Issue #29" guard, so in practice PER_LEAF_CAP is a redundant safety net, not a primary
constraint. Increasing it would require resizing `ClaimRecord` and migrating all existing accounts.

---

### G-C2
**Max 256 milestones per beneficiary** — ⚪ CAP

`milestone_bitmap` is `[u8; 32]` = 256 bits. `milestoneIdx` is a `u8` (0–255). A beneficiary
cannot have more than 256 distinct milestone leaves per tree.

For typical use cases (quarterly over 10 years = 40, monthly over 5 years = 60) this is
sufficient. For edge cases (daily milestones, micro-grant programs) this may bind.

Expansion would require changing `milestone_bitmap` to `[u8; N]` — breaking account layout change.

---

### G-C3
**No bulk claim instruction — one TX per claim** — ⚪ CAP

Each `claim` instruction processes exactly one `VestingLeaf`. A beneficiary with 10 milestone
leaves must send 10 separate transactions to claim all of them. This is a Solana constraint
(Anchor instruction size and compute unit limits) and not specific to Velthoryn.

The user-facing impact: for large milestone campaigns, recipients face high transaction fee
overhead and must click "Claim" multiple times.

**Partial mitigation:** The frontend currently batches UX but not transactions. A multi-claim
instruction is theoretically possible (pass a `Vec<(VestingLeaf, Vec<[u8;32]>)>`) but would hit
compute unit limits beyond ~3-4 leaves per TX on-chain.

---

### G-C4
**`startTime` stored in leaf but never used in vesting math** — ⚪ CAP

`VestingLeaf.start_time` occupies 8 bytes in the 70-byte leaf layout and is stored in the DB,
but `schedule::vested()` never reads it for any release type. The proptest
`start_before_cliff_same_as_start_eq_cliff` explicitly verifies this invariant.

Its current purpose is: (1) byte layout compatibility, (2) informational display in the UI
("Schedule starts"), (3) reserved for future use (e.g., a "linear ramp-up from startTime to
cliffTime before full vesting begins" if a new release type is ever added).

The `start_time <= cliff_time` constraint IS enforced at `claim` time:
```rust
require!(
    leaf.start_time <= leaf.cliff_time && leaf.cliff_time <= leaf.end_time,
    VestingError::InvalidSchedule
);
```
So any leaf submitted with `start_time > cliff_time` will fail on-chain, even though `start_time`
doesn't affect the vesting calculation. This is defense-in-depth for future release types.

---

## Deferred Items

### G-D1
**Multi-leaf campaigns: instant cancel when nothing vested** — 📋 DEFERRED

**Reference:** ADR-FE-007

A creator who funds a bulk campaign (`leaf_count > 1`) before any cliff date and then wants to
cancel must wait the full 7-day grace period even when every beneficiary's claimable balance is
zero. The `cancel_campaign` instruction has no path to skip the grace period for this case.

**Accepted decision:** Keep 7-day grace for all multi-leaf cancellations at launch. A new
`instant_cancel_if_unvested` instruction (which would verify on-chain that
`tree.total_claimed == 0` and cancel immediately) is queued for a future program upgrade.

---

## Appendix: Fix Priority Matrix

| ID | Effort | Impact | Recommended Priority |
|----|--------|--------|----------------------|
| G-M1 (rug pull on-chain guard) | Low (1 line Rust + error + test) | Critical | **P0 — fix now, before any public campaign** |
| G-09 (trust model docs) | Trivial (docs + UI text) | High | **P0 — fix now, no risk, high trust value** |
| G-04 (cancel cooldown) | Low | High | P1 |
| G-06 (grace period duration) | Trivial | High | P1 |
| G-02 (cancel_stream notice) | Medium | High | P1 |
| G-11 (mixed release types) | Low (frontend only) | Medium | P2 |
| G-10 (schedule fields in editor) | Medium (frontend only) | Medium | P2 |
| G-05 (grace inconsistency) | Follows G-02 | Medium | P2 |
| G-03 (milestone trust) | High | High | P2 (design first) |
| G-08 (top-up) | Medium | Medium | P3 |
| G-07 (naming) | Trivial | Low | P3 (docs sprint) |
| G-01 (hybrid cliff+linear) | Very High | Medium | P4 (major version) |

---

*This document tracks gaps as of 2026-06-24. Resolved items should be moved to the Solved section
with fix date and PR reference. New gaps discovered during audits should be added with OPEN status
before fixes are attempted.*
