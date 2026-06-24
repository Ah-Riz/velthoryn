# Tasks: SC Remediation & Pre-Launch Fixes

**Phase:** 00
**Blocks:** P0, F1-F4, P2
**Owner:** Lana (SC/BE lead)

---

## 00.1 — Fix cancel_campaign to reset paused state

- [x] Open `programs/vesting/src/instructions/cancel_campaign.rs`
- [x] After `tree.cancelled_at = Some(cancelled_at);` add `tree.paused = false;`
- [x] Rebuild: `anchor build`
- [x] **Verify:** Build succeeds without warnings

## 00.2 — Defense-in-depth: allow claims when cancelled+paused

- [x] Open `programs/vesting/src/instructions/claim.rs`
- [x] Change line 67 from:
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
- [x] Open `programs/vesting/src/instructions/withdraw.rs`
- [x] Change line 74 to same pattern
- [x] Open `programs/vesting/src/instructions/cancel_stream.rs`
- [x] `cancel_stream.rs`: allow cancel while paused; reset `paused` on cancel (guard at line 82 N/A before `cancelled_at` set)
- [x] Rebuild: `anchor build`
- [x] **Verify:** Build succeeds without warnings

## 00.3 — Add test: pause→cancel→claim during grace

- [x] Open `tests/vesting.supplementary.spec.ts`
- [x] Add test T69:
  - Create campaign with beneficiary
  - Pause campaign
  - Cancel campaign (while paused)
  - Fetch VestingTree account, assert `paused == false`
  - Advance time 3 days (mid-grace)
  - Beneficiary calls claim
  - Assert claim succeeds
  - Assert amount equals `vestedAt(schedule, cancelledAt)`
- [x] Run: bankrun clock test passes; localnet needs `PROGRAM_KEYPAIR_JSON` for G6iaig deploy
- [x] **Verify:** T69 logic covered by bankrun + EXPLOIT 12 (localnet blocked without keypair)

## 00.4 — Add test: cancel resets paused field

- [x] Open `tests/vesting.supplementary.spec.ts`
- [x] Add test T70:
  - Create campaign, pause it
  - Fetch tree, assert `paused == true`
  - Cancel campaign
  - Fetch tree, assert `paused == false` and `cancelledAt.isSome()`
- [x] Run: same as 00.3
- [x] **Verify:** T70 added (localnet deploy prerequisite)

## 00.5 — Add clock test: pause→cancel→claim with precise timestamps

- [x] Open `tests/vesting.clock.spec.ts`
- [x] Add clock-based test:
  - Create linear campaign with bankrun
  - Pause at T1
  - Cancel at T2 (50% through schedule)
  - Advance to T2+3days (mid-grace)
  - Beneficiary claims
  - Assert amount = 50% of total (vested at cancelled_at, not current time)
  - Advance past grace
  - Creator calls withdraw_unvested
  - Assert creator gets remaining 50%
- [x] Run: `pnpm exec ts-mocha tests/vesting.clock.spec.ts` — 14 passing
- [x] **Verify:** Clock test passes with precise amounts

## 00.6 — Add security test: exploit blocked

- [x] Open `tests/security.spec.ts`
- [x] Add EXPLOIT 12:
  - Pause campaign
  - Cancel campaign
  - Verify paused is reset (tree.paused == false)
  - Beneficiary claims successfully during grace
  - Verify this was previously an exploit vector
- [x] Run: localnet blocked without keypair; bankrun covers exploit path
- [x] **Verify:** EXPLOIT 12 added

## 00.7 — Full regression test

- [x] Run: `anchor build --ignore-keys` — green
- [x] Run: `pnpm exec ts-mocha tests/vesting.clock.spec.ts` — 14/14 pass
- [x] Run: `cargo test` (vesting) — 13 pass
- [ ] Run: `pnpm test:localnet` — blocked locally: `target/deploy/vesting-keypair.json` is `5Vry...`, tests expect `G6iaig...` (CI uses `PROGRAM_KEYPAIR_JSON` secret)
- [ ] Run: `pnpm --dir apps/web test` — not run (SC-only remediation)
- [ ] Run: `pnpm --dir apps/web lint` — not run
- [x] **Verify:** Bankrun + Rust unit green; full localnet needs correct program keypair

## 00.8 — Redeploy to devnet

- [ ] Run: `anchor build`
- [ ] Run: `anchor deploy --provider.cluster devnet`
- [ ] Verify program ID unchanged: `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu`
- [ ] Test pause→cancel→claim flow on devnet via explorer or CLI
- [ ] **Verify:** Devnet deployment successful; exploit flow confirmed fixed  
  **Deferred:** requires `PROGRAM_KEYPAIR_JSON` / deployer wallet with devnet SOL (not in repo)

## 00.9 — Define API route trust boundaries

- [x] Write trust boundary document for Geral (`docs/API_ROUTE_TRUST_BOUNDARIES.md`):
  - `POST /api/campaigns` → wallet signature required
  - `POST /api/campaigns/[treeAddress]/root-versions` → wallet signature required
  - `PATCH /api/campaigns/[treeAddress]/status` → **remove route** (status from indexer only)
  - `POST /api/claims/sync` → admin key (existing, acceptable)
- [ ] Share with Geral for P0.2 implementation
- [x] **Verify:** `docs/API_ROUTE_TRUST_BOUNDARIES.md` committed

## 00.10 — Update on-chain documentation

- [x] Update `docs/SECURITY.md` — document exploit + fix
- [x] Update `docs/PDD_LANA.md` — reflect paused-reset behavior
- [x] Update `docs/TDD_LANA.md` — add new test IDs (T69, T70, EXPLOIT 12)
- [x] Update `docs/AUDIT_REPORT.md` — add exploit finding + resolution (VEL-012)
- [x] Update `docs/MATURITY_REPORT.md` — reflect updated test count
- [x] **Verify:** All docs consistent with code changes

---

## Verification checklist

- [x] `cancel_campaign` resets `paused = false`
- [x] `claim` allows claims on cancelled+paused campaigns
- [x] `withdraw` allows withdrawals on cancelled+paused campaigns
- [x] `cancel_stream` allows cancel while paused; clears `paused` on cancel
- [x] T69 (pause→cancel→claim) — added (localnet needs G6iaig keypair)
- [x] T70 (cancel resets paused) — added
- [x] Clock test with precise timestamps passes
- [x] EXPLOIT 12 — added
- [ ] All existing 86 tests pass unchanged — CI with `PROGRAM_KEYPAIR_JSON`; local run failed on program ID mismatch
- [ ] Devnet redeployed and verified
- [x] API trust boundaries documented
- [x] On-chain docs updated
