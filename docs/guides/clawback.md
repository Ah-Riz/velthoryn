# Clawback & Grace Period

The clawback feature enables creators to cancel vesting campaigns and recover unvested tokens. Recipients retain any tokens vested up to the cancellation moment. Different cancellation paths apply depending on campaign type and timing.

---

## 1. What is clawback

Clawback is the mechanism by which a creator reclaims tokens that have not yet vested. The program supports three cancellation paths, each with different behavior:

| Path | When to use | Grace period | Resolution |
|------|------------|-------------|------------|
| **Campaign-wide cancel** | Multi-recipient campaigns after vesting starts | 7 days | Creator withdraws unvested after grace |
| **Per-recipient cancel** (`cancel_stream`) | Single-recipient streams | None | Atomic: vested to beneficiary, remainder to creator |
| **Instant refund** | Multi-leaf campaigns before any vesting starts | None | Full refund to creator in one transaction |

{% hint style="info" %}
Campaigns created with `cancellable: false` cannot be cancelled. The `cancel_authority` must be set at creation time.
{% endhint %}

---

## 2. Campaign-wide cancel (7-day grace period)

When a creator cancels a multi-recipient campaign, the following happens:

1. `cancelledAt` is set to the current timestamp on-chain.
2. The vesting curve is **frozen** at the cancel time -- no more tokens vest after this point.
3. `paused` is cleared to `false` so recipients can still claim vested tokens during grace.
4. A 7-day grace period begins. During this window, beneficiaries can claim any tokens that had vested before cancellation.
5. After the grace period expires, the creator calls `withdrawUnvested` to sweep remaining tokens.

### Creator flow

```typescript
// Step 1: Cancel the campaign (starts 7-day grace)
await program.methods
  .cancelCampaign()
  .accounts({
    cancelAuthority: creatorWallet.publicKey,
    vestingTree,
  })
  .rpc();

// Step 2: Wait 7 days...

// Step 3: Withdraw unvested tokens
await program.methods
  .withdrawUnvested()
  .accounts({
    creator: creatorWallet.publicKey,
    vestingTree, vaultAuthority, vault,
    creatorAta,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

{% hint style="warning" %}
Calling `withdrawUnvested` before 7 days have elapsed throws `GracePeriodActive` (error 6027). The grace period constant is `604,800` seconds (7 days), hardcoded in the program.
{% endhint %}

### Beneficiary behavior during grace

Beneficiaries can still claim vested tokens during the grace period. When claiming from a cancelled campaign, the `getVestedAmount` function clamps the vesting calculation to `cancelledAt` instead of the current time:

```typescript
import { getVestedAmount, type VestingSchedule } from "@/lib/vesting/schedule";

const schedule: VestingSchedule = {
  amount: BigInt(1_000_000_000),
  releaseType: 1,
  startTime: BigInt(startTs),
  cliffTime: BigInt(cliffTs),
  endTime: BigInt(endTs),
};

// Pass cancelledAt to freeze the vesting curve at cancel time
const claimable = getVestedAmount(schedule, cancelledAt, now);
```

---

## 3. Per-recipient cancel (`cancel_stream`)

For single-recipient streams (`leaf_count == 1`), `cancel_stream` resolves everything atomically in one transaction -- no grace period:

1. Computes vested amount at the current time.
2. Transfers vested tokens to the beneficiary.
3. Transfers the remaining vault balance to the creator.
4. Campaign is fully settled.

```typescript
await program.methods
  .cancelStream({
    releaseType: 1,
    startTime: new BN(startTs),
    cliffTime: new BN(cliffTs),
    endTime: new BN(endTs),
    milestoneIdx: 0,
  })
  .accounts({
    creator: creatorWallet.publicKey,
    beneficiary: beneficiaryPubkey,
    vestingTree,
    mint: mintPubkey,
  })
  .rpc();
```

{% hint style="info" %}
`cancel_stream` only works on single-recipient streams. For multi-recipient campaigns, use `cancelCampaign` with the 7-day grace period.
{% endhint %}

### Errors specific to stream cancellation

| Code | Name | Meaning |
|------|------|---------|
| 6029 | `NotSingleStream` | Campaign has more than one recipient |
| 6031 | `FullyVested` | All tokens already vested; nothing to claw back |
| 6032 | `StreamExpired` | Stream has ended and nothing remains |

---

## 4. Instant refund (unstarted campaigns)

If no tokens have vested yet and no milestones have been released, the creator can get a full refund in one transaction:

```typescript
await program.methods
  .instantRefundCampaign()
  .accounts({
    creator: creatorWallet.publicKey,
    vestingTree,
    mint: mintPubkey,
  })
  .rpc();
