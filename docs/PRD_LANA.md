# PRD — Velthoryn Protocol (Lana's Scope)

**Author:** Lana — smart-contract / backend lead  
**Status:** Week 4 complete — all features implemented and tested on devnet
**Program ID:** `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` (deployed, Solana devnet)
**Companion docs:** `docs/TDD_LANA.md`, `docs/SECURITY.md`, `docs/PROGRAM.md`

---

## Terms (for BD / non-technical readers)

| Term | Meaning |
|---|---|
| **Merkle root / Merkle compression** | A 32-byte cryptographic fingerprint that stands in for a list of any size. Instead of storing 10,000 recipient records on-chain, the protocol stores one root. Each recipient carries a short "proof" that they are on the list. Cost goes from O(n) to O(1). |
| **PDA (Program-Derived Address)** | An on-chain storage slot owned by a smart contract. Every PDA costs rent. PDA-per-recipient protocols pay that rent for every single user. |
| **Vesting leaf** | One recipient's record (wallet address, token amount, schedule type, timing) stored off-chain inside the Merkle tree. |
| **Cliff vesting** | Nothing unlocks until a date; then a lump sum unlocks. |
| **Linear vesting** | Tokens unlock continuously and proportionally over a time window. |
| **Milestone vesting** | Tokens unlock when a specific date or event is reached. One leaf = one milestone. |
| **Clawback** | The creator reclaims unvested tokens after cancellation. Recipients always keep what they already earned. |
| **Root rotation (`update_root`)** | Replacing the Merkle root with a new one that excludes or changes a specific recipient. The old proof stops working immediately. |
| **Grace period** | 7 days after campaign cancellation during which recipients can still claim what they earned. Creator cannot sweep vault until grace expires. |
| **IDL** | Interface Description Language — a machine-readable description of the program's instructions, accounts, and errors. The frontend and tests consume this. |

---

## §1 Problem Statement

### 1.1 Setup costs price community launches out of the market

Every Solana vesting protocol except Jito's distributor charges a storage fee per recipient. SOL at ~$85 (verified 2026-04-19):

| Protocol | Storage model | Setup cost / user | **Total for 10,000 recipients** |
|---|---|---|---|
| Streamflow | 1 PDA per stream | ~$0.37 | ~$3,720 |
| Zebec | 1 PDA + extras per milestone (5 milestones) | ~$1.17 | ~$11,730 |
| Magna | Shared pool, individual claim records | ~$0.20 | ~$1,990 |
| Bonfida | 1 PDA per recipient | ~$0.20 | ~$1,990 |
| Armada | 1 PDA per grant + option token | ~$0.20–$0.43 | ~$1,990–$4,250 |
| **Jito Distributor** | **1 Merkle root for the whole campaign** | **~$0 marginal** | **~$0.20 total** |
| **Velthoryn (this protocol)** | **1 Merkle root + 1 vault PDA** | **~$0 marginal** | **~$0.42 total** |

Velthoryn's creator-side cost is fixed at ~0.005 SOL:
- `VestingTree` PDA (8 + 282 bytes): ~0.0029 SOL
- Vault ATA (165 bytes): ~0.00204 SOL
- Total: ~0.005 SOL = ~$0.42 at $85/SOL — independent of recipient count

### 1.2 Why Jito's distributor is insufficient despite similar cost

Jito's distributor is the only other Merkle-compressed distribution protocol on Solana. It is the reference for our cost model. But it is explicitly a one-shot airdrop primitive:

