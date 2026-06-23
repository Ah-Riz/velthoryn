# Error Codes

The Velora vesting program uses the `VestingError` enum with **41 variants**. Anchor custom errors start at code **6000** (`0x1770`).

Source: `programs/vesting/src/errors.rs`

---

## Campaign Creation Errors

| Code | Hex | Name | Triggered When |
|------|-----|------|----------------|
| 6000 | `0x1770` | `EmptyRoot` | Merkle root is all zeros |
| 6001 | `0x1771` | `EmptyCampaign` | `leaf_count == 0` |
| 6002 | `0x1772` | `ZeroAmount` | `amount == 0` or `total_supply == 0` |
| 6003 | `0x1773` | `MissingCancelAuthority` | `cancellable` is set but `cancel_authority` is `None` |
| 6011 | `0x177b` | `InvalidSchedule` | `start > cliff` or `cliff > end`, or `min_cliff_time == 0` |
| 6012 | `0x177c` | `InvalidScheduleType` | `release_type` is not `0`, `1`, or `2` |

---

## Funding Errors

| Code | Hex | Name | Triggered When |
|------|-----|------|----------------|
| 6005 | `0x1775` | `Unauthorized` | Signer does not match expected authority (`has_one` constraint) |
| 6006 | `0x1776` | `OverFunded` | Vault balance + deposit would exceed `total_supply` |
| 6007 | `0x1777` | `MintMismatch` | Account mint does not match campaign mint |
| 6008 | `0x1778` | `Overflow` | Arithmetic overflow during calculation |

---

## Claim and Withdrawal Errors

| Code | Hex | Name | Triggered When |
|------|-----|------|----------------|
| 6010 | `0x177a` | `UnauthorizedClaimer` | Signer is not `leaf.beneficiary` |
| 6013 | `0x177d` | `InvalidProof` | Merkle proof did not verify against stored root |
| 6014 | `0x177e` | `MilestoneAlreadyClaimed` | Milestone bit already set in `ClaimRecord.milestone_bitmap` |
| 6015 | `0x177f` | `NothingToClaim` | Claimable amount is 0 (no vested delta remaining) |
| 6016 | `0x1780` | `InsufficientVault` | Vault balance is less than the claimable amount |
| 6017 | `0x1781` | `OverClaim` | `total_claimed + claimable` would exceed `total_supply` |
| 6018 | `0x1782` | `WrongVault` | Provided vault does not match campaign vault |
| 6029 | `0x178d` | `NotSingleStream` | Instruction requires `leaf_count == 1` but campaign has multiple leaves |
| 6030 | `0x178e` | `ProofTooLong` | Merkle proof exceeds `MAX_MERKLE_PROOF_LEN` (32) or `ceil(log2(leaf_count))` |
| 6032 | `0x1790` | `StreamExpired` | Schedule ended with 0 claimable |
| 6033 | `0x1791` | `MilestoneNotReleased` | Creator has not released this milestone (flag bit unset) |
| 6041 | `0x1799` | `PerLeafCapExceeded` | Beneficiary exceeds the per-leaf claim slot capacity (`PER_LEAF_CAP = 8`) |

---

## Campaign State Errors

| Code | Hex | Name | Triggered When |
|------|-----|------|----------------|
| 6004 | `0x1774` | `SameRoot` | `update_root` called with unchanged root |
| 6009 | `0x1779` | `CampaignPaused` | Campaign is paused and claims are blocked |
| 6019 | `0x1783` | `NotCancellable` | Campaign was created as non-cancellable |
| 6020 | `0x1784` | `AlreadyCancelled` | Campaign has already been cancelled |
| 6021 | `0x1785` | `NotPausable` | No `pause_authority` was set on this campaign |
| 6022 | `0x1786` | `AlreadyPaused` | Campaign is already paused |
| 6023 | `0x1787` | `CampaignCancelled` | Cancelled campaigns cannot be paused or have root rotated |
| 6024 | `0x1788` | `NotPaused` | Campaign is not paused (cannot unpause) |
| 6025 | `0x1789` | `CampaignCompleted` | All tokens fully claimed; cannot pause or cancel |
| 6026 | `0x178a` | `NotCancelled` | Campaign has not been cancelled (cannot withdraw unvested) |
| 6027 | `0x178b` | `GracePeriodActive` | 7-day grace period has not yet elapsed |
| 6028 | `0x178c` | `CannotClose` | `ClaimRecord` not closeable (not fully claimed and grace not elapsed) |
| 6031 | `0x178f` | `FullyVested` | All tokens claimed; cannot cancel |

---

## Instant Refund Errors

| Code | Hex | Name | Triggered When |
|------|-----|------|----------------|
| 6034 | `0x1792` | `MilestoneAlreadyReleased` | `set_milestone_released` called twice for same index, or a milestone is set during instant refund check |
| 6035 | `0x1793` | `InstantRefundedCampaign` | Campaign was instant refunded; claims, releases, and withdrawals are permanently blocked |
| 6036 | `0x1794` | `CampaignAlreadyStarted` | `now >= min_cliff_time`; instant refund is only allowed before campaign start |
| 6040 | `0x1798` | `NotMultiLeafCampaign` | `instant_refund_campaign` requires `leaf_count > 1` |

---

## Native SOL Errors

| Code | Hex | Name | Triggered When |
|------|-----|------|----------------|
| 6037 | `0x1795` | `NativeSolVaultNotEmpty` | PDA still holds lamports after final claim or cancel drain |
| 6038 | `0x1796` | `NativeSolRentViolation` | Transfer would drop PDA below rent-exempt minimum |
| 6039 | `0x1797` | `UnsupportedMint` | Token-2022 mint used (not supported) |

---

## Tutorial Error Name Mapping

For developers coming from bootcamp or tutorial projects, this table maps common tutorial error names to Velora equivalents:

| Tutorial Name | Velora Name | Code |
|---------------|-------------|------|
| `InsufficientBalance` | `InsufficientVault` | 6016 |
| `UnauthorizedWithdraw` | `UnauthorizedClaimer` | 6010 |
| Withdraw more than unlocked | `NothingToClaim` | 6015 |
| Cancel after all claimed | `FullyVested` | 6031 |
| Bad schedule / wrong params | `InvalidProof` | 6013 |
| Zero deposit | `ZeroAmount` | 6002 |
| Invalid times | `InvalidSchedule` | 6011 |
| Campaign paused | `CampaignPaused` | 6009 |
| Multi-recipient on `withdraw` | `NotSingleStream` | 6029 |

{% hint style="info" %}
User-facing error strings are centralized in the frontend at `apps/web/src/lib/anchor/errors.ts` via the `formatVestingError()` function.
{% endhint %}
