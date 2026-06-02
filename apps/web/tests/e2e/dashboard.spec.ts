import { expect, test } from "@playwright/test";
import { collectRelevantPageErrors } from "./pageErrors";
import { enableE2eWallet, gotoWithRetry } from "./helpers";

test.describe("Dashboard page", () => {
  test("shows connect prompt when disconnected", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await gotoWithRetry(page, "/dashboard");

    await expect(page.getByText(/no wallet connected/i)).toBeVisible();
    await expect(page.getByText(/connect your solana wallet/i)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("shows stat cards when connected", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/dashboard");

    await expect(page.getByText(/total streams/i)).toBeVisible();
    await expect(page.getByText(/active/i).first()).toBeVisible();
    await expect(page.getByText(/as sender/i)).toBeVisible();
    await expect(page.getByText(/as recipient/i)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("shows quick action cards when connected", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/dashboard");

    await expect(page.getByText(/create.*stream/i).first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("welcome message shows truncated wallet address", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/dashboard");

    await expect(page.getByText(/welcome back.*28FQ.*mEAw/i)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
