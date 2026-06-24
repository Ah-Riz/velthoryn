# Velthoryn — Token Distribution Protocol

<img src="https://www.velthoryn.site/brand/velthoryn-logo-sm.svg" alt="Velthoryn logo" width="140" />

Solana token-distribution protocol combining **Merkle-tree compression** with full vesting schedules, **per-recipient clawback**, and native SOL support.

|                    |                                                              |
| ------------------ | ------------------------------------------------------------ |
| **Program ID**     | `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`             |
| **Network**        | Devnet                                                       |
| **Framework**      | Anchor 1.0.0                                                |
| **Live App**       | [velthoryn.site](https://velthoryn.site/)                    |
| **Source**         | [GitHub](https://github.com/Ah-Riz/mancerxsuperteam-token-vesting) |

## Schedule Types

| Type              | Behavior                                                                 |
| ----------------- | ------------------------------------------------------------------------ |
| **Linear**        | Tokens unlock continuously from `start_time` to `end_time`              |
| **Cliff**         | All tokens unlock at once at `cliff_time`                                |
| **Cliff + Linear**| Cliff portion unlocks at `cliff_time`, remainder vests linearly          |
| **Milestone**     | Tokens unlock when the creator releases each milestone flag              |

## What It Does

**Merkle Compression** — Store thousands of recipients in a single on-chain Merkle root. Recipients prove their allocation with a Merkle proof at claim time. No per-recipient account needed — cost drops from ~$0.37 to ~$0.005 per recipient.

**Multi-Schedule Vesting** — Support linear, cliff, cliff+linear, and milestone schedules in a single protocol. Campaign-level scheduling ensures all recipients follow the same unlock cadence.

**Per-Recipient Clawback** — Rotate the Merkle root via `update_root` to add, remove, or adjust individual recipients without affecting others. Campaign-wide `cancel_campaign` initiates a 7-day grace period for beneficiaries to claim before funds return to the creator.

**Native SOL Support** — Vest raw SOL without wrapping to wSOL. The campaign PDA holds lamports directly. All 18 instructions support both SPL and native SOL paths.

## Where to Start

| You want to…                         | Start here                                           |
| ------------------------------------ | ---------------------------------------------------- |
| Integrate the on-chain program       | [Program Integration Guide](guides/integration.md)   |
| Build a frontend                     | [Frontend Integration Guide](guides/frontend-integration.md) |
| Understand the architecture          | [Accounts & State](reference/accounts-and-state.md)  |
| Look up an instruction               | [Instruction Reference](reference/instructions.md)   |
| Deploy to mainnet                    | [Mainnet Checklist](operations/mainnet-checklist.md)  |
| Review security                      | [Threat Model](security/threat-model.md)             |

## At a Glance

| Metric                    | Value                                        |
| ------------------------- | -------------------------------------------- |
| Instruction handlers      | 18 (14 SPL + 3 native SOL + instant refund)  |
| Error code variants       | 41                                           |
| Event types               | 12                                           |
| SC tests passing          | 127+                                         |
| Web Vitest passing        | 572                                          |
| FE components             | 68                                           |
| FE hooks                  | 21                                           |
| API routes                | 25+                                          |

## Instruction Set

| Instruction               | Description                                                        |
| ------------------------- | ------------------------------------------------------------------ |
| `create_campaign`         | Initialize a vesting tree (Merkle root, supply, authorities)       |
| `create_stream`           | Atomic single-recipient campaign + SPL funding in one tx           |
| `fund_campaign`           | Deposit SPL tokens into the campaign vault                         |
| `claim`                   | Claim vested portion against a Merkle proof                        |
| `withdraw`                | Simplified claim for single-recipient streams                      |
| `cancel_campaign`         | Freeze curve, start 7-day grace period                             |
| `update_root`             | Rotate Merkle root (add/remove/adjust recipients)                  |
| `withdraw_unvested`       | Sweep unvested tokens after grace window                           |
| `pause_campaign`          | Temporarily block claims                                           |
| `unpause_campaign`        | Resume a paused campaign                                           |
| `set_milestone_released`  | Set milestone flag before unlock                                   |
| `cancel_stream`           | Single-leaf cancel: vested to beneficiary, rest to creator         |
| `instant_refund_campaign` | Instant refund for unstarted multi-leaf campaigns                  |
| `close_claim_record`      | Reclaim rent on fully-claimed ClaimRecord PDA                      |
| `get_vested_amount`       | Read-only schedule math helper                                     |

Native SOL variants: `create_campaign_native`, `create_stream_native`, `fund_campaign_native`

## Architecture

```
velthoryn/
├── programs/vesting/   # Anchor program (Rust)
├── clients/ts/         # TypeScript client (leaf encoding, Merkle tree)
├── apps/web/           # Next.js dApp + API routes + Merkle pipeline
├── tests/              # ts-mocha integration tests
└── .github/workflows/  # CI: build + test + lint
```

| Area             | Stack                                         |
| ---------------- | --------------------------------------------- |
| Smart Contract   | Rust, Anchor 1.0.0                           |
| Backend API      | Next.js API routes, Drizzle ORM, Supabase     |
| Frontend UI      | Next.js 15, shadcn/ui, TanStack Query         |
| Merkle Pipeline  | TypeScript, keccak-256, domain separation      |

{% hint style="info" %}
**Status:** Features F1–F4 complete and deployed on devnet. One known smart-contract issue is pending a program redeploy — native-SOL campaigns drain residual lamports on the final claim. See the [Mainnet Checklist](operations/mainnet-checklist.md) for production readiness gates.
{% endhint %}
