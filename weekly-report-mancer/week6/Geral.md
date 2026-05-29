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

### 7. Funding recovery system (create/fund split)

**Problem:** If `createCampaign` succeeded on-chain but `fundCampaign` failed (wallet rejection, insufficient balance, network timeout), the user was stuck — the campaign existed but had no tokens, and there was no way to resume.

**Solution:** I built a localStorage-based pending funding recovery system.

#### Main changes

| Area | What changed |
|---|---|
| `persist.ts` | New module to store/retrieve pending unfunded campaigns in localStorage |
| `PendingFundingsPanel.tsx` | New component showing unfunded campaigns with "Resume Funding" button |
| Create pages (cliff/linear/milestone) | All 3 pages now show pending fundings panel at the top |
| Campaign detail | Claim buttons disabled while campaign is underfunded |
| Display | Shows human-readable token amounts (`0.003 SOL`) instead of raw lamports |

#### Relevant commit

- `7d7ffe5 Add campaign recovery and E2E coverage`

---

### 8. Campaign event timeline

**Problem:** Users had no visibility into what happened to a campaign over time — cancels, pauses, withdrawals, milestone releases were invisible.

**Solution:** I built a timeline component that shows all campaign lifecycle events.

#### Main changes

| Area | What changed |
|---|---|
| `CampaignTimeline.tsx` | 186-line component rendering event cards with timestamps and details |
| `useCampaignTimeline.ts` | Hook fetching timeline events from the API |
| Campaign detail page | Timeline integrated into the campaign view |

---

### 9. Playwright E2E test infrastructure

**Problem:** There were no automated browser tests. Manual testing was the only way to verify UI flows worked end-to-end.

**Solution:** I set up Playwright from scratch with a mock wallet system and wrote 13 E2E tests covering critical user flows.

#### What was built

| Area | What changed |
|---|---|
| `playwright.config.ts` | Full config with webServer auto-start, timeouts, chromium project |
| Mock wallet (`WalletProvider`) | localStorage-based E2E mock that injects a fake connected wallet |
| `helpers.ts` | Shared utilities: `enableE2eWallet`, `gotoWithRetry`, `selectSolToken`, `openCsvMode`, `parseCsv` |
| `pageErrors.ts` | Utility to collect and filter known noisy page errors (hydration) |
| `landing.spec.ts` | Landing page smoke test |
| `create-pages.spec.ts` | 3 tests: cliff/linear/milestone disconnected state rendering |
| `csv-validation.spec.ts` | 6 tests: type enforcement, duplicate detection, milestone index rules |
| `funding-recovery.spec.ts` | 3 tests: pending funding panel visibility and resume button |

#### Test results

- **13/13 passing** on both `test:e2e` (Playwright-managed server) and `test:e2e:local` (pre-started dev server)

#### Relevant commit

- `7d7ffe5 Add campaign recovery and E2E coverage`

---

### 10. Test infrastructure improvements

**Problem:** Running `pnpm test` required a Postgres database, making it impossible for quick local validation. CI was also failing intermittently.

**Solution:** I split the test configs and fixed CI pipeline issues.

#### Main changes

| Area | What changed |
|---|---|
| `vitest.unit.config.ts` | New config that excludes DB-dependent tests (231 tests pass without Postgres) |
| `test:unit` script | Runs unit tests only — no DB required |
| `test:db` script | Explicit alias for DB-dependent test suite |
| `test:e2e:deps` script | Documents Playwright OS dependency installation |
| CI fixes | 3 commits (`bec33d6`, `ca3cc69`, `bc72cb9`) fixing lint, test, and workflow issues |

---

### 11. Landing page polish

**Problem:** Landing page messaging was generic and navigation didn't guide users toward the product.

**Solution:** I polished the hero section, FAQ, waitlist copy, and navigation flow.

#### Relevant commit

- `54a762c refactor: polish landing page messaging and nav`

---

### 12. WalletTokensProvider (real-time balance context)

**Problem:** Multiple components needed wallet token balances but were fetching independently, causing redundant RPC calls and inconsistent state.

**Solution:** I created a shared context provider that fetches and normalizes wallet token balances once, exposing them to all consumers.

#### Main changes

