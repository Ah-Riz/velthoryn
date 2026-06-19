# ADR-FE-006: Manual Claim Instruction Builder (IDL Drift Mitigation)

**Status:** Active (pending clean redeploy)
**Date:** 2026-05-25 (discovered); documented 2026-06-19
**Owner:** Geral (Frontend)

## Context

During Week 6 devnet testing, bulk campaign claims consistently failed with simulation errors.
Initial diagnosis suspected a Merkle proof hashing bug. The actual root cause was a
**3-way interface drift** between:

1. **Local Rust source** (`programs/vesting/src/instructions/claim.rs`) — current HEAD
2. **Local IDL** (`apps/web/src/lib/anchor/idl.json`) — generated at some prior build
3. **Live devnet binary** (`G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`) — older deployment

The three interfaces disagreed on the `claim` instruction's account ordering:

| # | Local Rust source | Local IDL | Live devnet |
|---|---|---|---|
| 6 | `beneficiary_ata` | `mint` | `beneficiary_token_account` |
| 7 | `mint` | `beneficiary_ata` | *(only 9 accounts total)* |

The live devnet also used older field names (`tree` instead of `vesting_tree`,
`beneficiary_token_account` instead of `beneficiary_ata`) and had only 9 accounts vs
10 in the current source.

### Observed error (before fix)

```
ProgramError caused by account: mint. Message: An account's data contents was invalid.
```

This error surfaced because the local IDL was sending `mint` in position 6, but the
live devnet binary expected `beneficiary_ata` in that slot — an ATA address is not a
valid mint account, causing the program to reject it.

## Decision

**Do not replace the global IDL with the fetched devnet IDL.** The devnet IDL is from
an older interface version. Replacing it would fix `claim` but break every other
instruction that already follows the current source layout.

Instead, `ClaimWithProofButton` builds the `claim` instruction **manually** using
`new TransactionInstruction({ programId, keys: [...], data })`:

```ts
claimIx = new TransactionInstruction({
  programId: program.programId,
  keys: [
    { pubkey: beneficiary,      isSigner: true,  isWritable: true  },
    { pubkey: vestingTree,      isSigner: false, isWritable: true  },
    { pubkey: claimRecord,      isSigner: false, isWritable: true  },
    { pubkey: vaultAuthority,   isSigner: false, isWritable: false },
    { pubkey: vault,            isSigner: false, isWritable: true  },
    { pubkey: beneficiaryAta,   isSigner: false, isWritable: true  },
    { pubkey: mint,             isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, ... },
    { pubkey: SystemProgram.programId, ... },
  ],
  data: <claim discriminator + encoded args>,
});
```

This matches the **local Rust source order** (which is what a clean redeploy will use),
not the drifted devnet interface. Simulation passes after this fix.

## Consequences

**Positive**
- Claims work on the live devnet despite the drift.
- The compatibility path mirrors the local Rust source, not the stale devnet, so it
  will continue to work after a clean redeploy with no changes required.

**Negative / trade-offs**
- The manual builder bypasses Anchor's type-checked `program.methods.claim(...)` API.
  If the Rust source account order changes in the future, the manual keys array in
  `ClaimWithProofButton.tsx` must be updated manually — there is no compile-time check.
- The instruction discriminator (`claim` 8-byte hash) must be kept in sync manually.
  Currently encoded via `program.coder.instruction.encode("claimWithProof", args).slice(8)`.

## Clean-up condition

This workaround can be removed when all three are true:
1. `anchor idl fetch devnet G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` matches local Rust source account ordering.
2. `apps/web/src/lib/anchor/idl.json` is regenerated from the same source.
3. `program.methods.claimWithProof(...).accounts(...).rpc()` succeeds without the manual builder.

## References

- `apps/web/src/components/campaign/detail/ClaimWithProofButton.tsx` lines 297–450 — manual builder
- `programs/vesting/src/instructions/claim.rs` — Rust source (authoritative account order)
- `apps/web/src/lib/anchor/idl.json` — local IDL (may still differ from Rust source)
- [ADR-FE-005](ADR-FE-005-server-side-tx-building.md) — why tx building is server/component-side, not hook-side
- `research-docs/week6/CLAIM_DEVNET_IDL_DRIFT.md` — original debugging notes (gitignored)
