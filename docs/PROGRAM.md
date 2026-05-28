# Vesting Program — Internals

This document describes the on-chain program at `programs/vesting/`. All instructions and math modules are **LIVE** and fully implemented.

Program ID: `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`
Deployed: devnet (latest upgrade at slot **464782646**, ~492KB allocation). Local keypair at `target/deploy/vesting-keypair.json` (gitignored; must match `G6iaig…` or use upgrade-authority wallet for deploy).

## File map

```
programs/vesting/src/
├── lib.rs                  # #[program] dispatcher — wires the 18 entry points
├── constants.rs            # GRACE_PERIOD_SECS, MAX_MERKLE_PROOF_LEN
├── errors.rs               # VestingError enum (41 variants)
├── events.rs               # 10 event types (CampaignCreated, Claimed, InstantRefunded, …)
├── state/
│   ├── mod.rs              # re-exports (includes NATIVE_SOL_MINT)
│   ├── vesting_tree.rs     # VestingTree #[account] — campaign PDA, is_native() helper
│   ├── claim_record.rs     # ClaimRecord  #[account] — per-(tree, beneficiary) PDA
│   └── leaf.rs             # VestingLeaf — Borsh struct, NOT an account (lives in Merkle tree)
├── math/
│   ├── mod.rs              # re-exports
│   ├── schedule.rs         # vested(), get_vested_amount() — LIVE
│   └── merkle.rs           # leaf_hash(), verify_merkle_proof() — LIVE
└── instructions/
    ├── mod.rs              # re-exports
    ├── create_campaign.rs  # LIVE + handler_native (native SOL)
    ├── create_stream.rs    # LIVE + handler_native (native SOL)
    ├── fund_campaign.rs    # LIVE + handler_native (native SOL)
    ├── claim.rs            # LIVE — dual-path: SPL CPI or native SOL lamport transfer
    ├── withdraw.rs         # LIVE — dual-path: SPL CPI or native SOL lamport transfer
    ├── cancel_campaign.rs  # LIVE
    ├── cancel_stream.rs    # LIVE — dual-path: SPL CPI or native SOL lamport split
    ├── set_milestone_released.rs # LIVE — creator milestone boolean flags
    ├── update_root.rs      # LIVE
    ├── withdraw_unvested.rs# LIVE — dual-path: SPL CPI or native SOL lamport drain
    ├── pause_campaign.rs   # LIVE (exposes pause_handler + unpause_handler)
    ├── close_claim_record.rs # LIVE
    ├── get_vested_amount.rs  # LIVE (view function)
    └── instant_refund_campaign.rs # LIVE — creator instant refund (multi-leaf, unstarted)
```

## Instruction surface

