# Tasks: SC Remediation & Pre-Launch Fixes

**Phase:** 00
**Blocks:** P0, F1-F4, P2
**Owner:** Lana (SC/BE lead)

---

## 00.1 — Fix cancel_campaign to reset paused state

- [ ] Open `programs/vesting/src/instructions/cancel_campaign.rs`
- [ ] After `tree.cancelled_at = Some(cancelled_at);` add `tree.paused = false;`
- [ ] Rebuild: `anchor build`
- [ ] **Verify:** Build succeeds without warnings

## 00.2 — Defense-in-depth: allow claims when cancelled+paused

- [ ] Open `programs/vesting/src/instructions/claim.rs`
- [ ] Change line 67 from:
  ```rust
  require!(!tree.paused, VestingError::CampaignPaused);
  ```
  to:
  ```rust
  require!(
      !tree.paused || tree.cancelled_at.is_some(),
      VestingError::CampaignPaused
  );
  ```
- [ ] Open `programs/vesting/src/instructions/withdraw.rs`
- [ ] Change line 74 to same pattern
- [ ] Open `programs/vesting/src/instructions/cancel_stream.rs`
- [ ] Change line 82 to same pattern
- [ ] Rebuild: `anchor build`
- [ ] **Verify:** Build succeeds without warnings

## 00.3 — Add test: pause→cancel→claim during grace

- [ ] Open `tests/vesting.supplementary.spec.ts`
- [ ] Add test T69:
  - Create campaign with beneficiary
  - Pause campaign
  - Cancel campaign (while paused)
  - Fetch VestingTree account, assert `paused == false`
  - Advance time 3 days (mid-grace)
  - Beneficiary calls claim
  - Assert claim succeeds
  - Assert amount equals `vestedAt(schedule, cancelledAt)`
- [ ] Run: `anchor test`
- [ ] **Verify:** T69 passes; all existing tests still pass

## 00.4 — Add test: cancel resets paused field

- [ ] Open `tests/vesting.supplementary.spec.ts`
- [ ] Add test T70:
  - Create campaign, pause it
  - Fetch tree, assert `paused == true`
  - Cancel campaign
  - Fetch tree, assert `paused == false` and `cancelledAt.isSome()`
- [ ] Run: `anchor test`
- [ ] **Verify:** T70 passes

## 00.5 — Add clock test: pause→cancel→claim with precise timestamps

- [ ] Open `tests/vesting.clock.spec.ts`
- [ ] Add clock-based test:
  - Create linear campaign with bankrun
  - Pause at T1
  - Cancel at T2 (50% through schedule)
  - Advance to T2+3days (mid-grace)
  - Beneficiary claims
  - Assert amount = 50% of total (vested at cancelled_at, not current time)
  - Advance past grace
  - Creator calls withdraw_unvested
  - Assert creator gets remaining 50%
- [ ] Run: `anchor test`
- [ ] **Verify:** Clock test passes with precise amounts

## 00.6 — Add security test: exploit blocked

- [ ] Open `tests/security.spec.ts`
- [ ] Add EXPLOIT 12:
  - Pause campaign
  - Cancel campaign
  - Verify paused is reset (tree.paused == false)
  - Beneficiary claims successfully during grace
  - Verify this was previously an exploit vector
- [ ] Run: `anchor test`
- [ ] **Verify:** EXPLOIT 12 passes

## 00.7 — Full regression test

- [ ] Run: `anchor test` — all tests pass (87/87 or 86/86 + new)
- [ ] Run: `pnpm test:localnet` — SC tests pass on localnet
- [ ] Run: `pnpm --dir apps/web test` — web tests unaffected
- [ ] Run: `pnpm --dir apps/web lint` — no new warnings
- [ ] **Verify:** Zero regressions across all suites

## 00.8 — Redeploy to devnet

- [ ] Run: `anchor build`
- [ ] Run: `anchor deploy --provider.cluster devnet`
- [ ] Verify program ID unchanged: `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`
- [ ] Test pause→cancel→claim flow on devnet via explorer or CLI
- [ ] **Verify:** Devnet deployment successful; exploit flow confirmed fixed

## 00.9 — Define API route trust boundaries

- [ ] Write trust boundary document for Geral:
  - `POST /api/campaigns` → wallet signature required
  - `POST /api/campaigns/[treeAddress]/root-versions` → wallet signature required
  - `PATCH /api/campaigns/[treeAddress]/status` → **remove route** (status from indexer only)
  - `POST /api/claims/sync` → admin key (existing, acceptable)
- [ ] Share with Geral for P0.2 implementation
- [ ] **Verify:** Document committed, Geral acknowledges

## 00.10 — Update on-chain documentation

- [ ] Update `docs/SECURITY.md` — document exploit + fix
- [ ] Update `docs/PDD_LANA.md` — reflect paused-reset behavior
- [ ] Update `docs/TDD_LANA.md` — add new test IDs (T69, T70, EXPLOIT 12)
- [ ] Update `docs/AUDIT_REPORT.md` — add exploit finding + resolution
- [ ] Update `docs/MATURITY_REPORT.md` — reflect updated test count
- [ ] **Verify:** All docs consistent with code changes

---

## Verification checklist

- [ ] `cancel_campaign` resets `paused = false`
- [ ] `claim` allows claims on cancelled+paused campaigns
- [ ] `withdraw` allows withdrawals on cancelled+paused campaigns
- [ ] `cancel_stream` allows on cancelled+paused campaigns
- [ ] T69 (pause→cancel→claim) passes
- [ ] T70 (cancel resets paused) passes
- [ ] Clock test with precise timestamps passes
- [ ] EXPLOIT 12 (exploit blocked) passes
- [ ] All existing 86 tests pass unchanged
- [ ] Devnet redeployed and verified
- [ ] API trust boundaries documented
- [ ] On-chain docs updated
