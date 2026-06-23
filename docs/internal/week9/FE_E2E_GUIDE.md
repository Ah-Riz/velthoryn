# FE E2E Testing Guide — Velthoryn Token Vesting

> **Scope**: `apps/web/tests/e2e/` — Playwright E2E tests for the Velthoryn frontend.
> **Last updated**: 2026-06-18 (Week 9)

---

## 1. Quick Start

```bash
# From repo root
cd apps/web

# Run all chromium E2E tests (mock wallet, no real signing)
npx playwright test

# Run with UI mode (interactive)
npx playwright test --ui

# Run a single spec
npx playwright test campaign-detail.spec.ts

# Run signing tests (requires real keypair, separate config)
npx playwright test --config playwright.signing.config.ts
```

---

## 2. Architecture

### Two Test Configurations

| Config | File | Wallet | Specs |
|---|---|---|---|
| Chromium (mock) | `playwright.config.ts` | Mock (no real tx) | 23 specs in `tests/e2e/` |
| Signing | `playwright.signing.config.ts` | Real keypair (devnet) | 10 specs in `tests/e2e/signing/` |

### Mock Wallet

All chromium tests use a mock wallet that bypasses real transaction signing. The mock is enabled by:

1. Setting `NEXT_PUBLIC_E2E_MOCK_WALLET=true` (dev server is started with this automatically)
2. Tests call `page.evaluate(() => localStorage.setItem('velthoryn:e2e-mock-send-tx', '1'))` at setup

With the mock active, `wallet.sendTransaction()` returns a fake transaction signature immediately without hitting devnet.

### Web Server

The Playwright config starts the Next.js dev server automatically on port 3100:

```
# Dev mode (default, fast startup)
NEXT_PUBLIC_E2E_MOCK_WALLET=true pnpm exec next dev -H 127.0.0.1 -p 3100

# CI mode (production build)
pnpm build && pnpm start -p 3100 -H 127.0.0.1
```

To run against an already-running server, set `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100`.

---

## 3. Environment Setup

### `.env.test` (required for local runs)

```
DATABASE_URL=postgresql://...
NEXT_PUBLIC_RPC_ENDPOINT=https://api.devnet.solana.com
NEXT_PUBLIC_SUPABASE_URL=https://...supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
API_KEY=test-api-key
ADMIN_API_KEY=test-admin-key
PINATA_JWT=...
PINATA_GATEWAY_URL=...
NEXT_PUBLIC_E2E_MOCK_WALLET=true
```

### Signing test additional vars

```
E2E_WALLET_SECRET_KEY=[1,2,3,...]   # base58 or JSON array keypair
E2E_FUNDED_WALLET_ADDRESS=...       # devnet wallet with SOL + test tokens
```

---

## 4. Spec Overview

### Chromium Specs (23 files)

| Spec | What it tests |
|---|---|
| `landing.spec.ts` | Public landing page renders |
| `navigation.spec.ts` | Sidebar routing, page transitions |
| `wallet-connection.spec.ts` | Connect/disconnect wallet modal |
| `campaign-detail.spec.ts` | Campaign detail page rendering, action buttons |
| `campaign-actions.spec.ts` | Pause, cancel, claim, withdraw actions (mock tx) |
| `create-pages.spec.ts` | Create flow pages render without errors |
| `vesting-create-flows.spec.ts` | Full cliff/linear/milestone create with schedule |
| `manual-create.spec.ts` | Manual (non-CSV) beneficiary entry |
| `csv-template-create.spec.ts` | CSV download template + upload flow |
| `csv-validation.spec.ts` | CSV row-level validation errors |
| `my-campaigns.spec.ts` | Campaign list tabs, filter, search |
| `dashboard.spec.ts` | Dashboard needs-action, beneficiary cards |
| `token-picker.spec.ts` | TokenPickerModal search + SOL wrap badge |
| `wrap-sol.spec.ts` | WrapSolModal toggle, amount input |
| `allocations.spec.ts` | Root allocation editor lock states |
| `close-claim-record.spec.ts` | CloseClaimRecordButton visibility |
| `funding-recovery.spec.ts` | PendingCampaignIndexer recovery flow |
| `vesting-ui-components.spec.ts` | VestingChart, StatusBadge, RoleBadge |
| `user-journey.spec.ts` | Full creator → beneficiary golden path |
| `responsive.spec.ts` | Mobile (375px) layout, sidebar drawer |
| `accessibility.spec.ts` | WCAG basic checks (aria-labels, contrast) |
| `error-validation.spec.ts` | Form validation error messages |
| `pageErrors.ts` | Helper: collect browser console errors |

