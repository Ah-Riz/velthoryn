# Known Issue #29 — Multi-Leaf Cumulative `claimed_amount` Undercount

**Status:** ✅ FIXED on-chain (2026-06-16). Option A implemented — `ClaimRecord` is now `#[account(zero_copy)]` with a bounded per-leaf ledger (`leaf_claimed_idx: [u32; 8]` + `leaf_claimed_amt: [u64; 8]`), NOT the `Vec<u64>`+realloc proposed in §3 below. See `docs/week9/ADRs/ADR-003-...` (Supersession section) for the chosen design + rationale. The text below is retained as the original design analysis.

**Area:** Smart contract (`claim.rs`, `withdraw.rs`, `ClaimRecord`)  
**Related:** [`docs/WEEK8_KNOWN_ISSUES.md`](WEEK8_KNOWN_ISSUES.md) #29, issues #23 and #24 (related fixes, different root cause)  
**Last updated:** June 2026

---

## 1. Problem statement

For **multi-leaf non-milestone campaigns**, a single beneficiary may hold more than one cliff or linear vesting leaf in the Merkle tree. The program stores **one** `ClaimRecord` per `(tree, beneficiary)` pair and tracks a **single cumulative** `claimed_amount` across all cliff/linear claims.

Claimable amount for cliff/linear leaves is computed as:

```text
claimable = schedule::vested(current_leaf, effective_now) - cr.claimed_amount
```

Because `claimed_amount` includes tokens paid on **other** leaves for the same beneficiary, later leaves can show zero claimable balance even when the current leaf is fully vested. The beneficiary is underpaid relative to their Merkle entitlement.

This is **not** a Merkle proof mismatch — proof verification uses each leaf's own fields correctly. The bug is in **post-proof accounting**: cumulative subtraction applied to per-leaf vesting math.

### Affected vs unaffected cases

