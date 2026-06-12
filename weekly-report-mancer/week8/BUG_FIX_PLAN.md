# Week 8 Bug Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Week 8 demo bugs across cliff, linear, milestone, stream, campaign CSV, cancel, allocation, and token amount display flows.

**Architecture:** Fix state interpretation first, then vesting math and claimability, then CSV/allocation input paths, then UI polish. The main rule is: indexed DB/API state must expose explicit lifecycle flags, FE must not infer grace period from `cancelledAt` alone, and all amount display must use mint decimals or clearly show mixed-token aggregate state.

**Tech Stack:** Next.js 15, React 19, TanStack Query, Drizzle/Postgres, Vitest, Playwright, Anchor/Solana vesting program.

---

## Current Bug Map

| Priority | Area | Reported bug | Owner | Primary files |
|----------|------|--------------|-------|---------------|
| P0 | Linear cancel claim | After linear stream is cancelled during vesting, recipient cannot withdraw already vested tokens because the beneficiary view has no withdraw button | Geral FE first, Lana SC/API verify | `apps/web/src/app/(app)/campaign/[id]/page.tsx`, `apps/web/src/app/api/beneficiary/[address]/vesting-progress/route.ts`, `programs/vesting/src/instructions/withdraw.rs` |
| P0 | Linear math | Allocation `1` and `0.5` vest at different visible speeds even when vesting end time has passed | Lana SC/API verify, Geral FE display | `apps/web/src/app/api/beneficiary/[address]/vesting-progress/route.ts`, `apps/web/src/lib/vesting/schedule.ts`, `programs/vesting/src/math/schedule.rs` |
| P0 | Cancel settled state | Cancel settle/instant refund still appears as grace period or Needs Action in campaign list/dashboard | Geral FE/API | `apps/web/src/lib/vesting/list.ts`, `apps/web/src/app/(app)/dashboard/page.tsx`, `apps/web/src/app/(app)/campaigns/page.tsx`, `apps/web/src/app/api/campaigns/route.ts` |
| P1 | Cancel grace recipient notice | Grace-period cancel does not show recipient notification/action | Geral FE/API | `apps/web/src/app/(app)/dashboard/page.tsx`, `apps/web/src/app/(app)/portfolio/page.tsx`, `apps/web/src/components/campaign/CampaignCard.tsx` |
| P1 | Fully vested actions | Creator can still cancel/pause after all tokens are vested | Lana SC/API, Geral FE guard | `programs/vesting/src/instructions/cancel_campaign.rs`, `programs/vesting/src/instructions/pause_campaign.rs`, `apps/web/src/app/(app)/campaign/[id]/page.tsx` |
| P1 | CSV parse/validate | Campaign bulk CSV parse and validation still fails for supported input | Geral FE/API | `apps/web/src/lib/campaign/bulk.ts`, `apps/web/src/app/api/campaigns/import/route.ts`, `apps/web/src/components/campaign/create/BulkCsvSection.tsx` |
| P1 | Root allocation | Allocation/root rotation flow is buggy and product flow is unclear | Geral FE, Lana API/SC verify | `apps/web/src/app/(app)/campaign/[id]/allocations/page.tsx`, `apps/web/src/components/campaign/detail/AllocationEditor.tsx`, `apps/web/src/hooks/useUpdateRoot.ts` |
| P2 | Raw amounts | Dashboard/portfolio/notifications show raw token amount for non-native tokens | Geral FE | `apps/web/src/app/(app)/dashboard/page.tsx`, `apps/web/src/app/(app)/portfolio/page.tsx`, `apps/web/src/hooks/useVestingProgress.ts`, `apps/web/src/lib/vesting/display.ts` |
| P2 | Mobile campaign list | Campaign list tabs should become dropdown on mobile | Geral FE | `apps/web/src/app/(app)/campaigns/page.tsx`, `apps/web/tests/e2e/my-campaigns.spec.ts` |

## Lifecycle Decision

Use these display states consistently:

| Backend facts | Sender UI | Recipient UI | Dashboard Needs Action |
|---------------|-----------|--------------|------------------------|
| `cancelledAt = null`, `paused = false` | Active | Active/Scheduled/Claimable | No |
| `paused = true`, `cancelledAt = null` | Paused | Paused | No |
| `cancelledAt != null`, `instantRefunded = true` | Instantly Refunded | Cancelled, no claim action | No |
| `cancelledAt != null`, `streamSettled = true` | Settled | Settled/Claimed | No |
| `cancelledAt != null`, not instant, not settled, grace active | Grace Period | Claim vested before expiry if `claimable > 0` | Sender and recipient both see action |
| `cancelledAt != null`, not instant, not settled, grace expired | Ready to Withdraw Unvested | Cancelled, no future claim | Sender only |
| fully vested and not cancelled | Vested | Claimable/Claimed | Creator cannot pause/cancel |

Implementation note: do not use `cancelledAt != null` by itself to show grace period. Always also check `instantRefunded` and `streamSettled`.

---

## Task 1: Lock Cancel/Grace/Settled State Model

**Files:**
- Modify: `apps/web/src/lib/vesting/list.ts`
- Modify: `apps/web/src/app/api/campaigns/route.ts`
- Modify: `apps/web/src/app/api/beneficiary/[address]/campaigns/route.ts`
- Modify: `apps/web/src/app/api/beneficiary/[address]/vesting-progress/route.ts`
- Test: `apps/web/tests/api/vesting-progress.test.ts`
- Test: `apps/web/tests/components/CampaignStatusBanner.test.ts`

- [ ] **Step 1: Add explicit lifecycle helpers**

Create a helper in `apps/web/src/lib/vesting/list.ts`:

```ts
export type CampaignLifecycle =
  | "active"
  | "paused"
  | "claimable"
  | "claimed"
  | "cancelled_grace"
  | "cancelled_expired"
  | "instant_refunded"
  | "settled";

export function isGracePeriodVisible(input: {
  cancelledAt: number | string | null;
  instantRefunded?: boolean;
  streamSettled?: boolean;
}): boolean {
  return input.cancelledAt !== null && !input.instantRefunded && !input.streamSettled;
}
```

- [ ] **Step 2: Update sender status mapping**

Change `getSenderStreamStatus()` so the order is:

```ts
if (stream.cancelledAt !== null && stream.streamSettled) return "Settled";
if (stream.cancelledAt !== null && "instantRefunded" in stream && stream.instantRefunded) return "Settled";
if (stream.cancelledAt !== null) return "Cancelled";
if (stream.paused) return "Paused";
if (totalSupply > 0n && totalClaimed >= totalSupply) return "Claimed";
return "Active";
```

If TypeScript complains, add `instantRefunded?: boolean` to `SenderStream`.

- [ ] **Step 3: Include lifecycle flags in beneficiary APIs**

`apps/web/src/app/api/beneficiary/[address]/campaigns/route.ts` and `vesting-progress/route.ts` must select:

```sql
c.instant_refunded,
EXISTS (
  SELECT 1 FROM stream_cancel_events sce
  WHERE sce.campaign_id = c.id
) AS stream_settled
```

Return `instantRefunded` and `streamSettled` in JSON. This lets recipient UI distinguish settled/instant refund from grace-period cancel.

- [ ] **Step 4: Add failing tests first**

Add API tests:

```ts
it("does not mark instant refunded campaign as recipient grace action", async () => {
  // Seed cancelled_at and instant_refunded = true.
  // GET /api/beneficiary/:address/vesting-progress should return:
  // cancelledAt != null, instantRefunded = true, streamSettled = false, claimable = "0".
});

it("does not mark stream-settled campaign as grace action", async () => {
  // Seed cancelled_at and one stream_cancel_events row.
  // GET /api/beneficiary/:address/vesting-progress should return:
  // cancelledAt != null, streamSettled = true.
});
```

- [ ] **Step 5: Run targeted tests**

Run:

```bash
rtk pnpm --dir apps/web test -- apps/web/tests/api/vesting-progress.test.ts apps/web/tests/components/CampaignStatusBanner.test.ts
```

