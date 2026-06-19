# Week 9 — Bug List (Lana: SC / MERKLE / BE / DB)

> Accumulating across detection phases. Each row: detect → **triage** (confirm severity) → fix-or-document.
> **Status legend:** `Detected` (candidate, unverified) · `Confirmed` · `Fixed` · `Documented`.
> Owner = Lana unless tagged `[Geral/handoff]`.

---

## Phase 1 — Smart Contract (SC)

### Baseline (green)
- `cargo test` (Mollusk, `BPF_OUT_DIR=../../target/deploy`): **110 passed / 0 failed / 19 ignored** (`/tmp/week9-sc-baseline.log`)
- `sealevel-attacks-gap` (bankrun): **4 passed** (`/tmp/week9-ts-baseline.log`)
- `security.spec` + `vesting.supplementary.spec` (localnet, Node 20): **73 passed / 2 pending** (`/tmp/week9-ts-security.log`) — all EXPLOIT 1–10, 12 rejected
- CU bench: **9 passed / 1 ignored**, matches `CU_BUDGET.md`, **no regressions** (`/tmp/week9-cu-bench.log`)
- `cargo clippy`: clean on correctness (exit 0); only dead-code + style nits
- `cargo audit`: 2 vulns + 7 unmaintained/unsound (all transitive) (`/tmp/week9-cargo-audit.log`)
- `cargo deny`: advisories + licenses FAIL (bans/sources OK) (`/tmp/week9-cargo-deny.log`)

### Findings