| Scenario | Affected? | Why |
|----------|-----------|-----|
| One cliff/linear leaf per beneficiary | No | Cumulative `claimed_amount` equals that leaf's claimed total |
| Milestone leaves (any order) | No | `claimable = leaf.amount`; per-milestone `milestone_bitmap` prevents double-claim; `total_entitled` accumulates across milestone claims (issue #24 fix) |
| Mixed milestone + cliff/linear for same beneficiary | Partially | Milestone claims work; cliff/linear siblings still share cumulative `claimed_amount` |
| Multi-leaf cliff/linear, same beneficiary | **Yes** | Second and later leaves undercount |
| `withdraw` (single-leaf streams) | No | `leaf_count == 1` constraint; one leaf only |

Multi-leaf cliff/linear for one beneficiary is **uncommon** in current product flows (typical campaigns assign one schedule leaf per wallet), but it is valid on-chain and can be constructed via root rotation or bulk allocation.

---

## 2. Current behavior vs expected behavior

### Current on-chain behavior

`ClaimRecord` layout (`programs/vesting/src/state/claim_record.rs`):

| Field | Role |
|-------|------|
| `claimed_amount` | Running sum of all tokens transferred to this beneficiary on this tree |
| `total_entitled` | Set to first leaf's `amount` on first touch; accumulated via `checked_add` for subsequent **milestone** claims only |
| `milestone_bitmap` | Per-milestone claimed flags (256 milestones) |

Cliff/linear path in `claim.rs` (and mirror logic in `withdraw.rs`):

```rust
let claimable = schedule::vested(&leaf, effective_now).saturating_sub(cr.claimed_amount);
// ...
cr.claimed_amount = cr.claimed_amount.checked_add(claimable)?;
```

Milestone path bypasses subtraction:

```rust
let claimable = leaf.amount;  // full leaf amount when released
```

### Concrete failure example

Beneficiary `Alice` has two fully vested cliff leaves on the same campaign:

| Leaf | `amount` | `vested(now)` |
|------|----------|---------------|
| A (index 0) | 100 | 100 |
| B (index 1) | 50 | 50 |

**Claim leaf A:**  
`claimable = 100 - 0 = 100` → `claimed_amount = 100` ✓

**Claim leaf B:**  
`claimable = 50 - 100 = 0` (saturating) → `NothingToClaim` ✗  

Alice should receive 50 tokens from leaf B. On-chain she receives 0.

### Expected behavior

Each cliff/linear leaf's claimable balance should be computed **independently**:

```text
claimable = schedule::vested(current_leaf, effective_now) - claimed_amount_for_this_leaf
```

`claimed_amount` (or equivalent per-leaf tracker) must not bleed across unrelated leaves. `total_entitled` for `close_claim_record` should reflect the **sum** of all leaf entitlements for the beneficiary, not only the first leaf plus milestones.

### Related fixes (not a full resolution)

These Week 8 changes addressed **adjacent** multi-leaf bugs but do **not** fix issue #29:

| Issue | Fix | Scope |
|-------|-----|-------|
| #23 | Removed `fully_claimed` sub-condition from `StreamExpired` in `claim.rs` | Unblocked claiming leaf B after leaf A when cumulative `claimed_amount >= leaf B.amount`; did not fix undercount formula |
| #24 | Accumulate `total_entitled` on each milestone claim | Milestone-only; cliff/linear still set `total_entitled` only on first touch |
| T6 first-touch | Avoid double-counting `total_entitled` when first claim is a milestone | Milestone accounting only |

---

## 3. Proposed fix — per-leaf tracking in `ClaimRecord`

### Recommended approach: leaf-index bitmap + per-leaf claimed amounts

Mirror the existing milestone pattern: use `leaf.leaf_index` (already in the Merkle leaf and verified by proof) as the key.

**Option A — Bitmap + implicit full claim (milestones only today)**  
Insufficient for cliff/linear: partial vesting requires tracking **how much** was claimed per leaf, not just whether it was touched.

**Option B — Fixed per-leaf claimed array (recommended for design review)**

Add to `ClaimRecord`:

```rust
/// Cumulative tokens claimed per leaf_index. Length = tree.leaf_count at first
/// claim; resized on root rotation when leaf_count increases.
pub claimed_by_leaf: Vec<u64>,
```

Claim math becomes:

```rust
let prior = cr.claimed_by_leaf
    .get(leaf.leaf_index as usize)
    .copied()
    .unwrap_or(0);
let claimable = schedule::vested(&leaf, effective_now).saturating_sub(prior);
// after transfer:
cr.claimed_by_leaf[leaf.leaf_index as usize] = prior.checked_add(claimable)?;
```

Keep `claimed_amount` as the **sum** of `claimed_by_leaf` (or derive it) for events and `close_claim_record` compatibility.

**Option C — Separate ClaimRecord PDA per leaf**

Change seeds to `[b"claim", tree, beneficiary, leaf_index]`. Strong isolation but multiplies rent cost, complicates `close_claim_record`, and breaks all existing claim PDAs — highest migration cost.

### `total_entitled` alignment

On each claim (any release type), accumulate:

```rust
if !leaf_already_counted_in_total_entitled {
    cr.total_entitled = cr.total_entitled.checked_add(leaf.amount)?;
}
```

Alternatively, set `total_entitled` once at campaign setup via an off-chain index sum; on-chain lazy accumulation must cover cliff/linear siblings the way milestones already do.

### Root rotation

When `update_root` increases `leaf_count`, `claimed_by_leaf` must resize (new indices default to 0). When a beneficiary's leaves are removed or amounts shrink, existing claimed amounts must not exceed new leaf amounts (same semantics as today's rotation behavior: `saturating_sub` → `NothingToClaim`).

### Account size

`ClaimRecord` space today: `8 + InitSpace` (~130 bytes fixed). A `Vec<u64>` adds 4-byte length + 8 × `leaf_count` bytes. For `leaf_count = 256`, ~2 KB — still within typical PDA limits but requires explicit `realloc` on first multi-leaf claim and on root rotation. Document max supported `leaf_count` for realloc budget.

---

## 4. Breaking change analysis

### What breaks

| Change | Impact |
|--------|--------|
| `ClaimRecord` account layout | All existing claim PDAs deserialize incorrectly after upgrade without migration |
| Account size increase | `init_if_needed` creates undersized accounts; existing accounts need `realloc` |
| `close_claim_record` semantics | `claimed_amount >= total_entitled` must use corrected `total_entitled` sum |
| Indexer / API | Events may add per-leaf fields; dashboard vesting progress assumes single cumulative tracker today |
| Tests | New integration tests for multi-leaf cliff/linear same beneficiary |

### Migration strategies

**Strategy 1 — Lazy migration on next claim (recommended candidate)**

1. Add `version: u8` to `ClaimRecord` (or infer from account length).
2. On claim, if `version == 0` (legacy): treat entire `claimed_amount` as attributed to the **first claimed leaf index** only (best-effort; ambiguous if multiple leaves were partially claimed — rare in production).
3. `realloc` account, initialize `claimed_by_leaf`, set `version = 1`.
4. Ambiguity risk: if a beneficiary already claimed two cliff leaves under the buggy logic, migration cannot perfectly reconstruct per-leaf splits. Document as acceptable for the rare case or require manual admin intervention.

**Strategy 2 — Close and re-claim**

Require beneficiaries to `close_claim_record` (post-grace or fully claimed under legacy rules), then re-init on next claim with new layout. Loses history; may be impossible if underpaid and not fully claimed.