| Area | What changed |
|---|---|
| `WalletTokensProvider.tsx` | New context provider with auto-refetch, loading/error states |
| Token normalization | Native SOL surfaced separately from SPL tokens |
| Create flows | Token picker now reads from shared context instead of fetching independently |

---

### 13. IDL sync and auth gate fixes

**Problem:** Frontend was intermittently failing because the committed IDL didn't match the deployed program, and campaign indexing was blocked by an unnecessary auth gate.

**Solution:** Two IDL sync commits and one auth gate removal.

#### Main changes

| Area | What changed |
|---|---|
| IDL sync | Restored canonical IDL matching devnet deploy (`412d384`, `43c3feb`) |
| Auth gate | Removed admin auth requirement from `POST /api/campaigns` to unblock indexing (`2057038`) |
| Security test | Updated test expectations after auth gate removal (`1291a1d`) |

---

### 14. End-user documentation

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
| Funding recovery (create/fund split) | Working — pending campaigns persist and can resume |
| Campaign event timeline | Working |
| Playwright E2E tests | 13/13 passing |
| Unit tests without DB | 231 passing via `test:unit` |
| Landing page polish | Working |
| WalletTokensProvider (shared balance context) | Working |
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

### 15. Milestone campaign UI bug fixes

**Problem:** Multiple bugs in milestone campaign flows:

- "Claimed" status showing after claiming 1/3 milestones (campaigns page compared single-leaf amount vs total myClaimed)
- No auto-refresh after claim/release/cancel actions
- Activity timeline showing raw lamports instead of human-readable amounts
- "Wait for milestone release" persisting after milestone was already triggered
- Claim flow not auto-advancing to next unclaimed leaf

**Solution:** Fixed multi-leaf status aggregation, added force-refresh on all actions, and fixed timeline amount formatting.

#### Main changes

| Area | What changed |
|---|---|
| `list.ts` | Added `getMultiLeafRecipientStreamStatus()` and `getMultiLeafClaimableAmount()` for correct multi-leaf aggregation |
| `campaigns/page.tsx` | Refactored recipient loop to group by treeAddress and use multi-leaf aggregate functions |
| `campaign/[id]/page.tsx` | All `onSuccess` callbacks now call `fetchTree(true)` to bypass throttle |
| `CampaignTimeline.tsx` | `formatAmount` now divides raw lamports by `10^decimals` |
| `ClaimWithProofButton.tsx` | Auto-advances `selectedIdx` to next unclaimed leaf after successful claim |
| `TriggerMilestoneButton.tsx` | Returns null when `alreadyReleased` (no redundant badge) |
| `MilestoneReleasePanel.tsx` | Added missing `confirmTransaction` after `sendTransaction` |

#### Relevant commits

- `71a4f93 fix: milestone campaign UI bugs — status, refresh, timeline, claim flow`
- `46c46f1 fix(test): update tests for removed auth gate and TriggerMilestoneButton changes`

---

### 16. Responsive mobile layout

**Problem:** Entire app only worked on desktop. Sidebar, header, and all pages had no mobile support.

**Solution:** Built responsive shell layout with mobile sidebar drawer and responsive spacing across all pages.

#### Main changes

| Area | What changed |
|---|---|
| `Sidebar.tsx` | Extracted `SidebarContent` component. Desktop: `hidden lg:flex` fixed 240px. Mobile: overlay drawer (280px) with backdrop, auto-close on navigation |
| `AppHeader.tsx` | Added hamburger button `lg:hidden`, mobile Velthoryn logo, responsive padding/sizing |
| `layout.tsx` | Added `mobileMenuOpen` state, changed `pl-[240px]` → `lg:pl-[240px]`, responsive main padding |

#### Relevant commit

- `bdd6e9e feat: responsive mobile layout with sidebar drawer`

---

### 17. Comprehensive devnet integration E2E tests

**Problem:** Only 13 integration tests existed, covering basic cliff/linear/milestone/cancel/pause. Many program instructions and error paths were untested.

**Solution:** Built 34 new devnet integration tests covering all uncovered flows. Total: **47 integration tests, all passing on devnet**.

#### New test coverage (34 tests in `devnet-vesting-extended.test.ts`)

