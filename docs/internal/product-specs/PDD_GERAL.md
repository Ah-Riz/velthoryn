# PDD — Velthoryn Vesting Frontend Design (Geral's Scope)

**Author:** Geral — frontend lead  
**Status:** Week 4 design → **Updated Week 9 (2026-06-18)**  
**Companion docs:** `docs/PRD_GERAL.md` (requirements), `docs/TDD_GERAL.md` (tests), `docs/SECURITY_GERAL.md` (security), `docs/INTEGRATION.md` (SC interface)

> **Week 9 note**: This document was written at Week 4. Several design decisions changed during implementation (Zustand was not used; shadcn/ui was added in Week 8; 8-state lifecycle was added in Week 7). See the "§ Week 9 Status" annotations within each section. For the authoritative current architecture, see `docs/week9/FE_ARCHITECTURE.md`.

---

## §1 Executive Summary

The frontend transforms the Velthoryn Vesting protocol from a developer-only Solana program into a usable product. Three user types (Creator, Recipient, Admin) interact with the same Next.js 15 dApp through different page routes.

### Design goals

| Goal | How |
|---|---|
| **Zero-config for recipients** | Wallet connect → auto-detect campaigns → one-click claim |
| **Trustless** | All transactions built and signed client-side. No backend, no custody |
| **Responsive** | Mobile-first Tailwind layout (375px–2560px) |
| **Offline-capable chain state** | TanStack Query caches account data; UI works while RPC is slow |
| **Deterministic PDA derivation** | Frontend computes identical PDAs to the smart contract — no lookup table |

### Trade-offs

| Decision | Chose | Over | Why |
|---|---|---|---|
| State management | Zustand + TanStack Query | Redux | Two libraries, each optimal for its job. Redux = overkill for this scope |
| Wallet connection | Wallet standard auto-detect | `@solana/wallet-adapter-wallets` bundle | React 19 peer dep conflicts. Phantom/Solflare/Backpack all implement standard |
| Styling | Tailwind CSS 4 | CSS Modules / styled-components | No runtime CSS-in-JS overhead. SSR-friendly. Utility-first = fast iteration |
| Vesting math | Client-side calculation | On-chain `getVestedAmount` CPI | Instant feedback. Saves RPC call. Fallback to on-chain if client math diverges |
| Merkle tree building | Client-side (browser) | Server-side API | Trustless — creator sees exactly what goes on-chain. No server to compromise |
| Proof storage | IPFS/Pinata | Database | Decentralized, censorship-resistant, permanent. Recipients don't depend on our infra |

---

## §2 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js 15 App Router                │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  Pages   │  │  Components  │  │    Hooks           │  │
│  │          │  │              │  │                    │  │
│  │ /        │  │ WalletBtn    │  │ useVestingProgram  │  │
│  │ /create  │  │ StreamCard   │  │ useCampaign        │  │
│  │ /[id]    │  │ ClaimPanel   │  │ useClaim           │  │
│  │ /admin   │  │ VestingChart │  │ useCreateCampaign  │  │
│  └──────────┘  │ CsvUploader  │  │ useVestingMath     │  │
│                │ AdminPanel   │  └────────┬───────────┘  │
│                └──────────────┘           │              │
│                                          ▼              │
│  ┌─────────────────────────────────────────────────┐    │
│  │              State Layer                         │    │
│  │                                                  │    │
│  │  Zustand (client)     TanStack Query (chain)    │    │
│  │  ├─ selectedCampaign  ├─ campaigns[]            │    │
│  │  ├─ modalState        ├─ streamData             │    │
│  │  └─ formDraft         ├─ balances               │    │
│  │                       └─ claimRecords           │    │
│  └──────────────────────────┬──────────────────────┘    │
│                             │                           │
│  ┌──────────────────────────▼──────────────────────┐    │
│  │           Anchor / Solana Layer                  │    │
│  │                                                  │    │
│  │  AnchorProvider  Program<Vesting>  derivePda()  │    │
│  │  Connection      Transaction       SPL Token    │    │
│  └──────────────────────────┬──────────────────────┘    │
│                             │                           │
│  ┌──────────────────────────▼──────────────────────┐    │
│  │           Merkle Layer (off-chain)               │    │
│  │                                                  │    │
│  │  encodeLeaf()  hashLeaf()  buildTree()          │    │
│  │  getRoot()     getProof()                        │    │
│  │  keccak256 + merkletreejs                        │    │
│  └──────────────────────────┬──────────────────────┘    │
│                             │                           │
└─────────────────────────────┼───────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────┐
              │  Solana Devnet RPC        │
              │  IPFS / Pinata (proofs)   │
              └───────────────────────────┘
