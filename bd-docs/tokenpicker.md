# Token Picker Polish Plan

## Context

Token picker saat ini masih basic untuk demo day:
- Hanya 4 popular token hardcoded (SOL, wSOL, USDC, USDT)
- Wallet token tampil tanpa logo (cuma letter avatar)
- Tidak ada search external — hanya bisa paste mint address manual
- Referensi: Streamflow pakai wallet dropdown, Sablier pakai Token Lists standard, Jupiter Token API V2 tersedia untuk search

## Approach: Jupiter Token API Integration

Integrate Jupiter Token API V2 untuk search, logo, dan verified badge. Popular tokens list juga di-expand.

---

## Implementation Steps

### Step 1: Expand Popular Tokens List

**File**: `apps/web/src/lib/constants/popular-tokens.ts`

Tambah ke `MAINNET_TOKENS` array setelah USDT:

| Token | Mint Address | Decimals |
|-------|-------------|----------|
| BONK | `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263` | 5 |
| JTO | `jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL` | 9 |
| JUP | `JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN` | 6 |
| PYTH | `HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3` | 6 |
| RAY | `4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R` | 6 |
| WIF | `EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm` | 6 |
| W (Wormhole) | `85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ` | 6 |

Logo URI pattern: `https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/{MINT}/logo.png`

---

### Step 2: Create Jupiter Proxy API Route

**New file**: `apps/web/src/app/api/tokens/search/route.ts`

- Pattern ikuti `api/prices/route.ts` (pakai `withRoute`, `jsonResponse`)
- Endpoint: `GET /api/tokens/search?query=BONK&limit=8`
- Proxy ke: `https://api.jup.ag/tokens/v2/search?query=...`
- Optional header: `x-api-key` dari env `JUPITER_API_KEY`
- Return fields: `{ id, symbol, name, logoURI, decimals, isVerified }`
- Cache: `next: { revalidate: 300 }` (5 min)
- Error handling: return `[]` jika Jupiter down (graceful fallback)
- Tambah `JUPITER_API_KEY=` ke `.env.example`

---

### Step 3: Create useJupiterTokenSearch Hook

**New file**: `apps/web/src/hooks/useJupiterTokenSearch.ts`

- Pattern ikuti `useTokenMetadata.ts`:
  - Debounce 300ms
  - AbortController untuk cancel in-flight requests
  - Minimum 2 chars untuk trigger search
- Fetch dari `/api/tokens/search?query=...`
- Return: `{ results: JupiterToken[], loading: boolean }`
- Type export:
  ```ts
  export type JupiterToken = {
    id: string;
    symbol: string;
    name: string;
    logoURI?: string;
    decimals: number;
    isVerified: boolean;
  };
  ```

---

### Step 4: Integrate Jupiter Search ke TokenPickerModal

**File**: `apps/web/src/components/campaign/create/TokenPickerModal.tsx`

**4a. Import & call hook** (setelah line 40):
```ts
const { results: jupiterResults, loading: jupiterLoading } = useJupiterTokenSearch(search);
```

**4b. Filter duplicates** (setelah line 64):
```ts
const jupiterFiltered = jupiterResults.filter(
  (jt) =>
    !POPULAR_TOKENS.some((p) => p.mint === jt.id) &&
    !filteredWallet.some((w) => w.mintAddress === jt.id),
);
```

**4c. Tambah VerifiedBadge component** (dekat LetterAvatar, line ~17):
```tsx
function VerifiedBadge() {
  return (
    <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
      Verified
    </span>
  );
}
```

**4d. Render "Search Results" section** (setelah wallet tokens ~line 268, sebelum customToken ~line 271):
- Section header: "Search Results" dengan count
- Tiap token: logo (img + fallback LetterAvatar), symbol, name, verified badge jika `isVerified`
- Click: `handleTokenClick(jt.id, jt.decimals)`
- Loading skeleton jika `jupiterLoading && search.length >= 2`

**4e. Wallet token logo enrichment** (line ~249):
- Cross-reference: `jupiterResults.find(jt => jt.id === token.mintAddress)`
- Kalau ada `logoURI`, render `<img>` bukan `LetterAvatar`
- Kalau ada `symbol/name`, tampilkan itu bukan `shortenMint()`

**4f. Update "no tokens found" condition** (line 287):
- Tambah: `&& jupiterFiltered.length === 0 && !jupiterLoading`

---

### Step 5: Update TokenPickerButton

**File**: `apps/web/src/components/campaign/create/TokenPickerButton.tsx`

- Tambah optional props: `tokenSymbol?: string`, `tokenLogoURI?: string`
- Di branch non-popular (line 44-50): kalau `tokenLogoURI` ada, render `<img>` bukan letter avatar
- Kalau `tokenSymbol` ada, tampilkan itu bukan `shortenAddress()`
- Parent component perlu propagate metadata (symbol, logoURI) saat user select dari Jupiter results

---

## Data Flow Diagram

```
User types "BONK" in search
  │
  ├─ Filter POPULAR_TOKENS (local, instant)
  │   → Shows BONK if in expanded list
  │
  ├─ Filter wallet tokens (local, instant)  
  │   → Shows if user holds BONK
  │
  └─ useJupiterTokenSearch (debounced 300ms)
      │
      └─ GET /api/tokens/search?query=BONK
          │
          └─ Server: fetch Jupiter API V2
              │
              └─ Return: [{id, symbol:"BONK", name, logoURI, decimals:5, isVerified:true}]
                  │
                  └─ Render in "Search Results" section with logo + ✓ Verified badge
```

---

## Verification Checklist

- [ ] `pnpm build` pass
- [ ] `pnpm test` pass
- [ ] Token picker: popular section tampil 10+ tokens dengan logo
- [ ] Token picker: search "BONK" → muncul dari Jupiter dengan logo + verified badge
- [ ] Token picker: wallet tokens yang dikenal Jupiter tampil dengan logo
- [ ] Token picker: paste random mint address → still works (custom token lookup)
- [ ] Token picker: Jupiter down → graceful fallback, popular + wallet still work
- [ ] TokenPickerButton: non-popular token tampil dengan logo jika tersedia

---

## Dependencies

- `JUPITER_API_KEY` env var (optional, gratis dari jup.ag)
- Jupiter Token API V2: `https://api.jup.ag/tokens/v2/search`
- No new npm packages needed

## Key Files Reference

| File | Role |
|------|------|
| `apps/web/src/lib/constants/popular-tokens.ts` | Hardcoded token list |
| `apps/web/src/components/campaign/create/TokenPickerModal.tsx` | Main modal UI |
| `apps/web/src/components/campaign/create/TokenPickerButton.tsx` | Selected token display |
| `apps/web/src/hooks/useTokenMetadata.ts` | Pattern reference for new hook |
| `apps/web/src/app/api/prices/route.ts` | Pattern reference for new API route |
| `apps/web/src/hooks/useJupiterTokenSearch.ts` | **NEW** - Jupiter search hook |
| `apps/web/src/app/api/tokens/search/route.ts` | **NEW** - Jupiter proxy route |
