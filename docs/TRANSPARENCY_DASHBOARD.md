# Transparency Dashboard -- Feature Documentation

> **Feature**: Transparency / Real-Time Dashboard
> **Priority**: Feature 2 of Velthoryn (4/8 users requested)
> **Status**: FULLY IMPLEMENTED (backend + frontend complete)
> **Branch prefix**: `feat/transparency-dashboard`

---

## 1. Overview

The Transparency Dashboard transforms the current bare-bones dashboard into a real-time vesting portfolio overview. It surfaces data that already exists in the backend (event indexer, vesting-progress API, timeline API) but has zero frontend consumers today.

**Goal**: When a user connects their wallet and visits `/dashboard`, they should see:
- Aggregate portfolio health (TVL, claimable, vesting progress)
- Per-campaign progress bars and alerts
- A recent activity feed across all their campaigns
- Grace period warnings for cancelled campaigns

A secondary `/portfolio` page provides the full per-campaign breakdown.

---

## 2. What Exists Today

### Backend (complete, no changes needed)

| Endpoint | Path | Status | Consumers |
|----------|------|--------|-----------|
| Vesting Progress | `GET /api/beneficiary/{address}/vesting-progress` | Built | **None** |
| Campaign Timeline | `GET /api/campaigns/{treeAddress}/timeline` | Built | CampaignTimeline component on campaign detail page only |
| Beneficiary Campaigns | `GET /api/beneficiary/{address}/campaigns` | Built | `useBeneficiaryCampaigns` hook |
| Campaign List (sender) | `GET /api/campaigns?creator={addr}` | Built | `useCampaignList` hook |
| Cron Sync | `POST /api/cron/sync` | Built | **Bug: runs daily instead of every 5 min** |

### Frontend (complete)

| File | Purpose | Status |
|------|---------|--------|
| `apps/web/src/app/(app)/dashboard/page.tsx` | 6 stat cards, claimable banner, needs attention alerts, vesting progress cards (top 5), recent activity feed, quick actions | **Done** |
| `apps/web/src/app/(app)/portfolio/page.tsx` | Summary stats + `CampaignCard` list, sort (claimable/progress/next unlock) | **Done** (refactored — inline card removed) |
| `apps/web/src/components/campaign/CampaignCard.tsx` | Shared per-campaign card; `toCampaignCardData()` adapter from `VestingProgressCampaign` | **Done** |
| `apps/web/src/components/ui/StatCard.tsx` | Shared metric card (dashboard, portfolio, campaign detail) | **Done** |
| `apps/web/src/components/ui/ProgressBar.tsx` | Shared vesting progress bar | **Done** |
| `apps/web/src/components/dashboard/ActivityFeed.tsx` | Cross-campaign event feed with 8 event types, Solana explorer links | **Done** |
| `apps/web/src/lib/vesting/timeline-helpers.ts` | 114 lines — shared `EVENT_CONFIG`, `eventDescription`, `formatBlockTime`, `formatAmount` | **Done** (extracted from CampaignTimeline) |
| `apps/web/src/hooks/useVestingProgress.ts` | `useVestingProgress` + `useVestingProgressSummary` — fetch + aggregate BigInt totals | **Done** |
| `apps/web/src/hooks/useRecentActivity.ts` | Cross-campaign activity feed hook, fetches from `/api/activity/{address}` | **Done** |
| `apps/web/src/hooks/useCampaignTimeline.ts` | TanStack Query hook for per-campaign timeline | Unchanged |
| `apps/web/src/components/campaign/detail/CampaignTimeline.tsx` | Per-campaign timeline, now imports from `timeline-helpers.ts` | **Done** (refactored) |
| `apps/web/src/components/campaign/detail/VestingChart.tsx` | SVG vesting curve chart (542 lines) | Unchanged |
| `apps/web/src/components/shell/Sidebar.tsx` | 4 nav items: Dashboard, Portfolio, Create Stream, My Campaigns (+ amber dot badge) | **Done** |
| `apps/web/src/lib/vesting/display.ts` | `getVestingTypeLabel`, `getGracePeriodState`, `formatCountdown`, `GRACE_PERIOD_SECS` | Unchanged |
| `apps/web/src/lib/vesting/schedule.ts` | `getVestedAmount`, `VestingSchedule`, `ReleaseType` | Unchanged |
| `apps/web/src/hooks/useMintDecimals.ts` | On-chain mint decimals for real token amounts (dashboard + portfolio) | **Done** (bonus) |

---

## 3. Implementation Plan