| Category | Tests | Error codes covered |
|---|---|---|
| Unpause flows | 4 tests: unpause+claim, non-paused, outsider, double-pause | NotPaused, AlreadyPaused, Unauthorized |
| Linear full claim | 1 test: claim after end time = full amount | — |
| Cancel + vested claim | 1 test: beneficiary claims vested portion after cancel | — |
| Withdraw unvested | 2 tests: before cancel, during grace period | NotCancelled, GracePeriodActive |
| Non-cancellable stream | 1 test: cancel non-cancellable | NotCancellable |
| Fully claimed cancel | 1 test: cancel after full claim | FullyVested |
| Milestone advanced | 3 tests: double release, outsider release, multi-release persistence | MilestoneAlreadyReleased, Unauthorized |
| Close claim record | 2 tests: close after full claim, close before full claim | CannotClose |
| Token balance tracking | 2 tests: vault decrease + beneficiary increase, conservation law | — |
| Pause authority | 1 test: outsider pause | Unauthorized |
| Cancel stream (instant settle) | 2 tests: before-cliff refund, mid-linear split | — |
| Bulk campaign (Merkle) | 6 tests: create 3-leaf, claim with proof, wrong beneficiary, all-claim, bulk milestone release+claim, pre-release error | MilestoneNotReleased |
| Cancelled campaign | 1 test: claim after cancel | — |
| Sequential claims | 1 test: two partial claims accumulate | — |
| Edge cases | 3 tests: same timestamps, cliff=start, zero amount | ZeroAmount |
| Fund campaign | 1 test: overfunding | OverFunded |
| Update root | 2 tests: outsider update, same root | Unauthorized, SameRoot |

#### New helper functions added to `devnet-helpers.ts`

- `unpauseStream` — unpause campaign
- `withdrawUnvested` — withdraw unvested tokens after cancel + grace period
- `closeClaimRecord` — close claim record after full claim
- `cancelSingleStream` — instant settle for single-stream campaigns
- `createBulkCampaignFixture` — create Merkle tree campaign with multiple beneficiaries
- `claimWithProof` — claim with Merkle proof for bulk campaigns
- `updateRoot` — root rotation
- `fundCampaign` — additional funding

#### Error codes now tested (18 of 41)

NothingToClaim, MilestoneAlreadyClaimed, MilestoneNotReleased, MilestoneAlreadyReleased, AlreadyCancelled, Unauthorized, CampaignPaused, NotPaused, AlreadyPaused, NotCancellable, FullyVested, NotCancelled, GracePeriodActive, CannotClose, ZeroAmount, OverFunded, SameRoot, InvalidProof (via wrong beneficiary)

---

## Metrics — Quantifiable frontend progress

| Metric | Value |
|---|---|
| Geral commits this week (since May 25) | **19 commits** |
| Key feature commits | `9bba48e`, `cb08b83`, `ceff96f`, `7d7ffe5`, `54a762c`, `71a4f93`, `bdd6e9e` |
| Main frontend files changed | 48+ files in largest commit alone |
| New components built | `PendingFundingsPanel`, `CampaignTimeline`, `WalletTokensProvider`, E2E test infra |
| Playwright E2E tests | 13 tests (all passing) |
| Devnet integration E2E tests | **47 tests (all passing)** — 13 original + 34 new |
| Unit tests | **236 passing** via `test:unit` |
| User guide docs added | 1 end-user guide |
| Week 6 planning docs added | 1 execution plan, 1 gap analysis (EN + ID) |
| CSV validation tests added/updated | 8 passing cases in `bulk-campaign.test.ts` |
| CI fixes | 3 commits unblocking pipeline |
| Major UX areas touched | create flow, claim flow, dashboard, campaigns list, campaign detail, chart, funding recovery, landing page, E2E testing, responsive layout, docs |
| Lines changed (week 6 window) | ~3,500+ insertions |

---

## Next steps

1. Retest all major flows on current `dev_geral` / main candidate
2. Re-verify dashboard and `/campaigns` counts after wallet switching
3. Re-verify claim flows after Lana’s latest program-side updates
4. Finalize end-user guide with screenshots for Word delivery
5. Reduce workaround code once deploy + IDL + source are confirmed in sync