| ID | Sev | Area | File:line | Finding | Status |
|----|-----|------|-----------|---------|--------|
| ~~SC-FIND-01~~ | ~~High~~ → **Refuted (guarded)** | claim/withdraw/close | `claim.rs` `withdraw.rs` `close_claim_record.rs` | **NOT a vulnerability — verified by running the tests.** Close+re-init double-spend is guarded on both paths: (1) partial claim/withdraw → close rejected with **`CannotClose`** (close requires `fully_claimed \|\| post_grace`); (2) fully-claimed → close → re-claim/withdraw blocked by Anchor's **closed-account discriminator** (`Account<'info,T>` won't load a closed account → re-init fails, so `claimed_amount` never resets). Evidence: `VEL-001` (claim→close→claim, sealevel, **passes**); `EXPLOIT 11` bankrun (withdraw→close→withdraw, `vesting.clock.spec.ts:1262`, **passes**); clock spec **14/14**. The original multi-beneficiary concern assumed re-init succeeds — it doesn't. | **Refuted — residual: add explicit "full withdraw → close → re-withdraw" test** (only partial-withdraw + claim variants are covered today) |
| ~~SC-FIND-02~~ | ~~High~~ → **Low (availability-only)** | withdraw_unvested | `withdraw_unvested.rs:58-73` | Native-SOL path drained **all** lamports incl. rent → `VestingTree` PDA GC'd (unqueryable by indexer/BE); asymmetry vs SPL path. **solana-auditor re-classified: NO fund loss, NO re-init theft** (`create_campaign` `init` + `creator:Signer` + creator-bound seeds block re-init by anyone else). Real impact = availability only. | **Fixed (Phase 6, Fix A)** — preserve `rent_min`; auditor bidirectional test FAILs on unpatched (tree→0) and PASSes on patched (tree=`rent_min`). SC regression 125/0/19. |
| SC-FIND-03 | Medium | withdraw | `withdraw.rs:77` | Missing `!tree.instant_refunded` guard (`claim.rs:69` has it). Currently caught by `InsufficientVault`, but fragile (defense-in-depth). | **Fixed (Phase 6)** — guard added (mirrors `claim.rs:68-71`); SC regression 125/0/19. |
| SC-FIND-04 | Medium | close_claim_record | `close_claim_record.rs:12` | `vesting_tree` has no `seeds`/`bump` constraint. **Not directly exploitable** (`claim_record` PDA derives from `vesting_tree.key()` + `has_one=beneficiary` binds it to the genuine tree + signer). Defense-in-depth + consistency gap. | Detected |
| SC-FIND-05 | Medium | update_root | `update_root.rs` | No `!paused` check — root can be rotated while campaign is paused. May be intentional (admin op); confirm semantics. | Detected |
| SC-FIND-06 | Medium | close_claim_record | `close_claim_record.rs:31-32` | `total_entitled` is set at first-touch and not refreshed on `update_root`; `fully_claimed` close condition can be wrong after root rotation (early close, or never-closeable). Related to #29 area. | Detected |
| SC-#29 | Known | claim/withdraw | `claim.rs:147` | Multi-leaf cumulative `claimed_amount` undercount. **Decision (P1-T8): Option B — defer on-chain fix; BE mitigation active (prepare/import reject multi cliff/linear per beneficiary); document as known limitation.** FE validation `[Geral/handoff]`. | ✅ **Fixed on-chain 2026-06-16** (per-leaf ledger; ADR-003 superseded). Historical decision retained in the cell. |
| SC-CLIPPY-01 | Low | dead code | `errors.rs` `math/merkle.rs` | Unused: `ERR_OVERFLOW` (6008), `compute_node_hash`, `compute_proof_for_leaf`. | Detected |
| SC-DEP-01 | Low/Info | deps | Cargo.lock | cargo-audit: `curve25519-dalek` RUSTSEC-2024-0344, `ed25519-dalek` RUSTSEC-2022-0093 (both transitive crypto, off-chain impact); unmaintained: atty, bincode, derivative, libsecp256k1, paste; unsound: rand 0.7.3 (RUSTSEC-2026-0097), atty. Not Lana-fixable without upstream Solana SDK upgrade. | Documented (audit context) |
| SC-DEP-02 | Low/Info | deps | — | cargo-deny advisories+licenses FAIL (no `deny.toml`; license rejections are mostly N/A config noise). bans/sources OK. | Detected — add `deny.toml` |
| SC-ENV-01 | Low (env) | tooling | run scripts | Mollusk tests require `BPF_OUT_DIR=../../target/deploy`; documented in each `tests/*.rs` header but not in any npm/cargo run script → caused 18 false "failures" until set. | Detected — add `test:sc` script |
| TS-HARNESS-01 | Low (env) | tooling | PATH | Node 26 breaks the TS runner (yargs CJS/ESM). **Resolved:** force `PATH=~/.nvm/versions/node/v20.20.2/bin:$PATH`. | Resolved |
| TS-HARNESS-02 | Low (env) | tooling | `anchor test` | `anchor test` wraps the runner in `bash -lc`, which re-sources the profile and resets PATH to brew Node 26. Workaround: invoke `ts-mocha` directly with `PATH` + `ANCHOR_PROVIDER_URL`/`ANCHOR_WALLET` set. | Detected |

### Coverage gaps (known, not bugs)
- 4 handlers un-benchable by Mollusk 0.13 (`claim`, `cancel_stream`, `instant_refund`, `withdraw_unvested` — `init_if_needed`/`Optional<T>`). Blocked on Mollusk 0.14 (PENDING_WORK #20).
- 19 ignored `cargo test` cases — same Mollusk-0.14 blocker.

---

## Phase 2 — MERKLE

### Baseline (green)
- **Rust↔TS parity (P2-T1):** golden-leaf hash match `cf2129259e55d196c624b52834eeca822036914cabe10ce39ebbfbe67270627b` for Rust `leaf_hash` (merkle.rs `golden_leaf_hex`) and TS `leafHash` (clients/ts) — byte-identical (`/tmp/week9-rust-golden.log` + inline TS).
- **TS↔TS parity (P2-T2):** `test-merkle-parity.ts` → **13/13 PASS** (roots, proofs, leaf-hashes byte-identical; cross-verify web-proof/client-root). Log `/tmp/week9-merkle-parity.log`.
- **Benchmark (P2-T8):** 15,000 leaves → 248 ms build, 448-byte proofs (14 levels), verify ~93 µs/leaf. Within bounds. Log `/tmp/week9-merkle-bench.log`.
- **Rust unit/proptest (P2-T5/T6):** `cargo test --lib` → **43 passed / 0 failed** (incl. 8 original merkle proptests + 9 schedule proptests + 6 auditor forgery PoCs + 4 auditor overspend PoCs + 2 new boundary/position-binding tests).

### Findings

| ID | Sev | Area | File:line | Finding | Status |
|----|-----|------|-----------|---------|--------|
| MERKLE-FIND-01 | — (sound) | parity | `math/merkle.rs:8-9,11-14` · `clients/ts/src/leaf.ts:9-10,70-83` · `apps/web/src/lib/merkle/builder.ts:6-7,45-52` | **Rust↔Client↔Web byte-identical.** Prefixes `0x00`/`0x01`, keccak-256, 70-byte Borsh leaf layout (leaf_index→beneficiary→amount→release_type→start_time→cliff_time→end_time→milestone_idx) match across all three impls. Golden-hash cross-check + 13/13 parity test. **Not a bug.** | Confirmed sound |
| MERKLE-FIND-02 | — (sound) | domain-sep | `math/merkle.rs:8-9,33-37` | **0x00/0x01 applied on every hash path** — `leaf_hash` always prepends `0x00`; both `verify_merkle_proof` branches prepend `0x01`; no bypass. Second-preimage / node-as-leaf forgery impossible (proven by `audit_claim2_second_preimage_node_as_leaf_fails`). **Not a bug.** | Confirmed sound |
| MERKLE-FIND-03 | — (sound) | forgery | `math/merkle.rs:25-41` · `instructions/claim.rs:86-99` | **No proof-forgery path.** `verify_merkle_proof` has no explicit *lower*-bound length check, but `claim.rs:90-93` enforces the upper bound (`<= MAX_MERKLE_PROOF_LEN` and `<= max_proof_len_for_leaf_count`) and the cryptographic hash comparison rejects every malformed proof. Auditor proved via 6 PoCs: shortened, padded/over-long, single-leaf-empty, index-shift brute-force (n∈{2..16}, every leaf, every trunc), wrong-position, node-as-leaf — all correctly rejected. The single-leaf empty-proof case (`root==leaf_hash`) is the only empty-proof verifier and is correct-by-construction. **Not a bug** (residual: an explicit `require!(proof.len() == expected_depth)` would be defense-in-depth clarity, not a fix). | Confirmed sound |
| MERKLE-FIND-04 | — (sound) | duplicate-leaf | `instructions/claim.rs:32-37,147,170-174,124-132` | **Duplicate-leaf = under-count only, never overspend.** `ClaimRecord` is seeded `[b"claim", tree, beneficiary]` (one per tree+beneficiary); cumulative `claimed_amount` + `OverClaim` guard (`new_total <= total_supply`) + milestone `bitmap` make overspend impossible (4 auditor PoCs). Issue #29 under-count is the only effect. `leaf_index` is bound into the hash → position-binding (proven by `distinct_indices_yield_distinct_hashes`). BE rejects multi cliff/linear per beneficiary at `prepare/route.ts:70-82` + `import/route.ts:92-107` (confirmed via grep). **Not a security bug.** | Confirmed sound (see SC-#29) |
| MERKLE-FIND-05 | — (sound) | proof-len math | `math/merkle.rs:17-23` · `instructions/update_root.rs` · `instructions/claim.rs:18-26` | **`max_proof_len_for_leaf_count` == `ceil(log2(n))` for all u32** (auditor exhaustive check); `leaf_count` read from on-chain account (not caller-supplied), `vesting_tree` is **not** `mut` in `Claim` (claim.rs:18-26 — only `vault` is mut), `update_root` sets `merkle_root`+`leaf_count` atomically under `cancel_authority`. Trust model: creator controls `leaf_count`; setting it high loosens the upper bound but the crypto check still rejects (FIND-03); setting low = availability bug, recoverable. **No forgery.** | Confirmed sound |
| MERKLE-ENV-01 | Low (tooling) | commands | `tasks.md` P0-T1, P1-T6, P6-T6 + plan §Verification | **`--features bench` / `--bench benchmarks` do not exist.** The vesting crate has no `bench` feature and no `[[bench]]` target (`programs/vesting/Cargo.toml` only has `no-entrypoint`/`cpi`/`idl-build`). CU benchmarks are plain `#[test] fn bench_*` in `tests/benchmarks.rs`. **Correct command:** `cd programs/vesting && cargo test bench_` (or `cargo test --test benchmarks`). Same class as SC-ENV-01. | Detected — fix tasks.md/plan/Week-9 docs commands |
| MERKLE-COV-01 | — (done) | coverage | `math/merkle.rs`, `math/schedule.rs`, `clients/ts/src/__tests__/merkle-properties.test.ts` | **Closed the "TS Merkle client has zero property tests" gap.** Added: Rust — `audit_claim2_*` (6 forgery PoCs, auditor), `audit_claim3_*` (4 overspend PoCs, auditor), `distinct_indices_yield_distinct_hashes` + `max_depth_boundary_proof_length` (Lana); TS — 7 fast-check invariants (valid-proof-verifies, tampered-root, tampered-sibling, shortened, over-long, wrong-index, non-power-of-2) via `node:test`, runnable `pnpm --filter @velthoryn/client test`. All green. | Done (no production code changed — test-only) |
| MERKLE-BE-PIPE-01 | Low (scope) | E2E | `scripts/test-be-merkle-pipeline.ts` | **BE-pipeline E2E deferred to Phase 3.** Script requires a running BE server (`localhost:3000`) + Postgres; env has no local Postgres (Phase 4 prerequisite). The Phase-2-relevant Merkle parity (pure) is green (FIND-01). Pipeline re-verification belongs in Phase 3 where the BE/DB stack is exercised. | Documented (deferred) |

### Coverage gained this phase
- **Rust (test-only, 0 prod LOC changed):** +6 merkle forgery tests, +4 schedule overspend tests, +2 boundary/position-binding tests. Lib suite 43/0.
- **TS (clients/ts):** new `src/__tests__/merkle-properties.test.ts` (7 fast-check properties), `fast-check` devDep, `test` script. 7/0.
- **Independent SC audit:** solana-auditor agent confirmed all 5 merkle-surface claims; **no new issues found.**

## Phase 3 — BE

### Baseline (green / clean)
- **typecheck (P3-T1):** `pnpm exec tsc --noEmit` → **BE (`src/app/api/` + `src/lib/api/`) fully type-clean.** 24 errors total are ALL frontend (`src/app/(app)/`, `src/components/`, `src/lib/utils.ts`) — see BE-HANDOFF-01. Log `/tmp/week9-be-typecheck2.log`.
- **lint (P3-T2):** `pnpm lint` → **0 errors, 38 warnings.** BE-relevant: `event-indexer.ts` (8 `no-unused-expressions`), `campaigns/route.ts` (1 `no-unused-vars`) — the pre-existing BE-LINT-01/02 carry-overs; rest are FE/test files. Log `/tmp/week9-be-lint2.log`.
- **madge (P3-T5):** ✔ **No circular dependencies.** Log `/tmp/week9-madge.log`.
- **BigInt grep (P3-T6):** ✔ **Clean.** Only the known `auth/nonce/route.ts:14` uses raw `NextResponse.json` (no BigInt fields); all 25 other routes use `jsonResponse`.
- **regression (P3-T10):** `pnpm test:unit` → **565/565 PASS** (bug-fix-validation + security suites). Log `/tmp/week9-be-regression.log`.

### Static-analysis findings

| ID | Sev | Area | File:line | Finding | Status |
|----|-----|------|-----------|---------|--------|
| BE-LINT-01 | Low | lint | `src/lib/indexer/event-indexer.ts` | 8× `@typescript-eslint/no-unused-expressions` (pre-existing carry-over). Warnings, not errors. | Detected |
| BE-LINT-02 | Low | lint | `src/app/api/campaigns/route.ts` | 1× `no-unused-vars` (pre-existing carry-over). | Detected |
| BE-AUDIT-01 | Med | deps | `apps/web` | `pnpm audit`: **16 vulns (2 crit / 7 high / 5 mod / 2 low)**. Notable: **vitest `<3.2.6` (critical, dev-only, GHSA-5xrq)** → bump to `>=3.2.6`; **bigint-buffer** (high, via `@solana/spl-token>buffer-layout-utils`, no upstream patch — blocked); **serialize-javascript** (high, via `mocha` — legacy runner, likely removable); shell-quote (crit, deep FE/mobile devtool transitive); uuid, esbuild (dev). Mostly transitive/dev-deps. Full list `/tmp/week9-pnpm-audit.log`. | Detected — bump vitest; rest external-audit |
| BE-KNIP-01 | Low | dead-code | `src/lib/api/client-auth.ts` | knip flags as **unused file**. Likely a false-positive for BE scope (it's the CLIENT-side signing helper consumed by FE). Verify before removing. | Detected — verify usage |
| BE-KNIP-02 | Low | dead-code | `tests/lib/min-cliff-time.test.ts:2` | `bn.js` used but **unlisted** dependency (not in package.json). | Detected |
| BE-KNIP-03 | Low | dead-code | various | knip: unused dep `@solana/wallet-adapter-base`, unused devDep `pino-pretty`, + ~54 unused exports / 18 unused types (mostly FE; BE-side: `parseAuthMessage`, `attachRequestId`, `deriveVestingTree/VaultAuthority/ClaimRecord`, `leafSchema`/`csvRowSchema`, indexer `syncClaimEvents`/`syncCampaignState`). Triage needed — some used by tests/FE, some genuinely dead. Full list `/tmp/week9-knip.log`. | Detected — triage |
| BE-HANDOFF-01 | Low (FE) | typecheck | `src/app/(app)/*`, `src/components/*`, `src/lib/utils.ts` | 24 FE typecheck errors (19× TS2307 "Cannot find module" for **declared** deps `radix-ui`/`lucide-react`/`sonner`/`clsx`/`tailwind-merge`/etc. → module-resolution/install-state issue, not missing-dep; + 5× TS7006 implicit-any). **FE ownership → Geral.** Verify `next build` succeeds in CI. | Handoff (Geral) |

### Security findings (3 parallel review agents + Lana verification)

> Spec source of truth: **`docs/API_TRUST_BOUNDARIES.md`** (exists at repo root; agents initially looked in `apps/web/docs/` — corrected). Rule applied: spec is intent-truth, code is reality-truth; divergences flagged, not silently reconciled.

| ID | Sev | Area | File:line | Finding | Status |
|----|-----|------|-----------|---------|--------|
| **BE-SEC-01** | **High** | auth | `src/app/api/campaigns/route.ts:39-47,214-220` | **CONFIRMED spec-vs-code divergence (spec-backed).** Spec (`API_TRUST_BOUNDARIES.md:45`) classifies `POST /api/campaigns` as **Wallet Auth, "Signer must match `creator` in body."** Code omits `auth:true` and makes the check **optional** (only runs if an `Authorization` header is present; absent header → straight to insert). Net effect: **unauthenticated campaign-row creation** with an arbitrary `creator`. Merkle `verifyAllLeaves` only proves leaves↔supplied-root, NOT caller↔tree ownership. Impact: BE-row squatting / DB pollution / proof-serving confusion (DoS) — **no direct fund loss** (on-chain program is fund authority), but violates the spec's trust tier. **Fix (Phase 6):** `withRoute({ auth:true, … })` + unconditional `getAuthenticatedWallet(req) === data.creator`. | Confirmed — fix in Phase 6 |
| BE-SEC-02 | Medium | rate-limit | `src/lib/api/rate-limit.ts:68-74` | **`getClientIp` trusts `x-forwarded-for[0]` verbatim** (no trusted-proxy hop validation). Off-Vercel / behind a misconfigured proxy, an attacker rotates XFF per request → fresh bucket each time → **rate-limit bypass**. **Mitigated on Vercel prod** (Vercel overwrites XFF authoritatively). Defense-in-depth: document the Vercel dependency or add a trusted-proxy hop count. | Detected — defense-in-depth / doc |
| BE-SEC-03 | Medium | rate-limit | `src/lib/api/route-wrapper.ts:45-55` | Auth-route rate-limit is keyed on the raw `Authorization` header **before** it is validated. Attacker rotates dummy `Authorization` values → each distinct prefix gets its own 60/min bucket. Combined with BE-SEC-02, online-brute-force / auth-flood budgets are effectively uncapped on `auth:true` routes. Fix: fall back to per-IP keying until the header is known-good. | Detected |
| BE-SEC-04 | Medium | rate-limit | `src/lib/api/rate-limit.ts:88-89` | When Upstash Redis env vars are unset, limiter falls back to an **in-process `Map`** → per-instance on serverless → concurrent lambdas each grant full quota → near-total bypass. Fix: require Redis in non-test prod (`hasUpstashRedis()` as a boot-time assertion) or document best-effort. | Detected |
| BE-SEC-05 | Medium | rate-limit | `src/lib/api/rate-limit.ts:92-93` | **No try/catch around `limiter.limit(key)`.** Any Upstash error (timeout/5xx/quota) rejects → `errorHandler` → HTTP 500 on **every** rate-limited request. Availability footgun (not a bypass). Fix: wrap in try/catch, fail-open-with-alarm or fail-closed deliberately. | Detected |
| BE-SEC-06 | Low (spec-divergence) | auth | `src/app/api/cron/sync/route.ts:17` | Cron secret compared with plain `token !== cronSecret` (**non-constant-time**). Spec (`API_TRUST_BOUNDARIES.md:132`) claims "Both [admin/cron] use timing-safe comparison (`verifyAdminKey`)" — **cron path diverges from that claim.** Low network exploitability, but sibling `lib/auth.ts` already has `timingSafeCompare`. Trivial fix. | Confirmed — fix in Phase 6 |
| BE-SEC-07 | Low | auth | `src/app/api/auth/nonce/route.ts:12` · `auth-middleware.ts:71-76` | Nonce stored with wallet value `"pending"`; `verifyWalletAuth` never compares stored wallet to `message.wallet` (binding is cryptographic-only via the signature). Not exploitable (sig binds wallet), but the stored value is dead state and the route comment implies a binding that isn't enforced. Defense-in-depth: enforce `storedNonce === message.wallet` or drop the param. | Detected |
| BE-SEC-08 | Medium | headers | `next.config.ts:26` | CSP `script-src` includes both `'unsafe-eval'` and **`'unsafe-inline'`** with no documented justification → materially weakens XSS protection. If current Next.js App Router no longer requires them, replace with nonces/hashes; else document why. (CORS itself is sound: explicit allowlist, no credentials, no reflect-origin; all 6 core headers present.) | Detected |
| ~~BE-SEC-09~~ | ~~Medium~~ → **Refuted (spec match)** | trust | `src/app/api/campaigns/[treeAddress]/route.ts:198-201` | GET campaign detail is **public** — and per spec (`API_TRUST_BOUNDARIES.md:48`) that is **correct** (read-only, mirrors on-chain public data). The review agent's "should be authenticated read" used the plan's task-text label, not the spec. **Not a bug.** | Refuted — matches spec |
| BE-SEC-10 | Info | auth | `src/lib/api/client-auth.ts:28-37` | Signed auth message is plain `JSON.stringify({nonce,timestamp,wallet})` with no domain-separation prefix. Client/server agree on bytes today (fixed key order), but a prefix (e.g. `"mancauth:"`) would add forward-safety + cross-protocol reuse protection. | Informational |
| ~~BE-DOC-01~~ | ~~Medium~~ → **Refuted (docs exist)** | docs | — | Review agents reported `SECURITY.md` / `API_TRUST_BOUNDARIES.md` "missing" — **incorrect**; both exist at repo-root `docs/` (`SECURITY.md` 41.8K, `API_TRUST_BOUNDARIES.md` 9.5K). Agent scope error (looked in `apps/web/docs/`). No doc gap. | Refuted |

### Notes
- **Wallet-auth core is sound** (per P3-T8 agent): CSPRNG nonces (`nacl.randomBytes`), atomic `GETDEL` single-use consumption, 5-min timestamp window aligned to nonce TTL, Ed25519 `detached.verify` over the **exact client-signed bytes** (no re-serialization), uniform "Unauthorized" errors, `timingSafeEqual` for admin keys. The gaps are the rate-limit cluster (BE-SEC-02..05) + the optional-auth route (BE-SEC-01) + cron timing (BE-SEC-06).
- **CORS surface is sound** (per P3-T9 agent): explicit origin allowlist, no `Allow-Credentials`, no open reflect-origin, HSTS/XFO/nosniff/Referrer-Policy all present. Only debt: CSP `unsafe-inline` (BE-SEC-08).

## Phase 4 — DB

### Baseline (green / clean)
- **drizzle-kit check (P4-T1):** `pnpm exec drizzle-kit check` → **`Everything's fine` (exit 0) — no migration drift.** Schema matches the migration journal. Offline check (no live DB needed). Log `/tmp/week9-drizzle-check.log`.
- **Indexer txn-rollback (P4-T5):** **Sound.** Every event is wrapped in `db.transaction(async (txDb) => …)` (`lib/indexer/event-indexer.ts`, `claim-events.ts:169-191`); `persistSyncCheckpoint(txDb, slot)` advances the `sync_state` cursor **inside the same transaction** (atomic — on error, event insert + checkpoint both roll back); `onConflictDoNothing()` on event inserts → idempotent replay from the last checkpoint. No skip/duplicate gap.

### Findings

| ID | Sev | Area | File:line | Finding | Status |
|----|-----|------|-----------|---------|--------|
| DB-MIG-01 | Low | migrations | `migrations/0000_tan_mac_gargan.sql`, `migrations/0001_rls_policies.sql` | **Non-idempotent base migrations.** 0000 uses raw `CREATE TABLE`/`CREATE UNIQUE INDEX`/`CREATE INDEX` (no `IF NOT EXISTS`); 0001 uses raw `CREATE POLICY`/`ALTER TABLE … ENABLE RLS` (no `IF NOT EXISTS`). Re-running on an already-bootstrapped DB would error. Migrations 0004–0008 ARE idempotent (`IF NOT EXISTS` / `DO $$ … EXCEPTION`); 0002/0003 are no-op `SELECT 1` placeholders. Low risk (prod already bootstrapped via `drizzle-kit push` per 0002/0004 comments). | Detected — optional hardening (wrap in `IF NOT EXISTS`) |
| DB-DOC-01 | Low (doc) | docs | `docs/BE-SC-MERKLE-ACCEPTANCE-STATUS.md:27,122` | **Confirmed doc divergence.** Doc claims bigint columns use `{ mode: "string" }`; actual schema (`schema.ts`) is **`mode: "bigint"` ×40 + 1× `mode: "number"`** (`waitlist.created_at:320`), **zero** `mode: "string"`. Code is safe (BigInt objects serialized via `jsonResponse`/`jsonReplacer`); **docs are stale → fix the doc** (Phase 7, trivial). (Note: `PENDING_WORK.md` does **not** claim `mode:"string"` — only this one doc does.) | Confirmed — fix doc in Phase 7 |
| DB-RLS-01 | — (sound/design) | RLS | `migrations/0001_rls_policies.sql:24-37` | **RLS is SELECT-only public read by design** (13 `FOR SELECT USING (true)` policies; **zero INSERT/UPDATE/DELETE** policies for any role). All writes go through the BE, which connects via `DATABASE_URL` as the `postgres` owner role → **bypasses RLS** (`lib/db/index.ts:51`; no `SUPABASE_ANON_KEY`/`SERVICE_ROLE_KEY` used — raw `postgres` driver). Sound **provided the BE enforces auth** — which is exactly the gap in **BE-SEC-01**, so RLS provides **no backstop** there. Minor: migration line-1 comment says "service role" but the actual role is the `postgres` owner (functionally equivalent — both bypass RLS). | Confirmed sound (design); ties to BE-SEC-01 |
| DB-BIGINT-01 | Info | schema | `schema.ts:320` | `waitlist.created_at` is the **only** column using `mode: "number"` (every other bigint is `mode: "bigint"`). No `Number()` truncation risk for realistic timestamps (ms-since-epoch ≪ 2^53). Likely intentional (timestamp as number for the waitlist). No action. | Informational |
| DB-DEFER-01 | Low (scope) | tests | `tests/api/ops-verification.test.ts`, indexer E2E | **Runtime RLS + indexer E2E tests need a local Postgres** (`DATABASE_URL`), not running in this env. Static review (P4-T3/T5) covers the security-relevant questions (policies SELECT-only, writes BE-only; rollback atomic). Re-run when Postgres available. | Deferred (needs Postgres) |

### Notes
- **No security bug found in the DB layer itself.** The one cross-cutting issue (BE-SEC-01, Phase 3) is an application-layer auth gap that the DB layer neither causes nor mitigates — confirming the Phase-6 fix belongs at the BE route, not the DB.
- The "bigint mode" concern from the original plan is **resolved as a doc-only divergence** (DB-DOC-01): the code was already correct; only the acceptance-status doc is stale.

---

## Phase 6 — Fixes

Applied after Phase-5 triage sign-off. Each fix is paired with verification; deferred items carry rationale. **Production-code changes this phase: BE (4 files) + SC (1 file so far); test-only additions in 3 more.**

### Fixed (code change + verification)

| ID | Fix applied | Verification |
|----|-------------|--------------|
| **BE-SEC-01** (High) | `apps/web/src/app/api/campaigns/route.ts`: added `auth: true` to the `POST` `withRoute` options + made the `signer === creator` check **unconditional** (removed the optional `if (authHeader)` path). Now matches `docs/API_TRUST_BOUNDARIES.md:45` (Wallet Auth). | `tsc --noEmit` BE-clean; `pnpm test:unit` 565/565 (lib/math/merkle/anchor/week7 unaffected). **+2 regression tests** added to `tests/api/security.test.ts` (unsigned POST → 401; signer≠creator → 403) — typecheck-clean; **route-level execution deferred to a Postgres-backed env** (`tests/api/**` runs under the DB vitest config, not the unit config — see BE-DEFER-01). |
| **BE-SEC-06** (Low) | `apps/web/src/app/api/cron/sync/route.ts`: cron secret compare `token !== cronSecret` → `timingSafeCompare(token, cronSecret)` (exported from `lib/auth.ts`, same helper `verifyAdminKey` uses). Now matches `docs/API_TRUST_BOUNDARIES.md:132`. | `tsc --noEmit` BE-clean; 565/565. |
| **BE-SEC-05** (Med) | `apps/web/src/lib/api/rate-limit.ts`: wrapped `limiter.limit(key)` in try/catch → on Upstash error, log + fall back to the in-memory limiter (avoids a 500-storm on every rate-limited request; keeps per-instance throttling). | `tsc --noEmit` BE-clean; 565/565. |
| **SC-FIND-03** (Med) | `programs/vesting/src/instructions/withdraw.rs`: added `require!(!tree.instant_refunded, InstantRefundedCampaign)` at handler top (mirrors `claim.rs:68-71`). Defense-in-depth. | SC regression **125/0/19** ✓ (was 122/0/19; +3 auditor `withdraw_unvested` tests). |
| **SC-FIND-02** (~~High~~→Low) | `programs/vesting/src/instructions/withdraw_unvested.rs`: native-SOL path now preserves `rent_min` (drains `balance − rent_min`) so the `VestingTree` PDA is NOT GC'd — matches the SPL branch + non-final native claim/withdraw. Edge: a fully-pre-claimed PDA (only rent left) now returns `NothingToClaim` (rent isn't unvested funds). | Auditor bidirectional Mollusk test (`tests/withdraw_unvested.rs`): FAIL on unpatched (`tree_lamports_after=0`), **PASS on patched** (`=rent_min`). Included in SC regression 125/0/19 ✓. |

### Documented (no code change — rationale)

| ID | Decision | Rationale |
|----|----------|-----------|
| SC-FIND-04 | **Document, don't fix** | `close_claim_record.rs`: the `claim_record` PDA is **already seeded with `vesting_tree.key()`** (line 19) + `has_one=beneficiary` + `constraint claim_record.tree == vesting_tree.key()` → cryptographically bound to the genuine tree. Missing `seeds` on `vesting_tree` is **not exploitable**; adding it is cosmetic + account-resolution risk. (BUG_LIST Phase 1 already noted "not directly exploitable".) |
| SC-FIND-05 | **Document, don't fix** | `update_root.rs`: rotation-while-paused is a trusted `cancel_authority` admin op (constraints: `cancellable`, `not cancelled`, `cancel_authority` matches). No fund movement; intentional admin-recovery affordance. |
| SC-FIND-06 | **✅ Fixed (tied to #29, 2026-06-16)** | `close_claim_record.rs:31-32`: stale `total_entitled` after root rotation — fixed by the Issue #29 per-leaf change (`total_entitled` now accumulates on first-touch-per-leaf for all release types, self-healing on next claim after rotation). |
| BE-SEC-02 | **Document (deployment-dependent)** | XFF trusted verbatim — **mitigated on Vercel prod** (Vercel overwrites XFF authoritatively). Self-hosted/non-Vercel is affected; fix requires trusted-proxy hop config. Document the Vercel dependency in `docs/` (Phase 7). |
| BE-SEC-03 | **Document** | Auth-route rate-limit keyed on unvalidated header — real, but bounded (still per-header-rotating, not fully uncapped unless combined with BE-SEC-02). Lower priority; revisit if moving off Vercel. |
| BE-SEC-04 | **Document (prod-config)** | In-memory fallback per-instance on serverless — **mitigated when Upstash Redis is configured in prod**. Recommend a boot-time `hasUpstashRedis()` assertion in non-test envs (Phase 7 ops doc). |
| BE-SEC-08 | **Document (needs FE testing)** | CSP `unsafe-inline`/`unsafe-eval` — tightening risks breaking the Next.js FE build; requires FE regression (Geral's area). Document the rationale; defer the change to a FE-verified pass. |

### Deferred (this phase)
- **BE-DEFER-01:** `tests/api/**` (incl. the new BE-SEC-01 route tests) runs under the DB vitest config → needs a local Postgres. Re-run there to execute the 401/403 regression assertions.

### Regression (P6-REG)
- **SC:** `cd programs/vesting && BPF_OUT_DIR=../../target/deploy cargo test` → **125 passed / 0 failed / 19 ignored** (was 110 at P0 → 122 after Phase-2 test additions → 125 now; +3 auditor `withdraw_unvested` tests). Log `/tmp/week9-sc-final.log`.
- **BE:** `cd apps/web && pnpm test:unit` → **565 passed / 565** (lib/math/merkle/anchor/week7 layers; unaffected by the route-layer fixes). `tsc --noEmit` BE-clean (24 errors all FE, unchanged).
- **Caveat:** route-level BE behavior (`tests/api/**`, incl. BE-SEC-01 401/403 + the rate-limit cluster) and SC Mollusk coverage of the 4 `init_if_needed`/`Optional<T>` handlers remain blocked on Mollusk 0.14 / a Postgres-backed env — unchanged from baseline.

### Documentation cross-reference (P7-T5)
Every Week 9 finding is reflected in the deliverables (`docs/week9/` + refreshed root docs):
- **Fixed** (BE-SEC-01, SC-FIND-02, SC-FIND-03, BE-SEC-05, BE-SEC-06) → `INSTRUCTION_REFERENCE.md` (claim/withdraw guards, native-SOL rent preservation, error codes 6000–6040) + `INTEGRATION_GUIDE.md` (Wallet-Auth POST `/api/campaigns`, native-SOL specifics).
- **SC-#29** (known limitation) → `ADRs/ADR-003-issue-29-deferred-on-chain-fix.md` + `INSTRUCTION_REFERENCE.md` §claim note + `docs/KNOWN_ISSUE_29_DESIGN.md`.
- **Merkle soundness** (parity, domain-sep, no-forgery) → `ADRs/ADR-002-keccak-256-domain-separation.md` + `ADRs/ADR-001-merkle-compressed-vesting.md`.
- **Documented, no code change** (SC-FIND-04/05/06, BE-SEC-02/03/04/08) → rationale in §Phase 6 above; **DB-DOC-01** doc fix applied to `docs/BE-SC-MERKLE-ACCEPTANCE-STATUS.md:27,122`.
- **Deferred verification** (BE route tests under Postgres; Mollusk 0.14 handlers) → §Phase 6 Deferred + this repo's PENDING_WORK.md.
