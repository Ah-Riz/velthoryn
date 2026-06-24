# ADR-FE-003: 8-State CampaignLifecycle Enum

**Status:** Accepted

## Context

Before Week 8, the frontend determined campaign display state using a single `cancelledAt != null` check. This caused two user-visible bugs:

1. Instantly-refunded campaigns still showed a "Grace Period Active -- Needs Action" banner.
2. Campaigns where all beneficiaries had claimed during the grace period also showed the false banner.

`cancelledAt` alone cannot distinguish four distinct post-cancel states.

## Decision

Export a `CampaignLifecycle` type from `apps/web/src/lib/vesting/list.ts` with 8 states:

```
active | paused | claimable | claimed |
cancelled_grace | cancelled_expired | instant_refunded | settled
```

Add `isGracePeriodVisible()` helper: returns `true` only when all three conditions hold -- `cancelledAt != null`, `instantRefunded === false`, and `streamSettled === false`. The beneficiary API at `/api/beneficiary/[address]/vesting-progress` was updated to return `instantRefunded` and `streamSettled` booleans (non-breaking addition).

## Consequences

**Positive:**
- No false "Needs Action" banners for settled or instantly-refunded campaigns.
- Claim button remains visible and active when `claimable > 0` after creator cancel -- correct grace-period behaviour.
- All 8 states have corresponding CSS badge variants in `CampaignStatusBadge.tsx`.

**Negative:**
- API consumers must handle two new boolean fields (`streamSettled`, `instantRefunded`) -- additive, non-breaking change.

## Alternatives Considered

- **Keep single boolean check:** Simpler but produces incorrect UI states for 4 out of 8 lifecycle states. The false "Needs Action" banner was a user-reported bug.
- **Derive state entirely client-side from raw fields:** Possible but duplicates logic across multiple components. Centralizing in a single enum + helper is more maintainable.
- **Server-computed lifecycle state:** Would add a `lifecycle` field to the API response. Viable but requires backend changes; the client-side computation was faster to ship and keeps the API schema stable.
