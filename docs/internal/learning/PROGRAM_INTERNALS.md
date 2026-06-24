# Program Internals — How Velthoryn Works (Learning Guide)

> A guided tour of the on-chain program, for the author. Assumes Solana/Anchor fluency.
> Code paths are real; every claim is traceable to a file. This is a *tour*, not an API
> dump — for exhaustive per-instruction detail, follow the cross-links in §9.
>
> Program: `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` · Anchor · `programs/vesting/`

---

## 1. The mental model (hold this in your head)

A campaign is **one on-chain account** (`VestingTree`) whose 32-byte `merkle_root` cryptographically commits to an entire list of recipients (the "leaves") — built off-chain. The **distributor pays O(1)** to create that one account; recipients **self-serve**: each presents their own leaf + a short Merkle proof, the program checks the proof against the root, computes how much has vested under their schedule, and pays them. The distributor never signs per-recipient transactions.

Three things live on-chain per campaign:
- the **root** (who's allowed) — in `VestingTree`,
- the **vault** (the tokens) — an SPL ATA, *or* lamports held directly in the PDA for native SOL,
- per-claimant **claim ledgers** (`ClaimRecord`) — created lazily by each claimant, tracking what they've already taken.

Everything else — schedules, clawback, pause, double-claim protection — is logic the program runs on claim. The O(1)-vs-O(N) cost story this enables is measured in `docs/internal/MERKLE_FEE_VS_JITO_REPORT.md`.

```
                 off-chain                            on-chain
   CSV of recipients ──► Merkle tree ──►  root  ──►  VestingTree (1 account, O(1))
   (clients/ts)         (prepare.ts)                  + vault (tokens)
                                                           ▲
   each recipient:  leaf + proof  ─────────────────►  claim() verifies proof vs root,
   (served by BE)                                          pays vested delta,
                                                           writes ClaimRecord (lazy)
```

---

## 2. The three on-chain types

### `VestingTree` — the campaign itself
`state/vesting_tree.rs`. One per campaign. PDA seeds: `["tree", creator, mint, campaign_id_le]`. **323 bytes** (8-byte discriminator + 315 InitSpace); rent ≈ 0.003134 SOL (measured).

| field | type | why |
|---|---|---|
| `creator` | Pubkey | who created it (funder/admin) |
| `mint` | Pubkey | SPL mint, **or `NATIVE_SOL_MINT` (all-zero) ⇒ native SOL** |
| `vault` / `vault_authority` | Pubkey / Pubkey | the SPL vault ATA + its PDA authority (default/zero for native) |
| `campaign_id` | u64 | lets one creator run many campaigns (it's in the PDA seeds) |
| `merkle_root` | `[u8;32]` | **the recipient-set commitment** |
| `leaf_count` | u32 | bounds the accepted proof length |
| `total_supply` / `total_claimed` | u64 / u64 | funded amount vs. cumulative paid out (the `OverClaim` guard denominator) |
| `cancellable` / `cancel_authority` | bool / Option<Pubkey> | whether clawback is enabled and who can trigger it |
| `cancelled_at` | Option<i64> | **the cancel clamp** — freezes vesting at this timestamp |
| `paused` / `pause_authority` | bool / Option<Pubkey> | emergency stop |
| `milestone_released_flags` | `[u8;32]` | 256-bit bitmap of released milestones |
| `min_cliff_time` | i64 | earliest cliff across leaves (gates `instant_refund`) |
| `instant_refunded` | bool | permanent lock after a nuclear refund |
| `created_at`, `bump` | i64, u8 | bookkeeping |

**Native-SOL trick:** `is_native()` returns `mint == NATIVE_SOL_MINT` (`Pubkey::new_from_array([0u8;32])`). When true, there is **no vault ATA** — lamports sit directly on the `VestingTree` PDA, and "transfer" is a raw lamport debit. This skips wSOL wrapping entirely (see `docs/guides/native-sol-vesting.md`).

### `ClaimRecord` — per-claimant ledger (the Issue #29 account)
`state/claim_record.rs`. One per `(tree, beneficiary)`. PDA seeds: `["claim", tree, beneficiary]`. Created lazily via `init_if_needed` on first claim (the **claimant pays its rent**). **`#[account(zero_copy)]`** (not Borsh) — 232 bytes.

Why `zero_copy`: legacy v0 accounts were 121 bytes; `zero_copy` lets the program **load by discriminator and `realloc`-grow them on first touch** (see `migrate_legacy_claim_record`), so the Issue #29 fix shipped without migrating every existing account in a separate step.

Fields (the per-leaf ledger is the key part):
- `claimed_amount` (u64) — running **sum** paid to this beneficiary across all leaves (read by events + `close_claim_record`).
- `total_entitled` (u64) — running sum of every leaf's `amount` they've *touched* (gates `close_claim_record` without trusting caller values).
- `milestone_bitmap` (`[u8;32]`) — which milestones this beneficiary has claimed (milestones don't use the ledger).
- `version` (u8) — `0` = legacy, `1` = per-leaf ledger active.
- **`leaf_claimed_idx[8]` / `leaf_claimed_amt[8]`** — parallel arrays (`PER_LEAF_CAP = 8`): for each distinct cliff/linear leaf this beneficiary holds, the `leaf_index` and the cumulative amount already paid on it. `EMPTY_LEAF_SLOT = u32::MAX` marks a free slot (0 is a valid index, so a non-zero sentinel is required).

> The explicit `_pad_leaf_idx` / `_pad_leaf_amt` fields exist because `zero_copy` uses `bytemuck::Pod`, which **forbids implicit padding** — the layout must be exactly `repr(C)` with no gaps, so legacy v0's first 121 bytes still map onto the new struct for migration.

### `VestingLeaf` — one recipient's terms (never stored)
`state/leaf.rs`. **70 bytes**, passed in instruction **data** (on `claim`/`withdraw`/`get_vested_amount`), never persisted on-chain. It *is* hashed into the Merkle tree off-chain.

```
leaf_index:u32 | beneficiary:Pubkey | amount:u64 | release_type:u8 |
start_time:i64 | cliff_time:i64 | end_time:i64 | milestone_idx:u8
```
`release_type`: **0 = Cliff, 1 = Linear, 2 = Milestone.** `leaf_index` is hashed in, so two leaves with identical terms at different positions hash differently — a proof for leaf A **cannot** be replayed at leaf B's index (proven by `distinct_indices_yield_distinct_hashes` in `math/merkle.rs`).

> `start_time` is **ignored** by the vesting math — only `cliff_time`/`end_time` matter (proven by `start_before_cliff_same_as_start_eq_cliff`). It exists for indexing/UI.

---

## 3. Instruction map — grouped by lifecycle

18 entrypoints in `lib.rs` (many have SPL + native variants). This is a *tour*; full account/constraint detail is in `docs/reference/instructions.md`.

### Setup (distributor)
| ix | signer | what it does | key guard |
|---|---|---|---|
| `create_campaign(_native)` | creator | `init` the `VestingTree` with the root, supply, authorities. SPL also `init`s the vault ATA. | non-empty root; `min_cliff_time != 0`; if `cancellable` then `cancel_authority` required; **Token-2022 mints rejected** (`UnsupportedMint`) |
| `create_stream(_native)` | creator | convenience for **1 recipient**: builds the leaf, sets `root = leaf_hash(leaf)`, and **funds immediately** (CPI transfer). `leaf_count = 1`. | `start ≤ cliff ≤ end`, `release_type ≤ 2`, `amount > 0` |
| `fund_campaign(_native)` | creator | top up the vault up to `total_supply` | `vault + amount ≤ total_supply` (`OverFunded`); not cancelled |

> `create_campaign` does **not** move tokens (fund separately); `create_stream` **does** (one-shot). A single-leaf tree's root *is* the leaf hash, so no proof is needed to claim it — that's what `withdraw` exploits.

### Claim (beneficiary)
| ix | signer | what it does | key guard |
|---|---|---|---|
| `claim` | beneficiary | verify proof vs root → compute vested delta → pay → write `ClaimRecord` | `beneficiary == leaf.beneficiary`; proof ≤ `MAX_MERKLE_PROOF_LEN(32)` **and** ≤ `ceil(log2 leaf_count)`; not paused (unless in grace); `OverClaim` |
| `withdraw` | beneficiary | same as claim but for **single-leaf** streams — no proof (checks `leaf_hash(leaf) == root`) | `leaf_count == 1` |

### Clawback / admin
| ix | signer | what it does |
|---|---|---|
| `update_root` | cancel_authority | **rotate the root** (add/remove recipients); soft clawback |
| `cancel_campaign` | cancel_authority | freeze vesting at `now` (`cancelled_at`), clear pause → 7-day grace begins |
| `cancel_stream` | creator | single-stream: atomically pay beneficiary vested portion + refund remainder to creator (no grace) |
| `withdraw_unvested` | creator | **after 7-day grace**: sweep remaining vault to creator |
| `instant_refund_campaign` | creator | **nuclear**: refund entire vault instantly; only before any cliff, multi-leaf, no milestones released; sets `instant_refunded` (permanent lock) |

### Safety
| ix | signer | what it does |
|---|---|---|
| `pause_campaign` / `unpause_campaign` | pause_authority | block/allow claims (claims still allowed during grace even if paused) |
| `set_milestone_released` | creator | flip a bit in `milestone_released_flags` → milestone leaves become claimable |
| `close_claim_record` | beneficiary | reclaim the `ClaimRecord` rent (only when fully claimed, or post-grace) |

### View
| ix | what it does |
|---|---|
| `get_vested_amount` | read-only CPI helper: returns how much of a leaf has vested at `now` (for lending/DAO integrations). See the Math doc §6. |

---

## 4. End-to-end lifecycle walkthrough

**Create + fund (multi-recipient / Bulk Send):**
1. Off-chain, the BE builds the Merkle tree from the recipient list (`apps/web/src/lib/merkle/builder.ts` + `clients/ts/src/prepare.ts` `prepareCampaign`), producing `root`, `leaf_count`, `total_supply`, and per-leaf proofs.
2. Distributor signs `create_campaign` (or `_native`) → `VestingTree` `init`'d with the root. Then `fund_campaign` → tokens move from the creator's ATA into the vault (native: SOL into the PDA). Emits `CampaignCreated`, `CampaignFunded`.
3. BE registers the campaign + leaves + proofs in Postgres (for proof serving + the dashboard). See `docs/guides/integration.md`, `docs/frontend/architecture.md`.

**Claim:**
4. Beneficiary connects wallet on `/campaign/[id]`; FE calls `GET /api/campaigns/[id]/proof?beneficiary=…` → BE returns that beneficiary's leaf + proof.
5. Beneficiary signs `claim(leaf, proof)`. Program: verify proof → `claimable = vested(leaf, effective_now) − leaf_prior_claimed` → check vault + `OverClaim` → pay → `init_if_needed`/update `ClaimRecord`. Emits `Claimed`.
6. FE posts the event to the indexer (`/api/events/sync`); dashboard updates.

**Clawback (example — cancel + grace):**
7. Contributor leaves. `cancel_authority` signs `cancel_campaign` → `cancelled_at = now`, pause cleared. Emits `CampaignCancelled`.
8. For 7 days (`GRACE_PERIOD_SECS = 604800`) beneficiaries can still claim everything vested *up to `cancelled_at`* (the clamp). After grace, creator signs `withdraw_unvested` → remaining vault swept to creator. Emits `UnvestedWithdrawn`.
9. A beneficiary whose position is fully claimed (or post-grace) can `close_claim_record` to reclaim that account's rent.

---

## 5. Double-claim prevention — three layers (+ the Issue #29 story)

A recipient must never be paid more than their schedule allows, and the tree must never pay out more than `total_supply`. Three independent guards (all in `claim.rs`):

1. **Per-leaf delta (the precision layer).** `claimable = vested(leaf, effective_now) − leaf_prior_claimed(leaf.leaf_index)`. Each distinct leaf a beneficiary holds is tracked **independently** in the per-leaf ledger, so claiming leaf A doesn't reduce leaf B.
2. **Tree-level `OverClaim` (the hard ceiling).** `require!(tree.total_claimed + claimable ≤ tree.total_supply)`. Even across *different* beneficiaries with separate `ClaimRecord`s, the global accumulator blocks any payout beyond supply. (Tested adversarially: `audit_claim3_overclaim_guard_fires_when_supply_underfunded`.)
3. **Per-beneficiary milestone bitmap.** For milestone leaves, a 256-bit bitmap ensures each milestone index is claimed at most once (`MilestoneAlreadyClaimed`).

**The Issue #29 bug.** Pre-fix, `ClaimRecord` tracked only a *single cumulative* `claimed_amount` per beneficiary. When the same beneficiary held **multiple** cliff/linear leaves, claiming leaf A set the cumulative bar, and leaf B was **starved** (it could only claim `vested(B) − claimed_amount_so_far`, which was already eaten by A). Fix (`adr-003`): the per-leaf ledger (`leaf_claimed_idx`/`leaf_claimed_amt`, `PER_LEAF_CAP = 8`) makes each leaf's delta independent. Shipped via `zero_copy` so legacy v0 accounts `realloc`-grow on first touch (`migrate_legacy_claim_record`), with `version` to detect migration state. The schedule.rs test suite (`audit_claim3_*`) proves both leaves now pay in full and the tree never overspends.

---

## 6. The three clawback mechanisms, compared

(See `docs/guides/clawback.md`, `docs/decisions/adr-fe-007-cancel-design.md`.)

| | **root rotation** (`update_root`) | **cancel + grace** (`cancel_campaign` → `withdraw_unvested`) | **instant refund** (`instant_refund_campaign`) |
|---|---|---|---|
| Who | cancel_authority | cancel_authority (cancel) / creator (withdraw) | **creator only** |
| When | anytime pre-cancel; repeatable | anytime before full vest | only **before any cliff**, multi-leaf, no milestones released |
| Effect | swap root/leaf_count/min_cliff | freeze vesting at `now`; 7-day claim window; then sweep | refund **entire** vault instantly |
| Beneficiary keeps | everything already claimed + new-root entitlements | everything vested up to `cancelled_at` (if claimed in grace) | **nothing** |
| Reversible? | yes (rotate again) | no (`cancelled_at` set) | no (`instant_refunded` permanent lock) |
| "Softness" | softest — selective, granular | medium — fair window | hardest — nuclear, strict preconditions |

Use **root rotation** to cleanly drop/add a recipient; **cancel + grace** to wind down a campaign fairly; **instant refund** only as an undo before anything has started.

---

## 7. Security invariants (what you can assert in a pitch)

All enforced in `programs/vesting/src/`. Cross-link: `docs/security/threat-model.md`, `docs/security/audit-report.md`.

- **`OverClaim` tree-level guard** — total paid out across *all* beneficiaries can never exceed `total_supply`. Checked in every payout path (`claim`, `withdraw`, `cancel_stream`) before the transfer.
- **CEI pattern** — every handler does Checks → Effects (mutate state) → Interactions (CPI/lamport move). State is committed before any external transfer.
- **`init_if_needed` reinit guard** — `ClaimRecord` load detects an all-zero discriminator to distinguish fresh vs. existing, blocking malicious re-initialization of an already-funded account.
- **Native-SOL rent safety** — transfers refuse to drop the PDA below rent-exempt (`NativeSolRentViolation`), except a *final* claim which drains everything (the PDA is done). `withdraw_unvested`/`instant_refund` preserve rent so the PDA stays alive for indexers.
- **Token-2022 rejection** (`UnsupportedMint`) — only classic SPL Token accepted, so transfer fees can't silently desync `claimable` from the actual vault deduction.
- **Proof double-length check** — proof must be ≤ `MAX_MERKLE_PROOF_LEN` (32) **and** ≤ `ceil(log2 leaf_count)`; blocks padded/shortened forgery (proven by the `audit_claim2_*` suite).
- **Pause/cancel interaction** — cancel clears pause so grace claims always work; you can't pause a cancelled campaign.
- **Authority separation** — `creator` (funder), `cancel_authority` (clawback), `pause_authority` (stop) are distinct and independently checkable; intended for multisig separation (see `docs/operations/multisig-setup.md`).
- **Audited** — internal audit by Daemon Blockint (2026-05-17); 2 HIGH findings (double-payout, pause+cancel lockout) **fixed and deployed**. External audit is a mainnet prerequisite.

---

## 8. SPL vs native-SOL — the dual path

Most instructions have an SPL and a `_native` variant sharing one handler (`handler` / `handler_native`). The native path drops the mint/vault/ATA/token accounts and uses `Option<T>` accounts resolved to a **sentinel** (`PROGRAM_ID`) in the client (`tests/vesting-native-sol.spec.ts`: `SENTINEL = PROGRAM_ID`). On-chain, `Option::None` → no CPI to the Token program; "transfer" is a lamport debit from the PDA.

**Why native SOL exists:** wrapping SOL as wSOL to use an SPL-only path adds friction (wrap/unwrap, extra accounts, ~0.00204 SOL wSOL rent) and a failure mode. Native lets a campaign pay in raw SOL with fewer accounts and lower cost. Full rationale: `docs/guides/native-sol-vesting.md`.

---

## 9. Where to go deeper (cross-links — this guide is the front door)

| Want detail on… | Read |
|---|---|
| Every instruction's accounts/constraints/errors | `docs/reference/instructions.md` |
| Account layouts, sizes, rent, constants | `docs/reference/accounts-and-state.md` |
| Cliff/Linear/Milestone formulas + examples | `docs/reference/schedule-types.md` **and** `MERKLE_AND_VESTING_MATH.md` (sibling doc) |
| All 41 error codes | `docs/reference/error-codes.md` |
| CU per instruction (measured) | `docs/reference/compute-budget.md` |
| End-to-end integration (TS) | `docs/guides/integration.md` |
| Clawback UX + decision flowchart | `docs/guides/clawback.md`, `docs/decisions/adr-fe-007-cancel-design.md` |
| Why Merkle compression (cost rationale) | `docs/decisions/adr-001-merkle-compressed-vesting.md`, `docs/internal/MERKLE_FEE_VS_JITO_REPORT.md` |
| Why Keccak-256 + 0x00/0x01 prefixes | `docs/decisions/adr-002-keccak-256-domain-separation.md`, `MERKLE_AND_VESTING_MATH.md` |
| The Issue #29 per-leaf ledger | `docs/decisions/adr-003-issue-29-per-leaf-ledger.md` |
| Threat model + audit | `docs/security/threat-model.md`, `docs/security/audit-report.md` |
| Native-SOL design | `docs/guides/native-sol-vesting.md` |
| Frontend architecture / data flow | `docs/frontend/architecture.md` |
| Backend API + DB schema | `docs/reference/api-endpoints.md`, `docs/reference/database-schema.md` |

**Companion doc:** `MERKLE_AND_VESTING_MATH.md` (sibling) — the math: hashing, proof verification, the vesting formulas with worked numbers, and `get_vested_amount`/Phase 2.
