# Weekly Report — Geral (Week 6)

## What I built this week

**Frontend vesting stabilization across creation, claim, dashboard, and campaign detail flows. Main focus: make Devnet testing actually usable for BD/QA by hardening claim UX, separating native SOL vs wSOL behavior, reducing broken states after claim/cancel, fixing sender/recipient data leakage, clarifying CSV/manual creation flows, and preparing end-user documentation.**

### 1. Native SOL / wSOL UX separation and auto-wrap flow

**Problem:** SOL and wSOL were still confusing in the UI. Funding and claim flows could feel broken because users did not understand whether they were using raw SOL or wrapped SOL.

**Solution:** I separated native SOL and wSOL more clearly in the frontend and added auto-wrap support through the create flows.

#### Main changes

| Area | What changed |
|---|---|
| Token selection | SOL and wSOL are shown as separate token choices |
| Create flow | Auto-wrap can be threaded through stream/campaign creation |
| Wrap / unwrap | Moved to a clearer modal-based flow |
| Wallet balances | Native SOL is now surfaced separately from SPL balances |

#### Relevant commit

- `9bba48e feat: auto-wrap SOL flow, wSOL as separate token, partial unwrap`

---

### 2. Claim flow hardening for real Devnet usage

**Problem:** Claim simulation often passed, but the actual wallet send/sign step could still fail or confuse the user. There were also multiple cases where claim succeeded on-chain but the page still looked broken.

**Solution:** I hardened the claim path across single-stream and proof-backed campaign flows.

#### Main changes

| Area | What changed |
|---|---|
| Claim state | Added more aggressive optimistic state updates after successful claims |
| Post-claim UI | Prevented UI from falling back to stale state after claim |
| Wallet send path | Added fallback claim send path using `signTransaction + sendRawTransaction` |
| Error handling | Wallet approval failures now show neutral, non-misleading messages |
| Native claim path | Kept compatibility handling for native SOL campaign claims |

#### Examples of user-facing improvements

- buttons switch to claimed state more reliably
- claim flow no longer depends only on a refetch succeeding immediately
- wallet failures no longer look like proof or on-chain failures by default

#### Relevant commits

- `cb08b83 feat: stabilize vesting flows and campaign UX`
- `ceff96f feat: harden vesting ui and claim flows`

---

### 3. Campaign detail UX stabilization

**Problem:** Campaign detail pages were showing multiple confusing states:

- optional account fetch noise after successful claim
- wrong action states after full claim
- campaign metrics not scoped properly for recipients
- “stream” wording used for campaign flows
- allocation editor taking too much space in the main detail page

**Solution:** I reworked the detail page behavior and layout to better match actual product roles.

#### Main changes

| Area | What changed |
|---|---|
| Recipient metrics | Added clearer `Total Supply`, `Your Allocation`, `You Claimed`, `Vested`, `Your Claimable` |
| Claim state | Fixed cases where users could still click claim after a full claim |
| Root rotation UX | Moved allocation editing out of the main detail page into its own page |
| Naming | Split `Vesting Stream` vs `Vesting Campaign` wording |
| Recipients visibility | Added recipient preview + modal list with search, claim status, and allocation |
| Schedule UX | Simplified the confusing “Schedule Reference” panel |

#### New UX surface

- dedicated allocation editor page:
  - `apps/web/src/app/(app)/campaign/[id]/allocations/page.tsx`

---

### 4. CSV/manual creation flow cleanup

**Problem:** Creation flows were still mixing concepts:

- manual duplicate could feel like “add recipient to one campaign”
- milestone CSV still looked like it wanted one recipient field
- CSV validation errors were too technical
- users could still click create even when balance was clearly insufficient

**Solution:** I cleaned up the create flows and validation messaging.

#### Main changes

| Area | What changed |
|---|---|
| Cliff / Linear manual | 1 row = single stream, multiple rows = one campaign |
| Milestone CSV | Removed misleading single-recipient feeling; made it clearly campaign-based |
| Balance guard | Disabled create/fund when wallet balance is insufficient |
| CSV errors | Rewrote bulk CSV errors to be simpler and more human |
| Validation rules | Cliff/Linear duplicate beneficiary blocked; milestone duplicate allowed only with unique milestone index |
| Preview table | Milestone CSV preview now shows milestone index |

#### Validation rules now enforced

- **Cliff / Linear:** one wallet can appear only once per campaign
- **Milestone:** the same wallet may appear more than once, but each row must use a different milestone index

#### Relevant commits

- `cb08b83 feat: stabilize vesting flows and campaign UX`
- `ceff96f feat: harden vesting ui and claim flows`

---

### 5. Dashboard and `/campaigns` data integrity fixes

**Problem:** sender/recipient counts and role badges could leak across wallets or become inconsistent:

- dashboard counts not matching `/campaigns`
- recipient rows accidentally treated as sender+recipient
- campaign rows flashing the wrong metric set before beneficiary-specific data loaded

**Solution:** I aligned dashboard and campaigns page logic around deduped tree rows and stricter role checks.

#### Main changes

| Area | What changed |
|---|---|
| Sender counts | Sender rows now require the creator to match the active wallet |
| Recipient counts | Dashboard uses deduped campaign-level rows instead of raw beneficiary entry counts |
| Role merge | `Sender + Recipient` only appears when creator truly matches active wallet |
| Metric loading | Prevented recipient metric flash from showing the wrong summary state first |