Expected: tests pass after lifecycle fields are wired.

---

## Task 2: Fix Dashboard and Campaign List Needs Action

**Files:**
- Modify: `apps/web/src/app/(app)/dashboard/page.tsx`
- Modify: `apps/web/src/app/(app)/campaigns/page.tsx`
- Modify: `apps/web/src/components/campaign/list/StatusBadge.tsx`
- Test: `apps/web/tests/e2e/dashboard.spec.ts`
- Test: `apps/web/tests/e2e/my-campaigns.spec.ts`

- [ ] **Step 1: Replace raw cancel filter**

In dashboard `needsAttention`, keep only campaigns where:

```ts
isGracePeriodVisible({
  cancelledAt: c.cancelledAt,
  instantRefunded: c.instantRefunded,
  streamSettled: c.streamSettled,
})
```

- [ ] **Step 2: Split sender vs recipient copy**

Sender card copy:

```text
Grace period active
Recipients can still claim vested tokens before expiry.
```

Recipient card copy:

```text
Claim before grace period ends
This campaign was cancelled, but vested tokens are still withdrawable during grace period.
```

- [ ] **Step 3: Campaign list status acceptance**

Campaign list must show:

```text
Settled
```

for stream settle or instant refund, and must not show countdown.

- [ ] **Step 4: Add E2E coverage**

Add tests:

```ts
test("settled campaign is not shown in Needs Attention", async ({ page }) => {
  // Mock /api/campaigns with cancelledAt + streamSettled true.
  // Expect Needs Attention section not to contain that campaign.
});

test("instant refund campaign is not shown as grace period", async ({ page }) => {
  // Mock /api/campaigns with cancelledAt + instantRefunded true.
  // Expect no GracePeriodCountdown for that campaign.
});
```

- [ ] **Step 5: Run verification**

Run:

```bash
rtk pnpm --dir apps/web test:e2e -- dashboard.spec.ts my-campaigns.spec.ts
```

Expected: no settled/instant-refund campaign appears in grace-period UI.

---

## Task 3: Fix Linear Cancel Recipient Withdraw Button

**Files:**
- Modify: `apps/web/src/app/(app)/campaign/[id]/page.tsx`
- Modify: `apps/web/src/components/campaign/CampaignCard.tsx`
- Modify: `apps/web/src/app/api/beneficiary/[address]/vesting-progress/route.ts`
- Test: `apps/web/tests/api/vesting-progress.test.ts`
- Test: `apps/web/tests/e2e/campaign-actions.spec.ts`

- [ ] **Step 1: API must keep cancelled vested amount claimable**

For cancelled linear schedules:

```ts
const vestedSoFar = getVestedAmount(schedule, cancelledAt, now);
const claimable = milestoneReleased && vestedSoFar > claimedSoFar
  ? vestedSoFar - claimedSoFar
  : 0n;
```

Acceptance: if `cancelledAt` is between `cliffTime` and `endTime`, `claimable` remains positive until claimed.

- [ ] **Step 2: FE must not hide claim action because `cancelledAt` exists**

In campaign detail, the Claim/Withdraw button should be visible for recipient when:

```ts
claimable > 0n && publicKey?.toBase58() === beneficiaryKey
```

even if `cancelledAtBigint !== null`, unless `instantRefunded === true`.

- [ ] **Step 3: Button label for cancelled claim**

Use:

```text
Claim Vested
```

when campaign is cancelled and `claimable > 0n`.

- [ ] **Step 4: Add tests**

API test:

```ts
it("cancelled linear campaign remains claimable for vested unclaimed amount", async () => {
  // amount 1_000_000, start=1000, cliff=1000, end=2000, cancelledAt=1500.
  // claimed=0.
  // Expect vestedSoFar="500000", claimable="500000".
});
```

E2E test:

```ts
test("recipient can see Claim Vested after linear campaign is cancelled mid-vesting", async ({ page }) => {
  // Mock campaign detail/vesting-progress as cancelledAt mid-stream with claimable > 0.
  // Expect button name /claim vested/i visible and enabled.
});
```

