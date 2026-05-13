# PDD — Velthoryn Protocol

**Author:** Lana — smart-contract / backend lead  
**Status:** Week 4 complete — all features implemented and tested on devnet
**Date:** 2026-05-08
**Program ID:** `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` (deployed, Solana devnet)
**Framework:** Anchor 1.0.0

**Companion docs:**
- `docs/PRD_LANA.md` — business requirements, user stories, acceptance criteria
- `docs/TDD_LANA.md` — implementation details, Rust code, test plan
- `docs/SECURITY.md` — attack surface tables, threat model, mitigations
- `docs/INTEGRATION.md` — frontend call patterns, TypeScript SDK usage
- `docs/PROGRAM.md` — IDL, account layout reference, instruction signatures

---

## §1 Executive Summary

### §1.1 Protocol Purpose

Velthoryn is a non-custodial, Merkle-compressed SPL token vesting protocol on Solana. It enables a single creator to vest tokens to an unlimited number of beneficiaries at a fixed on-chain cost of approximately 0.005 SOL, regardless of recipient count. Recipients self-authenticate via wallet signature combined with a Merkle inclusion proof, then pull their claimable tokens directly from a PDA-controlled vault.

The protocol supports three schedule types — cliff, linear, and milestone — which can be mixed freely within a single campaign. All schedule types are parameterized within the off-chain leaf structure; the on-chain program evaluates the schedule at claim time against the current clock.

### §1.2 Design Philosophy

Three principles govern every design decision in this protocol:

**Principle 1: O(1) on-chain footprint via Merkle compression.** The protocol stores one 32-byte Merkle root on-chain instead of one account per recipient. Recipient data (amount, schedule, wallet) lives off-chain in the Merkle tree and is passed as instruction arguments at claim time. The proof is verified against the stored root. Adding recipients does not increase creator-side rent cost.

**Principle 2: Trustless vault custody via PDA authority.** Tokens are held in a standard SPL token account (ATA) whose authority is a Program-Derived Address (`vault_authority`). No private key controls the vault. The program is the only entity that can authorize transfers out of the vault, and it does so only after validating the claim's Merkle proof, schedule state, and accounting invariants.

**Principle 3: Composability via read-only CPI.** The `get_vested_amount` instruction is a pure read-only query that returns a beneficiary's currently vested amount without mutating any state. DeFi protocols (lending markets, governance registrars) can simulate this CPI to determine collateral or voting weight without triggering a claim. The interface takes no accounts and is stable across protocol upgrades.

### §1.3 Scope

**In scope (Phase 1):**
- 12 instructions: `create_campaign`, `create_stream`, `fund_campaign`, `claim`, `withdraw`, `cancel_campaign`, `update_root`, `withdraw_unvested`, `pause_campaign`, `unpause_campaign`, `close_claim_record`, `get_vested_amount`
- 3 schedule types: cliff (release_type=0), linear (release_type=1), milestone (release_type=2)
- Root rotation with cancel_authority gating
- Cancellation with 7-day grace period and unvested-token sweep
- Pause/unpause operational control
- Rent reclaim via `close_claim_record`
- Read-only CPI hook (`get_vested_amount`) for DeFi composability

**Out of scope (Phase 1 — deferred to Phase 2):**
- Frontend UI (owned by Geral; see `INTEGRATION.md`)
- IPFS content addressing and pinning infrastructure
- On-chain governance
- Token-2022 mint support (transfer fees cause delivery shortfall; rejected at campaign creation)
- Squads v4 multisig integration for cancel_authority
- Pinocchio performance rewrite
- Formal fuzzing harness (proptest / cargo-fuzz)

---

## §2 Design Goals and Trade-offs

### §2.1 Primary Goals

| # | Goal | How it is achieved |
|---|---|---|
| G1 | Fixed on-chain creator cost regardless of N recipients | Merkle root (32 bytes) replaces one-PDA-per-recipient storage |
| G2 | Self-custodying recipients (pull model) | Beneficiary signs the claim transaction; vault_authority PDA signs only after proof verification |
| G3 | Schedule flexibility — cliff, linear, and milestone can coexist in one campaign | release_type field in VestingLeaf; schedule logic branched at claim time |
| G4 | Cancellation safety — recipients earn what vests before cancellation | Grace period (7 days) allows claims; `effective_now` clamp freezes vesting curve at cancelled_at |
| G5 | Composability — DeFi protocols can read vested balance without claiming | `get_vested_amount` is a stateless CPI that takes no accounts |

### §2.2 Accepted Trade-offs

| Trade-off | What was accepted | Why |
|---|---|---|
| Off-chain data availability | If off-chain leaf data (IPFS) is lost, beneficiaries cannot construct proofs | Cost: storing all leaf data on-chain would eliminate the O(1) footprint |
| Per-beneficiary ClaimRecord rent | Each beneficiary pays ~0.0009 SOL on first claim, refundable via close_claim_record | Required for tamper-proof, per-user claim history without trusting the leaf |
| Root rotation causes proof invalidation | After update_root, all old proofs are invalid until new proofs are distributed | Flexibility to correct recipient errors is worth the operational window |
| Linear schedule floor division dust | Floor division may leave up to 1 token unclaimable until end_time | Integer arithmetic is required on-chain; floating-point is not available |
| Single-key cancel_authority (Phase 1) | A compromised cancel_authority can cancel the campaign and rotate the root | Full multisig is a Phase 2 dependency; single-key is workable for trusted deployments |

---

## §3 Protocol Actors and Trust Model

| Actor | Operations permitted | Trust basis | Phase 2 upgrade path |
|---|---|---|---|
| **Creator** | `create_campaign`, `fund_campaign`, `withdraw_unvested` (post-grace) | Signer of the creating transaction; address stored in `VestingTree.creator` | N/A — creator is a single-use role after campaign creation |
| **cancel_authority** | `cancel_campaign`, `update_root` | Stored in `VestingTree.cancel_authority`; may equal creator or any other pubkey, including a multisig PDA | Squads v4 multisig replaces single EOA key |
| **pause_authority** | `pause_campaign`, `unpause_campaign` | Stored in `VestingTree.pause_authority`; optional at creation | May be delegated to an operations key separate from creator |
| **Beneficiary** | `claim`, `close_claim_record` | Untrusted — self-authenticating via wallet signature + Merkle proof; the proof links wallet address to the on-chain root | N/A — trustless by design |
| **DeFi Protocol (Phase 2)** | `get_vested_amount` via CPI simulation | Read-only; no accounts passed; no state mutation possible | Stable interface locked in Phase 1 |

**Key risk:** cancel_authority is the highest-trust key after campaign creation. Compromise allows cancellation, root rotation to exclude recipients, and sweeping unvested tokens after the grace period. Operational guidance: set cancel_authority to a hardware wallet or multisig for any campaign with material value. See `SECURITY.md` for threat analysis.

---

## §4 Campaign Lifecycle and State Machine

### §4.1 Campaign States

| State | Encoding on-chain | Entry condition | Exit condition |
|---|---|---|---|
| **Created** | `VestingTree` account exists; vault ATA initialized | `create_campaign` executed successfully | Any `fund_campaign` call |
| **Funded / Active** | `vault.amount > 0`, `cancelled_at == None`, `paused == false` | First `fund_campaign` | `pause_campaign` or `cancel_campaign` |
| **Paused** | `paused == true` | `pause_campaign` by pause_authority | `unpause_campaign` by pause_authority |
| **Cancelled** | `cancelled_at == Some(timestamp)` | `cancel_campaign` by cancel_authority | Terminal for this field; grace period begins immediately |
| **Swept** | No distinct field; inferred from `cancelled_at.is_some()` AND `now >= cancelled_at + GRACE_PERIOD_SECS` AND vault is empty | `withdraw_unvested` after grace period expires | N/A — final state |

Notes:
- Paused and Active are reversible. Cancelled is terminal.
- A campaign can be paused before it is funded. The pause guard fires before any accounting.
- A Cancelled campaign cannot be paused, unpaused, or have its root rotated (error 6023 CampaignCancelled).

### §4.2 State Transition Diagram

```
                    ┌─────────────────────────┐
                    │         [Created]        │
                    │  VestingTree initialized │
                    │  vault empty             │
                    └───────────┬─────────────┘
                                │
                         fund_campaign
                      (amount > 0, !OverFunded)
                                │
                                ▼
                    ┌─────────────────────────┐
              ┌────►│    [Funded / Active]     │◄────┐
              │     │  vault.amount > 0        │     │
              │     │  cancelled_at = None     │     │
              │     │  paused = false          │     │
              │     └─────┬──────────┬─────────┘     │
              │           │          │                │
          unpause         │        pause_campaign     │
          (pause_auth)    │        (pause_auth,       │
              │           │         pause_auth set,   │
              │           │         !cancelled)       │
              │           │          │                │
              │           │          ▼                │
              │           │   ┌──────────────┐        │
              └───────────┼───│   [Paused]   │        │
                          │   │ paused=true  │────────┘
                          │   └──────────────┘     unpause
                          │
                   cancel_campaign
                   (cancellable=true,
                    cancel_auth matches,
                    !already_cancelled)
                          │
                          ▼
                ┌──────────────────────┐
                │    [Cancelled]       │
                │  cancelled_at = now  │
                │  grace period begins │
                └──────────┬───────────┘
                           │
                           │  claims still allowed during grace period
                           │  (effective_now clamped to cancelled_at)
                           │
               now >= cancelled_at + 604800s
                           │
                           ▼
                ┌──────────────────────┐
                │      [Swept]         │
                │  withdraw_unvested   │
                │  vault → creator_ata │
                └──────────────────────┘
```