| Entry point          | Args                                                     | Role |
| -------------------- | -------------------------------------------------------- | -------------------- |
| `create_campaign`    | `CreateCampaignArgs` (incl. `min_cliff_time`)            | Initialize a `VestingTree` PDA + token vault. Validates root, leaf_count, total_supply, cancel_authority. Stores `min_cliff_time` (minimum leaf cliff) for instant-refund eligibility. |
| `create_campaign_native` | `CreateCampaignArgs`                                 | Same for native SOL — PDA holds lamports directly, no vault ATA. `mint = NATIVE_SOL_MINT`. |
| `create_stream`      | `CreateStreamArgs`                                       | Atomic single-recipient campaign creation + funding in one transaction. Computes Merkle root on-chain for a single-leaf tree. |
| `create_stream_native` | `CreateStreamArgs`                                     | Same for native SOL — `system_program::transfer` funds the PDA. |
| `fund_campaign`      | `amount: u64`                                            | Transfer SPL tokens from creator into the vault, capped at `total_supply`. |
| `fund_campaign_native` | `amount: u64`                                          | Same for native SOL — SOL transfer to PDA via system CPI. Tracks funded amount via PDA lamports minus rent-exempt minimum. |
| `claim`              | `leaf: VestingLeaf, proof: Vec<[u8; 32]>`                | Verify proof against current root, run schedule math, transfer vested delta to beneficiary. SPL: token CPI. Native SOL: direct lamport debit from PDA. |
| `withdraw`           | `WithdrawArgs`                                           | Simplified claim for single-recipient streams (leaf_count == 1). Dual-path: SPL CPI or native SOL lamport transfer. |
| `cancel_campaign`    | —                                                        | Cancel-authority sets `cancelled_at = now`. Starts the 7-day grace clock. |
| `cancel_stream`      | `WithdrawArgs`                                           | Creator-only for `leaf_count == 1`: vested → beneficiary, remainder → creator. Dual-path. Milestone-aware. OverClaim guard on `total_claimed`. |
| `set_milestone_released` | `milestone_idx: u8`                                | Creator sets bit in `milestone_released_flags`. Idempotency guard: second call rejects with `MilestoneAlreadyReleased`. |
| `update_root`        | `new_root`, `new_leaf_count`, `new_min_cliff_time`       | Cancel-authority rotates the Merkle root (per-recipient clawback). Updates `min_cliff_time` for the new leaf set. |
| `instant_refund_campaign` | —                                                   | Creator-only: multi-leaf, `now < min_cliff_time`, no milestone flags set. Marks `instant_refunded`, drains vault/PDA to creator. |
| `withdraw_unvested`  | —                                                        | After grace, creator sweeps unvested balance. SPL: token CPI. Native SOL: drain PDA lamports to creator. |
| `pause_campaign`     | —                                                        | Pause-authority blocks claims. |
| `unpause_campaign`   | — (shares Accounts with pause_campaign)                  | Resume a paused campaign. |
| `close_claim_record` | —                                                        | Reclaim rent on a finished `ClaimRecord`. Checks `total_entitled > 0 && claimed_amount >= total_entitled` or post-grace. |
| `get_vested_amount`  | `leaf: VestingLeaf, cancelled_at: Option<i64>, now: i64, milestone_released_flags: Option<[u8; 32]>` | Read-only helper. For milestone type: returns 0 if flag not set, full amount if released. |

Args are defined alongside their instruction (`CreateCampaignArgs` lives in `instructions/create_campaign.rs`).

## State accounts

### `VestingTree` (campaign PDA)

| Field              | Type             | Notes |
| ------------------ | ---------------- | ----- |
| `creator`          | `Pubkey`         | Funded the campaign. Owns `cancel`/`fund`/`withdraw_unvested`. |
| `mint`             | `Pubkey`         | SPL mint distributed by this campaign. `NATIVE_SOL_MINT` (all-zeros) signals native SOL. |
| `is_native()`      | `bool`           | Returns `true` when `mint == NATIVE_SOL_MINT`. Used to branch transfer logic. |
| `vault`            | `Pubkey`         | ATA holding the campaign's tokens. Owned by `vault_authority`. |
| `vault_authority`  | `Pubkey`         | PDA = `["vault_authority", tree.key()]`. |
| `campaign_id`      | `u64`            | Caller-supplied ID. Lets one creator+mint pair host multiple campaigns. |
| `merkle_root`      | `[u8; 32]`       | Current root. Rotated by `update_root`. |
| `leaf_count`       | `u32`            | Tree size. |
| `total_supply`     | `u64`            | Cap on funding. |
| `total_claimed`    | `u64`            | Sum claimed across all beneficiaries. |
| `cancellable`      | `bool`           | If false, `cancel_campaign` is rejected. |
| `cancel_authority` | `Option<Pubkey>` | Required if `cancellable`. |
| `cancelled_at`     | `Option<i64>`    | Set by `cancel_campaign`. Drives grace timer. |
| `paused`           | `bool`           | Toggled by pause/unpause. |
| `pause_authority`  | `Option<Pubkey>` | If `None`, pause/unpause is rejected. |
| `created_at`       | `i64`            | Unix seconds. |
| `min_cliff_time`   | `i64`            | Minimum `cliff_time` across current leaves; gates `instant_refund_campaign`. |
| `milestone_released_flags` | `[u8; 32]` | Bitmap of released milestones (gates instant refund + milestone claims). |
| `instant_refunded` | `bool`           | True after `instant_refund_campaign`; blocks `claim` and `set_milestone_released`. |
| `bump`             | `u8`             | PDA bump cache. |