### 3.1 Cron Fix (1 line change)

**File**: `apps/web/vercel.json`

Change the cron schedule from daily to every 5 minutes:

```json
{
  "crons": [
    {
      "path": "/api/cron/sync",
-     "schedule": "0 0 * * *"
+     "schedule": "*/5 * * * *"
    }
  ]
}
```

This ensures the event indexer keeps data fresh enough for a real-time dashboard experience.

> **Note (June 2026):** The 5-min schedule was applied in commit `ab7b0cf` but **reverted to daily** (`0 0 * * *`) in commit `420e4d0` because the Vercel Hobby plan only supports daily crons. To restore `*/5 * * * *` for near-real-time sync, upgrade to a paid Vercel plan.

---

### 3.2 Shared Timeline Helpers (extract + new)

**File**: `apps/web/src/lib/vesting/timeline-helpers.ts` (new)

Extract from `CampaignTimeline.tsx` lines 5-55:

```typescript
// Existing types from useCampaignTimeline.ts
import type { TimelineEvent } from "@/hooks/useCampaignTimeline";

export const EVENT_CONFIG: Record<
  TimelineEvent["type"],
  { icon: string; color: string; label: string }
> = {
  claimed:            { icon: "↓", color: "text-green-400",  label: "Claimed" },
  cancelled:          { icon: "✕", color: "text-red-400",    label: "Campaign Cancelled" },
  paused:             { icon: "⏸", color: "text-yellow-400", label: "Paused" },
  root_updated:       { icon: "↻", color: "text-blue-400",   label: "Root Updated" },
  withdrawn:          { icon: "↑", color: "text-amber-400",  label: "Unvested Withdrawn" },
  milestone_released: { icon: "◆", color: "text-purple-400", label: "Milestone Released" },
  stream_cancelled:   { icon: "⚡", color: "text-orange-400", label: "Stream Settled" },
  instant_refunded:   { icon: "↩", color: "text-rose-400",   label: "Instant Refund" },
};

export function formatBlockTime(blockTime: string): string {
  const ts = Number(blockTime);
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

export function truncateSig(sig: string): string {
  if (sig.length <= 16) return sig;
  return `${sig.slice(0, 8)}...${sig.slice(-4)}`;
}

export function formatAmount(raw: string, decimals: number | null): string {
  // ... exact copy from CampaignTimeline.tsx lines 27-41
}
```

```typescript
export function eventDescription(event: TimelineEvent, decimals: number | null): string {
  // ... exact copy from CampaignTimeline.tsx lines 57-98
}
```

**File**: `apps/web/src/components/campaign/detail/CampaignTimeline.tsx` (modify)

Replace the inline `EVENT_CONFIG`, `eventDescription`, `formatBlockTime`, `truncateAddress`, `truncateSig`, `formatAmount` with imports from `@/lib/vesting/timeline-helpers`. Remove the local definitions. The component logic stays identical, just the source changes.

---

### 3.3 `useVestingProgress` Hook (new)

**File**: `apps/web/src/hooks/useVestingProgress.ts` (new)

Follow the pattern in `useBeneficiaryCampaigns.ts` and `useCampaignTimeline.ts`.

#### API response shape (already defined by the existing route):

```typescript
// Mirrors the JSON returned by GET /api/beneficiary/{address}/vesting-progress
interface VestingProgressCampaign {
  treeAddress: string;
  metadata: { name?: string; description?: string; logoUri?: string } | null;
  leaf: {
    amount: string;          // raw lamports / smallest unit
    releaseType: 0 | 1 | 2;  // Cliff | Linear | Milestone
    startTime: string;       // unix seconds
    cliffTime: string;
    endTime: string;
    milestoneIdx: number;
    leafIndex: number;
  };
  progress: {
    totalEntitled: string;   // = leaf.amount
    vestedSoFar: string;      // time-based vested amount
    claimedSoFar: string;     // on-chain claims by this user
    claimable: string;        // vestedSoFar - claimedSoFar (may be "0")
    progressPercent: number;  // 0-100, 2 decimal places
    nextUnlock: string | null; // unix seconds of next vest tick, or null
  };
  cancelledAt: string | null;
  paused: boolean;
  milestoneReleased: boolean;
}

interface VestingProgressResponse {
  address: string;
  campaigns: VestingProgressCampaign[];
}
```

#### Hook implementation:

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import type { VestingProgressResponse } from "./useVestingProgress";

