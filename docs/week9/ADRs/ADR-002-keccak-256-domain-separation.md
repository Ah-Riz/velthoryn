# ADR-002: Keccak-256 with domain separation for Merkle hashing

**Status:** Accepted
**Date:** 2026-06-14
**Owner:** Lana (SC / MERKLE)

## Context

A Merkle vesting tree is built off-chain (TypeScript, by the creator's dApp / the BE) and
verified on-chain (Solana program). Three requirements constrain the hash choice:

1. **Byte-identical off-chain ↔ on-chain.** A leaf hash computed in TS must equal the one
   the program computes, or every proof fails. The hash function and the exact preimage
   bytes must match.
2. **Second-preimage resistance.** In a naive Merkle tree a leaf and an internal node are
   both 32 bytes. Without domain separation, an attacker who knows an internal node hash
   could submit it as a "leaf" with an empty proof and forge membership (the classic
   second-preimage / leaf-vs-node confusion).
3. **Tx-size friendliness.** Hash output is 32 bytes regardless; the constraint is really
   about proof depth (addressed by ADR-001), but the hash must be one both runtimes expose
   natively to avoid a slow pure-language implementation on-chain.

## Decision

Use **keccak-256** with **single-byte domain-separation prefixes**, identical across all
three implementations (on-chain Rust + two TS builders):

- **Leaf hash:** `keccak256(0x00 || borsh(VestingLeaf))`
- **Node hash:** `keccak256(0x01 || left || right)`

Implementations:
- On-chain: `solana_keccak_hasher::hashv` (hardware-accelerated keccak-256).
- `clients/ts` (reference client): `js-sha3`'s `keccak_256`.
- `apps/web/src/lib/merkle/builder.ts` (BE port): the `keccak256` package.

`0x00` for leaves, `0x01` for nodes means a node hash can **never** be confused with a
leaf hash (their preimages start with different bytes), so an empty-proof "node-as-leaf"
forgery cannot verify.

The leaf preimage is the Borsh serialization of `VestingLeaf` (70 bytes, fixed field
order: `leaf_index u32 · beneficiary [u8;32] · amount u64 · release_type u8 · start_time
i64 · cliff_time i64 · end_time i64 · milestone_idx u8`), which the TS side reproduces as a
hand-laid little-endian buffer.

## Consequences

**Positive**
- Second-preimage / node-as-leaf forgery is impossible (proven by the
  `audit_claim2_second_preimage_node_as_leaf_fails` Mollusk test).
- Rust↔TS parity is **proven byte-for-byte**: the golden leaf hash
  `cf2129259e55d196c624b52834eeca822036914cabe10ce39ebbfbe67270627b` matches across Rust
  `leaf_hash` and TS `leafHash`; the parity script passes 13/13 cross-verifications; and
  7 fast-check property tests + 8 Rust proptests guard the invariant going forward.
- keccak-256 is the EVM-standard Merkle hash (OpenZeppelin, Uniswap) — familiar to
  integrators and tooling.

**Negative / trade-offs**
- The 70-byte Borsh layout, the `0x00`/`0x01` prefixes, and the node-hash ordering
  (`0x01 || left || right`, left/right selected by `index & 1`) must be kept in lockstep
  across three codebases. Any drift silently breaks every claim. Mitigated by the parity
  test + property tests (run in CI).
- Borsh (not bincode/SCALE) is the serialization — fine because Anchor/Borsh is the Solana
  default, but it pins the leaf layout to Borsh's exact rules (LE integers, fixed arrays
  inline).

## References
- `programs/vesting/src/math/merkle.rs:8-14, 25-41` — prefixes + `verify_merkle_proof`.
- `clients/ts/src/leaf.ts:9-10, 51-83` — `encodeLeaf`, `leafHash`, `nodeHash`.
- `apps/web/src/lib/merkle/builder.ts:6-7, 29-52` — BE port.
- `scripts/test-merkle-parity.ts` — 13/13 parity harness.
- `clients/ts/src/__tests__/merkle-properties.test.ts` — 7 fast-check invariants.
