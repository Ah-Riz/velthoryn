# Frontend Architecture — Velthoryn Token Vesting

> **Scope**: `apps/web/` — Next.js 15 App Router frontend for the Velthoryn Solana vesting protocol.
> **Last updated**: 2026-06-18 (Week 9)

---

## 1. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js App Router | 15.5.18 |
| UI library | React | 19 |
| Server-state | TanStack Query | v5 |
| Component library | shadcn/ui | latest |
| Styling | Tailwind CSS | v4 |
| Solana wallet | `@solana/wallet-adapter-react` | latest |
| Anchor client | `@coral-xyz/anchor` | latest |
| SPL tokens | `@solana/spl-token` | latest |
| Testing (unit) | Vitest + Testing Library | latest |
| Testing (E2E) | Playwright | latest |
| DB ORM | Prisma | latest |
| Storage (Merkle data) | Supabase | v2 |
| File uploads | Pinata IPFS | - |
| Fonts | Space Grotesk · JetBrains Mono · Geist | - |

---

## 2. Directory Structure

```
apps/web/
├── src/
│   ├── app/                        # Next.js App Router
│   │   ├── (app)/                  # Authenticated shell layout
│   │   │   ├── layout.tsx          # AppShellLayout: Sidebar + Header + PendingCampaignIndexer
│   │   │   ├── campaigns/          # Campaign list (creator view)
│   │   │   ├── campaign/
│   │   │   │   ├── [id]/           # Campaign detail page
│   │   │   │   └── create/
│   │   │   │       ├── cliff/      # Cliff vesting create flow
│   │   │   │       ├── linear/     # Linear vesting create flow
│   │   │   │       └── milestone/  # Milestone vesting create flow
│   │   │   ├── dashboard/          # Beneficiary dashboard
│   │   │   ├── portfolio/          # Portfolio / holdings view
│   │   │   └── activity/           # Activity / timeline feed
│   │   ├── api/                    # Next.js Route Handlers
│   │   │   ├── campaigns/          # CRUD + detail endpoints
│   │   │   ├── beneficiary/        # Vesting progress endpoint
│   │   │   ├── claims/             # Claim sync endpoint
│   │   │   ├── events/             # On-chain event indexing
│   │   │   ├── prices/             # CoinGecko price proxy
│   │   │   └── cron/               # Auto-sync cron job
│   │   ├── landing/                # Public landing page
│   │   ├── layout.tsx              # Root layout (providers + fonts + CSP)
│   │   └── globals.css             # Tailwind v4 design tokens
│   ├── components/
│   │   ├── campaign/
│   │   │   ├── create/             # Create-flow form components
│   │   │   ├── detail/             # Campaign detail action buttons
│   │   │   └── list/               # CampaignRow, StatusBadge, RoleBadge
│   │   ├── dashboard/              # ActivityFeed, VestingProgressCard
│   │   ├── shell/                  # AppHeader, Sidebar
│   │   ├── providers/              # React context providers
│   │   └── ui/                     # shadcn/ui primitives
│   ├── hooks/                      # TanStack Query + Solana hooks
│   ├── lib/
│   │   ├── anchor/                 # client.ts, errors.ts, idl.ts
│   │   ├── api/                    # tx-builder.ts (server), client-auth.ts
│   │   ├── campaign/               # bulk.ts (CSV processing)
│   │   ├── merkle/                 # builder.ts (leaf encoding)
│   │   ├── sol/                    # cluster.ts, auto-wrap.ts
│   │   ├── stream/                 # persist.ts (local storage)
│   │   └── vesting/                # schedule.ts (vesting math)
│   └── types/                      # Shared TypeScript types
├── tests/
│   ├── e2e/                        # 23 Playwright chromium specs
│   │   └── signing/                # 10 real-wallet Playwright specs
│   ├── integration/                # 47 devnet integration tests
│   └── lib/                        # 572 Vitest unit tests (32 files)
└── next.config.ts                  # CSP headers, security headers
```

---

## 3. Provider Hierarchy

```
RootLayout
└── ThemeProvider (next-themes, dark/light)
    └── QueryProvider (TanStack Query v5)
        └── WalletProvider (@solana/wallet-adapter)
            └── WalletTokensProvider (token balances ctx)
                └── TooltipProvider (shadcn/ui)
                    └── AppShellLayout (app group)
                        ├── PendingCampaignIndexer (background indexing)
                        ├── Toaster (sonner notifications)
                        └── {page}
```

---

## 4. Data Flow

### Campaign Create Flow

