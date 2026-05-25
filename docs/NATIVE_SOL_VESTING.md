# Native SOL Vesting Without Wrapping — Research Report

> **Date**: 2026-05-25
> **Context**: BD and marketing requested removal of the SOL → wSOL wrapping step for vesting campaigns. This report evaluates feasibility, complexity, tradeoffs, and implementation strategy.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Why Wrapping Exists](#2-why-wrapping-exists)
3. [UX Problems with wSOL](#3-ux-problems-with-wsol)
4. [How Native SOL Transfers Work On-Chain](#4-how-native-sol-transfers-work-on-chain)
5. [Architecture for Native SOL Vesting](#5-architecture-for-native-sol-vesting)
6. [Pros and Cons](#6-pros-and-cons)
7. [Cost Comparison](#7-cost-comparison)
8. [Security Considerations](#8-security-considerations)
9. [How Major Protocols Handle This](#9-how-major-protocols-handle-this)
10. [Implementation Plan for Mancer Vesting](#10-implementation-plan-for-mancer-vesting)
11. [Recommendation](#11-recommendation)
12. [Sources](#12-sources)

---

## 1. Executive Summary

**Native SOL vesting without wrapping is technically feasible and has been implemented before** (Streamflow's deprecated devnet program). The core idea is simple: instead of wrapping SOL into an SPL token and storing it in a token account, store lamports directly in a PDA owned by the vesting program. On withdrawal, debit the PDA's lamports and credit the beneficiary's system account.

The main tradeoff: **every instruction that moves funds needs two codepaths** (one for native SOL, one for SPL tokens). This doubles the transfer-related code and testing surface across 6+ instructions.

For mancer-vesting specifically, the vesting schedule math, merkle tree logic, and milestone calculations are fully token-agnostic — only the transfer layer changes.

**Complexity verdict**: Moderate. Not a rewrite — more like adding a parallel rail. Estimated 3–5 days of dev work + dedicated audit for the new path.

---

## 2. Why Wrapping Exists

The SPL Token Program only understands two account types: **Mint** accounts and **TokenAccount** accounts. It has no concept of "native SOL" or "lamports in a system account." When a program calls `token::transfer`, it debits a token account's `amount` field and credits another token account's `amount` field — all within the Token Program's state model.

Wrapped SOL (mint `So11111111111111111111111111111111111111112`) bridges these two worlds. It is an SPL token backed 1:1 by native SOL. When you wrap:

1. Create a token account for the native mint
2. Transfer lamports into it via `SystemProgram::transfer`
3. Call `syncNative` — the Token Program updates the `amount` field to match the deposited lamports

**Current mancer-vesting flow**: Every token movement uses `anchor_spl::token::transfer` CPIs. The program never touches native lamports. Wrapping is handled client-side via `WrapSolModal` + `useWrapSol` hook, which explicitly states: *"This vesting program only works with SPL tokens, so you have to first wrap SOL to wSOL first."*

---

## 3. UX Problems with wSOL

| Problem | Impact |
|---------|--------|
| **Extra transactions** | 3–4 txs (create ATA → wrap → vest → unwrap) vs 1–2 for native SOL |
| **Rent costs** | ~0.006 SOL locked in token accounts that native SOL path avoids |
| **User confusion** | "Why do I need to wrap?" — non-obvious to non-crypto-native users |
| **syncNative pitfalls** | If sync is missed, token balance stays stale → downstream failures |
| **Dust wSOL** | Small amounts left in ATAs after unwrapping |
| **Failed transactions** | Users forget to wrap enough or skip the sync step |

For BD/marketing, the wrapping step is a conversion killer. Users bounce when they see "wrap required" — especially non-technical users who don't understand what it means or why it's necessary.

---

## 4. How Native SOL Transfers Work On-Chain

### Direct Lamport Manipulation

Any program can credit lamports to any writable account. A program can debit lamports from accounts it owns (like PDAs).

```rust
// Credit (any program can do this to any writable account)
**recipient.try_borrow_mut_lamports()? += amount;

// Debit (only the owner program can do this for non-signer accounts)
**source.try_borrow_mut_lamports()? -= amount;
```

### system_program::transfer CPI

For transferring lamports **from a signer's account** (e.g., during `create_campaign`), you must use `system_program::transfer` because the user's account is owned by the system program.

```rust
use anchor_lang::system_program::{transfer, Transfer};

let cpi_accounts = Transfer {
    from: ctx.accounts.creator.to_account_info(),
    to: ctx.accounts.vesting_tree.to_account_info(), // PDA receives lamports
};
let cpi_ctx = CpiContext::new(ctx.accounts.system_program.key(), cpi_accounts);
transfer(cpi_ctx, amount)?;
```

### Key Constraint

`system_program::transfer` requires the `from` account to be a signer. **PDAs cannot sign for system_program::transfer.** To move lamports OUT of a PDA, use direct lamport manipulation (no CPI needed).

### Comparison

| Aspect | SPL Token Transfer | system_program::transfer | Direct lamport manipulation |
|--------|-------------------|--------------------------|----------------------------|
| **From** | TokenAccount | System account (signer) | Any account owned by your program |
| **To** | TokenAccount | Any writable account | Any writable account |
| **Token accounts** | Yes (source + dest) | No | No |
| **ATA creation** | Yes | No | No |
| **CPI depth** | 1 (into token program) | 1 (into system program) | 0 (in-program) |
| **PDA as source** | Yes (via signer seeds) | No | Yes |

---

## 5. Architecture for Native SOL Vesting

### Account Structure

**Current (SPL-only)**: `VestingTree` PDA + `vault_authority` PDA + vault ATA (token account)

**Proposed (native SOL)**: `VestingTree` PDA holds lamports directly. The PDA's `lamports` field IS the vault. No separate token account or vault_authority needed.

### Discriminator Strategy

Use the `mint` field in `VestingTree` to distinguish native SOL campaigns from SPL token campaigns:

```rust
// All-zeros pubkey signals native SOL
pub const NATIVE_SOL_MINT: Pubkey = Pubkey::new_from_array([0u8; 32]);

impl VestingTree {
    pub fn is_native(&self) -> bool {
        self.mint == NATIVE_SOL_MINT
    }
}
```

PDA seeds already include `mint.key().as_ref()`, so native SOL campaigns naturally derive to different PDAs than SPL token campaigns for the same creator + campaign_id.

### Transfer Logic (claim instruction example)

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

### Account Validation with Optional SPL Accounts

Using Anchor's `condition` constraint (Anchor 0.30+):

```rust
#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub beneficiary: Signer<'info>,

    #[account(mut, seeds = [b"tree", ...], bump = vesting_tree.bump)]
    pub vesting_tree: Account<'info, VestingTree>,

    // Only needed for SPL token campaigns:
    #[account(condition = !vesting_tree.is_native())]
    pub vault_authority: Option<UncheckedAccount<'info>>,
    #[account(mut, condition = !vesting_tree.is_native())]
    pub vault: Option<Account<'info, TokenAccount>>,
    #[account(mut, condition = !vesting_tree.is_native())]
    pub beneficiary_ata: Option<Account<'info, TokenAccount>>,
    #[account(condition = !vesting_tree.is_native())]
    pub mint: Option<Account<'info, Mint>>,
    #[account(condition = !vesting_tree.is_native())]
    pub token_program: Option<Program<'info, Token>>,

    pub system_program: Program<'info, System>,
}
```

### Rent Accounting for Native SOL PDAs

The VestingTree PDA holds both vesting lamports AND rent-exempt minimum. Track deposited amount explicitly — do NOT derive vault balance from `pda.lamports() - rent_minimum`.

```rust
let pda_lamports = ctx.accounts.vesting_tree.to_account_info().lamports();
let rent_min = Rent::get()?.minimum_balance(8 + VestingTree::INIT_SPACE);
let available_lamports = pda_lamports.saturating_sub(rent_min);

require!(available_lamports >= claimable, VestingError::InsufficientVault);

// On final claim, drain everything (including rent) and let account close
if tree.total_claimed + claimable >= tree.total_supply {
    **ctx.accounts.vesting_tree.try_borrow_mut_lamports()? -= pda_lamports;
    **ctx.accounts.beneficiary.try_borrow_mut_lamports()? += pda_lamports;
} else {
    **ctx.accounts.vesting_tree.try_borrow_mut_lamports()? -= claimable;
    **ctx.accounts.beneficiary.try_borrow_mut_lamports()? += claimable;
}
```

### Cancellation / Refund

```rust
// Transfer vested amount to beneficiary
**pda.try_borrow_mut_lamports()? -= vested_amount;
**beneficiary.try_borrow_mut_lamports()? += vested_amount;

// Drain remaining (unvested + rent) to creator
let remains = pda.lamports();
**pda.try_borrow_mut_lamports()? -= remains;
**creator.try_borrow_mut_lamports()? += remains;
```

---

## 6. Pros and Cons

### Pros

| Benefit | Detail |
|---------|--------|
| **Better UX** | Users create vesting directly with SOL — no "wrap required" step, no education needed |
| **Fewer transactions** | 1–2 txs instead of 3–4 |
| **Lower costs** | Saves ~0.0045–0.006 SOL in rent for token accounts |
| **Simpler account graph** | Fewer accounts per transaction (no vault ATA, vault_authority, mint, token_program, associated_token_program) |
| **No rent recovery complexity** | PDA cleanup is one operation; no need to close multiple token accounts |
| **Lower compute units** | Direct lamport manipulation has zero CPI overhead |
| **Marketing advantage** | "No wrapping required" is a competitive differentiator |

### Cons

| Cost | Detail |
|------|--------|
| **Dual codepaths** | Every transfer instruction needs two implementations — roughly doubles transfer-related code |
| **More testing** | Every instruction must be tested for both SOL and SPL paths |
| **More audit scope** | Dual paths increase audit cost and duration |
| **Rent accounting risk** | PDA lamports mix vesting balance + rent; incorrect accounting can drain rent or lock funds |
| **No SPL composability** | Native SOL vesting cannot participate in DeFi patterns that expect SPL tokens |
| **No known Anchor reference** | Streamflow's implementation uses raw `solana_program`, not Anchor — adaptation required |
| **Pre-funding recipients** | Recipients need lamports for transaction fees to withdraw (Streamflow pre-funds 2× signature fees) |

---

## 7. Cost Comparison

### Full Vesting Lifecycle (10 SOL over 1 year)

| Cost Component | Native SOL Path | wSOL Path |
|----------------|----------------|-----------|
| Sender ATA creation | — | ~0.00203 SOL (if new) |
| Wrapping | — | ~0.000005 SOL tx fee |
| Vault/escrow token account | — | ~0.00203 SOL |
| Recipient ATA creation | — | ~0.00203 SOL (if new) |
| PDA rent | ~0.0015 SOL (reclaimable) | — |
| Create stream tx fee | ~0.000005 SOL | ~0.000005 SOL |
| Per-withdrawal tx fee | ~0.000005 SOL | ~0.000005 SOL |
| Unwrap | — | ~0.000005 SOL |
| Close accounts | — | ~0.000005 SOL |
| **Total overhead** | **~0.0015 SOL + tx fees** | **~0.006 SOL rent + tx fees** |

**Net savings**: ~0.0045 SOL per campaign in rent alone. More if the sender or recipient didn't already have a wSOL ATA.

---

## 8. Security Considerations

### Native SOL Path Risks

| Risk | Mitigation |
|------|-----------|
| **Lamport overflow/underflow** | Use checked arithmetic (`checked_sub`, `checked_add`); verify `source.lamports() >= amount` before debit |
| **Rent/lamport mixing** | Track `total_deposited` explicitly in `VestingTree` struct; never derive vault balance from live lamport count |
| **Premature drain** | Validate vesting schedule before releasing lamports; same schedule math as SPL path |
| **Recipient can't withdraw** | Pre-fund beneficiary with 2× signature fees during stream creation (Streamflow pattern) |
| **PDA closure edge cases** | Final claim or cancel must drain ALL lamports (vested + rent); partial drain leaves zombie account |

### SPL Token Path Risks (unchanged from current)

| Risk | Mitigation |
|------|-----------|
| wSOL smart contract risk | Token Program is heavily audited; risk is negligible |
| CPI depth | Well within 4-level limit for current architecture |

### Balance Conservation

Solana's runtime enforces that **the sum of all lamports in a transaction stays constant** — lamports cannot be created or destroyed. This is a strong invariant that catches many accounting bugs at the runtime level.

---

## 9. How Major Protocols Handle This

| Protocol | Native SOL Support | Approach |
|----------|-------------------|----------|
| **Streamflow (current, mainnet)** | No | wSOL only. 0.25% protocol fee. 14+ accounts per CPI. |
| **Streamflow (deprecated, devnet)** | Yes | Dual-path: separate `sol_*` and `tok_*` instruction handlers. Never deployed to mainnet. |
| **Bonfida Token Vesting** | No | wSOL only. Audited by Kudelski Security. |
| **Jupiter (DEX)** | N/A | Auto-wraps/unwraps atomically in single transaction. Not applicable to vesting. |
| **Marinade** | No | SPL tokens only for vesting. |
| **Tribeca** | No | SPL tokens only. |

**Key insight**: Streamflow is the only protocol known to have built native SOL vesting, and they **deprecated it**. The likely reasons: (1) dual codepaths are expensive to maintain, (2) wSOL is well-supported by wallets, (3) SPL token ecosystem is more composable. However, their target market (DeFi-native users) differs from mancer-vesting's audience (campaign creators who may not be crypto-native).

---

## 10. Implementation Plan for Mancer Vesting

### Files Requiring Changes

**On-chain (Rust):**

| File | Change |
|------|--------|
| `state/vesting_tree.rs` | Add `is_native()` helper; ensure `mint == Pubkey::default()` is valid |
| `instructions/create_campaign.rs` | Dual path: `system_program::transfer` for SOL, existing ATA flow for SPL |
| `instructions/create_stream.rs` | Same dual path as create_campaign |
| `instructions/fund_campaign.rs` | SOL: `system_program::transfer` from creator. SPL: unchanged. |
| `instructions/claim.rs` | SOL: direct lamport debit from PDA. SPL: unchanged CPI. |
| `instructions/withdraw.rs` | Same branching as claim. |
| `instructions/cancel_stream.rs` | SOL: direct lamport split to beneficiary + creator. SPL: unchanged. |
| `instructions/withdraw_unvested.rs` | SOL: direct lamport drain to creator. SPL: unchanged. |
| `instructions/close_claim_record.rs` | May need adaptation for SOL PDA closure on final claim. |

**Unchanged (token-agnostic):**
- `math/schedule.rs` — vesting schedule calculations
- `math/merkle.rs` — merkle tree / proof verification
- `state/vesting_leaf.rs` — leaf structure
- Error types, event types

**Client-side (TypeScript):**

| File | Change |
|------|--------|
| `TokenPickerModal.tsx` | Remove "Wrap required" badge for SOL; allow direct SOL selection |
| `useWrapSol.ts` | Optional — may deprecate for campaign/stream creation |
| `useCreateCampaign.ts` | Branch on native SOL: skip ATA creation, use system transfer |
| `useCreateStream.ts` | Same branching as useCreateCampaign |
| `popular-tokens.ts` | Simplify SOL entry; remove `isNativeSol` flag |

### Phased Approach

1. **Phase 1 — `create_stream` (single-recipient)**
   - Add native SOL support to `create_stream`, `withdraw`, `cancel_stream`
   - Validates architecture with minimal scope
   - E2E test on devnet

2. **Phase 2 — Campaign flow (multi-recipient, Merkle)**
   - Extend to `create_campaign`, `fund_campaign`, `claim`, `withdraw_unvested`
   - Merkle proofs are mint-agnostic — no changes needed

3. **Phase 3 — Client cleanup**
   - Remove wrapping UI for SOL
   - Update token picker
   - Deprecate `useWrapSol` for vesting flows

---

## 11. Recommendation

**Implement the dual-path architecture.** The UX improvement is real and the marketing team has specifically requested it. The complexity is manageable — it's a parallel rail, not a rewrite.

**Why this is worth doing for mancer-vesting specifically:**
- Target users include campaign creators who are **not DeFi-native** — wrapping is a meaningful friction point for this audience
- The vesting schedule and merkle layers are fully token-agnostic — only the thin transfer layer changes
- Streamflow's deprecated implementation provides a working reference architecture
- "No wrapping required" is a genuine competitive differentiator

**Risk mitigations:**
- Start with `create_stream` (single-recipient) to validate the architecture before extending to full campaign flow
- Track `total_deposited` explicitly in `VestingTree` to avoid rent/lamport mixing bugs
- Pre-fund beneficiaries with 2× signature fees to prevent "locked but can't withdraw" scenarios
- Budget for dedicated audit of the native SOL path
- Use `Pubkey::default()` as the native SOL discriminator to preserve existing PDA seed derivation

---

## 12. Sources

1. [SPL Token Program Documentation](https://spl.solana.com/token) — wrapping SOL, syncNative, rent costs
2. [Streamflow Deprecated Program (native SOL)](https://github.com/StreamFlow-Finance/streamflow-program) — `sol_initialize.rs`, `sol_withdraw.rs`, `sol_cancel.rs`
3. [Streamflow Rust SDK](https://github.com/streamflow-finance/rust-sdk) — current mainnet protocol, 0.25% fee
4. [Bonfida Token Vesting](https://github.com/Bonfida/token-vesting) — SPL-only vesting, Kudelski audit
5. [Solana Account Model](https://solana.com/docs/core/accounts) — ownership rules, lamport fields, rent
6. [Solana Runtime](https://solana.com/docs/core/runtime) — compute budget, CPI depth limits, balance conservation
7. [Anchor system_program module](https://docs.rs/anchor-lang/latest/anchor_lang/system_program/index.html) — transfer, Transfer structs
8. [SPL Associated Token Account](https://spl.solana.com/associated-token-account) — ATA derivation, program ID
