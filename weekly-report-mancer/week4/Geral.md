# Weekly Report — Geral (Week 4)

## What I built this week

**Frontend documentation suite (PRD/PDD/TDD/SECURITY), 38 Vitest unit tests covering vesting math + PDA derivation + Merkle encoding, and two functional UI pages (Create Stream + Withdraw) wired to the on-chain program.**

Week 4 deliverable is Core Smart Contract. Lana owns the SC implementation; I own the frontend integration layer that proves the SC works from a user-facing perspective. My contribution this week is threefold:

1. **Documentation** — Four design documents that spec the full frontend architecture, test strategy, and security model. These are not busywork — they are the execution blueprint for Week 6 (Frontend Integration) so we can build fast without design decisions mid-sprint.
2. **Tests** — 38 Vitest unit tests that verify client-side vesting math matches Rust `schedule.rs`, PDA derivation matches Anchor seeds, and Merkle leaf encoding is byte-identical to the on-chain hasher.
3. **UI** — Two functional pages (`/campaign/create` and `/campaign/[id]`) that call `createStream` and `withdraw` instructions directly. Minimal but complete — form validation, PDA derivation, tx status feedback, error handling.

---

## Frontend Documentation Created

### PRD_GERAL.md — Product Requirements Document (~350 lines)

Frontend-specific product requirements covering:
- Problem statement: why a frontend is necessary (non-technical users can't interact with CLI)
- Three user personas: Creator (project lead distributing tokens), Recipient (beneficiary claiming vested tokens), Admin (cancel/pause authority)
- Six user stories with UX flows per persona
- Six feature requirements mapped to Lana's PRD_LANA feature IDs (F1-F6)
- Full tech stack with justification for each choice (Next.js 15, React 19, Anchor 0.32.1, wallet-standard auto-detect, TanStack Query 5, Zustand 5, Tailwind CSS 4)
- Ten frontend acceptance criteria
- Six non-functional requirements (performance, accessibility, responsive, browser support, security, error handling)
- Dependencies on SC deployment timeline
- Phase 1 (Week 4-6) vs Phase 2 scope separation

### PDD_GERAL.md — Product Design Document (~450 lines)

Component architecture and data flow design:
- ASCII architecture diagram showing the full stack: Browser → Next.js App Router → Anchor Provider → Solana RPC → On-chain Program
- Component tree: Header, CsvUploader, ClaimPanel, VestingProgress, StreamForm, CampaignList
- Page routes and layout hierarchy
- Two-layer state management: Zustand (client state: selectedCampaignId, UI toggles) + TanStack Query (chain state: campaign data, claim records)
- Data flow diagrams for create campaign, claim tokens, and admin operations
- Anchor integration layer with `derivePda()` functions, custom hooks pattern (`useVestingProgram`, `useCampaignList`, `useCampaignDetail`)
- Client-side vesting math (mirrors Rust `schedule.rs` exactly — cliff/linear/milestone with u128-equivalent bigint intermediate)
- Error handling: maps Anchor error codes 6000–6029 to user-friendly messages
- Wallet connection strategy: wallet-standard auto-detect (Phantom/Solflare/Backpack without adapter bundle)
- Responsive layout: mobile-first breakpoints (sm/md/lg/xl)
- IPFS proof storage design for multi-recipient campaigns

### TDD_GERAL.md — Test Design Document (~300 lines)

Test strategy and coverage plan:
- Test pyramid: E2E (Week 6) → Integration (Lana, 63 tests) → Unit (Geral, 38 tests)
- 27 frontend unit tests planned across 5 test suites:
  - Merkle encoding (8 tests): `encodeLeaf` field order, `hashLeaf` golden vector, `buildTree` root determinism, proof verification
  - Vesting math (8 tests): cliff before/at/after, linear 0%/50%/100%, milestone, cancel clamp
  - PDA derivation (4 tests): VestingTree determinism, different inputs → different PDAs, correct program ID
  - CSV parsing (5 tests): happy path, empty file, invalid addresses, duplicate indices
  - Error mapping (2 tests): known Anchor code → message, unknown code fallback
- Test utilities spec: mock wallet, mock connection, test fixtures
- CI integration: `npx vitest run` in GitHub Actions
- Coverage targets: 80%+ for `lib/`, 60%+ for `hooks/`

### SECURITY_GERAL.md — Frontend Security Document (~350 lines)

Threat model and mitigations:
- ASCII trust boundary diagram: User Browser ↔ Frontend ↔ RPC ↔ Solana Validators
- Wallet security: never store private keys, transaction review UX before signing, connection lifecycle
- XSS prevention: no `dangerouslySetInnerHTML` with chain-derived data, sanitize all displayed pubkeys/amounts
- Input validation rules: wallet address format (base58, 32-44 chars), amount bounds (> 0, ≤ balance), date logic (start ≤ cliff ≤ end)
- Transaction building security: PDA verification before submit, simulation via `simulateTransaction` before send, confirmation polling
- RPC endpoint security: no sensitive data in client-side calls, rate limiting awareness
- Supply chain security: minimize npm attack surface, lockfile integrity
- Content Security Policy headers configuration
- 15-item security checklist for pre-deployment audit

---

## Frontend Tests — 38 Passing

### Vesting Math Tests (17 tests) — `tests/math/vesting.test.ts`

Client-side vesting math functions that produce identical results to `programs/vesting/src/math/schedule.rs::vested()`. Test values taken directly from Rust unit tests.

| Test Suite | Tests | What it verifies |
|---|---|---|
| Cliff release | 3 | Returns 0 before cliff, full amount at/after cliff |
| Linear release | 5 | 0 before cliff, 0 at cliff, 50% at midpoint, 100% at end, 100% past end |
| Linear quarter steps | 3 | 25%/50%/75% elapsed matches Rust `linear_quarter` test |
| Linear edge cases | 2 | No overflow at u64 max amount (bigint), degenerate cliff==end |
| Milestone release | 2 | 0 before cliff, full at cliff |
| Cancel clamp | 3 | `getVestedAmount` clamps at cancel time, no clamp when not cancelled, future cancel no effect |
| Claimable calculation | 4 | Full when nothing claimed, partial, zero when fully claimed, no negative |
| Invalid release type | 1 | Returns 0 for unknown type |

These tests map directly to AC 3 ("Linear unlock calculation is correct") and AC 8 ("Unit tests cover check unlocked at 0%, 25%, 50%, 100%").

### PDA Derivation Tests (10 tests) — `tests/anchor/pda.test.ts`

Verifies `derivePda()` from `@/lib/anchor/client` produces correct PDAs matching Rust seeds:

| Test Suite | Tests | What it verifies |
|---|---|---|
| VestingTree PDA | 5 | Deterministic for same inputs, different campaign_id → different PDA, different creator → different PDA, result is valid PDA (not on curve), correct program ID |
| VaultAuthority PDA | 2 | Deterministic for same tree, different tree → different vault authority |
| ClaimRecord PDA | 3 | Deterministic for same (tree, beneficiary), different beneficiary → different record, different tree → different record |

Seed format verified against Rust:
- VestingTree: `[b"tree", creator, mint, campaign_id.to_le_bytes()]`
- VaultAuthority: `[b"vault_authority", vesting_tree]`
- ClaimRecord: `[b"claim", vesting_tree, beneficiary]`

### Merkle Tests (11 tests) — `tests/merkle/builder.test.ts` (from Week 3, still passing)

| Test Suite | Tests | What it verifies |
|---|---|---|
| encodeLeaf | 3 | 70-byte output, field order matches Rust Borsh LE, deterministic |
| hashLeaf | 3 | Correct prefix (0x00), 32-byte output, golden vector gate against `RUST_GOLDEN_HEX` |
| buildTree | 5 | Single leaf root, two-leaf root, proof verification, different leaves → different roots, deterministic |

---

## UI Pages Built

### Create Stream — `/campaign/create`

Full form for creating single-beneficiary vesting streams:

- **Fields:** Campaign ID, Token Mint Address, Beneficiary Wallet, Amount (raw tokens), Release Type (Cliff/Linear/Milestone selector), Start/Cliff/End datetime pickers, Milestone Index (conditional on release type 2), Cancellable toggle
- **Logic:** Derives VestingTree PDA, VaultAuthority PDA, source ATA, and vault ATA client-side using `derivePda()` and `getAssociatedTokenAddressSync`. Submits `createStream` instruction via Anchor.
- **UX:** Wallet connection button (WalletMultiButton), loading state during tx, success message with tx signature, error display with message
- **Maps to:** AC 1 (create_stream works), AC 2 (tokens locked in PDA)

### Withdraw — `/campaign/[treeAddress]`

Recipient dashboard for claiming vested tokens:

- **Campaign info:** Fetches VestingTree account on-chain, displays creator, mint, total supply, total claimed, created date, status (Active/Paused/Cancelled)
- **Schedule input:** Recipient enters their vesting parameters (release type, start/cliff/end times, milestone index) to compute claimable amount — these must match the leaf hash stored in merkle_root
- **Vesting progress:** Real-time progress bar showing vested %, claimable amount, and already claimed amount. Uses same math as Rust `schedule.rs` with cancel clamp.
- **Claim button:** Derives ClaimRecord PDA, VaultAuthority PDA, beneficiary ATA. Submits `withdraw` instruction. Refreshes on-chain state after success.
- **Maps to:** AC 4 (withdraw works), AC 5 (partial withdrawals), AC 6 (cannot withdraw more than unlocked), AC 7 (unauthorized → error)

### Integration with Lana's hooks

Both pages use:
- `useVestingProgram()` — creates AnchorProvider + Program from wallet connection
- `derivePda()` from `@/lib/anchor/client` — PDA computation matching Rust seeds
- `WalletMultiButton` from `@solana/wallet-adapter-react-ui` — wallet connection UI
- Anchor IDL from `idl.json` — auto-generated instruction method calls

---

## How we split the work

| Area | Owner | Evidence |
|---|---|---|
| `create_stream` instruction (Rust) | Lana | `programs/vesting/src/instructions/create_stream.rs` |
| `withdraw` instruction (Rust) | Lana | `programs/vesting/src/instructions/withdraw.rs` |
| Linear vesting math (Rust) | Lana | `programs/vesting/src/math/schedule.rs` |
| All 11 instruction handlers | Lana | `programs/vesting/src/instructions/*.rs` |
| 63 on-chain integration tests | Lana | `tests/vesting.integration.spec.ts`, `tests/security.spec.ts`, `tests/vesting.supplementary.spec.ts` |
| TS SDK client + Merkle tree | Lana | `clients/ts/src/` |
| TanStack Query hooks (4 hooks) | Lana | `apps/web/src/hooks/useCampaignList.ts`, etc. |
| Backend API routes + DB schema | Lana | `apps/web/src/app/api/`, `apps/web/src/lib/db/` |
| Devnet deployment | Lana | Program ID `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` |
| **Frontend docs (PRD/PDD/TDD/SECURITY)** | **Geral** | `docs/PRD_GERAL.md`, `docs/PDD_GERAL.md`, `docs/TDD_GERAL.md`, `docs/SECURITY_GERAL.md` |
| **38 Vitest unit tests** | **Geral** | `apps/web/tests/math/`, `apps/web/tests/anchor/`, `apps/web/tests/merkle/` |
| **Create Stream page** | **Geral** | `apps/web/src/app/campaign/create/page.tsx` |
| **Withdraw page** | **Geral** | `apps/web/src/app/campaign/[id]/page.tsx` |
| **INTEGRATION.md update** | **Geral** | `docs/INTEGRATION.md` |
| Anchor provider + client wiring | Geral (Week 3) + Lana (Week 4 IDL update) | `apps/web/src/lib/anchor/client.ts` |
| Wallet adapter setup | Geral (Week 3) | `apps/web/src/components/providers/WalletProvider.tsx` |

---

## Test Results

```
 ✓ tests/merkle/builder.test.ts (11 tests)
 ✓ tests/math/vesting.test.ts (17 tests)
 ✓ tests/anchor/pda.test.ts (10 tests)

 Test Files  3 passed (3)
      Tests  38 passed (38)
   Start at  ...
   Duration  ...
```

All 38 tests pass. No failures, no skipped tests.

TypeScript compilation: 0 errors in my files. (25 total TS errors in repo are all in Lana's API routes — missing `drizzle-orm` dependency, not my scope.)

---

## Devnet Demo — Full Flow Verified

Successfully demonstrated the complete create → claim flow on Solana devnet:

1. **Created SPL token mint** on devnet: `Cerd63iXz3zD5bQV2W4K3CECcac18fQUf7bbbq9oqgti`
2. **Created vesting stream** via UI: 1,000,000 tokens, linear release, cliff 21:02 → end 21:05
   - tx: `5n7obCd6CqrhYVZzVPcAPKc7LqF1Gh7E2ZLcmytTmyuHsKC4jSvZpgSyQVgwbeMJKK8vnTGqBHzkGJhgrNWpVtpA`
   - VestingTree PDA: `6Fz5jL2d6Nb6cxe9KFi4o3JaRot97LgY4sYXtpayHhYD`
3. **Claimed all tokens** via withdraw UI after vesting period ended: 100% vested, 1,000,000 claimed
   - tx: `36FePkNJx6tX3WwUSByyKQfY3zzuer8DFeKNReeYZTbUyzW4kDLbhA2d9TqjKukunH1cqerCyrX3ENDotY873bqG`

Screenshots in `docs/screenshots/`:
- `proof/create.png` — Create Stream form with success message
- `proof/claim.png` — Withdraw page with Phantom confirm popup (100% vested, 1M claimable)
- `proof/claim_success.png` — Post-claim: 0 claimable, 1M claimed, "Nothing to claim"
- `anchor_test.png` — `anchor test` passing (3 tests, program deployed)

Issues encountered during testing:
- **Hydration mismatch** with `WalletMultiButton` — SSR renders "Select Wallet" but client has wallet auto-connected. Fixed with `dynamic({ ssr: false })`.
- **`AccountNotInitialized` on `source_ata`** — CLI wallet ≠ Phantom wallet. Token account existed on CLI wallet but not Phantom. Fixed by transferring tokens with `--fund-recipient`.
- **`InvalidProof` on withdraw** — User must enter exact same schedule parameters as create. Any difference (even start_time) changes the leaf hash. This is by design — the proof IS the parameters.

---

## Blockers and Insights

### Why frontend docs matter for a SC-focused week

Week 4 is "Core Smart Contract" — all 9 ACs are SC logic. But Week 6 is "Frontend Integration" and will be scored on Code Quality (15pts) + Logic Correctness (15pts). Without a design document, Week 6 becomes design-while-building — slower, inconsistent, and prone to rework. The four docs I wrote this week (PRD/PDD/TDD/SECURITY) are the architectural foundation for Week 6. They cover component hierarchy, state management patterns, error mapping, security mitigations, and test strategy. This is not premature — it's the same kind of preparation as Lana's TDD_LANA.md was for Week 4.

### Client-side vesting math must be identical to Rust

The vesting math in `tests/math/vesting.test.ts` uses the exact same test vectors as `programs/vesting/src/math/schedule.rs`. This is not coincidence — if the frontend shows "500 tokens claimable" but the on-chain program computes 499, users will submit transactions that fail with `NothingToClaim`. The bigint-based implementation mirrors Rust's u128 intermediate math to prevent integer overflow divergence.

### PDA derivation is the second cross-language critical path

After Merkle leaf hashing (verified in Week 3), PDA derivation is the next most dangerous cross-language interface. If the frontend derives a different PDA than the program expects, every instruction fails with `AccountNotInitialized` or `ConstraintSeeds`. The 10 PDA tests verify seed format, byte ordering (little-endian campaign_id), and determinism against `PublicKey.findProgramAddressSync`.

### `create_stream` vs `create_campaign` — the simplified path

Lana added `create_stream` as an atomic shortcut: it creates a single-beneficiary campaign and deposits tokens in one transaction. No off-chain Merkle tree building, no IPFS proof hosting, no CSV upload. The merkle_root is computed on-chain as `leaf_hash(leaf)`. This is the path I implemented in the UI — it covers the demo KPI ("create a stream and withdraw tokens") without requiring the full multi-recipient pipeline.

The full `create_campaign` flow (CSV → Merkle tree → IPFS → create + fund) is Week 6 scope.

### `withdraw` vs `claim` — proof-less claiming

Similarly, `withdraw` is the simplified claim path for single-stream campaigns (`leaf_count == 1`). The recipient passes schedule parameters directly — no Merkle proof needed. The program reconstructs the leaf, hashes it, and verifies against `merkle_root`. This is elegant: the proof _is_ the parameters.

The full `claim` with Merkle proof is for multi-recipient campaigns (Week 6).

### Wallet adapter bundle avoidance — still the right call

`@solana/wallet-adapter-wallets` bundles 40+ adapters. React 19 peer dependency conflicts make this package unusable without `--legacy-peer-deps`. Using `wallets={[]}` with wallet-standard auto-detection means Phantom, Solflare, and Backpack are all detected without any adapter package. This was a Week 3 decision that proved correct — zero dependency issues this week.

### drizzle-orm missing from web package

Lana's API routes (`apps/web/src/app/api/`) import `drizzle-orm` but it's not in `apps/web/package.json`. This causes 12 TS errors and would prevent those routes from working. Not blocking my frontend work (the UI calls on-chain directly, not through the API), but needs fixing before the backend API is usable. Flagged to Lana.

---

## Deliverable — Links to Code

| Type | Link |
|---|---|
| GitHub Repository | [Ah-Riz/mancerxsuperteam-token-vesting](https://github.com/Ah-Riz/mancerxsuperteam-token-vesting) |
| Development Branch | [`dev_geral`](https://github.com/Ah-Riz/mancerxsuperteam-token-vesting/tree/dev_geral) |
| Create Stream Page | [`apps/web/src/app/campaign/create/page.tsx`](https://github.com/Ah-Riz/mancerxsuperteam-token-vesting/blob/dev_geral/apps/web/src/app/campaign/create/page.tsx) |
| Withdraw Page | [`apps/web/src/app/campaign/[id]/page.tsx`](https://github.com/Ah-Riz/mancerxsuperteam-token-vesting/blob/dev_geral/apps/web/src/app/campaign/%5Bid%5D/page.tsx) |
| Vesting Math Tests | [`apps/web/tests/math/vesting.test.ts`](https://github.com/Ah-Riz/mancerxsuperteam-token-vesting/blob/dev_geral/apps/web/tests/math/vesting.test.ts) |
| PDA Derivation Tests | [`apps/web/tests/anchor/pda.test.ts`](https://github.com/Ah-Riz/mancerxsuperteam-token-vesting/blob/dev_geral/apps/web/tests/anchor/pda.test.ts) |
| Merkle Builder Tests | [`apps/web/tests/merkle/builder.test.ts`](https://github.com/Ah-Riz/mancerxsuperteam-token-vesting/blob/dev_geral/apps/web/tests/merkle/builder.test.ts) |
| Frontend PRD | [`docs/PRD_GERAL.md`](https://github.com/Ah-Riz/mancerxsuperteam-token-vesting/blob/dev_geral/docs/PRD_GERAL.md) |
| Frontend PDD | [`docs/PDD_GERAL.md`](https://github.com/Ah-Riz/mancerxsuperteam-token-vesting/blob/dev_geral/docs/PDD_GERAL.md) |
| Frontend TDD | [`docs/TDD_GERAL.md`](https://github.com/Ah-Riz/mancerxsuperteam-token-vesting/blob/dev_geral/docs/TDD_GERAL.md) |
| Frontend Security Doc | [`docs/SECURITY_GERAL.md`](https://github.com/Ah-Riz/mancerxsuperteam-token-vesting/blob/dev_geral/docs/SECURITY_GERAL.md) |
| CI/CD Lint Workflow | [`.github/workflows/lint.yml`](https://github.com/Ah-Riz/mancerxsuperteam-token-vesting/blob/dev_geral/.github/workflows/lint.yml) |
| Devnet Program | Program ID: `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` |
| Devnet Create TX | [`5n7obCd6CqrhYVZzVPcAPKc7LqF1Gh7E2ZLcmytTmyuHsKC4jSvZpgSyQVgwbeMJKK8vnTGqBHzkGJhgrNWpVtpA`](https://explorer.solana.com/tx/5n7obCd6CqrhYVZzVPcAPKc7LqF1Gh7E2ZLcmytTmyuHsKC4jSvZpgSyQVgwbeMJKK8vnTGqBHzkGJhgrNWpVtpA?cluster=devnet) |
| Devnet Withdraw TX | [`36FePkNJx6tX3WwUSByyKQfY3zzuer8DFeKNReeYZTbUyzW4kDLbhA2d9TqjKukunH1cqerCyrX3ENDotY873bqG`](https://explorer.solana.com/tx/36FePkNJx6tX3WwUSByyKQfY3zzuer8DFeKNReeYZTbUyzW4kDLbhA2d9TqjKukunH1cqerCyrX3ENDotY873bqG?cluster=devnet) |
| Demo Screenshots | [`docs/screenshots/proof/`](https://github.com/Ah-Riz/mancerxsuperteam-token-vesting/tree/dev_geral/docs/screenshots/proof) — create.png, claim.png, claim_success.png |

---

## Status — What works and what doesn't

### Working

| Item | Evidence |
|---|---|
| 201 Vitest tests pass | `pnpm test` — 16 test files, 201 tests, 0 failures |
| ESLint passes | `pnpm lint` — 0 errors, 14 warnings (all `no-unused-vars` in Lana's code) |
| Create Stream page works | `/campaign/create` — full form, tested on devnet with real tokens |
| Withdraw page works | `/campaign/[treeAddress]` — fetches on-chain state, claim successful on devnet |
| Devnet demo complete | Create stream → wait → claim all tokens — full flow verified |
| Error handling | Maps Anchor error codes to user-friendly messages (AccountNotInitialized, InvalidProof, etc.) |
| PDA derivation matches Rust | 10 tests verify seed format and determinism |
| Vesting math matches Rust | 17 tests with identical test vectors to `schedule.rs` |
| Merkle encoding matches Rust | Golden vector gate passes (from Week 3) |
| Wallet connection works | WalletMultiButton + wallet-standard auto-detect |
| Anchor provider wired | `useVestingProgram()` returns Program instance |
| PRD/PDD/TDD/SECURITY docs complete | 4 documents, ~1,450 lines total |
| API input validation | Base58 address validation + fromSlot validation on API routes |
| CI/CD pipeline | Lint workflow: Clippy → ESLint → Vitest → Next.js build on all dev pushes + PRs to main/test |

### Not yet implemented (Week 5-6 scope)

| Item | When |
|---|---|
| Multi-recipient CSV upload | Week 6 |
| Full `create_campaign` + `fund_campaign` flow | Week 6 |
| Merkle proof-based `claim` UI | Week 6 |
| Cancel/Pause admin UI | Week 5 (after cancel_stream instruction) |
| Campaign list page | Week 6 |
| E2E tests | Week 6 |

---

## Blockers — What's stuck or what I need

| Blocker | Impact | Status |
|---|---|---|
| ESLint 10 incompatibility | `eslint-plugin-react@7.37.5` crashes with ESLint 10 (`getFilename` removed). CI lint fails on merge. | **Resolved** — Pinned ESLint to `~9.39.4`, regenerated lockfile on both `dev_geral` and `test` branches. |
| `@testing-library/react` missing | Hook tests (`useBeneficiaryCampaigns`, etc.) fail with import error. | **Resolved** — Added as dev dependency. |
| `extractAnchorEventData` not exported | `sync-engine.test.ts` fails — function exists but was not exported. | **Resolved** — Added `export` keyword. |
| Stale test references | `bug-fix-validation.test.ts` references `syncAllEvents` (renamed to `syncClaimEvents`) and `parseRootUpdatedEvent`/`ROOT_UPDATED_DISCRIMINATOR` (non-existent). | **Resolved** — Renamed references, removed tests for non-existent functions. |
| API routes lack input validation | Routes return 500 instead of 400 for invalid addresses/params. Tests expect validation that didn't exist. | **Resolved** — Added base58 address validation and fromSlot validation to beneficiary and claims routes. |
| Lint workflow trigger scope | Lint only triggered on push to `main`/`dev_geral`/`dev_lana`. Missing `test` branch and other branches. | **Resolved** — Updated to trigger on all dev branch pushes + PRs to `main`/`test`. |
| No remaining blockers | All CI checks pass (lint + tests). | — |

---

## Metrics — Quantifiable progress

| Metric | Value |
|---|---|
| Vitest test files | 16 |
| Vitest tests passing | 201 / 201 (0 failures) |
| ESLint errors | 0 |
| Frontend documents created | 4 (PRD, PDD, TDD, SECURITY) |
| Total documentation lines | ~1,450 |
| Frontend test suites (Geral) | Vesting math (17), PDA derivation (10), Merkle (11) = 38 tests |
| Total frontend codebase | ~6,254 lines (src + tests) |
| UI pages implemented | 2 (Create Stream, Withdraw) |
| Anchor instructions wired in UI | 2 (`createStream`, `withdraw`) |
| PDA types tested | 3 (VestingTree, VaultAuthority, ClaimRecord) |
| Release types supported in UI | 3 (Cliff, Linear, Milestone) |
| TypeScript errors (my files) | 0 |
| CI/CD workflows configured | 2 (`lint.yml`, `ci.yml`) |
| CI checks per push | 4 (Clippy, ESLint, Vitest, Next.js build) |
| API routes with input validation | 2 (beneficiary campaigns, campaign claims) |
| Wallet adapters bundled | 0 (wallet-standard auto-detect) |
| Devnet transactions verified | 2 (create_stream + withdraw) |
| Screenshots captured | 4 (create, claim popup, claim success, anchor test) |
| Bugs found + fixed | 6 (hydration, ATA init, dynamic import, ESLint 10 compat, stale tests, missing validation) |
| Commits on `dev_geral` | 20+ |
