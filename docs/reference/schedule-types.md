# Schedule Types

Velora supports three vesting schedule types, each identified by a `release_type` value stored in the `VestingLeaf`. All schedule math is implemented on-chain in `programs/vesting/src/math/schedule.rs` and can be previewed off-chain using the `get_vested_amount` view function.

---

## Schedule Comparison

| Aspect | Cliff (`release_type = 0`) | Linear (`release_type = 1`) | Milestone (`release_type = 2`) |
|--------|---------------------------|----------------------------|-------------------------------|
| **Unlock behavior** | All-or-nothing at `cliff_time` | Proportional between `cliff_time` and `end_time` | All-or-nothing when creator releases the flag |
| **Vested before cliff** | 0 | 0 | 0 (flag not set) |
| **Vested at cliff** | `amount` (100%) | 0 (linear begins) | N/A (uses `milestone_released_flags`) |
| **Vested after cliff** | `amount` (100%) | Proportional to elapsed time | `amount` when flag is set |
| **Controlling field** | `cliff_time` | `cliff_time`, `end_time` | `milestone_idx`, `milestone_released_flags` |
| **Multiple claims** | Single claim after cliff | Incremental claims over time | Single claim per milestone |
| **Cancel clamp** | Freezes at `cancelled_at` | Freezes curve at `cancelled_at` | No effect (flag-based) |

---

## Cliff Vesting

Cliff vesting releases the full token amount in a single unlock at `cliff_time`.

### Math

```
if now < cliff_time:
    vested = 0
else:
    vested = amount
```

### Behavior

- Before `cliff_time`, the beneficiary cannot claim anything.
- At or after `cliff_time`, the full `amount` becomes claimable in one transaction.
- If the campaign is cancelled, the vesting curve freezes at `cancelled_at`. If `cancelled_at < cliff_time`, the beneficiary receives nothing.

### Typical Use Cases

- Token unlock after a lockup period
- Lump-sum grant with a waiting period
- Simple time-locked distributions

---

## Linear Vesting

Linear vesting releases tokens proportionally between `cliff_time` and `end_time`. No tokens are available before the cliff.

### Math

```
if now < cliff_time:
    vested = 0
elif now >= end_time:
    vested = amount
else:
    elapsed = now - cliff_time
    duration = end_time - cliff_time
    vested = (amount * elapsed) / duration
```

{% hint style="info" %}
The on-chain implementation uses `u128` intermediate multiplication to guard against overflow when computing `amount * elapsed`.
{% endhint %}

### Behavior

- Before `cliff_time`, nothing is claimable.
- Between `cliff_time` and `end_time`, the claimable amount grows linearly.
- Beneficiaries can claim incrementally at any point -- each claim receives the delta between the current vested amount and what has already been claimed.
- If cancelled, `now` is clamped to `min(now, cancelled_at)`, freezing the vesting curve at the cancellation point.

### Typical Use Cases

- Employee token vesting (e.g., 1-year cliff then 3-year linear)
- Investor lockup with gradual unlock
- Advisor grants with continuous vesting

---

## Milestone Vesting

Milestone vesting releases the full token amount when the campaign creator explicitly sets a release flag. The unlock is not time-based -- it is gated by an on-chain boolean controlled by the creator.

### Math

```
if milestone_released_flags[milestone_idx] is set:
    vested = amount
else:
    vested = 0
```

### Behavior

- The creator calls `set_milestone_released(milestone_idx)` to flip the flag bit in `VestingTree.milestone_released_flags`.
- Once the flag is set, the beneficiary can claim the full `amount` for that milestone.
- The `milestone_bitmap` on `ClaimRecord` prevents double-claiming the same milestone index.
- Up to 256 distinct milestones are supported (32-byte bitmap).
- Cancel does not affect milestone vesting -- it is purely flag-based.

### Typical Use Cases

- Performance-based payouts (deliverable completion)
- Phased project funding (milestone-gated releases)
- Conditional grants tied to external events

---

## Campaign vs Stream Entry Points

Both `create_campaign` and `create_stream` produce identical `VestingTree` PDAs. The choice between them depends on scale and convenience.

### Feature Comparison

| Aspect | `create_campaign` | `create_stream` |
|--------|-------------------|-----------------|
| **Recipients** | 1 to thousands | Exactly 1 |
| **Merkle root** | Caller pre-computes off-chain | Program computes on-chain from single leaf |
| **Funding** | Separate `fund_campaign` transaction required | Atomic -- vault funded in the same transaction |
| **Claim path** | `claim` (requires Merkle proof) | `withdraw` (proof-less, leaf re-hashed on-chain) |
| **Transactions to set up** | 2 (create + fund) | 1 |
| **Off-chain infrastructure** | Merkle tree generation and proof serving | Not required |

### Shared Capabilities

Both paths support all three schedule types (cliff, linear, milestone), optional cancellability with 7-day grace period, optional pause authority, campaign isolation via `campaign_id`, and identical on-chain events.

### When to Use Which

| Scenario | Recommended Path |
|----------|-----------------|
| 1 recipient | `create_stream` |
| 2-10 recipients | Either works; `create_campaign` if you already have Merkle infrastructure |
| 11+ recipients | `create_campaign` + `fund_campaign` |

### Cost Comparison

| Factor | `create_campaign` | `create_stream` |
|--------|-------------------|-----------------|
| Setup rent | ~0.003 SOL (VestingTree PDA) | ~0.003 SOL (VestingTree PDA) |
| Funding transaction | Additional transaction fee | Included in creation transaction |
| Per-recipient claim | O(log n) Merkle proof bytes | No proof needed |
| Off-chain infrastructure | Merkle tree generation and proof serving | Not required |

---

## Single-Recipient Streams

A "stream" is a single-leaf campaign (`leaf_count == 1`). The `create_stream` instruction commits the vesting schedule into the Merkle root and funds the vault atomically.

### Field Mapping to Tutorial Concepts

Many vesting tutorials define a `Stream` PDA with on-chain fields. Velora implements the same behavior through the Merkle campaign model:

| Tutorial Concept | Velora Equivalent | Location |
|------------------|-------------------|----------|
| `creator` | `VestingTree.creator` | On-chain PDA |
| `recipient` | `VestingLeaf.beneficiary` | In Merkle leaf / `WithdrawArgs` |
| `mint` | `VestingTree.mint` | On-chain PDA |
| `amount` | `VestingTree.total_supply` | On-chain PDA |
| `start_time` | `VestingLeaf.start_time` | Leaf / `WithdrawArgs` |
| `end_time` | `VestingLeaf.end_time` | Leaf / `WithdrawArgs` |
| `withdrawn_amount` | `ClaimRecord.claimed_amount` | On-chain PDA |
| Escrow balance | Vault ATA | SPL token account |

### Why No Separate Stream PDA?

Velora uses Merkle compression to achieve a fixed ~0.005 SOL campaign cost regardless of recipient count. Traditional one-PDA-per-stream approaches (like Streamflow) cost approximately $0.37 per recipient. Bulk campaigns share one `VestingTree` and one Merkle root for unlimited recipients.

{% hint style="info" %}
Schedule fields are hashed into `merkle_root` at creation, not stored as separate columns on `VestingTree`. Recipients must pass the same schedule values in `withdraw` arguments.
{% endhint %}