```

---

## §3 Page Routes & Layout

### Route structure

```
apps/web/src/app/
├── layout.tsx              # Root layout: QueryProvider → WalletProvider → children
├── page.tsx                # Landing: hero + CTA buttons
├── campaign/
│   ├── create/
│   │   └── page.tsx        # Creator: CSV upload → preview → create + fund
│   ├── [id]/
│   │   └── page.tsx        # Recipient: vesting details + claim button
│   └── page.tsx            # (Future) Campaign list / search
└── admin/
    └── [id]/
        └── page.tsx        # (Future) Admin: pause, cancel, root rotation
```

### Layout hierarchy

```
RootLayout (layout.tsx)
├── QueryProvider           # TanStack Query context (client component)
│   └── WalletProvider      # Solana wallet context (client component)
│       ├── Header          # (To build) Wallet button + navigation
│       ├── {page content}  # Server or client component per route
│       └── Footer          # (To build) Links, status
```

**Key decision:** Root layout wraps both providers. Every page has wallet + query access. No per-route provider nesting.

### Page responsibilities

| Route | Component | Data source | Key actions |
|---|---|---|---|
| `/` | `HomePage` | None (static) | Navigate to create / view |
| `/campaign/create` | `CreateCampaignPage` | Form state (Zustand) | CSV upload → build tree → createCampaign → fundCampaign |
| `/campaign/[id]` | `CampaignPage` | TanStack Query (VestingTree account, ClaimRecord) | View vesting → claim tokens |
| `/admin/[id]` | `AdminPage` | TanStack Query (VestingTree account) | Pause / cancel / update root |

---

## §4 Component Architecture

### Component tree (target Week 6)

```
RootLayout
├── Header
│   ├── Logo
│   ├── NavLinks
│   └── WalletMultiButton (from @solana/wallet-adapter-react-ui)
│
├── CreateCampaignPage
│   ├── CsvUploader           # Drag-drop CSV, parse, validate
│   ├── RecipientTable        # Preview parsed recipients
│   ├── CampaignConfig        # Mint selector, schedule type, dates
│   ├── MerklePreview         # Root hash, leaf count, cost estimate
│   ├── CreateButton          # Calls createCampaign instruction
│   └── FundButton            # Calls fundCampaign instruction
│
├── CampaignPage (recipient view)
│   ├── CampaignHeader        # Campaign metadata, status badge
│   ├── VestingProgress       # Progress bar or chart
│   ├── ClaimPanel
│   │   ├── BalanceDisplay    # Total / vested / claimed / claimable
│   │   └── ClaimButton       # Calls claim instruction
│   ├── ScheduleTimeline      # Cliff/linear/milestone display
│   └── EventFeed             # Recent Claimed events
│
└── AdminPage
    ├── CampaignStatus        # Active / Paused / Cancelled badge
    ├── PauseToggle           # pause_campaign / unpause_campaign
    ├── CancelPanel           # cancel_campaign + grace countdown
    ├── WithdrawPanel         # withdraw_unvested (post-grace)
    └── RootRotationPanel     # Upload new CSV → update_root
