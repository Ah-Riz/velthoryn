# ADR-001: Merkle-Compressed Vesting

**Status:** Accepted

## Context

A vesting campaign pays out N beneficiaries over time. The naive design stores each beneficiary's entitlement in its own account -- one PDA per recipient plus the campaign itself. For realistic airdrop/vesting campaigns of thousands to millions of recipients, this breaks down on three axes:

- **Account count and rent.** N recipient PDAs at ~0.002 SOL each means ~200 SOL of rent alone at 100k recipients, before any token is vested.
- **Creation transaction size.** Initializing N accounts in one transaction exceeds Solana's 1232-byte limit almost immediately, requiring a multi-tx batching flow.
- **Mutability.** Adjusting a recipient's allocation or rotating the recipient set after launch requires touching N accounts.

The protocol needed a structure that (a) costs O(1) accounts to create regardless of N, (b) lets a beneficiary prove their entitlement in a single transaction, and (c) supports root rotation to amend the recipient set.

## Decision

Store the entire recipient set as a binary Merkle tree. Commit only its 32-byte root on-chain in a single `VestingTree` PDA per campaign. A beneficiary claims by submitting their leaf (a 70-byte `VestingLeaf`) plus a Merkle proof (up to 20 sibling hashes for a tree up to 2^20 leaves) and a leaf index. The program re-derives the root with `verify_merkle_proof` and compares it to the stored root.

**Account model:**
- `VestingTree` PDA -- 1 per campaign (seeded `[b"tree", creator, mint, campaign_id]`).
- `ClaimRecord` PDA -- created lazily on a beneficiary's first claim (seeded `[b"claim", vesting_tree, beneficiary]`), tracks cumulative `claimed_amount` and milestone bitmap.

A freshly-created campaign holding 1,000,000 beneficiaries costs 2 accounts to stand up (tree + creator). Per-beneficiary state appears only when someone actually claims.

## Consequences

**Positive:**
- O(1) campaign creation cost regardless of beneficiary count; scales to millions.
- Claim is fully self-service: a beneficiary needs only their leaf + proof and their wallet signature.
- Root rotation (`update_root`) replaces the entire recipient set atomically in one tx.
- Fits comfortably in a 1232-byte tx: a max-depth (2^20) proof is 20 x 32 = 640 bytes.

**Negative:**
- `ClaimRecord` is created lazily, so a beneficiary who never claims leaves no on-chain trace.
- Root rotation is all-or-nothing -- there is no incremental "add one recipient" operation.
- The same `ClaimRecord` is reused across a beneficiary's leaves, which makes per-leaf accounting subtle (see [ADR-003](./adr-003-issue-29-per-leaf-ledger.md)).
- The off-chain tree builder and the on-chain verifier must stay byte-identical (see [ADR-002](./adr-002-keccak-256-domain-separation.md)).

## Alternatives Considered

- **One PDA per recipient:** Simple but prohibitively expensive at scale. O(N) rent, O(N) creation transactions, O(N) mutations for recipient set changes.
- **On-chain compressed Merkle tree (state compression):** Solana's account compression could reduce rent, but it introduces complexity and does not support the specific claim/accounting model needed for vesting schedules.
