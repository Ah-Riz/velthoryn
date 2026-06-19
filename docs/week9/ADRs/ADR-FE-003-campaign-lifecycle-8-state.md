# ADR-FE-003: 8-State CampaignLifecycle Enum

**Status:** Active
**Date:** 2026-06-15
**Owner:** Geral (Frontend)

## Context

Before Week 8, the frontend determined campaign display state using a single
`cancelledAt != null` check. This caused two user-visible bugs: (1)
instantly-refunded campaigns still showed a "Grace Period Active — Needs
Action" banner; (2) campaigns where all beneficiaries had claimed during
the grace period also showed the false banner. `cancelledAt` alone cannot
distinguish four distinct post-cancel states.

## Decision

Export a `CampaignLifecycle` type from `apps/web/src/lib/vesting/list.ts`
with 8 states:

```
active | paused | claimable | claimed |
cancelled_grace | cancelled_expired | instant_refunded | settled
```

Add `isGracePeriodVisible()` helper: returns `true` only when ALL three
conditions hold — `cancelledAt != null`, `instantRefunded === false`, AND
`streamSettled === false`. The beneficiary API at
`/api/beneficiary/[address]/vesting-progress` was updated to return
`instantRefunded` and `streamSettled` booleans (non-breaking addition).

## Consequences

**Positive**
- No false "Needs Action" banners for settled or instantly-refunded campaigns.
- Claim button remains visible and active when `claimable > 0` after creator
  cancel — correct grace-period behaviour.
- All 8 states have corresponding CSS badge variants in `CampaignStatusBadge.tsx`.

**Negative / trade-offs**
- API consumers must handle two new boolean fields (`streamSettled`,
  `instantRefunded`) — additive, non-breaking change.

## References

- Commits: `eb71065`, `b27e0fd`
- `apps/web/src/lib/vesting/list.ts` — `CampaignLifecycle` type + `isGracePeriodVisible()`
- `apps/web/src/components/campaign/CampaignStatusBadge.tsx`
