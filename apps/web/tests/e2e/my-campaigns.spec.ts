import { expect, test } from "@playwright/test";
import { collectRelevantPageErrors } from "./pageErrors";
import { enableE2eWallet, gotoWithRetry } from "./helpers";

test.describe("My Campaigns page", () => {
  test("shows connect prompt when disconnected", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await gotoWithRetry(page, "/campaigns");

    await expect(page.getByText(/connect your wallet/i)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("shows page heading and tabs when connected", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaigns");

    await expect(page.getByRole("heading", { name: /vesting streams/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /all/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /as recipient/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /as sender/i })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("tabs are clickable and switch content", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaigns");

    await page.getByRole("button", { name: /as sender/i }).click();
    await page.getByRole("button", { name: /as recipient/i }).click();
    await page.getByRole("button", { name: /all/i }).click();

    // No crash after switching tabs
    await expect(page.getByRole("heading", { name: /vesting streams/i })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("has refresh button", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaigns");

    await expect(page.getByRole("button", { name: /refresh/i })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
