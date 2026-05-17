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

## Related docs

- [`docs/PROGRAM.md`](PROGRAM.md) — account layouts and instructions
- [`docs/ERROR_MAP.md`](ERROR_MAP.md) — tutorial error names vs `VestingError`
- [`docs/TDD_LANA.md`](TDD_LANA.md) §4.2a–4.2b — `create_stream` / `withdraw` spec
