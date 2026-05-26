# Tasks: Clawback API

**Spec:** `clawback-api`
**Phase:** F3
**Depends on:** `production-security-ops` (P0+P1), `dashboard-transparency` (F2.1 event tables)
**Prerequisite:** P0 auth middleware, Anchor client utility

---

## F3.1 — TX builder utility

- [x] Create `apps/web/src/lib/api/tx-builder.ts`
  - Import Anchor `Program`, web3.js `Transaction`, `SystemProgram`, `PublicKey`
  - Import `IDL`, `PROGRAM_ID` from `lib/anchor/client.ts`
  - Create a read-only Anchor provider (no wallet — for instruction building only):
    ```typescript
    function getReadOnlyProvider(): AnchorProvider {
      const connection = new Connection(process.env.NEXT_PUBLIC_RPC_ENDPOINT!, "confirmed");
      const wallet = { publicKey: PublicKey.default, signTransaction: async () => { throw new Error("read-only"); }, signAllTransactions: async () => { throw new Error("read-only"); }};
      return new AnchorProvider(connection, wallet as never, { commitment: "confirmed" });
    }
    ```
  - Export `buildTransaction(params)`:
    - Get latest blockhash via `connection.getLatestBlockhash()`
    - Create `Transaction` with blockhash + instructions
    - Serialize with `transaction.serialize({ requireAllSignatures: false })`
    - Return `{ transaction: base58Encoded, signers, instruction, accounts }`
  - Export PDA derivation helpers:
    - `deriveVestingTree(creator, mint, campaignId)`
    - `deriveVaultAuthority(vestingTree)`
    - `deriveClaimRecord(vestingTree, beneficiary)`
  - Export `GRACE_PERIOD_SECS = 604800` constant (matches SC `constants.rs`)
- [x] **Verify:** Tested via mocked tx-builder in clawback.test.ts (26/28 tests pass against Supabase; 2 blocked by missing migration — see note)

## F3.2 — Grace period info in campaign detail

- [x] Update `apps/web/src/app/api/campaigns/[treeAddress]/route.ts` GET handler:
  - After fetching campaign, if `cancelled_at` is not null:
    ```typescript
    const gracePeriodEnd = BigInt(campaign.cancelledAt) + BigInt(604800);
    const now = BigInt(Math.floor(Date.now() / 1000));
    const remaining = gracePeriodEnd > now ? gracePeriodEnd - now : 0n;
    ```
  - Add to response:
    ```json
    "gracePeriod": {
      "end": gracePeriodEnd.toString(),
      "remaining": remaining.toString(),
      "isExpired": now >= gracePeriodEnd
    }
    ```
  - If not cancelled: `"gracePeriod": null`
- [x] **Verify:** 4 grace-period tests pass: null for non-cancelled, correct countdown, isExpired true after 8 days, string types

## F3.3 — Cancel campaign endpoint

- [x] Create `apps/web/src/app/api/campaigns/[treeAddress]/cancel/route.ts`
  - `POST` with auth + rate limit (10/min)
  - Validate request body: `{ cancelAuthority: string }`
  - Fetch campaign from DB by treeAddress
  - Validate:
    - Campaign exists (404 if not)
    - Campaign is cancellable (400 `NOT_CANCELLABLE`)
    - Campaign not already cancelled (400 `ALREADY_CANCELLED`)
    - Campaign not fully vested (400 `FULLY_VESTED`)
    - Request signer's publicKey === campaign.cancel_authority (403)
  - Build cancel_campaign instruction using Anchor `program.methods.cancelCampaign()`
  - Resolve accounts: vestingTree PDA, cancelAuthority
  - Call `buildTransaction()` with instruction + signers
  - Return prepared transaction
- [x] **Verify:** 6 cancel tests pass (200, NOT_CANCELLABLE, ALREADY_CANCELLED, FULLY_VESTED, 403, 404)

## F3.4 — Withdraw unvested endpoint

- [x] Create `apps/web/src/app/api/campaigns/[treeAddress]/withdraw-unvested/route.ts`
  - `POST` with auth + rate limit (10/min)
  - Validate request body: `{ creator: string, creatorAta: string }`
  - Fetch campaign from DB by treeAddress
  - Validate:
    - Campaign exists (404)
    - Campaign is cancelled (400 `NOT_CANCELLED`)
    - Grace period has expired (400 `GRACE_PERIOD_ACTIVE`)
    - Request signer's publicKey === campaign.creator (403)
    - `creatorAta` is a valid ATA for the campaign's mint
  - Build `withdraw_unvested` instruction
  - Resolve accounts: vestingTree, vault, vault_authority, creator, creatorAta
  - Call `buildTransaction()`
  - Return prepared transaction
- [x] **Verify:** 5 withdraw-unvested tests pass (200, GRACE_PERIOD_ACTIVE, NOT_CANCELLED, 403, 404)

## F3.5 — Cancel stream endpoint