```
Page (create/cliff|linear|milestone)
  → Form state (React state)
  → useCreateCampaign hook
      → buildWrapSolInstructions (if SOL)
      → derivePda (tree address)
      → initializeCampaign tx (Anchor)
      → depositTokens tx (Anchor)
      → savePendingCampaignIndexLocal (localStorage)
  ← PendingCampaignIndexer polls & calls /api/campaigns (POST)
  ← TanStack Query cache invalidated → campaign list refetches
```

### Claim Flow

```
Campaign detail page [id]
  → useProofLookup (GET /api/campaigns/[id]/proof?beneficiary=)
  → useClaimRecord (on-chain PDA fetch)
  → ClaimWithProofButton
      → buildClaimTx (tx-builder.ts, server action)
      → wallet.sendTransaction
      → /api/claims/sync (POST) → on-chain verify + DB write
  ← useCampaignDetail refetches (stale: 10s)
```

### Root Rotation

```
RootRotationCard
  → useUpdateRoot hook
      → updateRoot instruction (Anchor, new merkleRoot)
      → POST /api/campaigns/[id]/root-versions (CreateRootVersionRequest)
  ← useQuery invalidation on ["campaign", treeAddress]
```

---

## 5. State Management

| Layer | Tool | What it manages |
|---|---|---|
| Server state | TanStack Query v5 | Campaign data, proof data, vesting progress |
| Local state | React `useState` | Form fields, UI toggles, modal open/close |
| Persistent client | `localStorage` | Pending campaign index queue, sidebar collapse state |
| Wallet state | wallet-adapter context | Connected wallet, public key, sendTransaction |
| Token balances | WalletTokensProvider | SPL token accounts for connected wallet |

Query key conventions:
- `["campaign", treeAddress]` — single campaign detail
- `["vestingProgress", address]` — beneficiary portfolio
- `["proof", treeAddress, beneficiary]` — Merkle proof
- `["claimRecord", treeAddress, beneficiary]` — on-chain PDA
- `["campaigns"]` — campaign list

---

## 6. Wallet Integration

The app uses `@solana/wallet-adapter-react`. All Anchor program calls go through:

1. `useVestingProgram()` → returns `Program<Vesting>` (Anchor) or `null` if wallet not connected
2. `useConnection()` → returns `Connection` to `NEXT_PUBLIC_RPC_ENDPOINT`
3. `useWallet()` → returns `publicKey`, `sendTransaction`, `signTransaction`

**SOL auto-wrap**: When the selected token is native SOL (`So11111111111111111111111111111111111111112`), `buildWrapSolInstructions()` prepends `createAssociatedTokenAccount + transfer + syncNative` to the transaction before deposit.

**E2E mock wallet**: In Playwright tests, `localStorage.setItem('velthoryn:e2e-mock-send-tx', '1')` is set to bypass real signing. Requires `NEXT_PUBLIC_E2E_MOCK_WALLET=true` in `.env.test`.

---

## 7. FE–SC Communication

All on-chain interaction is server-side built then client-side signed:

```
Server (tx-builder.ts, Route Handler or Server Action)
  → Builds unsigned Transaction using Connection + Program IDL
  → Returns serialized base64 tx

Client (hook)
  → Deserializes tx
  → wallet.sendTransaction(tx, connection)
  → Waits for confirmTransaction
  → Calls /api/*/sync to record on-chain result in DB
```

**Key constants in tx-builder.ts:**
- `GRACE_PERIOD_SECS = 604800n` (7 days, mirrors on-chain constant)
- `PreparedTransaction` interface — returned by all builder functions

---

## 8. Campaign Lifecycle (8-State Model)

The `CampaignLifecycle` type (`active | paused | claimable | claimed | cancelled_grace | cancelled_expired | instant_refunded | settled`) is the central state machine for all UI branching.

```
          ┌─────────────────────────────────────────────────┐
          │                                                 ▼
  active ──┤─► paused ──► active                      instant_refunded
          │
          ├─► cancelled_grace ──► (7d) ──► cancelled_expired
          │
          ├─► settled (single-leaf cancel with vested split)
          │
          └─► claimed (all tokens claimed)
```

Helper `isGracePeriodVisible(campaign)` → `true` when `cancelledAt` is set and less than 7 days ago.

**UI branching by lifecycle state** (in `campaign/[id]/page.tsx`):
- `active`: show ClaimWithProofButton, PauseToggleButton, WithdrawUnvestedButton
- `paused`: show resume button (PauseToggleButton), disable claims
- `cancelled_grace`: show grace period countdown, allow unvested withdrawal
- `cancelled_expired`: allow unvested withdrawal, disable claims
- `instant_refunded`: show refund banner, disable all actions
- `settled`: show settled state, disable new claims

---

