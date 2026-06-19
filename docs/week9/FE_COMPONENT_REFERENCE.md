# FE Component Reference — Velthoryn Token Vesting

> **Scope**: `apps/web/src/components/` — all React components.
> **Last updated**: 2026-06-18 (Week 9)

---

## Navigation

- [Campaign Create](#campaign-create)
- [Campaign Detail](#campaign-detail)
- [Campaign List](#campaign-list)
- [Dashboard](#dashboard)
- [Shell](#shell)
- [Providers](#providers)
- [UI Primitives](#ui-primitives)
- [Landing Page](#landing-page)

---

## Campaign Create

### `BulkCsvSection`
**Path**: `campaign/create/BulkCsvSection.tsx`

File upload + preview panel for bulk CSV beneficiary upload. Handles RFC 4180 quoted fields, inline row validation errors, milestone support, and duplicate detection. Renders a preview table before submission.

**Props**: `releaseType`, `onValidRows(rows)`, `onError(message)`, `mintDecimals`

#### Usage

```tsx
import { BulkCsvSection } from "@/components/campaign/create/BulkCsvSection";
import type { PreparedRecipientRow } from "@/lib/campaign/bulk";

function CreateLinearPage() {
  const [recipients, setRecipients] = useState<PreparedRecipientRow[]>([]);

  return (
    <BulkCsvSection
      releaseType={1}                       // 0=Cliff, 1=Linear, 2=Milestone
      mintDecimals={6}                      // used to validate amount precision
      onValidRows={(rows) => setRecipients(rows)}
      onError={(message) => toast.error(message)}
    />
  );
}
```

CSV column format for `releaseType=1` (linear):
```
wallet,amount
7xKX...abcd,1000.00
9mPQ...efgh,500.00
```

---

### `CommonFields`
**Path**: `campaign/create/CommonFields.tsx`

Shared form fields used across all three create flows (cliff/linear/milestone): Campaign Name, Token Mint picker, Cancellable toggle, Cancel Authority input.

---

### `CreationModeTabs`
**Path**: `campaign/create/CreationModeTabs.tsx`

Tabs to switch between "Manual" and "Bulk CSV" beneficiary entry modes. Used on all three create pages.

---

### `FormSummary`
**Path**: `campaign/create/FormSummary.tsx`

Read-only summary panel shown before transaction submission. Lists campaign name, token, beneficiaries, total supply, and schedule.

---

### `PageHeader`
**Path**: `campaign/create/PageHeader.tsx`

Create flow page header with title, back-to-type-selector link, and step indicator.

---

### `PendingFundingsPanel`
**Path**: `campaign/create/PendingFundingsPanel.tsx`

Shows campaigns that are created on-chain but not yet funded. Allows the user to complete funding for pending campaigns from the create flow.

---

### `ScheduleCliff`
**Path**: `campaign/create/ScheduleCliff.tsx`

Campaign-level schedule fields for cliff vesting: Start Date, Cliff Date (unlock), End Date. All three dates apply to every beneficiary row.

---

### `ScheduleLinear`
**Path**: `campaign/create/ScheduleLinear.tsx`

Campaign-level schedule fields for linear vesting: Start Date, Cliff Date (start of ramp), End Date (full vest). All three apply to every beneficiary row.

---

### `ScheduleMilestone`
**Path**: `campaign/create/ScheduleMilestone.tsx`

Per-milestone schedule UI. Each milestone has an individual date and amount. Milestone indices are 0-based and must be unique per beneficiary.

---

### `SubmitSection`
**Path**: `campaign/create/SubmitSection.tsx`

Form submit button with transaction status states: idle → signing → confirming → confirmed. Shows error banners from `formatVestingError`.

---

### `TokenPicker`
**Path**: `campaign/create/TokenPicker.tsx`

Wrapper that shows the selected token (symbol, address) and opens `TokenPickerModal` on click.

---

### `TokenPickerButton`
**Path**: `campaign/create/TokenPickerButton.tsx`

Compact button variant of the token picker for inline use.

---

### `TokenPickerModal`
**Path**: `campaign/create/TokenPickerModal.tsx`

Sablier-style dark modal for selecting the campaign mint. Sections: Popular Tokens and Wallet Tokens. SOL row shows "Wrap required" badge and opens `WrapSolModal`.

---

### `VestingTypeSelector`
**Path**: `campaign/create/VestingTypeSelector.tsx`

Landing card for the create flow: three cards for Cliff, Linear, Milestone. Routes to the appropriate create page on click.

---

### `WrapSolModal`
**Path**: `campaign/create/WrapSolModal.tsx`

Modal for wrapping/unwrapping native SOL to wSOL (and back). Toggle between wrap/unwrap, amount input, balance display, Solscan link. Success state: green checkmark + auto-close after 2s.

#### Usage

```tsx
import { WrapSolModal } from "@/components/campaign/create/WrapSolModal";

function TokenPickerPage() {
  const [showWrap, setShowWrap] = useState(false);

  return (
    <>
      <button onClick={() => setShowWrap(true)}>Wrap SOL</button>
      {showWrap && (
        <WrapSolModal
          open={showWrap}
          onOpenChange={setShowWrap}
          onSuccess={() => {
            setShowWrap(false);
            // re-fetch wallet balance
          }}
        />
      )}
    </>
  );
}
```

---

## Campaign Detail

### `AllocationEditor`
**Path**: `campaign/detail/AllocationEditor.tsx`

Root rotation UI: edit beneficiary allocations and submit an `updateRoot` transaction. Shows lock states: cancelled, claims-exist, not-cancel-authority, fully-vested.

#### Usage

```tsx
import { AllocationEditor, type RecipientRow } from "@/components/campaign/detail/AllocationEditor";
import { useUpdateRoot } from "@/hooks/useUpdateRoot";
import { prepareCampaign, ReleaseType } from "@velthoryn/client";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";

function AllocationsPage({ campaign }: { campaign: CampaignDetail }) {
  const { updateRoot } = useUpdateRoot();
  const [saving, setSaving] = useState(false);

  async function handleSubmit(rows: RecipientRow[]) {
    setSaving(true);
    const now = Math.floor(Date.now() / 1000);
    const prepared = prepareCampaign(rows.map((r) => ({
      beneficiary: new PublicKey(r.beneficiary),
      amount: new BN(r.amount),
      releaseType: ReleaseType.Linear,
      startTime: new BN(r.startTime),
      cliffTime: new BN(r.cliffTime),
      endTime: new BN(r.endTime),
      milestoneIdx: r.milestoneIdx,
    })));
    await updateRoot({
      treeAddress: campaign.treeAddress,
      payload: {
        merkleRoot: prepared.rootHex,
        leafCount: prepared.leafCount,
        minCliffTime: prepared.minCliffTime.toString(),
        leaves: prepared.leaves.map((l, i) => ({
          ...l, beneficiary: l.beneficiary.toBase58(),
          amount: l.amount.toString(), startTime: l.startTime.toString(),
          cliffTime: l.cliffTime.toString(), endTime: l.endTime.toString(),
          proof: prepared.proofs[i],
        })),
      },
    });
    setSaving(false);
  }

  return (
    <AllocationEditor
      initialRecipients={campaign.recipients.map((r) => ({ ...r, id: r.beneficiary }))}
      loading={saving}
      onSubmit={handleSubmit}
      canRotate={campaign.cancellable && !campaign.cancelledAt}
      lockedReason={campaign.cancelledAt ? "Campaign is cancelled" : null}
      claimedAmounts={Object.fromEntries(campaign.recipients.map((r) => [r.beneficiary, r.claimedAmount]))}
      mintDecimals={6}
    />
  );
}
```

---

### `CampaignStatusBanner`
**Path**: `campaign/detail/CampaignStatusBanner.tsx`

Full-width banner at the top of the campaign detail page. Renders different content based on `CampaignLifecycle` state: grace-period countdown, instant-refund notice, settled banner.

#### Usage

```tsx
import { CampaignStatusBanner } from "@/components/campaign/detail/CampaignStatusBanner";
import { useCampaignDetail } from "@/hooks/useCampaignDetail";
import { useWallet } from "@solana/wallet-adapter-react";

function CampaignDetailPage({ treeAddress }: { treeAddress: string }) {
  const { data: campaign } = useCampaignDetail(treeAddress);
  const { publicKey } = useWallet();

  if (!campaign) return null;

  return (
    <CampaignStatusBanner
      cancelledAtBigint={campaign.cancelledAt ? BigInt(campaign.cancelledAt) : null}
      isCreator={campaign.creator === publicKey?.toBase58()}
      isInstantRefunded={campaign.instantRefunded}
      isFunded={campaign.totalSupply > 0}
      nowTs={BigInt(Math.floor(Date.now() / 1000))}
      onWithdrawClick={() => {/* trigger withdraw_unvested flow */}}
      unvestedAmount={BigInt(campaign.totalSupply - campaign.totalClaimed)}
      mintDecimals={6}
    />
  );
}
```

---

### `CampaignTimeline`
**Path**: `campaign/detail/CampaignTimeline.tsx`

Chronological event list for a campaign. Event types: `campaign_created`, `tokens_deposited`, `claim`, `stream_cancelled`, `instant_refunded`, `root_updated`. Populated from `/api/events/*`.

---

### `CancelConfirmDialog`
**Path**: `campaign/detail/CancelConfirmDialog.tsx`

Confirmation dialog for the Cancel Campaign action. Two modes: `cancel_settle` (single-leaf, splits vested/unvested) and `instant_refund` (multi-leaf pre-cliff). Shows estimated split amounts.

---

### `ClaimWithProofButton`
**Path**: `campaign/detail/ClaimWithProofButton.tsx`

Primary claim button for beneficiaries. Uses `useProofLookup` (Merkle proof) and `useClaimRecord` (claimed so far). Disabled when proof not found, nothing claimable, or wallet not connected. Label changes to "Claim Vested" when campaign is cancelled mid-vesting.

---

### `CloseClaimRecordButton`
**Path**: `campaign/detail/CloseClaimRecordButton.tsx`

Allows beneficiary to close their on-chain `ClaimRecord` PDA after full claim + grace period expiry to recover rent. Uses `useClaimRecord` to verify eligibility.

---

### `GracePeriodCountdown`
**Path**: `campaign/detail/GracePeriodCountdown.tsx`

Countdown timer showing time remaining in the 7-day grace period after campaign cancellation. Hides when `instantRefunded === true` or `streamSettled === true`.

---

### `MilestoneCarouselCard`
**Path**: `campaign/detail/MilestoneCarouselCard.tsx`

Horizontal scrollable carousel showing each milestone's index, date, amount, and release/claim state.

---

### `MilestoneReleasePanel`
**Path**: `campaign/detail/MilestoneReleasePanel.tsx`

Creator-facing panel to release individual milestones. Shows each milestone's status (unreleased / released / claimed) and a "Release Milestone N" button.

---

### `MilestoneStatusBadge`
**Path**: `campaign/detail/MilestoneStatusBadge.tsx`

Badge showing milestone state: `Unreleased`, `Released`, `Claimed`.

---

### `PauseToggleButton`
**Path**: `campaign/detail/PauseToggleButton.tsx`

Pause / Resume button for campaigns with a pause authority. Shows current state. Disabled when campaign is cancelled, fully vested, or settled.

---

### `RecipientListModal`
**Path**: `campaign/detail/RecipientListModal.tsx`

Modal showing all recipients (beneficiaries), their allocation, number of leaves, and claimed amount. Paginated for large campaigns.

---

### `RootRotationCard`
**Path**: `campaign/detail/RootRotationCard.tsx`

Card component that summarizes the current Merkle root and root version history. Contains a link to `AllocationEditor` for cancel-authority wallets.

---

### `TriggerMilestoneButton`
**Path**: `campaign/detail/TriggerMilestoneButton.tsx`

Creator button to release an individual milestone. Calls `releaseMilestone` instruction. Only visible when `hasMilestoneLeaves === true` and wallet is creator.

---

### `VestingChart`
**Path**: `campaign/detail/VestingChart.tsx`

SVG vesting curve visualization. Plots vested amount over time as a step chart (cliff), ramp (linear), or stepped ramp (milestone). Uses `vestingCurve.samples` from campaign detail API.

---

### `WithdrawUnvestedButton`
**Path**: `campaign/detail/WithdrawUnvestedButton.tsx`

Creator button to sweep unvested tokens after campaign cancellation + grace period expiry. Disabled during grace period. Shows estimated amount.

---

## Campaign List

### `CampaignRow`
**Path**: `campaign/list/CampaignRow.tsx`

Single row in the campaigns table. Shows: campaign name, mint, beneficiary count, status badge, role badge, actions link.

---

### `EmptyState`
**Path**: `campaign/list/EmptyState.tsx`

Empty state illustration + CTA for the campaigns list when no campaigns match the current filter.

---

### `RoleBadge`
**Path**: `campaign/list/RoleBadge.tsx`

Shows whether the connected wallet is `Creator`, `Recipient`, or `Both` for a given campaign.

---

### `StatusBadge`
**Path**: `campaign/list/StatusBadge.tsx`

Campaign lifecycle status badge. Maps `CampaignLifecycle` to a colored badge: Active (green), Paused (yellow), Cancelled (red), Settled (gray), Instant Refunded (orange), Claimed (blue).

#### Usage

```tsx
import { StatusBadge } from "@/components/campaign/list/StatusBadge";
import type { StreamStatus } from "@/lib/vesting/list";

// StreamStatus: "Active" | "Claimable" | "Claimed" | "Paused" |
//               "Grace Period" | "Cancelled" | "Settled" | "Instant Refunded" | "Scheduled"

function CampaignRow({ campaign }: { campaign: CampaignDetail }) {
  const status: StreamStatus = campaign.paused
    ? "Paused"
    : campaign.instantRefunded
    ? "Instant Refunded"
    : campaign.cancelledAt
    ? "Grace Period"
    : campaign.totalClaimed >= campaign.totalSupply
    ? "Claimed"
    : "Active";

  return (
    <div>
      <span>{campaign.treeAddress.slice(0, 8)}…</span>
      <StatusBadge status={status} />
    </div>
  );
}
```

---

## Dashboard

### `ActivityFeed`
**Path**: `dashboard/ActivityFeed.tsx`

Live activity feed showing recent events (claims, cancellations, root updates) across all campaigns the connected wallet participates in.

---

## Shell

### `AppHeader`
**Path**: `shell/AppHeader.tsx`

Top navigation bar. Contains: mobile hamburger menu, wallet connect button, theme toggle. Fixed at top of the app shell.

---

### `Sidebar`
**Path**: `shell/Sidebar.tsx`

Left navigation sidebar with links to Campaigns, Dashboard, Portfolio, Activity. On desktop: collapsible with icon-only mode. On mobile: full-screen drawer (Sheet).

---

### `ThemeToggle`
**Path**: `shell/ThemeToggle.tsx`

Sun/Moon icon button to toggle dark/light mode via `next-themes`.

---

### `Toast`
**Path**: `shell/Toast.tsx`

Wrapper around sonner `<Toaster>`. Positioned bottom-right.

---

## Providers

### `PendingCampaignIndexer`
**Path**: `providers/PendingCampaignIndexer.tsx`

Background polling component (no UI). Reads `velthoryn:pending-campaign-index` from localStorage and calls `POST /api/campaigns` to index newly created campaigns after the transaction confirms. Runs in the app shell layout.

---

### `QueryProvider`
**Path**: `providers/QueryProvider.tsx`

Wraps the app with a TanStack Query `QueryClientProvider`. Configures default `staleTime` and retry behavior.

---

### `ThemeProvider`
**Path**: `providers/ThemeProvider.tsx`

Wraps `next-themes` `ThemeProvider` with `defaultTheme="dark"` and `attribute="class"`.

---

### `WalletProvider`
**Path**: `providers/WalletProvider.tsx`

Sets up `@solana/wallet-adapter-react` with Phantom, Solflare, and Backpack adapters. RPC endpoint from `NEXT_PUBLIC_RPC_ENDPOINT`.

---

### `WalletTokensProvider`
**Path**: `providers/WalletTokensProvider.tsx`

React context that fetches and caches SPL token accounts for the connected wallet. Used by `TokenPickerModal` to show "Wallet Tokens" section.

---

## UI Primitives

### Custom

| Component | File | Description |
|---|---|---|
| `DetailRow` | `ui/DetailRow.tsx` | Label + value row used in detail panels |
| `FieldRow` | `ui/FieldRow.tsx` | Form field with label + error message |
| `ProgressBar` | `ui/ProgressBar.tsx` | Vesting progress bar with percentage |
| `SectionHeader` | `ui/SectionHeader.tsx` | Section title with optional subtitle |
| `Spinner` | `ui/Spinner.tsx` | Loading spinner (SVG, animated) |
| `StatCard` | `ui/StatCard.tsx` | Dashboard stat card with label + value |

### shadcn/ui (added Week 8)

| Component | File | Source |
|---|---|---|
| `Badge` | `ui/badge.tsx` | shadcn/ui |
| `Button` | `ui/button.tsx` | shadcn/ui |
| `Card` | `ui/card.tsx` | shadcn/ui |
| `Dialog` | `ui/dialog.tsx` | shadcn/ui |
| `Input` | `ui/input.tsx` | shadcn/ui |
| `Label` | `ui/label.tsx` | shadcn/ui |
| `Progress` | `ui/progress.tsx` | shadcn/ui |
| `ScrollArea` | `ui/scroll-area.tsx` | shadcn/ui |
| `Select` | `ui/select.tsx` | shadcn/ui |
| `Skeleton` | `ui/skeleton.tsx` | shadcn/ui |
| `Sonner` | `ui/sonner.tsx` | shadcn/ui (toast notifications) |
| `Tooltip` | `ui/tooltip.tsx` | shadcn/ui |

---

## Landing Page

| Component | Description |
|---|---|
| `LandingPage` | Root landing page layout |
| `Hero` | Hero section with headline + CTA |
| `Stats` | Protocol stats (TVL, campaigns, beneficiaries) |
| `HowItWorks` | Step-by-step explanation |
| `UseCases` | Creator and beneficiary use cases |
| `Pillars` | Technical pillars (Merkle, compression, etc.) |
| `CampaignPreview` | Animated preview of the campaign UI |
| `FAQ` | Accordion FAQ |
| `CallToAction` | Bottom CTA section |
| `Partners` | Partner logo grid |
| `Footer` | Footer links + social |
| `Topbar` | Landing nav bar |
| `Waitlist` | Email waitlist signup form |
| `ScrollReveal` | Intersection Observer scroll animation wrapper |
| `SmoothScrollLink` | `<a>` that scrolls smoothly to an anchor |
| `Demo` | Interactive demo section |
| `SvgDefs` | Shared SVG gradient definitions |