### Signing Specs (10 files, `tests/e2e/signing/`)

These run against devnet with real wallet signing and skip CI by default:

| Spec | What it tests |
|---|---|
| `create-cliff.spec.ts` | Create a real cliff campaign on devnet |
| `create-linear.spec.ts` | Create a real linear campaign on devnet |
| `create-milestone.spec.ts` | Create a real milestone campaign on devnet |
| `fund-campaign.spec.ts` | Deposit tokens into a campaign |
| `claim.spec.ts` | Claim vested tokens with Merkle proof |
| `pause.spec.ts` | Pause and unpause a campaign |
| `cancel.spec.ts` | Cancel and settle a campaign |
| `update-root.spec.ts` | Rotate Merkle root |
| `close-claim-record.spec.ts` | Close claim record after full claim |
| `withdraw-unvested.spec.ts` | Withdraw unvested after cancel + grace |

---

## 5. Writing a New Test

### Basic Structure

```ts
import { test, expect } from "@playwright/test";
import { connectMockWallet } from "./helpers";

test.describe("Feature Name", () => {
  test.beforeEach(async ({ page }) => {
    // Enable mock wallet
    await page.goto("/");
    await page.evaluate(() =>
      localStorage.setItem("velthoryn:e2e-mock-send-tx", "1")
    );
    await connectMockWallet(page);
  });

  test("should do something", async ({ page }) => {
    await page.goto("/campaigns");
    await expect(page.getByRole("heading", { name: "My Campaigns" })).toBeVisible();
  });
});
```

### Using `helpers.ts`

The shared `tests/e2e/helpers.ts` exports:
- `connectMockWallet(page)` — clicks Connect and selects mock wallet
- `waitForToast(page, text)` — waits for a sonner toast notification
- `fillCampaignSchedule(page, { startDate, cliffDate, endDate })` — fills campaign-level schedule fields
- `uploadCsvFile(page, locator, csvContent)` — uploads a CSV string to a file input

### Checking Page Errors

Import `pageErrors` to fail the test on unexpected console errors:

```ts
import { watchPageErrors } from "./pageErrors";

test("no console errors", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto("/dashboard");
  expect(errors).toHaveLength(0);
});
```

### Responsive Testing

```ts
test("mobile layout", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/campaigns");
  // Sidebar should be hidden, mobile menu button visible
  await expect(page.getByRole("button", { name: /menu/i })).toBeVisible();
});
```

---

## 6. Debugging

### Run with Headed Mode

```bash
npx playwright test campaign-detail.spec.ts --headed
```

### Show Trace Viewer (after a failure)

```bash
npx playwright show-trace test-results/*/trace.zip
```

Traces are retained on failure automatically (configured in `playwright.config.ts`).

### Debug Single Test

```bash
npx playwright test -g "should show claim button" --debug
```

### Check the Mock Wallet Flag

If tests pass locally but fail in CI, check:
1. `NEXT_PUBLIC_E2E_MOCK_WALLET=true` is set when the server starts
2. `localStorage.setItem('velthoryn:e2e-mock-send-tx', '1')` is called in `beforeEach`

---

## 7. CI Integration

### CI Pipeline (`.github/workflows/ci.yml`)

- Playwright chromium tests run on every PR
- Signing tests are **disabled** in CI (require funded devnet wallet)
- Test artifacts (traces, screenshots) are uploaded on failure

### CI Environment Variables

CI must have all `.env.test` variables set as GitHub Actions secrets. The `DATABASE_URL` should point to a test-only Postgres instance.

### Skipping Signing in CI

The signing project is excluded from the default CI run. To run locally:

```bash
npx playwright test --config playwright.signing.config.ts --project signing
```

---

## 8. Coverage Gaps

| Area | Gap | Priority |
|---|---|---|
| Grace-period countdown timer | No E2E test for countdown display | P1 |
| Instant refund UI | Not tested in chromium specs | P1 |
| Multi-leaf CSV + claim | Only unit-tested, no E2E | P1 |
| Dark mode toggle | Not tested | P2 |
| Portfolio mint-by-mint breakdown | Not tested | P2 |
| Accessibility (full WCAG 2.1 AA) | Only basic checks | P2 |