export function useVestingProgress(address: string | undefined) {
  return useQuery<VestingProgressResponse>({
    queryKey: ["vestingProgress", address],
    queryFn: async () => {
      const res = await fetch(`/api/beneficiary/${address}/vesting-progress`);
      if (!res.ok) throw new Error(`Vesting progress fetch failed (${res.status})`);
      return res.json();
    },
    enabled: !!address,
    staleTime: 15_000,   // 15s -- vesting amounts change with time
    refetchInterval: 60_000, // refetch every minute
  });
}
```

#### Summary hook:

```typescript
// Derive aggregated totals for dashboard stat cards
export function useVestingProgressSummary(address: string | undefined) {
  const { data, isLoading, error } = useVestingProgress(address);

  const summary = useMemo(() => {
    if (!data) return null;
    const campaigns = data.campaigns;

    let totalEntitled = 0n;
    let totalVested = 0n;
    let totalClaimed = 0n;
    let totalClaimable = 0n;

    for (const c of campaigns) {
      totalEntitled += BigInt(c.progress.totalEntitled);
      totalVested    += BigInt(c.progress.vestedSoFar);
      totalClaimed   += BigInt(c.progress.claimedSoFar);
      totalClaimable += BigInt(c.progress.claimable);
    }

    return {
      totalEntitled,
      totalVested,
      totalClaimed,
      totalClaimable,
      campaignCount: campaigns.length,
      // Top 5 by claimable amount for dashboard preview
      topClaimable: campaigns
        .filter((c) => BigInt(c.progress.claimable) > 0n)
        .sort((a, b) => Number(BigInt(b.progress.claimable)) - Number(BigInt(a.progress.claimable)))
        .slice(0, 5),
    };
  }, [data]);

  return { summary, isLoading, error, campaigns: data?.campaigns ?? [] };
}
```

---

### 3.4 Cross-Campaign Activity API (new)

**File**: `apps/web/src/app/api/activity/[address]/route.ts` (new)

This endpoint returns the most recent events across ALL campaigns where the user is a beneficiary or creator, with campaign metadata attached for linking.

#### Query parameters:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | 20 | Max events to return (max 100) |

#### Response shape:

```typescript
interface ActivityEvent {
  type: TimelineEvent["type"];
  blockTime: string;     // unix seconds
  signature: string;     // Solana tx signature
  data: Record<string, unknown>;
  campaign: {
    treeAddress: string;
    name: string | null;  // from metadata.name or null
    role: "sender" | "recipient";
  };
}

interface ActivityResponse {
  address: string;
  events: ActivityEvent[];
  total: number;
}
```

#### Implementation approach:

Same UNION ALL pattern as the timeline route (`apps/web/src/app/api/campaigns/[treeAddress]/timeline/route.ts`) but with two key differences:

1. **Campaign filter**: Join against campaigns where `creator = address` OR the user has a leaf in `leaves` for that campaign. This requires a CTE to identify the user's campaign IDs first.

2. **Campaign metadata**: Each event row includes the `treeAddress`, `metadata.name`, and whether the user is sender or recipient.

```sql
WITH user_campaigns AS (
  SELECT id, tree_address, metadata, creator
  FROM campaigns
  WHERE creator = ${address}
  UNION
  SELECT c.id, c.tree_address, c.metadata, c.creator
  FROM campaigns c
  INNER JOIN root_versions rv ON rv.campaign_id = c.id
  INNER JOIN leaves l ON l.root_version_id = rv.id AND l.beneficiary = ${address}
)
SELECT ... FROM (
  -- Same UNION ALL as timeline, but:
  -- WHERE campaign_id IN (SELECT id FROM user_campaigns)
  -- Add tree_address, metadata.name, role to each row
) sub
ORDER BY block_time DESC
LIMIT ${limit}
```

Each UNION arm adds `tree_address`, `metadata->>'name' as campaign_name`, and a `role` computed from whether the event relates to the user as creator (withdraw, pause, cancel) vs beneficiary (claim).

Use `withRoute({ rateLimit: { requests: 60, window: 60 } }, handler)` same as other endpoints.

#### Validation:

Same `BASE58_RE` pattern as vesting-progress route.

---

### 3.5 `useActivityFeed` Hook (new)

**File**: `apps/web/src/hooks/useActivityFeed.ts` (new)

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";

interface ActivityEvent {
  type:
    | "claimed" | "cancelled" | "paused" | "root_updated"
    | "withdrawn" | "milestone_released" | "stream_cancelled" | "instant_refunded";
  blockTime: string;
  signature: string;
  data: Record<string, unknown>;
  campaign: {
    treeAddress: string;
    name: string | null;
    role: "sender" | "recipient";
  };
}

interface ActivityResponse {
  address: string;
  events: ActivityEvent[];
  total: number;
}

export function useActivityFeed(address: string | undefined, limit = 20) {
  return useQuery<ActivityResponse>({
    queryKey: ["activity", address, limit],
    queryFn: async () => {
      const res = await fetch(`/api/activity/${address}?limit=${limit}`);
      if (!res.ok) {
        if (res.status === 404) return { address: address!, events: [], total: 0 };
        throw new Error(`Activity feed fetch failed (${res.status})`);
      }
      return res.json();
    },
    enabled: !!address,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
```

