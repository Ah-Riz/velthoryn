import { expect, test } from "@playwright/test";
import { collectRelevantPageErrors } from "./pageErrors";
import { enableE2eWallet, gotoWithRetry, creatorWallet } from "./helpers";

test.describe("Wallet connection states", () => {
  test("shows wallet connect button when disconnected", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await gotoWithRetry(page, "/dashboard");

    await expect(page.getByText(/connect your wallet/i)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("shows truncated address when connected", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/dashboard");

    const short = `${creatorWallet.slice(0, 4)}...${creatorWallet.slice(-4)}`;
    await expect(page.getByText(short, { exact: true })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("connected wallet sees dashboard content instead of connect prompt", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/dashboard");

    await expect(page.getByText(/welcome back/i)).toBeVisible();
    await expect(page.getByText(/no wallet connected/i)).not.toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("campaigns page shows connect prompt when disconnected", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await gotoWithRetry(page, "/campaigns");

    await expect(page.getByText(/connect your wallet/i)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("campaigns page shows content when connected", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaigns");

    await expect(page.getByText(/connect your wallet/i)).not.toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