#### Outcome

- less sender/recipient data leakage
- dashboard and campaigns page are much closer logically
- recipient-only campaigns no longer masquerade as sender-owned rows as easily

---

### 6. Vesting chart improvements

**Problem:** the chart stopped abruptly after vesting ended, and marker dots could appear slightly off the line.

**Solution:** I improved the chart behavior and controls.

#### Main changes

| Area | What changed |
|---|---|
| End-of-curve behavior | Curve continues flat after vesting completes |
| Range selector | Added zoom controls: Daily, Weekly, Monthly, Yearly, All |
| Default focus | Completed vesting auto-focuses to recent range |
| Marker alignment | NOW/DONE marker now uses the same curve calculation as the line |

---

### 7. End-user documentation

**Problem:** BD needed a clearer user-facing guide for testing and later product onboarding, especially on Devnet.

**Solution:** I wrote a Devnet-first end-user vesting guide and separated manual vs CSV flows per vesting type.

#### New document

- `research-docs/week6/END_USER_VESTING_GUIDE.md`

#### Coverage

- what vesting is
- sender vs recipient
- cliff / linear / milestone
- manual vs CSV
- Devnet SOL and test token setup
- user flow sections split by vesting type for screenshot attachment

---

## Status — What works and what doesn’t

### Working

| Item | Status |
|---|---|
| Native SOL / wSOL separation in UI | Working |
| Auto-wrap threading in create flows | Working |
| Single-stream claim UX | Working |
| Bulk proof-backed claim UX | Working for Devnet testing |
| Claim button states after success | Improved and mostly stable |
| CSV validation rules | Working |
| Create disabled on insufficient balance | Working |
| Dashboard/campaign count hardening | Improved |
| Recipient recipient-list modal | Working |
| Allocation editor page | Working |
| Vesting chart range controls + completed flat line | Working |
| End-user Devnet guide | Draft complete |

### Not yet final

| Item | Status |
|---|---|
| Claim flow architecture | Still contains compatibility/workaround paths for Devnet |
| Wallet adapter stability | Still dependent on wallet extension behavior |
| Native final-claim lifecycle | UI handles it, but underlying account disappearance still needs SC clarity |
| Full dashboard/campaign count confidence | Much improved, but still needs retest after merge/deploy changes |
| Milestone cancel semantics | UX understood, but final product decision depends on SC constraints |

---

## Findings — What I discovered this week

### 1. Source / deployed binary / IDL drift is still a real issue

The frontend repeatedly showed symptoms that strongly suggest:

- repo source
- devnet deployed program
- IDL

are not always perfectly aligned.

Symptoms observed:

- claim account compatibility mismatches
- native/bulk placeholder account requirements
- post-claim account disappearance behavior needing FE fallback

### 2. Claim success and fetch success are not the same thing

Several “claim failed” reports were actually:

- successful transaction
- followed by broken refetch or vanished on-chain account reads

This required multiple FE-side defensive fixes so users would not see false failure states.

### 3. Wallet adapter behavior is a separate failure domain

Even when:

- proof was valid
- accounts were valid
- simulation passed

wallet adapter send/sign behavior could still fail.

This is why I added a more resilient send path and softer wallet-approval messaging.

### 4. Role/count leakage is easy when campaign rows are not deduped consistently

Dashboard and `/campaigns` diverged because one part of the UI counted:

- deduped campaign rows

while another part counted:

- raw beneficiary entries or merged rows too loosely

This created sender/recipient leakage and wrong stats.

### 5. Milestone semantics are now clearer

Key conclusion:

- **instant settle** is currently tied to **single-leaf stream**
- not to “one beneficiary”

So:

- a one-beneficiary multi-milestone campaign is still treated as a campaign for cancellation purposes

This is a product + SC design reality, not just a frontend detail.

---

## Blockers — What still depends on Lana / SC side

### Need confirmation from program side

1. Devnet deploy must match the latest source
2. IDL must be regenerated from that exact deploy
3. final account layout for claim/native/bulk paths should be confirmed
4. final native claim account disappearance behavior should be confirmed as intended or not
5. milestone multi-leaf cancel behavior may need explicit product/SC decision

### Database / indexer coordination

Extra event tables appeared in Supabase outside the original active frontend schema:

- `cancel_events`
- `milestone_events`
- `pause_events`
- `root_update_events`
- `stream_cancel_events`
- `withdraw_events`

These need:

- final ownership confirmation
- migration source confirmation
- access / RLS review

---

## Metrics — Quantifiable frontend progress

| Metric | Value |
|---|---|
| Geral commits this window | **3 meaningful product commits** (`9bba48e`, `cb08b83`, `ceff96f`) |
| Main frontend files changed across those commits | 40+ |
| User guide docs added | 1 end-user guide |
| Week 6 planning docs added | 1 execution plan |
| CSV validation tests added/updated | 8 passing cases in `bulk-campaign.test.ts` |
| Major UX areas touched | create flow, claim flow, dashboard, campaigns list, campaign detail, chart, docs |

---

## Next steps

1. Retest all major flows on current `dev_geral` / main candidate
2. Re-verify dashboard and `/campaigns` counts after wallet switching
3. Re-verify claim flows after Lana’s latest program-side updates
4. Finalize end-user guide with screenshots for Word delivery
5. Reduce workaround code once deploy + IDL + source are confirmed in sync

