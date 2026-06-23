# Native SOL Vesting

Native SOL vesting allows campaigns to distribute raw SOL without requiring users to wrap SOL into wSOL first. This removes a significant friction point for non-DeFi-native users and saves approximately 0.0045 SOL per campaign in rent costs.

---

## 1. Why native SOL support matters

The standard SPL Token flow requires wrapping SOL into wSOL before it can be used in a vesting campaign. This introduces several UX problems:

| Problem | Impact |
|---------|--------|
| Extra transactions | 3-4 txs (create ATA, wrap, vest, unwrap) vs 1-2 for native SOL |
| Rent costs | ~0.006 SOL locked in token accounts that native SOL avoids |
| User confusion | "Why do I need to wrap?" is a common question from non-crypto-native users |
| syncNative pitfalls | If sync is missed, token balance stays stale and causes downstream failures |
| Failed transactions | Users forget to wrap enough or skip the sync step |

---

## 2. Dual-path architecture

The vesting program implements two parallel codepaths: one for SPL tokens and one for native SOL. The vesting schedule math, Merkle tree logic, and milestone calculations are fully token-agnostic -- only the transfer layer changes.

### Account structure

| Component | SPL token path | Native SOL path |
|-----------|---------------|-----------------|
| Vault | Separate ATA owned by `vault_authority` PDA | The `VestingTree` PDA itself holds lamports |
| Vault authority | Dedicated PDA that signs token transfers | Not needed |
| Token accounts | Source ATA, vault ATA, beneficiary ATA | None |
| Transfer mechanism | `anchor_spl::token::transfer` CPI | Direct lamport manipulation |

### Discriminator strategy

The `mint` field in `VestingTree` distinguishes campaign types:

- **SPL token campaigns:** `mint` = the SPL token mint address
- **Native SOL campaigns:** `mint` = `PublicKey.default` (all-zeros pubkey)

PDA seeds already include `mint.key().as_ref()`, so native SOL campaigns naturally derive to different PDAs than SPL token campaigns for the same creator + campaign_id.

### Transfer logic

For SPL tokens, the program uses standard token CPI transfers. For native SOL, the program manipulates lamports directly:

```rust
if tree.is_native() {
    // Native SOL: direct lamport transfer from PDA to beneficiary
    **ctx.accounts.vesting_tree.try_borrow_mut_lamports()? -= claimable;
    **ctx.accounts.beneficiary.try_borrow_mut_lamports()? += claimable;
} else {
    // SPL Token: existing CPI code
    let signer_seeds = &[&[b"vault_authority", tree_key.as_ref(), &[bump]][..]];
    let cpi_ctx = CpiContext::new_with_signer(token_program, cpi_accounts, signer_seeds);
    anchor_spl::token::transfer(cpi_ctx, claimable)?;
}
```

{% hint style="info" %}
Direct lamport manipulation has zero CPI overhead, making native SOL transfers cheaper in compute units than SPL token transfers.
{% endhint %}

---

## 3. Instruction variants

Each transfer-related instruction has a native SOL counterpart:

| SPL instruction | Native SOL variant |
|----------------|-------------------|
| `createCampaign` | `createCampaignNative` |
| `createStream` | `createStreamNative` |
| `fundCampaign` | `fundCampaignNative` |
| `claim` | Same instruction, branching internally |
| `withdraw` | Same instruction, branching internally |
| `cancelStream` | Same instruction, branching internally |
| `withdrawUnvested` | Same instruction, branching internally |

Token-agnostic instructions (no separate variant needed): `setMilestoneReleased`, `updateRoot`, `pauseCampaign`, `unpauseCampaign`, `closeClaimRecord`, `getVestedAmount`.

---

## 4. Rent accounting

The `VestingTree` PDA holds both vesting lamports **and** the rent-exempt minimum. The program tracks deposited amounts explicitly -- it never derives vault balance from `pda.lamports() - rent_minimum`.

```rust
let pda_lamports = ctx.accounts.vesting_tree.to_account_info().lamports();
let rent_min = Rent::get()?.minimum_balance(8 + VestingTree::INIT_SPACE);
let available_lamports = pda_lamports.saturating_sub(rent_min);

require!(available_lamports >= claimable, VestingError::InsufficientVault);
```

On the **final** claim, the PDA is drained completely (vested amount + rent) and the account is closed:

```rust
if tree.total_claimed + claimable >= tree.total_supply {
    // Drain everything including rent
    let total = ctx.accounts.vesting_tree.to_account_info().lamports();
    **ctx.accounts.vesting_tree.try_borrow_mut_lamports()? -= total;
    **ctx.accounts.beneficiary.try_borrow_mut_lamports()? += total;
}
```