Guard conditions per transition:

| Transition | Instruction | Guards that must pass |
|---|---|---|
| Created → Funded | `fund_campaign` | `amount > 0`, `vault + amount <= total_supply` |
| Active → Paused | `pause_campaign` | `pause_authority.is_some()`, signer matches, `!cancelled`, `!paused` |
| Paused → Active | `unpause_campaign` | `paused == true` |
| Active → Cancelled | `cancel_campaign` | `cancellable == true`, signer matches cancel_authority, `!cancelled` |
| Cancelled → Swept | `withdraw_unvested` | `cancelled_at.is_some()`, `now >= cancelled_at + GRACE_PERIOD_SECS` |

### §4.3 Non-Cancellable Variant

If `cancellable = false` at `create_campaign` time:
- `cancel_campaign` is permanently blocked (error 6019 NotCancellable).
- `update_root` is permanently blocked (same cancellable flag gates root rotation).
- Vault tokens are locked until fully claimed by beneficiaries.
- The campaign has no terminal sweep path — unvested dust remains in the vault permanently if beneficiaries do not claim.

Creators should use `cancellable = false` only when the recipient list is final and immutable, and the total supply matches exactly what will be claimed.

### §4.4 Grace Period

`GRACE_PERIOD_SECS = 604800` (7 days). The clock starts at `cancelled_at` (written by `cancel_campaign`).

**During grace period (`now < cancelled_at + 604800`):**
- Beneficiaries MAY still call `claim`. The vesting curve is frozen: `effective_now = min(now, cancelled_at)`. A beneficiary who had not yet claimed their full vested-at-cancellation amount can still do so.
- `withdraw_unvested` is blocked (error 6026 GracePeriodActive).
- `close_claim_record` is blocked unless the record is fully claimed.

**After grace period (`now >= cancelled_at + 604800`):**
- Creator may call `withdraw_unvested` to transfer all remaining vault tokens to `creator_ata`.
- Beneficiaries may call `close_claim_record` to reclaim ClaimRecord rent, even if the record is not fully claimed (tokens were swept).
- Claims are still technically possible if vault is not yet swept, but in practice vault will be empty after `withdraw_unvested`.

### §4.5 Beneficiary Lifecycle

1. Creator publishes off-chain Merkle tree containing beneficiary's leaf.
2. Beneficiary obtains their leaf data and Merkle proof (from IPFS or frontend).
3. Beneficiary calls `claim` for the first time — `init_if_needed` initializes their `ClaimRecord`.
4. On subsequent claims, the existing `ClaimRecord` is loaded; `claimed_amount` is incremented.
5. When fully vested (or post-grace), beneficiary calls `close_claim_record` to reclaim the ~0.0009 SOL ClaimRecord rent.

---

## §5 Account Model

### §5.1 VestingTree PDA

**Seeds:** `["tree", creator_pubkey, mint_pubkey, campaign_id.to_le_bytes()]`  
**Total allocation:** 282 bytes (8-byte discriminator + 274 bytes INIT_SPACE)  
**Owner:** program `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`

| Field | Type | Size (bytes) | Mutated by | Invariant |
|---|---|---|---|---|
| `creator` | `Pubkey` | 32 | Never after init | Address that called `create_campaign`; receives swept tokens |
| `mint` | `Pubkey` | 32 | Never after init | SPL Token (not Token-2022) mint; verified against vault at creation |
| `vault` | `Pubkey` | 32 | Never after init | Address of the campaign's token ATA; stored to prevent vault substitution attacks |
| `vault_authority` | `Pubkey` | 32 | Never after init | Address of the `VaultAuthority` PDA; co-signer on all vault transfers |
| `campaign_id` | `u64` | 8 | Never after init | Unique per (creator, mint) pair; enables multiple campaigns per creator per mint |
| `merkle_root` | `[u8; 32]` | 32 | `update_root` (cancel_authority) | Must not be `[0u8; 32]`; encodes the full recipient set |
| `leaf_count` | `u32` | 4 | `update_root` | Must be > 0 |
| `total_supply` | `u64` | 8 | Never after init | Maximum tokens the vault may ever hold; enforced by `fund_campaign` |
| `total_claimed` | `u64` | 8 | `claim` | Monotonically increasing; bounded by `total_supply` |
| `cancellable` | `bool` | 1 | Never after init | If false, `cancel_campaign` and `update_root` are permanently blocked |
| `cancel_authority` | `Option<Pubkey>` | 33 | Never after init | Required when `cancellable = true`; gated by error 6003 |
| `cancelled_at` | `Option<i64>` | 9 | `cancel_campaign` (once) | None = active; Some(ts) = cancelled at unix timestamp ts; terminal |
| `paused` | `bool` | 1 | `pause_campaign`, `unpause_campaign` | Blocks `claim` when true |
| `pause_authority` | `Option<Pubkey>` | 33 | Never after init | None = no pause capability (error 6021 if pause attempted) |
| `created_at` | `i64` | 8 | Never after init | Unix timestamp at campaign creation; informational |
| `bump` | `u8` | 1 | Never after init | Canonical PDA bump; cached to avoid re-derivation |

**Key invariant:** The `vault` and `vault_authority` fields are stored in the account at creation and compared against the accounts passed into each subsequent instruction. This prevents an attacker from passing a substitute vault or vault_authority in later calls. See `SECURITY.md` for substitution attack analysis.

### §5.2 ClaimRecord PDA

**Seeds:** `["claim", vesting_tree_pubkey, beneficiary_pubkey]`  
**Total allocation:** 121 bytes (8-byte discriminator + 113 bytes INIT_SPACE)  
**Owner:** program `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`  
**Initialization:** `init_if_needed` on first `claim` call; rent paid by beneficiary

| Field | Type | Size (bytes) | Mutated by | Invariant |
|---|---|---|---|---|
| `beneficiary` | `Pubkey` | 32 | Set on first touch | Used as first-touch sentinel: `== Pubkey::default()` means uninitialized |
| `tree` | `Pubkey` | 32 | Set on first touch | Address of the parent VestingTree; links record to campaign |
| `claimed_amount` | `u64` | 8 | `claim` | Monotonically increasing; tracks total tokens claimed by this beneficiary across all claims |
| `milestone_bitmap` | `[u8; 32]` | 32 | `claim` (milestone type only) | 256 bits; bit at index `milestone_idx` is set after each milestone claim; prevents double-claim |
| `last_claim_at` | `i64` | 8 | `claim` | Unix timestamp of most recent successful claim; informational |
| `bump` | `u8` | 1 | Never after init | Canonical PDA bump; cached |

**First-touch detection:** The program detects a first-time claim by checking `cr.beneficiary == Pubkey::default()`. If so, it writes `beneficiary` and `tree` fields. This is necessary because `init_if_needed` does not zero the account on re-open; without the sentinel check, a re-opened (closed and re-created) account would skip initialization.

**milestone_bitmap:** 256 bits accommodate `milestone_idx` values 0 through 255 inclusive. `MAX_MILESTONES = 255` means a beneficiary can have up to 255 distinct milestone leaves per campaign; the 256th bit (index 255) is valid because the bitmap is 0-indexed.

**Lifecycle:** Init on first claim → updated on each subsequent claim → closed via `close_claim_record` → lamports returned to beneficiary. Net rent cost to beneficiary after closing: 0.

### §5.3 VestingLeaf (Off-Chain Struct)

The `VestingLeaf` is NOT an on-chain account. It is a 70-byte Borsh little-endian serialized struct that lives in the off-chain Merkle tree. It is passed as an instruction argument to `claim` and `get_vested_amount`, where it is deserialized, hashed with `LEAF_PREFIX`, and verified against the stored root.

**Wire format — 70 bytes, Borsh LE:**

| Field | Type | Offset | Size (bytes) | Notes |
|---|---|---|---|---|
| `leaf_index` | `u32` | 0 | 4 | Position of this leaf in the tree; determines proof path direction |
| `beneficiary` | `Pubkey` | 4 | 32 | Wallet address authorized to claim this leaf |
| `amount` | `u64` | 36 | 8 | Total tokens this leaf entitles the beneficiary to |
| `release_type` | `u8` | 44 | 1 | 0 = Cliff, 1 = Linear, 2 = Milestone |
| `start_time` | `i64` | 45 | 8 | Unix timestamp; informational (used for schedule validation) |
| `cliff_time` | `i64` | 53 | 8 | Unix timestamp at which vesting begins (cliff) or linear portion starts |
| `end_time` | `i64` | 61 | 8 | Unix timestamp at which full amount is vested (linear) or schedule ends |
| `milestone_idx` | `u8` | 69 | 1 | Index into ClaimRecord.milestone_bitmap; only meaningful for release_type=2 |
| **Total** | | | **70** | |

**Schedule validation** (`InvalidSchedule`, error 6011): The program enforces `start_time <= cliff_time <= end_time` on every `claim`. Leaf data supplied by the claimant is untrusted until the Merkle proof verifies; the schedule check runs before proof verification.

