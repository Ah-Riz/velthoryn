# ADR-002: Keccak-256 with Domain Separation

**Status:** Accepted

## Context

A Merkle vesting tree is built off-chain (TypeScript) and verified on-chain (Solana program). Three requirements constrain the hash choice:

1. **Byte-identical off-chain and on-chain.** A leaf hash computed in TS must equal the one the program computes, or every proof fails. The hash function and the exact preimage bytes must match.
2. **Second-preimage resistance.** In a naive Merkle tree, a leaf and an internal node are both 32 bytes. Without domain separation, an attacker who knows an internal node hash could submit it as a "leaf" with an empty proof and forge membership.
3. **Tx-size friendliness.** The hash must be one both runtimes expose natively to avoid a slow pure-language implementation on-chain.

## Decision

Use Keccak-256 with single-byte domain-separation prefixes, identical across all three implementations (on-chain Rust and two TS builders):

- **Leaf hash:** `keccak256(0x00 || borsh(VestingLeaf))`
- **Node hash:** `keccak256(0x01 || left || right)`

Implementations:
- On-chain: `solana_keccak_hasher::hashv` (hardware-accelerated keccak-256).
- `clients/ts` (reference client): `js-sha3` keccak_256.
- `apps/web/src/lib/merkle/builder.ts` (BE port): the `keccak256` package.

The `0x00` prefix for leaves and `0x01` for nodes means a node hash can never be confused with a leaf hash (their preimages start with different bytes), so an empty-proof "node-as-leaf" forgery cannot verify.

The leaf preimage is the Borsh serialization of `VestingLeaf` (70 bytes, fixed field order: `leaf_index u32`, `beneficiary [u8;32]`, `amount u64`, `release_type u8`, `start_time i64`, `cliff_time i64`, `end_time i64`, `milestone_idx u8`), which the TS side reproduces as a hand-laid little-endian buffer.

## Consequences

**Positive:**
- Second-preimage / node-as-leaf forgery is impossible (proven by Mollusk test).
- Rust/TS parity is proven byte-for-byte: the golden leaf hash `cf2129259e55d196c624b52834eeca822036914cabe10ce39ebbfbe67270627b` matches across implementations. 13/13 cross-verifications pass, plus 7 fast-check property tests and 8 Rust proptests.
- Keccak-256 is the EVM-standard Merkle hash (OpenZeppelin, Uniswap) -- familiar to integrators.

**Negative:**
- The 70-byte Borsh layout, the `0x00`/`0x01` prefixes, and the node-hash ordering must be kept in lockstep across three codebases. Any drift silently breaks every claim. Mitigated by the parity test and property tests in CI.
- Borsh serialization pins the leaf layout to Borsh's exact rules (LE integers, fixed arrays inline).

## Alternatives Considered

- **SHA-256:** Native on Solana but not the ecosystem standard for Merkle trees. Would require a different hasher on the TS side.
- **No domain separation:** Simpler but vulnerable to second-preimage attacks where an internal node is submitted as a leaf.
- **Poseidon hash:** ZK-friendly but not natively available on Solana runtime; would require a custom precompile or slow in-program computation.