PDA seeds: `["tree", creator, mint, campaign_id.to_le_bytes()]`.

### `ClaimRecord` (per-recipient PDA)

| Field              | Type        | Notes |
| ------------------ | ----------- | ----- |
| `beneficiary`      | `Pubkey`    | Must equal `claim.signer`. |
| `tree`             | `Pubkey`    | The `VestingTree` it belongs to. |
| `claimed_amount`   | `u64`       | Cumulative claimed by this beneficiary. Survives root rotation. |
| `total_entitled`   | `u64`       | Set once on first claim/withdraw. Total leaf amount. Used by `close_claim_record` to verify full vesting without trusting a caller-supplied value. |
| `milestone_bitmap` | `[u8; 32]`  | One bit per milestone index for milestone-type leaves. |
| `last_claim_at`    | `i64`       | For analytics / UX. |
| `bump`             | `u8`        | PDA bump cache. |

PDA seeds: `["claim", tree.key(), beneficiary]`.

> **Migration warning:** `total_entitled` is a layout-breaking change. Existing on-chain ClaimRecords predating this field cannot be deserialized correctly and require a migration (e.g. `realloc` + fill, or close + re-claim). See `programs/vesting/src/state/claim_record.rs`.

### `VestingLeaf` (off-chain, in the Merkle tree)

Not an account — lives off-chain inside the Merkle tree, gets passed in to `claim` along with the proof.

| Field           | Type     | Offset | Notes |
| --------------- | -------- | ------ | ----- |
| `leaf_index`    | `u32`    | 0      | |
| `beneficiary`   | `Pubkey` | 4      | |
| `amount`        | `u64`    | 36     | |
| `release_type`  | `u8`     | 44     | `0 = Cliff`, `1 = Linear`, `2 = Milestone` |
| `start_time`    | `i64`    | 45     | |
| `cliff_time`    | `i64`    | 53     | |
| `end_time`      | `i64`    | 61     | |
| `milestone_idx` | `u8`     | 69     | |
| Field           | Type     | Offset | Notes |
| --------------- | -------- | ------ | ----- |
| `leaf_index`    | `u32`    | 0      | |
| `beneficiary`   | `Pubkey` | 4      | |
| `amount`        | `u64`    | 36     | |
| `release_type`  | `u8`     | 44     | `0 = Cliff`, `1 = Linear`, `2 = Milestone` |
| `start_time`    | `i64`    | 45     | |
| `cliff_time`    | `i64`    | 53     | |
| `end_time`      | `i64`    | 61     | |
| `milestone_idx` | `u8`     | 69     | |

Total: **70 bytes** Borsh LE. **Field order is the wire order** — the TS encoder must serialize bytes identically or every claim fails proof verification. Golden-vector test in `apps/web/` gates byte equality between Rust and TS.
Total: **70 bytes** Borsh LE. **Field order is the wire order** — the TS encoder must serialize bytes identically or every claim fails proof verification. Golden-vector test in `apps/web/` gates byte equality between Rust and TS.

## Errors

`VestingError` (**41** variants) covers every checked condition. Read `programs/vesting/src/errors.rs` for the full list.

**Tutorial / checklist mapping:** see [`docs/ERROR_MAP.md`](ERROR_MAP.md) (e.g. `InsufficientBalance` → `InsufficientVault`, `UnauthorizedWithdraw` → `UnauthorizedClaimer`).

**Single-recipient “stream” model:** see [`docs/STREAM_MODEL.md`](STREAM_MODEL.md).

Notable variants:

- `EmptyRoot`, `EmptyCampaign`, `ZeroAmount` — guard `create_campaign` args.
- `InvalidProof`, `NothingToClaim`, `MilestoneAlreadyClaimed` — claim-path failures.
- `ProofTooLong` (6029) — Merkle proof exceeds `MAX_MERKLE_PROOF_LEN` or `max_proof_len_for_leaf_count` (VEL-009).
- `MilestoneAlreadyReleased` (6033) — `set_milestone_released` called twice for same index.
- `CampaignPaused`, `CampaignCancelled`, `AlreadyCancelled` — state-toggle guards.
- `GracePeriodActive`, `NotCancelled` — gate `withdraw_unvested`.
- `NotSingleStream` — gates `withdraw` to single-recipient streams only.
- `CannotClose` — `close_claim_record` guard: requires `total_entitled > 0 && claimed_amount >= total_entitled` or post-grace.
- `InstantRefundedCampaign` (6035), `CampaignAlreadyStarted` (6036), `NotMultiLeafCampaign` (6040) — instant-refund path.
- `NativeSolVaultNotEmpty` (6037), `NativeSolRentViolation` (6038), `UnsupportedMint` (6039) — native SOL + mint guards.

## Events

Indexers watch these (`events.rs`): `CampaignCreated`, `CampaignFunded`, `Claimed`, `CampaignCancelled`, `RootUpdated`, `UnvestedWithdrawn`, `CampaignPaused`, `CampaignUnpaused`, `ClaimRecordClosed`, `InstantRefunded`. Each carries the tree pubkey + the relevant deltas.

## Math

### `math::merkle` — LIVE

`leaf_hash(leaf)` — **LIVE**. Computes `keccak256([LEAF_PREFIX] ++ borsh(leaf))` using `solana_keccak_hasher::hashv`. Byte-identical to the TS `hashLeaf()` in `apps/web/src/lib/merkle/builder.ts`.

`verify_merkle_proof(leaf_hash, proof, index, root)` — **LIVE**. Walks left/right siblings driven by `index`'s low bit, prefixing each node hash with `NODE_PREFIX`.

`max_proof_len_for_leaf_count(leaf_count)` — **LIVE**. Returns `ceil(log2(leaf_count))` for leaf_count > 1, else 0. Used by `claim` to reject oversized proofs. Cap at `MAX_MERKLE_PROOF_LEN = 32`.

### `math::schedule` — LIVE

`vested(leaf, now)` — **LIVE**. Computes Cliff (binary), Linear (proportional, `u128` multiply guarding overflow), or Milestone (binary by `cliff_time`).

`get_vested_amount(leaf, cancelled_at, now)` — **LIVE**. Clamps `now` against `cancelled_at` so post-cancel `claim` calls see a frozen curve.

## TS Client & Integration Tests

The TS client library (`clients/ts/`) provides leaf encoding and Merkle tree construction:
- `encodeLeaf`, `leafHash`, `nodeHash` — byte-identical to on-chain Rust
- `VestingMerkleTree` — builds Merkle trees with index-based proofs
- `MAX_TREE_DEPTH` — constant (20), maximum recommended tree depth
- `verifyProof()` — standalone proof verification for off-chain pre-verification
- `proofAsArrays()` — converts Buffer[] proofs to number[][] for Anchor IDL compatibility
- `prepareCampaign()` — builds tree, returns root + proofs + `minCliffTime` (minimum leaf cliff for on-chain `create_campaign`)
- `computeMinCliffTime()` — minimum cliff across leaves
- `CampaignRecipient`, `PreparedCampaign` — types for campaign preparation
- Golden vector gate verifies cross-language hash match

Integration tests in `tests/` cover T6-T71 (supplementary/error paths), `instant-refund-campaign.spec.ts` (11 tests), golden vector gate, and 11 security exploit tests (EXPLOIT 1–11).

**Test results (local validator):** **118 passing**, 2 pending (`pnpm test:localnet`). Clock-dependent tests use `solana-bankrun` for deterministic time control.
- Trident fuzz smoke: `trident-tests/fuzz_vesting` runs in CI after `anchor test`

Run with `pnpm test:localnet` (recommended) or start a persistent validator manually:
```bash
solana-test-validator --reset --quiet &
anchor program deploy --provider.cluster localnet target/deploy/vesting.so
ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json \
  pnpm exec ts-mocha -p ./tsconfig.json -t 1000000 'tests/**/*.spec.ts'
```