## 9. Dark Mode

Using `next-themes` with `ThemeProvider` at the root. Design tokens are in `globals.css` as CSS custom properties (`--background`, `--foreground`, `--primary`, etc.). shadcn/ui components consume these tokens. The default theme is dark.

---

## 10. Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Prisma Postgres connection |
| `NEXT_PUBLIC_RPC_ENDPOINT` | Yes | Solana RPC URL (devnet or mainnet) |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon/public key |
| `ADMIN_API_KEY` | Yes | Admin-only route auth header |
| `API_KEY` | Yes | Internal API route auth |
| `PINATA_JWT` | Yes | Pinata IPFS JWT for Merkle data uploads |
| `PINATA_GATEWAY_URL` | Yes | Pinata gateway URL |
| `CRON_SECRET` | Yes | Cron job auth (`/api/cron/sync`) |
| `UPSTASH_REDIS_REST_URL` | Optional | Rate limiting (Upstash) |
| `UPSTASH_REDIS_REST_TOKEN` | Optional | Rate limiting token |
| `ALLOWED_ORIGIN` | Optional | CORS origin (default: velthoryn.vercel.app) |
| `COINGECKO_API_KEY` | Optional | Price feed API key |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional | Sentry error monitoring |
| `NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS` | Optional | Vercel Analytics toggle |
| `NEXT_PUBLIC_E2E_MOCK_WALLET` | Test only | Enable E2E mock wallet bypass |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | Optional | Override RPC cluster detection |

---

## 11. Security Headers

Set in `next.config.ts`:
- `Content-Security-Policy`: restricts scripts/frames, allows `wss://helius-rpc.com`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

---

## 12. Build & CI

| Command | Description |
|---|---|
| `pnpm --filter web dev` | Dev server (port 3000) |
| `pnpm --filter web build` | Production Next.js build |
| `pnpm --filter web lint` | Biome lint + TypeScript check |
| `cd apps/web && npx vitest --config vitest.unit.config.ts --run` | Unit tests (572 tests) |
| `cd apps/web && npx playwright test` | E2E chromium (23 specs) |
| `cd apps/web && npx playwright test --config playwright.signing.config.ts` | E2E signing (10 specs) |

CI pipelines: `.github/workflows/ci.yml` (unit + type), `.github/workflows/web-ci.yml` (build), `.github/workflows/lint.yml` (Biome).

---

## 13. Campaign Lifecycle State Diagram

The `CampaignLifecycle` type has 8 states. The diagram below shows valid transitions; all others are blocked by on-chain guards.

```mermaid
stateDiagram-v2
    [*] --> active : create_campaign / create_stream (funded)
    active --> paused : pause_campaign
    paused --> active : unpause_campaign
    active --> cancelled_grace : cancel_campaign (starts 7-day grace)
    cancelled_grace --> cancelled_expired : 7 days elapsed, no claims possible
    cancelled_grace --> settled : all beneficiaries claimed during grace
    active --> instant_refunded : instant_refund_campaign (before min_cliff_time)
    active --> claimed : total_claimed == total_supply
```

**FE helpers:**
- `isGracePeriodVisible(campaign)` → `true` when `cancelledAt != null && !instantRefunded && !streamSettled`
- `CampaignStatusBadge` renders a distinct badge variant for each of the 8 states.
- Source: `apps/web/src/lib/vesting/list.ts`

---

## 14. Root Rotation UI (useUpdateRoot + AllocationEditor)

`useUpdateRoot` hook (`src/hooks/useUpdateRoot.ts`) drives the Allocations page
(`src/app/(app)/campaign/[id]/allocations/page.tsx`).

**Flow:**
1. `AllocationEditor` rebuilds the Merkle tree client-side from the edited
   recipient list (via `src/lib/merkle/builder.ts`).
2. The hook calls `update_root(newRoot, newLeafCount, newMinCliffTime)` via
   `tx-builder.ts` (server action).
3. On success, posts the new leaves + proofs to
   `POST /api/campaigns/[id]/root-versions`.
4. TanStack Query key `["campaign", treeAddress]` is invalidated → campaign
   detail refetches with the new root.

**Constraints enforced by the program:**
- `SameRoot` (6004) — recomputed root equals the current on-chain root (no change).
- `NotCancellable` (6019) — `update_root` is signed by `cancel_authority`; only
  campaigns created with `cancellable: true` can rotate.
- Root rotation is all-or-nothing: the entire recipient set is replaced atomically.

**FE guard:** The `AllocationEditor` disables the "Save Allocations" button when
`computedRoot === campaign.merkleRoot` (pre-computes client-side to avoid a
wasted transaction).