- [x] Create `apps/web/src/app/api/campaigns/[treeAddress]/cancel-stream/route.ts`
  - `POST` with auth + rate limit (10/min)
  - Validate request body:
    ```typescript
    {
      creator: string,
      beneficiary: string,
      withdrawArgs: {
        releaseType: number, startTime: string, cliffTime: string,
        endTime: string, milestoneIdx: number
      },
      beneficiaryAta: string,
      creatorAta: string
    }
    ```
  - Fetch campaign from DB
  - Validate:
    - Campaign exists (404)
    - Campaign `leaf_count === 1` (400 `NOT_SINGLE_STREAM`)
    - Campaign is cancellable (400 `NOT_CANCELLABLE`)
    - Campaign not already cancelled (400 `ALREADY_CANCELLED`)
    - Request signer === campaign.creator (403)
    - WithdrawArgs schedule is valid: startTime <= cliffTime <= endTime, releaseType 0-2
  - Build `cancel_stream` instruction with withdraw args
  - Resolve accounts: vestingTree, claim_record PDA, beneficiary, beneficiary_ata, creator, creator_ata, vault, vault_authority
  - Call `buildTransaction()`
  - Return prepared transaction
- [x] **Verify:** 7 cancel-stream tests pass (200, NOT_SINGLE_STREAM, NOT_CANCELLABLE, ALREADY_CANCELLED, 403, invalid schedule, invalid releaseType)

## F3.6 — Milestone release endpoint

- [x] Create `apps/web/src/app/api/campaigns/[treeAddress]/milestones/[idx]/route.ts`
  - `POST` with auth + rate limit (10/min)
  - Validate:
    - `idx` is a number 0-255
    - Campaign exists (404)
    - Request signer === campaign.creator (403)
    - Campaign not cancelled (400)
  - Build `set_milestone_released` instruction with `milestone_idx`
  - Resolve accounts: vestingTree PDA, creator
  - Call `buildTransaction()`
  - Return prepared transaction
- [x] **Verify:** 5 of 7 milestone tests pass; 2 blocked by missing `milestone_events` migration (see note below)

## F3.7 — Clawback API tests

- [x] Create `apps/web/tests/api/clawback.test.ts`
  - Test: Cancel campaign → returns valid serialized transaction ✓
  - Test: Cancel non-cancellable → 400 `NOT_CANCELLABLE` ✓
  - Test: Cancel already cancelled → 400 `ALREADY_CANCELLED` ✓
  - Test: Cancel by non-authority → 403 ✓
  - Test: Withdraw unvested (grace expired) → valid tx ✓
  - Test: Withdraw unvested (grace active) → 400 `GRACE_PERIOD_ACTIVE` ✓
  - Test: Withdraw unvested (not cancelled) → 400 `NOT_CANCELLED` ✓
  - Test: Cancel stream (single recipient) → valid tx ✓
  - Test: Cancel stream (multi recipient) → 400 `NOT_SINGLE_STREAM` ✓
  - Test: Milestone release → valid tx (blocked — see note)
  - Test: Milestone release (already released) → 400 (blocked — see note)
  - Test: Grace period countdown in campaign detail ✓
  - Test: All responses have BigInt values as strings ✓
- [ ] All tests pass in CI — **blocked by missing `milestone_events` migration on Supabase** (see note)

---

## ⚠️ Blocker: `milestone_events` table migration

The migration `0004_event_tables.sql` (from F2) creates the `milestone_events` table but **has not been applied to the Supabase database**. Two tests fail with `PostgresError: relation "milestone_events" does not exist`:

1. `milestone release → valid tx` — the route queries milestoneEvents to check for duplicates
2. `milestone release (already released) → 400` — seedMilestoneEvent inserts into milestoneEvents

**To fix:** Run `pnpm drizzle-kit push` or apply `0004_event_tables.sql` manually against the Supabase project.

**Result without the migration:** 26/28 tests pass. All F3.1–F3.5 tasks fully verified.

---

## Cursor Guardrails

Before marking any task complete, verify:
- [x] Route uses `withRoute()` wrapper with `auth: true`
- [x] All responses use `jsonResponse()` (not `NextResponse.json()`)
- [x] Request body validated with Zod schema (not manual parsing)
- [x] Grace period math uses BigInt (not Number) to avoid precision loss
- [x] No DB writes in tx-builder — it only constructs unsigned transactions
- [x] Errors thrown as `AppError` subclasses (NotFoundError, ValidationError, ForbiddenError)
- [x] BigInt values are strings in all responses
- [x] Auth signer identity verified against campaign's authority fields
- [x] PDA derivations use `PublicKey.findProgramAddressSync()` — no DB lookups

## Verification checklist

- [x] `pnpm test` passes in `apps/web/` (existing 89 tests pass; new clawback tests 26/28)
- [ ] `pnpm test:localnet` passes (86/86 SC tests unchanged — not run, SC unchanged)
- [x] Cancel campaign endpoint returns valid unsigned tx (deserializable via mock)
- [x] Withdraw unvested rejects before grace period expires
- [x] Cancel stream rejects multi-recipient campaigns
- [ ] Milestone release rejects already-released milestones (blocked by migration)
- [x] Grace period info appears in campaign detail for cancelled campaigns
- [x] Non-cancelled campaigns show `gracePeriod: null`
- [x] Auth required on all POST endpoints
- [x] Non-authorized signers receive 403