{% hint style="warning" %}
`withdraw_unvested` (native) preserves the rent-exempt minimum so the tree PDA stays queryable by indexers. This prevents the SC-FIND-02 issue where closed accounts break event indexing.
{% endhint %}

---

## 5. Cost comparison

### Full vesting lifecycle (10 SOL over 1 year)

| Cost component | Native SOL path | wSOL path |
|----------------|----------------|-----------|
| Sender ATA creation | -- | ~0.00203 SOL (if new) |
| Wrapping | -- | ~0.000005 SOL tx fee |
| Vault/escrow token account | -- | ~0.00203 SOL |
| Recipient ATA creation | -- | ~0.00203 SOL (if new) |
| PDA rent | ~0.0015 SOL (reclaimable) | -- |
| Create stream tx fee | ~0.000005 SOL | ~0.000005 SOL |
| Per-withdrawal tx fee | ~0.000005 SOL | ~0.000005 SOL |
| Unwrap | -- | ~0.000005 SOL |
| Close accounts | -- | ~0.000005 SOL |
| **Total overhead** | **~0.0015 SOL + tx fees** | **~0.006 SOL rent + tx fees** |

**Net savings:** approximately 0.0045 SOL per campaign in rent alone. More if the sender or recipient did not already have a wSOL ATA.

---

## 6. Security considerations

| Risk | Mitigation |
|------|-----------|
| Lamport overflow/underflow | Checked arithmetic (`checked_sub`, `checked_add`); verify `source.lamports() >= amount` before debit |
| Rent/lamport mixing | `total_deposited` tracked explicitly in `VestingTree`; never derived from live lamport count |
| Premature drain | Same vesting schedule math validates before releasing lamports |
| Recipient cannot withdraw | Beneficiary needs lamports for transaction fees to claim |
| PDA closure edge cases | Final claim or cancel drains ALL lamports (vested + rent); partial drain leaves zombie accounts |

Solana's runtime enforces that the sum of all lamports in a transaction stays constant -- lamports cannot be created or destroyed. This is a strong invariant that catches accounting bugs at the runtime level.

---

## 7. Frontend integration

### Detecting native SOL campaigns

```typescript
import { PublicKey } from "@solana/web3.js";

function isNativeSolCampaign(treeAccount: any): boolean {
  return treeAccount.mint.equals(PublicKey.default);
}
```

### Creating a native SOL stream

Pass `PublicKey.default` as the mint. The frontend hooks (`useCreateCampaign`, `useCreateStream`) automatically route to the native variants when the mint is `PublicKey.default`:

```typescript
const result = await createStream({
  mintAddress: PublicKey.default.toBase58(),  // signals native SOL
  campaignId: Date.now().toString(),
  beneficiary: "RECIPIENT_WALLET",
  amount: "1000000000",                       // lamports
  releaseType: 1,
  startTime: now,
  cliffTime: now,
  endTime: now + 365 * 86_400,
  milestoneIdx: 0,
  cancellable: true,
});
```

### PDA derivation for native SOL

Use `PublicKey.default` (32 zero bytes) as the mint seed:

```typescript
const [vestingTree] = derivePda([
  "tree",
  creator.toBuffer(),
  PublicKey.default.toBuffer(),  // native SOL marker
  new BN(campaignId).toArrayLike(Buffer, "le", 8),
]);
```

No vault ATA or vault authority is needed for native SOL campaigns.

---

## 8. How major protocols handle this

| Protocol | Native SOL | Approach |
|----------|-----------|----------|
| **Streamflow (mainnet)** | No | wSOL only. 0.25% protocol fee. |
| **Streamflow (deprecated, devnet)** | Yes | Dual-path with separate `sol_*` handlers. Never deployed to mainnet. |
| **Bonfida Token Vesting** | No | wSOL only. Audited by Kudelski Security. |
| **Marinade** | No | SPL tokens only. |
| **Tribeca** | No | SPL tokens only. |

Velthoryn is one of the few protocols to ship native SOL vesting to production. The dual-path architecture adds maintenance cost but eliminates wrapping friction entirely.

---

## Further reading

- [Program Integration](integration.md) -- full walkthrough with native SOL variants
- [Frontend Integration](frontend-integration.md) -- React hooks that auto-detect native SOL
- [Instruction Reference](../reference/instructions.md) -- native SOL instruction accounts and constraints
