# Frontend Architecture

The Velthoryn frontend is a Next.js 15 App Router application located in `apps/web/`. It serves as the primary interface for creating, managing, and claiming Solana token vesting campaigns.

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js App Router | 15.5.18 |
| UI library | React | 19 |
| Server-state | TanStack Query | v5 |
| Component library | shadcn/ui | latest |
| Styling | Tailwind CSS | v4 |
| Solana wallet | `@solana/wallet-adapter-react` | latest |
| Anchor client | `@coral-xyz/anchor` | 0.32.1 |
| SPL tokens | `@solana/spl-token` | latest |
| `@solana/web3.js` | Solana web3.js | v1.98.4 (v1, not v2) |
| Testing (unit) | Vitest + Testing Library | latest |
| Testing (E2E) | Playwright | latest |
| DB ORM | Drizzle ORM | 0.39.3 |
| DB host | Supabase Postgres (pooler) | -- |
| State (global) | Zustand | v5 |
| Notifications | sonner | latest |
| Fonts | Space Grotesk, JetBrains Mono, Geist | -- |

{% hint style="info" %}
Phase 2 features not yet implemented: Supabase JS client (Auth + Storage), Pinata IPFS file uploads.
{% endhint %}

---

## Directory Structure

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

## Provider Hierarchy

The application wraps pages in a nested provider chain. The order matters for context availability.

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

## Data Flow

### Campaign Create Flow

```
Page (create/cliff|linear|milestone)
  -> Form state (React state)
  -> useCreateCampaign hook
      -> buildWrapSolInstructions (if SOL)
      -> derivePda (tree address)
      -> initializeCampaign tx (Anchor)
      -> depositTokens tx (Anchor)
      -> savePendingCampaignIndexLocal (localStorage)
  <- PendingCampaignIndexer polls & calls /api/campaigns (POST)
  <- TanStack Query cache invalidated -> campaign list refetches
```

### Claim Flow

```
Campaign detail page [id]
  -> useProofLookup (GET /api/campaigns/[id]/proof?beneficiary=)
  -> useClaimRecord (on-chain PDA fetch)
  -> ClaimWithProofButton
      -> buildClaimTx (tx-builder.ts, server action)
      -> wallet.sendTransaction
      -> /api/claims/sync (POST) -> on-chain verify + DB write
  <- useCampaignDetail refetches (stale: 10s)
```

### Root Rotation

```
RootRotationCard
  -> useUpdateRoot hook
      -> updateRoot instruction (Anchor, new merkleRoot)
      -> POST /api/campaigns/[id]/root-versions (CreateRootVersionRequest)
  <- useQuery invalidation on ["campaign", treeAddress]
```

---

## State Management

| Layer | Tool | What it manages |
|---|---|---|
| Server state | TanStack Query v5 | Campaign data, proof data, vesting progress |
| Local state | React `useState` | Form fields, UI toggles, modal open/close |
| Global client state | Zustand (`useAppStore`) | `selectedCampaignId` -- cross-component campaign selection |
| Persistent client | `localStorage` | Pending campaign index queue, sidebar collapse state |
| Wallet state | wallet-adapter context | Connected wallet, public key, sendTransaction |
| Token balances | WalletTokensProvider | SPL token accounts for connected wallet |

### Query Key Conventions

| Key | Usage |
|---|---|
| `["campaign", treeAddress]` | Single campaign detail |
| `["vestingProgress", address]` | Beneficiary portfolio |
| `["proof", treeAddress, beneficiary]` | Merkle proof |
| `["claimRecord", treeAddress, beneficiary]` | On-chain PDA |
| `["campaigns"]` | Campaign list |

---

## Wallet Integration

The app uses `@solana/wallet-adapter-react`. All Anchor program calls go through:

1. `useVestingProgram()` -- returns `Program<Vesting>` (Anchor) or `null` if wallet not connected.
2. `useConnection()` -- returns `Connection` to `NEXT_PUBLIC_RPC_ENDPOINT`.
3. `useWallet()` -- returns `publicKey`, `sendTransaction`, `signTransaction`.

**SOL auto-wrap:** When the selected token is native SOL (`So11111111111111111111111111111111111111112`), `buildWrapSolInstructions()` prepends `createAssociatedTokenAccount + transfer + syncNative` to the transaction before deposit.

**E2E mock wallet:** In Playwright tests, `localStorage.setItem('velthoryn:e2e-mock-send-tx', '1')` bypasses real signing. Requires `NEXT_PUBLIC_E2E_MOCK_WALLET=true` in `.env.test`.

---

## FE-SC Communication

All on-chain interaction is server-side built then client-side signed:

```
Server (tx-builder.ts, Route Handler or Server Action)
  -> Builds unsigned Transaction using Connection + Program IDL
  -> Returns serialized base64 tx

Client (hook)
  -> Deserializes tx
  -> wallet.sendTransaction(tx, connection)
  -> Waits for confirmTransaction
  -> Calls /api/*/sync to record on-chain result in DB
```