**Canonical Borsh LE** means integers are little-endian and no padding bytes are inserted between fields. The off-chain TypeScript serializer must match this layout exactly. See `TDD_LANA.md §4` for the golden-vector test requirement.

### §5.4 VaultAuthority PDA

**Seeds:** `["vault_authority", vesting_tree.key()]`  
**Data:** None (zero-byte account, never deserialized)  
**Type in Anchor context:** `UncheckedAccount`

The `VaultAuthority` PDA is the SPL token account authority for the campaign vault. It holds no data and no lamports beyond the minimum. Its only function is to serve as a PDA signer: when the program calls `token::transfer` from the vault, it provides this PDA as the authority, using the seeds and bump to generate the signer seeds.

`UncheckedAccount` is safe here because:
1. The Anchor `seeds` constraint on the account validates its address before the instruction body runs.
2. The account is never read or written — it is used only as a signer identity.
3. There is no deserialization step that could be exploited with malformed data.

### §5.5 PDA Derivation Reference

| PDA | Seeds (byte-level, in order) | Program | Notes |
|---|---|---|---|
| `VestingTree` | `b"tree"` \|\| `creator.to_bytes()` \|\| `mint.to_bytes()` \|\| `campaign_id.to_le_bytes()` | This program | Unique per (creator, mint, campaign_id) tuple; creator can run multiple campaigns per mint by incrementing campaign_id |
| `ClaimRecord` | `b"claim"` \|\| `vesting_tree.key().to_bytes()` \|\| `beneficiary.to_bytes()` | This program | One record per (beneficiary, tree) pair; unique within a campaign |
| `VaultAuthority` | `b"vault_authority"` \|\| `vesting_tree.key().to_bytes()` | This program | One per campaign; controls all vault outflows |

---

## §6 Storage and Cost Model

### §6.1 Fixed Campaign Cost

The rent-exempt minimum on Solana is approximately `6960 lamports per byte` (at the time of writing; the exact value is set by the runtime and may change). All costs below use this rate.

**VestingTree PDA:**
- Total allocation: 282 bytes
- Rent-exempt minimum: 282 × 6960 ≈ 1,962,720 lamports ≈ 0.00196 SOL

**Vault ATA (standard SPL token account):**
- Fixed size: 165 bytes
- Rent-exempt minimum: 165 × 6960 ≈ 1,148,400 lamports ≈ 0.00205 SOL (plus ATA init fee)

**Total fixed creator cost:** ~0.004 SOL in rent + ATA init overhead ≈ **~0.005 SOL total at any recipient count.**

At $85/SOL (2026-04-19 reference from PRD_LANA.md), this is approximately **$0.42** — a fixed one-time cost for the campaign creator, independent of N.

### §6.2 Per-Beneficiary Cost (Variable, Refundable)

**ClaimRecord PDA:**
- Total allocation: 121 bytes
- Rent-exempt minimum: 121 × 6960 ≈ 842,160 lamports ≈ **0.00084 SOL per beneficiary**

This cost is paid by the beneficiary on their first `claim` call. It is fully refunded when `close_claim_record` is called after the campaign completes or after the grace period expires.

**Net cost to beneficiary after closing: 0 SOL.**

The beneficiary temporarily fronts ~0.0009 SOL; this is the only on-chain cost the recipient bears, and it is recoverable.

### §6.3 Scaling

| Protocol | Storage model | Setup cost for 10K recipients |
|---|---|---|
| Streamflow | 1 PDA per stream | ~$3,720 |
| Jito Distributor | 1 Merkle root | ~$0.20 total |
| **Velthoryn (this protocol)** | 1 Merkle root + 1 vault PDA | **~$0.42 total (fixed)** |

Velthoryn's creator-side cost does not grow with recipient count. Adding a recipient 10,001 to a 10,000-recipient campaign costs 0 additional SOL for the creator. The only marginal cost is off-chain storage (IPFS, negligible).

### §6.4 Compute Budget

Proof verification requires one keccak256 hash per tree level. For a tree of depth D:
- D hash operations in the proof path
- Typical keccak256 cost on Solana: 200–500 CU per hash

For the maximum recommended tree depth (20 levels, 2^20 = 1,048,576 recipients):
- Proof verification: 20 × ~500 CU = ~10,000 CU
- Deserialization, arithmetic, SPL CPI: ~5,000–10,000 CU additional
- Total estimated: **~15,000–25,000 CU**, well under the 200,000 CU per-transaction limit

No priority fee is required for standard claim transactions. Compute budget can be set conservatively to 50,000 CU with margin.

---

## §7 Merkle Design

### §7.1 Hash Function and Domain Separation

The protocol uses **keccak256** (SHA-3 variant, not SHA-256) as its hash function, matching the Solana runtime's `solana_keccak_hasher::hashv`.

**Domain separation:** Two prefixes distinguish leaf hashes from internal node hashes:
- `LEAF_PREFIX = 0x00` — prepended to leaf payloads before hashing
- `NODE_PREFIX = 0x01` — prepended to node child concatenations before hashing

This prevents **second-preimage attacks** where an attacker constructs a 64-byte value that is a valid leaf (70 bytes with prefix = 71 bytes) but also hashes to match an internal node. Because the leaf domain (prefix 0x00) is disjoint from the node domain (prefix 0x01), a hash from one domain cannot be confused with a hash from the other. An internal node hash (33 bytes input: 0x01 || left_hash) cannot equal a leaf hash (71 bytes input: 0x00 || leaf_bytes) even with adversarial inputs.

### §7.2 Leaf Hash

```
leaf_hash(leaf) = keccak256([0x00] || borsh_serialize(leaf))
```

Input size: 1 byte (prefix) + 70 bytes (leaf) = **71 bytes total.**

The leaf is serialized to its canonical 70-byte Borsh LE format (see §5.3) before hashing. Field order and endianness must match exactly between off-chain construction and on-chain verification.

### §7.3 Node Hash

```
node_hash(left, right) = keccak256([0x01] || left || right)
```

Input size: 1 byte (prefix) + 32 bytes (left) + 32 bytes (right) = **65 bytes total.**

Left/right ordering is determined by the leaf index at each tree level:
- `index & 1 == 0`: current hash is the **left** child; sibling from proof is the **right** child.
- `index & 1 == 1`: sibling from proof is the **left** child; current hash is the **right** child.
- After combining: `index >>= 1` advances to the next level.

### §7.4 Tree Construction Algorithm

**Layer 0** (leaves): compute `leaf_hash(leaf[i])` for all `i in 0..leaf_count`.

**Layer k+1** (internal nodes):
```
for i = 0, 2, 4, ..., up to len(layer[k]):
    left  = layer[k][i]
    right = layer[k][i+1]  if i+1 < len(layer[k])
            else layer[k][i]   // odd layer: duplicate the last node
    layer[k+1][i/2] = node_hash(left, right)
```

**Root** = `layer[last][0]` (the single node at the top of the tree).

**Odd-node handling:** If a layer has an odd number of nodes, the last node is duplicated to pair with itself. This is a standard binary Merkle tree convention. Off-chain construction and on-chain proof verification must use the same odd-node rule.

The final tree has `ceil(log2(leaf_count)) + 1` layers. For `leaf_count = 1`, the root equals `leaf_hash(leaf[0])` and the proof is empty.

### §7.5 Proof Verification

On-chain verification algorithm (executed inside `claim`):

```
verify_proof(leaf, proof, root):
    index = leaf.leaf_index
    hash  = leaf_hash(leaf)
    for sibling in proof:
        if index & 1 == 0:
            hash = node_hash(hash, sibling)   // current is left
        else:
            hash = node_hash(sibling, hash)   // current is right
        index >>= 1
    return hash == root
```

**Empty proof (single-leaf tree):** The loop executes zero times. Returns `leaf_hash(leaf) == root`. Correct — a single-leaf tree has its leaf hash as the root.

**Failure mode:** If the computed final hash does not equal `merkle_root` stored in `VestingTree`, the instruction returns error 6013 `InvalidProof`.

### §7.6 Tree Size Limits

| Tree depth | Max recipients | Proof size | Transaction size impact |
|---|---|---|---|
| 10 | 1,024 | 320 bytes | Comfortable |
| 16 | 65,536 | 512 bytes | Comfortable |
| 20 | 1,048,576 | 640 bytes | Approaches 1,232-byte limit when combined with account metas |
| 22 | 4,194,304 | 704 bytes | Likely exceeds transaction size limit |

**Maximum recommended depth: 20 levels (2^20 = 1,048,576 recipients).** Proof size is 20 × 32 = 640 bytes. Combined with instruction data, account metas, and signatures, the total transaction size remains under Solana's 1,232-byte limit for standard single-signer transactions.

Trees deeper than 20 levels risk exceeding the transaction size limit. For campaigns requiring more than ~1M recipients, splitting into multiple campaigns (multiple campaign_id values) is the recommended approach.

### §7.7 Cross-Implementation Compatibility

On-chain (Rust): `solana_keccak_hasher::hashv` with byte-slice arrays.  
Off-chain (TypeScript): `js-sha3` library, `keccak_256` function.

Both implementations must produce byte-identical output for identical inputs. The golden-vector test in `tests/golden_vector.spec.ts` validates this requirement by computing a known leaf hash and root on both sides and asserting equality. Any change to leaf serialization order or prefix values breaks this test. See `TDD_LANA.md §4` for the test specification.

---

