# Week 8 -- Known Issues Report

> Generated from bug audit of L1 and P0 fixes across SC, BE, FE, DB, Docs, Merkle, and Ops layers.

## Summary

| Category | Count |
|----------|-------|
| Fixed | 15 |
| Documented (known limitations) | 12 |
| Deferred to Week 9+ | 2 |

---

## Fixed Issues (from L1 and P0 fixes)

| # | Issue | Area | Status | Rationale |
|---|-------|------|--------|-----------|
| 1 | Root rotation missing `minCliffTime` in on-chain call | SC/FE | **Fixed** | `useUpdateRoot.ts:32` now passes 3rd arg. SDK added `prepareRootRotation()`. |
| 2 | Root versions API had no auth | BE | **Fixed** | Added `auth: true` + `cancelAuthority` verification. |
| 3 | Campaign creation API had no auth | BE | **Fixed** | Added `auth: true` + creator wallet verification. |
| 4 | Root version race condition leading to unhandled 500 | BE | **Fixed** | try/catch on unique constraint now returns clean 409 Conflict. |
| 5 | `treeAddress`/`creator`/`mint` not validated as base58 | BE | **Fixed** | Changed to `base58String` validator. |
| 6 | `root_versions` table missing `minCliffTime` column | DB | **Fixed** | Migration 0010 added `min_cliff_time bigint NOT NULL DEFAULT 0`. |
| 7 | ROOT_ROTATION_GUIDE had wrong PDA seeds | Docs | **Fixed** | Corrected to `["tree", creator, mint, campaignId]`. |
| 8 | Guide incorrectly said SameRoot succeeds on-chain | Docs | **Fixed** | Corrected to say transaction reverts with `SameRoot`. |
| 22 | Out-of-order milestone claiming marks unclaimed milestones as "fully claimed" in UI | FE | **Fixed** | `ClaimWithProofButton.tsx` — milestone leaves now use on-chain `milestoneBitmap` instead of greedy `claimedAmount` allocation for `leafFullyClaimed` and `leafClaimableAmounts`. |
| 23 | `StreamExpired` blocks claims on leaf B after claiming leaf A (larger amount) | SC | **Fixed** | `claim.rs` — removed `fully_claimed` sub-condition that compared cumulative `claimed_amount` against individual `leaf.amount`. StreamExpired now only fires when `effective_now >= end_time`. |
| 24 | `total_entitled` only reflects first leaf amount, never accumulated | SC | **Fixed** | `claim.rs` — `total_entitled` now accumulated for each milestone claim via `checked_add`. Bitmap prevents double-counting. `close_claim_record` check semantically correct for multi-milestone. |
| 25 | No upper-bound validation on `milestoneIdx` (>255 silently truncated by `writeUInt8`) | BE | **Fixed** | `validators.ts` — added `.max(255)` to all 3 milestoneIdx Zod schemas. |
| 26 | Duplicate `(beneficiary, milestoneIdx)` pairs make second leaf permanently unclaimable | BE | **Fixed** | `prepare/route.ts` — added validation that rejects duplicate milestone assignments with 400 error. |
| 27 | VestingProgress API reports milestone tokens as claimable before release | BE | **Fixed** | `vesting-progress/route.ts` — LEFT JOIN with `milestone_events`, zeroes `claimable` for unreleased milestones. |
| 28 | MilestoneReleasePanel shows phantom buttons for non-milestone leaves (used `leafCount`) | FE | **Fixed** | Panel now accepts `milestoneIndices` (derived from actual leaves in API) instead of `leafCount`. |

---

## Known Limitations (documented, not fixed)

| # | Issue | Area | Status | Rationale |
|---|-------|------|--------|-----------|
| 9 | 19 Rust integration tests `#[ignore]`d | SC | Documented | Blocked on Mollusk 0.13.x `init_if_needed`/`Optional<T>` limitations. Upgrade to 0.14+ when available. |
| 10 | 6 SPL CU measurements are estimates | SC | Documented | Mollusk blocked for SPL path instructions. Formal audit needed. |
| 11 | RLS policies are SELECT-only (no write policies) | DB | Documented | Writes use service_role key (bypasses RLS). Safe as long as DATABASE_URL user has owner privileges. |
| 12 | Two different keccak256 npm packages | Merkle | Documented | `js-sha3` in TS client, `keccak256` in web builder. Same output, maintenance risk. |
| 13 | `createdAt` trusted from client input | BE | Documented | Could manipulate campaign ordering. Low severity -- on-chain slot time is source of truth. |
| 14 | Mollusk 0.14 upgrade blocked upstream | SC | Documented | Would unblock 18 ignored tests + enable SPL handler tests. |
| 15 | Sentry DSN not configured in production | Ops | Documented | Scaffolding complete, needs env var in Vercel. |
| 16 | `getAuthenticatedWallet` trusts wallet without re-verification | BE | Documented | Safe when called after `auth: true` routes. No routes call it without auth after P0 fix. |
| 17 | `leaf_count > 1` check only enforced in frontend | SC/FE | Documented | On-chain `update_root` has no leaf count check. Frontend gate prevents single-leaf rotation. |
| 18 | `create_stream` hardcodes `min_cliff_time = 0` | SC | Documented | Safe -- `instant_refund_campaign` requires `leaf_count > 1`, excluding streams. |
| 19 | Native SOL withdraw drains PDA below rent-exempt | SC | Documented | Intentional -- after grace period, campaign is over. PDA not reused. |
| 29 | Cumulative `claimed_amount` undercounts claimable for multi-leaf non-milestone campaigns | SC | Documented | `claim.rs` uses `vested(leaf) - cr.claimed_amount` for cliff/linear. If one beneficiary has multiple cliff/linear leaves, `claimed_amount` is cumulative and can undercount later leaves. Common case unaffected (single leaf per beneficiary, or milestones which bypass subtraction). Fix requires per-leaf tracking — breaking on-chain change. |

---

## Deferred to Week 9+

| # | Issue | Area | Status | Rationale |
|---|-------|------|--------|-----------|
| 20 | k6 load test expansion | BE | Deferred | Existing `api-load.js` covers basic endpoints. |
| 21 | External audit engagement | Ops | Deferred | Budget $15-40K, not an engineering task. |

---

## Notes

- Issue #21 (wallet signature auth on root-versions) was previously tracked as deferred but was resolved as part of fix #2 above.
- All fixed issues have been verified locally and merged to `dev_lana`.
- Known limitations are accepted risks with documented mitigations. No immediate action required.
- Deferred items are intentional -- either resource-dependent (external audit) or low-priority (load test expansion).