| Capability | Jito Distributor | Velthoryn |
|---|---|---|
| Merkle compression (flat cost) | Yes | Yes |
| Cliff vesting | Yes (single window) | Yes (per leaf) |
| Linear vesting | Yes (post-cliff, campaign-wide) | Yes (per leaf, any mix) |
| **Milestone vesting** | **No** | **Yes (per leaf, 256-bit bitmap)** |
| **Multi-campaign management** | **No** | **Yes (`campaign_id` in PDA seeds)** |
| **Per-recipient clawback** | **No** | **Yes (`update_root` rotation)** |
| **Campaign-wide clawback with grace period** | **No** | **Yes (`cancel_campaign` + 7-day grace)** |
| **Emergency pause** | **No** | **Yes (`pause_campaign` / `unpause_campaign`)** |
| **On-chain events for indexers** | **No** | **Yes (9 event types)** |
| **Frontend / UI** | **No (CLI only)** | **Yes (Geral's track)** |
| **DeFi composability via `get_vested_amount` CPI** | **No** | **Yes (Phase 2)** |

What Velthoryn adds on top of Jito: milestone support, per-leaf heterogeneous schedules, multi-campaign from one creator, per-recipient clawback via root rotation, campaign-wide cancel with grace period, emergency pause, and a full event surface for indexer-driven dashboards.

### 1.3 Locked tokens sit as dead capital (Gap 2 — Phase 2 mandate)

Across all six surveyed protocols (Streamflow, Zebec, Magna, Bonfida, Armada, Jito):

- Recipients cannot use locked tokens as loan collateral
- No yield on locked positions
- Positions are non-transferable
- No integration with Solana DAO governance (Realms / SPL Governance)

`get_vested_amount` (the read-only CPI helper included in Phase 1) is the foundation for Phase 2 integrations — lending protocols and DAO voting registries can query the vested balance without moving tokens.

---

## §2 Scope

### 2.1 Ownership boundary

| Layer | Deliverable | Owner | Phase |
|---|---|---|---|
| Smart contract — 12 Anchor instructions | `programs/vesting/src/instructions/` | Lana | Phase 1 (Week 4) |
| Schedule math (Cliff / Linear / Milestone) | `programs/vesting/src/math/schedule.rs` | Lana | Phase 1 |
| Merkle verifier (`leaf_hash`, `verify_merkle_proof`) | `programs/vesting/src/math/merkle.rs` | Lana | Phase 1 |
| TS Merkle tooling (leaf encoder, tree builder, proof generator) | `clients/ts/src/` | Lana | Phase 1 |
| Integration tests (full scenario suite + golden vector gate) | `tests/` | Lana | Phase 1 |
| Frontend (`apps/web/`) | Geral | Phase 1 |
| Off-chain Merkle tree builder for the UI | Geral (`apps/web/src/lib/merkle/builder.ts`) | Geral | Phase 1 |
| IPFS / Pinata leaf pinning | Geral | Phase 1 |
| Token-2022 mint support | Lana | Phase 2 |
| Squads v4 multisig for `cancel_authority` | Lana | Phase 2 |
| Pinocchio, proptest, cargo-fuzz, Mollusk | Lana | Phase 2 |
| DeFi composability (lending, vesting vouchers) | Lana + partners | Phase 2/3 |
| DAO governance integration (Realms VSR) | Lana + Realms team | Phase 3 |

### 2.2 Current implementation status

All features are implemented and tested. 57 tests pass on devnet (56 pass + 1 graceful skip).

| File / function | Status |
|---|---|
| `math/merkle.rs::leaf_hash` | **LIVE** — keccak256 with `LEAF_PREFIX = 0x00`; byte-identical to Geral's `hashLeaf()` in `apps/web/` |
| `math/merkle.rs::verify_merkle_proof` | **LIVE** — full proof verification with domain-separated node hashes |
| `math/schedule.rs::vested` | **LIVE** — cliff, linear (u128 intermediate), milestone |
| `math/schedule.rs::get_vested_amount` | **LIVE** — cancel-clamp via `effective_now = min(now, cancelled_at)` |
| All 12 instruction handlers | **LIVE** — full validation, state mutations, events, SPL CPIs |
| `create_stream` handler | **LIVE** — atomic single-recipient campaign creation + funding |
| `withdraw` handler | **LIVE** — proof-less claim for single-recipient streams |
| `VestingTree`, `ClaimRecord`, `VestingLeaf` structs | **LIVE** — correct field layout, correct Borsh wire order |
| `VestingError` (31 variants) | **LIVE** — all variants exercised by named tests |
| 9 event types | **LIVE** — emitted after state mutations in each instruction |
| Devnet deploy | **LIVE** at `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` |
| Integration tests (50) | **LIVE** — T1-T5 core, T6-T25 supplementary, golden vector, 10 security exploit tests |

---

## §3 Feature Requirements

Six BD-validated features map to on-chain obligations. Priority: **P0** = must ship for any campaign to function; **P1** = ships in Week 4; **P2** = ships in a follow-up without blocking a first live campaign.

---

### F1 — Automatisasi: Bulk Send

**Priority:** P0  
**Dependencies:** None

**What BD validated:** DAOs and projects need to distribute tokens to thousands of wallets with one setup action.

**On-chain obligation:** `create_campaign` commits a Merkle root, allocates the vault, and stores campaign metadata in a single transaction. `fund_campaign` transfers tokens into the vault. Both together serve unlimited recipients at a fixed creator cost.

**Cost requirement:** Creator-side rent ≤ 0.005 SOL for any campaign size, measured on a real cluster.

**Token-2022 guard:** `create_campaign` must verify at runtime that `mint` is a classic SPL Token program account. If the mint belongs to the Token-2022 program, reject with `VestingError::UnsupportedMint`. This prevents silent failures in `claim` where Token-2022 transfer fees cause vault→ATA amounts to diverge from the expected `claimable`.

**Definition of done:** AC2 (IDL correct) + AC9 (rent ≤ 0.005 SOL measured in T1 setup). Tests: `create_with_zero_supply_fails`, `create_with_empty_root_fails`, `create_with_token22_mint_fails`.

---

### F2 — Automatisasi: Claim

**Priority:** P0  
**Dependencies:** F1

**What BD validated:** Recipients pull their own tokens when vested. The project does not push tokens out.

**On-chain obligation:** `claim` accepts a `VestingLeaf` + Merkle proof. It:
1. Verifies proof against current `merkle_root` (survives root rotation via `update_root`)
2. Computes `effective_now = min(now, cancelled_at ?? now)`
3. Runs schedule math to get `claimable`
4. Updates `ClaimRecord.claimed_amount` (and `milestone_bitmap` for milestone leaves) **before** the SPL CPI
5. Transfers `claimable` from vault to beneficiary's ATA
6. Emits `Claimed`

**Schedule types (per leaf, mixed in one campaign):**

| Type | `release_type` | Behavior |
|---|---|---|
| Cliff | `0` | Zero until `cliff_time`; full `amount` in one transfer thereafter |
| Linear | `1` | Zero until `cliff_time`; proportional accrual until `end_time`; full `amount` when `now >= end_time`. Uses `u128` intermediate to prevent overflow. |
| Milestone | `2` | Each leaf = one milestone. Unlocks full `leaf.amount` when `now >= cliff_time`. `ClaimRecord.milestone_bitmap` prevents double-claim per milestone index. |

**Definition of done:** T1 (linear mid-stream ±5%), T6 (`NothingToClaim` before cliff), T7 (full amount after `end_time`), T10 (milestone bitmap set; second claim → `VestingError::MilestoneAlreadyClaimed`).

---

### F3 — Automatisasi: Verifikasi (Events)

**Priority:** P0  
**Dependencies:** F1, F2

**What BD validated:** Projects and recipients need on-chain proof of every claim and state change for auditing and dashboards.

**On-chain obligation:** Every state-changing instruction emits a typed Anchor event via `emit!(...)` after state mutation.

| Event | Emitted by | Key fields |
|---|---|---|
| `CampaignCreated` | `create_campaign` | `tree`, `creator`, `mint`, `total_supply`, `leaf_count`, `cancellable` |
| `CampaignFunded` | `fund_campaign` | `tree`, `amount`, `vault_balance_after` |
| `Claimed` | `claim` | `tree`, `beneficiary`, `leaf_index`, `amount`, `total_claimed_by_user`, `total_claimed_overall`, `milestone_idx` |
| `CampaignCancelled` | `cancel_campaign` | `tree`, `cancelled_at`, `claimed_at_cancel` |
| `RootUpdated` | `update_root` | `tree`, `old_root`, `new_root`, `new_leaf_count` |
| `UnvestedWithdrawn` | `withdraw_unvested` | `tree`, `amount` |
| `CampaignPaused` | `pause_campaign` | `tree` |
| `CampaignUnpaused` | `unpause_campaign` | `tree` |
| `ClaimRecordClosed` | `close_claim_record` | `tree`, `beneficiary` |

**Definition of done:** AC2 — IDL contains all 9 event types with correct fields.

---

### F4 — Customize Vesting

**Priority:** Cliff + Linear are P0. Milestone is P1.  
**Dependencies:** F1, F2

**What BD validated:** Projects have different needs — employee linear vesting, investor cliff + linear, community milestones. One project may run multiple campaigns concurrently.

**On-chain obligations:**
1. **Per-leaf `release_type`** — one campaign mixes Cliff, Linear, and Milestone leaves in one Merkle tree.
2. **`campaign_id` in PDA seeds** — one (creator, mint) pair hosts N concurrent campaigns. Seeds: `["tree", creator, mint, campaign_id.to_le_bytes()]`.
3. **256-bit milestone bitmap** — one beneficiary owns multiple milestone leaves (different `milestone_idx`). `ClaimRecord.milestone_bitmap` tracks each independently. Max 255 milestones per beneficiary per campaign.

**Definition of done:** Integration test creates one campaign with one cliff leaf, one linear leaf, and one milestone leaf for three different beneficiaries; all three claim successfully.

---

### F5 — Clawback Otomatis: Campaign-wide Cancel

**Priority:** P1  
**Dependencies:** F1; F2 should be passing (cancel + claim interaction is the key test)

**What BD validated:** Projects need to cancel a vesting campaign if terms change, without forfeiting what recipients already earned.

**On-chain obligation:**
- `cancel_campaign` (signed by `cancel_authority`) sets `cancelled_at = now`. All future `claim` calls compute `effective_now = min(now, cancelled_at)` — the vesting curve freezes at cancellation.
- Recipients keep exactly what they earned at cancellation. No slashing.
- After `GRACE_PERIOD_SECS` = 7 days (604,800 seconds), `withdraw_unvested` lets the creator sweep the remaining vault balance.
- Non-cancellable campaigns (`cancellable = false`) reject `cancel_campaign` with `VestingError::NotCancellable`.

**Definition of done:** T4 (cancel + claim returns pre-cancel vested only) and T12 (`withdraw_unvested` before grace → `VestingError::GracePeriodActive`).

---

### F6 — Per-recipient Clawback (Root Rotation)

**Priority:** P2  
**Dependencies:** F1, F2, F3

**What BD validated:** One contributor leaves; the rest of the campaign continues. Campaign-wide cancel is too aggressive.

**On-chain obligation:**
- `update_root` (signed by `cancel_authority`) replaces `VestingTree.merkle_root` with a new root built off-chain without the removed recipient. `leaf_count` updates to match.
- Removed recipient's old proof fails against the new root → `VestingError::InvalidProof`.
- Other recipients' `ClaimRecord` state (`claimed_amount`, `milestone_bitmap`) is preserved. Root rotation does not reset prior claims.
- Recipients with a lower `amount` in the new tree get `VestingError::NothingToClaim` on next call (`saturating_sub` of claimed_amount from lower total_vested yields zero).
- Rejected on cancelled campaigns (`VestingError::CampaignCancelled`) and with identical root (`VestingError::SameRoot`).

**Required off-chain sequence before `update_root`:**
1. Build new Merkle tree off-chain (excluding removed recipient)
2. Pin new proof set to IPFS / Cloudflare R2 (Geral)
3. Notify remaining recipients of their new proofs
4. Call `update_root` on-chain

If root rotates before proofs are pinned, recipients see `InvalidProof` until the new proofs are available. The sequence above prevents this window. See §6 Q5.

**Definition of done:** T5 — kicked recipient's old proof returns `VestingError::InvalidProof`; Carol's proof from the new tree transfers the correct amount.

---

## §4 Acceptance Criteria

All ACs are machine-checkable. ACs are divided into Week 4 must-pass and stretch goals.

### Week 4 must-pass

| AC | Pre-condition | Verification | Expected on failure |
|---|---|---|---|
| AC1 | Rust toolchain installed | `cargo test --manifest-path programs/vesting/Cargo.toml` exits 0 | Compile error or assertion failure in `schedule.rs` tests |
| AC2 | `anchor build` exits 0 | IDL has 12 instructions + 2 account types + 9 events + `SameRoot` + `NotSingleStream` errors | Missing field in IDL |
| AC3 | Campaign created + funded; beneficiary on linear leaf ~50% through window | T1 in `anchor test` — transferred amount ±5% of expected | Token balance outside band |
| AC4 | Campaign created + funded; 2+ beneficiaries | T2 — flip one proof byte → must fail `VestingError::InvalidProof` | Silent pass = critical bug |
| AC5 | Campaign with `pause_authority` set | T3 — pause blocks claim with `VestingError::CampaignPaused`; unpause restores | Wrong error or no error during pause |
| AC6 | Campaign created + funded + cancelled mid-stream | T4 — claimed amount ≤ pre-cancel vested; `effective_now` clamp confirmed | Claimed amount exceeds pre-cancel vested |
| AC7 | Campaign with 3 beneficiaries | T5 — kicked recipient fails `InvalidProof`; others succeed with new proofs | Old proof accepted post-rotation = critical bug |
| AC8 | TS Merkle library available | `GOLDEN_HASH=<rust_hex> anchor test` — TS `leafHash` byte-equals Rust `leaf_hash` | Any byte mismatch = every on-chain claim fails in production |
| AC9 | Fresh localnet | Creator rent ≤ 0.005 SOL after `create_campaign` + `fund_campaign` | Cost overrun = marketing claim is false |
| AC10 | All source committed | `cargo clippy --workspace -D warnings` exits 0 | Any warning = quality gate failure |
| AC11 | Devnet access + funded keypair | Full devnet smoke test: create → fund → claim → cancel → withdraw completes in ≤ 15 min | Any step fails on fresh machine |

### Stretch goals

| AC | Description |
|---|---|
| AC-S1 | T6 (claim before cliff → `NothingToClaim`), T7 (full amount after end_time), T10 (milestone bitmap + `MilestoneAlreadyClaimed`) |
| AC-S2 | T15 (`SameRoot`), T17 (unauthorized `update_root` → `Unauthorized`) |
| AC-S3 | `events_emitted_test` — every state-changing instruction emits its event |

---

## §5 Non-functional Requirements

### NFR-1 — Cost

**Requirement:** Creator-side rent ≤ 0.005 SOL for any campaign size, measured, not estimated.  
**Verification:** AC9 — rent assertion in T1 setup: `assert!(before_lamports - after_lamports <= 5_000_000)`.

### NFR-2 — Compute budget

**Requirement:** `claim` must complete within Solana's default 200,000 CU budget without requesting a higher limit.  
**Rationale:** A 20-level tree (2^20 = 1M recipients) requires 20 keccak hashes, each roughly 200–500 CU. Total `claim` CU is well under the limit, but must be confirmed rather than assumed.  
**Verification:** Add a CU consumption assertion inside T1 via `simulateTransaction`. Assert CU consumed < 200,000.

### NFR-3 — Security coverage

**Requirement:** Every `VestingError` variant triggered by at least one named test before audit.  
**Rationale:** Un-exercised error paths are unreviewed code. Auditors flag them as risks.  
**Verification:** `docs/SECURITY.md §5` maps each error to a test name. Every row must have a passing test before the audit package is prepared.

### NFR-4 — Token-2022 rejection

**Requirement:** `create_campaign` must reject Token-2022 mints with `VestingError::UnsupportedMint` (to be added to `errors.rs`). Silently accepting them causes `claim` to deliver fewer tokens than the leaf specifies.  
**Verification:** `create_with_token22_mint_fails` integration test.

### NFR-5 — Devnet availability

**Requirement:** Program reachable at `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` throughout Week 4. README walkthrough ≤ 15 min on a fresh machine.  
**Verification:** AC11.

---

## §6 Open Questions

| # | Question | Default (MVP) | Deadline | Owner |
|---|---|---|---|---|
| Q1 | Should `cancel_authority` be a Squads v4 multisig in Phase 1 or a single key? | Single `Pubkey` | Before audit | BD → Lana |
| Q2 | Are there Week 4 launch partners requiring Token-2022 extensions? | SPL Token only; reject Token-2022 | Before audit | BD |
| Q3 | `init_if_needed` race on first `claim`: two concurrent first-claim txs — one fails with "account already initialized." Is retry-on-client acceptable UX? | Frontend retries; document in README | Before Week 4 ends | Lana + Geral |
| Q4 | Proof hosting: Pinata vs. Cloudflare R2 vs. self-hosted GitHub Pages? Lana needs the base URL format for `INTEGRATION.md`. | Pinata (Geral's default) | Before Week 4 ends | Geral |
| Q5 | Should `update_root` require proofs to be pinned before the root is committed? Protocol cannot enforce off-chain pinning, but SDK and README should document the sequence. | Document recommended sequence (pin → rotate → notify) in README; SDK emits warning if called without `proofUri` | Before audit | Lana + Geral |

---

## Appendix A — Competitor comparison (full table)

Source: `week1/SUBMISSION_LANA.md §2`. SOL at ~$85 (2026-04-19).

| | Streamflow | Zebec | Magna | Bonfida | Armada | Jito Distributor |
|---|---|---|---|---|---|---|
| **Storage model** | 1 PDA per stream | 1 PDA per stream + 1 per milestone | Shared pool | 1 PDA per recipient | 1 PDA per grant + option token | 1 Merkle root (whole campaign) |
| **Cliff** | Yes | Yes | Yes | Yes | Yes (option expiry) | Yes |
| **Linear** | Yes | Yes | Yes | Yes (discrete steps) | No | Yes (post-cliff) |
| **Milestone** | No (UI only) | Yes | No | Yes (each schedule entry) | No | No |
| **Cost / 10K users** | ~$3,720 | ~$11,730 | ~$1,990 | ~$1,990 | ~$1,990–$4,250 | ~$0.20 |
| **Merkle compression** | No | No | No | No | No | Yes |
| **DeFi composability** | No | No | No | No | No | No |
| **DAO governance** | No | No | No | No | No | No |
| **Per-recipient clawback** | No | No | No | No | No | No |
| **Audit** | Halborn + OtterSec | Sec3 + OtterSec | Unknown | Kudelski | Sec3 (core only) | Unconfirmed |
| **Open source** | Yes | Yes | No | Yes | Yes | Yes |
