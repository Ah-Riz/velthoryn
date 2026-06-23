# Stream model — tutorial `Stream` PDA vs Velthoryn

Many vesting tutorials define a **`Stream` PDA** with on-chain fields: `creator`, `recipient`, `mint`, `amount`, `start_time`, `end_time`, `withdrawn_amount`.

Velthoryn does **not** use that account type. It implements the same **behavior** for single-recipient deals using the Merkle campaign model from [`docs/PRD_LANA.md`](PRD_LANA.md).

## Grader summary

> A “stream” is a **single-leaf campaign** (`leaf_count == 1`): `create_stream` commits the schedule into the Merkle root and funds the vault; `ClaimRecord.claimed_amount` tracks withdrawals; `withdraw` is the recipient-only claim path without a Merkle proof.

## Field mapping

| Tutorial `Stream` field | Velthoryn equivalent | Where |
|-------------------------|----------------------|--------|
| `creator` | `VestingTree.creator` | On-chain PDA |
| `recipient` | `VestingLeaf.beneficiary` | In Merkle leaf (args on `withdraw`) |
| `mint` | `VestingTree.mint` | On-chain PDA |
| `amount` | `VestingTree.total_supply` | On-chain PDA |
| `start_time` | `VestingLeaf.start_time` | Leaf / `WithdrawArgs` |
| `end_time` | `VestingLeaf.end_time` | Leaf / `WithdrawArgs` |
| `withdrawn_amount` | `ClaimRecord.claimed_amount` | On-chain PDA (per beneficiary) |
| Escrow balance | Vault ATA | SPL token account; authority = `vault_authority` PDA |
| Linear cliff | `VestingLeaf.cliff_time` | Vesting starts at cliff for linear (`release_type = 1`) |

## Instructions

| Tutorial step | Velthoryn |
|---------------|-----------|
| `create_stream` + deposit | [`create_stream`](../programs/vesting/src/instructions/create_stream.rs) — atomic create + fund |
| `withdraw` | [`withdraw`](../programs/vesting/src/instructions/withdraw.rs) — only when `leaf_count == 1` |
| Creator cannot claim escrow | `withdraw` requires **beneficiary** signer; creator uses `withdraw_unvested` only after cancel + grace |

## Schedule availability

Schedule fields are **hashed into `merkle_root` at creation**, not stored as separate columns on `VestingTree`. Recipients must pass the same schedule in `withdraw` (or use the web app / API / localStorage — see [`INTEGRATION.md`](INTEGRATION.md)).

## Why not a `Stream` PDA?

Per PRD §1.1: fixed ~0.005 SOL campaign cost vs ~$0.37/recipient for Streamflow-style one-PDA-per-stream. Bulk campaigns share one `VestingTree` + one root for unlimited recipients.

## Milestone vs tutorial “creator flag”

Bootcamp checklists describe milestone unlock via a **creator-set boolean flag**. Velthoryn implements that on-chain:

- **`set_milestone_released(milestone_idx)`** — creator signer; sets a bit in `VestingTree.milestone_released_flags`.
- **`release_type = 2`** leaves: `claim` / `withdraw` require the flag (not `cliff_time`).
- `milestone_idx` + `milestone_bitmap` on `ClaimRecord` prevent double-claim of the same milestone slot.

Tests: T10, T11, T46, T63. See [BE-SC-MERKLE-ACCEPTANCE-STATUS.md](./BE-SC-MERKLE-ACCEPTANCE-STATUS.md).

## Cancel vs tutorial `cancel_stream`

| Tutorial | Velthoryn |
|----------|-----------|
| Single `cancel_stream` splits unlocked/locked | **`cancel_stream`** for `leaf_count == 1`: vested → beneficiary, vault remainder → creator in one tx (T64) |
| Multi-recipient cancel | `cancel_campaign` + per-beneficiary `claim`/`withdraw` + `withdraw_unvested` after 7-day grace |
| Cannot cancel when fully vested | `FullyVested` (6030) — T60 |
| Cancel before cliff | `cancel_campaign` — T62 |
| Cancel mid-stream (clamp) | T55 (bankrun clock) |

## Related docs

- [`docs/PROGRAM.md`](PROGRAM.md) — account layouts and instructions
- [`docs/ERROR_MAP.md`](ERROR_MAP.md) — tutorial error names vs `VestingError`
- [`docs/TDD_LANA.md`](TDD_LANA.md) §4.2a–4.2b — `create_stream` / `withdraw` spec