---

### 3.6 Shared Dashboard Components (new)

#### 3.6.1 `ProgressBar` component

**File**: `apps/web/src/components/dashboard/ProgressBar.tsx` (new)

A reusable progress bar matching the existing dark theme.

```typescript
interface ProgressBarProps {
  percent: number;       // 0-100
  variant?: "default" | "claimable" | "complete";
  size?: "sm" | "md";
}
```

Visual spec:
```
  ┌──────────────────────────────────────────┐
  │████████████████░░░░░░░░░░░░░░░░░░░░░░░░│  47.5%
  └──────────────────────────────────────────┘
  default:    violet-500 fill, white/[0.06] track
  claimable:  emerald-500 fill (pulsing glow)
  complete:   sky-500 fill
  sm:         h-1.5 rounded-full
  md:         h-2.5 rounded-full
```

#### 3.6.2 `ActivityFeedItem` component

**File**: `apps/web/src/components/dashboard/ActivityFeedItem.tsx` (new)

A single row in the activity feed. Reuses `EVENT_CONFIG` and `eventDescription` from timeline helpers, plus the campaign name and link.

```typescript
interface ActivityFeedItemProps {
  event: ActivityEvent;
  mintDecimals?: number | null;
}
```

Visual spec:
```
  ┌──────────────────────────────────────────────────────┐
  │ [icon]  Description text here with amounts          │
  │         Campaign Name · Jun 9, 14:30 · sig...4x2z    │
  └──────────────────────────────────────────────────────┘

  - icon uses EVENT_CONFIG color
  - "Campaign Name" links to /campaign/{treeAddress}
  - Signature links to Solana explorer
  - Amounts formatted via formatAmount()
```

#### 3.6.3 `ActivityFeed` component

**File**: `apps/web/src/components/dashboard/ActivityFeed.tsx` (new)

Wraps a list of `ActivityFeedItem` with a header and empty/loading states.

```typescript
interface ActivityFeedProps {
  events: ActivityEvent[];
  isLoading: boolean;
  total?: number;
  mintDecimals?: number | null;
}
```

Visual spec:
```
  ACTIVITY                                        Showing 20 of 156
  ───────────────────────────────────────────────────────────────
  [↓]  You claimed 12.5K tokens
       Team Vesting · Jun 9, 14:30 · 5xKp...4x2z
  ───────────────────────────────────────────────────────────────
  [↻]  Root updated — 15 recipients
       Advisor Pool · Jun 9, 12:00 · 3mQn...8fRt
  ───────────────────────────────────────────────────────────────
  ...
```

#### 3.6.4 `NeedsAttentionAlert` component

**File**: `apps/web/src/components/dashboard/NeedsAttentionAlert.tsx` (new)

Displays grace period warnings for cancelled campaigns where the user still has unclaimed tokens.

```typescript
interface NeedsAttentionAlertProps {
  campaignName: string | null;
  treeAddress: string;
  claimable: bigint;
  graceState: GracePeriodState;
}
```

Visual spec:
```
  ┌──────────────────────────────────────────────────────┐
  │ ⚠  Team Vesting — Grace period active: 3d 14h left  │
  │     12,500 tokens claimable before expiry            │
  │     [Claim Now →]                                    │
  └──────────────────────────────────────────────────────┘

  - Border: amber-500/20 bg-amber-500/[0.05]
  - Icon: amber-400
  - "Claim Now →" links to /campaign/{treeAddress}
```

Uses `getGracePeriodState` and `formatCountdown` from `@/lib/vesting/display.ts`.

#### 3.6.5 `VestingProgressCard` component

**File**: `apps/web/src/components/dashboard/VestingProgressCard.tsx` (new)

A per-campaign summary card for the dashboard preview and portfolio page.

```typescript
interface VestingProgressCardProps {
  campaign: VestingProgressCampaign;
  /** Optional: pass a recipient stream status for StatusBadge */
  status?: StreamStatus;
}
```