```

### Component design principles

1. **Small, focused components** — one component = one responsibility
2. **Hooks for all program interaction** — components never call Anchor directly
3. **Server Components where possible** — landing page, static content = no JS bundle
4. **Client Components for interactivity** — forms, wallet, chain data = `"use client"`
5. **No prop drilling** — use hooks (useVestingProgram, useCampaign) instead

---

## §5 State Management Design

### Two-layer architecture (Week 4 design)

```
┌─────────────────────────┐     ┌─────────────────────────────┐
│  Zustand (client state) │     │  TanStack Query (chain state)│
│                         │     │                              │
│  - selectedCampaignId   │     │  - campaigns[] (VestingTree) │
│  - createFormDraft      │     │  - claimRecords[]            │
│  - modalOpen            │     │  - tokenBalances             │
│  - csvParseResult       │     │  - transactionHistory        │
│  - uiPreferences        │     │                              │
│                         │     │  Config:                     │
│  Sync: immediate        │     │  - staleTime: 10s            │
│  Persist: none (session) │     │  - refetchOnWindowFocus: off │
│                         │     │  - invalidate on events      │
└─────────────────────────┘     └─────────────────────────────┘
```

> ⚠️ **Week 9 status**: **Zustand was never installed or used.** The actual implementation uses **TanStack Query v5** for server state and **React `useState`** for all local UI state (forms, modals, toggles). Zustand was evaluated at Week 4 but dropped — the app's form state is per-page and doesn't need global client state.

### Actual state management (Week 9)

| Layer | Tool | What it manages |
|---|---|---|
| Server state | TanStack Query v5 | Campaign data, proof data, vesting progress, claim records |
| Local UI state | React `useState` | Form fields, modal open/close, schedule dates |
| Persistent client | `localStorage` | Pending campaign index queue, sidebar collapse |
| Wallet state | wallet-adapter context | Connected wallet, public key, sendTransaction |

### TanStack Query keys (actual)

```typescript
["campaign", treeAddress]                    // single campaign detail
["vestingProgress", address]                 // beneficiary portfolio
["proof", treeAddress, beneficiary]          // Merkle proof
["claimRecord", treeAddress, beneficiary]    // on-chain PDA
["campaigns"]                                // campaign list
["mintDecimals", mintAddresses.join(",")]     // SPL mint decimals
```

### TanStack Query keys

```typescript
const queryKeys = {
  campaign: (id: PublicKey) => ["campaign", id.toBase58()] as const,
  claimRecord: (tree: PublicKey, beneficiary: PublicKey) =>
    ["claimRecord", tree.toBase58(), beneficiary.toBase58()] as const,
  tokenBalance: (ata: PublicKey) => ["tokenBalance", ata.toBase58()] as const,
  allCampaigns: (creator: PublicKey) => ["campaigns", creator.toBase58()] as const,
};
```

---

## §6 Data Flow

### Flow 1: Create Campaign

```
CSV file
  → CsvUploader: parse rows, validate addresses/amounts
  → Zustand: store createForm.csvData
  → MerklePreview: buildTree(leaves) → getRoot(tree) → display root hash
  → CreateButton click:
      1. Pin leaves to IPFS/Pinata → get proofUri
      2. Build createCampaign instruction (root, leafCount, totalSupply, authorities)
      3. Wallet signs → send transaction
      4. On confirm: invalidate campaigns query
  → FundButton click:
      1. Build fundCampaign instruction (amount)
      2. Wallet signs → send transaction
      3. On confirm: invalidate campaign + balance queries
```

### Flow 2: Claim Tokens

```
Recipient connects wallet
  → useRecipientCampaigns(wallet): fetch all VestingTree accounts, filter by beneficiary presence
  → For each campaign:
      1. Fetch proof from IPFS (by campaign root + beneficiary)
      2. useVestingMath(leaf, now): compute vested, claimable
      3. Display BalanceDisplay: total / vested / claimed / claimable
  → ClaimButton click:
      1. Build claim instruction (leaf, proof)
      2. Wallet signs → send transaction
      3. On confirm: invalidate claimRecord + balance queries
      4. Subscribe to Claimed event → update EventFeed
```

### Flow 3: Admin Operations

```
Admin connects wallet
  → useCampaign(id): fetch VestingTree account
  → Display campaign status + admin controls
  → PauseToggle: pauseCampaign / unpauseCampaign instruction
  → CancelPanel: cancelCampaign instruction → show grace countdown
  → WithdrawPanel (post-grace): withdrawUnvested instruction
  → RootRotationPanel: upload new CSV → buildTree → updateRoot instruction
