# Tasks: Clawback API

**Spec:** `clawback-api`
**Phase:** F3
**Depends on:** `production-security-ops` (P0+P1), `dashboard-transparency` (F2.1 event tables)
**Prerequisite:** P0 auth middleware, Anchor client utility

---

## F3.1 — TX builder utility

- [ ] Create `apps/web/src/lib/api/tx-builder.ts`
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
- [ ] **Verify:** Build a dummy transaction; verify it serializes and deserializes correctly

## F3.2 — Grace period info in campaign detail

- [ ] Update `apps/web/src/app/api/campaigns/[treeAddress]/route.ts` GET handler:
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
- [ ] **Verify:** GET cancelled campaign returns grace period with correct countdown; non-cancelled returns null

## F3.3 — Cancel campaign endpoint

- [ ] Create `apps/web/src/app/api/campaigns/[treeAddress]/cancel/route.ts`
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
- [ ] **Verify:** POST returns valid serialized tx; cancelled campaign returns 400; non-cancellable returns 400

## F3.4 — Withdraw unvested endpoint

- [ ] Create `apps/web/src/app/api/campaigns/[treeAddress]/withdraw-unvested/route.ts`
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
- [ ] **Verify:** POST returns valid tx for expired grace period; before expiry returns 400 `GRACE_PERIOD_ACTIVE`; non-cancelled returns 400

## F3.5 — Cancel stream endpoint

- [ ] Create `apps/web/src/app/api/campaigns/[treeAddress]/cancel-stream/route.ts`
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
- [ ] **Verify:** POST for single-recipient campaign returns valid tx; multi-recipient returns 400

## F3.6 — Milestone release endpoint

- [ ] Create `apps/web/src/app/api/campaigns/[treeAddress]/milestones/[idx]/route.ts`
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
- [ ] **Verify:** POST with valid idx returns tx; idx > 255 returns 400; non-creator returns 403

## F3.7 — Clawback API tests

- [ ] Create `apps/web/tests/api/clawback.test.ts`
  - Test: Cancel campaign → returns valid serialized transaction
  - Test: Cancel non-cancellable → 400 `NOT_CANCELLABLE`
  - Test: Cancel already cancelled → 400 `ALREADY_CANCELLED`
  - Test: Cancel by non-authority → 403
  - Test: Withdraw unvested (grace expired) → valid tx
  - Test: Withdraw unvested (grace active) → 400 `GRACE_PERIOD_ACTIVE`
  - Test: Withdraw unvested (not cancelled) → 400 `NOT_CANCELLED`
  - Test: Cancel stream (single recipient) → valid tx
  - Test: Cancel stream (multi recipient) → 400 `NOT_SINGLE_STREAM`
  - Test: Milestone release → valid tx
  - Test: Milestone release (already released) → 400
  - Test: Grace period countdown in campaign detail
  - Test: All responses have BigInt values as strings
- [ ] All tests pass in CI

---

## Verification checklist

- [ ] `pnpm test` passes in `apps/web/` (existing + new tests)
- [ ] `pnpm test:localnet` passes (86/86 SC tests unchanged)
- [ ] Cancel campaign endpoint returns valid unsigned tx (deserializable)
- [ ] Withdraw unvested rejects before grace period expires
- [ ] Cancel stream rejects multi-recipient campaigns
- [ ] Milestone release rejects already-released milestones
- [ ] Grace period info appears in campaign detail for cancelled campaigns
- [ ] Non-cancelled campaigns show `gracePeriod: null`
- [ ] Auth required on all POST endpoints
- [ ] Non-authorized signers receive 403
