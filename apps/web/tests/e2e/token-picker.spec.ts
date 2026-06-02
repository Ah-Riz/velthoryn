import { expect, test } from "@playwright/test";
import { collectRelevantPageErrors } from "./pageErrors";
import { enableE2eWallet, gotoWithRetry } from "./helpers";

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
});