## §8 Schedule Mathematics

### §8.1 Schedule Types Overview

The `release_type` field in `VestingLeaf` (u8, offset 44) selects the vesting schedule:

| Value | Name | Behavior |
|---|---|---|
| 0 | Cliff | Full amount unlocks at `cliff_time`; nothing before |
| 1 | Linear | Amount unlocks proportionally between `cliff_time` and `end_time` |
| 2 | Milestone | Full amount unlocks at `cliff_time`; double-claim prevented by bitmap |

All three types can coexist within a single campaign's Merkle tree. A beneficiary can have multiple leaves with different schedule types (e.g., a cliff for an immediate grant and a linear schedule for the remainder).

Any value other than 0, 1, or 2 returns error 6012 `InvalidScheduleType`.

### §8.2 Cliff (release_type = 0)

```
vested(leaf, t):
    if t >= cliff_time: return leaf.amount
    else:               return 0
```

`end_time` is not used by the cliff schedule but must still satisfy `cliff_time <= end_time` to pass the schedule sanity check (error 6011). `start_time` is informational.

### §8.3 Linear (release_type = 1)

```
vested(leaf, t):
    if t >= end_time:   return leaf.amount
    if t <= cliff_time: return 0
    elapsed  = (t - cliff_time) as u128
    duration = (end_time - cliff_time) as u128
    return ((leaf.amount as u128 * elapsed) / duration) as u64
```

**Why u128:** `leaf.amount` is u64 (max ~1.84 × 10^19). Multiplied by `elapsed` (i64, up to ~9.2 × 10^18), the intermediate product can reach ~1.7 × 10^38, which overflows u64 but fits within u128 (max ~3.4 × 10^38). Using u128 for the intermediate calculation prevents overflow.

**Floor division:** The result is truncated toward zero. Near `cliff_time`, the claimable amount may be 0 for small `leaf.amount` values relative to `duration`. This is expected behavior — no error is raised.

**Edge case — cliff_time == end_time:** The `t >= end_time` branch fires first and returns `leaf.amount`. No division by zero occurs. This degenerate linear schedule behaves identically to a cliff schedule.

**Dust:** Floor division means at most 1 token (1 base unit) may remain un-vested until `end_time` is reached. The final `vested(leaf, end_time) = leaf.amount` call returns the full amount regardless of dust from prior calculations.

### §8.4 Milestone (release_type = 2)

Each milestone leaf represents a single milestone event. The full `leaf.amount` unlocks when `t >= cliff_time`. Multiple milestones for the same beneficiary are represented as separate leaves in the Merkle tree with distinct `milestone_idx` values.

**Double-claim prevention:** After a milestone is claimed, bit `milestone_idx` in `ClaimRecord.milestone_bitmap` is set. Subsequent claims for the same leaf check this bit and return error 6014 `MilestoneAlreadyClaimed` if set.

**Bitmap indexing:** `milestone_idx` is a u8 (0–255). The bitmap is `[u8; 32]` = 256 bits. Bit at index `i` is located at `bitmap[i / 8]`, bit `i % 8`. `MAX_MILESTONES = 255` means indices 0–254 are valid for up to 255 distinct milestones; the 256th bit (index 255) is also available if needed.

For a beneficiary with N milestones, the tree contains N separate leaves for that beneficiary, each with a distinct `milestone_idx`. The `ClaimRecord` tracks each independently.

### §8.5 Cancel Clamp (`get_vested_amount`)

All schedule computations pass through `get_vested_amount`, which applies a cancellation clamp:

```
get_vested_amount(leaf, cancelled_at, now):
    effective_now = match cancelled_at:
        Some(cancel_ts) => min(now, cancel_ts)
        None            => now
    return vested(leaf, effective_now)
```

After cancellation, `effective_now` is clamped to `cancel_ts`. The vesting curve is frozen at the cancellation moment. A beneficiary who had partially vested tokens at the time of cancellation can still claim those tokens during the grace period. No additional tokens vest after cancellation.

This function is also the CPI entry point for DeFi protocols, which pass their own `now` value. A DeFi protocol reading collateral value should pass the current clock as `now`.

### §8.6 Claimable Amount

```
claimable = get_vested_amount(leaf, cancelled_at, now) - claimed_amount
```

Implemented as `saturating_sub` to handle the root rotation edge case: if a root rotation reduces `leaf.amount` below the beneficiary's existing `claimed_amount` (e.g., a correction was made), the subtraction saturates to 0 rather than wrapping. This returns `NothingToClaim` (error 6015) rather than a negative or wrapped value.

The claim instruction then checks `claimable > 0` before proceeding. If `claimable == 0` due to either honest nothing-to-claim or post-rotation over-claim, the error is the same: 6015 `NothingToClaim`.

---

## §9 Instruction Reference

### §9.1 create_campaign

**Purpose:** Initialize a VestingTree PDA and its associated vault ATA, establishing a new vesting campaign.

**Required signer:** Creator

**State preconditions:** None — this instruction creates new accounts.

**Validation (all checked before account mutations):**

| Check | Error if fails |
|---|---|
| `args.merkle_root != [0u8; 32]` | 6000 EmptyRoot |
| `args.leaf_count > 0` | 6001 EmptyCampaign |
| `args.total_supply > 0` | 6002 ZeroAmount |
| `args.cancellable == true` implies `args.cancel_authority.is_some()` | 6003 MissingCancelAuthority |
| `mint.owner == spl_token::ID` (not Token-2022) | 6007 MintMismatch (or custom check) |

**State mutations:** Initializes `VestingTree` with all provided arguments. Sets `created_at = Clock::get().unix_timestamp`. Sets `paused = false`, `cancelled_at = None`, `total_claimed = 0`, `leaf_count = 0` (update after first fund). Initializes vault ATA with `vault_authority` as owner.

**Token transfer:** None.

**Event emitted:** `CampaignCreated { tree, creator, mint, total_supply, leaf_count, cancellable }`

**Primary error paths:** 6000, 6001, 6002, 6003, 6007.

---

### §9.2 fund_campaign

**Purpose:** Transfer SPL tokens from the creator's ATA into the campaign vault.

**Required signer:** Creator (matches `VestingTree.creator`)

**State preconditions:** Campaign must not be cancelled (`cancelled_at == None`).

**Validation:**

| Check | Error if fails |
|---|---|
| `amount > 0` | 6002 ZeroAmount |
| `vault.amount + amount <= total_supply` | 6006 OverFunded |
| Provided vault account matches `VestingTree.vault` | 6018 WrongVault |
| Mint of creator_ata matches `VestingTree.mint` | 6007 MintMismatch |

**State mutations:** None on VestingTree (vault balance is tracked by the SPL token runtime, not by VestingTree).

**Token transfer:** `creator_ata → vault` for `amount` tokens. Signed by creator.

**Event emitted:** `CampaignFunded { tree, amount, vault_balance_after }`

**Primary error paths:** 6002, 6006, 6007, 6018.

---

### §9.3 claim

**Purpose:** Verify a beneficiary's Merkle proof and transfer their claimable tokens from vault to beneficiary ATA.

**Required signer:** Beneficiary (must match `leaf.beneficiary`)

**State preconditions:** Campaign must not be paused. Campaign may be cancelled (claims allowed during grace period). Vault must have sufficient balance.

**Validation order (order is non-negotiable — see §10.1):**

| Step | Check | Error if fails |
|---|---|---|
| 1 | `!VestingTree.paused` | 6009 CampaignPaused |
| 2 | `signer == leaf.beneficiary` | 6010 UnauthorizedClaimer |
| 3 | `start_time <= cliff_time <= end_time` | 6011 InvalidSchedule |
| 4 | `release_type in {0, 1, 2}` | 6012 InvalidScheduleType |
| 5 | `verify_merkle_proof(leaf, proof, merkle_root)` | 6013 InvalidProof |
| 6 | First-touch: init ClaimRecord fields if `cr.beneficiary == default` | — |
| 7 | Milestone: check `milestone_bitmap[milestone_idx]` not set | 6014 MilestoneAlreadyClaimed |
| 8 | `claimable = get_vested_amount(...) - claimed_amount; claimable > 0` | 6015 NothingToClaim |
| 9 | `vault.amount >= claimable` | 6016 InsufficientVault |
| 10 | `total_claimed + claimable <= total_supply` (checked_add) | 6017 OverClaim / 6008 Overflow |

**State mutations (all before SPL CPI — CEI pattern):**
- `ClaimRecord.claimed_amount += claimable`
- `ClaimRecord.last_claim_at = now`
- `ClaimRecord.milestone_bitmap[milestone_idx] |= bit` (milestone type only)
- `VestingTree.total_claimed += claimable`

**Token transfer:** `vault → beneficiary_ata` for `claimable` tokens. Signed by vault_authority PDA.

**Event emitted:** `Claimed { tree, beneficiary, leaf_index, amount: claimable, total_claimed_by_user, total_claimed_overall, milestone_idx: Option<u8> }`

**Primary error paths:** 6009, 6010, 6011, 6012, 6013, 6014, 6015, 6016, 6017, 6008.

---

### §9.4 cancel_campaign

**Purpose:** Mark a campaign as cancelled, freezing the vesting curve and beginning the grace period.

**Required signer:** cancel_authority (matches `VestingTree.cancel_authority`)

**State preconditions:** None beyond authority check.

**Validation:**