**Strategy 3 — New program ID**

Deploy fresh program; no migration of old claim records. Simplest technically, heaviest operationally.

**Strategy 4 — Do nothing (status quo)**

Document limitation; discourage multi-leaf cliff/linear per beneficiary in UI and Merkle builder validation.

### Upgrade path checklist

- [ ] Program upgrade via Squads / authority multisig
- [ ] `realloc` CPI in `claim` / admin migration instruction
- [ ] BE validation: warn or reject allocations with multiple cliff/linear leaves per beneficiary
- [ ] FE: vesting progress uses per-leaf model when available
- [ ] Regression tests: two cliff leaves same beneficiary, partial vesting on each

---

## 5. Decision options

### Option A — Fix now (program upgrade + migration)

**Pros:** Correct on-chain accounting for all valid Merkle trees; removes silent underpayment.  
**Cons:** Breaking layout change, realloc complexity, ambiguous legacy migration for anyone who already hit the bug, audit surface.

**When to choose:** Product roadmap includes multi-tranche per-beneficiary allocations (e.g. separate cliff tranches in one campaign) or root rotations that split schedules per wallet.

### Option B — Document and defer (current state)

**Pros:** Zero migration risk; milestones and single-leaf campaigns unaffected.  
**Cons:** Bug remains exploitable by misconfiguration; hard to explain in support docs.

**When to choose:** Near-term releases only use one cliff/linear leaf per beneficiary; multi-leaf cases gated off in UI/BE.

**Mitigations already in place:**

- Document in `WEEK8_KNOWN_ISSUES.md` and this design doc
- Milestone campaigns use bitmap path (correct)
- Issue #23 fix prevents false `StreamExpired` blocks (claims fail with `NothingToClaim` instead — still wrong amount, not wrong error)

### Option C — Accept as permanent limitation

**Pros:** No engineering cost.  
**Cons:** On-chain program cannot represent a valid Merkle tree correctly for multi-leaf cliff/linear beneficiaries.

**When to choose:** Product permanently constrains one schedule leaf per wallet; Merkle builder enforces at preparation time.

**Enforcement suggestion if choosing B or C:**

```text
BE prepare/route.ts: reject when count(cliff/linear leaves per beneficiary) > 1
FE bulk send: same validation with clear error message
```

---

## 6. Recommendation (for review)

**Defer fix (Option B)** with **BE/FE enforcement (Option C mitigation)** until a campaign type requires multiple cliff/linear leaves per beneficiary.

Rationale:

1. Current product flows assign one vesting schedule per beneficiary; milestones already work via bitmap.
2. Fixing correctly requires `ClaimRecord` resize + ambiguous legacy migration — high cost for a rare tree shape.
3. Short-term risk is controllable with Merkle builder validation and documentation.

Revisit **Option A** when:

- A customer needs multiple linear/cliff tranches per wallet in one campaign, or
- Root rotation workflows routinely produce multi-leaf non-milestone beneficiaries.

### BE enforcement (active)

As of the `week8-gap-closure-lana` spec (June 2026), backend validation is **active**:

- `POST /api/campaigns/prepare` — rejects the entire request with `400 ValidationError` when any beneficiary has 2+ cliff/linear leaves (Known Issue #29 message cites duplicate indices).
- `POST /api/campaigns/import` — per-row errors for duplicate cliff/linear beneficiaries; valid rows still parse (partial success). Milestone rows for the same beneficiary are allowed.

FE validation (bulk send UI) remains pending (Geral). On-chain fix (Option A) is still deferred.

---

## 7. Verification criteria (future implementation spec)

When implementing the fix, acceptance tests should include:

1. Two cliff leaves, same beneficiary, both fully vested → both claim full amounts.
2. Two linear leaves, staggered vesting → partial claims on each leaf independent of the other.
3. Milestone + cliff leaves same beneficiary → milestones still use bitmap; cliff uses per-leaf tracker.
4. Root rotation adds a new leaf for existing beneficiary → new index claimable from 0.
5. Legacy `ClaimRecord` lazy migration → no panic; best-effort or documented manual path.
6. `close_claim_record`: `claimed_amount >= total_entitled` with accumulated entitlements across all leaf types.

---

## References

- `programs/vesting/src/instructions/claim.rs` — cliff/linear claimable calculation (~line 147)
- `programs/vesting/src/state/claim_record.rs` — account layout
- `programs/vesting/src/instructions/close_claim_record.rs` — `total_entitled` / `claimed_amount` gate
- `docs/WEEK8_KNOWN_ISSUES.md` — issue #29 summary
- `docs/SECURITY.md` — CEI order and double-claim protections (unchanged by this design)
