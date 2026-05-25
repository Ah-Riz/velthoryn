# Weekly Report — Lana (Week 6)

## What I built this week

**Native SOL vesting: dual-path architecture allowing vesting campaigns in raw SOL without wrapping to wSOL. 3 new on-chain instructions (`create_campaign_native`, `create_stream_native`, `fund_campaign_native`), inline native SOL branching across 4 existing instructions (`claim`, `withdraw`, `cancel_stream`, `withdraw_unvested`), 2 new error variants, and 12 integration tests covering the full native SOL lifecycle. Research report and IDL updated.**

### Native SOL Vesting — Full Implementation

**Problem**: BD/marketing flagged the SOL → wSOL wrapping step as a conversion killer. Users bounced when they saw "Wrap required" — especially non-crypto-native campaign creators.

**Solution**: Dual-path architecture. When `VestingTree.mint == NATIVE_SOL_MINT` (all-zeros pubkey), the campaign holds lamports directly in the PDA instead of a vault ATA. No token accounts, no mint, no vault_authority PDA needed.

#### New on-chain instructions (3 separate handlers)

| Instruction | Account struct | Key difference from SPL path |
|---|---|---|
| `create_campaign_native` | `CreateCampaignNative` | No mint, no vault ATA, no vault_authority. PDA seeds use `NATIVE_SOL_MINT` instead of mint pubkey. |
| `create_stream_native` | `CreateStreamNative` | Same simplification. Funds via `system_program::transfer` CPI instead of `token::transfer`. |
| `fund_campaign_native` | `FundCampaignNative` | `system_program::transfer` from creator to PDA. Tracks funded amount via PDA lamports minus rent-exempt minimum. |

#### Inline native branching (4 existing handlers)

These handlers check `tree.is_native()` and branch at the transfer point. SPL-specific accounts are now `Option<T>` — present for SPL campaigns, sentinel (`PROGRAM_ID`) for native SOL campaigns.

| Handler | Branch logic |
|---|---|
| `claim` | Native: direct lamport debit from PDA to beneficiary. SPL: existing `token::transfer` CPI via vault_authority signer seeds. |
| `withdraw` | Same dual-path as claim. Single-stream path, no Merkle proof. |
| `cancel_stream` | Native: splits PDA lamports — vested to beneficiary, remainder to creator. SPL: existing dual CPI transfer. |
| `withdraw_unvested` | Native: drains all remaining PDA lamports (minus rent-safe floor) to creator. SPL: existing vault → creator_ata CPI. |

#### State changes

- `state/vesting_tree.rs`: Added `NATIVE_SOL_MINT` constant (`Pubkey::new_from_array([0u8; 32])`) and `is_native()` helper method
- `state/mod.rs`: Re-exports `NATIVE_SOL_MINT`
- `errors.rs`: 2 new variants — `NativeSolVaultNotEmpty` (6036), `NativeSolRentViolation` (6037)
- Total error variants: 36 (was 34)

#### Rent accounting

The VestingTree PDA holds both vesting lamports AND rent-exempt minimum. All native SOL paths use explicit rent tracking:

```rust
let rent_min = Rent::get()?.minimum_balance(pda_info.data_len());
let available = pda_info.lamports().saturating_sub(rent_min);
```

Final claim/cancel drains ALL lamports (including rent) and lets the account close naturally.

#### Token-agnostic code (unchanged)

- `math/schedule.rs` — vesting calculations (cliff/linear/milestone)
- `math/merkle.rs` — proof verification
- `state/leaf.rs` — VestingLeaf structure
- Events, error codes (except 2 new native SOL variants)

### Research Report

`docs/NATIVE_SOL_VESTING.md` — comprehensive research covering:
- Why wrapping exists and UX problems it causes
- How native SOL transfers work on-chain (direct lamport manipulation vs system_program::transfer CPI)
- Architecture design with discriminator strategy and rent accounting
- Cost comparison: ~0.0045 SOL savings per campaign in rent
- Security considerations (lamport overflow, rent/lamport mixing, PDA closure edge cases)
- How major protocols handle this (Streamflow deprecated their native SOL path)
- Phased implementation plan
- Recommendation: implement dual-path, start with single-recipient (`create_stream`)

### Test Suite — Native SOL (12 tests)

`tests/vesting-native-sol.spec.ts` (1,208 lines) — full lifecycle coverage using solana-bankrun:

| Test | What it verifies |
|---|---|
| `create_stream with native SOL funds the PDA` | Stream creation + SOL deposit + state validation |
| `withdraw partial vested SOL from stream` | Partial withdrawal, PDA lamports decrease, beneficiary receives SOL |
| `withdraw final vested SOL drains PDA to zero` | Full claim drains PDA including rent |
| `cancel native SOL stream splits lamports correctly` | Vested → beneficiary, unvested → creator |
| `create_campaign with native SOL succeeds` | Multi-recipient campaign creation with Merkle root |
| `fund_campaign with native SOL transfers lamports to PDA` | Additional funding via system_program::transfer |
| `claim from native SOL campaign transfers lamports to beneficiary` | Merkle proof + native SOL claim |
| `withdraw_unvested from cancelled native SOL campaign` | Post-grace-period drain to creator |
| `over-claim on native SOL fails` | Error guard: `InsufficientVault` |
| `claim before cliff on native SOL returns NothingToClaim` | Schedule enforcement |
| `cancel by non-creator fails` | Authority guard: `Unauthorized` |
| `fund beyond total_supply on native SOL fails` | Over-funding guard: `OverFunded` |

### IDL and CI Updates

- `apps/web/src/lib/anchor/idl.json` — synced with all 17 instructions (was 14)
- `tests/vesting.spec.ts` — IDL scaffold test updated: expects 17 instructions
- `.github/workflows/ci.yml` — new job step: `pnpm exec ts-mocha ... 'tests/vesting-native-sol.spec.ts'`
- Instruction count: **17** (14 original + 3 native SOL variants)

---

## Status — What works and what doesn't

### Working

| Item | Evidence |
|---|---|
| Native SOL `create_stream_native` | On-chain handler + test passing (bankrun) |
| Native SOL `withdraw` from SOL stream | Inline branch in existing handler + test |
| Native SOL `cancel_stream` splits lamports | Inline branch + test |
| Native SOL `create_campaign_native` | Separate handler + test |
| Native SOL `fund_campaign_native` | Separate handler + test |
| Native SOL `claim` from campaign | Inline branch + Merkle proof test |
| Native SOL `withdraw_unvested` | Inline branch + test |
| All 12 native SOL tests | bankrun-based, full lifecycle |
| All 86 existing SPL tests | Unaffected, still passing |
| Devnet deployment | Upgraded slot **464782646**, 93 passing + 9 pending (bankrun-only) |
| IDL synced | 17 instructions in idl.json |
| Research report | `docs/NATIVE_SOL_VESTING.md` complete |
| `anchor build` | Compiles clean |

### Not yet done

| Item | Status |
|---|---|
| Frontend integration for native SOL | Not started — client hooks need SOL branching |
| Native SOL audit | Deferred to post-implementation |

---

## Blockers — What's stuck or what you need

**No blockers.** Native SOL deployed to devnet (slot 464782646), all tests passing. Remaining work is frontend integration.

---

## Metrics — Quantifiable progress

| Metric | Value |
|---|---|
| Instructions (total) | **17** (was 14; +3 native SOL variants) |
| New instruction handlers | 3 (`create_campaign_native`, `create_stream_native`, `fund_campaign_native`) |
| Modified instruction handlers | 4 (`claim`, `withdraw`, `cancel_stream`, `withdraw_unvested`) |
| Error variants | **36** (was 34; +`NativeSolVaultNotEmpty`, `NativeSolRentViolation`) |
| Native SOL tests | **12** (1,208 lines) |
| Existing SPL tests | 86 (unchanged) |
| Total test cases | **98** (86 SPL + 12 native SOL) |
| Research report | `docs/NATIVE_SOL_VESTING.md` (387 lines) |
| Rust source (instruction changes) | +1,105 lines across 8 files |
| Week 5 → Week 6 delta | 14 → 17 instructions, 34 → 36 errors, 0 → 12 native SOL tests, new research doc, dual-path transfer architecture |

---

## Next steps

1. ~~Run `anchor build && pnpm test:localnet` to verify all 98 tests pass together~~ **Done** — 12/12 native SOL + 86/86 SPL
2. ~~Deploy native SOL program to devnet~~ **Done** — slot 464782646, 93 passing + 9 pending
3. Frontend: branch `useCreateStream` / `useCreateCampaign` for native SOL path
4. Remove "Wrap required" badge from TokenPicker for SOL selection
5. Post-deployment E2E test with real SOL on devnet
