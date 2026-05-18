# Vesting Program — Internals

This document describes the on-chain program at `programs/vesting/`. All instructions and math modules are **LIVE** and fully implemented.

Program ID: `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`
Deployed: devnet (latest upgrade at slot 461219566, ~447KB allocation). Keypair at `target/deploy/vesting-keypair.json`.

## File map

```
programs/vesting/src/
├── lib.rs                  # #[program] dispatcher — wires the 12 entry points
├── constants.rs            # GRACE_PERIOD_SECS, MAX_MERKLE_PROOF_LEN
├── errors.rs               # VestingError enum (31 variants including ProofTooLong)
├── events.rs               # 9 event types (CampaignCreated, Claimed, RootUpdated, …)
├── state/
│   ├── mod.rs              # re-exports
│   ├── vesting_tree.rs     # VestingTree #[account] — campaign PDA
│   ├── claim_record.rs     # ClaimRecord  #[account] — per-(tree, beneficiary) PDA
│   └── leaf.rs             # VestingLeaf — Borsh struct, NOT an account (lives in Merkle tree)
├── math/
│   ├── mod.rs              # re-exports
│   ├── schedule.rs         # vested(), get_vested_amount() — LIVE
│   └── merkle.rs           # leaf_hash(), verify_merkle_proof() — LIVE
└── instructions/
    ├── mod.rs              # re-exports
    ├── create_campaign.rs  # LIVE
    ├── create_stream.rs    # LIVE — atomic single-recipient campaign + fund
    ├── fund_campaign.rs    # LIVE
    ├── claim.rs            # LIVE
    ├── withdraw.rs         # LIVE — simplified claim for single-recipient streams
    ├── cancel_campaign.rs  # LIVE
    ├── update_root.rs      # LIVE
    ├── withdraw_unvested.rs# LIVE
    ├── pause_campaign.rs   # LIVE (exposes pause_handler + unpause_handler)
    ├── close_claim_record.rs # LIVE
    └── get_vested_amount.rs  # LIVE (view function)
```

## Instruction surface

| Entry point          | Args                                                     | Role |
| -------------------- | -------------------------------------------------------- | -------------------- |
| `create_campaign`    | `CreateCampaignArgs`                                     | Initialize a `VestingTree` PDA + token vault. Validates root, leaf_count, total_supply, cancel_authority. |
| `create_stream`      | `CreateStreamArgs`                                       | Atomic single-recipient campaign creation + funding in one transaction. Computes Merkle root on-chain for a single-leaf tree. |
| `fund_campaign`      | `amount: u64`                                            | Transfer SPL tokens from creator into the vault, capped at `total_supply`. |
| `claim`              | `leaf: VestingLeaf, proof: Vec<[u8; 32]>`                | Verify proof against current root, run schedule math, transfer vested delta to beneficiary, update `ClaimRecord`. |
| `withdraw`           | `WithdrawArgs`                                           | Simplified claim for single-recipient streams (leaf_count == 1). Reconstructs the leaf on-chain and verifies `leaf_hash == merkle_root` — no Merkle proof needed. |
| `cancel_campaign`    | —                                                        | Cancel-authority sets `cancelled_at = now`. Starts the 7-day grace clock. |
| `update_root`        | `new_root: [u8; 32], new_leaf_count: u32`                | Cancel-authority rotates the Merkle root (per-recipient clawback). |
| `withdraw_unvested`  | —                                                        | After grace, creator sweeps `vault_balance − vested_total_at_cancel`. |
| `pause_campaign`     | —                                                        | Pause-authority blocks claims. |
| `unpause_campaign`   | — (shares Accounts with pause_campaign)                  | Resume a paused campaign. |
| `close_claim_record` | —                                                        | Reclaim rent on a finished `ClaimRecord`. Checks `total_entitled > 0 && claimed_amount >= total_entitled` or post-grace. |
| `get_vested_amount`  | `leaf: VestingLeaf, cancelled_at: Option<i64>, now: i64` | Read-only helper that runs schedule math (returns u64). |

Args are defined alongside their instruction (`CreateCampaignArgs` lives in `instructions/create_campaign.rs`).

## State accounts

### `VestingTree` (campaign PDA)

| Field              | Type             | Notes |
| ------------------ | ---------------- | ----- |
| `creator`          | `Pubkey`         | Funded the campaign. Owns `cancel`/`fund`/`withdraw_unvested`. |
| `mint`             | `Pubkey`         | SPL mint distributed by this campaign. |
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

`VestingError` (31 variants) covers every checked condition. Read `programs/vesting/src/errors.rs` for the full list.

**Tutorial / checklist mapping:** see [`docs/ERROR_MAP.md`](ERROR_MAP.md) (e.g. `InsufficientBalance` → `InsufficientVault`, `UnauthorizedWithdraw` → `UnauthorizedClaimer`).

**Single-recipient “stream” model:** see [`docs/STREAM_MODEL.md`](STREAM_MODEL.md).

Notable variants:

- `EmptyRoot`, `EmptyCampaign`, `ZeroAmount` — guard `create_campaign` args.
- `InvalidProof`, `NothingToClaim`, `MilestoneAlreadyClaimed` — claim-path failures.
- `ProofTooLong` (6029) — Merkle proof exceeds `MAX_MERKLE_PROOF_LEN` or `max_proof_len_for_leaf_count` (VEL-009).
- `CampaignPaused`, `CampaignCancelled`, `AlreadyCancelled` — state-toggle guards.
- `GracePeriodActive`, `NotCancelled` — gate `withdraw_unvested`.
- `NotSingleStream` — gates `withdraw` to single-recipient streams only.
- `CannotClose` — `close_claim_record` guard: requires `total_entitled > 0 && claimed_amount >= total_entitled` or post-grace.

## Events

Indexers watch these (`events.rs`): `CampaignCreated`, `CampaignFunded`, `Claimed`, `CampaignCancelled`, `RootUpdated`, `UnvestedWithdrawn`, `CampaignPaused`, `CampaignUnpaused`, `ClaimRecordClosed`. Each carries the tree pubkey + the relevant deltas.

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
- `prepareCampaign()` — recommended way to prepare campaign data (builds tree, returns root + proof set)
- `CampaignRecipient`, `PreparedCampaign` — types for campaign preparation
- Golden vector gate verifies cross-language hash match

Integration tests in `tests/` cover T6-T55 (supplementary/error paths), golden vector gate, and 11 security exploit tests (EXPLOIT 1–11) — 70 tests total.

**Test results (local validator):** All passing. Clock-dependent tests use `solana-bankrun` for deterministic time control.
- Trident fuzz smoke: `trident-tests/fuzz_vesting` runs in CI after `anchor test`

Run with `pnpm test:localnet` (recommended) or start a persistent validator manually:
```bash
solana-test-validator --reset --quiet &
anchor program deploy --provider.cluster localnet target/deploy/vesting.so
ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json \
  pnpm exec ts-mocha -p ./tsconfig.json -t 1000000 'tests/**/*.spec.ts'
```