Visual spec:
```
  ┌──────────────────────────────────────────────────────┐
  │  Team Vesting                              [Linear]  │
  │  ┌────────────────────────────────────────────────┐  │
  │  │████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░│  │
  │  └────────────────────────────────────────────────┘  │
  │  Entitled: 100,000    Vested: 47,500                 │
  │  Claimed:  12,500     Claimable: 35,000               │
  │  Next unlock: 2h 30m              [Active]           │
  └──────────────────────────────────────────────────────┘

  - Campaign name from metadata.name or treeAddress truncated
  - Type badge (Linear/Cliff/Milestone) using getVestingTypeBadgeColor
  - Status badge using existing StatusBadge component
  - ProgressBar with progressPercent
  - Amounts in raw units (format later or pass decimals)
  - "Next unlock" uses formatCountdown from display.ts
  - Card links to /campaign/{treeAddress}
```

---

### 3.7 Portfolio Page (new)

**File**: `apps/web/src/app/(app)/portfolio/page.tsx` (new)

Full beneficiary portfolio view.

#### ASCII mockup:

```
  Portfolio
  Your vesting portfolio at a glance

  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
  │ Total        │ │ Vested       │ │ Claimed      │ │ Claimable    │
  │ Entitled     │ │              │ │              │ │ Now          │
  │ 500,000      │ │ 235,000      │ │ 50,000       │ │ 35,000       │
  │ across 5     │ │ 47.0%        │ │ 10.0%        │ │ 7.0%         │
  │ campaigns    │ │              │ │              │ │              │
  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘

  VESTING PROGRESS                                            [Sort: ▼]
  ─────────────────────────────────────────────────────────────────────

  ┌──────────────────────────────────────────────────────────────────┐
  │  Team Vesting                                            [Linear]│
  │  ████████████████████████████████░░░░░░░░░░░░░░░░░░░░░░  47.5%   │
  │  Entitled: 100,000   Vested: 47,500   Claimed: 12,500            │
  │  Claimable: 35,000   Next unlock: 2h 30m             [Claimable] │
  └──────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────┐
  │  Advisor Pool                                           [Cliff]  │
  │  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0.0%   │
  │  Entitled: 200,000   Vested: 0       Claimed: 0                   │
  │  Next unlock: 14d 8h                              [Scheduled]   │
  └──────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────┐
  │  Seed Round                                             [Cliff]  │
  │  ██████████████████████████████████████████████████████  100.0%  │
  │  Entitled: 50,000    Vested: 50,000  Claimed: 37,500             │
  │  Claimable: 12,500                                    [Claimable] │
  └──────────────────────────────────────────────────────────────────┘

  No campaigns found. You'll see your vesting streams here once you're
  added as a recipient to a campaign.
```

#### Component structure:

```typescript
"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useVestingProgressSummary } from "@/hooks/useVestingProgress";
import { VestingProgressCard } from "@/components/dashboard/VestingProgressCard";
import { StatCard } from "./_shared"; // or define inline

export default function PortfolioPage() {
  const { publicKey } = useWallet();
  const address = publicKey?.toBase58();
  const { summary, isLoading, campaigns } = useVestingProgressSummary(address);

  // ... wallet not connected state
  // ... 4 summary stat cards (Total Entitled, Vested, Claimed, Claimable)
  // ... grid of VestingProgressCard for each campaign
}
```

Sorting: Allow the user to sort by `claimable` (default, descending), `progressPercent` (descending), or `nextUnlock` (ascending/nulls-last). Store sort state in `useState`.

---

### 3.8 Dashboard Rewrite

**File**: `apps/web/src/app/(app)/dashboard/page.tsx` (rewrite, keep same path)

Replace the 213-line file with a richer dashboard. Keep the existing `StatCard` and `ActionCard` patterns.

#### ASCII mockup:

```
  Dashboard
  Welcome back, 7xKp...4x2z

  ┌──────────────────────────────────────────────────────────────────┐
  │ ✓  3 streams ready to claim!                                     │
  │    You have tokens available for withdrawal. Click to view.    → │
  └──────────────────────────────────────────────────────────────────┘

  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
  │ Total        │ │ Active       │ │ As Sender    │ │ As Recipient │
  │ Streams      │ │              │ │              │ │              │
  │ 8            │ │ 5            │ │ 3            │ │ 6            │
  │ All campaigns│ │ Vesting now  │ │ Created      │ │ Receiving    │
  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
  ┌──────────────┐ ┌──────────────┐
  │ TVL          │ │ Claimable    │
  │              │ │ Now          │
  │ 450,000      │ │ 35,000       │
  │ Locked value │ │ Ready to     │
  │              │ │ withdraw     │
  └──────────────┘ └──────────────┘

  ⚠ NEEDS ATTENTION
  ┌──────────────────────────────────────────────────────────────────┐
  │ ⚠  Team Vesting — Grace period active: 3d 14h left              │
  │    12,500 tokens claimable before expiry          [Claim Now →]  │
  └──────────────────────────────────────────────────────────────────┘

  VESTING PROGRESS                                         View All →
  ───────────────────────────────────────────────────────────────────
  ┌────────────────────────────┐ ┌────────────────────────────────┐
  │ Team Vesting        [Lin]  │ │ Advisor Pool           [Cliff] │
  │ ████░░░░░░░░ 47.5%        │ │ ░░░░░░░░░░░░░░░░░ 0.0%         │
  │ Claimable: 35,000         │ │ Next: 14d 8h                  │
  │ Next: 2h 30m              │ │                               │
  └────────────────────────────┘ └────────────────────────────────┘

  RECENT ACTIVITY                                         View All →
  ───────────────────────────────────────────────────────────────────
  [↓] You claimed 12.5K tokens
      Team Vesting · Jun 9, 14:30 · 5xKp...4x2z
  ───────────────────────────────────────────────────────────────────
  [↻] Root updated — 15 recipients
      Advisor Pool · Jun 9, 12:00 · 3mQn...8fRt
  ───────────────────────────────────────────────────────────────────
  [◆] Milestone #2 released
      Seed Round · Jun 8, 09:15 · 7xLm...9pQw

  QUICK ACTIONS
  ───────────────────────────────────────────────────────────────────
  ┌──────────────────────────────┐ ┌────────────────────────────────┐
  │ +  Create New Stream         │ │ 📄 View My Campaigns          │
  │    Set up a new vesting...   │ │    Monitor and manage your... │
  └──────────────────────────────┘ └────────────────────────────────┘
```

#### Data hooks to consume:

```typescript
// Existing
const senderQuery = useCampaignList(walletAddress ? { creator: walletAddress, limit: 200 } : undefined);
const recipientQuery = useBeneficiaryCampaigns(walletAddress);

// New
const { summary: vestingSummary, isLoading: vestingLoading } = useVestingProgressSummary(walletAddress);
const { data: activityData, isLoading: activityLoading } = useActivityFeed(walletAddress, 10);
```

#### "Needs Attention" section logic:

```typescript
const needsAttention = useMemo(() => {
  const nowTs = BigInt(Math.floor(Date.now() / 1000));
  return (vestingSummary?.campaigns ?? [])
    .filter((c) => {
      if (c.cancelledAt === null) return false;
      if (BigInt(c.progress.claimable) === 0n) return false;
      const graceState = getGracePeriodState(BigInt(c.cancelledAt), nowTs);
      return graceState.status === "grace_active";
    });
}, [vestingSummary]);
```

#### Stat card values:

```
Total Streams  = same as existing counts.total
Active         = same as existing counts.active
As Sender      = same as existing counts.sender
As Recipient   = same as existing counts.recipient
TVL            = vestingSummary?.totalEntitled - vestingSummary?.totalClaimed (or use existing tvl calc for sender campaigns)
Claimable Now  = vestingSummary?.totalClaimable
```

Keep the existing claimable banner at the top but enhance it to show the actual claimable amount.

---

### 3.9 Sidebar Update

**File**: `apps/web/src/components/shell/Sidebar.tsx` (modify)

Insert "Portfolio" between "Dashboard" and "Create Stream" in the `NAV_ITEMS` array:

```typescript
const NAV_ITEMS = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: /* existing grid icon */,
  },
  {
    href: "/portfolio",          // NEW
    label: "Portfolio",          // NEW
    icon: (                      // NEW — pie-chart / wallet icon
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a9 9 0 11-9-9" />
        <path d="M21 3v9h-9" />
      </svg>
    ),
  },
  {
    href: "/campaign/create",
    label: "Create Stream",
    icon: /* existing plus icon */,
  },
  {
    href: "/campaigns",
    label: "My Campaigns",
    icon: /* existing file icon */,
  },
];
```

The active state detection already works via `pathname.startsWith(item.href)`, so `/portfolio` will correctly highlight.

---

## 4. File Change Summary

### New files (7)