| Check | Error if fails |
|---|---|
| `VestingTree.cancellable == true` | 6019 NotCancellable |
| `VestingTree.cancelled_at == None` | 6020 AlreadyCancelled |
| `signer == cancel_authority` | 6005 Unauthorized |

**State mutations:** `VestingTree.cancelled_at = Some(Clock::get().unix_timestamp)`

**Token transfer:** None.

**Event emitted:** `CampaignCancelled { tree, cancelled_at, claimed_at_cancel: total_claimed }`

**Primary error paths:** 6019, 6020, 6005.

---

### §9.5 update_root

**Purpose:** Replace the campaign's Merkle root with a new one, invalidating all existing proofs.

**Required signer:** cancel_authority

**State preconditions:** Campaign must not be cancelled.

**Validation:**

| Check | Error if fails |
|---|---|
| `VestingTree.cancellable == true` | 6019 NotCancellable |
| `VestingTree.cancelled_at == None` | 6023 CampaignCancelled |
| `signer == cancel_authority` | 6005 Unauthorized |
| `new_root != [0u8; 32]` | 6000 EmptyRoot |
| `new_leaf_count > 0` | 6001 EmptyCampaign |
| `new_root != VestingTree.merkle_root` | 6004 SameRoot |

**State mutations:**
- `VestingTree.merkle_root = new_root`
- `VestingTree.leaf_count = new_leaf_count`

`ClaimRecord` state is unchanged. Beneficiaries who have already claimed retain their `claimed_amount`. If a beneficiary's allocation is reduced below their claimed amount by the new root, their claimable saturates to 0 on next claim attempt.

**Token transfer:** None.

**Event emitted:** `RootUpdated { tree, old_root, new_root, new_leaf_count }`

**Primary error paths:** 6019, 6023, 6005, 6000, 6001, 6004.

---

### §9.6 withdraw_unvested

**Purpose:** Transfer all remaining vault tokens to the creator after the grace period expires.

**Required signer:** Creator (matches `VestingTree.creator`)

**State preconditions:** Campaign must be cancelled and grace period must have expired.

**Validation:**

| Check | Error if fails |
|---|---|
| `VestingTree.cancelled_at.is_some()` | 6025 NotCancelled |
| `now >= cancelled_at + GRACE_PERIOD_SECS` | 6026 GracePeriodActive |
| `signer == VestingTree.creator` | 6005 Unauthorized |

**State mutations:** None on VestingTree (vault balance changes at SPL layer).

**Token transfer:** `vault → creator_ata` for the entire remaining vault balance. Signed by vault_authority PDA.

**Event emitted:** `UnvestedWithdrawn { tree, amount: vault_balance_before }`

**Primary error paths:** 6025, 6026, 6005.

---

### §9.7 pause_campaign

**Purpose:** Temporarily halt all claims for a campaign.

**Required signer:** pause_authority

**State preconditions:** Campaign must not be already cancelled.

**Validation:**

| Check | Error if fails |
|---|---|
| `VestingTree.pause_authority.is_some()` | 6021 NotPausable |
| `signer == pause_authority` | 6005 Unauthorized |
| `VestingTree.cancelled_at == None` | 6023 CampaignCancelled |
| `VestingTree.paused == false` | 6022 AlreadyPaused |

**State mutations:** `VestingTree.paused = true`

**Token transfer:** None.

**Event emitted:** `CampaignPaused { tree }`

**Primary error paths:** 6021, 6005, 6023, 6022.

---

### §9.8 unpause_campaign

**Purpose:** Re-enable claims after a pause.

**Required signer:** pause_authority (same authority as `pause_campaign`)

**Context type:** Shares `PauseCampaign` context with `pause_campaign`.

**State preconditions:** Campaign must be paused.

**Validation:**

| Check | Error if fails |
|---|---|
| `VestingTree.paused == true` | 6024 NotPaused |
| `signer == pause_authority` | 6005 Unauthorized |

**State mutations:** `VestingTree.paused = false`

**Token transfer:** None.

**Event emitted:** `CampaignUnpaused { tree }`

**Primary error paths:** 6024, 6005.

---

### §9.9 close_claim_record

**Purpose:** Close a beneficiary's ClaimRecord and return its rent lamports to the beneficiary.

**Required signer:** Beneficiary (matches `ClaimRecord.beneficiary`)

**State preconditions:** Either the beneficiary has claimed their full allocation, or the campaign is cancelled and the grace period has expired.

**Validation:**

| Check | Error if fails |
|---|---|
| `claimed_amount >= expected_total` (fully claimed), OR `cancelled_at.is_some() AND now >= cancelled_at + GRACE_PERIOD_SECS` (post-grace) | 6027 CannotClose |

`expected_total` is passed as an argument by the caller and represents the total leaf amount the beneficiary expected. This prevents the account from being closed while a claim is still outstanding. The close is permitted post-grace even if not fully claimed because the vault has been swept.

**State mutations:** Closes the ClaimRecord account. Lamports transferred to the beneficiary's wallet.

**Token transfer:** None (SOL lamports returned, not SPL tokens).

**Event emitted:** `ClaimRecordClosed { tree, beneficiary }`

**Primary error paths:** 6027.

---

### §9.10 get_vested_amount

**Purpose:** Pure read-only query returning the currently vested amount for a given leaf, for use by DeFi protocols via CPI simulation.

**Required signer:** None.

**Accounts:** None — this instruction takes no account arguments.

**Arguments:** `leaf: VestingLeaf`, `cancelled_at: Option<i64>`, `now: i64`

**State preconditions:** None.

**State mutations:** None — this instruction never mutates any account.

**Return value:** `u64` via Anchor return data mechanism.

**Computation:**
```
effective_now = cancelled_at.map(|c| min(now, c)).unwrap_or(now)
return vested(leaf, effective_now)
```

This is identical to the cancel-clamp logic in §8.5. The caller supplies `cancelled_at` and `now` from their own context. A DeFi protocol checking vested collateral should pass the current `Clock::get().unix_timestamp` as `now` and the campaign's `cancelled_at` field (which it reads from the VestingTree account separately).

**Event emitted:** None.

**Primary error paths:** 6011 InvalidSchedule, 6012 InvalidScheduleType (if malformed leaf is passed).

---

## §10 Security Invariants

### §10.1 Validation Order in `claim`

The five-step ordering in §9.3 is non-negotiable. The rationale:

1. **Pause check first (cheapest).** A paused campaign should short-circuit all subsequent work. This check costs ~1 account field read. Running it first avoids deserializing the leaf, running schedule math, and computing the Merkle hash when the answer would be a rejection regardless.

2. **Beneficiary check before proof.** Verifying `signer == leaf.beneficiary` before running the Merkle proof prevents an oracle attack: an adversary who submits a valid proof for someone else's leaf learns nothing from the rejection (UnauthorizedClaimer) versus what they would learn if the order were reversed (the proof is valid, but you're not the beneficiary). Rejecting the signer first reveals no information about proof validity.

3. **Schedule sanity before proof.** This is defense-in-depth. Leaf data is not trusted until the proof passes. However, schedule sanity is a cheap local computation; catching malformed schedules here reduces the attack surface before the expensive Merkle computation.

4. **Proof verification last among the cheap checks, before accounting.** The Merkle hash is the most expensive operation (~20 hash rounds for a depth-20 tree). It runs after all cheap rejections to avoid wasted compute on clearly invalid inputs.

5. **Accounting after proof.** Once the proof is verified, the leaf is trusted. Accounting operations (bitmap check, claimable computation, vault balance check) proceed in trust.

### §10.2 CEI Order (Checks-Effects-Interactions)

The `claim` instruction follows strict CEI ordering:

```
[Checks]  — all validation in §9.3 steps 1–10
[Effects] — ClaimRecord mutations, VestingTree.total_claimed mutation
[Interactions] — token::transfer CPI to move tokens from vault to beneficiary_ata
```

State mutations are committed **before** the SPL token CPI. If a reentrant call were attempted (which Solana's runtime generally prevents, but the protocol defends against regardless), the `claimed_amount` would already be incremented. A second attempt for the same leaf would find `claimable = 0` and return `NothingToClaim`.

### §10.3 Checked Arithmetic

All operations that increment `total_claimed` or `claimed_amount` use `checked_add`. If the addition would overflow u64, the instruction returns error 6008 `Overflow` rather than wrapping. This prevents accounting manipulation via integer overflow.

The subtraction `get_vested_amount - claimed_amount` uses `saturating_sub`. This handles the root rotation edge case (leaf.amount reduced below claimed_amount) gracefully: the result is 0, not a wrapped negative-as-u64 value.

### §10.4 init_if_needed Scope

Only `ClaimRecord` uses `init_if_needed`. `VestingTree` uses `init`.

**Rationale:**
- `ClaimRecord` must be creatable on the beneficiary's first claim transaction without requiring a separate initialization step. `init_if_needed` handles both the first-claim case (account doesn't exist) and subsequent claims (account already exists) in a single instruction.
- `VestingTree` uses `init` because the PDA seeds include `campaign_id`. A creator who calls `create_campaign` twice with the same `campaign_id` would get a duplicate-account error at the account derivation level, not a silent re-initialization. Using `init_if_needed` for `VestingTree` would allow a second call to succeed silently and overwrite the existing campaign — a critical vulnerability.