```

---

## §7 Anchor Integration Layer

### Program initialization

```typescript
// hooks/useVestingProgram.ts (target implementation)
export function useVestingProgram() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  return useMemo(() => {
    if (!wallet) return null;
    const provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    return new Program<Vesting>(IDL as Vesting, provider);
  }, [connection, wallet]);
}
```

### PDA derivation (must match smart contract exactly)

```typescript
// lib/anchor/client.ts

// VestingTree: ["tree", creator, mint, campaign_id.to_le_bytes()]
function deriveVestingTree(creator: PublicKey, mint: PublicKey, campaignId: BN) {
  return derivePda([
    "tree",
    creator.toBuffer(),
    mint.toBuffer(),
    campaignId.toArrayLike(Buffer, "le", 8),
  ]);
}

// VaultAuthority: ["vault_authority", vesting_tree]
function deriveVaultAuthority(vestingTree: PublicKey) {
  return derivePda(["vault_authority", vestingTree.toBuffer()]);
}

// ClaimRecord: ["claim", vesting_tree, beneficiary]
function deriveClaimRecord(vestingTree: PublicKey, beneficiary: PublicKey) {
  return derivePda(["claim", vestingTree.toBuffer(), beneficiary.toBuffer()]);
}
```

**Critical:** PDA seeds must be byte-identical to `programs/vesting/src/instructions/*.rs` constraint blocks. Any mismatch → `AccountNotInitialized` or wrong account read.

### Custom hooks pattern

```typescript
// hooks/useCampaign.ts
export function useCampaign(campaignId: PublicKey) {
  const program = useVestingProgram();

  return useQuery({
    queryKey: queryKeys.campaign(campaignId),
    queryFn: () => program?.account.vestingTree.fetch(campaignId),
    enabled: !!program,
    staleTime: 10_000,
  });
}

// hooks/useClaim.ts
export function useClaim() {
  const program = useVestingProgram();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ leaf, proof, accounts }) => {
      return program?.methods
        .claim(leaf, proof)
        .accounts(accounts)
        .rpc();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["claimRecord"] });
      queryClient.invalidateQueries({ queryKey: ["tokenBalance"] });
    },
  });
}
```

---

## §8 Vesting Math (Client-side)

Frontend mirrors smart contract schedule math for instant UI feedback.

### Linear vesting calculation

```typescript
function computeLinearVested(
  totalAmount: bigint,
  startTs: bigint,
  endTs: bigint,
  nowTs: bigint,
): bigint {
  if (nowTs <= startTs) return 0n;
  if (nowTs >= endTs) return totalAmount;

  const elapsed = nowTs - startTs;
  const duration = endTs - startTs;

  // u128 intermediate to prevent overflow (mirrors Rust)
  return (totalAmount * elapsed) / duration;
}
```

### Cliff vesting calculation

```typescript
function computeCliffVested(
  totalAmount: bigint,
  cliffTs: bigint,
  nowTs: bigint,
): bigint {
  return nowTs >= cliffTs ? totalAmount : 0n;
}
```

### Claimable amount

```typescript
function computeClaimable(
  vested: bigint,
  alreadyClaimed: bigint,
): bigint {
  const diff = vested - alreadyClaimed;
  return diff > 0n ? diff : 0n;
}
```

**Consistency guarantee:** Client-side math uses same `bigint` arithmetic as Rust's `u128`. Golden vector test (`tests/merkle/builder.test.ts`) validates hash consistency. Vesting math consistency to be validated by integration tests mapping to AC 3.

---

## §9 Error Handling Patterns

### Error mapping: Anchor → human-readable

```typescript
const ERROR_MESSAGES: Record<number, { title: string; action: string }> = {
  6000: { title: "Campaign already exists",        action: "Use a different campaign ID" },
  6001: { title: "Insufficient supply",            action: "Check total amount matches CSV" },
  6002: { title: "Invalid Merkle proof",           action: "Proof may be outdated — refresh and retry" },
  6003: { title: "Nothing to claim yet",           action: "Tokens haven't vested — check schedule" },
  6004: { title: "Campaign is paused",             action: "Contact campaign admin" },
  6005: { title: "Campaign is cancelled",          action: "Claim earned tokens before grace period ends" },
  6006: { title: "Unauthorized",                   action: "Only the recipient can claim this stream" },
  6007: { title: "Grace period still active",      action: "Wait for 7-day grace period to expire" },
  // ... map all 30 VestingError variants
};
```

### Error display pattern

```
┌──────────────────────────────────────────────┐
│ ⚠ Transaction Failed                        │
│                                              │
│ Campaign is paused                           │
│ Contact the campaign admin to resume claims. │
│                                              │
│ [View on Explorer]        [Dismiss]          │
└──────────────────────────────────────────────┘
```

### Error categories

| Category | Source | Handling |
|---|---|---|
| Wallet errors | Wallet adapter | "Please connect your wallet" / "Transaction rejected by wallet" |
| RPC errors | Solana network | "Network error — retrying..." with exponential backoff |
| Program errors | Anchor (error codes 6000–6029) | Map to human-readable message + action |
| Validation errors | Frontend input | Inline form validation, prevent submission |
| Timeout errors | Transaction confirmation | "Transaction pending — check explorer" with tx link |

---

## §10 Wallet Connection Strategy

### Connection flow

```
User clicks "Connect Wallet"
  → WalletModalProvider shows auto-detected wallets
  → User selects Phantom / Solflare / Backpack
  → Wallet approves connection
  → useWallet() returns { publicKey, signTransaction, connected }
  → Header shows truncated address (e.g., "7mGE...dVv")
  → AnchorProvider binds to connected wallet
  → All instruction calls use wallet as signer
```

### Configuration

```typescript
// WalletProvider.tsx — current implementation
const RPC_ENDPOINT = process.env.NEXT_PUBLIC_RPC_ENDPOINT ?? "https://api.devnet.solana.com";

<ConnectionProvider endpoint={RPC_ENDPOINT}>
  <SolanaWalletProvider wallets={[]} autoConnect>
    <WalletModalProvider>{children}</WalletModalProvider>
  </SolanaWalletProvider>
</ConnectionProvider>
```

**`wallets={[]}`** — empty array means wallet standard auto-detect only. No explicit adapter imports. This avoids React 19 peer dependency conflicts with the `@solana/wallet-adapter-wallets` omnibus package.

**`autoConnect`** — reconnects to last used wallet on page reload. Good UX — user doesn't re-connect every visit.

### Wallet state in UI

| State | UI |
|---|---|
| Not connected | "Connect Wallet" button (purple CTA) |
| Connecting | Spinner in button |
| Connected | Truncated address + disconnect option |
| Wrong network | Warning banner: "Switch to Devnet" |

---

## §11 Responsive Layout Design

### Breakpoints (Tailwind defaults)

| Breakpoint | Width | Layout |
|---|---|---|
| `sm` | ≥640px | Single column, larger touch targets |
| `md` | ≥768px | Two-column for dashboard |
| `lg` | ≥1024px | Full desktop layout |
| `xl` | ≥1280px | Max-width container, centered |

### Mobile-first approach

```
Mobile (375px)          Tablet (768px)          Desktop (1280px)
┌──────────────┐        ┌──────────────────┐    ┌──────────────────────────┐
│ ≡ Logo  [W]  │        │ Logo    Nav   [W]│    │ Logo    Nav         [W] │
├──────────────┤        ├────────┬─────────┤    ├──────────┬───────────────┤
│              │        │        │         │    │          │               │
│  Campaign    │        │ Campaign│ Claim  │    │ Campaign │  Claim Panel  │
│  Details     │        │ Details │ Panel  │    │ Details  │  + Schedule   │
│              │        │        │         │    │ + Chart  │  + Events     │
│──────────────│        │        │         │    │          │               │
│  Claim Panel │        │        │         │    │          │               │
│──────────────│        └────────┴─────────┘    └──────────┴───────────────┘
│  Schedule    │
│──────────────│
│  Events      │
└──────────────┘
```

### Key responsive patterns

1. **Stack on mobile, side-by-side on desktop** — campaign details + claim panel
2. **Collapsible sections** — schedule timeline, event feed collapse on mobile
3. **Touch targets ≥ 44px** — buttons, links meet Apple HIG minimum
4. **No horizontal scroll** — all content flows within viewport
5. **Truncate long values** — addresses, hashes get `truncate` class on mobile

---

## §12 IPFS / Proof Storage Design

### Pinning workflow (Creator side)

```
Creator uploads CSV
  → Frontend builds Merkle tree
  → For each leaf: { leafData, proof: Buffer[] }
  → Pin to IPFS/Pinata as JSON:
      {
        "root": "0xabc...",
        "leaves": [
          { "beneficiary": "7mGE...", "leaf": {...}, "proof": ["0x...", "0x..."] },
          ...
        ]
      }
  → Get CID (content hash)
  → Store CID in campaign metadata (off-chain mapping: campaignPDA → CID)
```

### Retrieval workflow (Recipient side)

```
Recipient connects wallet
  → Frontend looks up CID for campaign
  → Fetch proof set from IPFS: GET https://gateway.pinata.cloud/ipfs/{CID}
  → Find entry matching connected wallet
  → Extract leaf + proof
  → Pass to claim instruction
```

### Storage format

```json
{
  "version": 1,
  "root": "cf2129259e55d196c624b52834eeca822036914cabe10ce39ebbfbe67270627b",
  "leafCount": 3,
  "leaves": [
    {
      "beneficiary": "7mGET6XMy7yqJqFVfSZ7zYxsLowJWXYhDmsMm8MHjdVv",
      "leafIndex": 0,
      "amount": "1000000",
      "releaseType": 1,
      "startTs": "1700000000",
      "cliffTs": "0",
      "endTs": "1731536000",
      "milestoneIdx": 0,
      "proof": [
        "a1b2c3d4...",
        "e5f6a7b8..."
      ]
    }
  ]
}
```

---

## §13 Current Implementation Status

### What's built (Week 3)

| Component | File | Status |
|---|---|---|
| Root layout | `app/layout.tsx` | ✅ LIVE — QueryProvider → WalletProvider → children |
| Landing page | `app/page.tsx` | ✅ LIVE — hero + CTA links |
| WalletProvider | `components/providers/WalletProvider.tsx` | ✅ LIVE — wallet standard, devnet RPC |
| QueryProvider | `components/providers/QueryProvider.tsx` | ✅ LIVE — staleTime 10s |
| Zustand store | `store/useAppStore.ts` | ✅ LIVE — selectedCampaignId |
| Merkle builder | `lib/merkle/builder.ts` | ✅ LIVE — byte-verified against Rust |
| Anchor client | `lib/anchor/client.ts` | ⚠️ PARTIAL — derivePda works, wrong PROGRAM_ID |
| useVestingProgram | `hooks/useVestingProgram.ts` | ❌ STUB — returns null |
| Create page | `app/campaign/create/page.tsx` | ❌ STUB — placeholder |
| Campaign page | `app/campaign/[id]/page.tsx` | ❌ STUB — placeholder |
| Merkle tests | `tests/merkle/builder.test.ts` | ✅ LIVE — 5 tests (4 pass, 1 golden vector) |

### What's planned (Week 6)

| Component | File | Priority |
|---|---|---|
| Header + navigation | `components/Header.tsx` | P0 |
| CsvUploader | `components/CsvUploader.tsx` | P0 |
| CampaignConfig | `components/CampaignConfig.tsx` | P0 |
| ClaimPanel | `components/ClaimPanel.tsx` | P0 |
| BalanceDisplay | `components/BalanceDisplay.tsx` | P0 |
| VestingProgress | `components/VestingProgress.tsx` | P1 |
| EventFeed | `components/EventFeed.tsx` | P1 |
| AdminPanel | `components/AdminPanel.tsx` | P2 |

### Resolved issues (Week 4)

| Issue | Resolution |
|---|---|
| PROGRAM_ID was `7mGET6...` | ✅ Fixed — `G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu` |
| IDL import commented out | ✅ Fixed — wired with Anchor IDL |
| useVestingProgram returned null | ✅ Fixed — connected to AnchorProvider + IDL |
| Hydration mismatch (wallet button) | ✅ Fixed — `dynamic(() => import(...), { ssr: false })` |

---

## §14 Dependencies on Smart Contract

| Frontend component | Depends on | SC instruction | Status |
|---|---|---|---|
| CreateButton | create_campaign logic | `createCampaign` | ⏳ Week 4 |
| FundButton | fund_campaign logic | `fundCampaign` | ⏳ Week 4 |
| ClaimButton | claim logic + Merkle verify | `claim` | ⏳ Week 4 |
| PauseToggle | pause/unpause logic | `pauseCampaign` / `unpauseCampaign` | ⏳ Week 4 |
| CancelPanel | cancel logic + grace period | `cancelCampaign` | ⏳ Week 4 |
| WithdrawPanel | withdraw_unvested logic | `withdrawUnvested` | ⏳ Week 4 |
| RootRotationPanel | update_root logic | `updateRoot` | ⏳ Week 4 |
| VestingProgress | `get_vested_amount` (optional) | `getVestedAmount` | ⏳ Week 4 |

**Unblocked work (no SC dependency):**
- Wallet connection, provider setup
- CSV parsing + Merkle tree building
- UI layout, responsive design
- Client-side vesting math
- Frontend unit tests (Vitest)
- IPFS/Pinata integration

> **Week 9 status**: All SC-dependent components from this table are **✅ fully implemented**.

---

## §15 Week 9 Additions (not in original design)

### shadcn/ui Migration (Week 8)

All custom UI primitives replaced with shadcn/ui components in Week 8 (commit `e1ec4b8`). Components added to `apps/web/src/components/ui/`:

- `badge.tsx`, `button.tsx`, `card.tsx`, `dialog.tsx`, `input.tsx`, `label.tsx`
- `progress.tsx`, `scroll-area.tsx`, `select.tsx`, `skeleton.tsx`, `sonner.tsx`, `tooltip.tsx`

Design tokens moved from custom Tailwind classes to CSS custom properties (`--background`, `--foreground`, `--primary`, etc.) in `globals.css`.

### 8-State Campaign Lifecycle (Week 7)

The `CampaignLifecycle` type was added to `lib/vesting/list.ts` at Week 7:

```typescript
export type CampaignLifecycle =
  | "active"
  | "paused"
  | "claimable"
  | "claimed"
  | "cancelled_grace"
  | "cancelled_expired"
  | "instant_refunded"
  | "settled";
```

All UI branching (button visibility, banner content, countdown display) is driven by this enum. The `isGracePeriodVisible()` helper was added in Week 8 to prevent false-positive grace period display when `instantRefunded` or `streamSettled` is true.

### Dark Mode Architecture

`ThemeProvider` (from `next-themes`) wraps the app at root layout level with `defaultTheme="dark"`. CSS custom properties in `globals.css` drive all shadcn/ui component colors. Toggle is in `shell/ThemeToggle.tsx`.

### FE-SC Communication Pattern (vs original design)

The original design assumed client-side Anchor program calls directly from components/hooks. The final implementation uses a **server-side tx-builder** pattern:

1. Client hook calls a Next.js Route Handler (server side)
2. Server builds the unsigned `Transaction` using `Connection` + `Program IDL`
3. Server returns serialized base64 transaction
4. Client deserializes + `wallet.sendTransaction(tx, connection)`
5. Client calls `/api/*/sync` to record confirmed result in DB

This was not in the original Week 4 design — it was introduced to allow server-side validation before the user signs.

### New routes vs original design

The original design had 3 routes (`/`, `/campaign/create`, `/campaign/[id]`). Week 9 has:
- `/campaign/create/cliff`, `/campaign/create/linear`, `/campaign/create/milestone` (3 create pages)
- `/campaign/[id]` (full detail page — creator + recipient combined)
- `/campaigns` (campaign list with tabs: All / As Recipient / As Sender / Needs Action)
- `/dashboard` (beneficiary dashboard with needs-attention)
- `/portfolio` (per-campaign vesting breakdown)
- `/activity` (cross-campaign event timeline)
- `/` (public landing page with waitlist)

For full architecture, see: `docs/week9/FE_ARCHITECTURE.md`
