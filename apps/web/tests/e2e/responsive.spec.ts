import { expect, test } from "@playwright/test";
import { collectRelevantPageErrors } from "./pageErrors";
import { enableE2eWallet, gotoWithRetry } from "./helpers";

test.describe("Responsive layout", () => {
  test("desktop viewport shows sidebar", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoWithRetry(page, "/dashboard");

    await expect(page.locator("aside")).toBeVisible();
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("desktop viewport shows full header with network badge", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoWithRetry(page, "/dashboard");

    await expect(page.locator("header")).toBeVisible();
    await expect(page.getByText("Devnet").first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("create form is usable at 1024px width", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await page.setViewportSize({ width: 1024, height: 768 });
    await gotoWithRetry(page, "/campaign/create/cliff");

    await expect(page.getByRole("heading", { name: "Cliff Vesting" })).toBeVisible();
    await expect(page.getByRole("button", { name: /select token/i })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("landing page renders at mobile viewport", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await gotoWithRetry(page, "/");

    await expect(page.getByText("Velthoryn").first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