The first-touch sentinel (`cr.beneficiary == Pubkey::default()`) handles the case where a `ClaimRecord` is closed and then re-created (e.g., beneficiary closes the record and then receives additional tokens from a new leaf). Without the sentinel, the re-created account would have zeroed fields but `init_if_needed` would not re-initialize them.

### §10.5 Vault Authority Pattern

`vault_authority` is an `UncheckedAccount` PDA with a `seeds` constraint in the Anchor account validation struct. The Anchor framework validates the PDA address against the seeds constraint before the instruction body runs. If the address does not match the expected derivation, the instruction fails at account validation, before any instruction logic executes.

The account is never deserialized. It holds no data. It exists solely as a PDA signer identity for `token::transfer` CPIs. `UncheckedAccount` is the correct type here; using `Account<T>` would imply deserialization of an account that has no data, which would fail.

Callers cannot substitute a different vault_authority because the `VestingTree.vault_authority` field stores the expected address at campaign creation, and the instruction validates that the passed account matches the stored address.

### §10.6 Bump Caching

`VestingTree.bump` and `ClaimRecord.bump` are stored at account initialization time using `ctx.bumps.vesting_tree` and `ctx.bumps.claim_record` respectively. On all subsequent accesses, the Anchor account constraint uses `bump = account.bump` to reconstruct the signer seeds.

This prevents two issues:
1. **Bump-grinding attacks:** An adversary cannot supply a non-canonical bump to derive a different PDA address and pass it as a valid account. The stored canonical bump is the only value the program will accept.
2. **Compute cost:** Re-deriving the canonical bump on every call requires iterating from 255 downward until the derivation succeeds. Caching avoids this iteration.

---

## §11 Off-Chain / On-Chain Interface Contract

### §11.1 Data Availability Model

The on-chain Merkle root commits to the recipient set, but the actual leaf data (beneficiary addresses, amounts, schedules) lives off-chain in the Merkle tree structure. In the Velthoryn deployment, this data is pinned to IPFS by Geral (frontend lead) using Pinata.

The protocol makes no on-chain guarantees about data availability. If the off-chain data is lost or unavailable:
- Beneficiaries cannot construct their proofs.
- Claims will fail with `InvalidProof` (because no valid proof can be presented).
- Vault tokens remain in the vault, locked.
- The creator can cancel the campaign (if cancellable) and eventually sweep via `withdraw_unvested` after the grace period.

**Implication for creators:** The creator must retain a local copy of the full Merkle tree data independent of IPFS. Pinning to multiple IPFS nodes is recommended. The on-chain root is authoritative for *what was committed*; the off-chain data is required for *claiming it*.

See `SECURITY.md` for the full data availability threat analysis.

### §11.2 Root Rotation Operational Sequence

`update_root` replaces the on-chain root atomically. The required operational sequence is:

1. **Build new tree off-chain.** Construct the updated Merkle tree (add, remove, or modify recipients). Compute the new root.
2. **Pin new proof set to IPFS.** Upload all new leaf data and proofs. Verify retrieval from IPFS before proceeding.
3. **Call `update_root` on-chain.** Submit the new root and leaf count. This immediately invalidates all existing proofs.
4. **Notify recipients.** Update frontend or communicate new proof URIs to affected beneficiaries.

**Critical:** Step 3 must not precede step 2. If the on-chain root is updated before the new proof set is retrievable, there is a window during which no valid proofs exist for any beneficiary. All claim attempts during this window return `InvalidProof`. This is an operational risk, not a program bug — the program operates correctly in this state, but beneficiaries cannot claim.

See `INTEGRATION.md` for the TypeScript sequence to execute a root rotation safely.

### §11.3 Proof Pre-Verification

The frontend must verify each beneficiary's proof locally against the on-chain root before submitting a `claim` transaction. The on-chain Merkle verification and the off-chain verification use the same algorithm (see §7.5).

Reasons for pre-verification:
- Avoids transaction fees (signature + compute) for proofs that will fail on-chain.
- Detects stale proofs immediately after a root rotation.
- Provides fast user feedback without waiting for transaction confirmation.

See `INTEGRATION.md §3` for the TypeScript pre-verification pattern.

### §11.4 Token-2022 Guard

At `create_campaign`, the protocol verifies that `mint.to_account_info().owner == &spl_token::ID`. This check rejects Token-2022 mints.

**Why:** Token-2022 mints can have transfer fee extensions. If a transfer fee is active, a `token::transfer` of N tokens from vault to beneficiary delivers fewer than N tokens to the beneficiary. The ClaimRecord records N tokens claimed, but the beneficiary received N minus the fee. This is an accounting discrepancy that the protocol cannot correct without Token-2022 awareness.

Until Phase 2 adds `token_2022::transfer_checked` with fee-aware accounting, all Token-2022 mints are rejected at campaign creation. Attempting to create a campaign with a Token-2022 mint returns `MintMismatch` (error 6007).

---

## §12 Event Catalog

All events are emitted via Anchor's `emit!()` macro after all state mutations and after the SPL token CPI (where applicable). Events are emitted only on successful instruction completion.

Off-chain consumers subscribe via `program.addEventListener(eventName, callback)` in the TypeScript SDK. Events contain sufficient data to reconstruct protocol state changes without re-reading accounts.

| Event Name | Emitted by | Fields | Purpose |
|---|---|---|---|
| `CampaignCreated` | `create_campaign` | `tree: Pubkey`, `creator: Pubkey`, `mint: Pubkey`, `total_supply: u64`, `leaf_count: u32`, `cancellable: bool` | Index new campaigns; populate campaign registry |
| `CampaignFunded` | `fund_campaign` | `tree: Pubkey`, `amount: u64`, `vault_balance_after: u64` | Track funding progress toward total_supply |
| `Claimed` | `claim` | `tree: Pubkey`, `beneficiary: Pubkey`, `leaf_index: u32`, `amount: u64`, `total_claimed_by_user: u64`, `total_claimed_overall: u64`, `milestone_idx: Option<u8>` | Track per-user and campaign-level claim progress; detect milestone completions |
| `CampaignCancelled` | `cancel_campaign` | `tree: Pubkey`, `cancelled_at: i64`, `claimed_at_cancel: u64` | Trigger grace period UI; notify beneficiaries |
| `RootUpdated` | `update_root` | `tree: Pubkey`, `old_root: [u8; 32]`, `new_root: [u8; 32]`, `new_leaf_count: u32` | Alert beneficiaries to refresh their proofs |
| `UnvestedWithdrawn` | `withdraw_unvested` | `tree: Pubkey`, `amount: u64` | Confirm sweep completion; update campaign status |
| `CampaignPaused` | `pause_campaign` | `tree: Pubkey` | Halt claim UI immediately |
| `CampaignUnpaused` | `unpause_campaign` | `tree: Pubkey` | Re-enable claim UI |
| `ClaimRecordClosed` | `close_claim_record` | `tree: Pubkey`, `beneficiary: Pubkey` | Confirm rent reclaim; update beneficiary dashboard |

---

## §13 Error Catalog

### §13.1 Error Groupings by Category

**Campaign creation guards**

| Code | Variant | Triggering condition |
|---|---|---|
| 6000 | EmptyRoot | `merkle_root == [0u8; 32]` |
| 6001 | EmptyCampaign | `leaf_count == 0` or `new_leaf_count == 0` |
| 6002 | ZeroAmount | `amount == 0` (create or fund) |
| 6003 | MissingCancelAuthority | `cancellable == true` but `cancel_authority == None` |

**Claim path**

| Code | Variant | Triggering condition |
|---|---|---|
| 6009 | CampaignPaused | `paused == true` at claim time |
| 6010 | UnauthorizedClaimer | `signer != leaf.beneficiary` |
| 6011 | InvalidSchedule | `start_time > cliff_time OR cliff_time > end_time` |
| 6012 | InvalidScheduleType | `release_type not in {0, 1, 2}` |
| 6013 | InvalidProof | Computed root does not match `merkle_root` |
| 6014 | MilestoneAlreadyClaimed | Bitmap bit for `milestone_idx` is already set |
| 6015 | NothingToClaim | `claimable == 0` |
| 6016 | InsufficientVault | `vault.amount < claimable` |
| 6017 | OverClaim | `total_claimed + claimable > total_supply` |

**Authorization**

| Code | Variant | Triggering condition |
|---|---|---|
| 6005 | Unauthorized | Signer does not match the required authority field |

**State machine violations**

| Code | Variant | Triggering condition |
|---|---|---|
| 6019 | NotCancellable | `cancel_campaign` or `update_root` called on a non-cancellable campaign |
| 6020 | AlreadyCancelled | `cancel_campaign` called on an already-cancelled campaign |
| 6021 | NotPausable | `pause_campaign` called with no `pause_authority` set |
| 6022 | AlreadyPaused | `pause_campaign` called on an already-paused campaign |
| 6023 | CampaignCancelled | `pause_campaign`, `unpause_campaign`, or `update_root` called on a cancelled campaign |
| 6024 | NotPaused | `unpause_campaign` called on a non-paused campaign |
| 6025 | NotCancelled | `withdraw_unvested` called on a non-cancelled campaign |

**Timing**

| Code | Variant | Triggering condition |
|---|---|---|
| 6026 | GracePeriodActive | `withdraw_unvested` called before grace period expires |

**Accounting**

