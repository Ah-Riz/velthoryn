# Ship path — remaining work

**Last updated:** 2026-05-18  
**Branch:** `dev_lana` → [PR #30](https://github.com/Ah-Riz/velthoryn/pull/30) (`test`)  
**Current state:** 8/8 acceptance, **79/79** SC localnet, devnet **79 pass / 1 pending** (T64), program upgraded slot **463223253**

---

## 1. Localnet verify (optional gate)

Confirm CI-equivalent green on a fresh validator:

```bash
anchor build
pnpm test:localnet   # expect 79/79 (~3m)
```

Uses `scripts/test-localnet.sh` (deploy to `G6iaig…` before tests). Skip if CI on PR #30 is already green.

---

## 2. Vercel redeploy + production E2E

Backend hardening (all-leaf verify, u64 strings, strict SSL) may not be on production until redeploy.

```bash
# After Vercel deploy from merged branch / manual promote
pnpm tsx scripts/test-be-merkle-parity.ts
pnpm tsx scripts/test-be-merkle-pipeline.ts \
  --url https://velthoryn.vercel.app \
  --timeout 120000
```

| Check | Pass criteria |
|-------|----------------|
| Merkle parity | 13/13 |
| E2E pipeline | 5/5 (prepare → POST → GET proof ×3 → verify) |
| API smoke | `GET /api/campaigns`, beneficiary routes respond |

---

## 3. PR / CI

| Step | Action |
|------|--------|
| Open / refresh | [PR #30](https://github.com/Ah-Riz/velthoryn/pull/30) `dev_lana` → `test` |
| CI | `ci.yml` (build + 79 SC), `web-ci.yml` (parity + E2E + Vitest), `lint.yml` |
| Merge | Into `test` after green + review |
| Grader | Point to [`BE-SC-MERKLE-ACCEPTANCE-STATUS.md`](./BE-SC-MERKLE-ACCEPTANCE-STATUS.md), [`DEVNET_TEST_RESULTS.md`](./DEVNET_TEST_RESULTS.md) |

---

## 4. Loose ends

| Item | Severity | Notes |
|------|----------|--------|
| **T64 on devnet RPC** | Low | `cancel_stream` pending on public devnet (timing/RPC); **passes in bankrun** (`vesting.clock.spec.ts`). Not a logic gap. |
| **`vesting-keypair.json` mismatch** | Medium (ops) | Local file may be `7gphts…`; program ID is `G6iaig…`. Devnet upgrade used wallet `GPfHeZ…`. Use `solana program deploy` with upgrade authority or restore CI keypair secret — do not commit keypair. |
| **Vercel env / redeploy** | Medium | Production API must match latest `apps/web` + IDL after SC changes. |
| **Grader docs** | Low | Ensure README + acceptance doc linked in submission; 8/8 table is source of truth. |

---

## 5. Optional — frontend `setMilestoneReleased`

| Area | Status |
|------|--------|
| On-chain | `set_milestone_released` live; T63 enforces `MilestoneNotReleased` |
| API / DB | Milestone leaves stored; proofs served via existing routes |
| UI | **Not wired** — creator must call instruction from CLI/script today |

If grader demos milestone unlock from UI:

1. Add Anchor client helper in `apps/web/src/lib/anchor/`
2. Creator-only button on `/campaign/[treeAddress]` when `releaseType === Milestone`
3. Refresh claim/withdraw state after tx confirmation

Not required for 8/8 SC acceptance or BE–SC Merkle E2E.

---

## Suggested order

1. Push `dev_lana` + confirm PR #30 CI  
2. Redeploy Vercel → run E2E against production URL  
3. Merge to `test`  
4. (Optional) `pnpm test:localnet` locally  
5. (Optional) frontend milestone release + T64 devnet investigation
