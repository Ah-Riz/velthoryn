# `create_campaign` vs `create_stream` — Comparison Report

> Prepared for Business Development review

## Overview

Mancer's vesting program offers two instruction paths for setting up token distributions. Both produce the same on-chain `VestingTree` account, but serve different scales and use cases.

## Feature Comparison

| Aspect | `create_campaign` | `create_stream` |
|--------|-------------------|-----------------|
| **Recipients** | N (1 to thousands) | Exactly 1 |
| **Merkle root** | Caller pre-computes off-chain, passes as argument | Program computes on-chain from single leaf |
| **Funding** | Separate `fund_campaign` transaction required | Atomic — vault funded in same transaction |
| **Claim path** | `claim` (requires Merkle proof from off-chain data) | `withdraw` (proof-less, leaf re-hashed on-chain) |
| **Arguments** | 7 fields (root, leaf_count, total_supply, ...) | 11 fields (beneficiary, amount, schedule params, ...) |
| **Transactions to fully set up** | 2 (create + fund) | 1 |
| **Primary use case** | Airdrops, team token tables, investor batches | Employee grants, single investor vesting, advisor agreements |

## Shared Capabilities

Both paths create identical `VestingTree` PDAs and support:

- **Vesting schedules**: Cliff, Linear, and Milestone release types
- **Cancellability**: Optional cancel authority with 7-day grace period
- **Pausability**: Optional pause authority to block/resume claims
- **Campaign isolation**: Multiple concurrent campaigns per (creator, mint) pair via `campaign_id`
- **Events**: Both emit `CampaignCreated` on-chain events

## Cost Comparison

| Cost Factor | `create_campaign` | `create_stream` |
|-------------|-------------------|-----------------|
| Setup rent | ~0.003 SOL (VestingTree PDA) | ~0.003 SOL (VestingTree PDA) |
| Funding tx | Additional tx fee | Included in creation tx |
| Per-recipient claim | O(log n) Merkle proof bytes | No proof needed |
| Off-chain infrastructure | Merkle tree generation & proof serving | Not required |

## When to Use Which

### `create_stream` — Single Recipient

- Employee stock option vesting
- Individual advisor token grants
- Single investor lockup agreements
- Any 1:1 token distribution

**Advantages**: One transaction, no off-chain Merkle infrastructure, proof-less claiming.

### `create_campaign` — Batch Distribution

- Team-wide token allocations (dozens to hundreds)
- Community airdrops (thousands of recipients)
- Multi-investor vesting tranches
- Any 1:N token distribution

**Advantages**: Scales efficiently via Merkle compression — one 32-byte root represents unlimited recipients. Per-recipient on-chain cost is near-zero.

## Architecture Detail

Both instructions derive the `VestingTree` PDA from the same seeds:

```
["tree", creator_pubkey, mint_pubkey, campaign_id.to_le_bytes()]
```

This means the choice between `create_campaign` and `create_stream` is purely a matter of convenience and scale — the resulting on-chain state is structurally identical regardless of which path is taken.

## Recommendation

| Scenario | Recommended Path |
|----------|-----------------|
| 1 recipient | `create_stream` |
| 2–10 recipients | Either works; `create_campaign` if you already have Merkle infra |
| 11+ recipients | `create_campaign` + `fund_campaign` |

For client integrations, supporting both paths allows the frontend to automatically select the optimal instruction based on recipient count.