| Code | Variant | Triggering condition |
|---|---|---|
| 6006 | OverFunded | `fund_campaign` would push vault above `total_supply` |
| 6008 | Overflow | `checked_add` on `total_claimed` or `claimed_amount` overflows u64 |
| 6018 | WrongVault | Provided vault account address does not match `VestingTree.vault` |

**Close**

| Code | Variant | Triggering condition |
|---|---|---|
| 6027 | CannotClose | `close_claim_record` called before fully claimed and before post-grace |

**Miscellaneous**

| Code | Variant | Triggering condition |
|---|---|---|
| 6004 | SameRoot | `update_root` called with a root identical to the current root |
| 6007 | MintMismatch | Mint of provided account does not match campaign mint, or Token-2022 mint |

### §13.2 Full Error Reference Table

| Code | Variant | Message | Triggering instruction(s) |
|---|---|---|---|
| 6000 | EmptyRoot | "Merkle root must not be all-zero" | `create_campaign`, `update_root` |
| 6001 | EmptyCampaign | "Campaign must contain at least one leaf" | `create_campaign`, `update_root` |
| 6002 | ZeroAmount | "Amount must be greater than zero" | `create_campaign`, `fund_campaign` |
| 6003 | MissingCancelAuthority | "Cancellable campaigns require a cancel_authority" | `create_campaign` |
| 6004 | SameRoot | "New root must differ from the current root" | `update_root` |
| 6005 | Unauthorized | "Caller is not authorised for this action" | `cancel_campaign`, `update_root`, `withdraw_unvested`, `pause_campaign`, `unpause_campaign` |
| 6006 | OverFunded | "Vault would exceed the declared total_supply" | `fund_campaign` |
| 6007 | MintMismatch | "Mint of provided account does not match the campaign mint" | `create_campaign`, `fund_campaign` |
| 6008 | Overflow | "Arithmetic overflow" | `claim` |
| 6009 | CampaignPaused | "Campaign is paused" | `claim` |
| 6010 | UnauthorizedClaimer | "Signer does not own this leaf" | `claim` |
| 6011 | InvalidSchedule | "Leaf has malformed schedule (start <= cliff <= end violated)" | `claim`, `get_vested_amount` |
| 6012 | InvalidScheduleType | "release_type must be 0 (Cliff), 1 (Linear), or 2 (Milestone)" | `claim`, `get_vested_amount` |
| 6013 | InvalidProof | "Merkle proof did not verify against the stored root" | `claim` |
| 6014 | MilestoneAlreadyClaimed | "This milestone has already been claimed" | `claim` |
| 6015 | NothingToClaim | "Nothing claimable at this time" | `claim` |
| 6016 | InsufficientVault | "Vault does not hold enough tokens for this claim" | `claim` |
| 6017 | OverClaim | "Total claimed would exceed campaign total_supply" | `claim` |
| 6018 | WrongVault | "Provided vault account does not match the campaign vault" | `fund_campaign`, `claim`, `withdraw_unvested` |
| 6019 | NotCancellable | "Campaign was created as non-cancellable" | `cancel_campaign`, `update_root` |
| 6020 | AlreadyCancelled | "Campaign is already cancelled" | `cancel_campaign` |
| 6021 | NotPausable | "Campaign was created with no pause_authority" | `pause_campaign` |
| 6022 | AlreadyPaused | "Campaign is already paused" | `pause_campaign` |
| 6023 | CampaignCancelled | "Cancelled campaigns cannot be paused, unpaused, or rotated" | `pause_campaign`, `unpause_campaign`, `update_root` |
| 6024 | NotPaused | "Campaign is not paused" | `unpause_campaign` |
| 6025 | NotCancelled | "Campaign is not cancelled" | `withdraw_unvested` |
| 6026 | GracePeriodActive | "Grace period after cancellation has not expired" | `withdraw_unvested` |
| 6027 | CannotClose | "ClaimRecord cannot be closed yet (not fully claimed and grace period active)" | `close_claim_record` |

---

## §14 DeFi Composability (Phase 2 Design)

### §14.1 get_vested_amount CPI Contract

`get_vested_amount` is a stable, stateless CPI interface. Its contract:

- **Zero accounts required.** The DeFi protocol passes no account metas for this instruction. The only inputs are the instruction arguments: `leaf: VestingLeaf`, `cancelled_at: Option<i64>`, `now: i64`.
- **Returns u64** via Anchor's return data mechanism (`set_return_data`). The caller reads the return value from the transaction's return data after CPI simulation.
- **Never mutates state.** No accounts are written. No events are emitted. CPI simulation (read-only) is safe.
- **Stable across upgrades.** The interface is defined in Phase 1 and will not change in Phase 2. Any Phase 2 upgrade that breaks this interface would require a migration plan and versioned IDL.

**DeFi caller pattern (pseudocode):**
```
// Read VestingTree account separately to get cancelled_at
let tree = program.account::<VestingTree>(tree_pubkey).fetch();

// Simulate CPI to get_vested_amount
let vested = program.methods
    .getVestedAmount(leaf, tree.cancelled_at, Clock::get().unix_timestamp)
    .simulate()
    .returnData;
```

The caller is responsible for reading `cancelled_at` from the `VestingTree` account. The `get_vested_amount` instruction does not read any accounts itself — the caller passes the value explicitly. This design keeps the instruction stateless and avoids account ordering constraints.

### §14.2 Phase 2 Use Cases

**Lending protocols:** A lending market that accepts vesting positions as collateral can use `get_vested_amount` to determine the current collateral value without triggering a claim. The borrower's vested-but-unclaimed tokens serve as collateral up to `vested_amount - claimed_amount`. The lending protocol simulates `get_vested_amount` at borrow time and periodically to check collateral health. No tokens move during this process.

**DAO governance (Realms VSR plugin):** A governance registrar (Realms Voter Stake Registry pattern) can weight a token holder's voting power by their vested allocation. The VSR plugin simulates `get_vested_amount` for each voter's leaf to determine voting weight at proposal creation time. The beneficiary's unvested tokens contribute to voting weight without being claimed.

Both use cases are read-only consumers. Neither requires the beneficiary to take any action. Neither interacts with the vault. The DeFi protocol bears the transaction fee for the CPI simulation.

---

## §15 Known Limitations

### §15.1 Off-Chain Data Availability

If IPFS leaf data is unavailable, beneficiaries cannot construct Merkle proofs and cannot claim, even though their tokens remain in the vault. The protocol has no on-chain remedy for this state.

**Mitigation:** Creator retains a complete local copy of the Merkle tree data. Leaf data is pinned to multiple IPFS nodes (recommended: at least 3 providers). Pinata's dedicated gateway provides reliability beyond public IPFS.

### §15.2 Root Rotation Window

Between the `update_root` on-chain transaction and the completion of IPFS re-pinning and frontend updates, all claim attempts return `InvalidProof`. This is an operational risk inherent to the root rotation feature.

**Mitigation:** Follow the pin-before-rotate discipline described in §11.2. For large campaigns, schedule root rotations during low-traffic periods and communicate downtime to beneficiaries in advance.

### §15.3 Single-Key cancel_authority

A compromised `cancel_authority` private key allows an attacker to: cancel the campaign (freezing the vesting curve), rotate the root to remove recipients, and after the grace period, sweep the vault via `withdraw_unvested`.

**Mitigation (Phase 1):** Use a hardware wallet for cancel_authority. For high-value campaigns, use a separate key from the creator wallet. **Phase 2 mitigation:** Squads v4 multisig as cancel_authority — M-of-N threshold signing prevents single-key compromise from being sufficient.

### §15.4 Linear Schedule Dust

Floor division in the linear schedule formula means that at any given clock value before `end_time`, the computed vested amount may be up to 1 base unit less than the "true" continuous-time vested amount. This 1-token dust remains in the vault until `end_time` is reached (when `vested = leaf.amount` regardless of prior rounding).

For tokens with 6–9 decimal places, this dust is economically negligible. For tokens with 0 decimals, dust represents one whole token and may be material.

**Mitigation:** There is no on-chain mitigation. This is an accepted trade-off of integer arithmetic (see §2.2). Creators should account for 1-token dust in total_supply calculations if using 0-decimal tokens.

### §15.5 Clock Manipulation

Solana validators can skew `unix_timestamp` by approximately 25 seconds from wall-clock time. For `GRACE_PERIOD_SECS = 604800` (7 days), a 25-second error is a 0.004% deviation — negligible.

The risk is material only for campaigns using `cliff_time` values where a 25-second error changes behavior. For example, a cliff timed for midnight UTC could fire 25 seconds early or late. For daily-precision schedules, this is irrelevant. For second-precision trigger events, creators should add a safety margin of at least 60 seconds to cliff_time.

### §15.6 Token-2022 Not Supported (Phase 1)

Transfer fees in Token-2022 extensions cause the vault-to-beneficiary transfer to deliver fewer tokens than `claimable`. The ClaimRecord records the nominal amount, creating an accounting discrepancy. This could be exploited to drain the vault faster than the vesting schedule permits.

**Current mitigation:** Token-2022 mints are rejected at `create_campaign` via the `mint.owner == spl_token::ID` check. **Phase 2:** `token_2022::transfer_checked` with fee-aware claimable computation.

---

## §16 Phase 2 Roadmap Items