- [ ] **Step 5: Run verification**

Run:

```bash
rtk pnpm --dir apps/web test -- apps/web/tests/api/vesting-progress.test.ts
rtk pnpm --dir apps/web test:e2e -- campaign-actions.spec.ts
```

Expected: cancelled linear recipient can still claim vested amount.

---

## Task 4: Fix Linear Allocation Vesting Math

**Files:**
- Review: `programs/vesting/src/math/schedule.rs`
- Review: `programs/vesting/src/instructions/claim.rs`
- Modify: `apps/web/src/lib/vesting/schedule.ts`
- Modify: `apps/web/src/app/api/beneficiary/[address]/vesting-progress/route.ts`
- Test: `apps/web/tests/api/vesting-progress.test.ts`
- Test: `programs/vesting/tests/claim.rs` or existing closest claim test file

- [ ] **Step 1: Reproduce with deterministic numbers**

Use two linear leaves with same `startTime`, `cliffTime`, `endTime`, but amounts:

```text
leaf A amount = 1000000000
leaf B amount = 500000000
now > endTime
```

Expected for both:

```text
vestedSoFar == amount
claimable == amount - claimed
progressPercent == 100
```

- [ ] **Step 2: Add API regression test**

Add:

```ts
it("fully vested linear leaves reach 100 percent regardless of allocation size", async () => {
  // Seed two beneficiaries: amount 1_000_000_000 and 500_000_000.
  // Same start/cliff/end in the past.
  // Expect each progress.vestedSoFar equals its leaf amount.
});
```

- [ ] **Step 3: Add program-level check if missing**

Add or extend Rust test:

```rust
#[test]
fn linear_fully_vested_returns_full_amount_for_different_allocations() {
    // amount_a = 1_000_000_000, amount_b = 500_000_000
    // now >= end_time
    // assert vested_a == amount_a
    // assert vested_b == amount_b
}
```

- [ ] **Step 4: Fix only the layer that fails**

If Rust passes but API/FE fails, fix TS/API display math. If Rust fails, fix `programs/vesting/src/math/schedule.rs` before UI.

- [ ] **Step 5: Run verification**

Run:

```bash
rtk pnpm --dir apps/web test -- apps/web/tests/api/vesting-progress.test.ts
rtk cargo test -p vesting --lib
```

Expected: both allocation sizes are fully claimable after end time.

---

## Task 5: Block Cancel/Pause When Campaign Is Fully Vested

**Files:**
- Modify: `programs/vesting/src/instructions/cancel_campaign.rs`
- Modify: `programs/vesting/src/instructions/pause_campaign.rs`
- Modify: `programs/vesting/src/errors.rs`
- Modify: `apps/web/src/app/(app)/campaign/[id]/page.tsx`
- Modify: `apps/web/src/components/campaign/detail/CampaignStatusBanner.tsx`
- Test: `programs/vesting/tests/lifecycle.rs` or closest existing lifecycle test
- Test: `apps/web/tests/e2e/campaign-actions.spec.ts`

- [ ] **Step 1: Confirm on-chain rule**

Rule:

```text
If all leaves are already vested by current clock, creator must not pause or cancel.
```

For campaign-level Merkle distribution, the program may not know every leaf schedule during cancel. If the program only stores `min_cliff_time` and root-level fields, enforce the strongest available on-chain rule and add API/FE guard for indexed leaves.

- [ ] **Step 2: API/FE guard**

Compute:

```ts
const fullyVested = totalSupply > 0n && vestedTotal >= totalSupply;
```

Disable:

```text
Cancel Campaign
Pause Campaign
```

with reason:

```text
All tokens are already vested.
```

- [ ] **Step 3: Program guard if feasible**

If program has enough state for a root-level fully-vested check, add error:

```rust
#[msg("Campaign is fully vested")]
CampaignFullyVested,
```

and reject cancel/pause.

- [ ] **Step 4: Add tests**

E2E:

```ts
test("creator cannot cancel or pause fully vested campaign", async ({ page }) => {
  // Mock campaign where totalSupply == vested total and now > endTime.
  // Expect cancel and pause buttons disabled or absent.
});
```

Rust/API:

```rust
// fully vested schedule -> cancel/pause returns CampaignFullyVested
```

- [ ] **Step 5: Run verification**

Run:

```bash
rtk pnpm --dir apps/web test:e2e -- campaign-actions.spec.ts
rtk cargo test -p vesting --lib
```

Expected: creator cannot trigger cancel/pause after all tokens vested.

---

## Task 6: Make Cancel Grace Notifications Correct for Sender and Recipient

**Files:**
- Modify: `apps/web/src/app/(app)/dashboard/page.tsx`
- Modify: `apps/web/src/app/(app)/portfolio/page.tsx`
- Modify: `apps/web/src/components/campaign/CampaignCard.tsx`
- Modify: `apps/web/src/components/campaign/detail/CampaignStatusBanner.tsx`
- Test: `apps/web/tests/e2e/dashboard.spec.ts`
- Test: `apps/web/tests/e2e/campaign-detail.spec.ts`

- [ ] **Step 1: Product decision**

Show grace-period notification to:

```text
Sender: yes, because sender needs to wait until grace expires before withdrawing unvested funds.
Recipient: yes, only when claimable vested amount > 0.
Sender+recipient same wallet: show one combined action, not duplicate cards.
```

- [ ] **Step 2: Dashboard sender action**

Sender sees Needs Attention while grace active:

```text
Grace period active
Recipients can claim vested tokens until expiry.
```

When grace expired:

```text
Withdraw unvested funds
Grace period expired.
```

- [ ] **Step 3: Portfolio recipient action**

Recipient card status:

```text
Claimable
```

if `cancelledAt != null` and `claimable > 0`.

Recipient card next unlock:

```text
Grace period active
```

instead of "Fully vested" for cancelled-but-claimable rows.

- [ ] **Step 4: Run verification**

Run:

```bash
rtk pnpm --dir apps/web test:e2e -- dashboard.spec.ts campaign-detail.spec.ts
```

Expected: grace-period action appears for the correct role only.

---

## Task 7: Fix CSV Parse and Validation

**Files:**
- Modify: `apps/web/src/lib/campaign/bulk.ts`
- Modify: `apps/web/src/app/api/campaigns/import/route.ts`
- Modify: `apps/web/src/components/campaign/create/BulkCsvSection.tsx`
- Test: `apps/web/tests/api/bulk-campaign.test.ts`
- Test: `apps/web/tests/e2e/csv-validation.spec.ts`
- Test: `apps/web/tests/e2e/csv-template-create.spec.ts`

- [ ] **Step 1: Share parser rules**

Current FE parser handles quoted CSV. Import API uses `line.split(",")`. Replace API parser with the same quoted CSV behavior or move parser to shared server-safe utility:

```text
apps/web/src/lib/campaign/csv.ts
```

Exports:

```ts
parseCsvRows(text: string): string[][]
normalizeCsvHeader(value: string): string
```

- [ ] **Step 2: Header aliases**

Accept these headers:

```text
beneficiary, recipient, wallet
amount
releaseType, release_type, type
startTime, start_time, start
cliffTime, cliff_time, cliff, unlockTime
endTime, end_time, end
milestoneIdx, milestone_idx, milestone
```

- [ ] **Step 3: Validate by page type**

Cliff page accepts only cliff rows. Linear page accepts only linear rows. Milestone page accepts only milestone rows.

Keep duplicate rule:

```text
Cliff/linear: one row per beneficiary.
Milestone: same beneficiary allowed, but each milestoneIdx must be unique.
```

- [ ] **Step 4: Add tests**

API import tests:

```ts
it("parses quoted CSV values without shifting columns", async () => {});
it("accepts recipient header alias", async () => {});
it("rejects linear row submitted on cliff CSV UI", async () => {});
```

E2E tests:

```ts
test("bulk cliff CSV validates aliases and renders preview", async ({ page }) => {});
test("bulk CSV duplicate beneficiary shows inline row error", async ({ page }) => {});
```

- [ ] **Step 5: Run verification**

Run:

```bash
rtk pnpm --dir apps/web test -- apps/web/tests/api/bulk-campaign.test.ts
rtk pnpm --dir apps/web test:e2e -- csv-validation.spec.ts csv-template-create.spec.ts
```

Expected: CSV parse and validate works for campaign create and bulk import.

---

## Task 8: Stabilize Root Allocation Flow

**Files:**
- Modify: `apps/web/src/app/(app)/campaign/[id]/allocations/page.tsx`
- Modify: `apps/web/src/components/campaign/detail/AllocationEditor.tsx`
- Modify: `apps/web/src/hooks/useUpdateRoot.ts`
- Modify: `apps/web/src/app/api/campaigns/[treeAddress]/root-versions/route.ts`
- Test: `apps/web/tests/e2e/allocations.spec.ts`
- Test: `apps/web/tests/api/bulk-campaign.test.ts`

- [ ] **Step 1: Product flow decision**

Root allocation is only for:

```text
Uncancelled, cancellable campaign where connected wallet is cancelAuthority.
```

Do not allow allocation edit when:

```text
paused
cancelled
instant refunded
settled
fully vested
```

- [ ] **Step 2: Preserve claim safety**

When rebuilding allocation root:

```text
Existing beneficiaries who already claimed cannot be reduced below claimed amount.
Existing claim record totals must remain valid.
```

If this cannot be guaranteed from indexed data, block root allocation after any claim event exists.

- [ ] **Step 3: Fix amount conversion**

Avoid `Number(amount) * 10 ** decimals` for token amounts. Use a decimal-safe parser:

```ts
toRawAmount(r.amount, decimals)
```

from `apps/web/src/lib/campaign/bulk.ts`, or move it to a shared amount utility.

- [ ] **Step 4: Add UX states**

Editor header must show one clear state:

```text
Editable
Locked: campaign cancelled
Locked: claims already exist
Locked: all tokens vested
Locked: wallet is not cancel authority
```

- [ ] **Step 5: Add tests**

E2E:

```ts
test("allocation editor is locked after campaign has claims", async ({ page }) => {});
test("allocation editor converts 0.5 token using mint decimals exactly", async ({ page }) => {});
```

- [ ] **Step 6: Run verification**

Run:

```bash
rtk pnpm --dir apps/web test:e2e -- allocations.spec.ts
rtk pnpm --dir apps/web test -- apps/web/tests/api/bulk-campaign.test.ts
```

Expected: allocation update path is predictable and cannot corrupt existing claims.

---

## Task 9: Fix Raw Amount Display Across Dashboard and Portfolio

**Files:**
- Modify: `apps/web/src/lib/vesting/display.ts`
- Modify: `apps/web/src/hooks/useVestingProgress.ts`
- Modify: `apps/web/src/app/(app)/dashboard/page.tsx`
- Modify: `apps/web/src/app/(app)/portfolio/page.tsx`
- Modify: `apps/web/src/components/campaign/CampaignCard.tsx`
- Test: `apps/web/tests/api/vesting-progress.test.ts`
- Test: `apps/web/tests/e2e/dashboard.spec.ts`

- [ ] **Step 1: Per-campaign amounts**

Every per-campaign amount must call:

```ts
formatTokenAmount(raw, decimalsMap.get(campaign.mint) ?? null)
```

Affected labels:

```text
Stream ready
Claimable now
Total entitled
Total vested
Total claimed
Claimable now
Portfolio cards: entitled, vested, claimed, claimable
```

- [ ] **Step 2: Mixed-token aggregate rule**

If a stat aggregates multiple mints with different decimals, do not show a fake normalized total. Use:

```text
Mixed tokens
```

as value and show:

```text
Open portfolio for per-token amounts
```

as subtext.

- [ ] **Step 3: Add test data**

Use one SOL-like mint with 9 decimals and one SPL-like mint with 6 decimals.

Expected:

