# Vesting Program — Internals

This document describes the on-chain program at `programs/vesting/`. Items marked **STUB** return `Ok(())` (or `0` / `false`) — shape matches the Week 2 architecture, behaviour does not yet. Items marked **LIVE** are fully implemented.

Program ID: `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`
Deployed: devnet (slot 460511260). Keypair at `target/deploy/vesting-keypair.json`.

## File map

```
programs/vesting/src/
├── lib.rs                  # #[program] dispatcher — wires the 10 entry points
├── constants.rs            # GRACE_PERIOD_SECS, MAX_MILESTONES, LEAF_PREFIX, NODE_PREFIX
├── errors.rs               # VestingError enum (30 variants, full set per architecture)
├── events.rs               # 9 event types (CampaignCreated, Claimed, RootUpdated, …)
├── state/
│   ├── mod.rs              # re-exports
│   ├── vesting_tree.rs     # VestingTree #[account] — campaign PDA
│   ├── claim_record.rs     # ClaimRecord  #[account] — per-(tree, beneficiary) PDA
│   └── leaf.rs             # VestingLeaf — Borsh struct, NOT an account (lives in Merkle tree)
├── math/
│   ├── mod.rs              # re-exports
│   ├── schedule.rs         # vested(), get_vested_amount() — STUB: returns 0
│   └── merkle.rs           # leaf_hash() — LIVE; verify_merkle_proof() — STUB: returns false
└── instructions/
    ├── mod.rs              # re-exports
    ├── create_campaign.rs  # STUB
    ├── fund_campaign.rs    # STUB
    ├── claim.rs            # STUB
    ├── cancel_campaign.rs  # STUB
    ├── update_root.rs      # STUB
    ├── withdraw_unvested.rs# STUB
    ├── pause_campaign.rs   # STUB (exposes pause_handler + unpause_handler)
    ├── close_claim_record.rs # STUB
    └── get_vested_amount.rs  # STUB (returns 0)
```

## Instruction surface

| Entry point          | Args                                                     | Role (Week 4 target) |
| -------------------- | -------------------------------------------------------- | -------------------- |
| `create_campaign`    | `CreateCampaignArgs`                                     | Initialize a `VestingTree` PDA + token vault. Validates root, leaf_count, total_supply, cancel_authority. |
| `fund_campaign`      | `amount: u64`                                            | Transfer SPL tokens from creator into the vault, capped at `total_supply`. |
| `claim`              | `leaf: VestingLeaf, proof: Vec<[u8; 32]>`                | Verify proof against current root, run schedule math, transfer vested delta to beneficiary, update `ClaimRecord`. |
| `cancel_campaign`    | —                                                        | Cancel-authority sets `cancelled_at = now`. Starts the 7-day grace clock. |
| `update_root`        | `new_root: [u8; 32], new_leaf_count: u32`                | Cancel-authority rotates the Merkle root (per-recipient clawback). |
| `withdraw_unvested`  | —                                                        | After grace, creator sweeps `vault_balance − vested_total_at_cancel`. |
| `pause_campaign`     | —                                                        | Pause-authority blocks claims. |
| `unpause_campaign`   | — (shares Accounts with pause_campaign)                  | Resume a paused campaign. |
| `close_claim_record` | `expected_total: u64`                                    | Reclaim rent on a finished `ClaimRecord`. |
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
| `milestone_bitmap` | `[u8; 32]`  | One bit per milestone index for milestone-type leaves. |
| `last_claim_at`    | `i64`       | For analytics / UX. |
| `bump`             | `u8`        | PDA bump cache. |

PDA seeds: `["claim", tree.key(), beneficiary]`.

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

Total: **70 bytes** Borsh LE. **Field order is the wire order** — the TS encoder must serialize bytes identically or every claim fails proof verification. Golden-vector test in `apps/web/` gates byte equality between Rust and TS.

## Errors

`VestingError` (30 variants) covers every checked condition. Read `programs/vesting/src/errors.rs` for the full list. Notable ones:

- `EmptyRoot`, `EmptyCampaign`, `ZeroAmount` — guard `create_campaign` args.
- `InvalidProof`, `NothingToClaim`, `MilestoneAlreadyClaimed` — claim-path failures.
- `CampaignPaused`, `CampaignCancelled`, `AlreadyCancelled` — state-toggle guards.
- `GracePeriodActive`, `NotCancelled` — gate `withdraw_unvested`.

## Events

Indexers watch these (`events.rs`): `CampaignCreated`, `CampaignFunded`, `Claimed`, `CampaignCancelled`, `RootUpdated`, `UnvestedWithdrawn`, `CampaignPaused`, `CampaignUnpaused`, `ClaimRecordClosed`. Each carries the tree pubkey + the relevant deltas.

## Math

### `math::merkle` — LIVE / partial

`leaf_hash(leaf)` — **LIVE**. Computes `keccak256([LEAF_PREFIX] ++ borsh(leaf))` using `solana_keccak_hasher::hashv`. Byte-identical to the TS `hashLeaf()` in `apps/web/src/lib/merkle/builder.ts`.

`verify_merkle_proof(leaf_hash, proof, index, root)` — **STUB** (returns `false`). Will walk left/right siblings driven by `index`'s low bit, prefixing each node hash with `NODE_PREFIX`.

### `math::schedule` — STUB

`vested(leaf, now)` — returns `0`. Will compute Cliff (binary), Linear (proportional, `u128` multiply guarding overflow), or Milestone (binary by `cliff_time`).

`get_vested_amount(leaf, cancelled_at, now)` — returns `0`. Will clamp `now` against `cancelled_at` so post-cancel `claim` calls see a frozen curve.

## Where Week 4 picks up

For each instruction:
1. Replace the minimal `Accounts` block (currently `Signer + Program<System>`) with the full constraint block from `OPENCLAW_BRIEF.md` §6.15+.
2. Replace `Ok(())` with the real handler body.
3. Implement `verify_merkle_proof` and `math::schedule::vested` / `get_vested_amount`.
4. For `claim`, wire `crate::math::{schedule, merkle}`.

For tests, expand `tests/vesting.spec.ts` using integration scenarios from the brief §10. The TS Merkle helpers are already real (`apps/web/src/lib/merkle/builder.ts`) — use them in tests directly or wait for `clients/ts/` to re-export them.
