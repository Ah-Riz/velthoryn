# Merkle & Vesting Math — How It Actually Computes (Learning Guide)

> The cryptography and the schedule math behind Velthoryn, for the author. Assumes
> Solana fluency. Every formula/algorithm is copied from source. Companion to
> `PROGRAM_INTERNALS.md`. For per-instruction detail see `docs/reference/`.
>
> Code: `programs/vesting/src/math/{merkle,schedule}.rs`, `constants.rs`, `state/leaf.rs`;
> off-chain mirror: `clients/ts/src/{merkle,leaf,prepare}.ts`.

---

## 1. Why a Merkle tree here

Goal: let one on-chain account authorize payouts to **any number** of recipients, without storing them. A Merkle tree does exactly this — it commits to a list with a single 32-byte **root**. To prove "I'm recipient #k with these terms", you supply your leaf and a short **proof** (≈log₂(N) sibling hashes); the program re-hashes up the tree and checks it equals the root.

Consequence: the distributor's on-chain footprint is **O(1)** (one root) instead of **O(N)** accounts. Measured: ~800× cheaper at 1,000 recipients, ~800,000× at 1M (`docs/internal/MERKLE_FEE_VS_JITO_REPORT.md`). The trade-off is that each recipient still files **one claim transaction** (the cost shifts to claimants, lazily).

---

## 2. Hashing — leaf and node

`math/merkle.rs`. Uses **Keccak-256** via `solana_keccak_hasher::hashv`.

```
LEAF_PREFIX = 0x00
NODE_PREFIX = 0x01

leaf_hash(leaf) = Keccak256( 0x00 ‖ borsh(leaf) )          // 70-byte Borsh leaf
node_hash(L, R) = Keccak256( 0x01 ‖ L ‖ R )                // two 32-byte hashes
```

**Domain separation** (the 0x00 vs 0x01 prefix) defeats **second-preimage attacks**: an internal node hash (made with 0x01) is also 32 bytes — without the prefix an attacker could submit a node hash *as if* it were a leaf. Different prefixes ⇒ different Keccak output ⇒ a node can never verify as a leaf. Proven by `audit_claim2_second_preimage_node_as_leaf_fails`.

**The 70-byte leaf** (`state/leaf.rs`, Borsh, little-endian):
```
offset 0   leaf_index    u32    (4)   ← included in the hash (see below)
offset 4   beneficiary   Pubkey (32)
offset 36  amount        u64    (8)
offset 44  release_type  u8     (1)   0=Cliff 1=Linear 2=Milestone
offset 45  start_time    i64    (8)   ← ignored by vested(), kept for indexing
offset 53  cliff_time    i64    (8)
offset 61  end_time      i64    (8)
offset 69  milestone_idx u8     (1)
```
The TS encoder (`clients/ts/src/leaf.ts` `encodeLeaf`) must match this **byte-for-byte** — a single byte of drift changes every hash. The repo's `golden_vector.spec.ts` cross-checks a known leaf's hash between Rust and TS to catch any drift.

**Why `leaf_index` is hashed in:** two leaves with *identical* beneficiary/amount/schedule but different positions hash differently (`distinct_indices_yield_distinct_hashes`). This **binds each leaf to its tree position**, so a proof for leaf A cannot be replayed at leaf B's index — which is also what makes the per-leaf claim ledger (§7) safe.

**Why Keccak-256 + these prefixes:** it's the exact convention of **Jito's distributor** — so the off-chain tooling and security reasoning are portable, and the verifier is a battle-tested pattern (`docs/decisions/adr-002-keccak-256-domain-separation.md`).

---

## 3. Building the tree + a proof (off-chain)

`clients/ts/src/merkle.ts` `VestingMerkleTree` builds bottom-up; `prepare.ts` `prepareCampaign` emits the root + every leaf's proof.