| Feature | Dependency | Notes |
|---|---|---|
| Squads v4 multisig for cancel_authority | Squads v4 program on devnet/mainnet | Replaces single EOA; M-of-N signing for cancel and root rotation; eliminates §15.3 risk |
| Token-2022 mint support | Anchor Token-2022 CPI helpers | Requires `transfer_checked` with fee extension awareness; claimable must account for fee deduction |
| Pinocchio performance rewrite | Pinocchio framework stable | Removes Anchor overhead; targets sub-10k CU for claim; not a correctness change |
| proptest / cargo-fuzz fuzzing harness | CI integration | Property-based tests for schedule math edge cases; fuzzing of Borsh deserialization paths |
| Lending protocol integration | DeFi partner specification | Uses `get_vested_amount` CPI; requires collateral accounting design on lender side |
| DAO governance — Realms VSR plugin | Realms VSR plugin spec | Weight votes by `get_vested_amount`; requires VSR plugin development outside this program |
| Mainnet deployment | Security audit completion | Audit scope: all 12 instructions, Merkle implementation, CEI order, bump caching |

---

## §17 Glossary

**campaign_id:** A u64 field in `VestingTree` that distinguishes multiple campaigns by the same creator for the same mint. Incrementing campaign_id allows a creator to run concurrent or sequential campaigns without conflict.

**CEI (Checks-Effects-Interactions):** A smart contract design pattern where all validation checks run first, all state mutations (effects) run second, and all external calls (interactions, such as token transfers) run last. Prevents reentrancy vulnerabilities. See §10.2.

**ClaimRecord:** A PDA account (seeds: `["claim", tree, beneficiary]`) that tracks a single beneficiary's claim history within a campaign. Holds `claimed_amount`, `milestone_bitmap`, and `last_claim_at`. One per (beneficiary, campaign) pair.

**cancel_authority:** An optional `Pubkey` field in `VestingTree` that authorizes `cancel_campaign` and `update_root` operations. Required when `cancellable = true`. May be the creator's key, a separate operational key, or a multisig PDA.

**claimed_amount:** The cumulative total of tokens transferred to a beneficiary from the vault for a given campaign, tracked in `ClaimRecord`. Monotonically increasing. Used to compute claimable = vested - claimed.

**effective_now:** The time value used in schedule computations after applying the cancel clamp. `effective_now = min(now, cancelled_at)` when cancelled; `effective_now = now` otherwise. Ensures vesting curves freeze at cancellation time.

**grace period:** The 7-day window (`GRACE_PERIOD_SECS = 604800`) after campaign cancellation during which beneficiaries can still claim their vested-at-cancellation tokens. The creator cannot sweep the vault until the grace period expires.

**INIT_SPACE:** An Anchor macro-derived constant that computes the minimum account data size for a given struct, excluding the 8-byte discriminator. `VestingTree::INIT_SPACE = 274`. `ClaimRecord::INIT_SPACE = 113`. Total account size = INIT_SPACE + 8.

**leaf_hash:** The keccak256 hash of `[0x00] || borsh_serialize(leaf)`. This is the Merkle leaf value for a given VestingLeaf. The domain prefix `0x00` distinguishes leaf hashes from node hashes.

**milestone_bitmap:** A `[u8; 32]` (256-bit) field in ClaimRecord that tracks which milestones have been claimed. Bit at index `milestone_idx` is set after a successful milestone claim. Prevents double-claiming the same milestone.

**milestone_idx:** A u8 field in VestingLeaf (offset 69) that identifies which milestone bit in `ClaimRecord.milestone_bitmap` corresponds to this leaf. Values 0–255 are valid. Only meaningful for `release_type = 2`.

**node_hash:** The keccak256 hash of `[0x01] || left_hash || right_hash`. Used for all internal Merkle tree nodes. The domain prefix `0x01` distinguishes node hashes from leaf hashes.

**pause_authority:** An optional `Pubkey` field in `VestingTree` that authorizes `pause_campaign` and `unpause_campaign` operations. If `None`, the campaign cannot be paused (error 6021 NotPausable). May be the same key as creator or cancel_authority, or a separate operational key.

**PDA (Program-Derived Address):** A Solana account address derived deterministically from a set of seeds and a program ID. PDAs are owned by their program, not by any private key. They can sign transactions for CPIs when the program provides the signing seeds. Used for VestingTree, ClaimRecord, and VaultAuthority.

**proof path:** The sequence of sibling hashes provided in the `proof: Vec<[u8; 32]>` argument to `claim`. Each element is the sibling hash at one level of the Merkle tree. The verifier combines each sibling with the running hash (following the index bit) to reconstruct the root.

**release_type:** A u8 field in VestingLeaf (offset 44) that selects the vesting schedule: 0 = Cliff, 1 = Linear, 2 = Milestone. Any other value returns error 6012 InvalidScheduleType.

**root rotation:** The operation of calling `update_root` to replace the campaign's Merkle root with a new one. Immediately invalidates all existing proofs. Used to add, remove, or modify recipients. Requires `cancellable = true` and cancel_authority signature.

**saturating_sub:** Subtraction that clamps to 0 on underflow rather than wrapping. Used in `claimable = get_vested_amount(...).saturating_sub(claimed_amount)` to handle edge cases where a root rotation reduced a leaf's amount below the beneficiary's claimed_amount.

**VaultAuthority:** A zero-data PDA (seeds: `["vault_authority", tree]`) that serves as the SPL token account authority for the campaign vault. Signs vault outflow CPIs. Never deserialized. See §5.4.

**VestingLeaf:** A 70-byte off-chain struct (Borsh LE) that encodes one recipient's vesting parameters: leaf_index, beneficiary, amount, release_type, start_time, cliff_time, end_time, milestone_idx. Never stored on-chain. Passed as an instruction argument to `claim`. See §5.3.

**VestingTree:** The primary on-chain account for a vesting campaign. Stores the Merkle root, vault address, authority fields, accounting totals, and lifecycle state. One per campaign. PDA seeds: `["tree", creator, mint, campaign_id]`. See §5.1.

---

## Appendix A — Protocol Constants Reference

| Constant | Value | Source |
|---|---|---|
| GRACE_PERIOD_SECS | 604,800 (7 days) | `constants.rs` |
| LEAF_PREFIX | 0x00 | `math/merkle.rs` |
| NODE_PREFIX | 0x01 | `math/merkle.rs` |
| VestingTree INIT_SPACE | 274 bytes (total: 282 with discriminator) | `state/vesting_tree.rs` |
| ClaimRecord INIT_SPACE | 113 bytes (total: 121 with discriminator) | `state/claim_record.rs` |
| VestingLeaf serialized size | 70 bytes (Borsh LE) | `state/leaf.rs` |
| Max tree depth (recommended) | 20 levels (2^20 = 1,048,576 recipients) | `TDD_LANA.md §NFR-2` |
| Creator setup cost | ~0.005 SOL (fixed, any N) | `PRD_LANA.md §NFR-1` |
| Compute budget (typical claim) | < 200,000 CU | `PRD_LANA.md §NFR-2` |
| Program ID | G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu | `Anchor.toml`, `lib.rs` |
| Network | Solana devnet (latest deployment uses 400KB allocation) | Deployment record |
| Anchor version | 1.0.0 | `Cargo.toml` |

---

## Appendix B — Document Cross-Reference Map

| PDD Section | Related PRD section | Related TDD section | Related SECURITY section | Related INTEGRATION section |
|---|---|---|---|---|
| §1 Executive Summary | §1 Problem Statement, §2 Product Vision | §1 Overview | — | — |
| §2 Design Goals and Trade-offs | §3 Functional Requirements | §2 Architecture | — | — |
| §3 Protocol Actors and Trust Model | §4 Actors and Roles | §2.3 Authority model | §2 Threat actors | — |
| §4 Campaign Lifecycle | §5 Campaign lifecycle | §3 State machine | §3 State transition attacks | §2 Campaign setup flow |
| §5 Account Model | §6 Data model | §4 Account structures | §4 Account substitution attacks | §3 Account fetching |
| §6 Storage and Cost Model | §1.1 Setup costs, §NFR-1 | §NFR-2 | — | — |
| §7 Merkle Design | §7 Merkle compression | §5 Merkle implementation | §5 Merkle attacks | §4 Proof construction |
| §8 Schedule Mathematics | §8 Schedule types | §6 Schedule logic | §6 Schedule manipulation | §5 Schedule display |
| §9 Instruction Reference | §9 Instruction catalog | §7 Instruction implementation | §7 Per-instruction attack surface | §6 Instruction call patterns |
| §10 Security Invariants | — | §8 Security patterns | §8 Core invariants | — |
| §11 Off-Chain / On-Chain Interface | §10 Off-chain data model | §9 IPFS integration | §9 Data availability threats | §7 IPFS integration |
| §12 Event Catalog | §11 Events | §10 Event emission | — | §8 Event subscription |
| §13 Error Catalog | §12 Error handling | §11 Error codes | — | §9 Error handling patterns |
| §14 DeFi Composability | §13 Phase 2 composability | §12 CPI interface | — | §10 CPI integration |
| §15 Known Limitations | §14 Limitations | §13 Known issues | §10 Accepted risks | — |
| §16 Phase 2 Roadmap | §15 Roadmap | §14 Future work | §11 Phase 2 security | — |
| §17 Glossary | §16 Glossary | — | — | — |
| Appendix A | — | Appendix A (constants) | — | — |