| File | Purpose |
|------|---------|
| `apps/web/src/lib/vesting/timeline-helpers.ts` | Shared EVENT_CONFIG, eventDescription, formatBlockTime, formatAmount |
| `apps/web/src/hooks/useVestingProgress.ts` | `useVestingProgress` + `useVestingProgressSummary` hooks |
| `apps/web/src/hooks/useActivityFeed.ts` | `useActivityFeed` hook for cross-campaign events |
| `apps/web/src/app/api/activity/[address]/route.ts` | Activity feed API endpoint |
| `apps/web/src/app/(app)/portfolio/page.tsx` | Portfolio page |
| `apps/web/src/components/dashboard/ProgressBar.tsx` | Reusable progress bar |
| `apps/web/src/components/dashboard/ActivityFeed.tsx` | Activity feed list component |
| `apps/web/src/components/dashboard/ActivityFeedItem.tsx` | Single activity event row |
| `apps/web/src/components/dashboard/NeedsAttentionAlert.tsx` | Grace period alert card |
| `apps/web/src/components/dashboard/VestingProgressCard.tsx` | Per-campaign progress card |

### Modified files (4)

| File | Change |
|------|--------|
| `apps/web/vercel.json` | Change cron from `0 0 * * *` to `*/5 * * * *` |
| `apps/web/src/app/(app)/dashboard/page.tsx` | Rewrite with 6 stat cards, alerts, progress preview, activity feed |
| `apps/web/src/components/shell/Sidebar.tsx` | Add Portfolio nav item |
| `apps/web/src/components/campaign/detail/CampaignTimeline.tsx` | Import helpers from `@/lib/vesting/timeline-helpers` instead of inline definitions |

---

## 5. Implementation Order

1. **Cron fix** (`vercel.json`) -- 1 minute, unblocks everything else
2. **Timeline helpers** (`timeline-helpers.ts` + CampaignTimeline refactor) -- unblocks shared components
3. **`useVestingProgress` hook** -- unblocks dashboard and portfolio
4. **Dashboard rewrite** -- highest visibility, validates the hook works
5. **Activity API** (`/api/activity/[address]`) -- backend piece needed for activity feed
6. **`useActivityFeed` hook** -- wraps the activity API
7. **Dashboard components** (ProgressBar, ActivityFeed, NeedsAttentionAlert, VestingProgressCard) -- extracted during dashboard rewrite or built after
8. **Portfolio page** -- uses all the above components
9. **Sidebar update** -- last, since `/portfolio` needs to exist first

---

## 6. Key Design Decisions

### 6.1 No aggregation API needed

The existing `/api/beneficiary/{address}/vesting-progress` returns per-campaign data. Aggregation (totals) is done client-side in `useVestingProgressSummary` via `useMemo`. This avoids adding another API endpoint and keeps the backend as-is.

Rationale: For a typical user with <50 campaigns, summing BigInts in `useMemo` is negligible. If users scale to hundreds of campaigns, consider a server-side aggregation endpoint later.

### 6.2 Activity API uses a new route, not the timeline

The existing timeline API requires a `treeAddress` and is per-campaign. The activity feed needs cross-campaign events. Rather than making N timeline requests (one per campaign), a single `/api/activity/{address}` endpoint with the same UNION ALL pattern is more efficient and simpler to paginate.

### 6.3 Amounts displayed in raw units

The current codebase (VestingChart, CampaignTimeline) formats amounts in raw lamports/smallest-units, not human-readable token amounts. The dashboard should follow the same pattern until a token metadata lookup is implemented. Components accept optional `mintDecimals` for formatting, defaulting to raw display.

### 6.4 No charts on dashboard

The VestingChart component (542 lines of SVG) is per-campaign and complex. The dashboard shows progress bars instead, which are simpler and sufficient for a summary view. The full VestingChart remains on the campaign detail page.

### 6.5 Sorting on portfolio page

Default sort is by `claimable` descending (most actionable first). Sorting is client-side state, not a URL param. For large portfolios (>100 campaigns), add URL-based sort params later.

---

## 7. Verification Steps

After implementation:

### 7.1 Cron fix
- [ ] Deploy to Vercel. In Vercel dashboard, verify the cron job shows `*/5 * * * *`
- [ ] Create a campaign, wait 5-10 minutes, check that claim events appear in the timeline

### 7.2 Vesting progress hook
- [ ] Connect wallet as a recipient of an existing campaign
- [ ] Visit `/api/beneficiary/{your-address}/vesting-progress` directly -- confirm JSON response
- [ ] Open browser DevTools Network tab, confirm the hook calls this endpoint
- [ ] Confirm `useVestingProgressSummary` correctly sums totals