```

### Conditions

- `now < minCliffTime` (no beneficiary has vested anything)
- No milestone flags have been set
- Multi-leaf campaigns only (`leaf_count > 1`); single-recipient streams use `cancel_stream` instead

### Errors

| Code | Name | Meaning |
|------|------|---------|
| 6036 | `CampaignAlreadyStarted` | `now >= minCliffTime`; too late for instant refund |
| 6040 | `NotMultiLeafCampaign` | Use `cancel_stream` for single-recipient campaigns |

---

## 5. Grace period behavior

The grace period is a fixed 7-day window (`604,800` seconds) that starts when `cancelCampaign` is called. During this window:

- **Beneficiaries can claim** any tokens that were vested before `cancelledAt`.
- **The vesting curve is frozen** -- no additional tokens vest during or after grace.
- **The creator cannot withdraw** unvested tokens until grace expires.

### Computing grace period state

The frontend utility `getGracePeriodState` returns the current grace status:

```typescript
import { getGracePeriodState, GRACE_PERIOD_SECS } from "@/lib/vesting/display";

const graceState = getGracePeriodState(cancelledAt, nowTs);

switch (graceState.status) {
  case "not_cancelled":
    // Campaign is active, no grace period
    break;
  case "grace_active":
    // graceState.remaining -> seconds left (bigint)
    // graceState.countdown -> "5d 14h 32m" (formatted string)
    break;
  case "grace_expired":
    // Creator can now call withdrawUnvested
    break;
}
```

### Grace period end time

```typescript
const GRACE_PERIOD_SECS = 604_800n;  // 7 days

function gracePeriodEnd(cancelledAt: bigint): bigint {
  return cancelledAt + GRACE_PERIOD_SECS;
}

function isGracePeriodOver(cancelledAt: bigint): boolean {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return now >= gracePeriodEnd(cancelledAt);
}
```

---

## 6. UI components

The frontend includes several components for displaying clawback state:

### CampaignStatusBanner

A conditional banner at the top of the campaign detail page. Shows different states based on campaign lifecycle:

| Campaign state | Banner color | Content |
|---------------|-------------|---------|
| Cancelled, grace active | Amber | Cancellation date, countdown, "Recipients can still claim" |
| Cancelled, grace expired, not withdrawn | Red | "Grace period expired" + Withdraw button |
| Cancelled, settled | Green | "Unvested tokens withdrawn to your wallet" |
| Instant refunded | Green | "Campaign refunded before vesting started" |
| Created, not funded | Amber | "Campaign not yet funded" + Resume Funding button |

The banner is only visible to the campaign creator.

### GracePeriodCountdown

A reusable live countdown component that updates every 60 seconds:

- Amber text when more than 24 hours remain
- Red text when less than 24 hours remain
- "Grace period expired" when the window has closed

### CancelConfirmDialog

A 3-mode confirmation dialog that presents the appropriate cancellation path:

1. **Instant settle** -- for single-recipient streams (`cancel_stream`)
2. **Grace period** -- for multi-recipient campaigns (`cancelCampaign`)
3. **Instant refund** -- for unstarted multi-leaf campaigns (`instantRefundCampaign`)

### WithdrawUnvestedButton

Displays a grace countdown when grace is active, then transitions to a confirm-then-withdraw flow once grace expires. Handles both native SOL and SPL token campaigns.

### Needs Action indicators

- **Sidebar badge:** Amber dot on "My Campaigns" when cancelled campaigns need attention
- **Campaigns list tab:** "Needs Action" tab filters to cancelled sender campaigns and claimable recipient campaigns
- **Dashboard section:** "Needs Attention" section shows cancelled campaigns with per-campaign grace countdown

---

## 7. Summary of cancellation paths

```
Campaign type?
  |
  +-- Single-recipient (leaf_count == 1)
  |     |
  |     +-- cancel_stream (atomic, no grace period)
  |
  +-- Multi-recipient (leaf_count > 1)
        |
        +-- Has vesting started? (now >= minCliffTime)
              |
              +-- No  -> instantRefundCampaign (full refund, no grace)
              |
              +-- Yes -> cancelCampaign (7-day grace)
                           |
                           +-- Wait 7 days
                           |
                           +-- withdrawUnvested (sweep remaining)
```

---

## Further reading

- [Program Integration](integration.md) -- full cancellation code examples
- [Frontend Integration](frontend-integration.md) -- React hooks for cancel/withdraw flows
- [Instruction Reference](../reference/instructions.md) -- error codes and account constraints
