# Error code map — tutorial checklist vs Velthoryn

Velthoryn uses `VestingError` in [`programs/vesting/src/errors.rs`](../programs/vesting/src/errors.rs). Anchor custom errors start at **6000** (`0x1770`).

This table maps common **bootcamp / tutorial** names to the on-chain variants and tests that exercise them.

| Tutorial / checklist name | Velthoryn variant | Code | Hex | When | Test |
|---------------------------|-------------------|------|-----|------|------|
| `InsufficientBalance` | `InsufficientVault` | 6016 | `0x1780` | Vault balance &lt; claimable transfer | T52, EXPLOIT 4 |
| `UnauthorizedWithdraw` | `UnauthorizedClaimer` | 6010 | `0x177a` | Signer is not the leaf beneficiary | T9, T24, EXPLOIT 2 |
| Withdraw more than unlocked | `NothingToClaim` | 6015 | `0x177f` | No vested delta left (`vested − claimed ≤ 0`) | T23, T8, T59, EXPLOIT 1 |
| Bad schedule / wrong params | `InvalidProof` | 6013 | `0x177d` | Reconstructed leaf hash ≠ `merkle_root` | T24 (withdraw), EXPLOIT 3 |
| `StreamNotEnded` | *(not used)* | — | — | `withdraw` has no amount arg; only pays `vested − claimed` | — |
| Zero deposit | `ZeroAmount` | 6002 | `0x1772` | `create_stream` amount = 0 | T32 |
| Invalid times | `InvalidSchedule` | 6011 | `0x177b` | `start > cliff` or `cliff > end` | T30 |
| Campaign paused | `CampaignPaused` | 6009 | `0x1779` | `withdraw` while `paused` | T45 |
| Multi-recipient on `withdraw` | `NotSingleStream` | 6028 | `0x178c` | `leaf_count != 1` | T40 |
| Oversized Merkle proof | `ProofTooLong` | 6029 | `0x178d` | `proof.len() > 32` or `proof.len() > ceil(log2(leaf_count))` | EXPLOIT 4 |

## Full error list

See [`docs/PROGRAM.md`](PROGRAM.md) and the IDL at [`apps/web/src/lib/anchor/idl.json`](../apps/web/src/lib/anchor/idl.json).

## Frontend

User-facing strings are centralized in [`apps/web/src/lib/anchor/errors.ts`](../apps/web/src/lib/anchor/errors.ts) via `formatVestingError()`.