Algorithm (matches the Rust test builder exactly):
1. Leaf layer = `[leaf_hash(leaf) for each leaf]`.
2. Repeat until one hash remains (the root): pair up nodes; if a layer has **odd** length, **duplicate the last node** before hashing (`working = current + [last]`). `node_hash(working[2i], working[2i+1])`.
3. A leaf's **proof** = the siblings on its path leaf→root. At each level: if the leaf's index is even, its sibling is `index+1` (or the duplicated last node if out of range); if odd, `index−1`. Then `index >>= 1`.

### Worked 4-leaf example (structure)
```
leaves:        h0 = leaf_hash(L0)   h1 = leaf_hash(L1)   h2 = …   h3 = …
level 1:       n01 = node_hash(h0,h1)                   n23 = node_hash(h2,h3)
root:          R   = node_hash(n01, n23)

proof for L0 (index 0):  [h1, n23]     ← sibling at level 0 (h1), sibling at level 1 (n23)
proof for L3 (index 3):  [h2, n01]     ← index 3 is odd ⇒ sibling h2; then index 1 ⇒ n01
```
Verification of L0: start `hash=h0`, index 0 (even) ⇒ `hash = node_hash(h0, h1) = n01`, index→0; index 0 (even) ⇒ `hash = node_hash(n01, n23) = R`, index→0; `hash == R` ✓. (Cf. Rust test `verify_four_leaf`.)

> Hashes are opaque 32-byte values, so worked examples show *structure*. The real byte-exactness is guaranteed by the golden-vector cross-check + the proptest/forgery suites in `math/merkle.rs`.

---

## 4. On-chain verification

`verify_merkle_proof(leaf_hash, proof, mut index, root) -> bool` (`math/merkle.rs`):
```
hash = leaf_hash
for sibling in proof:
    if index is even:  hash = node_hash(hash, sibling)   // hash is the LEFT child
    else:              hash = node_hash(sibling, hash)    // hash is the RIGHT child
    index >>= 1
return hash == root
```
The even/odd branch decides sibling ordering — exactly mirroring how the tree was built.

**Two proof-length checks** (in `claim.rs`, constants in `constants.rs`):
- `proof.len() ≤ MAX_MERKLE_PROOF_LEN` (= **32**, the max depth for `u32` leaf indices), and
- `proof.len() ≤ max_proof_len_for_leaf_count(leaf_count)` = **`ceil(log2 N)`** for N>1 (0 for N≤1).

The second cap is what blocks **padding forgery** (extra bogus siblings) for a small tree; the first bounds CU/size. Both are exercised by `audit_claim2_padded_proof_never_verifies` and `audit_claim2_shortened_proof_never_verifies`.

### Proof size vs. recipient count
`depth = ceil(log2 N)`; proof bytes = `depth × 32`.

| N | depth | proof bytes | fits in a tx? |
|---|---|---|---|
| 1 | 0 | 0 | yes (root = leaf hash) |
| 10 | 4 | 128 | yes |
| 100 | 7 | 224 | yes |
| 1,000 | 10 | 320 | yes |
| 10,000 | 14 | 448 | yes |
| 1,000,000 | 20 | 640 | yes |
| 2³²−1 | 32 | 1,024 | yes (≤ 1,232-byte tx limit) |

A `claim` instruction's data = 8 (disc) + 70 (leaf) + 4 (vec len) + proof. At 1M leaves that's ~722 bytes — comfortably within Solana's 1,232-byte limit. (Off-chain builder caps depth at 20 ⇒ ≤ ~1M leaves; on-chain the 32-sibling cap is the only hard limit.)

---

## 5. Vesting schedule math

`math/schedule.rs`. `vested(leaf, now)` returns the time-based vested amount. **Note:** for Milestone (type 2) this returns `amount` once `now ≥ cliff_time`, but the milestone *flag* gate is enforced at the **instruction level** (`claim.rs`), not here — the comment in source says so explicitly.

