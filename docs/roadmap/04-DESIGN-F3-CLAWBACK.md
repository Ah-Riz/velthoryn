# Design: Clawback API

**Spec:** `clawback-api`
**Phase:** F3 (Feature Phase 3)
**Depends on:** `production-security-ops` (P0+P1), `dashboard-transparency` (F2.1 event tables)
**Estimate:** 4 days
**Owner:** Lana (BE lead)

---

## Context

The SC has `cancel_campaign`, `cancel_stream`, `withdraw_unvested`, and `set_milestone_released` instructions. None have BE endpoints for building the transactions. This spec adds unsigned-transaction endpoints so the FE can construct, sign, and submit these operations via wallet.

**User need:** If a campaign is canceled, recipients retain already vested tokens; remainder returns to project after 7-day grace period. Directly addresses operational disruption when contributors leave.

**Source:** `docs/GAP-ANALYSIS-ROADMAP.md` — Feature 4: Automatic Clawback.

---

## Architecture

### Unsigned Transaction pattern

All mutation endpoints follow the same pattern:

```
1. Client calls POST /api/.../cancel (or withdraw, etc.)
2. BE validates the request (campaign exists, state allows operation)
3. BE builds the Anchor instruction using the IDL
4. BE constructs a `VersionedTransaction` with:
   - Recent blockhash
   - Instruction(s)
   - Signer metadata (which accounts need signing)
5. BE serializes the transaction to base58/base64
6. BE returns { transaction, signers: ["creator", ...], instruction }
7. Client deserializes, signs with wallet, submits to RPC
```

This keeps private keys off the server. The BE never sees or handles keypairs.

### TX Builder utility

Central utility in `apps/web/src/lib/api/tx-builder.ts`:

```typescript
interface PreparedTransaction {
  transaction: string;       // base58-encoded serialized transaction
  signers: string[];         // labels of required signers ("creator", "beneficiary", "cancelAuthority")
  instruction: string;       // instruction name for display
  accounts: Record<string, string>; // account addresses involved
}

async function buildTransaction(params: {
  instructions: TransactionInstruction[];
  signers: { label: string, publicKey: PublicKey }[];
  payer: PublicKey;
}): Promise<PreparedTransaction>
```

Uses:
- `@coral-xyz/anchor` for instruction building (already a dependency)
- `@solana/web3.js` for transaction construction
- RPC `getLatestBlockhash` for recent blockhash

---

## API Design

### `POST /api/campaigns/:treeAddress/cancel`

**Auth:** Wallet signature (must match campaign's `cancel_authority`)
**Rate limit:** 10/min

Request:
```json
{
  "cancelAuthority": "base58_address"
}
```

Response:
```json
{
  "transaction": "base58_serialized_tx",
  "signers": ["cancelAuthority"],
  "instruction": "cancel_campaign",
  "accounts": {
    "vestingTree": "base58",
    "cancelAuthority": "base58"
  }
}
```

Validation:
- Campaign exists
- Campaign is cancellable
- Campaign is not already cancelled
- Campaign is not fully vested
- Request signer is the campaign's `cancel_authority`

### `POST /api/campaigns/:treeAddress/withdraw-unvested`

**Auth:** Wallet signature (must match campaign's `creator`)
**Rate limit:** 10/min

Request:
```json
{
  "creator": "base58_address",
  "creatorAta": "base58_ata_address"
}
```

Response:
```json
{
  "transaction": "base58_serialized_tx",
  "signers": ["creator"],
  "instruction": "withdraw_unvested",
  "accounts": {
    "vestingTree": "base58",
    "vault": "base58",
    "creatorAta": "base58"
  }
}
```

Validation:
- Campaign exists
- Campaign is cancelled
- Grace period has expired (cancelled_at + 604800 <= now)
- Vault has balance > 0

### `POST /api/campaigns/:treeAddress/cancel-stream`

**Auth:** Wallet signature (must match campaign's `creator`)
**Rate limit:** 10/min

Request:
```json
{
  "creator": "base58_address",
  "beneficiary": "base58_address",
  "withdrawArgs": {
    "releaseType": 0,
    "startTime": "1700000000",
    "cliffTime": "1731536000",
    "endTime": "1731536000",
    "milestoneIdx": 0
  },
  "beneficiaryAta": "base58_ata",
  "creatorAta": "base58_ata"
}
```

Validation:
- Campaign exists
- Campaign is single-recipient (`leaf_count == 1`)
- Campaign is cancellable
- Campaign is not already cancelled
- Campaign is not fully vested

### `POST /api/campaigns/:treeAddress/milestones/:idx/release`

**Auth:** Wallet signature (must match campaign's `creator`)
**Rate limit:** 10/min

Request:
```json
{
  "creator": "base58_address"
}
```

Validation:
- Campaign exists
- Milestone idx is valid (0-255)
- Milestone not already released

### Grace period info (added to existing campaign detail)

Added to `GET /api/campaigns/:treeAddress` response when `cancelledAt` is set:

```json
{
  "gracePeriod": {
    "end": "1700060800",
    "remaining": 432000,
    "isExpired": false
  }
}
```

---

## Key Decisions

### D1: Return serialized transaction, not instruction data

Returning a ready-to-sign transaction (with blockhash, accounts resolved) is more convenient for the FE than returning instruction data that the FE must assemble. The FE only needs to: deserialize → sign → send.

Blockhash freshness: transactions are valid for ~60 seconds on Solana. If the FE takes longer to sign, the blockhash may expire. Document that FE should submit within 30 seconds of receiving the prepared tx.

### D2: Derive PDAs server-side

All PDA derivations (vault_authority, vesting_tree, claim_record) happen server-side. The FE doesn't need to know the derivation logic — it just signs and submits.

### D3: Validate state server-side, reject early

The BE checks campaign state (cancelled, paused, grace period) before building the tx. This prevents the FE from building a tx that will fail on-chain with a cryptic Anchor error. Instead, the BE returns a clear 400 with the reason.

---

## File Map

### New files

| File | Purpose |
|------|---------|
| `apps/web/src/lib/api/tx-builder.ts` | Transaction construction utility |
| `apps/web/src/app/api/campaigns/[treeAddress]/cancel/route.ts` | Cancel campaign unsigned tx |
| `apps/web/src/app/api/campaigns/[treeAddress]/withdraw-unvested/route.ts` | Withdraw unvested unsigned tx |
| `apps/web/src/app/api/campaigns/[treeAddress]/cancel-stream/route.ts` | Cancel stream unsigned tx |
| `apps/web/src/app/api/campaigns/[treeAddress]/milestones/[idx]/route.ts` | Milestone release unsigned tx |
| `apps/web/tests/api/clawback.test.ts` | Clawback API tests |

### Modified files

| File | Change |
|------|--------|
| `apps/web/src/app/api/campaigns/[treeAddress]/route.ts` | Add grace period fields to GET response |

---

## Out of scope

- Automatic execution of cancel/withdraw (always wallet-signed)
- Grace period email notifications (P2)
- Grace period expiry webhook (P2)
