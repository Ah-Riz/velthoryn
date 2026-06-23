# Compute Budget

This reference lists the measured and estimated compute unit (CU) consumption for every instruction in the Velora vesting program. Use these values to set `ComputeBudgetProgram.setComputeUnitLimit()` in your transactions.

**Program ID:** `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`

**Measurement tool:** Mollusk 0.13.1 + Solana CLI 3.1.12 (Agave)

---

## Per-Instruction CU Table

| Instruction | Measured CU | Recommended Limit | Notes |
|-------------|-------------|-------------------|-------|
| `get_vested_amount` | 614 - 916 | 1,200 | Read-only, no accounts mutated |
| `create_campaign_native` | 9,378 - 12,372 | 15,000 | Scales with `leaf_count` |
| `create_campaign` (SPL) | ~10,000 * | 15,000 | Estimated from native path + SPL overhead |
| `create_stream_native` | 11,617 - 16,117 | 17,000 | Single-recipient, includes vault init CPI |
| `create_stream` (SPL) | ~12,000 * | 16,000 | Estimated from native path + SPL overhead |
| `fund_campaign_native` | 7,891 | 10,000 | SOL transfer to PDA |
| `fund_campaign` (SPL) | ~8,000 * | 12,000 | Estimated from native path + SPL overhead |
| `claim` (native) | ~13,200 | 15,000 | Per-leaf ledger adds ~1,700 CU over pre-fix baseline |
| `withdraw` (SPL) | -- | 20,000 | Raised from 15K for CPI variance headroom |
| `cancel_campaign` | 5,672 | 8,000 | Sets `cancelled_at`, clears `paused` |
| `cancel_stream` | ~12,000 * | 15,000 | Estimated; Mollusk blocked by `init_if_needed` |
| `set_milestone_released` | 5,301 | 7,000 | Single bit flip on milestone flags |
| `update_root` | 5,567 | 7,000 | Replaces Merkle root + leaf count |
| `pause_campaign` | 5,380 | 7,000 | Toggle `paused` flag |
| `unpause_campaign` | 5,383 | 7,000 | Toggle `paused` flag |
| `close_claim_record` | 5,131 | 7,000 | Drains `ClaimRecord` rent to beneficiary |
| `instant_refund_campaign` | -- | 12,000 | Mollusk blocked by `Optional<T>` |
| `withdraw_unvested` | -- | 10,000 | Mollusk blocked by `Optional<T>` |

{% hint style="info" %}
Entries marked with `*` are estimates, not direct measurements. SPL paths require `init_if_needed` or `Optional<T>` account resolution not yet supported by Mollusk 0.13.x. SPL CU measurements will be added when Mollusk 0.14+ is available.
{% endhint %}

---

## Detailed Measurements

### get_vested_amount

| Scenario | CU |
|----------|-----|
| Cliff, before cliff | 615 |
| Cliff, after cliff | 615 |
| Linear, mid-vesting | 909 |
| Linear, fully vested | 614 |
| Milestone, flag not set | 624 |
| Milestone, flag set | 655 |
| Linear, cancelled clamp | 916 |

### create_campaign_native

| Scenario | CU |
|----------|-----|
| 100 leaves, cancellable | 9,378 |
| 10,000 leaves, non-cancellable | 9,372 - 12,372 |

### create_stream_native

| Scenario | CU |
|----------|-----|
| Linear, 1 leaf | 11,617 - 16,117 |

### fund_campaign_native

| Scenario | CU |
|----------|-----|
| 500M lamports top-up | 7,891 |

### cancel_campaign

| Scenario | CU |
|----------|-----|
| Partially claimed (30%) | 5,672 |

### set_milestone_released

| Scenario | CU |
|----------|-----|
| Milestone index 0 | 5,301 |

### update_root

| Scenario | CU |
|----------|-----|
| New root + 5 leaves | 5,567 |

### pause / unpause_campaign

| Scenario | CU |
|----------|-----|
| Pause (3 leaves) | 5,380 |
| Unpause (3 leaves) | 5,383 |

### close_claim_record

| Scenario | CU |
|----------|-----|
| Fully claimed | 5,131 |

---

## Client Integration

### Setting Compute Budget

For all transactions, prepend compute budget instructions before the program instruction:

```typescript
import { ComputeBudgetProgram, Transaction } from "@solana/web3.js";

const tx = new Transaction()
  .add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 15_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100 }),
  )
  .add(yourProgramInstruction);
```

### Priority Fee Recommendations

| Priority | Micro-lamports / CU | Use Case |
|----------|---------------------|----------|
| Low | 0 - 100 | Non-urgent operations (fund, pause, close) |
| Medium | 100 - 500 | Standard transactions (create, claim) |
| High | 500 - 2,000 | Time-sensitive operations (claim during congestion) |

---

## Rent Costs

| Account | Space (bytes) | Approximate Rent (SOL) | Notes |
|---------|---------------|------------------------|-------|
| `VestingTree` | 8 + 315 = 323 | ~0.00224 | Anchor discriminator + campaign data |
| `ClaimRecord` | 8 + 224 = 232 | ~0.00161 | `zero_copy` layout with per-leaf ledger. Legacy 121-byte accounts resized lazily. |

---

## General Recommendations

- **Always set a CU limit.** Without an explicit limit, the runtime defaults to 200,000 CU per instruction -- you will overpay on priority fees.
- **Add 20% headroom** over measured values to account for runtime variance.
- **SPL paths cost more** than native SOL paths due to CPI overhead to the Token Program. Budget an extra 20-30% for SPL token instructions.
- **`claim` with per-leaf ledger** (Issue #29 fix) costs approximately 1,700 CU more than the pre-fix version due to the per-leaf tracking logic.