```
Cliff (0):     now ≥ cliff_time ? amount : 0
Linear (1):    now ≥ end_time   ? amount
               now ≤ cliff_time ? 0
               else (amount·u128 · (now − cliff_time)) / (end_time − cliff_time)
Milestone (2): now ≥ cliff_time ? amount : 0      // flag checked separately
```

**Linear uses `u128` intermediate** (`(amount as u128 * elapsed) / duration`) so `amount = u64::MAX` can't overflow — proven by `linear_no_overflow_at_max_amount`. `start_time` is **ignored** (proven by `start_before_cliff_same_as_start_eq_cliff`).

### Worked numbers (from the test suite)
- **Cliff**, amount 1000, cliff=100: `vested(99)=0`, `vested(100)=1000`, `vested(999)=1000`.
- **Linear**, amount 1000, cliff=100, end=200: `vested(50)=0`, `vested(100)=0`, **`vested(150)=500`**, `vested(200)=1000`.
- **Linear quarter**, amount 10000, cliff=1000, end=2000: `vested(1250)=2500`, `vested(1500)=5000`, `vested(1750)=7500`.
- **Degenerate** cliff==end (both 100), linear: `vested(99)=0`, `vested(100)=1000` (acts like a cliff).

### The cancel clamp
`get_vested_amount(leaf, cancelled_at, now)`:
```
effective_now = cancelled_at.map(|c| now.min(c)).unwrap_or(now)
return vested(leaf, effective_now)
```
Time is **frozen at cancellation**: after `cancel_campaign`, no matter how far the real clock advances, vesting is computed as of `cancelled_at`. So a beneficiary can only ever claim what had vested by the cancel moment — the rest reverts to the creator after grace. `claim.rs` and `withdraw.rs` apply this same clamp; proptests (`cancel_clamps_to_cancel_time`, `cancel_clamp_never_exceeds_uncancelled`) prove it never exceeds `vested(cancelled_at)`.

### Edge cases
- **Cancel before cliff** (cancel at 50, cliff 100): effective_now=50 < 100 ⇒ 0. Beneficiary gets nothing.
- **Cancel mid-linear** (cancel at 150, cliff 100/end 200/amt 1000): effective_now=150 ⇒ 500. Beneficiary keeps 500; 500 reverts.
- **Cancel after end**: effective_now = `now.min(c)`, and `now≥end` ⇒ full amount.

---

## 6. `get_vested_amount` — the read-only view + Phase 2

`instructions/get_vested_amount.rs`. **Zero accounts**; takes `(leaf, cancelled_at, now, milestone_released_flags)` and returns `u64`. ~614–916 CU (cheapest instruction — no state mutated). It deliberately takes `now` as a **parameter** (not `Clock::get()`) so a caller can query an arbitrary timestamp.

**Phase 2 purpose** (`PRD_LANA.md §1.3`): external programs **CPI** into it to learn a position's vested value **without moving tokens**, enabling:
- **Lending collateral** — a protocol treats vested-but-unclaimed tokens as collateral, querying this for the collateral value.
- **DAO governance voting** — Realms / SPL-Governance count vested (unclaimed) token weight as voting power.

That turns "locked tokens as dead capital" (a gap in every surveyed competitor) into composable DeFi positions.

---

## 7. The per-leaf ledger (Issue #29) — the claimable math

`state/claim_record.rs`. On each `claim`:
```
prior       = leaf_prior_claimed(leaf.leaf_index)     // 0 if this leaf is new
claimable   = vested(leaf, effective_now) − prior     // saturating
record_leaf_claim(leaf.leaf_index, claimable)         // leaf_claimed_amt[slot] += claimable
claimed_amount += claimable                           // running sum (events/close read this)
tree.total_claimed += claimable                       // global OverClaim check
```
`leaf_prior_claimed` / `record_leaf_claim` key on `leaf.leaf_index` via a linear scan over the **8-slot** ledger (`PER_LEAF_CAP = 8`); `find_leaf_slot` returns `Occupied(i)` / `Empty(i)` / `Full`. `EMPTY_LEAF_SLOT = u32::MAX` marks free slots (0 is a valid index). Milestone leaves **don't** use the ledger — they use `milestone_bitmap`.