```text
1_000_000 raw with decimals 6 -> 1
1_000_000_000 raw with decimals 9 -> 1
```

- [ ] **Step 4: Run verification**

Run:

```bash
rtk pnpm --dir apps/web test:e2e -- dashboard.spec.ts
rtk pnpm --dir apps/web test -- apps/web/tests/api/vesting-progress.test.ts
```

Expected: no dashboard/portfolio stat displays raw units unless explicitly marked as mixed-token raw units.

---

## Task 10: Mobile Campaign List Dropdown

**Files:**
- Modify: `apps/web/src/app/(app)/campaigns/page.tsx`
- Test: `apps/web/tests/e2e/my-campaigns.spec.ts`
- Test: `apps/web/tests/e2e/responsive.spec.ts`

- [ ] **Step 1: Keep desktop tabs**

Desktop `sm` and above:

```text
All | As Recipient | As Sender | Needs Action
```

- [ ] **Step 2: Add mobile select**

Below `sm`, render a native select:

```text
View: All streams
View: As recipient
View: As sender
View: Needs action
```

Hide tab button row with `hidden sm:flex`; hide select with `sm:hidden`.

- [ ] **Step 3: Add responsive test**

```ts
test("campaign filters use dropdown on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  // Expect select visible and tab buttons hidden.
});
```

- [ ] **Step 4: Run verification**

Run:

```bash
rtk pnpm --dir apps/web test:e2e -- my-campaigns.spec.ts responsive.spec.ts
```

Expected: campaign filters are usable on mobile without wrapping/overflow.

---

## Execution Order

1. P0 state model: Task 1 -> Task 2.
2. P0 claimability/math: Task 3 -> Task 4.
3. P1 fully vested and grace UX: Task 5 -> Task 6.
4. P1 data entry/root allocation: Task 7 -> Task 8.
5. P2 UI correctness: Task 9 -> Task 10.
6. Full regression pass.

## Full Regression Commands

Run after all tasks:

```bash
rtk pnpm --dir apps/web test -- apps/web/tests/api/vesting-progress.test.ts apps/web/tests/api/bulk-campaign.test.ts apps/web/tests/components/CampaignStatusBanner.test.ts
rtk pnpm --dir apps/web test:e2e -- campaign-actions.spec.ts campaign-detail.spec.ts dashboard.spec.ts my-campaigns.spec.ts allocations.spec.ts csv-validation.spec.ts responsive.spec.ts
rtk pnpm --dir apps/web build
rtk cargo test -p vesting --lib
```

Expected:

```text
API/unit tests pass.
Targeted Playwright specs pass.
Next.js build passes with 0 TypeScript errors.
Rust vesting lib tests pass.
```

## Manual Demo Checklist

- [ ] Cliff stream create -> claim -> cancel settle: campaign list shows Settled, no grace countdown.
- [ ] Cliff campaign CSV create: parser accepts template and rejects duplicate cliff beneficiary.
- [ ] Cliff grace cancel: sender sees grace countdown; recipient sees claim action only when vested claimable amount exists.
- [ ] Linear stream cancel mid-vesting: recipient can claim vested amount after cancel.
- [ ] Linear different allocations: `1` and `0.5` both show 100 percent vested after end time.
- [ ] Linear instant refund: not shown in Needs Action or grace-period UI.
- [ ] Milestone create/claim/cancel/pause still works.
- [ ] Fully vested campaign: creator cannot pause or cancel.
- [ ] Portfolio/dashboard amounts show human token units for SOL and SPL.
- [ ] Campaign list mobile filter uses dropdown at 375px.

## Open Product Questions To Close Before Implementation

1. Root allocation policy: allow after claims with claimed-amount floor, or lock after first claim event. Recommended: lock after first claim event for Week 8 stability.
2. Fully vested campaign rule: enforce only in FE/API, or also on-chain if the program has enough root-level schedule state. Recommended: FE/API now, on-chain only if state supports it safely.
3. Grace notification audience: sender and recipient both see it, but recipient only when claimable amount is positive. Recommended: use this policy.
