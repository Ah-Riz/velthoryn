# Compute Unit Budget — Velthoryn Vesting Program

> Last updated: 2026-06-11 | Program: `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`
> Measured with: Mollusk 0.13.1 + Solana CLI 3.1.12 (Agave)

## Summary

| Instruction | Native CU | Recommended Limit | Notes |
|-------------|-----------|-------------------|-------|
| `get_vested_amount` | 614–916 | 1,200 | Read-only, no accounts mutated |
| `create_campaign_native` | 9,378–12,372 | 15,000 | Scales with leaf_count |
| `create_stream_native` | 11,617–16,117 | 17,000 | Single-recipient stream (includes vault init CPI) |
| `fund_campaign_native` | 7,891 | 10,000 | SOL transfer to PDA |
| `cancel_campaign` | 5,672 | 8,000 | Sets cancelled_at, clears paused |
| `set_milestone_released` | 5,301 | 7,000 | Bit flip on milestone flags |
| `update_root` | 5,567 | 7,000 | Replaces merkle root + leaf count |
| `pause_campaign` | 5,380 | 7,000 | Toggle paused flag |
| `unpause_campaign` | 5,383 | 7,000 | Toggle paused flag |
| `close_claim_record` | 5,131 | 7,000 | Drains ClaimRecord rent |
| `claim` (native) | ~11,500* | 15,000 | *Estimated from bankrun; Mollusk blocked by init_if_needed |
| `withdraw` (SPL) | — | 20,000 | SPL path, raised from 15K to allow headroom for CPI variance |
| `cancel_stream` | ~12,000* | 15,000 | *Estimated; Mollusk blocked by init_if_needed |
| `instant_refund_campaign` | — | 12,000 | Mollusk blocked by Optional<T> |
| `withdraw_unvested` | — | 10,000 | Mollusk blocked by Optional<T> |
| `create_campaign` (SPL) | ~10,000* | 15,000 | *Estimated from native path + SPL overhead |
| `create_stream` (SPL) | ~12,000* | 16,000 | *Estimated from native path + SPL overhead |
| `fund_campaign` (SPL) | ~8,000* | 12,000 | *Estimated from native path + SPL overhead |

\* Denotes estimates, not direct measurements. SPL paths require `init_if_needed` or `Optional<T>` account resolution not supported by Mollusk 0.13.x. SPL CU will be measured when Mollusk 0.14+ is available.

## Detailed CU Measurements (Mollusk benchmarks)

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
| 10,000 leaves, non-cancellable | 9,372–12,372 (varies by run) |

### create_stream_native

| Scenario | CU |
|----------|-----|
| Linear, 1 leaf | 11,617–16,117 |

### bench_claim_native (ignored)

| Status | Reason |
|--------|--------|
| **Ignored** | Mollusk 0.13.x — `claim` uses `init_if_needed` for `ClaimRecord` PDA. `bench_claim_native` in `programs/vesting/tests/benchmarks.rs` is `#[ignore]`. Re-run when Mollusk 0.14+ supports `init_if_needed`. Estimated CU: ~11,500 (bankrun). |

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

### pause/unpause_campaign

| Scenario | CU |
|----------|-----|
| Pause (3 leaves) | 5,380 |
| Unpause (3 leaves) | 5,383 |

### close_claim_record

| Scenario | CU |
|----------|-----|
| Fully claimed | 5,131 |

## Client Integration

### Recommended Compute Budget Instructions

For all transactions, add compute budget instructions before the program instruction:

```typescript
import { ComputeBudgetProgram } from "@solana/web3.js";

// Example: create_campaign with 100 leaves
const tx = new Transaction()
  .add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 15_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100 }), // priority fee
  )
  .add(createCampaignInstruction);
```

### Priority Fee Recommendations

| Priority | MicroLamports/CU | Use Case |
|----------|-----------------|----------|
| Low | 0–100 | Non-urgent operations |
| Medium | 100–500 | Standard transactions |
| High | 500–2000 | Time-sensitive (claim during high activity) |

### Rent Costs

| Account | Space (bytes) | Rent (SOL) |
|---------|--------------|------------|
| VestingTree | 8 + 315 = 323 | ~0.00224 |
| ClaimRecord | 8 + 105 = 113 | ~0.00078 |

## Notes

- **CU variance**: `create_campaign_native` with 10,000 leaves varies between 9,372–12,372 CU across runs. Recommended limit includes 20% headroom.
- **SPL paths**: All SPL token handlers (claim/withdraw/cancel_stream with token accounts, create_campaign/create_stream/fund_campaign SPL) will have higher CU due to CPI to Token Program. Estimated +20-30% overhead.
- **Mollusk limitations**: 4 handlers (`claim` native, `cancel_stream`, `instant_refund`, `withdraw_unvested`) cannot be benchmarked by Mollusk due to `init_if_needed` and `Optional<T>` account resolution limitations. CU estimates are from bankrun integration tests or extrapolated from similar handlers.