### 7.3 Dashboard rewrite
- [ ] All 6 stat cards render with correct values
- [ ] TVL card shows a number (not zero or undefined)
- [ ] Claimable Now card shows correct claimable amount
- [ ] "Needs Attention" section appears only when there are cancelled campaigns with active grace periods
- [ ] Vesting progress section shows top 5 claimable campaigns
- [ ] Activity feed renders events with campaign names and links
- [ ] Quick Actions section unchanged from original
- [ ] Mobile responsive: stat cards stack on small screens
- [ ] Disconnected wallet state works

### 7.4 Activity API
- [ ] `GET /api/activity/{address}` returns events with `campaign` field including `treeAddress` and `name`
- [ ] Events include both sender-role events (withdrawn, paused) and recipient-role events (claimed)
- [ ] `limit` param works, defaults to 20, max 100
- [ ] Empty response for address with no campaigns: `{ address: "...", events: [], total: 0 }`

### 7.5 Portfolio page
- [ ] 4 summary cards show correct aggregated totals
- [ ] Each campaign card shows progress bar, amounts, status badge, type badge
- [ ] "Next unlock" shows countdown or "Complete"
- [ ] Sort toggle works (claimable, progress, next unlock)
- [ ] "Claim" link on cards navigates to `/campaign/{treeAddress}`
- [ ] Empty state renders when user has no campaigns

### 7.6 Sidebar
- [ ] "Portfolio" item visible between Dashboard and Create Stream
- [ ] Active highlight works when on `/portfolio`
- [ ] Mobile menu works with new nav item

### 7.7 Timeline refactor
- [ ] CampaignTimeline on campaign detail page still renders identically after refactor
- [ ] No duplicate function definitions (all imported from helpers)

### 7.8 Build checks
```bash
cd apps/web
pnpm lint        # No new warnings
pnpm build       # No TypeScript errors
pnpm typecheck   # No type errors (if available)
```

---

## 8. Existing Patterns Reference

### Hook pattern (from `useBeneficiaryCampaigns.ts`)
```typescript
export function useXyz(address: string | undefined) {
  return useQuery<ResponseType>({
    queryKey: ["key", address],
    queryFn: async () => {
      const res = await fetch(`/api/path/${address}`);
      if (!res.ok) throw new Error(`...`);
      return res.json();
    },
    enabled: !!address,
    staleTime: X_000,
    refetchInterval: Y_000,
  });
}
```

### Route handler pattern (from timeline route)
```typescript
import { withRoute } from "@/lib/api/route-wrapper";

export const GET = withRoute(
  { rateLimit: { requests: 60, window: 60 } },
  async (request, { params }) => {
    // validate, query, return jsonResponse(data)
  },
);
```

### Component pattern (from dashboard page)
- `"use client"` directive at top
- Styled with Tailwind utility classes
- Dark theme: `bg-white/[0.02]`, `border-white/[0.06]`, `text-[#8b92a5]`, etc.
- Cards: `rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5`
- Accent color: violet-400/500 for primary actions, emerald-400/500 for claims
- Typography: labels `text-[11px] font-medium uppercase tracking-[0.12em] text-[#555d73]`, values `text-2xl font-semibold text-white`

---

## 9. Risks and Edge Cases

1. **Stale vesting data**: The `vestedSoFar` is computed server-side at request time. With `refetchInterval: 60_000` (1 min), the dashboard may show slightly stale progress. Acceptable for a dashboard; add a "last updated" timestamp if needed.

2. **Zero-campaign users**: Both dashboard and portfolio must handle the case where the user has zero campaigns gracefully (empty state, not a loading spinner forever).

3. **Large claim events**: Some campaigns may have thousands of events. The activity API uses `LIMIT` and the dashboard only shows 10 events. The timeline count query could be slow on large datasets -- consider caching or skipping the count for the activity endpoint.

4. **Cancelled campaigns with no grace**: `cancelledAt !== null && graceExpired && claimable === 0` -- these should not appear in "Needs Attention". Filter them out.

5. **Milestone campaigns**: The vesting-progress API already handles `milestoneReleased` flag. The dashboard must show milestone campaigns differently from cliff/linear -- "Milestone not released" instead of a countdown.

6. **Multiple leaves per campaign**: The current vesting-progress API returns one row per leaf (one per `root_versions` entry where the user has a leaf). A user with multiple allocations in the same campaign gets multiple rows. The dashboard should aggregate these by `treeAddress` or the API should coalesce them. Verify with real data which path occurs.