Key constants in `tx-builder.ts`:
- `GRACE_PERIOD_SECS = 604800n` (7 days, mirrors on-chain constant)
- `PreparedTransaction` interface -- returned by all builder functions

See [ADR-FE-005](../decisions/adr-fe-005-server-side-tx.md) for the rationale behind server-side transaction building.

---

## Campaign Lifecycle (8-State Model)

The `CampaignLifecycle` type defines eight states that drive all UI branching:

```
active | paused | claimable | claimed |
cancelled_grace | cancelled_expired | instant_refunded | settled
```

```
          +--------------------------------------------------+
          |                                                  v
  active --+-> paused --> active                      instant_refunded
          |
          +-> cancelled_grace --> (7d) --> cancelled_expired
          |
          +-> settled (single-leaf cancel with vested split)
          |
          +-> claimed (all tokens claimed)
```

**UI branching by lifecycle state** (in `campaign/[id]/page.tsx`):

| State | Behavior |
|---|---|
| `active` | Vesting in progress; PauseToggleButton visible; claim disabled with countdown |
| `claimable` | ClaimWithProofButton enabled; PauseToggleButton visible |
| `claimed` | Claim disabled; completion state shown |
| `paused` | Resume button visible; claim disabled |
| `cancelled_grace` | Grace countdown visible; ClaimWithProofButton active for vested portion |
| `cancelled_expired` | Claim disabled; WithdrawUnvestedButton for creator |
| `instant_refunded` | Refund banner shown; all actions disabled |
| `settled` | Settled state shown; no further claims |

Helper: `isGracePeriodVisible({ cancelledAt, instantRefunded, streamSettled })` returns `true` only when all three conditions hold: `cancelledAt !== null && !instantRefunded && !streamSettled`.

See [ADR-FE-003](../decisions/adr-fe-003-campaign-lifecycle.md) for the design rationale.

---

## Dark Mode

Uses `next-themes` with `ThemeProvider` at the root. Design tokens are CSS custom properties in `globals.css` (`--background`, `--foreground`, `--primary`, etc.). shadcn/ui components consume these tokens. The default theme is dark.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Drizzle ORM -- Supabase Postgres connection string |
| `NEXT_PUBLIC_RPC_ENDPOINT` | Yes | Solana RPC URL (devnet or mainnet) |
| `ADMIN_API_KEY` | Yes | Admin-only route auth header |
| `API_KEY` | Yes | Internal API route auth |
| `CRON_SECRET` | Yes | Cron job auth (`/api/cron/sync`) |
| `COINGECKO_API_KEY` | Yes | CoinGecko price feed proxy (`/api/prices`) |
| `UPSTASH_REDIS_REST_URL` | Optional | Rate limiting (Upstash Redis) |
| `UPSTASH_REDIS_REST_TOKEN` | Optional | Rate limiting token |
| `ALLOWED_ORIGIN` | Optional | CORS origin (default: velthoryn.site) |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional | Sentry error monitoring DSN |
| `NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS` | Optional | Enable Vercel Web Analytics |
| `NEXT_PUBLIC_SUPABASE_URL` | Phase 2 | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Phase 2 | Supabase anon key |
| `PINATA_JWT` | Phase 2 | Pinata IPFS JWT |
| `PINATA_GATEWAY_URL` | Phase 2 | Pinata gateway URL |
| `NEXT_PUBLIC_E2E_MOCK_WALLET` | Test only | Enable E2E mock wallet bypass |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | Optional | Override auto-detected cluster |

---

## Security Headers

Configured in `next.config.ts`:

| Header | Value |
|---|---|
| `Content-Security-Policy` | Restricts scripts/frames; allows `wss://helius-rpc.com` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |

---

## Build and CI

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

## Known Product Tradeoffs

These are deliberate design choices with documented costs, not bugs.

**1. 7-day grace period is hostile UX for legitimate cancellations.**
If a beneficiary is unavailable when a campaign is cancelled, they risk losing already-vested tokens. The grace period prevents creators from cancelling and draining the vault before a beneficiary can claim. Mitigation roadmap: make the grace period configurable per campaign. See [ADR-FE-007](../decisions/adr-fe-007-cancel-design.md).

**2. Off-chain centralization: no backend means no claims.**
Merkle proof generation requires the off-chain tree to be available. If Velthoryn's backend goes down, beneficiaries cannot reconstruct the proof from the chain alone. Mitigation: root rotation guard + eventual IPFS pinning (Phase 2).

**3. Root rotation is operationally heavy.**
Revoking one recipient from a 1,000-person campaign requires recalculating the full Merkle tree, updating it on-chain, and syncing the database.

**4. Claim is pull-based, not push-based.**
Recipients must return to the site, connect wallets, and manually claim. True zero-friction would be push-based streams.
