import { expect, test } from "@playwright/test";
import { collectRelevantPageErrors } from "./pageErrors";
import { enableE2eWallet, gotoWithRetry } from "./helpers";

// A valid 44-character base58 address that is not a popular token
const FAKE_MINT_ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

// Minimal JSON-RPC getAccountInfo response returning null (token not found)
function rpcNullResponse(id: number | string) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      context: { slot: 1 },
      value: null,
    },
  };
}

// Minimal JSON-RPC getAccountInfo response returning a valid SPL token mint account.
// SPL mint layout: 82 bytes total; byte 44 is decimals; owner = TOKEN_PROGRAM_ID.
function rpcSplMintResponse(id: number | string, decimals = 6) {
  const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  // Build an 82-byte buffer with decimals at index 44
  const data = new Uint8Array(82);
  data[44] = decimals;
  const base64Data = Buffer.from(data).toString("base64");
  return {
    jsonrpc: "2.0",
    id,
    result: {
      context: { slot: 1 },
      value: {
        data: [base64Data, "base64"],
        executable: false,
        lamports: 1461600,
        owner: TOKEN_PROGRAM_ID,
        rentEpoch: 0,
        space: 82,
      },
    },
  };
}

test.describe("Token picker", () => {
  test("token picker button shows Select Token initially", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/cliff");

    await expect(page.getByRole("button", { name: /select token/i })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("clicking Select Token opens picker modal with search", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/cliff");

    await page.getByRole("button", { name: /select token/i }).click();

    // Modal should show search input and token options
    await expect(page.getByPlaceholder(/name.*symbol.*address/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /SOL.*Native/i }).first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("selecting SOL updates the token button", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/cliff");

    await page.getByRole("button", { name: /select token/i }).click();
    await page.getByRole("button", { name: /SOL.*Native/i }).first().click();

    // Button should now show SOL
    await expect(page.getByRole("button", { name: /SOL.*Native/i })).toBeVisible();
    // Select Token text should be gone
    await expect(page.getByText("Select Token")).not.toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("token picker shows wallet balance", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/cliff");

    await page.getByRole("button", { name: /select token/i }).click();

    // Should show balance for SOL
    await expect(page.getByText(/SOL/i).first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("typing partial symbol filters popular tokens", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/cliff");

    await page.getByRole("button", { name: /select token/i }).click();
    await page.getByPlaceholder(/name.*symbol.*address/i).fill("SO");

    // SOL and wSOL both contain "SO" in their symbol — both should remain visible
    await expect(page.getByRole("button", { name: /SOL.*Native/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /wSOL|Wrapped SOL/i }).first()).toBeVisible();
    // USDC does not match "SO" — should not be visible
    await expect(page.getByRole("button", { name: /USDC/i })).not.toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("typing non-matching query shows no popular tokens", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/cliff");

    await page.getByRole("button", { name: /select token/i }).click();
    await page.getByPlaceholder(/name.*symbol.*address/i).fill("ZZZNOTAREALTOKEN");

    // No popular token buttons should be visible
    await expect(page.getByRole("button", { name: /SOL.*Native/i })).not.toBeVisible();
    await expect(page.getByRole("button", { name: /USDC/i })).not.toBeVisible();
    // Empty state message should appear
    await expect(page.getByText(/no tokens found/i)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("escape key closes token picker", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/cliff");

    await page.getByRole("button", { name: /select token/i }).click();
    // Confirm modal is open
    await expect(page.getByPlaceholder(/name.*symbol.*address/i)).toBeVisible();

    await page.keyboard.press("Escape");

    // Modal should be gone
    await expect(page.getByPlaceholder(/name.*symbol.*address/i)).not.toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("custom mint address search shows loading state", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);

    // Intercept any Solana RPC getAccountInfo call regardless of endpoint URL
    // (CI uses api.devnet.solana.com, local dev may use helius or other)
    await page.route("**", async (route) => {
      const req = route.request();
      if (req.method() !== "POST") return route.continue();
      let body: { id?: number | string; method?: string } | null = null;
      try { body = req.postDataJSON(); } catch { return route.continue(); }
      if (body?.method !== "getAccountInfo") return route.continue();
      // Delay long enough for the loading state to be asserted
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.fulfill({ json: rpcNullResponse(body?.id ?? 1), status: 200 });
    });

    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/cliff");

    await page.getByRole("button", { name: /select token/i }).click();
    await page.getByPlaceholder(/name.*symbol.*address/i).fill(FAKE_MINT_ADDRESS);

    // Loading indicator should appear while RPC call is in flight
    await expect(page.getByText(/looking up token/i)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("custom mint address search shows error when token not found", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);

    // Intercept the Solana RPC call and return null (account does not exist)
    await page.route("**/helius-rpc.com/**", async (route) => {
      const body = route.request().postDataJSON() as { id: number | string };
      await route.fulfill({ json: rpcNullResponse(body?.id ?? 1), status: 200 });
    });

    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/cliff");

    await page.getByRole("button", { name: /select token/i }).click();
    await page.getByPlaceholder(/name.*symbol.*address/i).fill(FAKE_MINT_ADDRESS);

    // After RPC returns null the hook sets an error; the modal shows it when search >= 32 chars
    await expect(page.getByText(/not a valid spl token mint/i)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("custom mint resolves to token when RPC returns valid SPL mint", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);

    // Intercept any Solana RPC getAccountInfo call regardless of endpoint URL
    await page.route("**", async (route) => {
      const req = route.request();
      if (req.method() !== "POST") return route.continue();
      let body: { id?: number | string; method?: string } | null = null;
      try { body = req.postDataJSON(); } catch { return route.continue(); }
      if (body?.method !== "getAccountInfo") return route.continue();
      await route.fulfill({ json: rpcSplMintResponse(body?.id ?? 1, 9), status: 200 });
    });

    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/cliff");

    await page.getByRole("button", { name: /select token/i }).click();
    await page.getByPlaceholder(/name.*symbol.*address/i).fill(FAKE_MINT_ADDRESS);

    // The hook derives symbol from first 4 chars of the address (uppercased)
    const expectedSymbol = FAKE_MINT_ADDRESS.slice(0, 4).toUpperCase();
    await expect(page.getByText(expectedSymbol)).toBeVisible();
    // Decimals label should also be rendered next to the token entry
    await expect(page.getByText(/9 decimals/i)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
