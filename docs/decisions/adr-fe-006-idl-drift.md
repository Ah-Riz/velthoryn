# ADR-FE-006: Manual Claim Instruction Builder (IDL Drift Mitigation)

**Status:** Accepted

{% hint style="info" %}
This workaround can be removed once the devnet binary, local IDL, and Rust source are all aligned. See the clean-up conditions at the end of this document.
{% endhint %}

## Context

During Week 6 devnet testing, bulk campaign claims consistently failed with simulation errors. Initial diagnosis suspected a Merkle proof hashing bug. The actual root cause was a 3-way interface drift between:

1. **Local Rust source** (`programs/vesting/src/instructions/claim.rs`) -- current HEAD.
2. **Local IDL** (`apps/web/src/lib/anchor/idl.json`) -- generated at some prior build.
3. **Live devnet binary** (`G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`) -- older deployment.

The three interfaces disagreed on the `claim` instruction's account ordering:

| Position | Local Rust source | Local IDL | Live devnet |
|---|---|---|---|
| 6 | `beneficiary_ata` | `mint` | `beneficiary_token_account` |
| 7 | `mint` | `beneficiary_ata` | (only 9 accounts total) |

The live devnet also used older field names (`tree` instead of `vesting_tree`) and had only 9 accounts vs. 10 in the current source.

**Observed error:** `ProgramError caused by account: mint. Message: An account's data contents was invalid.` -- the local IDL was sending `mint` in position 6, but the live binary expected `beneficiary_ata` in that slot.

## Decision

Do not replace the global IDL with the fetched devnet IDL. The devnet IDL is from an older interface version; replacing it would fix `claim` but break every other instruction that follows the current source layout.

Instead, `ClaimWithProofButton` builds the `claim` instruction manually using `new TransactionInstruction({ programId, keys: [...], data })`, matching the local Rust source order (which is what a clean redeploy will use).

## Consequences

**Positive:**
- Claims work on the live devnet despite the drift.
- The compatibility path mirrors the local Rust source, so it will continue to work after a clean redeploy with no changes.

**Negative:**
- The manual builder bypasses Anchor's type-checked `program.methods.claim(...)` API. If the Rust source account order changes, the manual keys array must be updated manually -- no compile-time check.
- The instruction discriminator must be kept in sync manually.

## Alternatives Considered

- **Replace global IDL with devnet IDL:** Fixes `claim` but breaks every other instruction that already follows the current source layout. Rejected.
- **Deploy updated program to devnet:** Correct long-term fix but blocked by deployment schedule. The manual builder is a bridge until redeployment.
- **Maintain two IDLs:** One for the live devnet, one for local development. Increases complexity and drift risk. Rejected.

## Clean-Up Conditions

This workaround can be removed when all three are true:
1. `anchor idl fetch devnet G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` matches local Rust source account ordering.
2. `apps/web/src/lib/anchor/idl.json` is regenerated from the same source.
3. `program.methods.claimWithProof(...).accounts(...).rpc()` succeeds without the manual builder.