**Why this exists:** pre-fix there was only a single cumulative `claimed_amount`, so a beneficiary holding two cliff/linear leaves had the second **starved** by the first (the bug behind Issue #29). Per-leaf tracking makes each leaf's delta independent. The schedule.rs `audit_claim3_*` tests prove: two leaves for the same beneficiary now both pay in full, and the tree never overspends. Legacy v0 accounts (121 B) `realloc`-grow on first touch (`migrate_legacy_claim_record`); `version == 0` triggers `init_per_leaf_ledger`.

`PER_LEAF_CAP = 8` bounds the ledger so `ClaimRecord` is **fixed-size** (no per-claim realloc/CU spike). A beneficiary with >8 distinct cliff/linear leaves in one campaign hits `PerLeafCapExceeded` — a known, documented limit (milestones are unlimited via the bitmap).

---

## 8. Worked end-to-end example (every number computed)

Three recipients, `total_supply = 3000`, all times in unix seconds:
- **A** — Cliff, 1000, cliff = **100**
- **B** — Linear, 1000, cliff = 100, end = **200**
- **C** — Linear, 1000, cliff = 100, end = **200**

Off-chain, `prepareCampaign` builds the 3-leaf tree (odd layer ⇒ C's hash duplicated) → `root`, plus A/B/C proofs. `create_campaign` stores the root; `fund_campaign` puts 3000 in the vault.

| step | time | action | computation | result |
|---|---|---|---|---|
| 1 | 150 | A claims | cliff, 150≥100 ⇒ 1000 | A gets **1000**; `total_claimed=1000` |
| 2 | 150 | B claims | linear: 1000·(150−100)/(200−100) = **500** | B gets **500**; `total_claimed=1500` |
| 3 | 150 | `cancel_campaign` | `cancelled_at=150`, freeze | grace window opens (7 days) |
| 4 | 160 (grace) | B claims again | effective_now=min(160,150)=150 ⇒ vested 500, prior 500 ⇒ claimable **0** | `NothingToClaim` |
| 5 | 160 (grace) | C claims | effective_now=150 ⇒ vested 500, prior 0 ⇒ claimable **500** | C gets **500**; `total_claimed=2000` |
| 6 | >7d | `withdraw_unvested` | remaining = `total_supply − total_claimed` = 3000 − 2000 = **1000** | creator reclaims **1000** |

**Reconciliation:** A 1000 (fully vested) + B 500 (vested-at-cancel) + C 500 (vested-at-cancel) = 2000 paid to beneficiaries. B's unvested 500 + C's unvested 500 = 1000 reverted to creator. 2000 + 1000 = 3000 = `total_supply`. ✓ The `OverClaim` guard (`total_claimed ≤ total_supply`) held at every step.

This single walkthrough exercises: cliff + linear vesting, a partial claim, the **cancel clamp** (B can't get more at t=160 than vested at t=150), the **per-leaf ledger** (B's second claim yields 0, not a re-pay), the grace window, and the final `withdraw_unvested` reconciliation.

---

## 9. Cross-links
- `docs/reference/schedule-types.md` — schedule comparison table.
- `docs/decisions/adr-001-merkle-compressed-vesting.md` — why Merkle (cost).
- `docs/decisions/adr-002-keccak-256-domain-separation.md` — hashing choice.
- `docs/decisions/adr-003-issue-29-per-leaf-ledger.md` — the ledger fix.
- `docs/internal/MERKLE_FEE_VS_JITO_REPORT.md` — the O(1)-vs-O(N) cost, measured.
- `docs/internal/learning/PROGRAM_INTERNALS.md` — companion (accounts, lifecycle, clawback, security).
- Source: `programs/vesting/src/math/{merkle,schedule}.rs`, `constants.rs`, `state/{leaf,claim_record}.rs`; `clients/ts/src/{merkle,leaf,prepare}.ts`.
