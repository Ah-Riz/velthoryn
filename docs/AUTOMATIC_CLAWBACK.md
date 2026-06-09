# Automatic Clawback -- Feature Implementation Guide

> **Feature 4 of Velthoryn (safety net).**
> This document is for the development team and Cursor AI to implement from.
> The ENTIRE BACKEND IS COMPLETE. This doc covers the frontend visibility layer only.

---

## Table of Contents

1. [Overview](#overview)
2. [What Exists (Backend + Components)](#what-exists)
3. [What Is Missing (This Spec)](#what-is-missing)
4. [Existing Code Reference Map](#existing-code-reference-map)
5. [Implementation Plan](#implementation-plan)
   - [T1: GracePeriodCountdown Component](#t1-graceperiodcountdown-component)
   - [T2: CampaignStatusBanner Component](#t2-campaignstatusbanner-component)
   - [T3: Integrate Banner into Campaign Detail Page](#t3-integrate-banner-into-campaign-detail-page)
   - [T4: useNeedsActionCount Hook](#t4-useneedsactioncount-hook)
   - [T5: Sidebar Notification Badge](#t5-sidebar-notification-badge)
   - [T6: "Needs Action" Tab in Campaigns List](#t6-needs-action-tab-in-campaigns-list)
   - [T7: Dashboard "Needs Attention" Section](#t7-dashboard-needs-attention-section)
6. [Conditional Rendering Tables](#conditional-rendering-tables)
7. [Integration Data Flow](#integration-data-flow)
8. [Verification Steps](#verification-steps)
9. [Non-Goals and Boundaries](#non-goals-and-boundaries)

---

## Overview

The Automatic Clawback feature enables creators to cancel vesting campaigns and recover unvested tokens after a 7-day grace period. Recipients retain any tokens vested up to the cancellation moment. The smart contract instructions (`cancel_campaign`, `cancel_stream`, `withdraw_unvested`), API endpoints, TX builder, `CancelConfirmDialog` (3 modes: instant settle, grace period, instant refund), and `WithdrawUnvestedButton` (grace countdown + confirm) are all fully built and tested.

**The problem is VISIBILITY and DISCOVERABILITY.** These features are buried in the ~2584-line campaign detail page. There are:

- No status-driven banners at the top of the page when a campaign is cancelled
- No creator recovery dashboard showing "campaigns needing attention"
- No grace period countdown visible outside the campaign detail Actions panel
- No notification badge in the sidebar
- No "Needs Action" tab in the campaigns list

This doc specifies 7 implementation tasks that create new components, hooks, and integrations to make clawback a first-class, visible feature.

---

## What Exists

### Smart Contract Instructions (complete, no changes needed)
- `cancel_campaign` -- multi-leaf cancel with 7-day grace period
- `cancel_stream` -- single-leaf cancel with grace period
- `withdraw_unvested` -- creator recovers unvested tokens after grace period
- `instant_refund_campaign` -- refund campaigns that haven't started vesting

### API Endpoints (complete, no changes needed)
- `POST /api/events/sync` -- event indexing (called after TX)
- `PATCH /api/campaigns/:id/status` -- status update after cancel/refund
- `GET /api/campaigns` -- campaign list with `cancelledAt` field
- `GET /api/beneficiary/:address/campaigns` -- recipient campaigns with claim status

### Frontend Components (complete, reuse as-is)

| File | What It Does |
|------|-------------|
| `apps/web/src/components/campaign/detail/CancelConfirmDialog.tsx` | 3-mode cancel dialog: instant settle (single-stream), grace period, instant refund (multi-leaf, pre-vesting). Props: `isOpen`, `onConfirm`, `onConfirmStream`, `onConfirmInstantRefund`, `onClose`, `isLoading`, `isStreamLoading`, `isInstantRefundLoading`, `isSingleStream`, `isInstantRefundEligible`, `totalSupply`, `totalClaimed`, `vestedAmount`, `mintDecimals`, plus beneficiary fields. |
| `apps/web/src/components/campaign/detail/WithdrawUnvestedButton.tsx` | Grace countdown display + confirm-then-withdraw flow. Props: `program`, `publicKey`, `treePubkey`, `mint`, `vaultAuthority`, `vault`, `cancelledAt`, `isCreator`, `nowTs`, `onSuccess`, `toast`. Already handles both native SOL and SPL tokens. Already uses `getGracePeriodState()` to show disabled countdown while grace is active. |
| `apps/web/src/components/campaign/list/StatusBadge.tsx` | Renders `StreamStatus` as a colored badge. Uses `border-{color}/20 bg-{color}/10 text-{color}` pattern. |

### Frontend Utilities (complete, reuse as-is)

| File | What It Provides |
|------|-----------------|
| `apps/web/src/lib/vesting/display.ts` | `getGracePeriodState(cancelledAt, nowTs)` returns `{ status: "not_cancelled" | "grace_active"; remaining; countdown } | { status: "grace_expired" }`. `formatCountdown(targetUnix, nowUnix)` returns `"5d 14h 32m"`. `GRACE_PERIOD_SECS = 604800n` (7 days). |
| `apps/web/src/lib/campaign/authority.ts` | `canWithdrawUnvested({ viewer, creator, cancelledAt })` -- true when cancelledAt is not null and viewer is creator. `canCancelCampaign(...)` and `canInstantRefund(...)` for cancel permissions. |
| `apps/web/src/lib/vesting/list.ts` | `getSenderStreamStatus(stream)` returns `"Cancelled"` when `cancelledAt !== null`. `getRecipientStreamStatus(stream, nowTs)` returns `"Claimable"` when claimable tokens exist. `StreamStatus` type. |

### Frontend Hooks (complete, reuse as-is)

| File | Query Key | Returns |
|------|----------|---------|
| `apps/web/src/hooks/useCampaignList.ts` | `["campaigns", filters]` | `{ campaigns: CampaignSummary[], total, page, limit }`. Each campaign has `cancelledAt: number | null`. `staleTime: 5_000`, `refetchInterval: 30_000`. |
| `apps/web/src/hooks/useBeneficiaryCampaigns.ts` | `["beneficiaryCampaigns", address]` | `{ campaigns: BeneficiaryCampaign[] }`. Each has `myClaimed`, `myLeaf` (with schedule fields). |

### Current Campaign Detail Page (the monolith)

**File:** `apps/web/src/app/(app)/campaign/[id]/page.tsx` (~2584 lines)

Key state the page already computes and maintains (pass as props to the new banner):

```typescript
// Line ~710-715: Core derived values
const nowTs = BigInt(nowUnix);              // updates every 1s via setInterval (line 511-515)
const cancelledAtBigint = treeState?.cancelledAt
  ? BigInt(treeState.cancelledAt.toString())
  : null;
const totalSupply = treeState ? BigInt(treeState.totalSupply.toString()) : 0n;
const treeTotalClaimed = treeState ? BigInt(treeState.totalClaimed.toString()) : 0n;

// Line ~852: Whether to show WithdrawUnvested button
const canShowWithdrawUnvested = canWithdrawUnvested({
  viewer: publicKey,
  creator: treeState?.creator,
  cancelledAt: cancelledAtBigint,
});

// Line ~828-834: Funding status
const isFundingIncomplete = fundingRemaining > 0n;

// Line ~1048-1058: Status label computation
const statusLabel = treeState?.instantRefunded
  ? "Refunded"
  : treeState?.paused
    ? "Paused"
    : treeState?.cancelledAt
      ? "Cancelled"
      : displaySupply > 0n && displayClaimed >= displaySupply
        ? "Claimed"
        : "Active";
```

**Inline cards to be removed** (their content moves to `CampaignStatusBanner`):

1. **Instant-refunded card** (around line 1984-1991):
```tsx
{treeState.instantRefunded && (
  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
    <p className="text-[13px] font-medium text-amber-300">Campaign Instantly Refunded</p>
    <p className="mt-2 text-[12px] leading-6 text-amber-100/80">
      This campaign was refunded before vesting started. All funds were returned to the creator.
    </p>
  </div>
)}
```

2. **Funding-incomplete card** (around line 1993-2017):
```tsx
{isFundingIncomplete && !treeState.instantRefunded && (
  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
    <p className="text-[13px] font-medium text-amber-300">Funding incomplete</p>
    <p className="mt-2 text-[12px] leading-6 text-amber-100/80">
      This campaign needs {formatFundingAmount(fundingRemaining)} before claims can run.
    </p>
    {/* ... funding button or "Creator must fund" message ... */}
  </div>
)}
```

**Render structure** (where to insert the banner):

```
Line 1669: <div className="mx-auto max-w-6xl space-y-6 pb-12">
Line 1670-1707:   Header section (title, status badge, type badge, etc.)
                   </div>  // <-- CLOSE of header section
                   // <-- INSERT CampaignStatusBanner HERE (between line 1707 and 1709)
Line 1709:   <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
                   // Main content grid (metrics, progress, details, schedule, actions sidebar)
             </div>
           </div>
```

### Current Campaigns List Page

**File:** `apps/web/src/app/(app)/campaigns/page.tsx` (547 lines)

```typescript
// Line 22: Current tab type
type TabKey = "all" | "recipient" | "sender";

// Line 85-89: Current tabs
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "recipient", label: "As Recipient" },
  { key: "sender", label: "As Sender" },
];

// Line 380-387: Tab counts
const tabCounts = useMemo(
  () => ({
    all: rows.length,
    recipient: rows.filter((row) => row.role === "recipient" || row.role === "both").length,
    sender: rows.filter((row) => row.role === "sender" || row.role === "both").length,
  }),
  [rows],
);

// Line 361-378: Filter logic
const filteredRows = rows.filter((row) => {
  if (activeTab === "recipient" && row.role === "sender") return false;
  if (activeTab === "sender" && row.role === "recipient") return false;
  // search filter...
});
```

The `rows` array (line 268-359) merges sender and recipient campaigns into unified `StreamRow` objects. Each has a `role` field (`"sender"`, `"recipient"`, or `"both"`).

### Current Sidebar

**File:** `apps/web/src/components/shell/Sidebar.tsx` (132 lines)

Key points:
- `SidebarContent` is a `"use client"` component -- safe to use `useWallet()` directly.
- `NAV_ITEMS` array at line 7-43 defines the navigation.
- The "My Campaigns" item has `href: "/campaigns"` (line 32).
- Nav items rendered in `NAV_ITEMS.map()` loop at line 65-89.
- The `<Link>` component at line 73 has className with flexbox layout -- the badge can use `ml-auto`.

### Current Dashboard

**File:** `apps/web/src/app/(app)/dashboard/page.tsx` (213 lines)

- Uses `useCampaignList` and `useBeneficiaryCampaigns` for data.
- Has existing `StatCard` and `ActionCard` sub-components.
- Has a "Claimable Banner" (line 168-182) for recipient claimable streams.
- No "Needs Attention" section currently.

---

## What Is Missing

| Item | Priority | Description |
|------|----------|-------------|
| `CampaignStatusBanner` component | P0 | Status-driven banner at the top of the campaign detail page |
| `GracePeriodCountdown` component | P0 | Reusable live countdown for grace period |
| Banner integration in detail page | P0 | Wire `CampaignStatusBanner` into the campaign detail page, remove inline duplicates |
| `useNeedsActionCount` hook | P1 | Lightweight hook counting campaigns needing attention |
| Sidebar notification badge | P1 | Amber dot on "My Campaigns" when action needed |
| "Needs Action" tab | P1 | Filter tab in campaigns list for cancelled + claimable campaigns |
| Dashboard "Needs Attention" section | P2 | Shows cancelled sender campaigns with grace status (co-dependent with transparency-dashboard-ui T9) |

---

## Existing Code Reference Map

When implementing any task, read these files first to understand the patterns:

```
apps/web/src/
  lib/
    vesting/display.ts          -- getGracePeriodState, formatCountdown, GRACE_PERIOD_SECS
    vesting/list.ts             -- StreamStatus type, getSenderStreamStatus, getRecipientStreamStatus
    campaign/authority.ts       -- canWithdrawUnvested, canCancelCampaign, canInstantRefund
  components/
    campaign/detail/
      CancelConfirmDialog.tsx   -- existing cancel flow (3 modes), DO NOT modify
      WithdrawUnvestedButton.tsx -- existing withdraw flow, DO NOT modify
      CampaignTimeline.tsx     -- example of dark-theme component pattern
    campaign/list/
      StatusBadge.tsx           -- colored badge pattern to match
    shell/
      Sidebar.tsx               -- to modify for notification badge
  hooks/
    useCampaignList.ts         -- sender campaigns query, returns cancelledAt per campaign
    useBeneficiaryCampaigns.ts -- recipient campaigns query, returns myClaimed/myLeaf
  app/(app)/
    campaign/[id]/page.tsx      -- monolith detail page, to modify for banner integration
    campaigns/page.tsx          -- campaigns list, to modify for "Needs Action" tab
    dashboard/page.tsx          -- dashboard, to modify for "Needs Attention" section
```

---

## Implementation Plan

### T1: GracePeriodCountdown Component

**New file:** `apps/web/src/components/campaign/detail/GracePeriodCountdown.tsx`

**Purpose:** Reusable live countdown component for the 7-day grace period after campaign cancellation.

**Props interface:**
```typescript
interface GracePeriodCountdownProps {
  cancelledAt: bigint;
  className?: string;
}
```

**Implementation:**
```typescript
"use client";

import { useState, useEffect } from "react";
import { getGracePeriodState, formatCountdown, GRACE_PERIOD_SECS } from "@/lib/vesting/display";

type GracePeriodCountdownProps = {
  cancelledAt: bigint;
  className?: string;
};

export function GracePeriodCountdown({ cancelledAt, className }: GracePeriodCountdownProps) {
  const [nowTs, setNowTs] = useState<bigint>(() => BigInt(Math.floor(Date.now() / 1000)));

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowTs(BigInt(Math.floor(Date.now() / 1000)));
    }, 60_000); // update every 60 seconds
    return () => window.clearInterval(interval);
  }, []);

  const graceState = getGracePeriodState(cancelledAt, nowTs);

  if (graceState.status === "not_cancelled") return null;

  if (graceState.status === "grace_active") {
    const isUrgent = graceState.remaining < 86400n; // less than 24 hours
    return (
      <span className={isUrgent ? "text-red-400" : "text-amber-400"}>
        {graceState.countdown} remaining
      </span>
    );
  }

  // grace_expired
  return (
    <span className="text-red-400">
      Grace period expired
    </span>
  );
}
```

**Key details:**
- `setInterval` every 60 seconds (not 1 second -- this is a day-level countdown, no need for second precision)
- Uses `getGracePeriodState()` directly from `lib/vesting/display.ts`
- `className` prop for optional extra styling when embedded in different contexts
- Amber text by default; red text when under 24 hours remaining
- Returns `null` for `not_cancelled` (safe to render unconditionally)

**Verification:**
- Render with `cancelledAt = BigInt(Math.floor(Date.now() / 1000) - 3 * 86400)` -- shows amber "4d Xh Xm remaining"
- Render with `cancelledAt = BigInt(Math.floor(Date.now() / 1000) - 8 * 86400)` -- shows red "Grace period expired"
- Render with `cancelledAt = BigInt(Math.floor(Date.now() / 1000) - 6 * 86400)` -- shows amber (2d remaining, not urgent)
- Render with `cancelledAt = BigInt(Math.floor(Date.now() / 1000) - 6 * 86400 + 7200)` -- shows red (less than 24h remaining)

---

### T2: CampaignStatusBanner Component

**New file:** `apps/web/src/components/campaign/detail/CampaignStatusBanner.tsx`

**Purpose:** Conditional banner at the TOP of the campaign detail page. Shows status-driven information for cancelled, refunded, and unfunded campaigns. Only visible to the creator.

**Props interface:**
```typescript
interface CampaignStatusBannerProps {
  cancelledAtBigint: bigint | null;
  isCreator: boolean;
  isInstantRefunded: boolean;
  isFunded: boolean;
  nowTs: bigint;
  onWithdrawClick: () => void;
  onResumeFunding?: () => void;
  unvestedAmount?: bigint;
}
```

**Rendering logic table:**

| Priority | Condition | Banner Style | Content |
|----------|-----------|-------------|---------|
| 1 | `!isCreator` | Nothing | Returns `null` |
| 2 | `isInstantRefunded` | Green: `bg-emerald-500/[0.05] border-emerald-500/20` | "Campaign refunded before vesting started. All tokens returned to your wallet." |
| 3 | `cancelledAtBigint !== null` + `grace_active` | Amber: `bg-amber-500/[0.05] border-amber-500/20` | "This campaign was cancelled on {date}. Grace period expires in {countdown}. Recipients can still claim vested tokens." + `GracePeriodCountdown` |
| 4 | `cancelledAtBigint !== null` + `grace_expired` + not withdrawn | Red: `bg-red-500/[0.05] border-red-500/20` | "Grace period has expired. You can now withdraw {amount} unvested tokens." + [Withdraw Unvested] button |
| 5 | `cancelledAtBigint !== null` + `grace_expired` + withdrawn | Green: `bg-emerald-500/[0.05] border-emerald-500/20` | "Campaign settled. Unvested tokens have been withdrawn to your wallet." |
| 6 | `!isFunded` | Amber: `bg-amber-500/[0.05] border-amber-500/20` | "Campaign created but not yet funded." + [Resume Funding] button if `onResumeFunding` provided |
| 7 | All other states | Nothing | Returns `null` |

**Full implementation sketch:**
```typescript
"use client";

import { getGracePeriodState } from "@/lib/vesting/display";
import { GracePeriodCountdown } from "./GracePeriodCountdown";

type CampaignStatusBannerProps = {
  cancelledAtBigint: bigint | null;
  isCreator: boolean;
  isInstantRefunded: boolean;
  isFunded: boolean;
  nowTs: bigint;
  onWithdrawClick: () => void;
  onResumeFunding?: () => void;
  unvestedAmount?: bigint;
};

export function CampaignStatusBanner({
  cancelledAtBigint,
  isCreator,
  isInstantRefunded,
  isFunded,
  nowTs,
  onWithdrawClick,
  onResumeFunding,
  unvestedAmount,
}: CampaignStatusBannerProps) {
  // Non-creators see nothing
  if (!isCreator) return null;

  // Instant refunded (pre-vesting refund, no grace period)
  if (isInstantRefunded) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
        <p className="text-[13px] font-medium text-emerald-400">
          Campaign refunded before vesting started
        </p>
        <p className="mt-1.5 text-[12px] leading-6 text-emerald-300/70">
          All tokens were returned to your wallet.
        </p>
      </div>
    );
  }

  // Cancelled with grace period states
  if (cancelledAtBigint !== null) {
    const graceState = getGracePeriodState(cancelledAtBigint, nowTs);

    if (graceState.status === "grace_active") {
      const cancelDate = new Date(Number(cancelledAtBigint) * 1000).toLocaleDateString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
      });
      return (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4">
          <p className="text-[13px] font-medium text-amber-400">
            Campaign cancelled on {cancelDate}
          </p>
          <p className="mt-1.5 text-[12px] leading-6 text-amber-300/70">
            Grace period expires in{" "}
            <GracePeriodCountdown cancelledAt={cancelledAtBigint} />.
            Recipients can still claim vested tokens.
          </p>
        </div>
      );
    }

    // grace_expired -- determine if withdrawn
    // The parent passes unvestedAmount; if 0 or undefined after grace expired, assume withdrawn.
    // A more robust approach: check if treeState.totalClaimed >= treeState.totalSupply,
    // but we keep the banner simple and let the parent decide.
    const isWithdrawn = unvestedAmount === 0n || unvestedAmount === undefined;

    if (isWithdrawn) {
      return (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
          <p className="text-[13px] font-medium text-emerald-400">
            Campaign settled
          </p>
          <p className="mt-1.5 text-[12px] leading-6 text-emerald-300/70">
            Unvested tokens have been withdrawn to your wallet.
          </p>
        </div>
      );
    }

    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] p-4">
        <p className="text-[13px] font-medium text-red-400">
          Grace period has expired
        </p>
        <p className="mt-1.5 text-[12px] leading-6 text-red-300/70">
          You can now withdraw your unvested tokens.
        </p>
        <button
          type="button"
          onClick={onWithdrawClick}
          className="mt-3 w-full rounded-xl border border-amber-500/20 bg-amber-600 px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-amber-500"
        >
          Withdraw Unvested Tokens
        </button>
      </div>
    );
  }

  // Funding incomplete
  if (!isFunded) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4">
        <p className="text-[13px] font-medium text-amber-400">
          Campaign created but not yet funded
        </p>
        {onResumeFunding && (
          <button
            type="button"
            onClick={onResumeFunding}
            className="mt-3 w-full rounded-xl border border-amber-500/20 bg-amber-400 px-4 py-2.5 text-[13px] font-semibold text-black transition hover:opacity-90"
          >
            Resume Funding
          </button>
        )}
      </div>
    );
  }

  return null;
}
```

**Key design decisions:**
- The `onWithdrawClick` callback does NOT directly call the smart contract. The parent page owns the `WithdrawUnvestedButton` component in the Actions sidebar. The banner's button should either: (a) programmatically scroll to the Actions sidebar, or (b) trigger the same withdraw flow. Recommended approach: use a ref on the `WithdrawUnvestedButton` and call `.click()` from the callback.
- `unvestedAmount` is passed by the parent (computed as `totalSupply - vestedAmount` at the time of cancellation). If the parent cannot determine this, the banner uses a simpler "not withdrawn" check based on `cancelledAt !== null && !streamSettled && !hasStreamCancelledEvent` (matching the existing `canShowWithdrawUnvested` logic at line 852).
- The banner uses `rounded-xl` to match existing card styling (not `rounded-2xl` which is for page-level sections).

---

### T3: Integrate Banner into Campaign Detail Page

**File to modify:** `apps/web/src/app/(app)/campaign/[id]/page.tsx`

**Step 1: Add import (top of file, around line 24-27)**
```typescript
import { CampaignStatusBanner } from "@/components/campaign/detail/CampaignStatusBanner";
```

**Step 2: Compute additional derived values (in the derived values section, around line 700-830)**
```typescript
// isCreator check (add near line 852 where other authority checks are)
const isCreator = !!publicKey && !!treeState?.creator && publicKey.equals(treeState.creator);

// unvested amount for banner display (add near line 828)
const unvestedAmount = cancelledAtBigint !== null
  ? totalSupply - vested
  : 0n;

// isFunded is the inverse of isFundingIncomplete (already computed at line 828)
// isFunded = !isFundingIncomplete && cancelledAtBigint === null || totalSupply > 0n
// Simplification: use isFundingIncomplete directly
```

**Step 3: Insert banner into render (between line 1707 and 1709)**

Find this code:
```tsx
          </div>  // <-- end of header section (line 1707)

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">  // line 1709
```

Insert between them:
```tsx
          </div>

          <CampaignStatusBanner
            cancelledAtBigint={cancelledAtBigint}
            isCreator={isCreator}
            isInstantRefunded={treeState.instantRefunded ?? false}
            isFunded={!isFundingIncomplete || cancelledAtBigint !== null}
            nowTs={nowTs}
            onWithdrawClick={() => {
              // Scroll to the Actions sidebar where WithdrawUnvestedButton lives
              const actionsEl = document.getElementById("campaign-actions");
              actionsEl?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            onResumeFunding={canShowFundingRecovery ? handleFundExistingCampaign : undefined}
            unvestedAmount={unvestedAmount}
          />

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
```

Also add `id="campaign-actions"` to the Actions panel div (line 1959):
```tsx
<div className="space-y-6">
  <div id="campaign-actions" className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 lg:sticky lg:top-6">
```

**Step 4: Remove inline instant-refunded card (line 1984-1991)**

Delete this entire block:
```tsx
              {treeState.instantRefunded && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <p className="text-[13px] font-medium text-amber-300">Campaign Instantly Refunded</p>
                  <p className="mt-2 text-[12px] leading-6 text-amber-100/80">
                    This campaign was refunded before vesting started. All funds were returned to the creator.
                  </p>
                </div>
              )}
```

**Step 5: Remove inline funding-incomplete card (line 1993-2017)**

Delete this entire block:
```tsx
              {isFundingIncomplete && !treeState.instantRefunded && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <p className="text-[13px] font-medium text-amber-300">Funding incomplete</p>
                  <p className="mt-2 text-[12px] leading-6 text-amber-100/80">
                    This campaign needs {formatFundingAmount(fundingRemaining)} before claims can run.
                  </p>
                  {canShowFundingRecovery ? (
                    <button ...>Resume Funding</button>
                  ) : (
                    <p>Creator must fund this campaign first.</p>
                  )}
                  {/* ... error display ... */}
                </div>
              )}
```

**Important:** Keep the `handleFundExistingCampaign` function (it's still needed by the banner's `onResumeFunding` callback). Keep the `fundingStateQuery`, `fundingRemaining`, `isFundingIncomplete`, `canShowFundingRecovery` computations -- they're still used by the banner and by the claim flow.

**Net effect:** Page shrinks by approximately 35 lines (removed inline cards, added ~10 lines for banner integration).

**Also consider:** The withdrawn-state detection for the green banner. The simplest approach is to check if the `WithdrawUnvestedButton` would be visible. Currently `canShowWithdrawUnvested` (line 852) is `!streamSettled && !hasStreamCancelledEvent && !instantRefunded && canWithdrawUnvested(...)`. After withdrawal, `streamSettled` or `hasStreamCancelledEvent` becomes true. So pass a `isWithdrawn` prop computed as:
```typescript
const isWithdrawn = cancelledAtBigint !== null && (streamSettled || hasStreamCancelledEvent);
```
Then in `CampaignStatusBanner`, the green "settled" state renders when `isWithdrawn` is true.

---

### T4: useNeedsActionCount Hook

**New file:** `apps/web/src/hooks/useNeedsActionCount.ts`

**Purpose:** Lightweight hook for sidebar badge. Counts sender campaigns with `cancelledAt !== null` and recipient campaigns with claimable tokens.

```typescript
"use client";

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCampaignList } from "@/hooks/useCampaignList";
import { useBeneficiaryCampaigns } from "@/hooks/useBeneficiaryCampaigns";
import { getRecipientStreamStatus } from "@/lib/vesting/list";

type NeedsActionResult = {
  count: number;
  isLoading: boolean;
};

export function useNeedsActionCount(): NeedsActionResult {
  const { publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58();

  const senderQuery = useCampaignList(
    walletAddress ? { creator: walletAddress, limit: 100 } : undefined,
  );
  const recipientQuery = useBeneficiaryCampaigns(walletAddress);

  const count = useMemo(() => {
    let n = 0;

    // Sender campaigns that are cancelled (need attention from creator)
    const senderCampaigns = senderQuery.data?.campaigns ?? [];
    for (const c of senderCampaigns) {
      if (c.creator === walletAddress && c.cancelledAt !== null) {
        n++;
      }
    }

    // Recipient campaigns with claimable tokens
    const recipientCampaigns = recipientQuery.data?.campaigns ?? [];
    const nowTs = BigInt(Math.floor(Date.now() / 1000));
    for (const c of recipientCampaigns) {
      const status = getRecipientStreamStatus(c, nowTs);
      if (status === "Claimable") {
        n++;
      }
    }

    return n;
  }, [senderQuery.data?.campaigns, recipientQuery.data?.campaigns, walletAddress]);

  const isLoading = senderQuery.isLoading || recipientQuery.isLoading;

  return { count, isLoading };
}
```

**Key details:**
- Uses existing hooks directly (no new API calls, no new query keys)
- The `useCampaignList` and `useBeneficiaryCampaigns` hooks are already used in the sidebar's sibling pages (campaigns list, dashboard). TanStack Query deduplicates identical query keys, so this adds virtually zero network overhead.
- `staleTime: 5_000` from `useCampaignList` means the sidebar badge updates within 5 seconds of a campaign being cancelled.
- Returns `isLoading` so the sidebar can suppress the badge while data loads (avoid flicker).

---

### T5: Sidebar Notification Badge

**File to modify:** `apps/web/src/components/shell/Sidebar.tsx`

**Step 1: Add import**
```typescript
import { useWallet } from "@solana/wallet-adapter-react";
import { useNeedsActionCount } from "@/hooks/useNeedsActionCount";
```

**Step 2: Add hook call in `SidebarContent`**

In `SidebarContent` (line 45), add:
```typescript
function SidebarContent({ onNavClick }: { onNavClick?: () => void }) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const { count: needsActionCount, isLoading: needsActionLoading } = useNeedsActionCount();

  useEffect(() => {
    setMounted(true);
  }, []);

  // ... rest unchanged
```

**Step 3: Add badge to "My Campaigns" nav item**

In the `NAV_ITEMS.map()` loop (line 65-89), modify the `<Link>` content for the campaigns item:
```tsx
{NAV_ITEMS.map((item) => {
  const isActive = mounted && (
    pathname === item.href ||
    (item.href !== "/dashboard" && pathname.startsWith(item.href))
  );

  return (
    <li key={item.href}>
      <Link
        href={item.href}
        onClick={onNavClick}
        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors ${
          isActive
            ? "bg-violet-600/15 text-violet-300"
            : "text-[#8b92a5] hover:bg-white/[0.04] hover:text-white"
        }`}
      >
        <span className={isActive ? "text-violet-400" : "text-[#555d73]"}>
          {item.icon}
        </span>
        {item.label}
        {/* Notification badge for campaigns needing attention */}
        {item.href === "/campaigns" && needsActionCount > 0 && !needsActionLoading && (
          <span className="ml-auto h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
        )}
      </Link>
    </li>
  );
})}
```

**Key details:**
- Badge is a small amber dot (8px / `h-2 w-2`), not a count number -- keeps the sidebar clean.
- Uses `animate-pulse` for a subtle attention-drawing effect. Remove if too distracting.
- Only shown when `needsActionCount > 0` AND `!needsActionLoading` (suppress during initial load to avoid flash).
- The `ml-auto` pushes the dot to the far right of the nav item.
- `useWallet()` is called inside `useNeedsActionCount` (no need to pass wallet from parent).

---

### T6: "Needs Action" Tab in Campaigns List

**File to modify:** `apps/web/src/app/(app)/campaigns/page.tsx`

**Step 1: Extend TabKey type**

Change line 22:
```typescript
// Before:
type TabKey = "all" | "recipient" | "sender";

// After:
type TabKey = "all" | "recipient" | "sender" | "action";
```

**Step 2: Add "Needs Action" tab to TABS array**

Change line 85-89:
```typescript
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "recipient", label: "As Recipient" },
  { key: "sender", label: "As Sender" },
  { key: "action", label: "Needs Action" },
];
```

**Step 3: Compute action count and action rows**

Add after the `tabCounts` computation (around line 387):
```typescript
const actionCount = useMemo(
  () => {
    let n = 0;
    for (const row of rows) {
      // Sender campaigns that are cancelled
      if (row.role === "sender" || row.role === "both") {
        const senderMatch = senderCampaigns.find(c => c.treeAddress === row.treeAddress);
        if (senderMatch?.cancelledAt !== null) {
          n++;
          continue; // don't double-count
        }
      }
      // Recipient campaigns with claimable tokens
      if (row.status === "Claimable") {
        n++;
      }
    }
    return n;
  },
  [rows, senderCampaigns],
);
```

**Step 4: Update tabCounts**

Extend line 380-387:
```typescript
const tabCounts = useMemo(
  () => ({
    all: rows.length,
    recipient: rows.filter((row) => row.role === "recipient" || row.role === "both").length,
    sender: rows.filter((row) => row.role === "sender" || row.role === "both").length,
    action: actionCount,
  }),
  [rows, actionCount],
);
```

**Step 5: Update filter logic**

Extend the `filteredRows` filter (line 361-378):
```typescript
const filteredRows = rows.filter((row) => {
  if (activeTab === "recipient" && row.role === "sender") return false;
  if (activeTab === "sender" && row.role === "recipient") return false;
  if (activeTab === "action") {
    // Sender campaigns that are cancelled
    if (row.role === "sender" || row.role === "both") {
      const senderMatch = senderCampaigns.find(c => c.treeAddress === row.treeAddress);
      if (senderMatch?.cancelledAt !== null) return true;
    }
    // Recipient campaigns with claimable tokens
    if (row.status === "Claimable") return true;
    return false;
  }

  // existing search filter
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return [...].some((value) => value.toLowerCase().includes(q));
});
```

**Step 6: Add badge to tab button**

In the tab rendering (line 450-466), modify the action tab:
```tsx
{TABS.map((tab) => {
  const active = activeTab === tab.key;
  return (
    <button
      key={tab.key}
      type="button"
      onClick={() => setActiveTab(tab.key)}
      className={`rounded-full px-4 py-2 text-[13px] transition ${
        active
          ? "bg-white text-[#0d1117]"
          : "border border-white/[0.08] bg-white/[0.03] text-[#8b92a5]"
      }`}
    >
      {tab.label} ({tabCounts[tab.key]})
      {/* Badge for action tab when not active */}
      {tab.key === "action" && !active && actionCount > 0 && (
        <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500/20 px-1 text-[10px] font-medium text-amber-400">
          {actionCount}
        </span>
      )}
    </button>
  );
})}
```

**Step 7: Custom empty state for action tab**

In the empty state section (line 495-501), add a special message for the action tab:
```tsx
filteredRows.length === 0 ? (
  activeTab === "action" ? (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-8 py-16 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-400">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      </div>
      <h2 className="text-[16px] font-semibold text-white">All caught up</h2>
      <p className="mt-2 text-[13px] text-[#8b92a5]">
        No campaigns need attention right now.
      </p>
    </div>
  ) : (
    <EmptyState
      title="No streams found"
      body="Try a different tab or search term."
      actionHref="/campaign/create"
      actionLabel="Create stream"
    />
  )
) : (
```

**Optional enhancement for action tab rows:** Show grace period status inline for cancelled sender campaigns in the action tab. This requires adding a `cancelledAt` field to `StreamRow` or looking up the sender campaign data from `senderCampaigns` within the row render. The `CampaignRow` component would then display a small amber/red tag next to the status badge.

---

### T7: Dashboard "Needs Attention" Section

**File to modify:** `apps/web/src/app/(app)/dashboard/page.tsx`

This task is co-dependent with the transparency-dashboard-ui spec's T9 (dashboard rewrite). The clawback-specific part can be implemented independently.

**Step 1: Import grace period utilities**

```typescript
import { getGracePeriodState } from "@/lib/vesting/display";
import { GracePeriodCountdown } from "@/components/campaign/detail/GracePeriodCountdown";
```

**Step 2: Compute cancelled sender campaigns**

Add after the existing `counts` computation (around line 143):
```typescript
const cancelledSenderCampaigns = useMemo(
  () => {
    const nowTs = BigInt(Math.floor(Date.now() / 1000));
    return senderCampaigns
      .filter((c) => c.cancelledAt !== null)
      .map((c) => ({
        ...c,
        graceState: getGracePeriodState(BigInt(c.cancelledAt!), nowTs),
      }));
  },
  [senderCampaigns],
);
```

**Step 3: Add "Needs Attention" section to render**

Insert after the "Claimable Banner" (line 182) and before the StatCards (line 184):
```tsx
{/* Needs Attention -- cancelled sender campaigns */}
{cancelledSenderCampaigns.length > 0 && (
  <div>
    <h2 className="mb-3 text-[13px] font-medium uppercase tracking-[0.1em] text-amber-400">
      Needs Attention
    </h2>
    <div className="space-y-3">
      {cancelledSenderCampaigns.map((campaign) => (
        <Link
          key={campaign.treeAddress}
          href={`/campaign/${campaign.treeAddress}`}
          className="flex items-center gap-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4 transition hover:border-amber-500/40"
        >
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-amber-400 truncate">
              {campaign.metadata?.name || `Campaign #${campaign.campaignId}`}
            </p>
            <div className="mt-1 text-[12px] text-amber-300/70">
              {campaign.graceState.status === "grace_active" && (
                <>Grace period: <GracePeriodCountdown cancelledAt={BigInt(campaign.cancelledAt!)} /></>
              )}
              {campaign.graceState.status === "grace_expired" && (
                <>Grace period expired -- withdraw unvested tokens</>
              )}
            </div>
          </div>
          <div className="shrink-0">
            {campaign.graceState.status === "grace_active" && (
              <span className="text-[12px] text-[#8b92a5]">View</span>
            )}
            {campaign.graceState.status === "grace_expired" && (
              <span className="rounded-lg bg-red-600 px-3 py-1.5 text-[12px] font-medium text-white">
                Withdraw
              </span>
            )}
          </div>
        </Link>
      ))}
    </div>
  </div>
)}
```

**Note:** This section reuses `GracePeriodCountdown` from T1. The dashboard renders one countdown per cancelled campaign, each with its own 60-second interval. For wallets with many cancelled campaigns (unlikely in practice), this is still lightweight since each interval is a trivial `BigInt` comparison.

---

## Conditional Rendering Tables

### CampaignStatusBanner -- What Each User Sees

| Campaign State | Creator | Non-Creator | Banner Color | Content |
|---------------|---------|-------------|-------------|---------|
| Active, funded | Nothing | Nothing | -- | `null` |
| Paused | Nothing | Nothing | -- | `null` |
| Cancelled, grace active (4d remaining) | Amber banner with countdown | Nothing | Amber | "Campaign cancelled on {date}. Grace period: 4d Xh Xm remaining. Recipients can still claim vested tokens." |
| Cancelled, grace active (<24h remaining) | Amber banner with red countdown | Nothing | Amber (red text) | "Campaign cancelled on {date}. Grace period: 23h Xm remaining (red). Recipients can still claim vested tokens." |
| Cancelled, grace expired, not withdrawn | Red banner with withdraw button | Nothing | Red | "Grace period has expired. You can now withdraw your unvested tokens." + [Withdraw Unvested Tokens] button |
| Cancelled, grace expired, withdrawn | Green banner | Nothing | Green | "Campaign settled. Unvested tokens have been withdrawn to your wallet." |
| Instant refunded | Green banner | Nothing | Green | "Campaign refunded before vesting started. All tokens returned to your wallet." |
| Created, not funded | Amber banner with funding button | Nothing | Amber | "Campaign created but not yet funded." + [Resume Funding] button |
| Claimed (all tokens claimed) | Nothing | Nothing | -- | `null` |

### GracePeriodCountdown -- Color and Text by State

| Remaining Time | Text Color | Display |
|---------------|-----------|---------|
| > 24 hours | `text-amber-400` | "5d 14h 32m remaining" |
| < 24 hours | `text-red-400` | "23h 45m remaining" |
| Expired | `text-red-400` | "Grace period expired" |
| Not cancelled | -- | `null` |

### "Needs Action" Tab -- What Appears

| Row Source | Condition | Why It Needs Action |
|-----------|-----------|-------------------|
| Sender campaign | `cancelledAt !== null` | Creator may need to withdraw unvested tokens (if grace expired) or monitor grace countdown |
| Recipient campaign | `status === "Claimable"` | Recipient has tokens ready to claim |

### Sidebar Badge -- When It Shows

| Condition | Badge Visible |
|-----------|--------------|
| Has cancelled sender campaigns OR claimable recipient campaigns | Amber dot on "My Campaigns" |
| No action needed | No badge |
| Loading (initial fetch) | No badge (suppressed to avoid flash) |

---

## Integration Data Flow

```
  Smart Contract (on-chain)
         |
         v
  Campaign Detail Page
    (treeState.cancelledAt,
     treeState.instantRefunded,
     treeState.totalSupply,
     treeState.totalClaimed)
         |
         +--- CampaignStatusBanner (reads cancelledAt, isCreator, nowTs)
         |       |
         |       +--- GracePeriodCountdown (reads cancelledAt, manages own interval)
         |
         +--- WithdrawUnvestedButton (in Actions sidebar, triggered by banner scroll-to)
         |
         v
  Campaigns List Page
    (rows computed from useCampaignList + useBeneficiaryCampaigns)
         |
         +--- "Needs Action" tab (filters rows by cancelledAt and Claimable status)
         |
         v
  Sidebar
    (uses useNeedsActionCount hook)
         |
         +--- Amber dot badge (count > 0)
         |
         v
  Dashboard
    (uses useCampaignList, filters cancelled sender campaigns)
         |
         +--- "Needs Attention" section (grace countdown per campaign)
```

**No new API endpoints needed.** All data flows from existing hooks (`useCampaignList`, `useBeneficiaryCampaigns`) and on-chain state (via the campaign detail page's `fetchTree`). Grace period computation is entirely client-side using `getGracePeriodState()`.

---

## Verification Steps

### Build Verification
```bash
cd apps/web && pnpm build
```
Must pass with zero errors. All TypeScript strict mode checks must pass.

### Manual Verification (per task)

**T1 -- GracePeriodCountdown:**
1. Create a test component that renders `<GracePeriodCountdown cancelledAt={BigInt(Math.floor(Date.now() / 1000) - 3 * 86400)} />`
2. Verify amber text showing approximately "4d Xh Xm remaining"
3. Wait 60 seconds, verify countdown ticks
4. Create another with `cancelledAt` 7 days + 1 hour ago -- verify red "Grace period expired"

**T2 -- CampaignStatusBanner:**
1. Render with `isCreator=true, cancelledAtBigint=BigInt(now - 2 days), isInstantRefunded=false, isFunded=true` -- amber banner with countdown
2. Render with `isCreator=true, cancelledAtBigint=BigInt(now - 8 days), unvestedAmount=1000000n` -- red banner with withdraw button
3. Render with `isCreator=true, cancelledAtBigint=BigInt(now - 8 days), unvestedAmount=0n` -- green "settled" banner
4. Render with `isCreator=true, isInstantRefunded=true` -- green "refunded" banner
5. Render with `isCreator=true, isFunded=false, cancelledAtBigint=null` -- amber funding banner
6. Render with `isCreator=false, cancelledAtBigint=BigInt(now - 2 days)` -- `null` (nothing rendered)

**T3 -- Detail Page Integration:**
1. Cancel a campaign via CancelConfirmDialog
2. Verify amber grace banner appears at the top of the page (above the metrics grid)
3. Verify the inline instant-refunded and funding-incomplete cards in the Actions sidebar are GONE
4. Click the "Withdraw Unvested Tokens" button in the banner -- verify it scrolls to the Actions sidebar
5. After grace expires, verify the banner turns red with the withdraw CTA
6. Withdraw tokens -- verify the banner turns green ("settled")
7. Visit as a non-creator -- verify no banners appear
8. Create a new campaign and visit before funding -- verify the funding banner appears

**T4 -- useNeedsActionCount:**
1. With a wallet that has cancelled campaigns, verify `count > 0`
2. With a wallet that has claimable recipient tokens, verify count includes those
3. With no wallet, verify `isLoading: true, count: 0`

**T5 -- Sidebar Badge:**
1. With cancelled campaigns, verify amber dot appears next to "My Campaigns"
2. Without cancelled or claimable campaigns, verify no dot
3. Verify dot disappears briefly during data refresh (no stale flash)

**T6 -- "Needs Action" Tab:**
1. Cancel a campaign, then visit the campaigns list
2. Verify "Needs Action" tab appears with count badge (e.g., "Needs Action (3)")
3. Click the tab -- verify only cancelled sender and claimable recipient campaigns appear
4. Click "All" tab -- verify all campaigns appear
5. Clear all actions (withdraw tokens, claim tokens) -- verify empty state shows "All caught up"

**T7 -- Dashboard "Needs Attention":**
1. Cancel a campaign, then visit the dashboard
2. Verify "Needs Attention" section appears with the cancelled campaign
3. Verify grace period countdown shows in the campaign row
4. Click the campaign row -- navigates to campaign detail page
5. After grace expires, verify "Withdraw" button appears in the dashboard row

### Responsive Verification
- All banners render correctly at 375px (mobile) width
- Tabs wrap properly on narrow viewports
- Sidebar badge is visible on all viewport sizes
- Dashboard "Needs Attention" section stacks correctly on mobile

### Regression Verification
- All existing campaign detail page functionality still works (claim, cancel, pause, milestone, root rotation)
- Campaigns list "All", "Recipient", "Sender" tabs still filter correctly
- Dashboard stats are still accurate
- Sidebar navigation still works

---

## Non-Goals and Boundaries

1. **No smart contract changes.** All SC instructions (`cancel_campaign`, `cancel_stream`, `withdraw_unvested`, `instant_refund_campaign`) are complete and tested.

2. **No new API endpoints.** All data comes from existing `useCampaignList`, `useBeneficiaryCampaigns`, and on-chain state.

3. **No automatic execution.** Cancel and withdraw remain manual wallet-signed actions. No server-side auto-sweep, no cron job for grace period expiry.

4. **No email/push notifications.** In-app only. External notification channels are deferred.

5. **No campaign detail page growth.** New components are extracted to separate files. The banner integration adds ~10 lines to the detail page while removing ~35 lines of inline cards.

6. **The `WithdrawUnvestedButton` and `CancelConfirmDialog` components are NOT modified.** They work as-is. The banner provides additional entry points (scroll-to, visibility) but delegates to existing flows.

7. **Grace countdown precision is 60-second intervals, not 1-second.** The countdown shows days, hours, and minutes. There is no need for second-level precision for a 7-day period.

---

## File Summary

### New Files (3)

| File | Lines (est.) | Purpose |
|------|-------------|---------|
| `apps/web/src/components/campaign/detail/GracePeriodCountdown.tsx` | ~35 | Reusable live countdown for grace period |
| `apps/web/src/components/campaign/detail/CampaignStatusBanner.tsx` | ~100 | Status-driven banner for campaign detail page |
| `apps/web/src/hooks/useNeedsActionCount.ts` | ~50 | Sidebar badge hook for action-needed campaigns |

### Modified Files (4)

| File | Change | Lines Added/Removed |
|------|--------|---------------------|
| `apps/web/src/app/(app)/campaign/[id]/page.tsx` | Import banner, render between header and grid, remove 2 inline cards, add `id="campaign-actions"`, add `isCreator` and `isWithdrawn` derivations | +10 / -35 |
| `apps/web/src/app/(app)/campaigns/page.tsx` | Add "action" to TabKey, add action tab with badge, update filter logic, add action-specific empty state | +40 |
| `apps/web/src/components/shell/Sidebar.tsx` | Import hook, add amber dot badge to "My Campaigns" nav item | +8 |
| `apps/web/src/app/(app)/dashboard/page.tsx` | Add "Needs Attention" section with cancelled campaign rows and grace countdowns | +40 |

### Files That Must NOT Be Modified

| File | Reason |
|------|--------|
| `apps/web/src/components/campaign/detail/CancelConfirmDialog.tsx` | Complete, tested |
| `apps/web/src/components/campaign/detail/WithdrawUnvestedButton.tsx` | Complete, tested |
| `apps/web/src/lib/vesting/display.ts` | Reused as-is |
| `apps/web/src/lib/campaign/authority.ts` | Reused as-is |
| `apps/web/src/lib/vesting/list.ts` | Reused as-is |
| `apps/web/src/hooks/useCampaignList.ts` | Reused as-is |
| `apps/web/src/hooks/useBeneficiaryCampaigns.ts` | Reused as-is |

### Existing Files Referenced for Patterns

| File | What Pattern to Follow |
|------|----------------------|
| `apps/web/src/components/campaign/list/StatusBadge.tsx` | Badge color styling: `border-{color}/20 bg-{color}/10 text-{color}` |
| `apps/web/src/app/(app)/dashboard/page.tsx` | `StatCard` and `ActionCard` component patterns, dark theme card styling |
| `apps/web/src/hooks/useCampaignList.ts` | TanStack Query hook pattern: query key, staleTime, enabled |
