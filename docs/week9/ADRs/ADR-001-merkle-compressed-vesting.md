# ADR-001: Merkle-compressed vesting (one tree per campaign, not one PDA per recipient)

**Status:** Accepted
**Date:** 2026-06-14
**Owner:** Lana (SC)

## Context

A vesting campaign pays out N beneficiaries over time. The naive design stores each
beneficiary's entitlement in its own account — one PDA per recipient (plus the campaign
itself). For a realistic airdrop/vesting campaign of thousands to millions of recipients
this breaks down on three axes:

- **Account count & rent.** N recipient PDAs × rent-exempt minimum (~0.002 SOL each) is
  capital the creator must lock forever. At 100k recipients that is ~200 SOL of rent
  alone, before any token is vested.
- **Creation transaction size.** Initializing N accounts in one transaction exceeds
  Solana's 1232-byte limit almost immediately; creators would need a multi-tx batching
  flow just to stand a campaign up.
- **Mutability.** Adjusting a recipient's allocation, or rotating the recipient set after
  launch, requires touching N accounts.

We needed a structure that (a) costs O(1) accounts to create regardless of N, (b) lets a
beneficiary prove their entitlement in a single transaction, and (c) supports root
rotation to amend the recipient set.

## Decision

Store the entire recipient set as a **binary Merkle tree**; commit only its **32-byte
root** on-chain in a single `VestingTree` PDA per campaign. A beneficiary claims by
submitting their leaf (a 70-byte `VestingLeaf`) plus a Merkle proof (≤ 20 sibling hashes
for a tree up to 2²⁰ leaves) and a leaf index. The program re-derives the root with
`verify_merkle_proof` and compares it to the stored root.

Account model:
- `VestingTree` PDA — 1 per campaign (seeded `[b"tree", creator, mint, campaign_id]`).
- `ClaimRecord` PDA — created lazily on a beneficiary's **first** claim (seeded
  `[b"claim", vesting_tree, beneficiary]`), tracks cumulative `claimed_amount` +
  milestone bitmap.

So a freshly-created campaign holding 1,000,000 beneficiaries costs **2 accounts** to
stand up (tree + creator). Per-beneficiary state appears only when someone actually
claims.

## Consequences

**Positive**
- O(1) campaign creation cost regardless of beneficiary count; scales to millions.
- Claim is fully self-service: a beneficiary needs only their leaf + proof (served by the
  BE proof endpoint or computed offline) and their wallet signature.
- Root rotation (`update_root`) replaces the entire recipient set atomically in one tx.
- Fits comfortably in a 1232-byte tx: a max-depth (2²⁰) proof is 20 × 32 = 640 bytes.

**Negative / trade-offs**
- `ClaimRecord` is created lazily, so a beneficiary who never claims leaves no on-chain
  trace (intended, but means "total claimed" is only knowable from claim events).
- Root rotation is all-or-nothing — there is no incremental "add one recipient" op; the
  whole tree is replaced.
- The same `ClaimRecord` is reused across a beneficiary's leaves, which makes per-leaf
  accounting subtle (see [ADR-003](ADR-003-issue-29-deferred-on-chain-fix.md) — Issue #29).
- The off-chain tree builder (`clients/ts`, `apps/web/src/lib/merkle`) and the on-chain
  verifier must stay byte-identical (see
  [ADR-002](ADR-002-keccak-256-domain-separation.md)).

## References
- `programs/vesting/src/math/merkle.rs` — `verify_merkle_proof`, `leaf_hash`.
- `programs/vesting/src/state/vesting_tree.rs`, `state/claim_record.rs`.
- `docs/SECURITY.md` §2 (Merkle design).
